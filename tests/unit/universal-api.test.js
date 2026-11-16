import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CondoBookingApi } from '../../src/api/condo-booking-api.js';

describe('Universal CondoBookingApi Test Suite', () => {
  const api = new CondoBookingApi({ dbPath: ':memory:' });

  it('1. should calculate quote with parking add-on and bounds check', async () => {
    const res = await api.calculateQuote({
      checkIn: '2026-12-10',
      checkOut: '2026-12-12',
      guests: 2,
      coveredParking: true,
      channel: 'direct'
    });

    assert.equal(res.success, true);
    assert.equal(res.data.nights, 2);
    assert.equal(res.data.parkingTotal, 700);
    assert.equal(res.data.securityDeposit, 3000);
  });

  it('2. should create reservation in local memory and retrieve it', async () => {
    const createRes = await api.createReservation({
      refId: 'CND-TEST-101',
      guestName: 'Maria Clara',
      guestEmail: 'maria@example.com',
      checkIn: '2026-12-15',
      checkOut: '2026-12-17',
      guests: 3,
      coveredParking: true,
      plateNumber: 'NBT-8899'
    });

    assert.equal(createRes.success, true);
    assert.equal(createRes.data.refId, 'CND-TEST-101');

    const lookupRes = await api.lookupReservation('CND-TEST-101');
    assert.equal(lookupRes.success, true);
    assert.equal(lookupRes.data.guestName, 'Maria Clara');
    assert.equal(lookupRes.data.plateNumber, 'NBT-8899');
  });

  it('3. should enforce safety gates before smart lock pin release', async () => {
    // Attempt release before endorsement and turnover
    const earlyRelease = await api.releaseLockPin('CND-TEST-101');
    assert.equal(earlyRelease.success, false);
    assert.equal(earlyRelease.status, 'GATE_LOCKED');

    // Submit endorsement
    const endorseRes = await api.submitEndorsement('CND-TEST-101', {
      vehiclePlate: 'NBT-8899'
    });
    assert.equal(endorseRes.success, true);

    // Update turnover and deposit
    api.store.updateTurnover('CND-TEST-101', { ready: true, status: 'COMPLETED' });
    api.store.recordDeposit({ refId: 'CND-TEST-101', status: 'HELD', amount: 3000 });

    // Now gate check passes
    const gateCheck = await api.verifyLockGate('CND-TEST-101');
    assert.equal(gateCheck.success, true);
    assert.equal(gateCheck.status, 'GATE_OPEN');

    // Release pin
    const pinRes = await api.releaseLockPin('CND-TEST-101', '654321');
    assert.equal(pinRes.success, true);
    assert.equal(pinRes.data.lockPin, '654321');
  });

  it('4. should serve curated house rules and FAQ', async () => {
    const faq = await api.getHouseRulesAndFaq();
    assert.equal(faq.success, true);
    assert.equal(faq.data.property, 'Unit 418 Serin East Tagaytay');
    assert.equal(faq.data.wifi.ssid, 'Serin418_Guest_5G');
  });

  it('5. should quote late checkout fee based on turnover availability', async () => {
    const lateQuote = await api.requestLateCheckoutQuote('CND-TEST-101', 2);
    assert.equal(lateQuote.success, true);
    assert.equal(lateQuote.data.requestedHours, 2);
    assert.equal(lateQuote.data.totalExtensionFee, 600);
    assert.equal(lateQuote.data.extendedCheckOutTime, '14:00 PHT');
  });
});
