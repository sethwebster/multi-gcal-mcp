# multi-gcal-mcp

An MCP server that connects **multiple Google Calendar accounts** to Claude. Manage events, check availability, and query schedules across all your calendars from a single conversation.

Connect once — tokens persist and auto-refresh. No re-auth needed.

## Features

- **Multi-account** — Connect unlimited Google accounts (personal, work, side projects)
- **Merged views** — Events from all accounts sorted chronologically in one response
- **Free/busy analysis** — Find open slots across every connected calendar
- **Per-account filtering** — Enable/disable specific sub-calendars per account
- **Event management** — Create and delete events on any connected account
- **Two transport modes** — stdio (recommended) or HTTPS via Cloudflare Tunnel
- **Web UI** — Dark-mode weekly calendar view at `localhost:3747`

## Quick Start

### 1. Get OAuth Credentials

You need a Google Cloud project with Calendar API enabled and OAuth credentials.

1. [Create a Google Cloud project](https://console.cloud.google.com/projectcreate) (or use an existing one)
2. [Enable the Google Calendar API](https://console.cloud.google.com/marketplace/product/google/calendar-json.googleapis.com)
3. [Configure the OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent):
   - User type: **External**
   - Add your email as a test user
   - Add scope: `https://www.googleapis.com/auth/calendar`
   - No need to publish — "Testing" status is fine
4. [Create OAuth credentials](https://console.cloud.google.com/apis/credentials):
   - Click **Create Credentials** > **OAuth client ID**
   - Application type: **Web application**
   - Add authorized redirect URI: `http://localhost:4999/oauth/callback`
5. Copy the **Client ID** and **Client Secret** — you'll need both in the next step

### 2. Install

```bash
git clone https://github.com/sethwebster/multi-gcal-mcp.git
cd multi-gcal-mcp
npm install
```

### 3. Configure Claude Desktop

Add to your Claude Desktop config:

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

```json
{
  "mcpServers": {
    "multi-gcal": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/multi-gcal-mcp/packages/mcp/src/index.js"],
      "env": {
        "GOOGLE_CLIENT_ID": "your_client_id",
        "GOOGLE_CLIENT_SECRET": "your_client_secret"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

### 3b. Configure Claude Code (CLI)

Add to your Claude Code settings (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "multi-gcal": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/multi-gcal-mcp/packages/mcp/src/index.js"],
      "env": {
        "GOOGLE_CLIENT_ID": "your_client_id",
        "GOOGLE_CLIENT_SECRET": "your_client_secret"
      }
    }
  }
}
```

Or for a specific project, add to `.claude/settings.local.json` in that project's root.

Restart Claude Code after saving (`/quit` then relaunch).

### 4. Connect Your Accounts

In Claude, say:

```
Connect my personal Google Calendar
```

Claude will return an authorization URL. Open it, sign in, approve access. The token is saved automatically.

Repeat for each account:

```
Connect my work calendar
Connect my side project calendar
```

### 5. Verify It Works

```
What's on my calendar today?
```

Claude will pull events from all connected accounts, merged and sorted by time. If you see your events, you're all set.

## Tools

### Account Management

| Tool | Description |
|------|-------------|
| `gcal_add_account` | Start OAuth flow for a new Google account |
| `gcal_list_accounts` | List all connected accounts with email and status |
| `gcal_remove_account` | Disconnect an account |
| `gcal_rename_account` | Update an account's friendly name |
| `gcal_reauthenticate` | Re-authorize an account with expired tokens |
| `gcal_account_status` | Health check for one or all accounts |

### Calendars

| Tool | Description |
|------|-------------|
| `gcal_list_calendars` | List calendars for one account or all accounts |
| `gcal_set_calendar_filter` | Enable/disable specific sub-calendars per account |
| `gcal_get_calendar_filters` | Show current filter configuration |

### Events

| Tool | Description |
|------|-------------|
| `gcal_list_events` | List events across all accounts (merged + sorted) or filter by account |
| `gcal_create_event` | Create an event on a specific account |
| `gcal_delete_event` | Delete an event |
| `gcal_get_busy_slots` | Get busy time blocks across all accounts |

## Project Structure

```
multi-gcal-mcp/
├── packages/
│   ├── core/          # Shared: OAuth, token storage, Calendar API wrapper
│   ├── mcp/           # MCP server (14 tools, stdio + HTTP transport)
│   └── web/           # Web calendar UI (dark-mode weekly view)
├── .env               # GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET
└── package.json       # Bun workspace root
```

## Token Storage

Tokens persist at `~/.config/multi-gcal-mcp/tokens.json`. Access tokens auto-refresh using stored refresh tokens — no manual intervention needed.

Override the storage directory with `TOKENS_DIR` env var.

## Web Calendar UI

A read-only weekly calendar aggregating all connected accounts:

```bash
npm run web
# opens at http://localhost:3747
```

Color-coded by account, 7am-10pm grid, dark mode.

## Advanced: HTTP Mode + Cloudflare Tunnel

For Claude Desktop's "custom connector" UI, which routes traffic through Anthropic's cloud, you need a publicly accessible HTTPS endpoint.

<details>
<summary>HTTP mode setup</summary>

### Generate TLS Certificate

```bash
brew install mkcert
mkcert -install
mkcert -key-file ~/.config/multi-gcal-mcp/localhost-key.pem \
       -cert-file ~/.config/multi-gcal-mcp/localhost-cert.pem \
       localhost 127.0.0.1
```

### Set Up Cloudflare Tunnel

```bash
brew install cloudflare/cloudflare/cloudflared
cloudflared tunnel login
cloudflared tunnel create multi-gcal-mcp
cloudflared tunnel route dns multi-gcal-mcp gcal-mcp.YOUR_DOMAIN.com
```

Create `~/.cloudflared/multi-gcal-mcp.yml`:

```yaml
tunnel: multi-gcal-mcp
credentials-file: ~/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: gcal-mcp.YOUR_DOMAIN.com
    service: https://localhost:11976
    originRequest:
      noTLSVerify: true
  - service: http_status:404
```

### Run as launchd Services (macOS)

**MCP server** — `~/Library/LaunchAgents/com.multi-gcal-mcp.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.multi-gcal-mcp</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/ABSOLUTE/PATH/TO/multi-gcal-mcp/packages/mcp/src/index.js</string>
    <string>--http</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>GOOGLE_CLIENT_ID</key>
    <string>your_client_id</string>
    <key>GOOGLE_CLIENT_SECRET</key>
    <string>your_client_secret</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/multi-gcal-mcp.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/multi-gcal-mcp.log</string>
</dict>
</plist>
```

**Cloudflare Tunnel** — `~/Library/LaunchAgents/com.multi-gcal-mcp-tunnel.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.multi-gcal-mcp-tunnel</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/cloudflared</string>
    <string>tunnel</string>
    <string>--config</string>
    <string>/Users/YOU/.cloudflared/multi-gcal-mcp.yml</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/multi-gcal-mcp-tunnel.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/multi-gcal-mcp-tunnel.log</string>
</dict>
</plist>
```

Load both:

```bash
launchctl load ~/Library/LaunchAgents/com.multi-gcal-mcp.plist
launchctl load ~/Library/LaunchAgents/com.multi-gcal-mcp-tunnel.plist
```

### Add Connector in Claude Desktop

Settings > "Add custom connector":
- **Name:** Multi Google Calendar
- **URL:** `https://gcal-mcp.YOUR_DOMAIN.com/mcp`

</details>

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GOOGLE_CLIENT_ID` | Yes | — | OAuth client ID from Google Cloud |
| `GOOGLE_CLIENT_SECRET` | Yes | — | OAuth client secret from Google Cloud |
| `TOKENS_DIR` | No | `~/.config/multi-gcal-mcp` | Token and cert storage directory |
| `HTTP_PORT` | No | `11976` | Port for HTTP mode |
| `WEB_PORT` | No | `3747` | Port for web calendar UI |

## Troubleshooting

**"GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set"**
Check your Claude Desktop config or launchd plist has the correct env vars.

**"Could not start auth server on port 4999"**
Something else is using that port. Find it with `lsof -i :4999` and kill the process.

**Tokens expire and don't refresh**
Re-run `gcal_add_account` to get a fresh refresh token with consent prompt.

**"Account X not found"**
Call `gcal_list_accounts` to see valid account IDs.

**HTTP mode: connector shows "connection failed"**
Check tunnel status: `launchctl list | grep tunnel`. Check logs at `/tmp/multi-gcal-mcp-tunnel.log`. Verify DNS: `dig gcal-mcp.YOUR_DOMAIN.com`.

**HTTP mode: TLS handshake fails**
Re-run the `mkcert` command. Ensure Cloudflare Tunnel config has `noTLSVerify: true`.

**Cloudflare Tunnel: "failed to sufficiently increase receive buffer size"**
Non-fatal warning on macOS. The tunnel still works.

## License

MIT
