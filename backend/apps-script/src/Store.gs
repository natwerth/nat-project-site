// RAW Sheets API writes keep =, +, -, @ and apostrophe-prefixed text literal.
// Never replace these writes with appendRow/setValues for user-supplied values.
var SUBMISSION_COLUMNS = [
  ['requestId', 'Request ID'], ['createdAt', 'Created (UTC)'], ['updatedAt', 'Updated (UTC)'],
  ['localCreatedAt', 'Created (America/Chicago)'], ['source', 'Source'], ['service', 'Service'], ['intent', 'Intent'],
  ['name', 'Name'], ['email', 'Email'], ['resume-goal', 'Target role'], ['resume-questions', 'Resume questions'],
  ['ask-question', 'Question'], ['project-goal', 'Project goal'], ['project-timeline', 'Timeline'], ['project-budget', 'Budget'],
  ['fingerprint', 'Payload fingerprint'], ['receiptHash', 'Receipt hash'], ['recipientHash', 'Recipient hash'],
  ['state', 'Processing state'], ['ownerState', 'Owner email state'], ['confirmationState', 'Confirmation email state'],
  ['ownerAttempts', 'Owner attempts'], ['confirmationAttempts', 'Confirmation attempts'],
  ['nextRetryAt', 'Next retry (UTC)'], ['errorCode', 'Error category'],
  ['ownerNextRetryAt', 'Owner retry (UTC)'], ['confirmationNextRetryAt', 'Confirmation retry (UTC)'],
  ['ownerAttemptId', 'Owner attempt ID'], ['confirmationAttemptId', 'Confirmation attempt ID'],
  ['ownerLeaseUntil', 'Owner lease expires (UTC)'], ['confirmationLeaseUntil', 'Confirmation lease expires (UTC)'],
  ['ownerError', 'Owner error category'], ['confirmationError', 'Confirmation error category']
];
var ATTEMPT_COLUMNS = [
  ['requestId', 'Request ID'], ['kind', 'Email type'], ['attemptId', 'Attempt ID'],
  ['startedAt', 'Started (UTC)'], ['endedAt', 'Ended (UTC)'], ['outcome', 'Outcome'], ['errorCode', 'Error category']
];

