import { google } from 'googleapis';
import { createServer } from 'http';
import { URL } from 'url';
import { saveAccount, getAccount, getAccounts, updateAccountTokens } from './storage.js';

const REDIRECT_URI = 'http://localhost:4999/oauth/callback';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

function getCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set. ' +
      'See README for Google Cloud Console setup instructions.'
    );
  }
  return { clientId, clientSecret };
}

function makeClient() {
  const { clientId, clientSecret } = getCredentials();
  return new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
}

/** Create a ready-to-use OAuth2 client for a stored account, with auto token refresh. */
export function createClientForAccount(accountId) {
  const account = getAccount(accountId);
  if (!account) throw new Error(`Account "${accountId}" not found. Use gcal_list_accounts to see connected accounts.`);

  const client = makeClient();
  client.setCredentials(account.tokens);

  // Persist refreshed tokens automatically
  client.on('tokens', (newTokens) => {
    updateAccountTokens(accountId, newTokens);
  });

  return client;
}

// Track the running callback server so we don't spin up duplicates
let callbackServer = null;
let callbackServerTimeout = null;

function closeCallbackServer() {
  if (callbackServerTimeout) {
    clearTimeout(callbackServerTimeout);
    callbackServerTimeout = null;
  }
  if (callbackServer) {
    callbackServer.close();
    callbackServer = null;
  }
}

/**
 * Start the OAuth flow for a new account.
 * Returns the auth URL immediately; the callback server runs in the background
 * and saves the account when the user completes authorization in their browser.
 */
export async function startOAuthFlow(label) {
  closeCallbackServer(); // close any stale server from a previous attempt

  const client = makeClient();
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // always ask, so we always get a refresh_token
    state: encodeURIComponent(label || ''),
  });

  // Start a lightweight HTTP server to catch the OAuth callback
  await new Promise((resolve, reject) => {
    callbackServer = createServer(async (req, res) => {
      let parsedUrl;
      try {
        parsedUrl = new URL(req.url, 'http://localhost:4999');
      } catch {
        res.writeHead(400); res.end(); return;
      }

      if (parsedUrl.pathname !== '/oauth/callback') {
        res.writeHead(404); res.end('Not found'); return;
      }

      const code = parsedUrl.searchParams.get('code');
      const error = parsedUrl.searchParams.get('error');

      if (error || !code) {
        const msg = error || 'No authorization code received';
        res.end(html('❌ Authorization failed', `<p>${msg}</p>`));
        closeCallbackServer();
        return;
      }

      try {
        const { tokens } = await client.getToken(code);
        client.setCredentials(tokens);

        // Fetch account email via userinfo
        const oauth2Api = google.oauth2({ version: 'v2', auth: client });
        const { data: userInfo } = await oauth2Api.userinfo.get();
        const email = userInfo.email;

        const accountId = email.replace(/[@.+]/g, '_');
        const accountLabel = decodeURIComponent(parsedUrl.searchParams.get('state') || '') || email;

        saveAccount(accountId, { label: accountLabel, email, tokens, connectedAt: new Date().toISOString() });

        // Set up auto-refresh for this new client instance
        client.on('tokens', (newTokens) => updateAccountTokens(accountId, newTokens));

        res.end(html(
          '✅ Connected!',
          `<p><strong>${email}</strong> (${accountLabel}) has been added.</p>
           <p>Return to Claude — your account is ready.</p>`
        ));
      } catch (err) {
        res.end(html('❌ Error', `<p>${err.message}</p>`));
      }

      closeCallbackServer();
    });

    callbackServer.on('error', (err) => {
      callbackServer = null;
      reject(new Error(`Could not start auth server on port 4999: ${err.message}`));
    });

    callbackServer.listen(4999, () => resolve());
  });

  // Auto-close if user never completes auth within 10 minutes
  callbackServerTimeout = setTimeout(closeCallbackServer, 10 * 60 * 1000);

  return authUrl;
}

/**
 * Check whether an account's tokens are still valid by making a lightweight API call.
 * Returns { ok, email, error }.
 */
export async function checkAccountHealth(accountId) {
  const client = createClientForAccount(accountId);
  try {
    const oauth2Api = google.oauth2({ version: 'v2', auth: client });
    const { data } = await oauth2Api.userinfo.get();
    return { ok: true, email: data.email };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function html(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
    <style>body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#333}
    h2{font-size:2rem;margin-bottom:.5rem}</style></head>
    <body><h2>${title}</h2>${body}<p style="margin-top:2rem;color:#999;font-size:.9rem">You can close this window.</p></body></html>`;
}
