import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_DIR = process.env.TOKENS_DIR || join(homedir(), '.config', 'multi-gcal-mcp');
const TOKENS_FILE = join(CONFIG_DIR, 'tokens.json');

function ensureDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function load() {
  ensureDir();
  if (!existsSync(TOKENS_FILE)) return { accounts: {} };
  try {
    return JSON.parse(readFileSync(TOKENS_FILE, 'utf-8'));
  } catch {
    return { accounts: {} };
  }
}

function save(data) {
  ensureDir();
  writeFileSync(TOKENS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export function getAccounts() {
  return load().accounts || {};
}

export function getAccount(id) {
  return load().accounts?.[id] ?? null;
}

export function saveAccount(id, data) {
  const storage = load();
  storage.accounts = storage.accounts || {};
  storage.accounts[id] = data;
  save(storage);
}

export function removeAccount(id) {
  const storage = load();
  if (storage.accounts) delete storage.accounts[id];
  save(storage);
}

export function updateAccountTokens(id, newTokens) {
  const storage = load();
  if (!storage.accounts?.[id]) return;
  storage.accounts[id].tokens = { ...storage.accounts[id].tokens, ...newTokens };
  save(storage);
}

export function updateAccountLabel(id, label) {
  const storage = load();
  if (!storage.accounts?.[id]) return false;
  storage.accounts[id].label = label;
  save(storage);
  return true;
}

export function getTokensFilePath() {
  return TOKENS_FILE;
}

export function getCalendarFilters() {
  return load().calendarFilters || {};
}

export function setCalendarFilter(accountId, calendarIds) {
  const storage = load();
  storage.calendarFilters = storage.calendarFilters || {};
  storage.calendarFilters[accountId] = calendarIds;
  save(storage);
}

export function getEnabledCalendars(accountId) {
  const filters = load().calendarFilters || {};
  return filters[accountId] ?? ['primary'];
}
