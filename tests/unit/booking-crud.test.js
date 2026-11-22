import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CondoBookingClient } from '../../src/index.js';

describe('Dual-Store CRUD & Conflict Prevention Unit Tests', () => {
  function createMockClient() {
    const memoryEvents = [];
    return new CondoBookingClient({
      dbPath: ':memory:',
      gcalAdapter: {
        listEvents: async () => memoryEvents,
        findEventByRef: async (refId) => memoryEvents.find(e => e.refId === refId) || null,
        createEvent: async (res) => {
          const ev = {
            id: `gcal-${res.refId}`,
            refId: res.refId,
            summary: res.guestName,
            start: { dateTime: `${res.checkIn}T14:00:00+08:00` },
            end: { dateTime: `${res.checkOut}T12:00:00+08:00` },
            htmlLink: `https://calendar.google.com/event?eid=gcal-${res.refId}`
          };
          memoryEvents.push(ev);
          return {
            success: true,
            gcalEventId: ev.id,
            htmlLink: ev.htmlLink
          };
        },
        updateEvent: async (eventId, res) => {
          const idx = memoryEvents.findIndex(e => e.id === eventId);
          if (idx !== -1) {
            memoryEvents[idx].start = { dateTime: `${res.checkIn}T14:00:00+08:00` };
            memoryEvents[idx].end = { dateTime: `${res.checkOut}T12:00:00+08:00` };
          }
          return { success: true };
        },
        deleteEvent: async (eventId) => {
          const idx = memoryEvents.findIndex(e => e.id === eventId);
          if (idx !== -1) memoryEvents.splice(idx, 1);
          return { success: true };
        }
      }
    });
  }

  it('should create reservation and persist to both GCal and SQLite', async () => {
    const client = createMockClient();

    const res = await client.createReservation({
      refId: 'CND-1001',
      guestName: 'Ana Gomez',
      checkIn: '2026-12-20',
      checkOut: '2026-12-22',
      guests: 2,
      channel: 'direct'
    });

    assert.equal(res.success, true);
    assert.equal(res.status, 'RESERVED');
    assert.equal(res.data.refId, 'CND-1001');
    assert.equal(res.data.gcalEventId, 'gcal-CND-1001');
    assert.ok(res.data.gcalLink);

    // Verify retrieval from SQLite
    const retrieved = await client.getReservation('CND-1001');
    assert.equal(retrieved.success, true);
    assert.equal(retrieved.data.guestName, 'Ana Gomez');
    assert.equal(retrieved.data.bookingStatus, 'CONFIRMED');
  });

  it('should allow same-day turnover without conflict (12:00 NN checkout vs 2:00 PM checkin)', async () => {
    const client = createMockClient();

    // Booking 1: Dec 20 to Dec 22
    const res1 = await client.createReservation({
      refId: 'CND-1001',
      guestName: 'Guest One',
      checkIn: '2026-12-20',
      checkOut: '2026-12-22'
    });
    assert.equal(res1.success, true);

    // Booking 2: Dec 22 to Dec 24 (Same day turnover!)
    const res2 = await client.createReservation({
      refId: 'CND-1002',
      guestName: 'Guest Two',
      checkIn: '2026-12-22',
      checkOut: '2026-12-24'
    });
    assert.equal(res2.success, true);
  });

  it('should prevent overlapping reservation with CONFLICT_DETECTED', async () => {
    const client = createMockClient();

    await client.createReservation({
      refId: 'CND-1001',
      guestName: 'Guest One',
      checkIn: '2026-12-20',
      checkOut: '2026-12-23'
    });

    // Overlapping booking: Dec 21 to Dec 24
    const overlap = await client.createReservation({
      refId: 'CND-1002',
      guestName: 'Overlap Guest',
      checkIn: '2026-12-21',
      checkOut: '2026-12-24'
    });

    assert.equal(overlap.success, false);
    assert.equal(overlap.status, 'CONFLICT_DETECTED');
  });

  it('should update reservation dates and reschedule on GCal + SQLite', async () => {
    const client = createMockClient();

    await client.createReservation({
      refId: 'CND-1001',
      guestName: 'Guest One',
      checkIn: '2026-12-20',
      checkOut: '2026-12-22'
    });

    const updateRes = await client.updateReservation('CND-1001', {
      checkOut: '2026-12-23',
      guests: 4
    });

    assert.equal(updateRes.success, true);
    assert.equal(updateRes.status, 'RESERVATION_UPDATED');
    assert.equal(updateRes.data.reservation.checkOut, '2026-12-23');
    assert.equal(updateRes.data.reservation.guests, 4);
  });

  it('should cancel reservation: delete from GCal and soft-cancel in SQLite', async () => {
    const client = createMockClient();

    await client.createReservation({
      refId: 'CND-1001',
      guestName: 'Guest One',
      checkIn: '2026-12-20',
      checkOut: '2026-12-22'
    });

    const cancelRes = await client.cancelReservation('CND-1001', { reason: 'Guest emergency' });
    assert.equal(cancelRes.success, true);
    assert.equal(cancelRes.status, 'RESERVATION_CANCELLED');

    // Confirm SQLite reflects CANCELLED
    const retrieved = await client.getReservation('CND-1001');
    assert.equal(retrieved.data.bookingStatus, 'CANCELLED');
    assert.equal(retrieved.data.cancelReason, 'Guest emergency');

    // Confirm slot is now free for another booking on exact same dates
    const rebook = await client.createReservation({
      refId: 'CND-1002',
      guestName: 'New Guest',
      checkIn: '2026-12-20',
      checkOut: '2026-12-22'
    });
    assert.equal(rebook.success, true);
  });
});
