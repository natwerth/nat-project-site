const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const sourceDir = path.join(__dirname, '..', 'src');
const sources = fs.readdirSync(sourceDir).filter(name => name.endsWith('.gs')).map(name => fs.readFileSync(path.join(sourceDir, name), 'utf8')).join('\n');

function harness(overrides = {}) {
  const state = { time: Date.parse('2026-10-12T15:00:00Z'), locked: false, quota: 1500, sent: [], writes: [], beforeWrite: null, afterWrite: null, onSend: null, sheets: {}, properties: { ENVIRONMENT: 'test', PAUSED: 'false', TEST_EMAIL_ENABLED: 'true', TEST_SPREADSHEET_ID: 'test-book', ...overrides } };
  class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [state.time])); } static now() { return state.time; } }
  const book = { getId: () => 'test-book', getDeveloperMetadata: () => [{ getKey: () => 'FORM_ENVIRONMENT', getValue: () => 'test' }], getSheetByName: name => state.sheets[name] };
  function sheet(name) { return state.sheets[name] = { values: [], getName: () => name, getParent: () => book, getMaxRows: () => 10000, getMaxColumns: () => 100 }; }
  sheet('Submissions'); sheet('Email attempts');
  const properties = { getProperties: () => ({ ...state.properties }), getProperty: key => state.properties[key], setProperty: (key, value) => state.properties[key] = value, setProperties: entries => Object.assign(state.properties, entries) };
  const context = vm.createContext({
    Date: FakeDate, console,
    PropertiesService: { getScriptProperties: () => properties },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_, value) => [...crypto.createHash('sha256').update(value).digest()],
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url'),
      newBlob: value => ({ getBytes: () => [...Buffer.from(value)] }), getUuid: () => crypto.randomUUID(),
      formatDate: date => date.toISOString()
    },
    LockService: { getScriptLock: () => ({ tryLock() { assert.equal(state.locked, false, 'Lock must not span send or reentrant work'); state.locked = true; return true; }, releaseLock() { state.locked = false; } }) },
    SpreadsheetApp: { openById: id => { assert.equal(id, 'test-book'); return book; } },
    Sheets: { Spreadsheets: { Values: {
      get(id, range, options) {
        assert.equal(id, 'test-book'); assert.equal(options.valueRenderOption, 'UNFORMATTED_VALUE');
        const [, name, start, end] = /^'([^']+)'!A(\d+)?(?::[A-Z]+(\d+)?)?$/.exec(range);
        return { values: state.sheets[name].values.slice(Number(start || 1) - 1, end ? Number(end) : undefined).map(values => [...values]) };
      },
      update(body, id, range, options) {
        assert.equal(state.locked, true, 'Every persistence mutation holds ScriptLock');
        assert.equal(options.valueInputOption, 'RAW', 'Never parse user strings as formulas');
        assert.equal(id, 'test-book');
        const [, name, row] = /^'([^']+)'!A(\d+)$/.exec(range);
        const write = { name, row: Number(row), values: [...body.values[0]] };
        if (state.beforeWrite) state.beforeWrite(write);
        state.sheets[name].values[Number(row) - 1] = [...body.values[0]];
        state.writes.push(write);
        if (state.afterWrite) state.afterWrite(write);
        return { updatedRows: 1 };
      }
    } } },
    MailApp: { getRemainingDailyQuota: () => state.quota },
    GmailApp: { getAliases: () => ['info@natwerth.com'], sendEmail(...args) { assert.equal(state.locked, false, 'Gmail must run outside ScriptLock'); state.sent.push(args); state.quota--; if (state.onSend) state.onSend(args); } },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'nat@natwerth.com' }) },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) }
  });
  vm.runInContext(sources, context);
  state.sheets.Submissions.values.push(context.SUBMISSION_COLUMNS.map(entry => entry[1]));
  state.sheets['Email attempts'].values.push(context.ATTEMPT_COLUMNS.map(entry => entry[1]));
  const payload = (changes = {}) => ({ version: 1, action: 'submit', requestId: crypto.randomUUID(), receiptToken: crypto.randomBytes(32).toString('base64url'), service: 'ask-nat', intent: 'details', name: 'Test Visitor', email: 'nat@natwerth.com', fields: { 'ask-question': 'Harmless test question' }, hp: '', ...changes });
  function post(input) { const text = JSON.stringify(input); return JSON.parse(context.doPost({ postData: { length: Buffer.byteLength(text) }, parameter: { payload: text }, parameters: { payload: [text] } }).text); }
  const status = input => post({ version: 1, action: 'status', requestId: input.requestId, receiptToken: input.receiptToken });
  const getRow = input => context.findSubmission_(context.openStore_(context.config_()), input.requestId);
  const index = key => context.SUBMISSION_COLUMNS.findIndex(entry => entry[0] === key);
  const attemptIndex = key => context.ATTEMPT_COLUMNS.findIndex(entry => entry[0] === key);
  return { state, context, payload, post, status, getRow, index, attemptIndex };
}

