import { initCarousel } from './carousel.js';

const loading = new WeakSet();
const feedURL = 'https://nat-letterboxd-proxy.nat-1fa.workers.dev/';
const allReviewsURL = 'https://letterboxd.com/natwerth/films/reviews/';

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

function webURL(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function reviewSlide(item) {
  const field = name => item.getElementsByTagNameNS('*', name)[0]?.textContent?.trim() || '';
  const title = field('filmTitle') || field('title') || 'Untitled';
  const link = webURL(field('link'));
  const description = new DOMParser().parseFromString(field('description'), 'text/html');
  const posterURL = webURL(description.querySelector('img')?.getAttribute('src'));
  const blurb = description.body.textContent.trim();
  const rawRating = field('memberRating');
  const numericRating = Number(rawRating);
  const rating = rawRating && Number.isFinite(numericRating) && numericRating >= 0 && numericRating <= 5
    ? '★'.repeat(Math.floor(numericRating)) + (numericRating % 1 >= 0.5 ? '½' : '')
    : (field('description').match(/★+[½]?/) || [''])[0];
  const rewatch = field('rewatch') === 'Yes' || /rewatch/i.test(blurb) || !!description.querySelector('.rewatch');

  const slide = element('li', 'carousel__slide');
  const card = element(link ? 'a' : 'article', 'carousel__tile carousel__tile--movie');
  if (link) {
    card.href = link;
    card.target = '_blank';
    card.rel = 'noopener';
    card.setAttribute('aria-label', `View ${title} on Letterboxd`);
  }
  const header = element('div', 'carousel__movie-header');
  if (posterURL) {
    const poster = element('img', 'carousel__poster');
    poster.src = posterURL;
    poster.alt = '';
    poster.width = 72;
    poster.height = 108;
    poster.loading = 'lazy';
    poster.decoding = 'async';
    header.append(poster);
  }

  const details = element('div', 'carousel__movie-details');
  details.append(element('h3', 'carousel__title', title));
  if (rating || rewatch || rawRating === '0') {
    const metadata = element('p', 'carousel__rating', [rating || (rawRating === '0' ? '0 stars' : ''), rewatch ? '⟲ Rewatch' : ''].filter(Boolean).join(' · '));
    if (rawRating && Number.isFinite(numericRating) && numericRating >= 0 && numericRating <= 5) {
      metadata.setAttribute('aria-label', `Rated ${numericRating} out of 5${rewatch ? ', rewatch' : ''}`);
    }
    details.append(metadata);
  }
  header.append(details);
  card.append(header);
  if (blurb) card.append(element('p', 'carousel__excerpt', blurb));

  const footer = element('div', 'carousel__movie-footer');
  const date = new Date(field('pubDate'));
  if (!Number.isNaN(date.getTime())) {
    const time = element('time', 'carousel__review-date', `Reviewed on ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`);
    time.dateTime = date.toISOString();
    footer.append(time);
  }
  if (link) {
    // The whole tile is one native link, including this visual button.
    footer.append(element('span', 'carousel__more', 'View on Letterboxd →'));
  }
  card.append(footer);
  slide.append(card);
  return slide;
}

function allReviewsSlide() {
  const slide = element('li', 'carousel__slide carousel__slide--all');
  const link = element('a', 'carousel__tile carousel__tile--all');
  link.href = allReviewsURL;
  link.target = '_blank';
  link.rel = 'noopener';
  link.setAttribute('aria-label', 'See all movie reviews on Letterboxd');
  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  arrow.setAttribute('viewBox', '0 0 24 24');
  arrow.setAttribute('fill', 'none');
  arrow.setAttribute('stroke', 'currentColor');
  arrow.setAttribute('stroke-width', '1.5');
  arrow.setAttribute('stroke-linecap', 'round');
  arrow.setAttribute('stroke-linejoin', 'round');
  arrow.setAttribute('aria-hidden', 'true');
  arrow.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M4 12h16m-7-7 7 7-7 7');
  arrow.append(path);
  link.append(arrow, element('span', '', 'See all'));
  slide.append(link);
  return slide;
}

async function loadReviews(root) {
  if (loading.has(root)) return;
  loading.add(root);
  const track = root.querySelector('.carousel__track');
  const view = root.querySelector('.carousel__view');
  const message = root.querySelector('[data-movie-message]');
  track.setAttribute('aria-busy', 'true');
  message.textContent = 'Loading movie reviews…';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(feedURL, { signal: controller.signal });
    if (!response.ok) throw new Error(`Movie feed returned ${response.status}`);
    const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
    if (xml.querySelector('parsererror') || !xml.querySelector('rss > channel')) {
      throw new Error('Invalid movie feed');
    }
    const items = [...xml.querySelectorAll('channel > item')].slice(0, 6);
    if (!items.length) {
      message.textContent = 'No movie reviews are available yet.';
      return;
    }
    track.replaceChildren(...items.map(reviewSlide), allReviewsSlide());
    view.hidden = false;
    message.hidden = true;
    // The shared include event can occur before the feed has finished loading.
    initCarousel(root);
  } catch {
    message.textContent = 'Movie reviews couldn’t load. Please try again later.';
  } finally {
    clearTimeout(timeout);
    track.setAttribute('aria-busy', 'false');
  }
}

function initMovies() {
  document.querySelectorAll('.carousel--movies[data-carousel]').forEach(loadReviews);
}

document.addEventListener('includes:ready', initMovies);
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMovies, { once: true });
} else {
  initMovies();
}
