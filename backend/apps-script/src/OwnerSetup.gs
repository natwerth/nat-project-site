/** Owner-run setup for the explicitly approved test mailbox; never called by the public API. */
function prepareAuthorizedTesting() {
  initializeConfiguration();
  var props = PropertiesService.getScriptProperties();
  props.setProperties({ENVIRONMENT: 'test', PAUSED: 'true', TEST_EMAIL_ENABLED: 'false',
    TEST_RECIPIENT: 'nat@natwerth.com', TEST_ALLOWED_RECIPIENTS: 'nat@natwerth.com', RECIPIENT_HOURLY_CAP: '20'}, false);
  setupSpreadsheet();
  installRetryTrigger();
  var result = {diagnostics: setupDiagnostics(), literalStorage: verifyLiteralStorage()};
  console.info(JSON.stringify(result));
  return result;
}
function enableAuthorizedTesting() {
  var cfg = config_();
  if (cfg.environment !== 'test' || cfg.testRecipient !== 'nat@natwerth.com') fail_('NOT_CONFIGURED');
  var diagnostics = setupDiagnostics();
  if (!diagnostics.configurationReady) fail_('NOT_CONFIGURED');
  PropertiesService.getScriptProperties().setProperties({TEST_EMAIL_ENABLED: 'true', PAUSED: 'false'}, false);
  var result = setupDiagnostics(); console.info(JSON.stringify(result)); return result;
}
function prepareProduction() {
  PropertiesService.getScriptProperties().setProperties({ENVIRONMENT:'production', PAUSED:'true', RECIPIENT_HOURLY_CAP:'3'}, false);
  setupSpreadsheet(); installRetryTrigger();
  var result = setupDiagnostics(); console.info(JSON.stringify(result)); return result;
}
function enableProduction() {
  var cfg = config_();
  if (cfg.environment !== 'production' || !setupDiagnostics().configurationReady) fail_('NOT_CONFIGURED');
  PropertiesService.getScriptProperties().setProperty('PAUSED','false');
  var result = setupDiagnostics(); console.info(JSON.stringify(result)); return result;
}
