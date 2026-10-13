/** Fills missing properties only; never overwrites an existing choice or secret. */
function initializeConfiguration() {
  var properties = PropertiesService.getScriptProperties(), existing = properties.getProperties(), missing = {};
  Object.keys(FORM_DEFAULTS).forEach(function(key) { if (existing[key] === undefined) missing[key] = FORM_DEFAULTS[key]; });
  properties.setProperties(missing, false);
  return { initialized: Object.keys(missing), environment: config_().environment, paused: config_().paused };
}

/** Creates one private spreadsheet per environment; no public sharing operation exists. */
function setupSpreadsheet() {
  initializeConfiguration();
  var cfg = config_();
  if (Session.getEffectiveUser().getEmail().toLowerCase() !== cfg.owner.toLowerCase()) fail_('NOT_CONFIGURED');
  return lock_(function() {
    var properties = PropertiesService.getScriptProperties(), property = cfg.environment === 'test' ? 'TEST_SPREADSHEET_ID' : 'PRODUCTION_SPREADSHEET_ID';
    var currentId = properties.getProperty(property), book;
    if (currentId) {
      book = SpreadsheetApp.openById(currentId);
      var bindings = book.getDeveloperMetadata().filter(function(metadata) { return metadata.getKey() === 'FORM_ENVIRONMENT'; });
      if (bindings.length !== 1 || bindings[0].getValue() !== cfg.environment) fail_('NOT_CONFIGURED');
    } else {
      book = SpreadsheetApp.create((cfg.environment === 'test' ? '[TEST] ' : '') + 'natwerth.com service requests');
      book.addDeveloperMetadata('FORM_ENVIRONMENT', cfg.environment);
      // Remember creation before formatting so retries finish setup without creating another Sheet.
      properties.setProperty(property, book.getId());
    }
    book.setSpreadsheetTimeZone('America/Chicago');
    prepareSheet_(book, 'Submissions', SUBMISSION_COLUMNS);
    prepareSheet_(book, 'Email attempts', ATTEMPT_COLUMNS);
    var unused = book.getSheetByName('Sheet1');
    if (unused && unused.getLastRow() === 0 && book.getSheets().length > 2) book.deleteSheet(unused);
    cfg.spreadsheetId = book.getId();
    openStore_(cfg);
    // Returned only to an authorized editor invocation, never a public handler.
    return { environment: cfg.environment, spreadsheetId: book.getId(), spreadsheetUrl: book.getUrl(), paused: cfg.paused };
  });
}

function prepareSheet_(book, name, columns) {
  var sheet = book.getSheetByName(name) || book.insertSheet(name);
  if (sheet.getMaxColumns() < columns.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), columns.length - sheet.getMaxColumns());
  var existing = readValues_(sheet, 'A1:' + columnName_(columns.length));
  if (!existing.length) rawWrite_(book, sheet, 1, columns.map(function(column) { return column[1]; }));
  else verifySchema_(sheet, columns);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, columns.length).setFontWeight('bold').setBackground('#173a48').setFontColor('#ffffff').setWrap(true);
  sheet.setRowHeight(1, 44);
  sheet.setColumnWidths(1, columns.length, 160);
  sheet.getRange(2, 1, sheet.getMaxRows() - 1, columns.length).setWrap(true).setVerticalAlignment('top');
  if (!sheet.getFilter()) sheet.getRange(1, 1, sheet.getMaxRows(), columns.length).createFilter();
  if (name === 'Submissions') {
    sheet.setColumnWidth(1, 285); sheet.setColumnWidths(8, 8, 240);
    var stateColumn = columnName_(SUBMISSION_COLUMNS.map(function(column) { return column[0]; }).indexOf('state') + 1);
    var range = sheet.getRange(2, 1, sheet.getMaxRows() - 1, columns.length);
    sheet.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + stateColumn + '2="needs_review"').setBackground('#fce4e4').setRanges([range]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=OR($' + stateColumn + '2="saved_pending_email",$' + stateColumn + '2="processing")').setBackground('#fff4ce').setRanges([range]).build()
    ]);
  }
}

