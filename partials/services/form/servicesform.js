
  window.CONSULT_EMAIL_ENDPOINT = 'https://contact-smtp-on8q1jms6-nats-projects-0f7444b9.vercel.app/api/contact';
  (function(){
    // Title hydration (keeps your markup minimal)
    const h = document.getElementById('sectionTitle');
    if (h) h.textContent = '';

    const form = document.getElementById('consultForm');
    const svcGroup = document.getElementById('svc-group');
    const EMAIL_ENDPOINT = window.CONSULT_EMAIL_ENDPOINT || ''; // set window.CONSULT_EMAIL_ENDPOINT globally to enable server send

    // Map friendly slugs/synonyms to the actual radio values/ids
    const SVC_MAP = {
      'uat':'svc-uat',
      'u-a-t':'svc-uat',
      'static':'svc-static',
      'static-sites':'svc-static',
      'ops':'svc-ops',
      'ops-sprint':'svc-ops',
      'hygiene':'svc-hyg',
      'crm-hygiene':'svc-hyg',
      'cleanup':'svc-clean',
      'data-cleanup':'svc-clean'
    };

    function selectService(slug){
      if (!slug) return;
      const key = (slug + '').toLowerCase();
      const id = SVC_MAP[key] || SVC_MAP[key.replace(/\s+/g,'-')];
      if (!id) return;
      const radio = document.getElementById(id);
      if (radio){
        radio.checked = true;
        // Sync visual state for older browsers without :has support
        svcGroup.querySelectorAll('label').forEach(l => l.classList.toggle('is-selected', l.htmlFor === id));
        svcGroup.classList.add('has-choice');
        updateSubmitState();
      }
    }

    // From URL: ?service=uat and/or #contact?service=uat
    function preselectFromURL(){
      try{
        let svc = null;
        const qs = new URLSearchParams(window.location.search);
        svc = qs.get('service');
        if (!svc && window.location.hash.includes('service=')){
          const hashQ = window.location.hash.split('service=')[1];
          svc = hashQ ? hashQ.split('&')[0] : null;
        }
        if (svc) selectService(svc);
      }catch(e){}
    }
    preselectFromURL();
    updateSubmitState();

    // Delegated listener: any element on the page can set [data-service="uat"]
    document.addEventListener('click', function(e){
      const el = e.target.closest('[data-service]');
      if (!el) return;
      const svc = el.getAttribute('data-service');
      selectService(svc);
      // Keep the URL coherent without reload
      try{
        const url = new URL(window.location.href);
        url.searchParams.set('service', svc);
        history.replaceState({}, '', url);
      }catch(e){}
      // Nudge into view
      const card = document.getElementById('contact');
      if (card) card.scrollIntoView({behavior:'smooth', block:'start'});
      // Put the caret where people actually type
      const firstField = document.getElementById('name');
      if (firstField){
        // Delay a touch so smooth scroll doesn't fight the focus, and avoid extra jump
        setTimeout(()=> { firstField.focus({ preventScroll: true }); }, 300);
      }
    }, true);

    svcGroup.addEventListener('change', function(e){
      if (e.target && e.target.matches('input[type="radio"]')){
        const id = e.target.id;
        svcGroup.querySelectorAll('label').forEach(l => l.classList.toggle('is-selected', l.htmlFor === id));
        svcGroup.classList.toggle('has-choice', true);
        updateSubmitState();
      }
    });

    function showError(inputEl, errEl){
      inputEl.classList.add('is-invalid');
      if (errEl) errEl.classList.add('show-err');
    }
    function clearError(inputEl, errEl){
      inputEl.classList.remove('is-invalid');
      if (errEl) errEl.classList.remove('show-err');
    }

    function updateSubmitState(){
      const btn = document.getElementById('submitBtn');
      if (!btn) return;

      const svcChecked = form.querySelector('input[name="service"]:checked');
      const nameEl = document.getElementById('name');
      const emailEl = document.getElementById('email');

      const nameOk = !!(nameEl && nameEl.value.trim().length);
      const emailOk = !!(emailEl && emailEl.validity.valid);
      const allOk = !!(svcChecked && nameOk && emailOk);

      btn.disabled = !allOk;
      btn.setAttribute('aria-disabled', String(btn.disabled));

      // Grey out non-selected services only when something is chosen
      if (svcGroup){
        svcGroup.classList.toggle('has-choice', !!svcChecked);
      }
    }

    // Live-clear on input
    ['name','email'].forEach(id=>{
      const el = document.getElementById(id);
      const err = document.getElementById(id+'Err');
      if (el){
        el.addEventListener('input', ()=> { clearError(el, err); updateSubmitState(); });
      }
    });

    form.addEventListener('submit', function(e){
      e.preventDefault();
      const svcChecked = form.querySelector('input[name="service"]:checked');
      const name = document.getElementById('name');
      const email = document.getElementById('email');
      const svcErr = document.getElementById('svcErr');
      const nameErr = document.getElementById('nameErr');
      const emailErr = document.getElementById('emailErr');

      let ok = true;

      // Service required
      if (!svcChecked){ ok = false; svcErr.classList.add('show-err'); svcGroup.scrollIntoView({behavior:'smooth', block:'center'}); }
      else { svcErr.classList.remove('show-err'); }

      // Native validity for name/email
      if (!name.value.trim()){ ok = false; showError(name, nameErr); }
      if (!email.validity.valid){ ok = false; showError(email, emailErr); }

      if (!ok){
        const first = form.querySelector('.is-invalid') || svcGroup.querySelector('label');
        if (first) first.focus ? first.focus() : null;
        return;
      }

      const chosen = svcChecked ? svcChecked.value : '';
      const payload = {
        service: chosen,
        name: name.value.trim(),
        email: email.value.trim(),
        company: (document.getElementById('company')?.value || '').trim(),
        message: (document.getElementById('message')?.value || '').trim(),
        source: 'consulting'
      };

      const btn = document.getElementById('submitBtn'); 
      const submitErr = document.getElementById('submitErr');
      if (btn){ btn.disabled = true; btn.textContent = 'Submitting...'; }
      if (submitErr) submitErr.classList.remove('show-err');

      // If an email endpoint is configured, POST the form; otherwise, fall back to the existing redirect
      if (EMAIL_ENDPOINT){
        fetch(EMAIL_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        .then(res => {
          if (!res.ok) throw new Error('Bad response');
          return res.json().catch(()=> ({}));
        })
        .then(() => {
          window.location.href = '/thankyou?source=consulting&service=' + encodeURIComponent(chosen);
        })
        .catch(() => {
          if (submitErr) submitErr.classList.add('show-err');
          if (btn){ btn.disabled = false; btn.textContent = 'Submit'; }
        });
      } else {
        window.location.href = '/thankyou?source=consulting&service=' + encodeURIComponent(chosen);
      }
    });
  })();
