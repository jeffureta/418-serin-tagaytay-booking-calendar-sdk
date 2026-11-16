import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateLockPinReleaseGate,
  validateEndorsementPayload
} from '../../src/core/gate-engine.js';

describe('Endorsement & Smart Lock Gate Engine', () => {
  it('should validate complete endorsement submission payload', () => {
    const validPayload = {
      primaryGuestName: 'Juan Dela Cruz',
      primaryGuestIdUrl: 'https://storage.googleapis.com/test-id.jpg',
      guestNames: ['Juan Dela Cruz', 'Maria Dela Cruz'],
      contactPhone: '+639171234567',
      plateNumber: 'NBT-1234'
    };

    const res = validateEndorsementPayload(validPayload, { coveredParking: true });
    assert.equal(res.valid, true);
    assert.equal(res.missingFields.length, 0);
  });

  it('should flag missing plate number when covered parking is requested', () => {
    const missingPlate = {
      primaryGuestName: 'Juan Dela Cruz',
      primaryGuestIdUrl: 'https://storage.googleapis.com/test-id.jpg',
      guestNames: ['Juan Dela Cruz'],
      contactPhone: '+639171234567'
    };

    const res = validateEndorsementPayload(missingPlate, { coveredParking: true });
    assert.equal(res.valid, false);
    assert.ok(res.missingFields.includes('plateNumber'));
  });

  it('should block smart lock PIN release if endorsement is not submitted', () => {
    const reservation = {
      refId: 'CND-4821',
      endorsementCleared: false,
      caretakerReady: true,
      depositCleared: true
    };

    const evaluation = evaluateLockPinReleaseGate(reservation);
    assert.equal(evaluation.canReleasePin, false);
    assert.ok(evaluation.reasons.some(r => r.includes('Endorsement not submitted')));
  });

  it('should block smart lock PIN release if caretaker unit turnover is not ready', () => {
    const reservation = {
      refId: 'CND-4821',
      endorsementCleared: true,
      caretakerReady: false,
      depositCleared: true
    };

    const evaluation = evaluateLockPinReleaseGate(reservation);
    assert.equal(evaluation.canReleasePin, false);
    assert.ok(evaluation.reasons.some(r => r.includes('Caretaker turnover not ready')));
  });

  it('should permit smart lock PIN release when all gates pass', () => {
    const reservation = {
      refId: 'CND-4821',
      endorsementCleared: true,
      caretakerReady: true,
      depositCleared: true
    };

    const evaluation = evaluateLockPinReleaseGate(reservation);
    assert.equal(evaluation.canReleasePin, true);
    assert.equal(evaluation.reasons.length, 0);
  });
});
