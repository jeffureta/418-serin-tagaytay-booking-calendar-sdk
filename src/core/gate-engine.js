/**
 * Endorsement Clearance Gate & Smart Lock Workflow Engine.
 * Enforces pre-arrival Carrd submission checks and conditional PIN release.
 */

export const SERIN_ENDORSEMENT_CARRD_URL = 'https://serineasttagaytayendorsement.carrd.co/';

/**
 * Validates endorsement submission payload against building admin requirements.
 */
export function validateEndorsementPayload(payload = {}, options = {}) {
  const missingFields = [];

  if (!payload.primaryGuestName || !payload.primaryGuestName.trim()) {
    missingFields.push('primaryGuestName');
  }
  if (!payload.primaryGuestIdUrl || !payload.primaryGuestIdUrl.trim()) {
    missingFields.push('primaryGuestIdUrl');
  }
  if (!Array.isArray(payload.guestNames) || payload.guestNames.length === 0) {
    missingFields.push('guestNames');
  }
  if (!payload.contactPhone || !payload.contactPhone.trim()) {
    missingFields.push('contactPhone');
  }

  if (options.coveredParking) {
    if (!payload.plateNumber || !payload.plateNumber.trim()) {
      missingFields.push('plateNumber');
    }
  }

  return {
    valid: missingFields.length === 0,
    missingFields,
    carrdUrl: SERIN_ENDORSEMENT_CARRD_URL
  };
}

/**
 * Evaluates whether a smart lock PIN is cleared for dispatch to the guest.
 */
export function evaluateLockPinReleaseGate(reservation = {}) {
  const reasons = [];

  if (!reservation.endorsementCleared) {
    reasons.push('Endorsement not submitted via Serin Carrd or pending admin approval');
  }

  if (!reservation.caretakerReady) {
    reasons.push('Caretaker turnover not ready (unit cleaning / inspection in progress)');
  }

  if (reservation.depositCleared === false) {
    reasons.push('Refundable security deposit (₱3,000) not settled');
  }

  return {
    canReleasePin: reasons.length === 0,
    reasons
  };
}
