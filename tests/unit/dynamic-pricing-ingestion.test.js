import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CondoBookingCalendar } from '../../src/ui/booking-calendar-component.js';
import { calculateStayQuote } from '../../src/core/pricing-engine.js';
import { CondoBookingApi } from '../../src/api/condo-booking-api.js';

test('Dynamic Pricing Ingestion & Seamless Holiday Multiplier', async (t) => {
  await t.test('1. calculateStayQuote should seamlessly apply 1.65x multiplier to holiday dates without exposing multiplier labels', () => {
    // 2026-12-25 is Christmas Day (Holiday)
    // 2026-12-27 is Sunday (Weekend in pricing-engine)
    const quote = calculateStayQuote({
      checkIn: '2026-12-25',
      checkOut: '2026-12-27', // 2 nights
      guests: 2
    });

    assert.ok(quote);
    const dec25 = quote.nightlyBreakdown.find(n => n.date === '2026-12-25');
    assert.ok(dec25);
    // Base weekday/standard is 3500 (or benchmark 3500) * 1.65 = 5775
    assert.equal(dec25.rate, Math.round(3500 * 1.65));
    // Verify no multiplier or surge terminology is present in guest-facing fields
    assert.equal(dec25.multiplier, undefined);
    assert.equal(dec25.surge, undefined);
  });

  await t.test('2. calculateStayQuote should scale scraped customRates by 1.65x on holidays and use raw customRates on non-holidays', () => {
    const customRates = {
      '2026-12-25': 4000, // Scraped baseline on Christmas
      '2026-12-28': 3200  // Scraped baseline on regular Monday
    };

    const quote = calculateStayQuote({
      checkIn: '2026-12-25',
      checkOut: '2026-12-29',
      guests: 2,
      customRates
    });

    assert.ok(quote);
    const dec25 = quote.nightlyBreakdown.find(n => n.date === '2026-12-25');
    const dec28 = quote.nightlyBreakdown.find(n => n.date === '2026-12-28');

    // Dec 25: 4000 * 1.65 = 6600
    assert.equal(dec25.rate, 6600);
    // Dec 28: raw scraped rate 3200
    assert.equal(dec28.rate, 3200);
  });

  await t.test('3. CondoBookingCalendar Web Component should compute seamless all-inclusive rate via getDateRate()', () => {
    const comp = new CondoBookingCalendar();
    
    // Default base is 3500
    // Christmas Day: 3500 * 1.65 = 5775
    const christmasRate = comp.getDateRate('2026-12-25');
    assert.equal(christmasRate, 5775);

    // Regular weekday (e.g. Wednesday 2026-11-18): 3500
    const weekdayRate = comp.getDateRate('2026-11-18');
    assert.equal(weekdayRate, 3500);

    // Regular weekend (e.g. Saturday 2026-11-21): 5000
    const weekendRate = comp.getDateRate('2026-11-21');
    assert.equal(weekendRate, 5000);

    // Inject scraped customRates
    comp.customRates = {
      '2026-12-25': 4200, // 4200 * 1.65 = 6930
      '2026-11-18': 3100  // Scraped weekday overrides 3500 -> 3100
    };

    assert.equal(comp.getDateRate('2026-12-25'), 6930);
    assert.equal(comp.getDateRate('2026-11-18'), 3100);
  });

  await t.test('4. CondoBookingApi should support setCustomRates and quote calculation with custom rates', async () => {
    const api = new CondoBookingApi();
    api.setCustomRates({
      '2026-12-25': 4000,
      '2026-12-28': 3300
    });

    const quote = await api.calculateQuote({
      checkIn: '2026-12-25',
      checkOut: '2026-12-29',
      guests: 2
    });

    assert.ok(quote.success);
    const dec25 = quote.data.nightlyBreakdown.find(n => n.date === '2026-12-25');
    const dec28 = quote.data.nightlyBreakdown.find(n => n.date === '2026-12-28');
    assert.equal(dec25.rate, 6600);
    assert.equal(dec28.rate, 3300);
  });
});
