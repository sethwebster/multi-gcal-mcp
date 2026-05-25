import { google } from 'googleapis';
import { createClientForAccount } from './auth.js';

function gmailApi(client) {
  return google.gmail({ version: 'v1', auth: client });
}

function getHeader(payload, name) {
  return payload?.headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value;
}

function decodeBase64Url(value) {
  if (!value) return '';
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function extractPlainText(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  for (const part of payload.parts || []) {
    const text = extractPlainText(part);
    if (text) return text;
  }
  return '';
}

export function formatMessageSummary(message) {
  return {
    id: message.id,
    threadId: message.threadId,
    labelIds: message.labelIds || [],
    snippet: message.snippet || '',
    subject: getHeader(message.payload, 'Subject') || '(No subject)',
    from: getHeader(message.payload, 'From') || '',
    to: getHeader(message.payload, 'To') || '',
    date: getHeader(message.payload, 'Date') || '',
    internalDate: message.internalDate,
  };
}

export function formatMessageDetail(message) {
  return {
    ...formatMessageSummary(message),
    cc: getHeader(message.payload, 'Cc') || '',
    bcc: getHeader(message.payload, 'Bcc') || '',
    textBody: extractPlainText(message.payload),
    historyId: message.historyId,
    sizeEstimate: message.sizeEstimate,
  };
}

export function formatMessageListResponse({ messages = [], nextPageToken = null, resultSizeEstimate = 0 }) {
  return {
    messages,
    nextPageToken,
    resultSizeEstimate,
  };
}

export async function listMessagesForAccount(accountId, {
  maxResults = 10,
  pageToken,
  q,
  labelIds,
  includeSpamTrash = false,
} = {}) {
  const client = createClientForAccount(accountId);
  const gmail = gmailApi(client);

  const params = {
    userId: 'me',
    maxResults,
    includeSpamTrash,
  };
  if (pageToken) params.pageToken = pageToken;
  if (q) params.q = q;
  if (labelIds?.length) params.labelIds = labelIds;

  const { data } = await gmail.users.messages.list(params);
  const messages = await Promise.all(
    (data.messages || []).map(async ({ id }) => {
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date'],
      });
      return formatMessageSummary(detail.data);
    })
  );

  return formatMessageListResponse({
    messages,
    nextPageToken: data.nextPageToken || null,
    resultSizeEstimate: data.resultSizeEstimate || 0,
  });
}

export async function searchMessagesForAccount(accountId, {
  query,
  maxResults = 10,
  pageToken,
  labelIds,
  includeSpamTrash = false,
} = {}) {
  return listMessagesForAccount(accountId, {
    q: query,
    maxResults,
    pageToken,
    labelIds,
    includeSpamTrash,
  });
}

export async function getMessageForAccount(accountId, messageId, { format = 'full' } = {}) {
  const client = createClientForAccount(accountId);
  const gmail = gmailApi(client);
  const { data } = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format,
  });
  return formatMessageDetail(data);
}
