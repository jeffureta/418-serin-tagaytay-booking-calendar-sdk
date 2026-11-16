import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateStayQuote,
  COVERED_PARKING_NIGHTLY_PHP,
  STANDARD_REFUNDABLE_DEPOSIT_PHP
} from '../../src/core/pricing-engine.js';

describe('Pricing & Deposit Engine', () => {
  it('should calculate base stay quote for weekdays and weekend nights', () => {
    // 2026-12-14 (Mon) to 2026-12-16 (Wed) = 2 weekday nights
    const quote = calculateStayQuote({
      checkIn: '2026-12-14',
      checkOut: '2026-12-16',
      guests: 2,
      coveredParking: false,
      channel: 'direct'
    });

    assert.equal(quote.nights, 2);
    assert.ok(quote.baseStayTotal > 0);
    assert.equal(quote.parkingNights, 0);
    assert.equal(quote.parkingTotal, 0);
    assert.equal(quote.securityDeposit, STANDARD_REFUNDABLE_DEPOSIT_PHP); // 3,000 for direct
    assert.equal(quote.depositPolicy, 'REFUNDABLE_CASH_DEPOSIT');
  });

  it('should include ₱350/night covered parking when requested', () => {
    const quote = calculateStayQuote({
      checkIn: '2026-12-14',
      checkOut: '2026-12-16',
      guests: 4,
      coveredParking: true,
      channel: 'agoda'
    });

    assert.equal(quote.nights, 2);
    assert.equal(quote.parkingNights, 2);
    assert.equal(quote.parkingTotal, 2 * COVERED_PARKING_NIGHTLY_PHP); // 700
    assert.equal(quote.securityDeposit, 3000);
    assert.equal(quote.totalDueAtBooking, quote.baseStayTotal + quote.parkingTotal);
  });

  it('should waive upfront cash deposit for Airbnb bookings under AirCover', () => {
    const quote = calculateStayQuote({
      checkIn: '2026-12-18',
      checkOut: '2026-12-20',
      guests: 3,
      coveredParking: false,
      channel: 'airbnb'
    });

    assert.equal(quote.securityDeposit, 0);
    assert.equal(quote.depositPolicy, 'AIRCOVER_PROTECTED');
  });

  it('should support extra guest surcharge beyond 4 pax standard limit', () => {
    const quote = calculateStayQuote({
      checkIn: '2026-12-14',
      checkOut: '2026-12-15',
      guests: 5,
      coveredParking: false,
      channel: 'direct'
    });

    assert.ok(quote.extraGuestFee > 0);
  });
});
