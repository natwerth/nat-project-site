// One module shared by every copy of the partial, including later includes.
const initialized = new WeakSet();
let instanceNumber = 0;

export function initCarousel(root) {
  if (initialized.has(root)) return;
  const track = root.querySelector('.carousel__track');
  const controls = root.querySelector('.carousel__controls');
  const prev = root.querySelector('[data-carousel-prev]');
  const next = root.querySelector('[data-carousel-next]');
  const dotsContainer = root.querySelector('.carousel__dots');
  const status = root.querySelector('.carousel__status');
  if (!track || !controls || !prev || !next || !dotsContainer || !status) return;
  const slides = Array.from(track.children).filter(el => el.matches('.carousel__slide'));
  controls.hidden = slides.length < 2;
  // A feed may still be loading. Its renderer will call us after adding slides.
  if (!slides.length) return;
  initialized.add(root);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const prefix = `tile-carousel-${++instanceNumber}`;
  const heading = root.closest('.carousel-section')?.querySelector(':scope > .carousel__heading')
    || root.querySelector('.carousel__heading');
  track.id = `${prefix}-track`;
  if (heading) {
    heading.id = `${prefix}-heading`;
    root.setAttribute('aria-labelledby', heading.id);
  }
  prev.setAttribute('aria-controls', track.id);
  next.setAttribute('aria-controls', track.id);
  let activeIndex = 0;
  let requestedIndex = null;
  let stops = [];
  let dots = [];
  let scrollFrame = 0;
  let layoutFrame = 0;
  let settleTimer;

  slides.forEach((slide, index) => {
    slide.id = `${prefix}-tile-${index + 1}`;
  });

  function updateDots() {
    // Several final tiles can share the same end position on a wide screen.
    // Give each reachable position one dot, avoiding duplicate end buttons.
    if (dots.length === stops.length) return;
    dots = stops.map((_, index) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'carousel__dot';
      dot.setAttribute('aria-label', `Go to position ${index + 1} of ${stops.length}`);
      dot.setAttribute('aria-controls', track.id);
      dot.addEventListener('click', () => goTo(index));
      return dot;
    });
    dotsContainer.replaceChildren(...dots);
  }

  function positionForSlide(slideIndex) {
    const index = stops.findIndex(stop => stop.slideIndex >= slideIndex);
    return index < 0 ? stops.length - 1 : index;
  }

  function nearestIndex() {
    let nearest = 0;
    for (let index = 1; index < stops.length; index++) {
      if (Math.abs(stops[index].left - track.scrollLeft) <
          Math.abs(stops[nearest].left - track.scrollLeft)) nearest = index;
    }
    return nearest;
  }

  function render() {
    activeIndex = nearestIndex();
    dots.forEach((dot, index) => {
      if (index === activeIndex) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
    // Keep repeated clicks moving through tiles even during smooth scrolling.
    const destination = requestedIndex ?? activeIndex;
    prev.disabled = destination === 0;
    next.disabled = destination === stops.length - 1;
  }

  function settle() {
    clearTimeout(settleTimer);
    requestedIndex = null;
    render();
    const viewport = track.getBoundingClientRect();
    const style = getComputedStyle(track);
    const left = viewport.left + (parseFloat(style.paddingInlineStart) || 0);
    const right = viewport.right - (parseFloat(style.paddingInlineEnd) || 0);
    const visible = slides.map((slide, index) => ({ index, box: slide.getBoundingClientRect() }))
      .filter(({ box }) => box.right > left + 1 && box.left < right - 1);
    if (!visible.length) return;
    const first = visible[0].index + 1;
    const last = visible[visible.length - 1].index + 1;
    const message = first === last ? `Tile ${first} of ${slides.length}`
      : `Tiles ${first} to ${last} of ${slides.length}`;
    if (status.textContent !== message) status.textContent = message;
  }

  function goTo(index, behavior = reduceMotion.matches ? 'instant' : 'smooth') {
    if (!stops.length) return;
    requestedIndex = Math.max(0, Math.min(index, stops.length - 1));
    track.scrollTo({ left: stops[requestedIndex].left, behavior });
    render();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 180);
  }

  function measure() {
    if (!track.clientWidth) return;
    const current = requestedIndex ?? activeIndex;
    const preserveSlide = stops[current]?.slideIndex ?? 0;
    const preserveEnd = stops.length > 1 && current === stops.length - 1;
    const style = getComputedStyle(track);
    const gutter = parseFloat(style.scrollPaddingInlineStart) || 0;

    // Reserve vertical paint room even when duplicated tiles contain long text.
    const scale = parseFloat(getComputedStyle(root).getPropertyValue('--carousel-hover-scale')) || 1;
    const tallest = Math.max(...slides.map(slide => slide.getBoundingClientRect().height));
    const hoverRoom = Math.max(24, Math.ceil(tallest * Math.max(0, scale - 1) / 2 + 12));
    track.style.setProperty('--carousel-hover-room', `${hoverRoom}px`);

    const trackLeft = track.getBoundingClientRect().left + track.clientLeft;
    const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
    stops = [];
    slides.forEach((slide, slideIndex) => {
      const left = Math.min(maxScroll, Math.max(0,
        slide.getBoundingClientRect().left - trackLeft + track.scrollLeft - gutter));
      if (!stops.length || left - stops[stops.length - 1].left > 1) {
        stops.push({ left, slideIndex });
      }
    });
    controls.hidden = stops.length < 2;
    updateDots();
    goTo(preserveEnd ? stops.length - 1 : positionForSlide(preserveSlide), 'instant');
    settle();
  }

  function scheduleMeasure() {
    cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(measure);
  }

  prev.addEventListener('click', () => goTo((requestedIndex ?? nearestIndex()) - 1));
  next.addEventListener('click', () => goTo((requestedIndex ?? nearestIndex()) + 1));

  track.addEventListener('scroll', () => {
    if (!scrollFrame) {
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        render();
      });
    }
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 180); // Fallback for browsers without scrollend.
  }, { passive: true });
  track.addEventListener('scrollend', settle);

  for (const eventName of ['pointerdown', 'touchstart', 'wheel']) {
    track.addEventListener(eventName, () => { requestedIndex = null; }, { passive: true });
  }

  track.addEventListener('keydown', event => {
    // Do not consume keys belonging to links, form inputs, or other tile content.
    if (event.target !== track || event.altKey || event.ctrlKey || event.metaKey) return;
    const current = requestedIndex ?? nearestIndex();
    const destinations = { ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: stops.length - 1 };
    if (!(event.key in destinations)) return;
    event.preventDefault();
    goTo(destinations[event.key]);
  });

  track.addEventListener('focusin', event => {
    const slide = event.target.closest('.carousel__slide');
    const index = slides.indexOf(slide);
    if (index < 0) return;
    const box = slide.getBoundingClientRect();
    const viewport = track.getBoundingClientRect();
    const gutter = parseFloat(getComputedStyle(track).scrollPaddingInlineStart) || 0;
    if (box.left < viewport.left + gutter - 1 || box.right > viewport.right - gutter + 1) {
      goTo(positionForSlide(index), 'instant');
    }
  });

  // Container and tile sizes can change independently of the browser viewport.
  const resizeObserver = new ResizeObserver(scheduleMeasure);
  resizeObserver.observe(track);
  slides.forEach(slide => resizeObserver.observe(slide));
  window.addEventListener('resize', scheduleMeasure, { passive: true });
  reduceMotion.addEventListener('change', () => {
    if (reduceMotion.matches && requestedIndex !== null) goTo(requestedIndex, 'instant');
  });
  measure();
}

function initCarousels() {
  document.querySelectorAll('[data-carousel]').forEach(initCarousel);
}

document.addEventListener('includes:ready', initCarousels);
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCarousels, { once: true });
} else {
  initCarousels();
}
