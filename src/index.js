/**
 * 418-serin-tagaytay-booking-calendar-sdk Core SDK Client
 * Exports CondoBookingClient adhering to the standard { success, status, data, error, meta } envelope.
 * Coordinates atomic Dual-Store CRUD across Google Calendar (gcalendar) and SQLite (condo_ops.db).
 */

import { fetchAndParseCalendar, DEFAULT_ICAL_URL } from './core/calendar-feed.js';
import { isIntervalAvailable, parseDateTimePHT, STANDARD_CHECKIN_HOUR, STANDARD_CHECKOUT_HOUR } from './core/conflict-engine.js';
import { calculateStayQuote } from './core/pricing-engine.js';
import { evaluateLockPinReleaseGate, validateEndorsementPayload } from './core/gate-engine.js';
import { CondoOpsStore } from './store/sqlite-store.js';
import { GoogleCalendarAdapter, CALENDAR_ID, CALENDAR_WEB_URL } from './core/gcalendar-adapter.js';

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_DB_PATH = resolve(__dirname, '../data/condo_ops.db');

export class CondoBookingClient {
  constructor(options = {}) {
    this.target = options.target || 'local';
    this.dbPath = options.dbPath || DEFAULT_DB_PATH;
    this.calendarUrl = options.calendarUrl || DEFAULT_ICAL_URL;
    this.store = new CondoOpsStore(this.dbPath);
    this.store.initSchema();
    this.skipGcal = !!options.skipGcal;
    this.gcal = options.gcalAdapter || (this.skipGcal ? {
      listEvents: async () => [],
      findEventByRef: async () => null,
      createEvent: async (res) => ({ success: true, gcalEventId: `mock-${res.refId}`, htmlLink: CALENDAR_WEB_URL }),
      updateEvent: async () => ({ success: true }),
      deleteEvent: async () => ({ success: true })
    } : new GoogleCalendarAdapter({
      calendarId: options.calendarId || CALENDAR_ID
    }));
  }

  _envelope(success, status, data = null, error = null, meta = {}) {
    return {
      success,
      status,
      data,
      error,
      meta: {
        timestamp: new Date().toISOString(),
        target: this.target,
        calendarWebUrl: CALENDAR_WEB_URL,
        ...meta
      }
    };
  }

  async getAvailability({ from, to, mockEvents = null }) {
    try {
      let events = [];
      if (mockEvents) {
        events = mockEvents;
      } else {
        const rawEvents = await this.gcal.listEvents({ from, to });
        events = rawEvents.map(e => ({
          uid: e.id || e.uid,
          summary: e.summary,
          start: new Date(e.start?.dateTime || e.start),
          end: new Date(e.end?.dateTime || e.end),
          isAllDay: !!e.isAllDay,
          htmlLink: e.htmlLink || CALENDAR_WEB_URL
        }));
      }

      return this._envelope(true, 'OK', {
        from: from || null,
        to: to || null,
        calendarId: CALENDAR_ID,
        calendarUrl: this.calendarUrl,
        busyIntervals: events.map(e => ({
          uid: e.uid,
          summary: e.summary,
          start: e.start.toISOString(),
          end: e.end.toISOString(),
          isAllDay: !!e.isAllDay,
          htmlLink: e.htmlLink || CALENDAR_WEB_URL
        }))
      });
    } catch (err) {
      return this._envelope(false, 'FETCH_FAILED', null, { message: err.message });
    }
  }

  async calculateQuote(options) {
    try {
      const quote = calculateStayQuote(options);
      return this._envelope(true, 'OK', quote);
    } catch (err) {
      return this._envelope(false, 'QUOTE_ERROR', null, { message: err.message });
    }
  }

