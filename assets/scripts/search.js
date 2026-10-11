/* Small, browser-only site search. Add public pages to SEARCH_PAGES below. */
(() => {
  'use strict';
  if (window.natSiteSearchLoaded) return;
  window.natSiteSearchLoaded = true;

  const SEARCH_PAGES = [
    { url: '/', title: 'Home' },
    { url: '/about/', title: 'About Nat' },
    { url: '/links/', title: 'Links', text: 'GitHub, Google Maps, LinkedIn, Instagram, Email, Venmo, Portfolio, Spotify, Letterboxd, YouTube, TikTok, Facebook.' },
    // Optional text covers labels rendered by JavaScript rather than HTML.
    { url: '/services/', title: 'Services', text: 'Custom Websites. CRM Hygiene Sprint.', sources: [
      '/partials/services/servicetilefragments/uat.html',
      '/partials/services/servicetilefragments/ops.html'
    ] }
  ];
  const FORM_SELECTOR = '#desktopSearch, #mobilePanel .mobile-search';
  const OMIT = 'script, style, template, noscript, #siteHeader, .site-header, footer, nav, form, svg, iframe, [data-search-ignore], [hidden], [aria-hidden="true"]';
  const normalize = text => text.replace(/\s+/g, ' ').trim();
  const downloads = new Map();
  const bindings = new Map();
  let indexPromise;
  let sequence = 0;

  function download(url) {
    if (downloads.has(url)) return downloads.get(url);
    const promise = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(url, { signal: controller.signal, credentials: 'same-origin' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (new URL(response.url || url).origin !== location.origin) throw new Error('External page');
        return await response.text();
      } finally {
        clearTimeout(timeout);
      }
    })();
    downloads.set(url, promise);
    promise.catch(() => downloads.delete(url));
    return promise;
  }

  // Parse into detached documents. Never execute the pages' scripts or inject
  // their HTML into the live page. Resolve nested includes just like includes.js.
  async function readContent(url, ancestors = []) {
    if (ancestors.includes(url) || ancestors.length >= 8) throw new Error('Recursive include');
    const html = await download(url);
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const root = parsed.querySelector('main') || parsed.body;
    root.querySelectorAll(OMIT).forEach(node => node.remove());
    let incomplete = false;
    for (const placeholder of [...root.querySelectorAll('[data-include]')]) {
      if (!root.contains(placeholder)) continue;
      const source = placeholder.getAttribute('data-include');
      if (!source) { placeholder.remove(); continue; }
      try {
        const includedURL = new URL(source, url);
        if (includedURL.origin !== location.origin) throw new Error('External include');
        if (/(?:^|\/)(?:header|footer)\.html$/i.test(includedURL.pathname)) {
          placeholder.remove();
          continue;
        }
        const included = await readContent(includedURL.href, [...ancestors, url]);
        placeholder.replaceWith(parsed.createTextNode(` ${included.text} `));
        incomplete ||= included.incomplete;
      } catch {
        incomplete = true;
        placeholder.remove();
      }
    }
    // Keep adjacent headings/paragraphs separate, even in minified HTML.
    root.querySelectorAll('br, p, div, section, article, li, h1, h2, h3, h4, h5, h6, td, th')
      .forEach(node => { node.before(' '); node.after(' '); });
    return { text: normalize(root.textContent || ''), incomplete };
  }

  function loadIndex() {
    if (indexPromise) return indexPromise;
    indexPromise = (async () => {
      const pages = [];
      let incomplete = false;
      let next = 0;
      // Limit background work to three page readers at a time.
      await Promise.all(Array.from({ length: 3 }, async () => {
        while (next < SEARCH_PAGES.length) {
          const page = SEARCH_PAGES[next++];
          try {
            const content = await readContent(new URL(page.url, location.origin).href);
            if (!content.text) throw new Error('Empty page');
            content.text = normalize(`${page.text || ''} ${content.text}`);
            for (const source of page.sources || []) {
              try {
                const extra = await readContent(new URL(source, location.origin).href);
                content.text += ` ${extra.text}`;
                content.incomplete ||= extra.incomplete;
              } catch { content.incomplete = true; }
            }
            pages.push({ ...page, text: content.text, lower: content.text.toLowerCase() });
            incomplete ||= content.incomplete;
          } catch {
            incomplete = true;
          }
        }
      }));
      return { pages, incomplete };
    })();
    return indexPromise;
  }

  function highlighted(text, query) {
    const fragment = document.createDocumentFragment();
    const lower = text.toLowerCase();
    let start = 0;
    let match;
    while ((match = lower.indexOf(query, start)) !== -1) {
      fragment.append(text.slice(start, match));
      const mark = document.createElement('mark');
      mark.textContent = text.slice(match, match + query.length);
      fragment.append(mark);
      start = match + query.length;
    }
    fragment.append(text.slice(start));
    return fragment;
  }

  function excerpt(page, query) {
    const match = page.lower.indexOf(query);
    let start = Math.max(0, match - 65);
    if (start) {
      const boundary = page.text.indexOf(' ', start);
      if (boundary !== -1 && boundary < match) start = boundary + 1;
    }
    let end = Math.min(page.text.length, Math.max(start + 190, match + query.length));
    if (end < page.text.length) {
      const boundary = page.text.lastIndexOf(' ', end);
      if (boundary > Math.max(start, match + query.length)) end = boundary;
    }
    return `${start ? '…' : ''}${page.text.slice(start, end)}${end < page.text.length ? '…' : ''}`;
  }

  function bind(form) {
    if (bindings.has(form)) return;
    const input = form.querySelector('input[name="s"]');
    if (!input) return;
    const mobile = form.classList.contains('mobile-search');
    const id = `site-search-results-${++sequence}`;
    const panel = document.createElement('div');
    panel.className = 'site-search-results';
    panel.id = id;
    panel.hidden = true;
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Search results');
    const status = document.createElement('p');
    status.className = 'site-search-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    const list = document.createElement('ul');
    list.className = 'site-search-list';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'site-search-retry';
    retry.textContent = 'Retry unavailable pages';
    retry.hidden = true;
    panel.append(status, list, retry);
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'site-search-clear';
    clear.textContent = 'Clear';
    clear.setAttribute('aria-label', 'Clear search');
    clear.hidden = true;
    form.append(clear, panel);
    input.setAttribute('aria-label', 'Search this site');
    input.setAttribute('aria-controls', id);
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('enterkeyhint', 'search');
    input.setAttribute('maxlength', '160');
    form.classList.add('site-search-enabled');
    let revision = 0;
    let timer;
    let composing = false;

    function close() {
      revision++;
      clearTimeout(timer);
      panel.hidden = true;
      if (mobile) form.parentElement.classList.remove('site-searching');
    }

    async function render() {
      clearTimeout(timer);
      const current = ++revision;
      const query = normalize(input.value).toLowerCase();
      clear.hidden = !input.value;
      list.replaceChildren();
      retry.hidden = true;
      panel.hidden = false;
      if (mobile) form.parentElement.classList.toggle('site-searching', !!query);
      if (!query) {
        status.textContent = 'Type a word or phrase to search this site.';
        return;
      }
      status.textContent = 'Searching…';
      const { pages, incomplete } = await loadIndex();
      if (current !== revision) return;
      const score = page => {
        const title = page.title.toLowerCase();
        return title === query ? 0 : title.startsWith(query) ? 1 : title.includes(query) ? 2 : 3;
      };
      const matches = pages.filter(page => page.title.toLowerCase().includes(query) || page.lower.includes(query))
        .sort((a, b) => score(a) - score(b) || a.title.localeCompare(b.title));
      status.textContent = pages.length === 0 ? 'Search could not load. Please try again.'
        : matches.length ? `${matches.length} ${matches.length === 1 ? 'page' : 'pages'} found.`
          : `No matches for “${normalize(input.value)}”. Try a shorter word or phrase.`;
      if (incomplete && pages.length) status.textContent += ' Some content is unavailable; results may be incomplete.';
      retry.hidden = !incomplete;
      for (const page of matches) {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.className = 'site-search-result';
        link.href = page.url;
        const title = document.createElement('strong');
        title.append(highlighted(page.title, query));
        const summary = document.createElement('span');
        summary.className = 'site-search-excerpt';
        summary.append(highlighted(excerpt(page, query), query));
        const path = document.createElement('span');
        path.className = 'site-search-path';
        path.textContent = page.url;
        link.append(title, summary, path);
        item.append(link);
        list.append(item);
      }
    }

    input.addEventListener('focus', () => { loadIndex(); if (panel.hidden) render(); });
    input.addEventListener('input', () => {
      revision++;
      clearTimeout(timer);
      clear.hidden = !input.value;
      // Remove stale links immediately while the new query is being prepared.
      list.replaceChildren();
      retry.hidden = true;
      if (!composing) {
        if (!normalize(input.value)) render();
        else timer = setTimeout(render, 180);
      }
    });
    input.addEventListener('compositionstart', () => { composing = true; clearTimeout(timer); });
    input.addEventListener('compositionend', () => { composing = false; render(); });
    form.addEventListener('submit', event => { event.preventDefault(); if (!composing) render(); });
    clear.addEventListener('click', () => { input.value = ''; input.focus(); render(); });
    retry.addEventListener('click', () => { indexPromise = undefined; input.focus(); render(); });
    form.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        const button = document.getElementById(mobile ? 'menuToggle' : 'closeSearch');
        button?.click();
        document.getElementById(mobile ? 'menuToggle' : 'searchToggle')?.focus();
      }
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !panel.hidden) {
        const links = [...list.querySelectorAll('a')];
        if (!links.length || (event.target !== input && !links.includes(event.target))) return;
        event.preventDefault();
        const position = links.indexOf(document.activeElement);
        if (event.key === 'ArrowDown') (links[position + 1] || input).focus();
        else (position <= 0 ? input : links[position - 1]).focus();
      }
    });
    form.addEventListener('focusout', () => {
      setTimeout(() => { if (!form.contains(document.activeElement)) close(); }, 0);
    });
    bindings.set(form, { close, mobile });
  }

  function init() { document.querySelectorAll(FORM_SELECTOR).forEach(bind); }
  document.addEventListener('DOMContentLoaded', init);
  document.addEventListener('includes:ready', init);
  document.addEventListener('click', event => {
    for (const [form, binding] of bindings) {
      if (event.target.closest('#closeSearch, #menuToggle, #sharedBackdrop') ||
          (!form.contains(event.target) && !event.target.closest('#searchToggle'))) binding.close();
    }
    if (event.target.closest('#closeSearch')) document.getElementById('searchToggle')?.focus();
  });
  // Keep results closed when the existing header controls or breakpoint hide them.
  window.addEventListener('resize', () => {
    for (const [form, binding] of bindings) if (!form.getClientRects().length) binding.close();
  }, { passive: true });
  function updateViewport() {
    document.documentElement.style.setProperty('--site-search-viewport-height', `${window.visualViewport?.height || window.innerHeight}px`);
  }
  window.visualViewport?.addEventListener('resize', updateViewport, { passive: true });
  window.addEventListener('resize', updateViewport, { passive: true });
  updateViewport();
  init();
})();
