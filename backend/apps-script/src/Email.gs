function emailMessage_(row, kind, cfg) {
  var service = FORM_SERVICES[row.service], reference = row.requestId;
  var options = { from: cfg.alias, name: cfg.siteName, replyTo: kind === 'owner' ? row.email : cfg.alias };
  var recipient = kind === 'owner' ? cfg.owner : row.email;
  if (cfg.environment === 'test') recipient = cfg.testRecipient;
  var subject, body;
  if (kind === 'owner') {
    subject = service.label + ' request [' + reference + ']';
    var lines = ['A new ' + service.label + ' request was saved.', '', 'Reference: ' + reference,
      'Received (UTC): ' + row.createdAt, 'Name: ' + row.name, 'Email: ' + row.email,
      'Intent: ' + (row.intent === 'booking' ? 'Booking request (no appointment confirmed)' : 'Request for details'), ''];
    Object.keys(service.fields).forEach(function(key) { if (row[key]) lines.push(service.fields[key].label + ':', String(row[key]), ''); });
    body = lines.join('\n');
  } else {
    subject = "I've received your " + service.label + ' request';
    body = "Thanks for reaching out. I've received your " + service.label + ' request and will follow up by email.\n\n' +
      (row.intent === 'booking' ? 'This is a request to book; an appointment has not yet been confirmed.\n\n' : '') +
      'Reference: ' + reference + '\n\nNat Werth';
  }
  if (cfg.environment === 'test') subject = '[TEST] ' + subject;
  return { recipient: recipient, subject: subject, body: body, options: options };
}

function mailConfigurationReady_(cfg, row) {
  if (cfg.paused) return 'PAUSED';
  if (cfg.environment === 'test' && (!cfg.testEmailEnabled || !validEmail_(cfg.testRecipient) ||
      cfg.testAllowed.indexOf(cfg.testRecipient) < 0 || row.email !== cfg.testRecipient)) return 'CONFIGURATION_PENDING';
  try {
    var effectiveEmail = Session.getEffectiveUser().getEmail().toLowerCase();
    if (effectiveEmail !== cfg.owner.toLowerCase()) return 'CONFIGURATION_PENDING';
    var aliases = GmailApp.getAliases().map(function(address) { return address.toLowerCase(); });
    if (aliases.indexOf(cfg.alias.toLowerCase()) < 0) return 'CONFIGURATION_PENDING';
  } catch (_) { return 'CONFIGURATION_PENDING'; }
  return '';
}

function backoffAt_(row, kind, cfg) {
  return new Date(Date.now() + Math.min(86400000, cfg.retryBaseMs * Math.pow(2, Math.max(0, Number(row[kind + 'Attempts']) - 1)))).toISOString();
}
function waitForMail_(store, row, kind, code, cfg) {
  row[kind + 'Error'] = code;
  row[kind + 'NextRetryAt'] = new Date(Date.now() + (code === 'QUOTA_PENDING' || code === 'SEND_CAP_PENDING' ? 3600000 : cfg.retryBaseMs)).toISOString();
  saveSubmission_(store, row);
}

/** Must hold ScriptLock. A stale claim is reconciled from its durable attempt log. */
function reconcileLeases_(store, row, cfg) {
  var changed = false;
  ['owner', 'confirmation'].forEach(function(kind) {
    if (row[kind + 'State'] !== 'sending' || Date.parse(row[kind + 'LeaseUntil']) > Date.now()) return;
    var attempt = findAttempt_(store, row[kind + 'AttemptId']);
    if (attempt && attempt.outcome === 'accepted') {
      row[kind + 'State'] = 'sent'; row[kind + 'Error'] = '';
    } else if (attempt && attempt.outcome === 'not_sent' && Number(row[kind + 'Attempts']) < cfg.maxAttempts) {
      row[kind + 'State'] = 'pending'; row[kind + 'Error'] = 'RETRY_PENDING';
      row[kind + 'NextRetryAt'] = backoffAt_(row, kind, cfg);
    } else {
      row[kind + 'State'] = 'needs_review'; row[kind + 'Error'] = 'SEND_UNCERTAIN';
      if (attempt && attempt.outcome === 'sending') {
        attempt.outcome = 'uncertain'; attempt.endedAt = now_(); attempt.errorCode = 'LEASE_EXPIRED';
        saveAttempt_(store, attempt);
      }
    }
    row[kind + 'LeaseUntil'] = '';
    if (row[kind + 'State'] !== 'pending') row[kind + 'NextRetryAt'] = '';
    changed = true;
  });
  if (changed) saveSubmission_(store, row);
  return row;
}