test('two independent emails, literal RAW storage, private receipt and duplicate idempotency', () => {
  const h = harness(), input = h.payload({ name: '=1+1', fields: { 'ask-question': '+123\n-123\n@SUM(A1:A2)' } });
  assert.equal(h.post(input).state, 'complete');
  assert.equal(h.state.sent.length, 2);
  assert.equal(h.state.sheets.Submissions.values.length, 2);
  assert.equal(h.getRow(input).name, '=1+1');
  assert.equal(h.getRow(input)['ask-question'], input.fields['ask-question']);
  assert.notEqual(h.getRow(input).receiptHash, input.receiptToken);
  assert.equal(JSON.stringify(h.state.sheets).includes(input.receiptToken), false);
  assert.equal(h.post(input).state, 'complete');
  assert.equal(h.status(input).state, 'complete');
  assert.equal(h.state.sent.length, 2);
  assert.equal(h.state.sent[0][3].from, 'info@natwerth.com');
  assert.equal(h.state.sent[0][3].replyTo, 'nat@natwerth.com');
  assert.equal(h.state.sent[1][3].replyTo, 'info@natwerth.com');
  assert.equal(h.state.sent[1][2].includes(input.fields['ask-question']), false);
});

test('incorrect receipts reveal the same response as unknown IDs; old IDs reject changed payload', () => {
  const h = harness(), input = h.payload(); h.post(input);
  const wrong = h.status({ ...input, receiptToken: 'A'.repeat(43) });
  const unknown = h.status(h.payload());
  assert.equal(wrong.errorCode, 'RECEIPT_NOT_FOUND');
  assert.equal(unknown.errorCode, wrong.errorCode);
  assert.deepEqual(Object.keys(wrong).sort(), ['version', 'requestId', 'ok', 'state', 'ownerEmailState', 'confirmationEmailState', 'errorCode', 'retryable'].sort());
  assert.equal(h.post({ ...input, name: 'Changed' }).errorCode, 'REQUEST_ID_CONFLICT');
  assert.equal(h.state.sent.length, 2);
});

test('missing alias, disabled test mail, pause and test recipient isolation cause no mail', () => {
  for (const properties of [{ TEST_EMAIL_ENABLED: 'false' }, { PAUSED: 'true' }, { TEST_ALLOWED_RECIPIENTS: '' }]) {
    const h = harness(properties), result = h.post(h.payload());
    assert.notEqual(result.state, 'complete'); assert.equal(h.state.sent.length, 0);
  }
  const h = harness();
  assert.equal(h.post(h.payload({ email: 'thirdparty@example.com' })).errorCode, 'TEST_RECIPIENT_REQUIRED');
  h.context.GmailApp.getAliases = () => [];
  assert.equal(h.post(h.payload()).state, 'saved_pending_email');
  assert.equal(h.state.sent.length, 0);
});

test('quota deferral sends later once, without retrying accepted owner mail at daily cap', () => {
  const h = harness({ SEND_DAILY_CAP: '1' }), input = h.payload();
  let result = h.post(input);
  assert.equal(result.state, 'saved_pending_email'); assert.equal(result.ownerEmailState, 'sent'); assert.equal(result.confirmationEmailState, 'pending');
  assert.equal(h.state.sent.length, 1);
  h.state.time += 86400001;
  h.context.retryPendingEmails();
  assert.equal(h.status(input).state, 'complete'); assert.equal(h.state.sent.length, 2);
  const low = harness(), second = low.payload(); low.state.quota = 50;
  assert.equal(low.post(second).errorCode, 'QUOTA_PENDING'); assert.equal(low.state.sent.length, 0);
  low.state.quota = 1500; low.state.time += 3600001; low.context.retryPendingEmails();
  assert.equal(low.status(second).state, 'complete'); assert.equal(low.state.sent.length, 2);
});

test('Gmail exception is uncertain, successful owner is never sent again', () => {
  const h = harness(), input = h.payload();
  h.state.onSend = () => { if (h.state.sent.length === 2) throw new Error('Provider detail must stay private'); };
  const result = h.post(input);
  assert.equal(result.state, 'needs_review'); assert.equal(result.ownerEmailState, 'sent'); assert.equal(result.confirmationEmailState, 'needs_review');
  assert.equal(JSON.stringify(result).includes('Provider'), false);
  h.state.time += 86400000; h.context.retryPendingEmails();
  assert.equal(h.state.sent.length, 2);
  assert.equal(h.getRow(input).ownerAttempts, 1);
});