  async createReservation(data) {
    try {
      const isTest = Boolean(data.isTest || data.testMode || (typeof data.refId === 'string' && data.refId.startsWith('TEST-')));
      const refId = data.refId || (isTest ? `TEST-${Math.floor(1000 + Math.random() * 9000)}` : `CND-${Math.floor(1000 + Math.random() * 9000)}`);

      // 1. Conflict Prevention Check
      const checkInDate = parseDateTimePHT(data.checkIn, STANDARD_CHECKIN_HOUR);
      const checkOutDate = parseDateTimePHT(data.checkOut, STANDARD_CHECKOUT_HOUR);

      const avail = await this.getAvailability({ from: data.checkIn, to: data.checkOut });
      const busyEvents = (avail.data?.busyIntervals || []).map(b => ({
        start: new Date(b.start),
        end: new Date(b.end),
        summary: b.summary
      }));

      const conflictCheck = isIntervalAvailable(checkInDate, checkOutDate, busyEvents);
      if (!conflictCheck.available) {
        return this._envelope(false, 'CONFLICT_DETECTED', null, {
          message: `Dates ${data.checkIn} to ${data.checkOut} conflict with existing booking.`,
          conflicts: conflictCheck.conflicts
        });
      }

      // 2. Quote Calculation
      const quote = calculateStayQuote({
        checkIn: data.checkIn,
        checkOut: data.checkOut,
        guests: data.guests || 2,
        coveredParking: !!data.coveredParking,
        channel: data.channel || 'direct'
      });

      // 3. Create on Google Calendar
      const reservationRecord = {
        refId,
        guestName: data.guestName,
        guestEmail: data.guestEmail,
        guestPhone: data.guestPhone,
        checkIn: data.checkIn,
        checkOut: data.checkOut,
        guests: data.guests || 2,
        channel: data.channel || 'direct',
        coveredParking: !!data.coveredParking,
        plateNumber: data.plateNumber || null,
        totalPrice: quote.totalDueAtBooking,
        endorsementStatus: 'PENDING',
        caretakerReady: 0,
        lockPin: null,
        pinReleased: 0,
        bookingStatus: 'CONFIRMED',
        isTest
      };

      // In test mode without explicit live GCal, use sandbox mock event
      const useLiveGcal = Boolean(data.liveGcal || (!isTest && !this.skipGcal));
      let gcalRes;
      if (useLiveGcal) {
        gcalRes = await this.gcal.createEvent(reservationRecord);
      } else {
        gcalRes = {
          success: true,
          gcalEventId: `mock-gcal-${refId}`,
          htmlLink: CALENDAR_WEB_URL
        };
      }
      reservationRecord.gcalEventId = gcalRes.gcalEventId;
      reservationRecord.gcalLink = gcalRes.htmlLink;

      // 4. Save to local SQLite
      this.store.saveReservation(reservationRecord);

      return this._envelope(true, 'RESERVED', {
        refId,
        quote,
        reservation: reservationRecord,
        gcalEventId: gcalRes.gcalEventId,
        gcalLink: gcalRes.htmlLink,
        checkInWindow: '14:00 (2:00 PM PHT)',
        checkOutWindow: '12:00 (12:00 NN PHT)',
        calendarWebUrl: CALENDAR_WEB_URL,
        endorsementCarrd: 'https://serineasttagaytayendorsement.carrd.co/',
        isTest
      });
    } catch (err) {
      return this._envelope(false, 'RESERVATION_ERROR', null, { message: err.message });
    }
  }

  async getReservation(refId) {
    try {
      const res = this.store.getReservation(refId);
      if (!res) {
        return this._envelope(false, 'NOT_FOUND', null, { message: `Reservation ${refId} not found` });
      }

      const dep = this.store.getDeposit(refId);
      return this._envelope(true, 'OK', {
        ...res,
        deposit: dep || null,
        calendarWebUrl: CALENDAR_WEB_URL,
        endorsementCarrd: 'https://serineasttagaytayendorsement.carrd.co/'
      });
    } catch (err) {
      return this._envelope(false, 'GET_ERROR', null, { message: err.message });
    }
  }

  async listReservations({ from, to, includeCancelled = false } = {}) {
    try {
      const reservations = this.store.listReservations({ from, to, includeCancelled });
      return this._envelope(true, 'OK', {
        count: reservations.length,
        reservations,
        calendarWebUrl: CALENDAR_WEB_URL
      });
    } catch (err) {
      return this._envelope(false, 'LIST_ERROR', null, { message: err.message });
    }
  }

