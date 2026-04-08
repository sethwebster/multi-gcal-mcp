#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createServer as createHttpServer } from 'http';

import { startOAuthFlow, checkAccountHealth } from '@multi-gcal/core/auth';
import { getAccounts, removeAccount, updateAccountLabel, getTokensFilePath, getCalendarFilters, setCalendarFilter } from '@multi-gcal/core/storage';
import {
  listCalendarsForAccount,
  listAllCalendars,
  listEventsForAccount,
  listAllEvents,
  createEvent,
  deleteEvent,
  getBusySlots,
} from '@multi-gcal/core/calendar';

// ─── Tool definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'gcal_add_account',
    description:
      'Connect a new Google Calendar account via OAuth. ' +
      'Returns a URL the user must open in their browser to authorize. ' +
      'The account is saved automatically once they approve. ' +
      'Call gcal_list_accounts afterward to confirm.',
    inputSchema: {
      type: 'object',
      properties: {
        label: {
          type: 'string',
          description: 'Friendly name for this account, e.g. "Work", "Personal", "React Foundation"',
        },
      },
    },
  },
  {
    name: 'gcal_list_accounts',
    description: 'List all connected Google Calendar accounts and their IDs.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'gcal_remove_account',
    description: 'Disconnect and remove a Google Calendar account.',
    inputSchema: {
      type: 'object',
      required: ['account_id'],
      properties: {
        account_id: { type: 'string', description: 'Account ID from gcal_list_accounts' },
      },
    },
  },
  {
    name: 'gcal_reauthenticate',
    description:
      'Re-authenticate an existing Google Calendar account. Use when tokens are expired, revoked, ' +
      'or API calls are failing with auth errors. Returns a URL the user must open in their browser.',
    inputSchema: {
      type: 'object',
      required: ['account_id'],
      properties: {
        account_id: { type: 'string', description: 'Account ID from gcal_list_accounts' },
      },
    },
  },
  {
    name: 'gcal_rename_account',
    description: 'Change the friendly label of a connected account.',
    inputSchema: {
      type: 'object',
      required: ['account_id', 'label'],
      properties: {
        account_id: { type: 'string', description: 'Account ID from gcal_list_accounts' },
        label: { type: 'string', description: 'New friendly name for this account' },
      },
    },
  },
  {
    name: 'gcal_account_status',
    description:
      'Check whether connected accounts have valid tokens. ' +
      'Omit account_id to check all accounts. Useful for diagnosing auth failures.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string', description: 'Specific account ID, or omit for all accounts' },
      },
    },
  },
  {
    name: 'gcal_list_calendars',
    description:
      'List calendars. Omit account_id to see calendars across ALL connected accounts.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: {
          type: 'string',
          description: 'Specific account ID, or omit for all accounts',
        },
      },
    },
  },
  {
    name: 'gcal_list_events',
    description:
      'List calendar events. Omit account_id to merge events from ALL connected accounts, sorted by time.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: {
          type: 'string',
          description: 'Specific account ID, or omit for all accounts',
        },
        calendar_id: {
          type: 'string',
          description: 'Calendar ID (default: primary)',
        },
        time_min: {
          type: 'string',
          description: 'Start of range, ISO 8601 (e.g. 2026-03-17T00:00:00)',
        },
        time_max: {
          type: 'string',
          description: 'End of range, ISO 8601',
        },
        max_results: {
          type: 'number',
          description: 'Max events per account (default: 100)',
        },
        q: {
          type: 'string',
          description: 'Full-text search query',
        },
      },
    },
  },
  {
    name: 'gcal_create_event',
    description: 'Create a calendar event on a specific account.',
    inputSchema: {
      type: 'object',
      required: ['account_id', 'summary'],
      properties: {
        account_id: { type: 'string', description: 'Account ID from gcal_list_accounts' },
        calendar_id: { type: 'string', description: 'Calendar ID (default: primary)' },
        summary: { type: 'string', description: 'Event title' },
        description: { type: 'string' },
        location: { type: 'string' },
        start_datetime: { type: 'string', description: 'ISO 8601 datetime, e.g. 2026-03-20T14:00:00' },
        end_datetime: { type: 'string', description: 'ISO 8601 datetime' },
        start_date: { type: 'string', description: 'All-day event start, YYYY-MM-DD' },
        end_date: { type: 'string', description: 'All-day event end (exclusive), YYYY-MM-DD' },
        timezone: { type: 'string', description: 'IANA timezone (default: UTC)' },
        attendees: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of attendee email addresses',
        },
        recurrence: {
          type: 'array',
          items: { type: 'string' },
          description: 'RRULE strings, e.g. ["RRULE:FREQ=WEEKLY;BYDAY=MO"]',
        },
      },
    },
  },
  {
    name: 'gcal_delete_event',
    description: 'Delete a calendar event.',
    inputSchema: {
      type: 'object',
      required: ['account_id', 'event_id'],
      properties: {
        account_id: { type: 'string' },
        calendar_id: { type: 'string', description: 'Calendar ID (default: primary)' },
        event_id: { type: 'string' },
      },
    },
  },
  {
    name: 'gcal_set_calendar_filter',
    description:
      'Set which sub-calendars are shown for an account on the web view and in merged event queries. ' +
      'Use gcal_list_calendars to discover available calendar IDs first.',
    inputSchema: {
      type: 'object',
      required: ['account_id', 'calendar_ids'],
      properties: {
        account_id: { type: 'string', description: 'Account ID from gcal_list_accounts' },
        calendar_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Calendar IDs to enable (e.g. ["primary", "family@example.com"]). Pass empty array to reset to default (primary only).',
        },
      },
    },
  },
  {
    name: 'gcal_get_calendar_filters',
    description: 'Show which sub-calendars are currently enabled for each account.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'gcal_get_busy_slots',
    description:
      'Return busy time blocks across all connected accounts for a time range. Useful for finding free time or analyzing schedule load.',
    inputSchema: {
      type: 'object',
      required: ['time_min', 'time_max'],
      properties: {
        time_min: { type: 'string', description: 'ISO 8601 start' },
        time_max: { type: 'string', description: 'ISO 8601 end' },
      },
    },
  },
];

