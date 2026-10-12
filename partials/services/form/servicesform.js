// The page loads this module once; includes may finish in any order.
const DEFAULT_ENDPOINT = 'https://consulting-form-backend.nat-1fa.workers.dev/';
const SERVICES = {
  'resume-review': 'Resume Reviews',
  'ask-nat': 'Ask Nat',
  'project-help': 'Project Help'
};
const initialized = new WeakSet();

function initForm() {
  const form = document.getElementById('consultForm');
  if (!form || initialized.has(form)) return;
  initialized.add(form);
  const group = form.querySelector('#svc-group');
  const panels = [...form.querySelectorAll('[data-service-fields]')];
  const button = form.querySelector('#submitBtn');
  const submitError = form.querySelector('#submitErr');
  const intent = form.elements.namedItem('intent');
  const name = form.elements.namedItem('name');
  const email = form.elements.namedItem('email');
  let submitting = false;

  function chosenService() {
    return form.querySelector('input[name="service"]:checked')?.value || '';
  }

  function updateButton() {
    button.disabled = submitting || !chosenService() || activeFields().some(input => fieldError(input));
    button.textContent = submitting ? 'Sending…' : intent.value === 'booking' ? 'Send booking request' : 'Send request';
  }

  function clearError(input) {
    input.removeAttribute('aria-invalid');
    const error = document.getElementById(`${input.id}-error`);
    if (error) { error.hidden = true; error.textContent = ''; }
  }

  function selectService(service, requestIntent = 'details', updateURL = false) {
    if (!Object.hasOwn(SERVICES, service)) return false;
    form.querySelector(`input[value="${service}"]`).checked = true;
    intent.value = requestIntent === 'booking' ? 'booking' : 'details';
    for (const panel of panels) {
      const active = panel.dataset.serviceFields === service;
      panel.hidden = !active;
      panel.disabled = !active;
      if (!active) panel.querySelectorAll('input, textarea').forEach(clearError);
    }
    form.querySelector('#svcErr').hidden = true;
    submitError.hidden = true;
    updateButton();
    if (updateURL) {
      const url = new URL(location.href);
      url.searchParams.set('service', service);
      url.searchParams.set('intent', intent.value);
      // Normalize the older #contact?service=… format too.
      if (url.hash.startsWith('#contact')) url.hash = 'contact';
      history.replaceState({}, '', url);
    }
    return true;
  }

  function scrollToForm(focus = false) {
    if (focus) name.focus({ preventScroll:true });
    document.getElementById('contact').scrollIntoView({
      behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      block:'start'
    });
  }

  function readURL() {
    const query = new URLSearchParams(location.search);
    const hashQuery = new URLSearchParams(location.hash.split('?')[1] || '');
    const service = query.get('service') || hashQuery.get('service');
    selectService(service, query.get('intent') || hashQuery.get('intent'));
    if (location.hash.startsWith('#contact')) requestAnimationFrame(() => scrollToForm());
  }

  document.addEventListener('click', event => {
    const link = event.target.closest('a[data-service]');
    if (!link || !Object.hasOwn(SERVICES, link.dataset.service)) return;
    // Preserve normal modified-click behavior for shareable links.
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
    submitError.hidden = true;
    updateButton();
  });
  form.addEventListener('change', updateButton);
  form.addEventListener('focusout', event => {
    if (event.target.matches('input[data-label], textarea[data-label]')) validateField(event.target);
    updateButton();
  });
  window.addEventListener('pageshow', updateButton);
  window.addEventListener('popstate', readURL);
  window.addEventListener('hashchange', readURL);

  function activeFields() {
    return [...form.querySelectorAll('input[data-label], textarea[data-label]')].filter(input => !input.matches(':disabled'));
  }

  function fieldError(input) {
    if (input.required && !input.value.trim()) return `${input.dataset.label} is required.`;
    if (!input.validity.valid) return input.type === 'email' ? 'Enter a valid email address.'
      : input.type === 'url' ? 'Enter a complete link, starting with https://.'
      : 'Please check this answer.';
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
    for (const input of activeFields()) {
      if (!validateField(input)) firstInvalid ||= input;
    }
    firstInvalid?.focus();
    return !firstInvalid;
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting || !validate() || form.elements.namedItem('hp').value) return;
    const service = chosenService();
    // Preserve the existing backend contract. Service answers go in its message
    // field instead of assuming the email template supports new JSON keys.
    const answers = activeFields().filter(input => input !== name && input !== email && input.value.trim())
      .map(input => `${input.dataset.label}: ${input.value.trim()}`);
    const payload = {
      service,
      name:name.value.trim(),
      email:email.value.trim(),
      company:'',
      message:[`Service: ${SERVICES[service]}`, `Request: ${intent.value === 'booking' ? 'Booking request' : 'Get details'}`, '', ...answers].join('\n\n'),
      source:'consulting'
    };
    submitting = true;
    form.inert = true;
    form.setAttribute('aria-busy', 'true');
    submitError.hidden = true;
    updateButton();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const endpoint = window.CONSULT_EMAIL_ENDPOINT ?? DEFAULT_ENDPOINT;
      if (!endpoint) throw new Error('No endpoint configured');
      const response = await fetch(endpoint, {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body:JSON.stringify(payload), signal:controller.signal
      });
      if (!response.ok) throw new Error('Request failed');
      const result = await response.json();
      // The Worker confirms delivery with { ok: true }; a 2xx alone is not enough.
      if (result?.ok !== true || result?.error) throw new Error('Request rejected');
      location.assign(`/thankyou/?source=consulting&service=${encodeURIComponent(service)}`);
    } catch {
      submitError.hidden = false;
      submitting = false;
      form.inert = false;
      form.removeAttribute('aria-busy');
      updateButton();
    } finally {
      clearTimeout(timeout);
    }
  });
  readURL();
  updateButton();
}

document.addEventListener('includes:ready', initForm);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initForm, { once:true });
else initForm();
