import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CALENDAR_ID,
  CALENDAR_WEB_URL,
  DEFAULT_GAS_RPC_URL,
  toPhtCheckInRfc3339,
  toPhtCheckOutRfc3339,
  formatBookingSummary,
  formatBookingDescription,
  buildSafeSubprocessEnv,
  GoogleCalendarAdapter
} from '../../src/core/gcalendar-adapter.js';

describe('GoogleCalendarAdapter Unit Tests', () => {
  it('should export correct calendar ID, Web URL, and GAS RPC URL', () => {
    assert.equal(CALENDAR_ID, '5e250418f97d2008bff93cc10a638b2aabe981af2d5e271b058eb8835dde2ae2@group.calendar.google.com');
    assert.ok(CALENDAR_WEB_URL.includes('calendar.google.com'));
    assert.ok(DEFAULT_GAS_RPC_URL.includes('script.google.com/macros/s/AKfycbwfQU86lNiQObPiQkd8xGaI9NIp_mTYWWA1dIDczqEbP9-z7PSNAPeXkZcXInKHNz2z'));
  });

  it('buildSafeSubprocessEnv strips duplicate agy-plugin-cli and ANTIGRAVITY_* variables', () => {
    const rawEnv = {
      PATH: '/var/folders/xx/T/agy-plugin-cli-123/bin:/usr/local/bin:/var/folders/xx/T/agy-plugin-cli-456/bin:/usr/bin',
      ANTIGRAVITY_PLUGIN_SHIM_DIR: '/var/folders/xx/T/agy-plugin-cli-123/bin',
      ANTIGRAVITY_CONVERSATION_ID: 'abc-123',
      HOME: '/Users/test'
    };
    const cleaned = buildSafeSubprocessEnv(rawEnv);
    assert.equal(cleaned.ANTIGRAVITY_PLUGIN_SHIM_DIR, undefined);
    assert.equal(cleaned.ANTIGRAVITY_CONVERSATION_ID, undefined);
    assert.equal(cleaned.HOME, '/Users/test');
    assert.ok(!cleaned.PATH.includes('agy-plugin-cli-123'));
    assert.ok(!cleaned.PATH.includes('agy-plugin-cli-456'));
    assert.ok(cleaned.PATH.includes('/usr/local/bin'));
  });

  it('should format strict Asia/Manila 14:00 checkin and 12:00 checkout timestamps', () => {
    assert.equal(toPhtCheckInRfc3339('2026-12-20'), '2026-12-20T14:00:00+08:00');
    assert.equal(toPhtCheckOutRfc3339('2026-12-22'), '2026-12-22T12:00:00+08:00');
  });

  it('should format booking summary and description', () => {
    const res = {
      refId: 'CND-8888',
      guestName: 'Maria Santos',
      guestEmail: 'maria@example.com',
      guestPhone: '+63 917 555 1234',
      guests: 3,
      channel: 'direct',
      checkIn: '2026-12-20',
      checkOut: '2026-12-22',
      coveredParking: true,
      plateNumber: 'NBI-1234'
    };

    const summary = formatBookingSummary(res);
    assert.equal(summary, 'Booking: Maria Santos (3 guests) - Ref #CND-8888');

    const desc = formatBookingDescription(res);
    assert.ok(desc.includes('Booking Reference: CND-8888'));
    assert.ok(desc.includes('Guest Name: Maria Santos'));
    assert.ok(desc.includes('Check-in: 2026-12-20'));
    assert.ok(desc.includes('Check-out: 2026-12-22'));
    assert.ok(desc.includes('Parking: Covered Slot (Plate: NBI-1234)'));
  });

  it('should list events using injected executor', async () => {
    const mockOutput = JSON.stringify([
      {
        id: 'ev-1',
        summary: 'Booking: Test (2 guests) - Ref #CND-1111',
        start: { dateTime: '2026-12-20T14:00:00+08:00' },
        end: { dateTime: '2026-12-22T12:00:00+08:00' },
        htmlLink: 'https://calendar.google.com/event?eid=ev-1'
      }
    ]);

    const adapter = new GoogleCalendarAdapter({
      execFn: async (cmd, args) => {
        assert.ok(args.includes('readonly'));
        assert.ok(args.includes('events'));
        assert.ok(args.includes(CALENDAR_ID));
        return { stdout: mockOutput, stderr: '' };
      }
    });

    const events = await adapter.listEvents({ from: '2026-12-01', to: '2026-12-31' });
    assert.equal(events.length, 1);
    assert.equal(events[0].id, 'ev-1');
  });

  it('should create event using injected executor and extract ID and Link', async () => {
    const adapter = new GoogleCalendarAdapter({
      execFn: async (cmd, args) => {
        assert.ok(args.includes('mutate'));
        assert.ok(args.includes('create'));
        assert.ok(args.includes('2026-12-20T14:00:00+08:00'));
        assert.ok(args.includes('2026-12-22T12:00:00+08:00'));
        return {
          stdout: 'Created event\nLink: https://www.google.com/calendar/event?eid=abc123xyz\nEvent ID: abc123xyz',
          stderr: ''
        };
      }
    });

    const result = await adapter.createEvent({
      refId: 'CND-8888',
      guestName: 'Maria Santos',
      guests: 3,
      channel: 'direct',
      checkIn: '2026-12-20',
      checkOut: '2026-12-22'
    });

    assert.equal(result.gcalEventId, 'abc123xyz');
    assert.ok(result.htmlLink.includes('abc123xyz'));
  });

  it('should fall back to GAS JSON-RPC when gcalendar fails or times out on createEvent', async () => {
    let gasCalled = false;
    const adapter = new GoogleCalendarAdapter({
      execFn: async () => {
        throw new Error('Command timed out after 4000ms');
      },
      fetchFn: async (url, options) => {
        assert.ok(url.includes('script.google.com'));
        const body = JSON.parse(options.body);
        assert.equal(body.action, 'gcalCreateEvent');
        assert.equal(body.refId, 'CND-9999');
        gasCalled = true;
        return {
          ok: true,
          json: async () => ({
            success: true,
            eventId: 'gas-ev-12345',
            htmlLink: 'https://calendar.google.com/event?eid=gas-ev-12345'
          })
        };
      }
    });

    const result = await adapter.createEvent({
      refId: 'CND-9999',
      guestName: 'Juan Dela Cruz',
      guests: 2,
      channel: 'direct',
      checkIn: '2026-11-28',
      checkOut: '2026-11-30'
    });

    assert.ok(gasCalled);
    assert.equal(result.gcalEventId, 'gas-ev-12345');
    assert.ok(result.htmlLink.includes('gas-ev-12345'));
    assert.equal(result.via, 'gas_rpc');
  });

  it('should fall back to GAS JSON-RPC when gcalendar fails on deleteEvent', async () => {
    let gasCalled = false;
    const adapter = new GoogleCalendarAdapter({
      execFn: async () => {
        throw new Error('gcalendar binary missing or hung');
      },
      fetchFn: async (url, options) => {
        assert.ok(url.includes('script.google.com'));
        const body = JSON.parse(options.body);
        assert.equal(body.action, 'gcalDeleteEvent');
        assert.equal(body.eventId, 'ev-to-del');
        gasCalled = true;
        return {
          ok: true,
          json: async () => ({
            success: true,
            deletedEventId: 'ev-to-del'
          })
        };
      }
    });

    const result = await adapter.deleteEvent('ev-to-del');
    assert.ok(gasCalled);
    assert.equal(result.deletedEventId, 'ev-to-del');
  });

  it('should delete event using injected executor', async () => {
    let deletedId = null;
    const adapter = new GoogleCalendarAdapter({
      execFn: async (cmd, args) => {
        assert.ok(args.includes('mutate'));
        assert.ok(args.includes('delete'));
        deletedId = args[args.indexOf('delete') + 1];
        return { stdout: 'Deleted', stderr: '' };
      }
    });

    await adapter.deleteEvent('ev-to-delete');
    assert.equal(deletedId, 'ev-to-delete');
  });
});
