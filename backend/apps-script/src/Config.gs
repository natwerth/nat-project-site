/** Configuration is server-only. Run initializeConfiguration before setup. */
var FORM_DEFAULTS = Object.freeze({
  ENVIRONMENT: 'test', PAUSED: 'true', TEST_EMAIL_ENABLED: 'false',
  OWNER_ADDRESS: 'nat@natwerth.com', SENDER_ALIAS: 'info@natwerth.com', SITE_NAME: 'Nat Werth',
  RECIPIENT_HOURLY_CAP: '3', SUBMISSION_DAILY_CAP: '50', SEND_DAILY_CAP: '100',
  QUOTA_BUFFER: '50', MAX_ATTEMPTS: '3', RETRY_BASE_SECONDS: '300',
  LEASE_SECONDS: '600', RETRY_BATCH_SIZE: '10', TEST_RECIPIENT: 'nat@natwerth.com', TEST_ALLOWED_RECIPIENTS: 'nat@natwerth.com'
});

function FormError(code, retryable) { this.code = code; this.retryable = !!retryable; }
function fail_(code, retryable) { throw new FormError(code, retryable); }
function config_() {
  var p = PropertiesService.getScriptProperties().getProperties();
  function value(key) { return p[key] === undefined ? FORM_DEFAULTS[key] : p[key]; }
  function number(key, min, max) {
    var text = value(key), n = Number(text);
    if (!/^\d+$/.test(text) || n < min || n > max) fail_('NOT_CONFIGURED');
    return n;
  }
  function bool(key) {
    if (value(key) !== 'true' && value(key) !== 'false') fail_('NOT_CONFIGURED');
    return value(key) === 'true';
  }
  var environment = value('ENVIRONMENT');
  if (environment !== 'test' && environment !== 'production') fail_('NOT_CONFIGURED');
  var cfg = {
    environment: environment, paused: bool('PAUSED'), testEmailEnabled: bool('TEST_EMAIL_ENABLED'),
    spreadsheetId: p[environment === 'test' ? 'TEST_SPREADSHEET_ID' : 'PRODUCTION_SPREADSHEET_ID'] || '',
    owner: value('OWNER_ADDRESS'), alias: value('SENDER_ALIAS'), siteName: value('SITE_NAME'),
    testRecipient: value('TEST_RECIPIENT').trim().toLowerCase(),
    testAllowed: value('TEST_ALLOWED_RECIPIENTS').split(',').map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean),
    recipientCap: number('RECIPIENT_HOURLY_CAP', 1, 20), submissionCap: number('SUBMISSION_DAILY_CAP', 1, 500),
    sendCap: number('SEND_DAILY_CAP', 1, 1000), quotaBuffer: number('QUOTA_BUFFER', 0, 1000),
    maxAttempts: number('MAX_ATTEMPTS', 1, 5), retryBaseMs: number('RETRY_BASE_SECONDS', 60, 3600) * 1000,
    leaseMs: number('LEASE_SECONDS', 600, 1800) * 1000, batchSize: number('RETRY_BATCH_SIZE', 1, 20)
  };
  if (!validEmail_(cfg.owner) || !validEmail_(cfg.alias) || !cfg.siteName || /[\r\n]/.test(cfg.siteName) || cfg.siteName.length > 100) fail_('NOT_CONFIGURED');
  return cfg;
}

function now_() { return new Date().toISOString(); }
function hash_(text) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)).replace(/=+$/, '');
}
function equalHash_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var mismatch = 0;
  for (var i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
function lock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) fail_('BUSY', true);
  try { return fn(); } finally { lock.releaseLock(); }
}
