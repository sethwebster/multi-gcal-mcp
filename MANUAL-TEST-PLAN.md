# Manual Test Plan

## Prerequisites

- Google Cloud project with Calendar API enabled + OAuth credentials
- At least 2 Google accounts available for testing
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` set
- `npm install` completed

---

## 1. First Run / Clean State

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1.1 | Missing env vars | Unset `GOOGLE_CLIENT_ID`, start server | Error: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set" |
| 1.2 | No tokens file | Delete `~/.config/multi-gcal-mcp/tokens.json`, start server | Server starts normally; file created on first account add |
| 1.3 | Corrupted tokens file | Write `{garbage` to tokens.json, start server | Server starts; treats as empty state |

---

## 2. Account Management

### Add Account

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 2.1 | Add with label | `gcal_add_account("Personal")` | Returns auth URL; browser opens consent screen |
| 2.2 | Add without label | `gcal_add_account()` | Returns auth URL; account saved with email as label |
| 2.3 | Complete OAuth flow | Click auth URL, approve | Success HTML page; account appears in `gcal_list_accounts` |
| 2.4 | Deny OAuth | Click auth URL, deny | Error HTML page; no account saved |
| 2.5 | OAuth timeout | Call `gcal_add_account`, wait 10 min without completing | Callback server closes; must call `gcal_add_account` again |
| 2.6 | Port 4999 in use | Block port 4999, call `gcal_add_account` | Error: "Could not start auth server on port 4999" |
| 2.7 | Add second account | `gcal_add_account("Work")` with different Google account | Both accounts in `gcal_list_accounts` |

### List / Remove / Rename

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 2.8 | List accounts | `gcal_list_accounts` with 2+ accounts | Shows id, label, email, connectedAt for each |
| 2.9 | List empty | `gcal_list_accounts` with no accounts | "No accounts connected yet" message |
| 2.10 | Remove account | `gcal_remove_account("user_gmail_com")` | Account gone from list; tokens removed from file |
| 2.11 | Remove invalid ID | `gcal_remove_account("nonexistent")` | Error: "Account 'nonexistent' not found" |
| 2.12 | Rename account | `gcal_rename_account("user_gmail_com", "My Personal")` | Label updated; persisted across restart |
| 2.13 | Rename invalid ID | `gcal_rename_account("nonexistent", "X")` | Error: "Account 'nonexistent' not found" |

### Auth Health

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 2.14 | Status all accounts | `gcal_account_status()` | Each account shows checkmark or X with details |
| 2.15 | Status single account | `gcal_account_status("user_gmail_com")` | Status for just that account |
| 2.16 | Status invalid ID | `gcal_account_status("nonexistent")` | Error: "Account 'nonexistent' not found" |
| 2.17 | Status with bad tokens | Manually corrupt access_token in tokens.json | Shows X; suggests `gcal_reauthenticate` |
| 2.18 | Reauthenticate | `gcal_reauthenticate("user_gmail_com")` | New auth URL; complete flow; tokens updated; status now OK |
| 2.19 | Reauth invalid ID | `gcal_reauthenticate("nonexistent")` | Error: "Account 'nonexistent' not found" |

---

## 3. Calendars

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 3.1 | List single account | `gcal_list_calendars("user_gmail_com")` | Shows calendars with id, summary, primary flag, timezone |
| 3.2 | List all accounts | `gcal_list_calendars()` | Grouped by account; each group shows email + label |
| 3.3 | List invalid account | `gcal_list_calendars("nonexistent")` | Error: account not found |
| 3.4 | Set filter | `gcal_set_calendar_filter("user_gmail_com", ["primary", "family@gmail.com"])` | Confirms enabled calendars |
| 3.5 | Set filter empty array | `gcal_set_calendar_filter("user_gmail_com", [])` | Defaults to `["primary"]` |
| 3.6 | Get filters | `gcal_get_calendar_filters()` | Shows per-account filter state; "primary (default)" for unset accounts |
| 3.7 | Filter persists | Set filter, restart server, call `gcal_get_calendar_filters` | Same filter returned |

---

## 4. Events

### Listing

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 4.1 | List from single account | `gcal_list_events("user_gmail_com")` | Events from that account only |
| 4.2 | List merged (all accounts) | `gcal_list_events()` | Events from all accounts, sorted chronologically |
| 4.3 | Merged events have metadata | Inspect merged results | Each event has `_account: { id, email, label }` and `_calendarId` |
| 4.4 | Time range filter | `gcal_list_events(time_min: "2026-03-25", time_max: "2026-03-26")` | Only events in that range |
| 4.5 | Search query | `gcal_list_events(q: "standup")` | Only matching events |
| 4.6 | Max results | `gcal_list_events(max_results: 5)` | At most 5 events per account |
| 4.7 | Specific calendar | `gcal_list_events(calendar_id: "family@gmail.com")` | Only events from that calendar across all accounts |
| 4.8 | Calendar filter respected | Set filter to exclude a calendar, list merged events | Excluded calendar's events absent |
| 4.9 | calendar_id overrides filter | Set filter, then query with explicit `calendar_id` | Filter ignored; uses provided calendar_id |
| 4.10 | All-day events included | Create all-day event, list events | Event has `allDay: true`, `start.date` instead of `start.dateTime` |
| 4.11 | Recurring events expanded | Query range with recurring event | Individual occurrences returned with `recurringEventId` |

### Creating

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 4.12 | Timed event | `gcal_create_event(account_id, summary: "Test", start_datetime: "2026-03-26T10:00:00", end_datetime: "2026-03-26T11:00:00", timezone: "America/New_York")` | Event created; returns htmlLink |
| 4.13 | All-day event | `gcal_create_event(account_id, summary: "Day Off", start_date: "2026-03-27", end_date: "2026-03-28")` | All-day event created |
| 4.14 | With attendees | Create event with `attendees: ["friend@gmail.com"]` | Event has attendees; invites sent |
| 4.15 | With recurrence | Create event with `recurrence: ["RRULE:FREQ=WEEKLY;COUNT=4"]` | Recurring event created |
| 4.16 | With description + location | Create event with both fields | Both fields present on event |
| 4.17 | On specific calendar | `gcal_create_event(account_id, calendar_id: "work_calendar_id", ...)` | Event on that sub-calendar |
| 4.18 | Cross-account isolation | Create event on account A | Does NOT appear on account B |

### Deleting

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 4.19 | Delete event | `gcal_delete_event(account_id, event_id)` | Event removed; confirmed |
| 4.20 | Delete from sub-calendar | `gcal_delete_event(account_id, event_id, calendar_id: "family@gmail.com")` | Correct event deleted |
| 4.21 | Delete invalid event | `gcal_delete_event(account_id, "fake_id")` | Error from Google API |

---

## 5. Free/Busy

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 5.1 | Query busy slots | `gcal_get_busy_slots(time_min: "2026-03-25T00:00:00Z", time_max: "2026-03-26T00:00:00Z")` | Busy blocks per account |
| 5.2 | Multiple accounts | Query with 2+ accounts connected | Each account listed with its busy blocks |
| 5.3 | No busy slots | Query empty time range | Account listed with empty busy array |
| 5.4 | Only primary calendar | Set filter to include sub-calendars, query free/busy | Only primary calendar's busy slots returned (filters ignored) |
| 5.5 | One account fails | Corrupt tokens for one account, query | Other accounts still return results; failed account shows error |

---

## 6. Token Lifecycle

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 6.1 | Auto-refresh | Wait for access_token to expire (~1hr), make API call | Token refreshed silently; call succeeds |
| 6.2 | Refresh persisted | After auto-refresh, check tokens.json | New access_token and expiry_date written |
| 6.3 | Revoked refresh token | Revoke token in Google Account settings, make API call | Error; `gcal_account_status` shows failure |
| 6.4 | Reauth restores access | After revoke, call `gcal_reauthenticate` | New tokens; API calls work again |

---

## 7. Transport: stdio

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 7.1 | Default startup | `node packages/mcp/src/index.js` | Logs "[multi-gcal-mcp] Server running" to stderr |
| 7.2 | Claude Desktop integration | Add to claude_desktop_config.json, restart Claude | Tools appear in Claude; calls work |

---

## 8. Transport: HTTP

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 8.1 | Start HTTP mode | `node packages/mcp/src/index.js --http` | Listens on https://localhost:11976 |
| 8.2 | Start via env var | `HTTP_PORT=9999 node packages/mcp/src/index.js` | Listens on port 9999 |
| 8.3 | Missing TLS certs | Remove cert files, start HTTP mode | Error on startup |
| 8.4 | POST /mcp | Send MCP request to `/mcp` | Valid MCP response |
| 8.5 | GET / (non-MCP) | `curl https://localhost:11976/` | 404 |
| 8.6 | Request logging | Make request, check stderr | Logs method, URL, Accept, Content-Type |

---

## 9. Web Calendar UI

### Server

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 9.1 | Start web server | `npm run web` | Listening on http://localhost:3747 |
| 9.2 | Custom port | `WEB_PORT=8080 npm run web` | Listening on port 8080 |
| 9.3 | GET / | Open http://localhost:3747 | Calendar UI loads |
| 9.4 | /api/accounts | `curl localhost:3747/api/accounts` | JSON array of accounts |
| 9.5 | /api/events | `curl "localhost:3747/api/events?start=2026-03-25&end=2026-03-26"` | Merged events JSON |
| 9.6 | /api/events missing params | `curl localhost:3747/api/events` | 400: "start and end required" |
| 9.7 | /api/freebusy | `curl "localhost:3747/api/freebusy?start=...&end=..."` | Busy slots per account |
| 9.8 | 404 route | `curl localhost:3747/api/nope` | 404: "Not found" |
| 9.9 | CORS header | Check response headers | `Access-Control-Allow-Origin: *` |

### UI Behavior

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 9.10 | Week navigation | Click Prev/Next buttons | Calendar shifts by 1 week |
| 9.11 | Today button | Navigate away, click Today | Returns to current week |
| 9.12 | Event rendering | Create overlapping events, reload | Events display in columns side by side |
| 9.13 | All-day events hidden | Create all-day event, check UI | Not visible in time grid |
| 9.14 | Current time line | View today's column | Red horizontal line at current time |
| 9.15 | Account colors | Connect 2+ accounts | Events color-coded by account |
| 9.16 | Click event | Click an event in the UI | Opens Google Calendar event in new tab |
| 9.17 | Auto-refresh | Wait 5 minutes | Calendar refreshes without interaction |
| 9.18 | Manual refresh | Click refresh button | Events reload immediately |
| 9.19 | Time bounds | Check grid | Displays 7am-10pm only |

---

## 10. Edge Cases

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 10.1 | Simultaneous OAuth flows | Call `gcal_add_account` twice quickly | First callback server replaced by second; only second flow works |
| 10.2 | Same Google account twice | Add same email under different labels | Same account_id; second add overwrites first |
| 10.3 | Invalid date strings | `gcal_list_events(time_min: "not-a-date")` | Error or "Invalid Date" from API |
| 10.4 | Very large result set | Account with 1000+ events in range | Returns up to max_results per account |
| 10.5 | Account with no calendars | Freshly created Google account | Empty calendar list; primary only |
| 10.6 | Workspace admin restrictions | Connect Google Workspace account without admin approval | OAuth may fail or token refresh returns `unauthorized_client` |
| 10.7 | Server restart preserves state | Restart server, call `gcal_list_accounts` | All accounts still present from tokens.json |
| 10.8 | Concurrent token writes | Two requests trigger simultaneous token refresh | Last write wins; potential data loss (known limitation) |
