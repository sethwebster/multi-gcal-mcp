import { google } from 'googleapis';
import { getAccounts, getEnabledCalendars } from './storage.js';
import { createClientForAccount } from './auth.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function calendarApi(client) {
  return google.calendar({ version: 'v3', auth: client });
}

function formatEvent(e, accountMeta) {
  return {
    id: e.id,
    summary: e.summary || '(No title)',
    start: e.start,
    end: e.end,
    allDay: !e.start?.dateTime,
    status: e.status,
    location: e.location,
    description: e.description,
    attendees: e.attendees?.map(a => ({
      email: a.email,
      displayName: a.displayName,
      responseStatus: a.responseStatus,
      self: a.self,
    })),
    organizer: e.organizer,
    htmlLink: e.htmlLink,
    recurringEventId: e.recurringEventId,
    ...(accountMeta ? { _account: accountMeta } : {}),
  };
}

// ─── Calendars ───────────────────────────────────────────────────────────────

export async function listCalendarsForAccount(accountId) {
  const client = createClientForAccount(accountId);
  const cal = calendarApi(client);
  const { data } = await cal.calendarList.list({ maxResults: 250 });
  return (data.items || []).map(c => ({
    id: c.id,
    summary: c.summaryOverride || c.summary,
    primary: c.primary ?? false,
    accessRole: c.accessRole,
    backgroundColor: c.backgroundColor,
    timeZone: c.timeZone,
    selected: c.selected,
  }));
}

export async function listAllCalendars() {
  const accounts = getAccounts();
  const results = [];
  for (const [accountId, account] of Object.entries(accounts)) {
    try {
      const calendars = await listCalendarsForAccount(accountId);
      results.push({
        accountId,
        email: account.email,
        label: account.label,
        calendars,
      });
    } catch (err) {
      results.push({
        accountId,
        email: account.email,
        label: account.label,
        error: err.message,
      });
    }
  }
  return results;
}

// ─── Events ──────────────────────────────────────────────────────────────────

export async function listEventsForAccount(accountId, {
  calendarId = 'primary',
  timeMin,
  timeMax,
  maxResults = 100,
  q,
  singleEvents = true,
} = {}) {
  const client = createClientForAccount(accountId);
  const cal = calendarApi(client);

  const params = {
    calendarId,
    singleEvents,
    orderBy: singleEvents ? 'startTime' : undefined,
    maxResults,
  };
  if (timeMin) params.timeMin = new Date(timeMin).toISOString();
  if (timeMax) params.timeMax = new Date(timeMax).toISOString();
  if (q) params.q = q;

  const { data } = await cal.events.list(params);
  return (data.items || []).map(e => formatEvent(e, null));
}

/** Fetch events from ALL connected accounts and merge/sort by time. */
export async function listAllEvents({
  calendarId,
  timeMin,
  timeMax,
  maxResults = 100,
  q,
} = {}) {
  const accounts = getAccounts();
  const all = [];

  await Promise.allSettled(
    Object.entries(accounts).map(async ([accountId, account]) => {
      const calendarIds = calendarId ? [calendarId] : getEnabledCalendars(accountId);
      await Promise.allSettled(
        calendarIds.map(async (calId) => {
          try {
            const events = await listEventsForAccount(accountId, { calendarId: calId, timeMin, timeMax, maxResults, q });
            for (const e of events) {
              all.push({ ...e, _account: { id: accountId, email: account.email, label: account.label }, _calendarId: calId });
            }
          } catch (err) {
            console.error(`[multi-gcal] ${account.email} (${calId}): ${err.message}`);
          }
        })
      );
    })
  );

  // Sort merged list by start time
  all.sort((a, b) => {
    const ta = a.start?.dateTime || a.start?.date || '';
    const tb = b.start?.dateTime || b.start?.date || '';
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });

  return all;
}

// ─── Create / Update / Delete ────────────────────────────────────────────────

export async function createEvent(accountId, calendarId = 'primary', {
  summary,
  description,
  location,
  startDateTime,
  endDateTime,
  startDate,
  endDate,
  timezone = 'UTC',
  attendees = [],
  recurrence,
}) {
  const client = createClientForAccount(accountId);
  const cal = calendarApi(client);

  const requestBody = {
    summary,
    description,
    location,
    start: startDate ? { date: startDate } : { dateTime: startDateTime, timeZone: timezone },
    end: endDate ? { date: endDate } : { dateTime: endDateTime, timeZone: timezone },
    attendees: attendees.map(email => ({ email })),
  };
  if (recurrence) requestBody.recurrence = recurrence;

  const { data } = await cal.events.insert({ calendarId, requestBody });
  return formatEvent(data, null);
}

export async function deleteEvent(accountId, calendarId = 'primary', eventId) {
  const client = createClientForAccount(accountId);
  const cal = calendarApi(client);
  await cal.events.delete({ calendarId, eventId });
  return { deleted: true, eventId };
}

// ─── Free time ───────────────────────────────────────────────────────────────

/** Return busy blocks across ALL accounts for a time range (for free-time analysis). */
export async function getBusySlots(timeMin, timeMax) {
  const accounts = getAccounts();
  const allBusy = [];

  for (const [accountId, account] of Object.entries(accounts)) {
    try {
      const client = createClientForAccount(accountId);
      const cal = calendarApi(client);
      const { data } = await cal.freebusy.query({
        requestBody: {
          timeMin: new Date(timeMin).toISOString(),
          timeMax: new Date(timeMax).toISOString(),
          items: [{ id: 'primary' }],
        },
      });
      const busy = data.calendars?.primary?.busy || [];
      allBusy.push({ accountId, email: account.email, label: account.label, busy });
    } catch (err) {
      console.error(`[multi-gcal] freebusy ${account.email}: ${err.message}`);
    }
  }

  return allBusy;
}
