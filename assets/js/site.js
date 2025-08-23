
document.addEventListener('DOMContentLoaded', async () => {
  // Inject partials
  const spots = document.querySelectorAll('[data-include]');
  for (const el of spots) {
    const url = el.getAttribute('data-include');
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      el.outerHTML = await res.text();
    } catch (err) {
      console.error('Include failed:', url, err);
    }
  }

  // Next tick: wire header toggles if present
  setTimeout(() => {
    const $ = (s, r=document) => r.querySelector(s);
    const menuBtn   = $('#menuToggle');
    const mobileNav = $('#mobileNav');
    const backdrop  = $('#sharedBackdrop');
    function closeAll(){
      if (menuBtn){ menuBtn.classList.remove('is-active'); menuBtn.setAttribute('aria-expanded','false'); }
      if (mobileNav){ mobileNav.hidden = true; }
      document.documentElement.classList.remove('nav-open');
      if (backdrop){ backdrop.classList.remove('is-visible'); }
    }
    if (menuBtn && mobileNav){
      menuBtn.addEventListener('click', () => {
        const open = menuBtn.getAttribute('aria-expanded') === 'true';
        const next = !open;
        menuBtn.setAttribute('aria-expanded', String(next));
        menuBtn.classList.toggle('is-active', next);
        mobileNav.hidden = !next;
        document.documentElement.classList.toggle('nav-open', next);
        if (backdrop) backdrop.classList.toggle('is-visible', next);
      });
    }
    if (backdrop) backdrop.addEventListener('click', closeAll);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
  }, 0);
});
