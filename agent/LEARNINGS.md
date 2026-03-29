# Agent Learnings

Last updated: 2026-03-16

## User Preferences
- Concise communication, minimal grammar
- Uses `bun` (not npm/yarn)
- TypeScript preferred — called out bare JS as "wtf are you doing using bare JS"
- Auto-open OAuth/browser URLs via system `open` command rather than just displaying them
- Less code > more code; no over-engineering, no fallbacks that hide failures
- No AI attribution anywhere in codebase, commits, or PRs

## Workspace Conventions
- Git branches prefixed `seth/`
- Bun monorepo with `packages/*` workspaces
- `@multi-gcal/core` sub-path exports (`/storage`, `/auth`, `/calendar`)
- Credentials via `.env` (not hardcoded), but launchd plist has them hardcoded (acceptable for local daemon)
- Token store at `~/.config/multi-gcal-mcp/tokens.json`

## Architecture Insights
- MCP server supports both stdio (default) and StreamableHTTP (`--http` flag on :11976)
- Claude Desktop "custom connector" routes through Anthropic cloud → requires public HTTPS URL (not localhost)
- Cloudflare named tunnel provides stable public URL `https://gcal-mcp.sethwebster.com`
- `noTLSVerify: true` in cloudflared config because mkcert cert is locally-trusted only
- `calendarFilters` in storage enables per-account sub-calendar allowlists

## Known Pitfalls
- `.env` client ID must match what was used to generate stored tokens — mismatch causes silent empty results
- Running `node src/index.js` without env vars set causes repeated `GOOGLE_CLIENT_ID must be set` errors in logs
- `seth@react.foundation` / `seth@expo.dev` fail with `unauthorized_client` — Google Workspace admin restriction, not a code bug
- StreamableHTTP returns "Not Acceptable" to non-MCP clients (browser/curl) — this is correct behavior
- mkcert requires `mkcert -install` to be run manually in terminal (needs user interaction for sudo)
- When migrating to packages, must kill old processes (`pkill -f calendar-web`) before starting new ones

## Domain Knowledge
- Project has 4 product areas: core data layer, MCP (agentic), web calendar view, future CalDAV server
- Goal: "all my calendars in one place" — N Google Calendar accounts aggregated transparently
- Key user story: wife can ask "what's your day like today?" and get an automated answer without Seth being asked
- Future: CalDAV server merges N accounts into one feed so one person can't be double-booked
- OAuth `accountId` format: email with dots/@ replaced by underscores (e.g. `sethwebster_gmail_com`)
