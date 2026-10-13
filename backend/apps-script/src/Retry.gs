function retryPendingEmails() {
  var cfg = config_();
  if (cfg.paused) return { processed: 0, paused: true };
  var started = Date.now();
  var ids = lock_(function() {
    var store = openStore_(cfg);
    return rows_(store.submissions, SUBMISSION_COLUMNS).filter(function(row) {
      return ['owner', 'confirmation'].some(function(kind) {
        return row[kind + 'State'] === 'sending' && !(Date.parse(row[kind + 'LeaseUntil']) > Date.now()) ||
          row[kind + 'State'] === 'pending' && !(Date.parse(row[kind + 'NextRetryAt']) > Date.now());
      });
    }).slice(0, cfg.batchSize).map(function(row) { return row.requestId; });
  });
  var processed = 0;
  for (var i = 0; i < ids.length && Date.now() - started < 240000; i++) {
    try { processSubmission_(ids[i], cfg); processed++; } catch (_) { /* Durable leases preserve uncertainty. No contents in logs. */ }
  }
  return { processed: processed, paused: false };
}

/** Owner-only editor operation. Confirm the actual outcome before resolving uncertainty. */
function resolveEmailReview(requestId, kind, resolution) {
  if (['owner', 'confirmation'].indexOf(kind) < 0 || ['mark_sent', 'retry_confirmed_unsent'].indexOf(resolution) < 0) fail_('INVALID_REQUEST');
  var cfg = config_();
  return lock_(function() {
    var store = openStore_(cfg), row = findSubmission_(store, requestId);
    if (!row || row[kind + 'State'] !== 'needs_review') fail_('INVALID_REQUEST');
    if (resolution === 'retry_confirmed_unsent' && Number(row[kind + 'Attempts']) >= cfg.maxAttempts) fail_('ATTEMPTS_EXHAUSTED');
    var attempt = findAttempt_(store, row[kind + 'AttemptId']);
    if (attempt) {
      attempt.outcome = resolution === 'mark_sent' ? 'accepted' : 'not_sent';
      attempt.errorCode = resolution === 'mark_sent' ? 'MANUALLY_CONFIRMED_SENT' : 'MANUALLY_CONFIRMED_UNSENT';
      attempt.endedAt = now_(); saveAttempt_(store, attempt);
    }
    row[kind + 'State'] = resolution === 'mark_sent' ? 'sent' : 'pending';
    row[kind + 'Error'] = ''; row[kind + 'LeaseUntil'] = ''; row[kind + 'NextRetryAt'] = '';
    saveSubmission_(store, row);
    return publicRow_(row);
  });
}
