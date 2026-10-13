const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ctx = vm.createContext({Utilities: {
  DigestAlgorithm: {SHA_256: 'sha256'}, Charset: {UTF_8: 'utf8'},
  computeDigest: (_, text) => [...crypto.createHash('sha256').update(text).digest()],
  base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url'),
  newBlob: text => ({getBytes: () => [...Buffer.from(text)]})
}});
for (const name of ['Config.gs', 'Validation.gs']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', name), 'utf8'), ctx);
function payload(overrides = {}) {
  return {version: 1, action: 'submit', requestId: crypto.randomUUID(), receiptToken: crypto.randomBytes(32).toString('base64url'),
    service: 'ask-nat', intent: 'details', name: 'Test Request', email: 'nat@natwerth.com', fields: {'ask-question': 'A test question'}, hp: '', ...overrides};
}
function event(input) {
  const raw = typeof input === 'string' ? input : JSON.stringify(input);
  return {parameter: {payload: raw}, parameters: {payload: [raw]}, postData: {length: new URLSearchParams({payload: raw}).toString().length, type: 'application/x-www-form-urlencoded'}};
}
function rejects(value) { assert.throws(() => ctx.parseRequest_(event(value)), e => typeof e.code === 'string'); }

test('all current services and both intents normalize only allowed fields', () => {
  const fields = {'resume-review': {'resume-goal': ' role ', 'resume-questions': ' optional\r\nanswer '}, 'ask-nat': {'ask-question': ' question '}, 'project-help': {'project-goal': ' project ', 'project-timeline': ' soon ', 'project-budget': ' optional '}};
  for (const [service, answers] of Object.entries(fields)) for (const intent of ['details', 'booking']) {
    const result = ctx.parseRequest_(event(payload({service, intent, fields: answers})));
    assert.equal(result.data.service, service); assert.equal(result.data.intent, intent);
    assert.deepEqual(Object.keys(result.data.fields).sort(), Object.keys(answers).sort());
    Object.values(result.data.fields).forEach(v => assert.equal(v, v.trim()));
    assert.equal(Object.hasOwn(result, 'receiptToken'), false);
  }
});
test('rejects malformed contracts, unsupported version and unexpected content', () => {
  for (const value of ['{', 'null', '[]', 'false', payload({version: 2}), payload({service: '__proto__'}), payload({service: 'unknown'}), payload({intent: 'appointment'}), payload({name: 42}), payload({email: ['nat@natwerth.com']}), payload({fields: null}), payload({fields: {'ask-question': 'ok', 'resume-goal': 'not active'}}), payload({fields: {'ask-question': ' \n\t '}}), payload({name: ' \t '})]) rejects(value);
  for (const key of ['to', 'from', 'cc', 'bcc', 'subject', 'htmlBody', 'source', 'turnstileToken']) rejects(payload({[key]: 'attacker supplied'}));
});
test('single recipient validation rejects lists and header injection', () => {
  for (const email of ['a@example.com,b@example.com', 'a@example.com; b@example.com', 'Name <a@example.com>', 'a@example.com\nBcc:b@example.com', 'a@example.com\r\n', 'a..b@example.com', '.a@example.com', 'a.@example.com', 'a@localhost', 'a@-example.com', 'a@exam_ple.com', 'a'.repeat(65)+'@example.com']) rejects(payload({email}));
  assert.equal(ctx.parseRequest_(event(payload({email: 'Nat+Test@NatWerth.com'}))).data.email, 'nat+test@natwerth.com');
});
test('honors UI lengths and rejects controls, honeypot and oversize body', () => {
  ctx.parseRequest_(event(payload({name:'n'.repeat(500), fields:{'ask-question':'q'.repeat(6000)}})));
  for (const fields of [{name:'n'.repeat(501)}, {fields:{'ask-question':'q'.repeat(6001)}}, {name:'line\nbreak'}, {name:'bad\u0000data'}, {hp:'filled'}]) rejects(payload(fields));
  const oversized = event(payload()); oversized.postData.length = 400001;
  assert.throws(() => ctx.parseRequest_(oversized));
  const duplicated = event(payload()); duplicated.parameters.payload.push(duplicated.parameter.payload);
  assert.throws(() => ctx.parseRequest_(duplicated));
});
test('formula-like text remains literal through validation', () => {
  for (const prefix of ['=', '+', '-', '@', "'"]) {
    const sample = prefix + 'IMPORTXML("https://example.com","//a")';
    assert.equal(ctx.parseRequest_(event(payload({fields:{'ask-question':sample}}))).data.fields['ask-question'], sample);
  }
});
test('receipt must be UUIDv4 and an independent 256-bit shape', () => {
  for (const overrides of [{requestId:'guess'}, {requestId:'00000000-0000-1000-8000-000000000000'}, {receiptToken:'short'}, {receiptToken:'x'.repeat(44)}, {receiptToken:'='.repeat(43)}]) rejects(payload(overrides));
  const p = payload();
  const status = ctx.parseRequest_(event({version:1, action:'status', requestId:p.requestId, receiptToken:p.receiptToken}));
  assert.equal(status.requestId, p.requestId); assert.notEqual(status.receiptHash, p.receiptToken);
  assert.equal(Object.hasOwn(status, 'data'), false);
});
test('fingerprint stable across ID, receipt and normalization; different answers differ', () => {
  const a = ctx.parseRequest_(event(payload({name:' Test Request ', email:'NAT@NATWERTH.COM'})));
  const b = ctx.parseRequest_(event(payload()));
  assert.equal(a.fingerprint, b.fingerprint);
  assert.notEqual(a.receiptHash, b.receiptHash);
  const c = ctx.parseRequest_(event(payload({fields:{'ask-question':'Changed'}})));
  assert.notEqual(a.fingerprint, c.fingerprint);
});
