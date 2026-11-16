/**
 * Conflict & Turnover Engine for Unit 418 Serin East Tagaytay.
 * Enforces standard 2:00 PM check-in and 12:00 NN check-out (Asia/Manila UTC+8).
 */

export const STANDARD_CHECKIN_HOUR = 14; // 2:00 PM
export const STANDARD_CHECKOUT_HOUR = 12; // 12:00 NN
export const PHT_OFFSET_HOURS = 8; // UTC+8

/**
 * Creates a Date object for a YYYY-MM-DD date and specific PHT hour.
 */
export function parseDateTimePHT(dateStr, phtHour = 0, phtMinute = 0) {
  const [y, m, d] = dateStr.split('-').map(n => parseInt(n, 10));
  // In UTC, PHT hour H is (H - 8)
  const utcHours = phtHour - PHT_OFFSET_HOURS;
  return new Date(Date.UTC(y, m - 1, d, utcHours, phtMinute, 0, 0));
}

/**
 * Checks if a requested stay interval [checkIn, checkOut] conflicts with existing calendar events.
 */
export function isIntervalAvailable(checkInDate, checkOutDate, existingEvents = []) {
  if (!(checkInDate instanceof Date) || isNaN(checkInDate.getTime())) {
    throw new Error('Invalid checkIn date');
  }
  if (!(checkOutDate instanceof Date) || isNaN(checkOutDate.getTime())) {
    throw new Error('Invalid checkOut date');
  }
  if (checkOutDate.getTime() <= checkInDate.getTime()) {
    throw new Error('checkOut must be strictly after checkIn');
  }

  const conflicts = [];
  const reqStart = checkInDate.getTime();
  const reqEnd = checkOutDate.getTime();

  for (const event of existingEvents) {
    const evStart = event.start instanceof Date ? event.start.getTime() : new Date(event.start).getTime();
    const evEnd = event.end instanceof Date ? event.end.getTime() : new Date(event.end).getTime();

    // Two intervals [A_start, A_end] and [B_start, B_end] overlap if A_start < B_end and B_start < A_end
    if (reqStart < evEnd && evStart < reqEnd) {
      conflicts.push(event);
    }
  }

  return {
    available: conflicts.length === 0,
    conflicts
  };
}

/**
 * Formats the 12:00 NN – 2:00 PM turnover window string for a specific date.
 */
export function formatTurnoverWindow(dateStr) {
  return `${dateStr} 12:00 NN – 2:00 PM PHT (Caretaker turnover & covered parking realignment)`;
}