function openStore_(cfg) {
  if (!cfg.spreadsheetId) fail_('NOT_CONFIGURED');
  var book = SpreadsheetApp.openById(cfg.spreadsheetId);
  var binding = book.getDeveloperMetadata().filter(function(m) { return m.getKey() === 'FORM_ENVIRONMENT'; });
  if (binding.length !== 1 || binding[0].getValue() !== cfg.environment) fail_('NOT_CONFIGURED');
  var store = { book: book, submissions: book.getSheetByName('Submissions'), attempts: book.getSheetByName('Email attempts') };
  verifySchema_(store.submissions, SUBMISSION_COLUMNS);
  verifySchema_(store.attempts, ATTEMPT_COLUMNS);
  return store;
}
function verifySchema_(sheet, columns) {
  if (!sheet) fail_('NOT_CONFIGURED');
  var actual = readValues_(sheet, 'A1:' + columnName_(columns.length) + '1')[0] || [];
  if (columns.some(function(column, i) { return actual[i] !== column[1]; })) fail_('NOT_CONFIGURED');
}
function rawWrite_(book, sheet, rowNumber, values) {
  if (sheet.getMaxRows() < rowNumber) sheet.insertRowsAfter(sheet.getMaxRows(), Math.max(100, rowNumber - sheet.getMaxRows()));
  if (sheet.getMaxColumns() < values.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), values.length - sheet.getMaxColumns());
  var range = "'" + sheet.getName().replace(/'/g, "''") + "'!A" + rowNumber;
  Sheets.Spreadsheets.Values.update({ range: range, majorDimension: 'ROWS', values: [values] }, book.getId(), range, { valueInputOption: 'RAW' });
}
function columnName_(number) {
  var name = '';
  while (number > 0) { number--; name = String.fromCharCode(65 + number % 26) + name; number = Math.floor(number / 26); }
  return name;
}
function readValues_(sheet, range) {
  var address = "'" + sheet.getName().replace(/'/g, "''") + "'!" + range;
  return Sheets.Spreadsheets.Values.get(sheet.getParent().getId(), address, { valueRenderOption: 'UNFORMATTED_VALUE' }).values || [];
}
function rows_(sheet, columns) {
  return readValues_(sheet, 'A2:' + columnName_(columns.length)).map(function(values, i) {
    var result = { _row: i + 2 };
    columns.forEach(function(column, j) { result[column[0]] = values[j] === undefined ? '' : values[j]; });
    return result;
  });
}
function writeRow_(store, sheet, columns, record) {
  if (!record._row) record._row = readValues_(sheet, 'A1:' + columnName_(columns.length)).length + 1;
  rawWrite_(store.book, sheet, record._row, columns.map(function(column) { return record[column[0]] === undefined ? '' : record[column[0]]; }));
}
function findSubmission_(store, requestId) {
  var matches = rows_(store.submissions, SUBMISSION_COLUMNS).filter(function(row) { return row.requestId === requestId; });
  // A manually duplicated ID must never cause another send.
  if (matches.length > 1) fail_('TEMPORARY_FAILURE');
  return matches[0] || null;
}
function findAttempt_(store, attemptId) {
  var matches = rows_(store.attempts, ATTEMPT_COLUMNS).filter(function(row) { return row.attemptId === attemptId; });
  if (matches.length > 1) fail_('TEMPORARY_FAILURE');
  return matches[0] || null;
}
function deriveState_(row) {
  var states = [row.ownerState, row.confirmationState];
  row.state = states.indexOf('needs_review') >= 0 ? 'needs_review' : states.every(function(s) { return s === 'sent'; }) ? 'complete' : states.indexOf('sending') >= 0 ? 'processing' : 'saved_pending_email';
  row.errorCode = row.state === 'needs_review' ? 'NEEDS_REVIEW' : row.state === 'complete' ? '' : row.ownerError || row.confirmationError || '';
  var times = [row.ownerNextRetryAt, row.confirmationNextRetryAt].filter(Boolean).sort();
  row.nextRetryAt = times[0] || '';
  row.updatedAt = now_();
  return row;
}
function saveSubmission_(store, row) { writeRow_(store, store.submissions, SUBMISSION_COLUMNS, deriveState_(row)); }
function saveAttempt_(store, row) { writeRow_(store, store.attempts, ATTEMPT_COLUMNS, row); }
function createSubmission_(store, request, cfg) {
  var all = rows_(store.submissions, SUBMISSION_COLUMNS), time = Date.now();
  var recent = all.filter(function(row) { return Date.parse(row.createdAt) > time - 86400000; });
  if (recent.length >= cfg.submissionCap || recent.filter(function(row) { return row.recipientHash === request.recipientHash && Date.parse(row.createdAt) > time - 3600000; }).length >= cfg.recipientCap) fail_('RATE_LIMITED', true);
  if (cfg.environment === 'test' && request.data.email !== cfg.testRecipient) fail_('TEST_RECIPIENT_REQUIRED');
  var row = {
    requestId: request.requestId, createdAt: now_(), localCreatedAt: Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy-MM-dd HH:mm:ss z'),
    source: 'consulting', service: request.data.service, intent: request.data.intent, name: request.data.name, email: request.data.email,
    fingerprint: request.fingerprint, receiptHash: request.receiptHash, recipientHash: request.recipientHash,
    ownerState: 'pending', confirmationState: 'pending', ownerAttempts: 0, confirmationAttempts: 0
  };
  Object.keys(request.data.fields).forEach(function(key) { row[key] = request.data.fields[key]; });
  saveSubmission_(store, row);
  return row;
}
