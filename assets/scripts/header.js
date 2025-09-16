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

  function openPanel(){
    const p = panel(); if (!p) return;
    p.hidden = false;
    requestAnimationFrame(()=> p.classList.add('open'));
    docEl.classList.add('menu-open');
    const b = menuBtn(); if (b){ b.classList.add('is-active'); b.setAttribute('aria-expanded','true'); }
  }
  function closePanel(){
    const p = panel(); if (!p) return;
    p.classList.remove('open');
    p.addEventListener('transitionend', function te(e){
      if(e.propertyName === 'transform' && !p.classList.contains('open')){
        p.hidden = true; p.removeEventListener('transitionend', te);
      }
    });
    docEl.classList.remove('menu-open');
    const b = menuBtn(); if (b){ b.classList.remove('is-active'); b.setAttribute('aria-expanded','false'); }
  }
  function toggleMenu(){ (panel()?.classList.contains('open') ? closePanel : openPanel)(); }

  function openSearch(){
    const h = header(); const sb = searchBtn();
    if (!h || !sb) return;
    h.classList.add('search-open');
    sb.setAttribute('aria-expanded','true'); sb.setAttribute('aria-label','Close search');
    const box = searchBox(); if (box) setTimeout(()=> box.focus({preventScroll:true}), 40);
    requestAnimationFrame(setHeaderVar);
  }
  function closeSearch(){
    const h = header(); const sb = searchBtn();
    if (!h || !sb) return;
    h.classList.remove('search-open');
    sb.setAttribute('aria-expanded','false'); sb.setAttribute('aria-label','Open search');
    requestAnimationFrame(setHeaderVar);
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
    window.addEventListener('resize', ()=>{ setHeaderVar(); }, {passive:true});
    window.visualViewport && window.visualViewport.addEventListener('resize', ()=>{ setHeaderVar(); }, {passive:true});

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