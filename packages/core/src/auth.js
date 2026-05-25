import { google } from 'googleapis';
import { createServer } from 'http';
import { URL } from 'url';
import { randomUUID } from 'crypto';
import { saveAccount, getAccount, updateAccountTokens } from './storage.js';

const DEFAULT_REDIRECT_URI = 'http://localhost:4999/oauth/callback';
const PENDING_TTL_MS = 10 * 60 * 1000;

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
];

export function getOAuthScopes() {
  return [...SCOPES];
}

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

export function getOAuthConfig() {
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || DEFAULT_REDIRECT_URI;
  const redirectUrl = new URL(redirectUri);
  const callbackMode = process.env.GOOGLE_OAUTH_CALLBACK_MODE || process.env.OAUTH_CALLBACK_MODE || 'local-server';
  const callbackPort = Number(
    process.env.GOOGLE_CALLBACK_PORT ||
    process.env.OAUTH_CALLBACK_PORT ||
    redirectUrl.port ||
    4999
  );

  return {
    redirectUri,
    redirectUrl,
    callbackPathname: redirectUrl.pathname || '/oauth/callback',
    callbackPort,
    callbackMode,
    usesLocalCallbackServer: callbackMode !== 'http-server',
  };
}

export function getOAuthCallbackPath() {
  return getOAuthConfig().callbackPathname;
}

function makeClient() {
  const { clientId, clientSecret } = getCredentials();
  return new google.auth.OAuth2(clientId, clientSecret, getOAuthConfig().redirectUri);
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

const pendingAuthorizations = new Map();

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

function pruneExpiredPendingAuthorizations() {
  const cutoff = Date.now() - PENDING_TTL_MS;
  for (const [state, pending] of pendingAuthorizations.entries()) {
    if (pending.createdAt < cutoff) pendingAuthorizations.delete(state);
  }
}

function createPendingAuthorization(label) {
  pruneExpiredPendingAuthorizations();
  const state = randomUUID();
  pendingAuthorizations.set(state, {
    label: label || '',
    createdAt: Date.now(),
  });
  return state;
}

function consumePendingAuthorization(state) {
  pruneExpiredPendingAuthorizations();
  if (!state) return null;
  const pending = pendingAuthorizations.get(state) || null;
  if (pending) pendingAuthorizations.delete(state);
  return pending;
}

function peekPendingAuthorization(state) {
  pruneExpiredPendingAuthorizations();
  return state ? (pendingAuthorizations.get(state) || null) : null;
}

/**
 * Start the OAuth flow for a new account.
 * Returns the auth URL immediately. In localhost mode, a callback server runs in the background.
 * In public-callback mode, the caller must route GET /oauth/callback to handleOAuthCallbackRequest().
 */
export async function startOAuthFlow(label) {
  const config = getOAuthConfig();
  if (config.usesLocalCallbackServer) {
    closeCallbackServer(); // close any stale server from a previous attempt
  }

  const client = makeClient();
  const state = createPendingAuthorization(label);
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // always ask, so we always get a refresh_token
    state,
  });

  if (!config.usesLocalCallbackServer) {
    return authUrl;
  }

  // Start a lightweight HTTP server to catch the OAuth callback
  await new Promise((resolve, reject) => {
    callbackServer = createServer(async (req, res) => {
      const response = await handleOAuthCallbackRequest(req.url);
      res.writeHead(response.statusCode, { 'Content-Type': response.contentType });
      res.end(response.body);
      closeCallbackServer();
    });

    callbackServer.on('error', (err) => {
      callbackServer = null;
      pendingAuthorizations.delete(state);
      reject(new Error(`Could not start auth server on port ${config.callbackPort}: ${err.message}`));
    });

    callbackServer.listen(config.callbackPort, () => resolve());
  });

  // Auto-close if user never completes auth within 10 minutes
  callbackServerTimeout = setTimeout(() => {
    pendingAuthorizations.delete(state);
    closeCallbackServer();
  }, PENDING_TTL_MS);

  return authUrl;
}

export async function handleOAuthCallbackRequest(requestUrl) {
  const config = getOAuthConfig();

  let parsedUrl;
  try {
    parsedUrl = new URL(requestUrl, config.redirectUri);
  } catch {
    return textResponse(400, 'Bad request');
  }

  if (parsedUrl.pathname !== config.callbackPathname) {
    return textResponse(404, 'Not found');
  }

  const code = parsedUrl.searchParams.get('code');
  const error = parsedUrl.searchParams.get('error');
  const state = parsedUrl.searchParams.get('state');

  if (error || !code) {
    if (state) consumePendingAuthorization(state);
    const msg = error || 'No authorization code received';
    return htmlResponse('❌ Authorization failed', `<p>${escapeHtml(msg)}</p>`);
  }

  const pending = peekPendingAuthorization(state);
  if (!pending) {
    return htmlResponse(
      '❌ Authorization failed',
      '<p>This authorization request is missing, expired, or has already been used. Start the connection flow again.</p>'
    );
  }

  const client = makeClient();

  try {
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // Fetch account email via userinfo
    const oauth2Api = google.oauth2({ version: 'v2', auth: client });
    const { data: userInfo } = await oauth2Api.userinfo.get();
    const email = userInfo.email;

    const accountId = email.replace(/[@.+]/g, '_');
    const accountLabel = pending.label || email;

    saveAccount(accountId, { label: accountLabel, email, tokens, connectedAt: new Date().toISOString() });

    // Set up auto-refresh for this new client instance
    client.on('tokens', (newTokens) => updateAccountTokens(accountId, newTokens));

    consumePendingAuthorization(state);

    return htmlResponse(
      '✅ Connected!',
      `<p><strong>${escapeHtml(email)}</strong> (${escapeHtml(accountLabel)}) has been added.</p>
       <p>Return to Hermes — your account is ready.</p>`
    );
  } catch (err) {
    consumePendingAuthorization(state);
    return htmlResponse('❌ Error', `<p>${escapeHtml(err.message)}</p>`);
  }
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

function textResponse(statusCode, body) {
  return { statusCode, contentType: 'text/plain; charset=utf-8', body };
}

function htmlResponse(title, body) {
  return {
    statusCode: 200,
    contentType: 'text/html; charset=utf-8',
    body: html(title, body),
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function html(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
    <style>body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#333}
    h2{font-size:2rem;margin-bottom:.5rem}</style></head>
    <body><h2>${title}</h2>${body}<p style="margin-top:2rem;color:#999;font-size:.9rem">You can close this window.</p></body></html>`;
}
