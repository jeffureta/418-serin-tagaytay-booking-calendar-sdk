/**
 * Google Calendar CLI (gcalendar) OAuth Adapter for Unit 418 Serin East Tagaytay.
 * Provides direct CRUD capabilities on the 418 Serin Tagaytay Bookings Google Calendar,
 * with resilient fallback to the Apps Script Web App JSON-RPC endpoint.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fetchAndParseCalendar } from './calendar-feed.js';

const execFileAsync = promisify(execFile);

export const CALENDAR_ID = '5e250418f97d2008bff93cc10a638b2aabe981af2d5e271b058eb8835dde2ae2@group.calendar.google.com';
export const CALENDAR_WEB_URL = `https://calendar.google.com/calendar/u/0?cid=${encodeURIComponent(CALENDAR_ID)}`;
export const DEFAULT_GAS_RPC_URL = 'https://script.google.com/macros/s/AKfycbwfQU86lNiQObPiQkd8xGaI9NIp_mTYWWA1dIDczqEbP9-z7PSNAPeXkZcXInKHNz2z/exec';

export function buildSafeSubprocessEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  // Scrub Antigravity internal shims and variables that trigger nested IDE fork loops
  delete env.ANTIGRAVITY_PLUGIN_SHIM_DIR;
  delete env.ANTIGRAVITY_LS_ADDRESS;
  delete env.ANTIGRAVITY_CSRF_TOKEN;
  delete env.ANTIGRAVITY_AGENTAPI_EXE;
  delete env.ANTIGRAVITY_CONVERSATION_ID;
  delete env.ANTIGRAVITY_TRAJECTORY_ID;
  delete env.ANTIGRAVITY_APP_DATA_DIR;

  if (env.PATH) {
    const segments = env.PATH.split(':').filter(p => !p.includes('agy-plugin-cli-'));
    env.PATH = segments.join(':');
  }
  return env;
}

export function toPhtCheckInRfc3339(dateStr) {
  return `${dateStr}T14:00:00+08:00`;
}

export function toPhtCheckOutRfc3339(dateStr) {
  return `${dateStr}T12:00:00+08:00`;
}

export function formatBookingSummary(res) {
  const guests = res.guests || 2;
  const guestName = res.guestName || 'Guest';
  const refId = res.refId || 'N/A';
  const isTest = res.isTest || (typeof refId === 'string' && refId.startsWith('TEST-'));
  const prefix = isTest ? '[TEST] ' : '';
  return `${prefix}Booking: ${guestName} (${guests} guests) - Ref #${refId}`;
}

export function formatBookingDescription(res) {
  const lines = [
    `Booking Reference: ${res.refId || 'N/A'}`,
    `Guest Name: ${res.guestName || 'Guest'}`,
    `Email: ${res.guestEmail || 'N/A'}`,
    `Phone: ${res.guestPhone || 'N/A'}`,
    `Guests: ${res.guests || 2}`,
    `Channel: ${res.channel || 'direct'}`,
    `Check-in: ${res.checkIn}`,
    `Check-out: ${res.checkOut}`,
    `Parking: ${res.coveredParking ? `Covered Slot (Plate: ${res.plateNumber || 'TBD'})` : 'None/Street'}`,
    `Status: ${res.bookingStatus || 'Confirmed'}`
  ];
  return lines.join('\n');
}

export class GoogleCalendarAdapter {
  constructor(options = {}) {
    this.calendarId = options.calendarId || CALENDAR_ID;
    this.gcalendarBin = options.gcalendarBin || 'gcalendar';
    this.gasRpcUrl = options.gasRpcUrl || process.env.GAS_WEB_APP_URL || DEFAULT_GAS_RPC_URL;
    this.timeoutMs = options.timeoutMs || 4000;
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.execFn = options.execFn || (async (cmd, args) => {
      const env = buildSafeSubprocessEnv(process.env);
      return execFileAsync(cmd, args, { timeout: this.timeoutMs, env });
    });
  }

  async callGasRpc(action, payload) {
    if (!this.fetchFn) {
      throw new Error('fetchFn not available for GAS RPC');
    }
    const res = await this.fetchFn(this.gasRpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload })
    });
    if (!res.ok) {
      throw new Error(`GAS RPC ${action} HTTP error ${res.status}`);
    }
    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || `GAS RPC ${action} returned success: false`);
    }
    return json;
  }

  async listEvents({ from, to }) {
    try {
      const args = [
        'readonly', 'events',
        '--cal', this.calendarId,
        '--timezone', 'Asia/Manila',
        '--max', '250',
        '--json'
      ];
      if (from) {
        args.push('--start', toPhtCheckInRfc3339(from));
      }
      if (to) {
        args.push('--end', toPhtCheckOutRfc3339(to));
      }

      const { stdout } = await this.execFn(this.gcalendarBin, args);
      const parsed = JSON.parse(stdout);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      // Fallback 1: Try public ICS feed
      try {
        const fallbackEvents = await fetchAndParseCalendar(undefined, { from, to });
        return fallbackEvents.map(e => ({
          id: e.uid,
          summary: e.summary,
          start: { dateTime: e.start.toISOString() },
          end: { dateTime: e.end.toISOString() },
          htmlLink: CALENDAR_WEB_URL
        }));
      } catch (fallbackErr) {
        // Fallback 2: Try GAS RPC
        try {
          const rpcRes = await this.callGasRpc('gcalListEvents', { from, to });
          return rpcRes.events || [];
        } catch (gasErr) {
          throw new Error(`Failed to list calendar events: ${err.message}`);
        }
      }
    }
  }

  async findEventByRef(refId) {
    try {
      const args = [
        'readonly', 'search',
        refId,
        '--cal', this.calendarId,
        '--max', '5',
        '--json'
      ];
      const { stdout } = await this.execFn(this.gcalendarBin, args);
      const events = JSON.parse(stdout);
      if (Array.isArray(events) && events.length > 0) {
        return events[0];
      }
      return null;
    } catch (err) {
      return null;
    }
  }

  async createEvent(reservation) {
    const summary = formatBookingSummary(reservation);
    const description = formatBookingDescription(reservation);
    const startStr = toPhtCheckInRfc3339(reservation.checkIn);
    const endStr = toPhtCheckOutRfc3339(reservation.checkOut);

    try {
      const args = [
        'mutate', 'create',
        '--cal', this.calendarId,
        '--summary', summary,
        '--description', description,
        '--start', startStr,
        '--end', endStr,
        '--timezone', 'Asia/Manila'
      ];

      const { stdout } = await this.execFn(this.gcalendarBin, args);

      let gcalEventId = null;
      let htmlLink = null;

      const linkMatch = stdout.match(/Link:\s*(\S+)/i);
      if (linkMatch) {
        htmlLink = linkMatch[1];
        const eidMatch = htmlLink.match(/eid=([^&\s]+)/i);
        if (eidMatch) {
          gcalEventId = eidMatch[1];
        }
      }

      const idMatch = stdout.match(/Event ID:\s*(\S+)/i);
      if (idMatch) {
        gcalEventId = idMatch[1];
      }

      return {
        success: true,
        gcalEventId: gcalEventId || reservation.refId,
        htmlLink: htmlLink || CALENDAR_WEB_URL,
        via: 'gcalendar_cli'
      };
    } catch (err) {
      // Fallback to GAS Web App RPC
      try {
        const gasRes = await this.callGasRpc('gcalCreateEvent', {
          refId: reservation.refId,
          guestName: reservation.guestName,
          checkIn: reservation.checkIn,
          checkOut: reservation.checkOut,
          guests: reservation.guests,
          channel: reservation.channel,
          coveredParking: reservation.coveredParking,
          plateNumber: reservation.plateNumber,
          guestEmail: reservation.guestEmail,
          guestPhone: reservation.guestPhone,
          bookingStatus: reservation.bookingStatus
        });
        return {
          success: true,
          gcalEventId: gasRes.eventId,
          htmlLink: gasRes.htmlLink || CALENDAR_WEB_URL,
          via: 'gas_rpc'
        };
      } catch (gasErr) {
        throw new Error(`Failed to create calendar event via CLI and GAS: ${err.message}; GAS: ${gasErr.message}`);
      }
    }
  }

  async updateEvent(eventId, reservation) {
    const summary = formatBookingSummary(reservation);
    const description = formatBookingDescription(reservation);
    const startStr = toPhtCheckInRfc3339(reservation.checkIn);
    const endStr = toPhtCheckOutRfc3339(reservation.checkOut);

    try {
      const args = [
        'mutate', 'update',
        eventId,
        '--cal', this.calendarId,
        '--summary', summary,
        '--description', description,
        '--start', startStr,
        '--end', endStr,
        '--timezone', 'Asia/Manila'
      ];

      await this.execFn(this.gcalendarBin, args);
      return {
        success: true,
        gcalEventId: eventId,
        htmlLink: CALENDAR_WEB_URL,
        via: 'gcalendar_cli'
      };
    } catch (err) {
      try {
        const gasRes = await this.callGasRpc('gcalUpdateEvent', {
          eventId,
          refId: reservation.refId,
          guestName: reservation.guestName,
          checkIn: reservation.checkIn,
          checkOut: reservation.checkOut,
          guests: reservation.guests,
          channel: reservation.channel,
          coveredParking: reservation.coveredParking,
          plateNumber: reservation.plateNumber,
          guestEmail: reservation.guestEmail,
          guestPhone: reservation.guestPhone,
          bookingStatus: reservation.bookingStatus
        });
        return {
          success: true,
          gcalEventId: gasRes.eventId || eventId,
          htmlLink: gasRes.htmlLink || CALENDAR_WEB_URL,
          via: 'gas_rpc'
        };
      } catch (gasErr) {
        throw new Error(`Failed to update calendar event via CLI and GAS: ${err.message}; GAS: ${gasErr.message}`);
      }
    }
  }

  async deleteEvent(eventId) {
    try {
      const args = [
        'mutate', 'delete',
        eventId,
        '--cal', this.calendarId
      ];

      await this.execFn(this.gcalendarBin, args);
      return {
        success: true,
        deletedEventId: eventId,
        via: 'gcalendar_cli'
      };
    } catch (err) {
      try {
        const gasRes = await this.callGasRpc('gcalDeleteEvent', { eventId });
        return {
          success: true,
          deletedEventId: gasRes.deletedEventId || eventId,
          via: 'gas_rpc'
        };
      } catch (gasErr) {
        throw new Error(`Failed to delete calendar event via CLI and GAS: ${err.message}; GAS: ${gasErr.message}`);
      }
    }
  }
}
