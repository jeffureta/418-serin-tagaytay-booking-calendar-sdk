/**
 * Deterministic Dynamic Pricing & Deposit Engine for Unit 418 Serin East Tagaytay.
 * Enforces dynamic undercut (-₱500/night vs Tagaytay benchmark), ₱350/night covered parking,
 * and channel-specific deposit policies.
 */

export const COVERED_PARKING_NIGHTLY_PHP = 350;
export const STANDARD_REFUNDABLE_DEPOSIT_PHP = 3000;
export const STANDARD_GUEST_LIMIT = 4;
export const EXTRA_GUEST_FEE_PHP = 500;
export const CLEANING_FEE_PHP = 800;

// Benchmark Tagaytay base rates
export const BASE_WEEKDAY_RATE_PHP = 3200; // Mon-Thu
export const BASE_WEEKEND_RATE_PHP = 4000; // Fri-Sun
export const UNDERCUT_DISCOUNT_PHP = 500;  // Direct discount

/**
 * Calculates a stay quote.
 */
export function calculateStayQuote({
  checkIn,
  checkOut,
  guests = 2,
  coveredParking = false,
  channel = 'direct'
}) {
  const inDate = new Date(`${checkIn}T00:00:00Z`);
  const outDate = new Date(`${checkOut}T00:00:00Z`);

  if (isNaN(inDate.getTime()) || isNaN(outDate.getTime())) {
    throw new Error('Invalid checkIn or checkOut date format (YYYY-MM-DD expected)');
  }

  const diffMs = outDate.getTime() - inDate.getTime();
  const nights = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (nights <= 0) {
    throw new Error('Stay must be at least 1 night');
  }

  let baseStayTotal = 0;
  const nightlyBreakdown = [];

  for (let i = 0; i < nights; i++) {
    const curDate = new Date(inDate.getTime() + i * 24 * 60 * 60 * 1000);
    const dayOfWeek = curDate.getUTCDay(); // 0 is Sunday, 5 is Friday, 6 is Saturday
    const isWeekend = (dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0);
    const benchmark = isWeekend ? BASE_WEEKEND_RATE_PHP : BASE_WEEKDAY_RATE_PHP;
    const nightlyPrice = Math.max(2000, benchmark - UNDERCUT_DISCOUNT_PHP);

    baseStayTotal += nightlyPrice;
    nightlyBreakdown.push({
      date: curDate.toISOString().slice(0, 10),
      isWeekend,
      benchmark,
      undercut: UNDERCUT_DISCOUNT_PHP,
      rate: nightlyPrice
    });
  }

  const extraGuests = Math.max(0, guests - STANDARD_GUEST_LIMIT);
  const extraGuestFee = extraGuests * EXTRA_GUEST_FEE_PHP * nights;

  const parkingNights = coveredParking ? nights : 0;
  const parkingTotal = parkingNights * COVERED_PARKING_NIGHTLY_PHP;

  let securityDeposit = 0;
  let depositPolicy = 'NOT_APPLICABLE';

  const ch = channel.toLowerCase();
  if (ch === 'airbnb') {
    securityDeposit = 0;
    depositPolicy = 'AIRCOVER_PROTECTED';
  } else if (ch === 'booking_com') {
    securityDeposit = 0;
    depositPolicy = 'BOOKING_COM_POLICY';
  } else {
    // direct, agoda, facebook
    securityDeposit = STANDARD_REFUNDABLE_DEPOSIT_PHP;
    depositPolicy = 'REFUNDABLE_CASH_DEPOSIT';
  }

  const totalDueAtBooking = baseStayTotal + extraGuestFee + parkingTotal;

  return {
    checkIn,
    checkOut,
    nights,
    guests,
    channel,
    baseStayTotal,
    extraGuestFee,
    cleaningFee: CLEANING_FEE_PHP,
    parkingNights,
    parkingRate: COVERED_PARKING_NIGHTLY_PHP,
    parkingTotal,
    securityDeposit,
    depositPolicy,
    totalDueAtBooking,
    nightlyBreakdown
  };
}
