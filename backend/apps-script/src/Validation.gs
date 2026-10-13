var FORM_SERVICES = Object.freeze({
  'resume-review': { label: 'Resume Review', fields: { 'resume-goal': { label: 'Target role', required: true, max: 500 }, 'resume-questions': { label: 'Questions', max: 6000, multiline: true } } },
  'ask-nat': { label: 'Ask Nat', fields: { 'ask-question': { label: 'Question', required: true, max: 6000, multiline: true } } },
  'project-help': { label: 'Project Help', fields: { 'project-goal': { label: 'Project goal', required: true, max: 6000, multiline: true }, 'project-timeline': { label: 'Timeline', max: 500 }, 'project-budget': { label: 'Budget', max: 500 } } }
});

function object_(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function onlyKeys_(value, allowed) {
  if (!object_(value) || Object.keys(value).some(function(k) { return allowed.indexOf(k) < 0; })) fail_('INVALID_REQUEST');
}
function text_(value, max, required, multiline) {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(value) || (!multiline && /[\r\n]/.test(value))) fail_('INVALID_FIELD');
  var result = value.replace(/\r\n?/g, '\n').trim();
  if (required && !result) fail_('INVALID_FIELD');
  return result;
}
function validEmail_(value) {
  return typeof value === 'string' && value.length <= 254 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(value) && value.split('@')[0].length <= 64 && value.indexOf('..') < 0 && value.charAt(0) !== '.' && value.indexOf('.@') < 0;
}
function identity_(input) {
  if (typeof input.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId) ||
      typeof input.receiptToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.receiptToken)) fail_('INVALID_REQUEST');
  return { requestId: input.requestId.toLowerCase(), receiptHash: hash_(input.receiptToken) };
}
function parseRequest_(event) {
  if (!event || !event.postData || event.postData.length > 400000 || !event.parameter || typeof event.parameter.payload !== 'string') fail_('INVALID_REQUEST');
  if (event.parameters && event.parameters.payload && event.parameters.payload.length !== 1) fail_('INVALID_REQUEST');
  var encoded = event.parameter.payload;
  if (encoded.length > 60000 || Utilities.newBlob(encoded).getBytes().length > 60000) fail_('PAYLOAD_TOO_LARGE');
  var input;
  try { input = JSON.parse(encoded); } catch (_) { fail_('INVALID_REQUEST'); }
  if (!object_(input)) fail_('INVALID_REQUEST');
  if (input.version !== 1) fail_('INVALID_VERSION');
  var action = input.action === undefined ? 'submit' : input.action;
  if (['submit', 'status', 'probe'].indexOf(action) < 0) fail_('INVALID_ACTION');
  if (action === 'probe') {
    onlyKeys_(input, ['version', 'action', 'testError']);
    if (input.testError !== undefined && typeof input.testError !== 'boolean') fail_('INVALID_REQUEST');
    return { action: action, testError: !!input.testError };
  }
  var id = identity_(input);
  if (action === 'status') {
    onlyKeys_(input, ['version', 'action', 'requestId', 'receiptToken']);
    return { action: action, requestId: id.requestId, receiptHash: id.receiptHash };
  }
  onlyKeys_(input, ['version', 'action', 'requestId', 'receiptToken', 'service', 'intent', 'name', 'email', 'fields', 'hp']);
  if (typeof input.service !== 'string' || !Object.prototype.hasOwnProperty.call(FORM_SERVICES, input.service) || ['details', 'booking'].indexOf(input.intent) < 0) fail_('INVALID_FIELD');
  var service = FORM_SERVICES[input.service], fields = {};
  if (!object_(input.fields) || Object.keys(input.fields).some(function(key) { return !Object.prototype.hasOwnProperty.call(service.fields, key); })) fail_('INVALID_FIELD');
  Object.keys(service.fields).forEach(function(key) {
    var definition = service.fields[key];
    fields[key] = text_(input.fields[key] === undefined ? '' : input.fields[key], definition.max, definition.required, definition.multiline);
  });
  var email = text_(input.email, 254, true, false).toLowerCase();
  if (!validEmail_(email)) fail_('INVALID_EMAIL');
  var canonical = { service: input.service, intent: input.intent, name: text_(input.name, 500, true, false), email: email, fields: fields };
  var hp = text_(input.hp, 500, false, false);
  if (hp) fail_('SPAM_REJECTED');
  return { action: action, requestId: id.requestId, receiptHash: id.receiptHash, fingerprint: hash_(JSON.stringify(canonical)), recipientHash: hash_(email), data: canonical };
}
