import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseICalContent, fetchAndParseCalendar } from '../../src/core/calendar-feed.js';

describe('iCal Calendar Feed Parser', () => {
  const sampleIcs = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
CALSCALE:GREGORIAN
X-WR-CALNAME:418 Serin Tagaytay Bookings
X-WR-TIMEZONE:Europe/London
BEGIN:VEVENT
DTSTART:20261110T070000Z
DTEND:20261111T030000Z
DTSTAMP:20261114T123819Z
UID:u3pmsba5kcl9ct8vf7vu6gh7i0@google.com
SUMMARY:Reserved - Juan Dela Cruz
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261220
DTEND;VALUE=DATE:20261223
UID:event-date-only-123@google.com
SUMMARY:Busy
END:VEVENT
END:VCALENDAR`;

  it('should parse VEVENT entries into structured busy intervals', () => {
    const events = parseICalContent(sampleIcs);
    assert.equal(events.length, 2);

    const first = events[0];
    assert.equal(first.uid, 'u3pmsba5kcl9ct8vf7vu6gh7i0@google.com');
    assert.equal(first.summary, 'Reserved - Juan Dela Cruz');
    assert.ok(first.start instanceof Date);
    assert.ok(first.end instanceof Date);
    assert.equal(first.start.toISOString(), '2026-11-10T07:00:00.000Z');
    assert.equal(first.end.toISOString(), '2026-11-11T03:00:00.000Z');

    const second = events[1];
    assert.equal(second.summary, 'Busy');
    assert.ok(second.isAllDay);
  });

  it('should handle unfolded long lines and carriage returns', () => {
    const icsWithFolding = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:long-uid-fold-test@google.com
SUMMARY:Very long summary line that was folded\r\n  by Google Calendar export
DTSTART:20261225T060000Z
DTEND:20261227T040000Z
END:VEVENT
END:VCALENDAR`;

    const events = parseICalContent(icsWithFolding);
    assert.equal(events.length, 1);
    assert.equal(events[0].summary, 'Very long summary line that was folded by Google Calendar export');
  });

  it('should filter events within a requested date range', () => {
    const events = parseICalContent(sampleIcs, {
      from: '2026-12-01',
      to: '2026-12-31'
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].uid, 'event-date-only-123@google.com');
  });
});