test('foreground and trigger overlap cannot claim the same email twice', () => {
  const h = harness(), input = h.payload(); let invoked = false;
  h.state.onSend = () => { if (!invoked) { invoked = true; h.context.retryPendingEmails(); } };
  const result = h.post(input);
  assert.equal(result.state, 'complete'); assert.equal(h.state.sent.length, 2);
  assert.equal(h.getRow(input).ownerAttempts, 1); assert.equal(h.getRow(input).confirmationAttempts, 1);
});

test('initial Sheet failure sends nothing; ambiguous persisted save is recovered by receipt', () => {
  const h = harness(), input = h.payload(); let failed = false;
  h.state.afterWrite = write => { if (!failed && write.name === 'Submissions') { failed = true; throw new Error('Lost write response'); } };
  assert.equal(h.post(input).errorCode, 'TEMPORARY_FAILURE'); assert.equal(h.state.sent.length, 0);
  assert.equal(h.status(input).state, 'saved_pending_email');
  assert.equal(h.post(input).state, 'saved_pending_email'); assert.equal(h.state.sheets.Submissions.values.length, 2);
  h.context.retryPendingEmails();
  assert.equal(h.status(input).state, 'complete'); assert.equal(h.state.sent.length, 2);
});

test('failed attempt-log persistence before send causes no send and never blind retry', () => {
  const h = harness(), input = h.payload(); let failed = false;
  h.state.beforeWrite = write => { if (!failed && write.name === 'Email attempts') { failed = true; throw new Error('No log write'); } };
  assert.equal(h.post(input).state, 'processing'); assert.equal(h.state.sent.length, 0);
  h.state.time += 600001; h.context.retryPendingEmails();
  const result = h.status(input);
  assert.equal(result.ownerEmailState, 'needs_review'); assert.equal(result.confirmationEmailState, 'sent'); assert.equal(h.state.sent.length, 1);
});

test('accepted send with lost outcome write becomes needs_review without resending', () => {
  const h = harness(), input = h.payload(); let failed = false;
  h.state.beforeWrite = write => { if (!failed && write.name === 'Email attempts' && write.values[h.attemptIndex('outcome')] === 'accepted') { failed = true; throw new Error('Lost outcome'); } };
  assert.equal(h.post(input).state, 'processing'); assert.equal(h.state.sent.length, 1);
  h.state.time += 600001; h.context.retryPendingEmails();
  assert.equal(h.status(input).ownerEmailState, 'needs_review'); assert.equal(h.state.sent.length, 2);
});

test('durable accepted attempt repairs a failed submission-state write without resending', () => {
  const h = harness(), input = h.payload(); let failed = false;
  h.state.beforeWrite = write => { if (!failed && write.name === 'Submissions' && write.values[h.index('ownerState')] === 'sent') { failed = true; throw new Error('Lost state write'); } };
  assert.equal(h.post(input).state, 'processing'); assert.equal(h.state.sent.length, 1);
  h.state.time += 600001; h.context.retryPendingEmails();
  assert.equal(h.status(input).state, 'complete'); assert.equal(h.state.sent.length, 2);
});

test('conclusively unsent pre-send config change retries only within capped attempts', () => {
  const h = harness(), input = h.payload(); let changed = false;
  h.state.afterWrite = write => { if (!changed && write.name === 'Email attempts') { changed = true; h.state.properties.PAUSED = 'true'; } };
  assert.equal(h.post(input).state, 'saved_pending_email'); assert.equal(h.state.sent.length, 0);
  assert.equal(h.getRow(input).ownerAttempts, 1);
  h.state.properties.PAUSED = 'false'; h.state.time += 300001; h.context.retryPendingEmails();
  assert.equal(h.status(input).state, 'complete'); assert.equal(h.state.sent.length, 2); assert.equal(h.getRow(input).ownerAttempts, 2);
});

test('recipient submission caps apply under lock; status and probes consume no mail', () => {
  const h = harness({ RECIPIENT_HOURLY_CAP: '1' });
  assert.equal(h.post(h.payload()).state, 'complete');
  assert.equal(h.post(h.payload()).errorCode, 'RATE_LIMITED');
  assert.equal(h.state.sheets.Submissions.values.length, 2);
  const sends = h.state.sent.length;
  assert.equal(h.post({ version: 1, action: 'probe' }).ok, true);
  assert.equal(h.post({ version: 1, action: 'probe', testError: true }).errorCode, 'PROBE_ERROR');
  assert.equal(JSON.parse(h.context.doGet().text).ok, true);
  assert.equal(h.state.sent.length, sends);
});