  async updateReservation(refId, patch) {
    try {
      const existing = this.store.getReservation(refId);
      if (!existing) {
        return this._envelope(false, 'NOT_FOUND', null, { message: `Reservation ${refId} not found` });
      }

      const merged = { ...existing, ...patch };

      // If dates changed, check conflicts
      if (patch.checkIn || patch.checkOut) {
        const checkIn = patch.checkIn || existing.checkIn;
        const checkOut = patch.checkOut || existing.checkOut;
        const checkInDate = parseDateTimePHT(checkIn, STANDARD_CHECKIN_HOUR);
        const checkOutDate = parseDateTimePHT(checkOut, STANDARD_CHECKOUT_HOUR);

        const avail = await this.getAvailability({ from: checkIn, to: checkOut });
        const otherEvents = (avail.data?.busyIntervals || [])
          .filter(b => b.uid !== existing.gcalEventId && !b.summary?.includes(refId))
          .map(b => ({
            start: new Date(b.start),
            end: new Date(b.end),
            summary: b.summary
          }));

        const conflictCheck = isIntervalAvailable(checkInDate, checkOutDate, otherEvents);
        if (!conflictCheck.available) {
          return this._envelope(false, 'CONFLICT_DETECTED', null, {
            message: `New dates ${checkIn} to ${checkOut} conflict with existing booking.`,
            conflicts: conflictCheck.conflicts
          });
        }

        // Recalculate quote
        const quote = calculateStayQuote({
          checkIn,
          checkOut,
          guests: merged.guests || 2,
          coveredParking: !!merged.coveredParking,
          channel: merged.channel || 'direct'
        });
        merged.totalPrice = quote.totalDueAtBooking;
      }

      // Update on Google Calendar
      if (existing.gcalEventId) {
        await this.gcal.updateEvent(existing.gcalEventId, merged);
      }

      // Update SQLite
      const updated = this.store.updateReservation(refId, merged);

      return this._envelope(true, 'RESERVATION_UPDATED', {
        refId,
        reservation: updated,
        calendarWebUrl: CALENDAR_WEB_URL
      });
    } catch (err) {
      return this._envelope(false, 'UPDATE_ERROR', null, { message: err.message });
    }
  }

  async cancelReservation(refId, { reason = '' } = {}) {
    try {
      const existing = this.store.getReservation(refId);
      if (!existing) {
        return this._envelope(false, 'NOT_FOUND', null, { message: `Reservation ${refId} not found` });
      }

      // 1. Delete from Google Calendar so dates immediately become available
      if (existing.gcalEventId) {
        try {
          await this.gcal.deleteEvent(existing.gcalEventId);
        } catch (gcalErr) {
          // If already deleted or not found on Google Calendar, proceed
        }
      }

      // 2. Soft-cancel in SQLite
      const cancelled = this.store.cancelReservation(refId, reason);

      return this._envelope(true, 'RESERVATION_CANCELLED', {
        refId,
        reason,
        reservation: cancelled,
        calendarWebUrl: CALENDAR_WEB_URL
      });
    } catch (err) {
      return this._envelope(false, 'CANCEL_ERROR', null, { message: err.message });
    }
  }

  async updateEndorsement(refId, endorsementData) {
    try {
      const res = this.store.getReservation(refId);
      if (!res) {
        return this._envelope(false, 'NOT_FOUND', null, { message: `Reservation ${refId} not found` });
      }

      this.store.updateEndorsement(refId, {
        status: endorsementData.status || 'SUBMITTED',
        plateNumber: endorsementData.plateNumber
      });

      return this._envelope(true, 'ENDORSED', {
        refId,
        status: endorsementData.status || 'SUBMITTED',
        plateNumber: endorsementData.plateNumber || res.plateNumber
      });
    } catch (err) {
      return this._envelope(false, 'ENDORSEMENT_ERROR', null, { message: err.message });
    }
  }

  async updateTurnover(refId, turnoverData) {
    try {
      const res = this.store.getReservation(refId);
      if (!res) {
        return this._envelope(false, 'NOT_FOUND', null, { message: `Reservation ${refId} not found` });
      }

      this.store.updateTurnover(refId, turnoverData);

      return this._envelope(true, 'TURNOVER_UPDATED', {
        refId,
        status: turnoverData.status || 'COMPLETED',
        caretakerReady: !!turnoverData.ready
      });
    } catch (err) {
      return this._envelope(false, 'TURNOVER_ERROR', null, { message: err.message });
    }
  }

  async manageDeposit(refId, { action = 'collect', amount = 3000, notes = '' }) {
    try {
      const statusMap = {
        collect: 'HELD',
        refund: 'REFUNDED',
        deduct: 'DEDUCTED'
      };
      const status = statusMap[action] || 'HELD';
      this.store.recordDeposit({
        refId,
        amount,
        status,
        notes
      });

      return this._envelope(true, 'DEPOSIT_UPDATED', {
        refId,
        action,
        status,
        amount,
        notes
      });
    } catch (err) {
      return this._envelope(false, 'DEPOSIT_ERROR', null, { message: err.message });
    }
  }

