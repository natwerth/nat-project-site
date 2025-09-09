(() => {
  const FEED_URL = "https://nat-letterboxd-proxy.nat-1fa.workers.dev/";
  const processed = new WeakSet();
  const RENDERING = Symbol('letterboxd-rendering');

  // ---- tiny utils ----
  const html = (s) => {
    const t = document.createElement("template");
    t.innerHTML = s.trim();
    return t.content;
  };

  async function fetchItems() {
    const res = await fetch(FEED_URL, { cache: "no-store", credentials: "omit" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const xmlText = await res.text();
    const xml = new DOMParser().parseFromString(xmlText, "application/xml");
    const items = [...xml.querySelectorAll("item")].slice(0, 8);
    return items.map((it) => {
      const title = it.querySelector("title")?.textContent?.trim() || "Untitled";
      const link = it.querySelector("link")?.textContent?.trim() || "#";
      const pub = it.querySelector("pubDate")?.textContent || "";
      const descRaw = it.querySelector("description")?.textContent || "";

      const frag = new DOMParser().parseFromString(descRaw, "text/html");
      const posterUrl = frag.querySelector("img")?.getAttribute("src") || "";
      const blurb = frag.body?.textContent?.trim() || "";

      const rating = (descRaw.match(/★+/) || [""])[0]; // e.g., ★★★★
      const rewatch = /rewatch/i.test(blurb) || /class="rewatch"/i.test(descRaw);
      const dateStr = pub
        ? new Date(pub).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
        : "";

      return { title, link, posterUrl, blurb, rating, rewatch, dateStr };
    });
  }

  function renderSlides(root, items) {
    const container = root.querySelector('.embla__container') || root;
    if (!container) return;

    const slides = items.map((r, i) => `
      <div class="embla__slide" id="lb-slide-${i + 1}">
        <article class="tile" aria-label="${r.title}">
          <img class="tile__img tile__img--poster tile__img--sm"
               src="${r.posterUrl}"
               alt="Poster for ${r.title}"
               loading="lazy" decoding="async" draggable="false" />
          <h3 class="tile__title">${r.title} ${r.rating ? `• ${r.rating}` : ""}${
            r.rewatch ? ' <span title="Rewatch" aria-label="Rewatch">⟲</span>' : ""
          }</h3>
          <div class="tile__text-wrap">
            <p class="tile__text">${r.blurb || ""}</p>
            <div class="tile__fade"></div>
            <button class="tile__more" type="button" aria-expanded="false">… more</button>
          </div>
          <p class="tile__meta" style="margin:0 12px 12px; color:var(--muted); font-size:12px;">
            ${r.dateStr ? `Reviewed ${r.dateStr} · ` : ""}<a href="${r.link}" target="_blank" rel="noopener">View on Letterboxd →</a>
          </p>
        </article>
      </div>`).join("");

    container.innerHTML = ""; // clear placeholders
    container.appendChild(html(slides));
  }

  function init() {
    const roots = document.querySelectorAll('.embla.letterboxd, #carousel.letterboxd.embla');
    if (!roots.length) return;

    roots.forEach(async (root) => {
      // Bail if we already processed this specific root
      if (processed.has(root) && !root[RENDERING]) return;
      if (root[RENDERING]) return; // in-flight render
      root[RENDERING] = true;

      try {
        const items = await fetchItems();
        renderSlides(root, items);

        // Prevent clicks on internal controls from bubbling to any parent listeners
        root.querySelectorAll('.tile__more, a').forEach((el) => {
          el.addEventListener('click', (e) => e.stopPropagation(), { passive: true });
        });

        // Let shared carousel.js reInit Embla for this root (no double-binding here)
        document.dispatchEvent(new CustomEvent('carousel:content-updated', { detail: { id: 'letterboxd' } }));

        processed.add(root);
      } catch (err) {
        const container = root.querySelector('.embla__container') || root;
        if (container) {
          container.innerHTML = `
            <div class="embla__slide">
              <article class="tile">
                <h3 class="tile__title">Couldn’t load reviews</h3>
                <p class="tile__text" style="color:var(--muted)">${err.message}</p>
              </article>
            </div>`;
        }
        console.error('[letterboxd]', err);
      } finally {
        delete root[RENDERING];
      }
    });
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
  document.addEventListener('partials:loaded', init);
  document.addEventListener('includes:ready', init);
})();