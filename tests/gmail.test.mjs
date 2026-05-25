import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const gmailModuleUrl = pathToFileURL(`${process.cwd()}/packages/core/src/gmail.js`).href;

async function importFreshGmail() {
  return import(`${gmailModuleUrl}?t=${Date.now()}-${Math.random()}`);
}

test('gmail core exposes list/get/search functions', async () => {
  const mod = await importFreshGmail();

  assert.equal(typeof mod.listMessagesForAccount, 'function');
  assert.equal(typeof mod.getMessageForAccount, 'function');
  assert.equal(typeof mod.searchMessagesForAccount, 'function');
});

test('formatMessageListResponse preserves pagination tokens and result estimate', async () => {
  const mod = await importFreshGmail();

  const result = mod.formatMessageListResponse({
    messages: [
      { id: 'm1', threadId: 't1' },
      { id: 'm2', threadId: 't2' },
    ],
    nextPageToken: 'next-page',
    resultSizeEstimate: 42,
  });

  assert.deepEqual(result, {
    messages: [
      { id: 'm1', threadId: 't1' },
      { id: 'm2', threadId: 't2' },
    ],
    nextPageToken: 'next-page',
    resultSizeEstimate: 42,
  });
});

test('formatMessageDetail extracts readable headers and snippet', async () => {
  const mod = await importFreshGmail();

  const result = mod.formatMessageDetail({
    id: 'msg-123',
    threadId: 'thread-456',
    labelIds: ['INBOX', 'UNREAD'],
    snippet: 'hello world',
    internalDate: '1776497351986',
    payload: {
      headers: [
        { name: 'From', value: 'Alice <alice@example.com>' },
        { name: 'To', value: 'Seth <sethwebster@gmail.com>' },
        { name: 'Subject', value: 'Test subject' },
        { name: 'Date', value: 'Sat, 18 Apr 2026 01:00:00 -0400' },
      ],
      mimeType: 'text/plain',
    },
  });

  assert.equal(result.id, 'msg-123');
  assert.equal(result.threadId, 'thread-456');
  assert.equal(result.subject, 'Test subject');
  assert.equal(result.from, 'Alice <alice@example.com>');
  assert.equal(result.to, 'Seth <sethwebster@gmail.com>');
  assert.equal(result.snippet, 'hello world');
  assert.deepEqual(result.labelIds, ['INBOX', 'UNREAD']);
});