  async releaseLockPin(refId, pin = null) {
    try {
      const res = this.store.getReservation(refId);
      if (!res) {
        return this._envelope(false, 'NOT_FOUND', null, { message: `Reservation ${refId} not found` });
      }

      const dep = this.store.getDeposit(refId);
      const isDepositCleared = res.channel === 'airbnb' || (dep && dep.status === 'HELD');

      const gateEvaluation = evaluateLockPinReleaseGate({
        endorsementCleared: res.endorsementStatus === 'CLEARED',
        caretakerReady: res.caretakerReady === 1,
        depositCleared: isDepositCleared
      });

      if (!gateEvaluation.canReleasePin) {
        return this._envelope(false, 'GATE_LOCKED', null, {
          reasons: gateEvaluation.reasons,
          reservation: res
        });
      }

      const activePin = pin || res.lockPin || `${Math.floor(100000 + Math.random() * 900000)}`;
      this.store.setLockPin(refId, activePin, true);

      return this._envelope(true, 'PIN_RELEASED', {
        refId,
        lockPin: activePin,
        pinReleased: true,
        instructions: 'Enter PIN followed by # on the digital door lock keypad.'
      });
    } catch (err) {
      return this._envelope(false, 'GATE_ERROR', null, { message: err.message });
    }
  }

  async addExpense(expense) {
    try {
      const created = this.store.addExpense(expense);
      return this._envelope(true, 'EXPENSE_ADDED', created);
    } catch (err) {
      return this._envelope(false, 'EXPENSE_ERROR', null, { message: err.message });
    }
  }

  async getExpenseReport(month) {
    try {
      const report = this.store.getMonthlyExpenseReport(month);
      return this._envelope(true, 'OK', report);
    } catch (err) {
      return this._envelope(false, 'REPORT_ERROR', null, { message: err.message });
    }
  }

  async cleanupTestBookings(refId = null) {
    try {
      // Find all test reservations to delete from GCal if needed
      const testList = this.store.listReservations({ includeTest: true, includeCancelled: true })
        .filter(r => r.isTest || (typeof r.refId === 'string' && r.refId.startsWith('TEST-')));
      
      const targetList = refId ? testList.filter(r => r.refId === refId) : testList;
      for (const res of targetList) {
        if (res.gcalEventId && !res.gcalEventId.startsWith('mock-')) {
          try {
            await this.gcal.deleteEvent(res.gcalEventId);
          } catch (e) {
            // Ignore if already deleted
          }
        }
      }

      this.store.purgeTestReservations(refId);
      return this._envelope(true, 'CLEANUP_SUCCESS', {
        purgedCount: targetList.length,
        purgedRefIds: targetList.map(r => r.refId)
      });
    } catch (err) {
      return this._envelope(false, 'CLEANUP_ERROR', null, { message: err.message });
    }
  }

