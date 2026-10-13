import { FORM_CONFIG } from './form-config.js';
import { SERVICES, SERVICE_FIELDS, RECEIPT_STORAGE_KEY, isConfigured, normalizeAnswers,
  fingerprint, createReceipt, readReceipt, writeReceipt, savedMessage,
  rejectionMessage, postPayload } from './form-protocol.js';

// The page loads this module once; includes may finish in any order.
const initialized = new WeakSet();
const POLL_DELAYS = [0, 2000, 5000, 10000];
const UNCERTAIN = 'We couldn’t confirm receipt. Your request may still be processing. Your answers are still here. Check status, or retry the same request with the same reference.';

function initForm() {
  const form = document.getElementById('consultForm');
  if (!form || initialized.has(form)) return;
  initialized.add(form);
  const group = form.querySelector('#svc-group');
  const panels = [...form.querySelectorAll('[data-service-fields]')];
  const button = form.querySelector('#submitBtn');
  const submitError = form.querySelector('#submitErr');
  const status = form.querySelector('#submitStatus');
  const checkButton = form.querySelector('#checkStatusBtn');
  const anotherButton = form.querySelector('#anotherRequestBtn');
  const thankyouLink = form.querySelector('#thankyouLink');
  const intent = form.elements.namedItem('intent');
  const name = form.elements.namedItem('name');
  const email = form.elements.namedItem('email');
  const configured = isConfigured(FORM_CONFIG) && !!globalThis.crypto?.subtle && !!globalThis.crypto?.randomUUID;
  let receipt = readReceipt();
  let submitting = false;
  let checking = false;
  let uncertain = !!receipt && !receipt.result;
  let pageActive = true;
  let lifecycle = new AbortController();
  let redirectTimer;
  let storageWorks = true;

  function chosenService() {
    return form.querySelector('input[name="service"]:checked')?.value || '';
  }

  function saved() { return receipt?.result?.ok === true; }

  function updateButton() {
    const locked = submitting || saved();
    group.disabled = locked;
    name.disabled = locked;
    email.disabled = locked;
    for (const panel of panels) panel.disabled = locked || panel.dataset.serviceFields !== chosenService();
    button.disabled = !configured || submitting || checking || saved() || !chosenService()
      || activeFields().some(input => fieldError(input));
    button.textContent = submitting ? 'Sending…' : saved() ? (receipt.result.state === 'complete' ? 'Sent' : 'Request saved')
      : uncertain ? 'Retry request' : intent.value === 'booking' ? 'Send booking request' : 'Send request';
    checkButton.hidden = !receipt || receipt.result?.state === 'complete' || (!!receipt.result && !saved());
    checkButton.disabled = !configured || submitting || checking;
    checkButton.textContent = checking ? 'Checking status…' : 'Check status';
    anotherButton.hidden = !saved();
    anotherButton.disabled = checking || submitting;
    thankyouLink.hidden = !saved();
    form.setAttribute('aria-busy', String(submitting || checking));
  }

  function announce(message, error = false) {
    submitError.hidden = !error;
    submitError.textContent = error ? message : '';
    status.hidden = error || !message;
    status.textContent = error ? '' : message;
  }

  function persist() {
    storageWorks = writeReceipt(receipt);
  }

  function showSaved() {
    announce(`${savedMessage(receipt.result)} Reference: ${receipt.requestId}.${!storageWorks ? ' Keep this page open to keep your receipt.' : ''}`);
  }

  function showUncertain() {
    announce(`${UNCERTAIN} Reference: ${receipt.requestId}.${!storageWorks ? ' Keep this page open to keep your reference.' : ''}`, true);
  }

  function clearError(input) {
    input.removeAttribute('aria-invalid');
    const error = document.getElementById(`${input.id}-error`);
    if (error) { error.hidden = true; error.textContent = ''; }
  }

  function selectService(service, requestIntent = 'details', updateURL = false) {
    if (submitting || saved() || !Object.hasOwn(SERVICES, service)) return false;
    form.querySelector(`input[value="${service}"]`).checked = true;
    intent.value = requestIntent === 'booking' ? 'booking' : 'details';
    for (const panel of panels) {
      const active = panel.dataset.serviceFields === service;
      panel.hidden = !active;
      panel.disabled = !active;
      if (!active) panel.querySelectorAll('input, textarea').forEach(clearError);
    }
    form.querySelector('#svcErr').hidden = true;
    if (!uncertain) submitError.hidden = true;
    updateButton();
    if (updateURL) {
      const url = new URL(location.href);
      url.searchParams.set('service', service);
      url.searchParams.set('intent', intent.value);
      if (url.hash.startsWith('#contact')) url.hash = 'contact';
      history.replaceState({}, '', url);
    }
    return true;
  }

  function scrollToForm(focus = false) {
    if (focus) (saved() ? status : name).focus({ preventScroll: true });
    document.getElementById('contact').scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start'
    });
  }

  function readURL() {
    const query = new URLSearchParams(location.search);
    const hashQuery = new URLSearchParams(location.hash.split('?')[1] || '');
    selectService(query.get('service') || hashQuery.get('service'), query.get('intent') || hashQuery.get('intent'));
    if (location.hash.startsWith('#contact')) requestAnimationFrame(() => scrollToForm());
  }

  document.addEventListener('click', event => {
    const link = event.target.closest('a[data-service]');
    if (!link || !Object.hasOwn(SERVICES, link.dataset.service)) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (submitting) return;
    selectService(link.dataset.service, link.dataset.intent, true);
    const url = new URL(location.href);
    url.hash = 'contact';
    history.replaceState({}, '', url);
    scrollToForm(true);
  });

  group.addEventListener('change', event => {
    if (event.target.matches('input[name="service"]')) selectService(event.target.value, 'details', true);
  });
  form.addEventListener('input', event => {
    if (event.target.matches('[aria-invalid=true]')) validateField(event.target);
    if (uncertain) announce('Your earlier request may still be processing. Changing answers creates a separate request. Check its status before sending another.', true);
    else submitError.hidden = true;
    updateButton();
  });
  form.addEventListener('change', updateButton);
  form.addEventListener('focusout', event => {
    if (event.target.matches('input[data-label], textarea[data-label]')) validateField(event.target);
    updateButton();
  });
  window.addEventListener('popstate', readURL);
  window.addEventListener('hashchange', readURL);
  window.addEventListener('pagehide', () => {
    pageActive = false;
    lifecycle.abort();
    clearTimeout(redirectTimer);
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      pageActive = true;
      lifecycle = new AbortController();
      submitting = false;
      checking = false;
      if (receipt && (!receipt.result || (saved() && receipt.result.state !== 'complete'))) pollStatus(false);
    }
    updateButton();
  });

  function activeFields() {
    return [...form.querySelectorAll('input[data-label], textarea[data-label]')].filter(input => !input.matches(':disabled'));
  }

  function fieldError(input) {
    const value = input.value.trim();
    if (input.required && !value) return `${input.dataset.label} is required.`;
    if (input.maxLength > 0 && value.length > input.maxLength) return `Please keep this answer to ${input.maxLength} characters or fewer.`;
    if (input.tagName === 'INPUT' && /[\r\n]/.test(value)) return 'Please use a single line.';
    if (input === email && (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value) || /[\x00-\x1f\x7f]/.test(value))) return 'Enter one valid email address.';
    if (!input.validity.valid) return input.type === 'email' ? 'Enter a valid email address.' : 'Please check this answer.';
    return '';
  }

  function validateField(input) {
    clearError(input);
    if (input.matches(':disabled')) return true;
    const message = fieldError(input);
    if (!message) return true;
    input.setAttribute('aria-invalid', 'true');
    const error = document.getElementById(`${input.id}-error`);
    error.textContent = message;
    error.hidden = false;
    return false;
  }

  function validate() {
    let firstInvalid;
    const missingService = !chosenService();
    form.querySelector('#svcErr').hidden = !missingService;
    if (missingService) firstInvalid = group.querySelector('input');
    for (const input of activeFields()) if (!validateField(input)) firstInvalid ||= input;
    firstInvalid?.focus();
    return !firstInvalid;
  }

  function applyResult(result, redirect) {
    if (result.ok) {
      receipt.result = result;
      uncertain = false;
      persist();
      showSaved();
      if (redirect && result.state === 'complete') {
        // No name, address, answers, or receipt credential in the destination URL.
        clearTimeout(redirectTimer);
        redirectTimer = setTimeout(() => { if (pageActive) location.assign('/thankyou/'); }, 1800);
      }
    } else if (['BUSY', 'TEMPORARY_FAILURE', 'REQUEST_ID_CONFLICT', 'RECEIPT_NOT_FOUND'].includes(result.errorCode)) {
      uncertain = true;
      showUncertain();
    } else {
      receipt.result = result;
      uncertain = false;
      persist();
      announce(rejectionMessage(result.errorCode), true);
    }
    updateButton();
  }

  function wait(ms) {
    return new Promise(resolve => {
      const signal = lifecycle.signal;
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, ms);
      signal.addEventListener('abort', done, { once: true });
      if (signal.aborted) done();
    });
  }

  async function pollStatus(redirect) {
    if (!receipt || checking || !configured || !pageActive) return;
    checking = true;
    const current = receipt;
    updateButton();
    try {
      for (const delay of POLL_DELAYS) {
        await wait(delay);
        if (!pageActive || receipt !== current) break;
        try {
          const result = await postPayload(FORM_CONFIG.endpoint, {
            version: 1, action: 'status', requestId: current.requestId, receiptToken: current.receiptToken
          }, { signal: lifecycle.signal, timeoutMs: 30000 });
          if (!pageActive || receipt !== current) break;
          if (result.ok) {
            applyResult(result, redirect);
            if (['complete', 'needs_review'].includes(result.state)) break;
          } else if (!saved()) {
            // A missing receipt is not proof that an earlier invocation stopped.
            uncertain = true;
            showUncertain();
          }
        } catch {
          if (!pageActive) break;
          if (!saved()) { uncertain = true; showUncertain(); }
        }
      }
    } finally {
      checking = false;
      if (pageActive) updateButton();
    }
  }

  checkButton.addEventListener('click', () => pollStatus(false));
  anotherButton.addEventListener('click', () => {
    clearTimeout(redirectTimer);
    receipt = null;
    uncertain = false;
    try { sessionStorage.removeItem(RECEIPT_STORAGE_KEY); } catch { /* In-memory flow still works. */ }
    form.reset();
    form.querySelectorAll('input[data-label], textarea[data-label]').forEach(clearError);
    panels.forEach(panel => { panel.hidden = true; panel.disabled = true; });
    announce('');
    readURL();
    updateButton();
    (chosenService() ? name : group.querySelector('input')).focus();
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!configured || submitting || checking || saved() || !validate() || form.elements.namedItem('hp').value) return;
    const service = chosenService();
    const answers = normalizeAnswers({
      service, intent: intent.value, name: name.value, email: email.value,
      fields: Object.fromEntries(SERVICE_FIELDS[service].map(id => [id, form.elements.namedItem(id).value])),
      hp: form.elements.namedItem('hp').value
    });
    submitting = true;
    announce('Sending your request. Please keep this page open.');
    updateButton();
    let shouldPoll = false;
    try {
      const payloadFingerprint = await fingerprint(answers);
      if (!receipt || receipt.fingerprint !== payloadFingerprint) receipt = createReceipt(payloadFingerprint);
      receipt.result = null;
      persist();
      const result = await postPayload(FORM_CONFIG.endpoint, {
        version: 1, action: 'submit', requestId: receipt.requestId, receiptToken: receipt.receiptToken, ...answers
      }, { signal: lifecycle.signal });
      if (!pageActive) return;
      applyResult(result, true);
      shouldPoll = uncertain || (saved() && !['complete', 'needs_review'].includes(result.state));
    } catch {
      if (pageActive && receipt) {
        uncertain = true;
        showUncertain();
        shouldPoll = true;
      } else if (pageActive) announce('This browser could not prepare a secure request. Your answers are still here. Please try an updated browser.', true);
    } finally {
      submitting = false;
      if (pageActive) updateButton();
    }
    if (shouldPoll && pageActive) pollStatus(true);
  });

  readURL();
  if (!configured) announce('The contact form is temporarily paused while it is being set up. Please check back soon.');
  else if (saved()) showSaved();
  else if (uncertain) showUncertain();
  updateButton();
  // Recover a lost response without ever automatically resubmitting the answers.
  if (configured && receipt && (!receipt.result || (saved() && !['complete', 'needs_review'].includes(receipt.result.state)))) pollStatus(false);
}

document.addEventListener('includes:ready', initForm);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initForm, { once: true });
else initForm();
