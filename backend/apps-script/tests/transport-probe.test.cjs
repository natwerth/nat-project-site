'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');

const probeRoot = path.resolve(__dirname, '../probe/src');
function probeRuntime() {
  const context = vm.createContext({
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(text) { return { text, setMimeType() { return this; } }; }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(probeRoot, 'Probe.gs'), 'utf8'), context);
  return context;
}
function send(context, payload) {
  return JSON.parse(context.doPost({ parameter: { payload } }).text);
}

test('isolated probe needs no data, email, network, or trigger scopes', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(probeRoot, 'appsscript.json'), 'utf8'));
  assert.deepEqual(manifest.oauthScopes, []);
  assert.deepEqual(manifest.webapp, { access: 'ANYONE_ANONYMOUS', executeAs: 'USER_DEPLOYING' });
  const context = probeRuntime();
  const requestId = randomUUID();
  const response = send(context, JSON.stringify({ version: 1, requestId, action: 'probe', scenario: 'success' }));
  assert.deepEqual(response, {
    version: 1, requestId, ok: true, state: 'complete', ownerEmailState: 'not_applicable',
    confirmationEmailState: 'not_applicable', errorCode: null, retryable: false
  });
});

test('error transport is explicit and does not echo arbitrary submitted text', () => {
  const context = probeRuntime();
  const requestId = randomUUID();
  assert.equal(JSON.parse(context.doGet().text).errorCode, 'PROBE_POST_REQUIRED');
  const rejected = send(context, JSON.stringify({ version: 1, requestId, action: 'probe', scenario: 'reject' }));
  assert.equal(rejected.ok, false);
  assert.equal(rejected.errorCode, 'PROBE_REJECTED');
  assert.equal(rejected.requestId, requestId);
  for (const payload of ['{', 'null', '[]', '"private data"', 'x'.repeat(2049),
    JSON.stringify({ version: 1, requestId: 'private data', action: 'probe', scenario: 'success' })]) {
    const result = send(context, payload);
    assert.equal(result.ok, false);
    assert.equal(result.requestId, null);
    assert.ok(!JSON.stringify(result).includes('private data'));
  }
});

test('browser snippet sends form-encoded anonymous requests and verifies all four envelopes', async () => {
  const server = probeRuntime();
  const sent = [];
  const context = vm.createContext({
    URL, URLSearchParams, AbortController, setTimeout, clearTimeout, performance,
    crypto: { randomUUID },
    location: { origin: 'https://www.natwerth.com', pathname: '/services/' },
    navigator: { userAgent: 'unit-test-only' },
    console: { info() {} },
    window: {},
    async fetch(url, options) {
      sent.push({ url, options });
      const output = options.method === 'GET' ? server.doGet() :
        server.doPost({ parameter: { payload: options.body.get('payload') } });
      return {
        ok: true, status: 200, type: 'cors', redirected: true,
        url: 'https://script.googleusercontent.com/test',
        headers: new Map([['content-type', 'application/json']]),
        async json() { return JSON.parse(output.text); }
      };
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'transport-snippet.js'), 'utf8'), context);
  const report = await context.window.natwerthTransportProbe.run('https://script.google.com/macros/s/probe-id/exec');
  assert.equal(report.passed, true);
  assert.equal(sent.length, 4);
  for (const request of sent) {
    assert.equal(request.options.credentials, 'omit');
    assert.equal(request.options.mode, 'cors');
    assert.equal(request.options.redirect, 'follow');
    assert.equal(request.options.headers, undefined);
    if (request.options.method === 'POST') assert.ok(request.options.body instanceof URLSearchParams);
  }
});
