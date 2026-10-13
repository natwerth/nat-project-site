function response_(requestId, ok, state, ownerState, confirmationState, errorCode, retryable) {
  return { version: 1, requestId: requestId || null, ok: !!ok, state: state,
    ownerEmailState: ownerState || 'not_started', confirmationEmailState: confirmationState || 'not_started',
    errorCode: errorCode || null, retryable: !!retryable };
}
function publicRow_(row) {
  return response_(row.requestId, true, row.state, row.ownerState, row.confirmationState, row.errorCode, row.state === 'saved_pending_email' || row.state === 'processing');
}
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function safeRequestId_(event) {
  try {
    var text = event.parameter.payload;
    if (typeof text !== 'string' || text.length > 60000) return null;
    var id = JSON.parse(text).requestId;
    return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id.toLowerCase() : null;
  } catch (_) { return null; }
}

/** GET is always harmless; no request fields, Sheet access or Gmail calls. */
function doGet() { return json_(response_(null, true, 'complete', 'not_started', 'not_started', null, false)); }
function doPost(event) {
  var requestId = safeRequestId_(event), saved = false, cfg;
  try {
    var request = parseRequest_(event);
    if (request.action === 'probe') return json_(response_(null, !request.testError, request.testError ? 'rejected' : 'complete', 'not_started', 'not_started', request.testError ? 'PROBE_ERROR' : null, false));
    requestId = request.requestId;
    cfg = config_();
    var result = lock_(function() {
      var store = openStore_(cfg), existing = findSubmission_(store, request.requestId);
      if (existing) {
        if (!equalHash_(existing.receiptHash, request.receiptHash)) fail_('RECEIPT_NOT_FOUND');
        if (request.action === 'submit' && !equalHash_(existing.fingerprint, request.fingerprint)) fail_('REQUEST_ID_CONFLICT');
        reconcileLeases_(store, existing, cfg);
        return { row: existing, created: false };
      }
      if (request.action === 'status') fail_('RECEIPT_NOT_FOUND');
      if (cfg.paused) fail_('PAUSED', true);
      return { row: createSubmission_(store, request, cfg), created: true };
    });
    saved = true;
    // Receipt reads and duplicate submissions never send mail. Retry trigger handles pending work.
    if (result.created) processSubmission_(requestId, cfg);
    var row = lock_(function() { return findSubmission_(openStore_(cfg), requestId); });
    return json_(publicRow_(row));
  } catch (error) {
    if (saved) {
      try {
        var persisted = lock_(function() { return findSubmission_(openStore_(cfg), requestId); });
        if (persisted) return json_(publicRow_(persisted));
      } catch (_) { /* Known saved, but current mail state cannot be read. */ }
      return json_(response_(requestId, true, 'saved_pending_email', 'pending', 'pending', 'STATUS_UNAVAILABLE', true));
    }
    // Never stringify a Google error or return raw exceptions, configuration or form contents.
    var known = error instanceof FormError;
    return json_(response_(requestId, false, 'rejected', 'not_started', 'not_started', known ? error.code : 'TEMPORARY_FAILURE', known ? error.retryable : true));
  }
}
