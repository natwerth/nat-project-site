// assets/scripts/carousel.js
// Multi-instance Embla wiring with safe re-init and scoped controls.
(function () {
  const Embla = window.EmblaCarousel;
  const Wheel = window.EmblaCarouselWheelGestures || window.WheelGesturesPlugin || null;

  // Helper: bind an event listener just once per element & event type
  function addListenerOnce(el, type, handler, options, key = `__embla_bound_${type}`) {
    if (!el) return;
    if (el[key]) return;
    el.addEventListener(type, handler, options);
    el[key] = handler;
  }

  function initEmblaFor(rootSel) {
    const root = typeof rootSel === 'string' ? document.querySelector(rootSel) : rootSel;
    if (!root) return;

    const viewport = root.querySelector('.embla__viewport');
    const prevBtn  = root.querySelector('.embla__button--prev');
    const nextBtn  = root.querySelector('.embla__button--next');
    const dots     = [...root.querySelectorAll('.embla__dot')];

    if (!viewport || !Embla) return;

    // Reuse existing instance if present, otherwise create a new one
    let embla = viewport.__embla || null;
    const plugins = Wheel ? [Wheel({ forceWheelAxis: 'x' })] : [];
    if (!embla) {
      embla = Embla(viewport, {
        loop: true,
        draggable: true,
        dragFree: false,
        slidesToScroll: 1,
        containScroll: 'trimSnaps',
        align: 'start',
        duration: 30,
      }, plugins);
      viewport.__embla = embla;
    } else {
      embla.reInit();
    }

    // Dots state
    const setSelectedDot = () => {
      const i = embla.selectedScrollSnap();
      dots.forEach((d, idx) => {
        d.classList.toggle('is-selected', idx === i);
        d.setAttribute('aria-selected', idx === i ? 'true' : 'false');
        d.setAttribute('tabindex', idx === i ? '0' : '-1');
      });
    };

    // Only show chevron when text is actually clamped (scoped to root)
    const updateMoreButtons = () => {
      root.querySelectorAll('.tile').forEach((tile) => {
        const text = tile.querySelector('.tile__text');
        const moreBtn = tile.querySelector('.tile__more');
        if (!text || !moreBtn) return;
        const fits = text.scrollHeight <= text.clientHeight + 1; // rounding guard
        tile.classList.toggle('tile--clamped', !fits);
        moreBtn.style.display = fits ? 'none' : '';
      });
    };

    const onPrev = () => embla.scrollPrev();
    const onNext = () => embla.scrollNext();
    addListenerOnce(prevBtn, 'click', onPrev, { passive: true });
    addListenerOnce(nextBtn, 'click', onNext, { passive: true });

    dots.forEach((d, i) => {
      const onDot = () => embla.scrollTo(i);
      // use a unique key per element so each dot only binds once
      addListenerOnce(d, 'click', onDot, undefined, `__embla_bound_dot_${i}`);
    });

    embla.off('init');  embla.on('init', () => { setSelectedDot(); updateMoreButtons(); });
    embla.off('reInit'); embla.on('reInit', () => { setSelectedDot(); updateMoreButtons(); });
    embla.off('select'); embla.on('select', setSelectedDot);

    // Initial paint
    setSelectedDot();
    updateMoreButtons();

    // Fallback horizontal wheel if plugin is missing
    if (!Wheel && !viewport.__wheelPolyfilled) {
      viewport.__wheelPolyfilled = true;
      const k = 0.004; // tweak 0.003–0.008 to taste
      viewport.addEventListener('wheel', (e) => {
        if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
        e.preventDefault();
        embla.scrollBy(e.deltaX * k);
      }, { passive: false });
    }

    // Re-check clamps on resize
    if (!root.__emblaResizeBound) {
      root.__emblaResizeBound = true;
      window.addEventListener('resize', () => updateMoreButtons());
    }
  }

  // Global delegated handler for "... more" toggles (works for all carousels)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.tile__more');
    if (!btn) return;
    const tile = btn.closest('.tile');
    if (!tile) return;
    const expanded = tile.classList.toggle('tile--expanded');
    const icon = btn.querySelector('i');
    if (icon) {
      icon.classList.toggle('fa-chevron-down', !expanded);
      icon.classList.toggle('fa-chevron-up', expanded);
    } else {
      btn.textContent = expanded ? 'less' : '… more';
    }
    btn.setAttribute('aria-expanded', String(expanded));
  });

  // Boot on initial load
  function bootAll() {
    // Initialize any carousels present. Add selectors here as you create them.
    initEmblaFor('#letterboxd-carousel');
    initEmblaFor('#projects-carousel');
    // Also init any generic carousels using the base class if needed:
    // document.querySelectorAll('.embla').forEach(el => initEmblaFor(el));
  }

  if (document.readyState !== 'loading') bootAll();
  else document.addEventListener('DOMContentLoaded', bootAll);
  document.addEventListener('partials:loaded', bootAll);
  document.addEventListener('includes:ready', bootAll);
  document.addEventListener('carousel:content-updated', bootAll);
})();
