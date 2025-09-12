// Lightweight include loader with recursion, base-URL resolution, timeouts, and script execution
const __includesProcessed = new WeakSet();

async function injectIncludes() {
  // Run passes until no new nodes remain
  let pass = 0;
  while (true) {
    pass++;
    const nodes = [...document.querySelectorAll('[data-include]')].filter((el) => !__includesProcessed.has(el));
    if (!nodes.length) break;

    const results = [];

    await Promise.all(
      nodes.map(async (el) => {
        const urlAttr = el.getAttribute('data-include');
        if (!urlAttr) return;

        // Resolve include URL relative to document for top-level
        const srcUrl = new URL(urlAttr, window.location.href);

        // Fetch with timeout
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        try {
          const res = await fetch(srcUrl.href, { cache: 'no-cache', signal: controller.signal });
          clearTimeout(timer);
          if (!res.ok) throw new Error(res.status + ' ' + res.statusText);

          const html = await res.text();
          const tpl = document.createElement('template');
          tpl.innerHTML = html;
          const fragment = tpl.content;

          // Rewrite nested [data-include] URLs to be absolute relative to this include's URL
          fragment.querySelectorAll('[data-include]').forEach((child) => {
            const childUrl = child.getAttribute('data-include');
            if (childUrl) child.setAttribute('data-include', new URL(childUrl, srcUrl).href);
          });

          // Ensure any <script> inside the include executes
          [...fragment.querySelectorAll('script')].forEach((oldScript) => {
            const s = document.createElement('script');
            for (const { name, value } of [...oldScript.attributes]) s.setAttribute(name, value);
            if (!oldScript.src) s.textContent = oldScript.textContent || '';
            oldScript.replaceWith(s);
          });

          // Replace placeholder with the included content
          const clone = document.importNode(fragment, true);
          el.replaceWith(clone);
          __includesProcessed.add(el);
          results.push({ url: srcUrl.href });
        } catch (err) {
          clearTimeout(timer);
          // Visible inline error so failures aren't invisible
          const msg = document.createElement('div');
          msg.setAttribute('data-include-error', '');
          msg.style.cssText = 'padding:12px;border:1px dashed var(--color-border,#d0d7de);font-size:12px;color:#a00;background:#fff6f6;border-radius:6px;';
          msg.textContent = `Include failed: ${srcUrl.href} — ${err?.message || err}`;
          el.replaceWith(msg);
          __includesProcessed.add(el);
        }
      })
    );

    // Announce after each pass so listeners can react
    requestAnimationFrame(() => {
      const evt = new CustomEvent('includes:ready', { detail: { pass } });
      document.dispatchEvent(evt);
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectIncludes, { once: true });
} else {
  injectIncludes();
}