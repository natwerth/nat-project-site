import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint, normalizeAnswers, createReceipt, readReceipt, writeReceipt,
  RECEIPT_STORAGE_KEY, isEnvelope, isConfigured, savedMessage, postPayload } from '../form-protocol.js';

const endpoint = 'https://script.google.com/macros/s/test-deployment/exec';
const answers = {
  service: 'project-help', intent: 'booking', name: ' Visitor ', email: 'VISITOR@example.com ',
  fields: { 'project-goal': ' Help me\r\nbuild a website. ', 'project-timeline': ' May ', 'project-budget': '', 'ask-question': 'Exclude inactive details' }, hp: ''
};
const resultFor = (requestId, changes = {}) => ({ version: 1, requestId, ok: true, state: 'complete',
  ownerEmailState: 'sent', confirmationEmailState: 'sent', errorCode: null, retryable: false, ...changes });
const memoryStorage = () => {
  const entries = new Map();
  return { getItem: key => entries.get(key) || null, setItem: (key, value) => entries.set(key, value) };
};

test('Only the production Apps Script URL shape enables submission', () => {
  assert.equal(isConfigured({ endpoint }), true);
  for (const value of ['', endpoint.replace('/exec', '/dev'), 'https://example.com/macros/s/id/exec', `${endpoint}?secret=bad`, `${endpoint}#receipt`, 'https://user:pass@script.google.com/macros/s/id/exec']) {
    assert.equal(isConfigured({ endpoint: value }), false);
  }
});

test('Payload includes only active allowlisted answers; normalization is stable', async () => {
  const normalized = normalizeAnswers(answers);
  assert.deepEqual(normalized.fields, { 'project-goal': 'Help me\nbuild a website.', 'project-timeline': 'May', 'project-budget': '' });
  assert.equal(normalized.email, 'visitor@example.com');
  assert.equal(await fingerprint(answers), await fingerprint(normalized));
  assert.notEqual(await fingerprint(answers), await fingerprint({ ...answers, fields: { ...answers.fields, 'project-goal': 'A different request' } }));
  assert.notEqual(await fingerprint(answers), await fingerprint({ ...answers, intent: 'details' }));
});

test('Receipt credentials are random and persisted without personal answers', async () => {
  const digest = await fingerprint(answers);
  const receipt = createReceipt(digest);
  const other = createReceipt(digest);
  assert.match(receipt.requestId, /^[0-9a-f-]{36}$/);
  assert.match(receipt.receiptToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(receipt.receiptToken, 'base64url').length, 32);
  assert.notEqual(receipt.requestId, other.requestId);
  assert.notEqual(receipt.receiptToken, other.receiptToken);
  receipt.result = resultFor(receipt.requestId);
  receipt.name = answers.name;
  receipt.email = answers.email;
  receipt.fields = answers.fields;
  receipt.result.arbitraryContent = answers;
  const storage = memoryStorage();
  assert.equal(writeReceipt(receipt, storage), true);
  const raw = storage.getItem(RECEIPT_STORAGE_KEY);
  assert.equal(raw.includes('VISITOR'), false);
  assert.equal(raw.includes('website'), false);
  assert.equal(raw.includes('arbitraryContent'), false);
  const recovered = readReceipt(storage);
  assert.equal(recovered.requestId, receipt.requestId);
  assert.equal(recovered.receiptToken, receipt.receiptToken);
  assert.equal(recovered.result.state, 'complete');
  assert.equal(readReceipt({ getItem() { throw new Error('Storage blocked'); } }), null);
  assert.equal(writeReceipt(receipt, { setItem() { throw new Error('Storage blocked'); } }), false);
  storage.setItem(RECEIPT_STORAGE_KEY, '{"requestId":"not-a-credential"}');
  assert.equal(readReceipt(storage), null);
});

test('Envelope requires matching receipt and explicit complete email states', () => {
  const id = createReceipt('0'.repeat(64)).requestId;
  assert.equal(isEnvelope(resultFor(id), id), true);
  for (const change of [{ version: 2 }, { requestId: 'another' }, { state: 'unknown' }, { ownerEmailState: 'pending' }, { retryable: undefined }, { ok: undefined }]) {
    assert.equal(isEnvelope(resultFor(id, change), id), false);
  }
  assert.equal(isEnvelope(resultFor(id, { state: 'saved_pending_email', confirmationEmailState: 'pending' }), id), true);
  assert.equal(isEnvelope(resultFor(id, { ok: false, state: 'rejected', errorCode: 'PAUSED' }), id), true);
  assert.equal(isEnvelope({ ok: true }, id), false);
});

test('Browser transport is readable simple POST, without custom headers or credential URLs', async () => {
  const receipt = createReceipt('0'.repeat(64));
  for (const action of ['submit', 'status']) {
    const payload = { version: 1, action, requestId: receipt.requestId, receiptToken: receipt.receiptToken, ...(action === 'submit' ? normalizeAnswers(answers) : {}) };
    let calls = 0;
    const result = await postPayload(endpoint, payload, { fetchAPI: async (url, options) => {
      calls++;
      assert.equal(url, endpoint);
      assert.equal(options.method, 'POST');
      assert.equal(options.mode, 'cors');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.redirect, 'follow');
      assert.equal(options.headers, undefined);
      assert.ok(options.body instanceof URLSearchParams);
      assert.deepEqual(JSON.parse(options.body.get('payload')), payload);
      assert.equal(options.signal.aborted, false);
      return { ok: true, json: async () => resultFor(receipt.requestId) };
    } });
    assert.equal(calls, 1);
    assert.equal(result.state, 'complete');
  }
});

test('HTTP success alone and mismatched responses never confirm receipt or auto-resubmit', async () => {
  const receipt = createReceipt('0'.repeat(64));
  let calls = 0;
  for (const returned of [{ ok: true }, resultFor('wrong-id'), resultFor(receipt.requestId, { confirmationEmailState: 'sending' })]) {
    await assert.rejects(postPayload(endpoint, receipt, { fetchAPI: async () => {
      calls++;
      return { ok: true, json: async () => returned };
    } }), /Unconfirmed response/);
  }
  assert.equal(calls, 3);
});

test('Browser timeout aborts locally and does not retry the submission', async () => {
  const receipt = createReceipt('0'.repeat(64));
  let calls = 0;
  await assert.rejects(postPayload(endpoint, receipt, { timeoutMs: 5, fetchAPI: async (_url, options) => {
    calls++;
    return await new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('Locally aborted')), { once: true }));
  } }), /Locally aborted/);
  assert.equal(calls, 1);
});

test('Saved states describe partial and uncertain email progress truthfully', () => {
  assert.match(savedMessage({ state: 'saved_pending_email', confirmationEmailState: 'pending' }), /saved—confirmation email pending/);
  assert.match(savedMessage({ state: 'needs_review' }), /saved.*manual check/);
  assert.match(savedMessage({ state: 'saved_pending_email', confirmationEmailState: 'sent' }), /notification to Nat is still pending/);
});
