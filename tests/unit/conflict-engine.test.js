import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDateTimePHT,
  isIntervalAvailable,
  formatTurnoverWindow,
  STANDARD_CHECKIN_HOUR,
  STANDARD_CHECKOUT_HOUR
} from '../../src/core/conflict-engine.js';

describe('Conflict & Turnover Engine', () => {
  it('should parse checkin at 14:00 (2:00 PM) and checkout at 12:00 (12:00 NN) PHT', () => {
    const checkIn = parseDateTimePHT('2026-12-20', STANDARD_CHECKIN_HOUR);
    const checkOut = parseDateTimePHT('2026-12-22', STANDARD_CHECKOUT_HOUR);

    assert.equal(checkIn.toISOString(), '2026-12-20T06:00:00.000Z'); // 14:00 PHT = 06:00 UTC
    assert.equal(checkOut.toISOString(), '2026-12-22T04:00:00.000Z'); // 12:00 PHT = 04:00 UTC
  });

  it('should allow same-day turnover (Guest A checks out 12NN, Guest B checks in 2PM)', () => {
    const existingEvents = [
      {
        uid: 'res-a',
        summary: 'Guest A',
        start: new Date('2026-12-18T06:00:00.000Z'), // 14:00 PHT
        end: new Date('2026-12-20T04:00:00.000Z')   // 12:00 PHT
      }
    ];

    const requestedCheckIn = parseDateTimePHT('2026-12-20', STANDARD_CHECKIN_HOUR); // 14:00 PHT
    const requestedCheckOut = parseDateTimePHT('2026-12-22', STANDARD_CHECKOUT_HOUR); // 12:00 PHT

    const result = isIntervalAvailable(requestedCheckIn, requestedCheckOut, existingEvents);
    assert.equal(result.available, true);
    assert.equal(result.conflicts.length, 0);
  });

  it('should detect conflict when requested stay overlaps with existing stay', () => {
    const existingEvents = [
      {
        uid: 'res-busy',
        summary: 'Occupied',
        start: new Date('2026-12-20T06:00:00.000Z'),
        end: new Date('2026-12-23T04:00:00.000Z')
      }
    ];

    const requestedCheckIn = parseDateTimePHT('2026-12-21', STANDARD_CHECKIN_HOUR);
    const requestedCheckOut = parseDateTimePHT('2026-12-24', STANDARD_CHECKOUT_HOUR);

    const result = isIntervalAvailable(requestedCheckIn, requestedCheckOut, existingEvents);
    assert.equal(result.available, false);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].uid, 'res-busy');
  });

  it('should format human turnover window string', () => {
    const str = formatTurnoverWindow('2026-12-20');
    assert.equal(str, '2026-12-20 12:00 NN – 2:00 PM PHT (Caretaker turnover & covered parking realignment)');
  });
});
