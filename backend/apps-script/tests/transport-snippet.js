/*
 * Load in a browser document on https://www.natwerth.com, then run:
 * await window.natwerthTransportProbe.run('https://script.google.com/macros/s/DEPLOYMENT_ID/exec')
 * Only use the isolated probe deployment. No PII, emails, or Sheet writes.
 * This file is also usable from DevTools without publishing a test page.
 */
(function () {
  'use strict';
  const origin = 'https://www.natwerth.com';
  const keys = ['version', 'requestId', 'ok', 'state', 'ownerEmailState',
    'confirmationEmailState', 'errorCode', 'retryable'].sort();

  function endpointUrl(value) {
    const url = new URL(value);
    if (url.origin !== 'https://script.google.com' ||
        !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) ||
        url.search || url.hash || url.username || url.password) {
      throw new Error('Use the isolated probe versioned /exec URL without query parameters.');
    }
    return url.href;
  }

  function isEnvelope(value, expected) {
    return value && typeof value === 'object' && !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys) &&
      value.version === 1 && value.requestId === expected.requestId &&
      value.ok === expected.ok && value.state === expected.state &&
      value.ownerEmailState === 'not_applicable' &&
      value.confirmationEmailState === 'not_applicable' &&
      value.errorCode === expected.errorCode && value.retryable === false;
  }

  async function run(value) {
    if (location.origin !== origin) {
      throw new Error('Open the real https://www.natwerth.com site before testing transport.');
    }
    const endpoint = endpointUrl(value);
    const results = [];
    async function check(label, body, expected) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);
      const started = performance.now();
      const result = { case: label, passed: false };
      try {
        const response = await fetch(endpoint, {
          method: body === null ? 'GET' : 'POST',
          ...(body === null ? {} : { body: new URLSearchParams({ payload: body }) }),
          credentials: 'omit',
          mode: 'cors',
          redirect: 'follow',
          signal: controller.signal
        });
        result.httpStatus = response.status;
        result.responseType = response.type;
        result.redirected = response.redirected;
        result.responseOrigin = new URL(response.url).origin;
        result.contentType = response.headers.get('content-type');
        let envelope;
        try { envelope = await response.json(); }
        catch (_) { throw new Error('Response was not readable JSON.'); }
        result.passed = response.ok && response.type !== 'opaque' && isEnvelope(envelope, expected);
        // Do not echo an unexpected server response: it may contain private data.
        if (result.passed) result.envelope = envelope;
        else result.error = 'Response did not match the harmless probe contract.';
      } catch (error) {
        result.error = error.name === 'AbortError' ? 'Browser request timed out after 60 seconds.' :
          error instanceof TypeError ? 'Fetch failed; inspect browser Network and Console for the redirect/CORS/access error.' :
            'Response was not readable probe JSON.';
      } finally {
        clearTimeout(timer);
        result.elapsedMs = Math.round(performance.now() - started);
      }
      results.push(result);
      return result.passed;
    }

    const identificationPassed = await check('probe identity (safe GET)', null, {
      requestId: null, ok: false, state: 'rejected', errorCode: 'PROBE_POST_REQUIRED'
    });
    if (identificationPassed) {
      for (const scenario of ['success', 'reject']) {
        const requestId = crypto.randomUUID();
        await check(scenario, JSON.stringify({ version: 1, action: 'probe', requestId, scenario }), {
          requestId, ok: scenario === 'success',
          state: scenario === 'success' ? 'complete' : 'rejected',
          errorCode: scenario === 'success' ? null : 'PROBE_REJECTED'
        });
      }
      await check('malformed JSON', '{', {
        requestId: null, ok: false, state: 'rejected', errorCode: 'INVALID_JSON'
      });
    }
    const report = {
      scope: 'Harmless probe transport only; does not verify production submissions or email.',
      origin: location.origin,
      page: location.pathname,
      userAgent: navigator.userAgent,
      measuredAt: new Date().toISOString(),
      passed: results.length === 4 && results.every(result => result.passed),
      results
    };
    console.info('Natwerth harmless transport probe', report);
    return report;
  }
  window.natwerthTransportProbe = Object.freeze({ run });
}());
