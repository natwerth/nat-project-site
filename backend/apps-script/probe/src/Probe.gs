/**
 * Isolated, harmless transport probe. Deploy in its own Apps Script project.
 * No Sheets, Properties, Gmail, UrlFetch, triggers, or submission persistence.
 * Only a valid random request ID is echoed. Do not paste personal data here.
 */
function doGet() {
  return probeOutput_(null, false, 'rejected', 'PROBE_POST_REQUIRED');
}

function doPost(e) {
  var raw = e && e.parameter && e.parameter.payload;
  if (typeof raw !== 'string' || raw.length > 2048) {
    return probeOutput_(null, false, 'rejected', 'INVALID_PAYLOAD');
  }
  var payload;
  try {
    payload = JSON.parse(raw);
  } catch (_) {
    return probeOutput_(null, false, 'rejected', 'INVALID_JSON');
  }
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    return probeOutput_(null, false, 'rejected', 'INVALID_PAYLOAD');
  }
  var requestId = typeof payload.requestId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.requestId)
    ? payload.requestId : null;
  if (payload.version !== 1 || payload.action !== 'probe' || !requestId ||
      Object.keys(payload).some(function (key) {
        return ['version', 'action', 'requestId', 'scenario'].indexOf(key) === -1;
      })) {
    return probeOutput_(requestId, false, 'rejected', 'INVALID_PAYLOAD');
  }
  if (payload.scenario === 'reject') {
    return probeOutput_(requestId, false, 'rejected', 'PROBE_REJECTED');
  }
  if (payload.scenario !== 'success') {
    return probeOutput_(requestId, false, 'rejected', 'INVALID_SCENARIO');
  }
  return probeOutput_(requestId, true, 'complete', null);
}

function probeOutput_(requestId, ok, state, errorCode) {
  return ContentService.createTextOutput(JSON.stringify({
    version: 1,
    requestId: requestId,
    ok: ok,
    state: state,
    ownerEmailState: 'not_applicable',
    confirmationEmailState: 'not_applicable',
    errorCode: errorCode,
    retryable: false
  })).setMimeType(ContentService.MimeType.JSON);
}
