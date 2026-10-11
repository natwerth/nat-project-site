// HEADER COMPONENT SCRIPT — resilient binding + runtime sync
(function(){
  const doc = document;
  const docEl = document.documentElement;
  let bound = false;

  function $id(id){ return document.getElementById(id); }
  function header(){ return $id('siteHeader'); }
  function panel(){ return $id('mobilePanel'); }
  function menuBtn(){ return $id('menuToggle'); }
  function backdrop(){ return $id('sharedBackdrop'); }
  function searchBtn(){ return $id('searchToggle'); }
  function closeBtn(){ return $id('closeSearch'); }
  function searchForm(){ return $id('desktopSearch'); }
  function searchBox(){ const f = searchForm(); return f ? f.querySelector('input') : null; }

  function setHeaderVar(){
    const h = header();
    if (!h) return;
    const px = Math.round(h.getBoundingClientRect().height) + 'px';
    docEl.style.setProperty('--header-h', px);
  }

  let pageScroll;
  let headerSpacer;
  let menuCloseTimer;
  let menuOpenFrame;

  function updateMenuViewport(){
    const viewport = window.visualViewport;
    docEl.style.setProperty('--menu-viewport-height', `${viewport?.height || window.innerHeight}px`);
    docEl.style.setProperty('--menu-viewport-top', `${viewport?.offsetTop || 0}px`);
    setHeaderVar();
    if (headerSpacer) headerSpacer.style.height = `${header().getBoundingClientRect().height}px`;
  }

  function lockPage(){
    if (pageScroll) return;
    pageScroll = { x: window.scrollX, y: window.scrollY };
    docEl.style.setProperty('--menu-scroll-top', `${-pageScroll.y}px`);
    // The header becomes fixed while the menu is open. Keep its space in the page.
    headerSpacer = document.createElement('div');
    headerSpacer.setAttribute('aria-hidden', 'true');
    headerSpacer.style.height = `${header().getBoundingClientRect().height}px`;
    header().before(headerSpacer);
    docEl.classList.add('menu-open');
  }

  function finishMenuClose(){
    clearTimeout(menuCloseTimer);
    const p = panel();
    if (p?.classList.contains('open')) return;
    if (p) p.hidden = true;
    docEl.classList.remove('menu-open', 'menu-closing');
    headerSpacer?.remove();
    headerSpacer = undefined;
    docEl.style.removeProperty('--menu-scroll-top');
    if (pageScroll) {
      const saved = pageScroll;
      pageScroll = undefined;
      // Bypass any smooth-scroll styling when restoring the page's position.
      window.scrollTo({ left: saved.x, top: saved.y, behavior: 'instant' });
    }
  }

  function openPanel(){
    const p = panel(); if (!p) return;
    clearTimeout(menuCloseTimer);
    cancelAnimationFrame(menuOpenFrame);
    docEl.classList.remove('menu-closing');
    updateMenuViewport();
    lockPage();
    p.hidden = false;
    menuOpenFrame = requestAnimationFrame(()=> p.classList.add('open'));
    const b = menuBtn(); if (b){ b.classList.add('is-active'); b.setAttribute('aria-expanded','true'); }
  }
  function closePanel(immediate = false){
    const p = panel(); if (!p || !pageScroll) return;
    cancelAnimationFrame(menuOpenFrame);
    if (p.contains(doc.activeElement)) doc.activeElement.blur();
    p.classList.remove('open');
    docEl.classList.add('menu-closing');
    const b = menuBtn(); if (b){ b.classList.remove('is-active'); b.setAttribute('aria-expanded','false'); }
    clearTimeout(menuCloseTimer);
    // Fallback covers interrupted transitions, including Safari keyboard changes.
    if (immediate) finishMenuClose();
    else menuCloseTimer = setTimeout(finishMenuClose, 260);
  }
  function toggleMenu(){ (docEl.classList.contains('menu-open') && !docEl.classList.contains('menu-closing') ? closePanel : openPanel)(); }

  let searchAction = 0;

  function openSearch(){
    const h = header(); const sb = searchBtn();
    if (!h || !sb) return;
    searchAction++;
    const form = document.getElementById('desktopSearch');
    if (form) form.inert = false;
    h.classList.add('search-open');
    sb.setAttribute('aria-expanded','true'); sb.setAttribute('aria-label','Close search');
    const box = searchBox(); if (box) setTimeout(()=> box.focus({preventScroll:true}), 40);
    requestAnimationFrame(setHeaderVar);
  }

  function closeSearch() {
    const h = header();
    const sb = searchBtn();
    if (!h || !sb) return;

    const action = ++searchAction;
    const form = document.getElementById('desktopSearch');

    // Search replaces this promise with its fade-out completion.
    const request = {
      finished: Promise.resolve(true)
    };

    form?.dispatchEvent(new CustomEvent('site-search:close', {
      detail: request
    }));

    // Avoid interacting with controls that are in the process of closing.
    if (form) form.inert = true;

    request.finished.then(closed => {
      // Ignore an old close request if search has since reopened.
      if (action !== searchAction) return;

      if (form) form.inert = false;
      if (!closed) return;

      h.classList.remove('search-open');
      sb.setAttribute('aria-expanded', 'false');
      sb.setAttribute('aria-label', 'Open search');
      sb.focus({ preventScroll: true });
      requestAnimationFrame(setHeaderVar);
    });
  }

  function toggleSearch(){ header()?.classList.contains('search-open') ? closeSearch() : openSearch(); }

  function initHeader(){
    if (bound) return;                // idempotent
    if (!header()) return;            // wait until partial exists
    bound = true;

    // Delegated listeners -> no rebinding needed when DOM gets injected
    doc.addEventListener('click', (e)=>{
      const t = e.target;
      if (t.closest('#menuToggle')) { toggleMenu(); }
      else if (t.closest('#searchToggle')) { toggleSearch(); }
      else if (t.closest('#closeSearch')) { closeSearch(); }
      else if (t.closest('#sharedBackdrop')) { if (docEl.classList.contains('menu-open')) closePanel(); }
      else if (t.closest('#mobilePanel a')) { if (docEl.classList.contains('menu-open')) closePanel(); }
    });

    // Initial compute + observers
    setHeaderVar();

    if ('ResizeObserver' in window){
      const ro = new ResizeObserver(()=>{ setHeaderVar(); });
      ro.observe(header());
    }
    panel()?.addEventListener('transitionend', event => {
      if (event.target === panel() && event.propertyName === 'transform' &&
          docEl.classList.contains('menu-closing')) finishMenuClose();
    });
    window.addEventListener('resize', () => {
      updateMenuViewport();
      if (window.matchMedia('(min-width: 768px)').matches) closePanel(true);
    }, { passive: true });
    window.visualViewport?.addEventListener('resize', updateMenuViewport, { passive: true });
    window.visualViewport?.addEventListener('scroll', updateMenuViewport, { passive: true });
    updateMenuViewport();

    // Recompute after fonts and full load
    window.addEventListener('load', setHeaderVar, { once:true });
    if (document.fonts && document.fonts.ready) { document.fonts.ready.then(setHeaderVar); }
  }

  // Bind in all the ways
  document.addEventListener('DOMContentLoaded', initHeader);
  document.addEventListener('includes:ready', initHeader);
  // If the header was already there for some reason:
  initHeader();
})();

// Shared site search: loaded once on every page that uses this header.
(() => {
  if (document.getElementById('siteSearchScript')) return;
  const styles = document.createElement('link');
  styles.rel = 'stylesheet';
  styles.href = '/assets/styles/search.css';
  document.head.append(styles);
  const script = document.createElement('script');
  script.id = 'siteSearchScript';
  script.src = '/assets/scripts/search.js';
  document.head.append(script);
})();