function installRetryTrigger() {
  return lock_(function() {
    var cfg = config_(); openStore_(cfg);
    var triggers = ScriptApp.getProjectTriggers().filter(function(trigger) { return trigger.getHandlerFunction() === 'retryPendingEmails'; });
    // Retain one existing trigger, remove only duplicate triggers for our handler.
    triggers.slice(1).forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
    if (!triggers.length) ScriptApp.newTrigger('retryPendingEmails').timeBased().everyMinutes(5).create();
    return { handler: 'retryPendingEmails', count: 1, intervalMinutes: 5 };
  });
}

/** Read-only diagnostics: no mail, no submission writes, no secrets in its result. */
function setupDiagnostics() {
  var cfg = config_(), result = { environment: cfg.environment, paused: cfg.paused, configurationReady: true, sheetReady: false, ownerMatches: false, aliasAvailable: false, quotaRemaining: null, quotaBuffer: cfg.quotaBuffer, retryTriggerCount: 0, testRecipientAllowed: false };
  try { openStore_(cfg); result.sheetReady = true; } catch (_) { result.configurationReady = false; }
  try { result.ownerMatches = Session.getEffectiveUser().getEmail().toLowerCase() === cfg.owner.toLowerCase(); } catch (_) { /* False is diagnostic. */ }
  try { result.aliasAvailable = GmailApp.getAliases().map(function(value) { return value.toLowerCase(); }).indexOf(cfg.alias.toLowerCase()) >= 0; } catch (_) { /* False is diagnostic. */ }
  try { result.quotaRemaining = MailApp.getRemainingDailyQuota(); } catch (_) { /* Null is unavailable. */ }
  try { result.retryTriggerCount = ScriptApp.getProjectTriggers().filter(function(trigger) { return trigger.getHandlerFunction() === 'retryPendingEmails'; }).length; } catch (_) { /* Zero is unavailable/not installed. */ }
  result.testRecipientAllowed = cfg.environment === 'production' || validEmail_(cfg.testRecipient) && cfg.testAllowed.indexOf(cfg.testRecipient) >= 0;
  result.configurationReady = result.configurationReady && result.ownerMatches && result.aliasAvailable && result.testRecipientAllowed;
  result.sendEnabled = result.configurationReady && !cfg.paused && (cfg.environment === 'production' || cfg.testEmailEnabled);
  return result;
}

/** Harmless literal-storage acceptance check, allowed only in the isolated test Sheet. */
function verifyLiteralStorage() {
  var cfg = config_();
  if (cfg.environment !== 'test') fail_('INVALID_REQUEST');
  return lock_(function() {
    var store = openStore_(cfg), name = 'Literal check ' + Utilities.getUuid().slice(0, 8), sheet = store.book.insertSheet(name);
    try {
      var samples = ['=1+1', '+123', '-123', '@SUM(A1:A2)', "'literal", '=IMPORTXML("https://example.invalid","//x")'];
      rawWrite_(store.book, sheet, 1, samples);
      var values = readValues_(sheet, 'A1:F1')[0];
      var formulas = Sheets.Spreadsheets.get(store.book.getId(), { ranges: ["'" + name + "'!A1:F1"], includeGridData: true, fields: 'sheets(data(rowData(values(userEnteredValue))))' });
      var cells = formulas.sheets[0].data[0].rowData[0].values;
      var literal = cells.every(function(cell) { return cell.userEnteredValue && !Object.prototype.hasOwnProperty.call(cell.userEnteredValue, 'formulaValue'); });
      if (!literal || JSON.stringify(values) !== JSON.stringify(samples)) fail_('LITERAL_STORAGE_FAILED');
      return { passed: true, samplesChecked: samples.length, formulasFound: 0 };
    } finally { store.book.deleteSheet(sheet); }
  });
}