/** Persist claim AND attempt before touching Gmail. Lock never spans Gmail.sendEmail. */
function claimEmail_(requestId, kind, cfg, readiness) {
  return lock_(function() {
    var currentCfg = config_();
    if (currentCfg.environment !== cfg.environment || currentCfg.spreadsheetId !== cfg.spreadsheetId || currentCfg.paused) return null;
    var store = openStore_(cfg), row = findSubmission_(store, requestId);
    if (!row) return null;
    reconcileLeases_(store, row, cfg);
    if (row[kind + 'State'] !== 'pending' || Date.parse(row[kind + 'NextRetryAt'] || '') > Date.now()) return null;
    if (Number(row[kind + 'Attempts']) >= cfg.maxAttempts) {
      row[kind + 'State'] = 'needs_review'; row[kind + 'Error'] = 'ATTEMPTS_EXHAUSTED'; saveSubmission_(store, row); return null;
    }
    if (readiness) { waitForMail_(store, row, kind, readiness, cfg); return null; }
    var attempts = rows_(store.attempts, ATTEMPT_COLUMNS);
    var recent = attempts.filter(function(attempt) { return Date.parse(attempt.startedAt) > Date.now() - 86400000; });
    if (recent.length >= cfg.sendCap) { waitForMail_(store, row, kind, 'SEND_CAP_PENDING', cfg); return null; }
    var reservations = rows_(store.submissions, SUBMISSION_COLUMNS).reduce(function(total, r) {
      return total + (r.ownerState === 'sending' ? 1 : 0) + (r.confirmationState === 'sending' ? 1 : 0);
    }, 0);
    var remaining;
    try { remaining = MailApp.getRemainingDailyQuota(); } catch (_) { waitForMail_(store, row, kind, 'QUOTA_PENDING', cfg); return null; }
    if (remaining <= cfg.quotaBuffer + reservations) { waitForMail_(store, row, kind, 'QUOTA_PENDING', cfg); return null; }
    var attemptId = Utilities.getUuid();
    row[kind + 'State'] = 'sending'; row[kind + 'AttemptId'] = attemptId;
    row[kind + 'Attempts'] = Number(row[kind + 'Attempts']) + 1;
    row[kind + 'LeaseUntil'] = new Date(Date.now() + cfg.leaseMs).toISOString();
    row[kind + 'NextRetryAt'] = ''; row[kind + 'Error'] = '';
    saveSubmission_(store, row);
    // If this log write fails, Gmail is never invoked. The stale claim conservatively needs review.
    var attempt = { requestId: requestId, kind: kind, attemptId: attemptId, startedAt: now_(), endedAt: '', outcome: 'sending', errorCode: '' };
    saveAttempt_(store, attempt);
    return { row: row, attempt: attempt };
  });
}

function finishEmail_(claim, outcome, errorCode, cfg) {
  lock_(function() {
    var store = openStore_(cfg), row = findSubmission_(store, claim.row.requestId), kind = claim.attempt.kind;
    if (!row || row[kind + 'AttemptId'] !== claim.attempt.attemptId || row[kind + 'State'] !== 'sending') return;
    var attempt = findAttempt_(store, claim.attempt.attemptId);
    if (!attempt) fail_('TEMPORARY_FAILURE', true);
    attempt.endedAt = now_(); attempt.outcome = outcome; attempt.errorCode = errorCode || '';
    // Log outcome first. If the subsequent row write fails, lease recovery uses this durable result.
    saveAttempt_(store, attempt);
    row[kind + 'State'] = outcome === 'accepted' ? 'sent' : outcome === 'not_sent' && Number(row[kind + 'Attempts']) < cfg.maxAttempts ? 'pending' : 'needs_review';
    row[kind + 'Error'] = outcome === 'accepted' ? '' : errorCode;
    row[kind + 'LeaseUntil'] = '';
    row[kind + 'NextRetryAt'] = row[kind + 'State'] === 'pending' ? backoffAt_(row, kind, cfg) : '';
    saveSubmission_(store, row);
  });
}

function processSubmission_(requestId, cfg) {
  if (cfg.paused) return;
  var snapshot = lock_(function() { return findSubmission_(openStore_(cfg), requestId); });
  if (!snapshot) return;
  var readiness = mailConfigurationReady_(cfg, snapshot);
  ['owner', 'confirmation'].forEach(function(kind) {
    var claim = claimEmail_(requestId, kind, cfg, readiness);
    if (!claim) return;
    var currentCfg, message;
    try {
      currentCfg = config_();
      // Changes during execution require a later fresh preflight, without sending now.
      if (JSON.stringify(currentCfg) !== JSON.stringify(cfg)) throw new Error('configuration changed');
      message = emailMessage_(claim.row, kind, cfg);
    } catch (_) { finishEmail_(claim, 'not_sent', 'CONFIGURATION_PENDING', cfg); return; }
    var outcome = 'accepted', code = '';
    try { GmailApp.sendEmail(message.recipient, message.subject, message.body, message.options); }
    catch (_) {
      // A thrown Gmail operation may have been accepted remotely. Never guess from error text.
      outcome = 'uncertain'; code = 'SEND_UNCERTAIN';
    }
    finishEmail_(claim, outcome, code, cfg);
  });
}
