import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CondoBookingClient } from '../../src/index.js';

describe('CondoBookingClient Core SDK', () => {
  it('should initialize with local mode and return standardized response envelopes', async () => {
    const client = new CondoBookingClient({ dbPath: ':memory:' });

    const quoteRes = await client.calculateQuote({
      checkIn: '2026-12-20',
      checkOut: '2026-12-22',
      guests: 4,
      coveredParking: true,
      channel: 'direct'
    });

    assert.equal(quoteRes.success, true);
    assert.equal(quoteRes.status, 'OK');
    assert.ok(quoteRes.data);
    assert.equal(quoteRes.data.parkingNights, 2);
    assert.equal(quoteRes.data.parkingTotal, 700);
    assert.equal(quoteRes.data.securityDeposit, 3000);
    assert.ok(quoteRes.meta.timestamp);
  });

  it('should create reservation and guard smart lock release', async () => {
    const client = new CondoBookingClient({ dbPath: ':memory:' });

    const createRes = await client.createReservation({
      refId: 'CND-2020',
      guestName: 'Pedro Penduko',
      checkIn: '2026-12-20',
      checkOut: '2026-12-22',
      guests: 2,
      channel: 'direct',
      coveredParking: false
    });

    assert.equal(createRes.success, true);
    assert.equal(createRes.data.refId, 'CND-2020');

    // Attempt premature lock pin release -> should fail gate
    const prematureRelease = await client.releaseLockPin('CND-2020');
    assert.equal(prematureRelease.success, false);
    assert.equal(prematureRelease.status, 'GATE_LOCKED');
    assert.ok(prematureRelease.error.reasons.length > 0);

    // Endorse guest
    await client.updateEndorsement('CND-2020', {
      status: 'CLEARED',
      idVerified: true,
      guestList: 'Pedro Penduko'
    });

    // Mark caretaker ready
    await client.updateTurnover('CND-2020', {
      ready: true,
      status: 'COMPLETED'
    });

    // Settle deposit
    await client.manageDeposit('CND-2020', {
      action: 'collect',
      amount: 3000,
      notes: 'Paid via GCash'
    });

    // Set lock PIN & release
    const releaseRes = await client.releaseLockPin('CND-2020', '582910');
    assert.equal(releaseRes.success, true);
    assert.equal(releaseRes.status, 'PIN_RELEASED');
    assert.equal(releaseRes.data.pinReleased, true);
    assert.equal(releaseRes.data.lockPin, '582910');
  });

  it('should query live calendar availability and handle date conflicts', async () => {
    const client = new CondoBookingClient({ dbPath: ':memory:' });

    const avail = await client.getAvailability({
      from: '2026-12-01',
      to: '2026-12-10',
      mockEvents: [
        {
          uid: 'test-ev-1',
          summary: 'Busy',
          start: new Date('2026-12-04T06:00:00Z'),
          end: new Date('2026-12-06T04:00:00Z')
        }
      ]
    });

    assert.equal(avail.success, true);
    assert.equal(avail.data.busyIntervals.length, 1);
  });
});
