// Free/busy calendar web server
// Usage: node calendar-web.js  →  http://localhost:3747
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getAccounts, getCalendarFilters, setCalendarFilter } from '@multi-gcal/core/storage';
import { listAllEvents, getBusySlots, listCalendarsForAccount } from '@multi-gcal/core/calendar';

const PORT = process.env.WEB_PORT || 3747;
const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(__dirname, '../public/calendar-ui.html'), 'utf-8');

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(HTML);
  }

  try {
    if (url.pathname === '/api/accounts') {
      const accounts = getAccounts();
      return json(res, Object.entries(accounts).map(([id, a]) => ({
        id, label: a.label, email: a.email,
      })));
    }

    if (url.pathname === '/api/events') {
      const start = url.searchParams.get('start');
      const end   = url.searchParams.get('end');
      if (!start || !end) return json(res, { error: 'start and end required' }, 400);
      const events = await listAllEvents({ timeMin: start, timeMax: end, maxResults: 250 });
      return json(res, events);
    }

    if (url.pathname === '/api/calendars') {
      const accounts = getAccounts();
      const filters = getCalendarFilters();
      const results = await Promise.all(
        Object.entries(accounts).map(async ([id, a]) => {
          try {
            const calendars = await listCalendarsForAccount(id);
            return { accountId: id, label: a.label, email: a.email, enabledIds: filters[id] ?? ['primary'], calendars };
          } catch {
            return { accountId: id, label: a.label, email: a.email, enabledIds: filters[id] ?? ['primary'], calendars: [] };
          }
        })
      );
      return json(res, results);
    }

    if (url.pathname === '/api/freebusy') {
      const start = url.searchParams.get('start');
      const end   = url.searchParams.get('end');
      if (!start || !end) return json(res, { error: 'start and end required' }, 400);
      return json(res, await getBusySlots(start, end));
    }

    json(res, { error: 'Not found' }, 404);
  } catch (e) {
    console.error(e);
    json(res, { error: e.message }, 500);
  }
}).listen(PORT, () => {
  console.log(`\n  🗓  Free/Busy  →  http://localhost:${PORT}\n`);
});