  async runTestBookingPipeline(options = {}) {
    const startTime = Date.now();
    const stages = [];
    const checkIn = options.checkIn || '2027-01-10';
    const checkOut = options.checkOut || '2027-01-12';
    const channel = options.channel || 'direct';
    const coveredParking = options.coveredParking !== undefined ? options.coveredParking : true;
    const liveGcal = Boolean(options.liveGcal);
    const keep = Boolean(options.keep);

    let testRefId = null;

    try {
      // Stage 1: Stay Quote Calculation
      const quoteRes = await this.calculateQuote({
        checkIn,
        checkOut,
        guests: 2,
        coveredParking,
        channel
      });
      const quotePassed = quoteRes.success && quoteRes.data?.totalDueAtBooking > 0;
      stages.push({
        stage: 1,
        name: 'QUOTE_CALCULATION',
        passed: quotePassed,
        details: `Subtotal ₱${quoteRes.data?.staySubtotal || 0}, Parking ₱${quoteRes.data?.parkingTotal || 0}, Total ₱${quoteRes.data?.totalDueAtBooking || 0}`
      });
      if (!quotePassed) throw new Error('Stage 1 Quote calculation failed');

      // Stage 2: Sandboxed Reservation Creation
      const reserveRes = await this.createReservation({
        guestName: 'Automated Test Guest',
        guestEmail: 'test.guest@example.com',
        guestPhone: '09170000000',
        checkIn,
        checkOut,
        guests: 2,
        channel,
        coveredParking,
        plateNumber: 'TEST-418',
        testMode: true,
        liveGcal
      });
      const reservePassed = reserveRes.success && reserveRes.data?.refId?.startsWith('TEST-');
      testRefId = reserveRes.data?.refId;
      stages.push({
        stage: 2,
        name: 'RESERVATION_CREATED',
        passed: reservePassed,
        details: `Created Ref: ${testRefId} (GCal Event: ${reserveRes.data?.gcalEventId})`
      });
      if (!reservePassed) throw new Error('Stage 2 Reservation creation failed');

      // Stage 3: Initial Pre-Clearance Gate Lock Check
      const preGateRes = await this.releaseLockPin(testRefId);
      const preGatePassed = !preGateRes.success && preGateRes.status === 'GATE_LOCKED';
      stages.push({
        stage: 3,
        name: 'PRE_GATE_LOCKED_CHECK',
        passed: preGatePassed,
        details: `Security gate locked as expected prior to clearance (${preGateRes.error?.reasons?.length || 0} reasons)`
      });
      if (!preGatePassed) throw new Error('Stage 3 Pre-clearance gate was unexpectedly open');

      // Stage 4: Endorsement Clearance Submission
      const endorseRes = await this.updateEndorsement(testRefId, {
        status: 'CLEARED',
        plateNumber: 'TEST-418'
      });
      const endorsePassed = endorseRes.success && endorseRes.data?.status === 'CLEARED';
      stages.push({
        stage: 4,
        name: 'ENDORSEMENT_CLEARED',
        passed: endorsePassed,
        details: `Serin East building admin endorsement marked CLEARED`
      });
      if (!endorsePassed) throw new Error('Stage 4 Endorsement update failed');

      // Stage 5: Caretaker Turnover Checklist Verification
      const turnoverRes = await this.updateTurnover(testRefId, {
        status: 'COMPLETED',
        ready: true,
        inventoryChecked: true
      });
      const turnoverPassed = turnoverRes.success && turnoverRes.data?.caretakerReady === true;
      stages.push({
        stage: 5,
        name: 'TURNOVER_COMPLETED',
        passed: turnoverPassed,
        details: `Caretaker 2-hour sanitization & inventory completed`
      });
      if (!turnoverPassed) throw new Error('Stage 5 Caretaker turnover update failed');

      // Stage 6: Security Deposit Hold Collection
      const depositRes = await this.manageDeposit(testRefId, {
        action: 'collect',
        amount: 3000,
        notes: 'Test mode simulated deposit hold'
      });
      const depositPassed = depositRes.success && depositRes.data?.status === 'HELD';
      stages.push({
        stage: 6,
        name: 'DEPOSIT_COLLECTED',
        passed: depositPassed,
        details: `Security deposit ₱${depositRes.data?.amount} held`
      });
      if (!depositPassed) throw new Error('Stage 6 Deposit collection failed');

      // Stage 7: Digital Smart Lock PIN Release Gate
      const lockRes = await this.releaseLockPin(testRefId, '418999');
      const lockPassed = lockRes.success && lockRes.status === 'PIN_RELEASED' && lockRes.data?.pinReleased === true;
      stages.push({
        stage: 7,
        name: 'LOCK_PIN_RELEASED',
        passed: lockPassed,
        details: `PIN released: ${lockRes.data?.lockPin} (Instructions: ${lockRes.data?.instructions})`
      });
      if (!lockPassed) throw new Error('Stage 7 Smart lock PIN release failed');

      // Stage 8: Auto-Cleanup (unless keep is requested)
      if (!keep) {
        const cleanRes = await this.cleanupTestBookings(testRefId);
        const cleanPassed = cleanRes.success;
        stages.push({
          stage: 8,
          name: 'SANDBOX_CLEANUP',
          passed: cleanPassed,
          details: `Purged ${testRefId} from SQLite & GCal (${cleanRes.data?.purgedCount} record)`
        });
      } else {
        stages.push({
          stage: 8,
          name: 'SANDBOX_PRESERVED',
          passed: true,
          details: `Preserved record ${testRefId} in SQLite (is_test=1) as requested by --keep`
        });
      }

      const totalDuration = Date.now() - startTime;
      return this._envelope(true, 'TEST_PIPELINE_PASSED', {
        refId: testRefId,
        stages,
        totalStages: stages.length,
        passedStages: stages.filter(s => s.passed).length,
        durationMs: totalDuration,
        liveGcal,
        keep
      });
    } catch (err) {
      if (!keep && testRefId) {
        await this.cleanupTestBookings(testRefId);
      }
      return this._envelope(false, 'TEST_PIPELINE_FAILED', {
        refId: testRefId,
        stages,
        error: err.message
      }, { message: err.message });
    }
  }
}
