import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const authModuleUrl = pathToFileURL(`${process.cwd()}/packages/core/src/auth.js`).href;

async function importFreshAuth(overrides = {}) {
  const previous = {
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    GOOGLE_CALLBACK_PORT: process.env.GOOGLE_CALLBACK_PORT,
    OAUTH_CALLBACK_PORT: process.env.OAUTH_CALLBACK_PORT,
    GOOGLE_OAUTH_CALLBACK_MODE: process.env.GOOGLE_OAUTH_CALLBACK_MODE,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  };

  Object.assign(process.env, overrides);

  const mod = await import(`${authModuleUrl}?t=${Date.now()}-${Math.random()}`);

  return {
    mod,
    restore() {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}

test('getOAuthConfig uses public redirect URI while still defaulting to a local callback listener', async () => {
  const { mod, restore } = await importFreshAuth({
    GOOGLE_REDIRECT_URI: 'https://gcal.sethwebster.com/oauth/callback',
  });

  try {
    const config = mod.getOAuthConfig();
    assert.equal(config.redirectUri, 'https://gcal.sethwebster.com/oauth/callback');
    assert.equal(config.callbackPathname, '/oauth/callback');
    assert.equal(config.usesLocalCallbackServer, true);
    assert.equal(config.callbackPort, 4999);
  } finally {
    restore();
  }
});

test('getOAuthConfig can disable the local callback listener in http-server mode', async () => {
  const { mod, restore } = await importFreshAuth({
    GOOGLE_REDIRECT_URI: 'https://gcal.sethwebster.com/oauth/callback',
    GOOGLE_OAUTH_CALLBACK_MODE: 'http-server',
  });

  try {
    const config = mod.getOAuthConfig();
    assert.equal(config.usesLocalCallbackServer, false);
    assert.equal(config.callbackMode, 'http-server');
  } finally {
    restore();
  }
});

test('getOAuthConfig preserves localhost callback port', async () => {
  const { mod, restore } = await importFreshAuth({
    GOOGLE_REDIRECT_URI: 'http://localhost:8123/oauth/callback',
  });

  try {
    const config = mod.getOAuthConfig();
    assert.equal(config.usesLocalCallbackServer, true);
    assert.equal(config.callbackPort, 8123);
    assert.equal(mod.getOAuthCallbackPath(), '/oauth/callback');
  } finally {
    restore();
  }
});

test('getOAuthScopes includes Gmail permissions needed for inbox access', async () => {
  const { mod, restore } = await importFreshAuth({});

  try {
    const scopes = mod.getOAuthScopes();
    assert.ok(scopes.includes('https://www.googleapis.com/auth/gmail.readonly'));
    assert.ok(scopes.includes('https://www.googleapis.com/auth/gmail.modify'));
    assert.ok(scopes.includes('https://www.googleapis.com/auth/gmail.compose'));
  } finally {
    restore();
  }
});

test('handleOAuthCallbackRequest rejects unknown or expired state', async () => {
  const { mod, restore } = await importFreshAuth({
    GOOGLE_REDIRECT_URI: 'https://gcal.sethwebster.com/oauth/callback',
    GOOGLE_CLIENT_ID: 'dummy-client-id',
    GOOGLE_CLIENT_SECRET: 'dummy-client-secret',
  });

  try {
    const response = await mod.handleOAuthCallbackRequest('/oauth/callback?code=test-code&state=missing-state');
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /expired|already been used|missing/i);
  } finally {
    restore();
  }
});
