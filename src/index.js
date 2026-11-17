/**
 * 418-serin-tagaytay-booking-calendar-sdk Core SDK Client
 * Exports CondoBookingClient adhering to the standard { success, status, data, error, meta } envelope.
 */

import { fetchAndParseCalendar, DEFAULT_ICAL_URL } from './core/calendar-feed.js';
import { isIntervalAvailable, parseDateTimePHT, STANDARD_CHECKIN_HOUR, STANDARD_CHECKOUT_HOUR } from './core/conflict-engine.js';
import { calculateStayQuote } from './core/pricing-engine.js';
import { evaluateLockPinReleaseGate, validateEndorsementPayload } from './core/gate-engine.js';
import { CondoOpsStore } from './store/sqlite-store.js';

export class CondoBookingClient {
  constructor(options = {}) {
    this.target = options.target || 'local';
    this.dbPath = options.dbPath || 'data/condo_ops.db';
    this.calendarUrl = options.calendarUrl || DEFAULT_ICAL_URL;
    this.store = new CondoOpsStore(this.dbPath);
    this.store.initSchema();
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
        events = await fetchAndParseCalendar(this.calendarUrl, { from, to });
      }

      return this._envelope(true, 'OK', {
        from: from || null,
        to: to || null,
        calendarUrl: this.calendarUrl,
        busyIntervals: events.map(e => ({
          uid: e.uid,
          summary: e.summary,
          start: e.start.toISOString(),
          end: e.end.toISOString(),
          isAllDay: !!e.isAllDay
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
      const refId = data.refId || `CND-${Math.floor(1000 + Math.random() * 9000)}`;
      const quote = calculateStayQuote({
        checkIn: data.checkIn,
        checkOut: data.checkOut,
        guests: data.guests || 2,
        coveredParking: !!data.coveredParking,
        channel: data.channel || 'direct'
      });

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
        pinReleased: 0
      };

      this.store.saveReservation(reservationRecord);

      return this._envelope(true, 'RESERVED', {
        refId,
        quote,
        reservation: reservationRecord,
        checkInWindow: '14:00 (2:00 PM PHT)',
        checkOutWindow: '12:00 (12:00 NN PHT)',
        endorsementCarrd: 'https://serineasttagaytayendorsement.carrd.co/'
      });
    } catch (err) {
      return this._envelope(false, 'RESERVATION_ERROR', null, { message: err.message });
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
}
