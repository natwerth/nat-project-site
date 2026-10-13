// Shared by the Services form, its confirmation page, and dependency-free tests.
export const RECEIPT_STORAGE_KEY = 'natwerth.services.receipt.v1';
export const SERVICES = Object.freeze({
  'resume-review': 'Resume Reviews',
  'ask-nat': 'Ask Nat',
  'project-help': 'Project Help'
});
export const SERVICE_FIELDS = Object.freeze({
  'resume-review': ['resume-goal', 'resume-questions'],
  'ask-nat': ['ask-question'],
  'project-help': ['project-goal', 'project-timeline', 'project-budget']
});
export const SAVED_STATES = new Set(['complete', 'processing', 'saved_pending_email', 'needs_review']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function isConfigured(config) {
  try {
    const endpoint = new URL(config.endpoint);
    return endpoint.origin === 'https://script.google.com'
      && /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint.pathname)
      && !endpoint.search && !endpoint.hash && !endpoint.username && !endpoint.password;
  } catch { return false; }
}

export function normalizeAnswers({ service, intent, name, email, fields, hp = '' }) {
  if (!Object.hasOwn(SERVICE_FIELDS, service)) throw new Error('Unsupported service');
  return {
    service,
    intent: intent === 'booking' ? 'booking' : 'details',
    name: name.trim(),
    email: email.trim().toLowerCase(),
    fields: Object.fromEntries(SERVICE_FIELDS[service].map(id => [id, (fields[id] || '').trim().replace(/\r\n?/g, '\n')])),
    hp: hp.trim()
  };
}

export async function fingerprint(answers, cryptoAPI = globalThis.crypto) {
  const digest = await cryptoAPI.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(normalizeAnswers(answers))));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createReceipt(payloadFingerprint, cryptoAPI = globalThis.crypto) {
  // 256 random bits, independent of the UUID. Neither credential goes in a URL.
  const bytes = cryptoAPI.getRandomValues(new Uint8Array(32));
  const receiptToken = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  return { version: 1, requestId: cryptoAPI.randomUUID(), receiptToken, fingerprint: payloadFingerprint, result: null };
}

export function isEnvelope(result, requestId) {
  if (!result || result.version !== 1 || result.requestId !== requestId
    || typeof result.ok !== 'boolean' || typeof result.retryable !== 'boolean'
    || (result.errorCode !== null && typeof result.errorCode !== 'string')
    || typeof result.ownerEmailState !== 'string' || typeof result.confirmationEmailState !== 'string') return false;
  if (!result.ok) return result.state === 'rejected';
  if (!SAVED_STATES.has(result.state)) return false;
  return result.state !== 'complete' || (result.ownerEmailState === 'sent' && result.confirmationEmailState === 'sent');
}

export function readReceipt(storage) {
  try {
    storage ||= globalThis.sessionStorage;
    const value = JSON.parse(storage.getItem(RECEIPT_STORAGE_KEY));
    if (!value || value.version !== 1 || !UUID.test(value.requestId) || !TOKEN.test(value.receiptToken)
      || !/^[0-9a-f]{64}$/.test(value.fingerprint)) return null;
    if (value.result !== null && !isEnvelope(value.result, value.requestId)) return null;
    return value;
  } catch { return null; }
}

export function writeReceipt(receipt, storage) {
  try {
    storage ||= globalThis.sessionStorage;
    // Explicitly allowlist storage: never persist answers, email, or challenge tokens.
    storage.setItem(RECEIPT_STORAGE_KEY, JSON.stringify({
      version: 1, requestId: receipt.requestId, receiptToken: receipt.receiptToken,
      fingerprint: receipt.fingerprint,
      result: receipt.result ? {
        version: 1, requestId: receipt.requestId, ok: receipt.result.ok, state: receipt.result.state,
        ownerEmailState: receipt.result.ownerEmailState, confirmationEmailState: receipt.result.confirmationEmailState,
        errorCode: receipt.result.errorCode, retryable: receipt.result.retryable
      } : null
    }));
    return true;
  } catch { return false; }
}

export function savedMessage(result) {
  if (result.state === 'complete') return 'Sent. Your request is saved, and a confirmation email is on its way. Nat will follow up by email.';
  if (result.state === 'needs_review') return 'Your request is saved. Email confirmation needs a manual check. Please do not send the same request again.';
  if (result.confirmationEmailState === 'sent') return 'Your request is saved and your confirmation email has been sent. The notification to Nat is still pending.';
  return 'Request saved—confirmation email pending. Please do not send the same request again.';
}

export function rejectionMessage(code) {
  const messages = {
    PAUSED: 'The contact form is temporarily paused. Your answers are still here. Please try again later.',
    NOT_CONFIGURED: 'The contact form is temporarily unavailable. Your answers are still here. Please try again later.',
    RATE_LIMITED: 'The request limit has been reached. Your answers are still here. Please try again later.',
    INVALID_EMAIL: 'Please enter one valid email address and try again.',
    INVALID_FIELD: 'Please check the required answers and their length, then try again.',
    INVALID_REQUEST: 'Please check your answers and try again.',
    PAYLOAD_TOO_LARGE: 'Please shorten your answers and try again.',
    SPAM_REJECTED: 'This request was not accepted. Please check your answers and try again.',
    REQUEST_ID_CONFLICT: 'This reference already belongs to different answers. Check its status before starting another request.'
  };
  return messages[code] || 'The request was not accepted. Your answers are still here. Please try again later.';
}

export async function postPayload(endpoint, payload, { signal, timeoutMs = 60000, fetchAPI = globalThis.fetch } = {}) {
  // 60 seconds is a provisional ceiling; verify it against the real deployment.
  // Aborting this fetch does NOT cancel a running Apps Script invocation.
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, timeoutMs);
  try {
    const response = await fetchAPI(endpoint, {
      method: 'POST', credentials: 'omit', mode: 'cors', redirect: 'follow',
      body: new URLSearchParams({ payload: JSON.stringify(payload) }), signal: controller.signal
    });
    if (!response.ok) throw new Error('Unconfirmed response');
    const result = await response.json();
    if (!isEnvelope(result, payload.requestId)) throw new Error('Unconfirmed response');
    return result;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
