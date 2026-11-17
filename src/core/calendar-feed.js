/**
 * Core Google Calendar iCal (.ics) parser and fetcher.
 * 100% cost-free, zero external npm dependencies.
 */

export const DEFAULT_CALENDAR_ID = '5e250418f97d2008bff93cc10a638b2aabe981af2d5e271b058eb8835dde2ae2@group.calendar.google.com';
export const DEFAULT_ICAL_URL = `https://calendar.google.com/calendar/ical/${encodeURIComponent(DEFAULT_CALENDAR_ID)}/public/basic.ics`;

/**
 * Unfolds iCal text per RFC 5545 (lines split with CRLF followed by a single space or tab).
 */
export function unfoldICal(icsText) {
  return icsText.replace(/\r\n[ \t]|\r[ \t]|\n[ \t]/g, '');
}

/**
 * Parses iCal date string (e.g. 20261110T070000Z or 20261220).
 */
export function parseICalDate(dateStr) {
  if (!dateStr) return null;
  const clean = dateStr.trim();
  if (/^\d{8}$/.test(clean)) {
    const y = parseInt(clean.slice(0, 4), 10);
    const m = parseInt(clean.slice(4, 6), 10) - 1;
    const d = parseInt(clean.slice(6, 8), 10);
    return { date: new Date(Date.UTC(y, m, d, 0, 0, 0)), isAllDay: true };
  }
  const match = clean.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (match) {
    const [, y, mo, d, h, mi, s, isUtc] = match;
    if (isUtc) {
      return {
        date: new Date(Date.UTC(parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10), parseInt(h, 10), parseInt(mi, 10), parseInt(s, 10))),
        isAllDay: false
      };
    }
    return {
      date: new Date(parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10), parseInt(h, 10), parseInt(mi, 10), parseInt(s, 10)),
      isAllDay: false
    };
  }
  return { date: new Date(clean), isAllDay: false };
}

/**
 * Parses iCal string into an array of structured event objects.
 */
export function parseICalContent(icsText, options = {}) {
  const unfolded = unfoldICal(icsText);
  const lines = unfolded.split(/\r?\n/);
  const events = [];
  let inEvent = false;
  let currentEvent = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT') {
      inEvent = true;
      currentEvent = {};
      continue;
    }
    if (trimmed === 'END:VEVENT') {
      if (inEvent && currentEvent.start) {
        if (!currentEvent.end) {
          // If no DTEND, default to start + 1 day for all-day or start + 1 hour
          currentEvent.end = new Date(currentEvent.start.getTime() + (currentEvent.isAllDay ? 86400000 : 3600000));
        }
        events.push(currentEvent);
      }
      inEvent = false;
      currentEvent = {};
      continue;
    }

    if (!inEvent) continue;

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;

    const rawKey = trimmed.slice(0, colonIndex);
    const value = trimmed.slice(colonIndex + 1);
    const [key, ...params] = rawKey.split(';');

    switch (key.toUpperCase()) {
      case 'UID':
        currentEvent.uid = value;
        break;
      case 'SUMMARY':
        currentEvent.summary = value;
        break;
      case 'DTSTART': {
        const parsed = parseICalDate(value);
        currentEvent.start = parsed.date;
        currentEvent.isAllDay = parsed.isAllDay || params.some(p => p.toUpperCase() === 'VALUE=DATE');
        break;
      }
      case 'DTEND': {
        const parsed = parseICalDate(value);
        currentEvent.end = parsed.date;
        break;
      }
      case 'DESCRIPTION':
        currentEvent.description = value;
        break;
      case 'STATUS':
        currentEvent.status = value;
        break;
    }
  }

  // Filter by options.from and options.to if provided
  let filtered = events;
  if (options.from) {
    const fromTime = new Date(options.from).getTime();
    filtered = filtered.filter(e => e.end.getTime() >= fromTime);
  }
  if (options.to) {
    const toTime = new Date(options.to).getTime();
    filtered = filtered.filter(e => e.start.getTime() <= toTime);
  }

  return filtered;
}

/**
 * Fetches the public Google Calendar iCal feed and parses it.
 */
export async function fetchAndParseCalendar(url = DEFAULT_ICAL_URL, options = {}) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': '418-serin-tagaytay-booking-calendar-sdk/1.0'
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch calendar iCal feed (HTTP ${response.status}): ${response.statusText}`);
  }
  const icsText = await response.text();
  return parseICalContent(icsText, options);
}