// ─── Server factory ───────────────────────────────────────────────────────────

function buildServer() {
  const server = new Server(
    { name: 'multi-gcal-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      switch (name) {

        // ── Account management ─────────────────────────────────────────────────

        case 'gcal_add_account': {
          const authUrl = await startOAuthFlow(args.label);
          return {
            content: [{
              type: 'text',
              text: [
                `**Open this URL in your browser to connect${args.label ? ` "${args.label}"` : ' a new'} Google Calendar account:**`,
                '',
                authUrl,
                '',
                'After you approve access, the account will be saved automatically.',
                'Call `gcal_list_accounts` to confirm it was added.',
              ].join('\n'),
            }],
          };
        }

        case 'gcal_list_accounts': {
          const accounts = getAccounts();
          const entries = Object.entries(accounts);
          if (entries.length === 0) {
            return {
              content: [{
                type: 'text',
                text: 'No accounts connected yet. Use gcal_add_account to connect one.',
              }],
            };
          }
          const lines = entries.map(([id, a]) =>
            `- **${a.label}** (${a.email}) · ID: \`${id}\` · Connected: ${a.connectedAt?.slice(0, 10) ?? 'unknown'}`
          );
          return {
            content: [{
              type: 'text',
              text: `${entries.length} connected account(s):\n\n${lines.join('\n')}\n\nTokens file: ${getTokensFilePath()}`,
            }],
          };
        }

        case 'gcal_remove_account': {
          const accounts = getAccounts();
          const account = accounts[args.account_id];
          if (!account) return err(`Account "${args.account_id}" not found.`);
          removeAccount(args.account_id);
          return ok(`Removed **${account.label}** (${account.email}).`);
        }

        case 'gcal_reauthenticate': {
          const accounts = getAccounts();
          const account = accounts[args.account_id];
          if (!account) return err(`Account "${args.account_id}" not found.`);
          const authUrl = await startOAuthFlow(account.label);
          return {
            content: [{
              type: 'text',
              text: [
                `**Re-authenticate "${account.label}" (${account.email}):**`,
                '',
                authUrl,
                '',
                'Open this URL in your browser and sign in with the **same Google account**.',
                'Tokens will be updated automatically once you approve.',
              ].join('\n'),
            }],
          };
        }

        case 'gcal_rename_account': {
          const accounts = getAccounts();
          if (!accounts[args.account_id]) return err(`Account "${args.account_id}" not found.`);
          const oldLabel = accounts[args.account_id].label;
          updateAccountLabel(args.account_id, args.label);
          return ok(`Renamed **${oldLabel}** → **${args.label}**`);
        }

        case 'gcal_account_status': {
          const accounts = getAccounts();
          const entries = args.account_id
            ? [[args.account_id, accounts[args.account_id]]]
            : Object.entries(accounts);

          if (args.account_id && !accounts[args.account_id]) {
            return err(`Account "${args.account_id}" not found.`);
          }
          if (!entries.length) return ok('No accounts connected.');

          const results = await Promise.allSettled(
            entries.map(async ([id]) => {
              const result = await checkAccountHealth(id);
              return { id, ...result };
            })
          );

          const lines = results.map((r) => {
            if (r.status === 'rejected') {
              return `- ❌ Error checking account: ${r.reason?.message}`;
            }
            const { id, ok: healthy, email, error } = r.value;
            const acct = accounts[id];
            return healthy
              ? `- ✅ **${acct.label}** (${email}) — tokens valid`
              : `- ❌ **${acct.label}** (${acct.email}) — ${error}. Use \`gcal_reauthenticate\` to fix.`;
          });

          return ok(`Account status:\n\n${lines.join('\n')}`);
        }

        // ── Calendars ─────────────────────────────────────────────────────────

        case 'gcal_list_calendars': {
          const data = args.account_id
            ? await listCalendarsForAccount(args.account_id)
            : await listAllCalendars();
          return ok(JSON.stringify(data, null, 2));
        }

        // ── Events ────────────────────────────────────────────────────────────

        case 'gcal_list_events': {
          const opts = {
            calendarId: args.calendar_id,
            timeMin: args.time_min,
            timeMax: args.time_max,
            maxResults: args.max_results,
            q: args.q,
          };
          const events = args.account_id
            ? await listEventsForAccount(args.account_id, opts)
            : await listAllEvents(opts);
          return ok(JSON.stringify(events, null, 2));
        }

        case 'gcal_create_event': {
          const event = await createEvent(
            args.account_id,
            args.calendar_id || 'primary',
            {
              summary: args.summary,
              description: args.description,
              location: args.location,
              startDateTime: args.start_datetime,
              endDateTime: args.end_datetime,
              startDate: args.start_date,
              endDate: args.end_date,
              timezone: args.timezone || 'UTC',
              attendees: args.attendees || [],
              recurrence: args.recurrence,
            }
          );
          return ok(`Event created: **${event.summary}**\n${event.htmlLink}`);
        }

        case 'gcal_delete_event': {
          await deleteEvent(args.account_id, args.calendar_id || 'primary', args.event_id);
          return ok(`Event \`${args.event_id}\` deleted.`);
        }

        case 'gcal_set_calendar_filter': {
          const accounts = getAccounts();
          if (!accounts[args.account_id]) return err(`Account "${args.account_id}" not found.`);
          const ids = args.calendar_ids.length ? args.calendar_ids : ['primary'];
          setCalendarFilter(args.account_id, ids);
          const label = accounts[args.account_id].label;
          return ok(`Calendar filter updated for **${label}**: ${ids.map(id => `\`${id}\``).join(', ')}`);
        }

        case 'gcal_get_calendar_filters': {
          const accounts = getAccounts();
          const filters = getCalendarFilters();
          if (!Object.keys(accounts).length) return ok('No accounts connected.');
          const lines = Object.entries(accounts).map(([id, a]) => {
            const cals = filters[id] ?? ['primary (default)'];
            return `- **${a.label}** (${a.email}): ${cals.map(c => `\`${c}\``).join(', ')}`;
          });
          return ok(`Current calendar filters:\n\n${lines.join('\n')}`);
        }

        case 'gcal_get_busy_slots': {
          const slots = await getBusySlots(args.time_min, args.time_max);
          return ok(JSON.stringify(slots, null, 2));
        }

        default:
          return err(`Unknown tool: ${name}`);
      }
    } catch (e) {
      return err(e.message);
    }
  });

  return server;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ok(text) {
  return { content: [{ type: 'text', text }] };
}
function err(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

// ─── Start ───────────────────────────────────────────────────────────────────

const useHttp = process.argv.includes('--http') || !!process.env.PORT || !!process.env.HTTP_PORT;
const port = parseInt(process.env.PORT || process.env.HTTP_PORT || '3000', 10);

if (useHttp) {
  const httpServer = createHttpServer(async (req, res) => {
    console.error(`[req] ${req.method} ${req.url}`);
    const url = req.url?.split('?')[0];

    if (req.method === 'GET' && url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
      return;
    }

    if (url !== '/mcp') {
      res.writeHead(404).end('Not found');
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    const server = buildServer();
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });

  httpServer.listen(port, '0.0.0.0', () => {
    console.error(`[multi-gcal-mcp] HTTP server listening on http://0.0.0.0:${port}/mcp`);
  });
} else {
  const transport = new StdioServerTransport();
  await buildServer().connect(transport);
  console.error('[multi-gcal-mcp] Server running — waiting for connections.');
}
