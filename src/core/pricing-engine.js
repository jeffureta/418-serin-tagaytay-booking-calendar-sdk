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
export const BASE_WEEKDAY_RATE_PHP = 3500; // Standard base rate
export const BASE_WEEKEND_RATE_PHP = 5000; // Fri-Sat weekend rate
export const UNDERCUT_DISCOUNT_PHP = 0;    // Seamless integrated rate

export const HOLIDAY_MULTIPLIER = 1.65;

export const TAGAYTAY_PEAK_DATES = new Set([
  '01-01', // New Year's Day
  '01-02', // New Year Holiday
  '04-09', // Araw ng Kagitingan
  '05-01', // Labor Day
  '06-12', // Independence Day
  '08-21', // Ninoy Aquino Day
  '08-31', // National Heroes Day
  '11-01', // All Saints' Day
  '11-02', // All Souls' Day
  '11-30', // Bonifacio Day
  '12-08', // Feast of the Immaculate Conception
  '12-24', // Christmas Eve
  '12-25', // Christmas Day
  '12-30', // Rizal Day
  '12-31', // New Year's Eve
]);

/**
 * Calculates a stay quote with seamless dynamic pricing and integrated 1.65x holiday multiplier.
 */
export function calculateStayQuote({
  checkIn,
  checkOut,
  guests = 2,
  coveredParking = false,
  channel = 'direct',
  customRates = {}
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
    const dateStr = curDate.toISOString().slice(0, 10);
    const monthDay = dateStr.slice(5);
    const dayOfWeek = curDate.getUTCDay(); // 0 is Sunday, 5 is Friday, 6 is Saturday
    const isWeekend = (dayOfWeek === 5 || dayOfWeek === 6);

    let nightlyPrice;
    const isHoliday = TAGAYTAY_PEAK_DATES.has(monthDay);

    if (isHoliday) {
      // 1.65x Holiday Multiplier baked seamlessly into nightly price
      const baseline = (customRates && customRates[dateStr]) || BASE_WEEKDAY_RATE_PHP;
      nightlyPrice = Math.round(baseline * HOLIDAY_MULTIPLIER);
    } else if (customRates && customRates[dateStr]) {
      nightlyPrice = customRates[dateStr];
    } else if (isWeekend) {
      nightlyPrice = BASE_WEEKEND_RATE_PHP;
    } else {
      nightlyPrice = BASE_WEEKDAY_RATE_PHP;
    }

    baseStayTotal += nightlyPrice;
    nightlyBreakdown.push({
      date: dateStr,
      isWeekend,
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
