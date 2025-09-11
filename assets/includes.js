// Lightweight include loader with idempotence, timeouts, and script execution
const __includesProcessed = new WeakSet();

async function injectIncludes() {
  const nodes = document.querySelectorAll('[data-include]');
  const results = [];

  await Promise.all(
    [...nodes].map(async (el) => {
      if (__includesProcessed.has(el)) return; // idempotent
      const url = el.getAttribute('data-include');
      if (!url) return;

      // Fetch with timeout
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);

      try {
        const res = await fetch(url, { cache: 'force-cache', signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) {
          console.warn(`[includes] Failed to fetch ${url}: ${res.status} ${res.statusText}`);
          return;
        }

        const html = await res.text();

        // Parse fragment via <template> so we can safely clone
        const tpl = document.createElement('template');
        tpl.innerHTML = html;
        const fragment = tpl.content;

        // Ensure any <script> inside the include actually executes
        const scripts = [...fragment.querySelectorAll('script')];
        scripts.forEach((oldScript) => {
          const newScript = document.createElement('script');
          // copy attributes (type, src, async, defer, etc.)
          for (const { name, value } of [...oldScript.attributes]) {
            newScript.setAttribute(name, value);
          }
          if (!oldScript.src) {
            newScript.textContent = oldScript.textContent || '';
          }
          // Replace in-place so order is preserved
          oldScript.replaceWith(newScript);
        });

        // Default behavior: replace placeholder element with included children
        // (keeps DOM lean vs. wrapping)
        const clone = document.importNode(fragment, true);
        el.replaceWith(clone);
        __includesProcessed.add(el);
        results.push({ url });
      } catch (err) {
        if (err?.name === 'AbortError') {
          console.warn(`[includes] Timed out fetching ${url}`);
        } else {
          console.warn(`[includes] Error fetching ${url}:`, err);
        }
      } finally {
        clearTimeout(timer);
      }
    })
  );

  // announce on the next frame so layout/IDs exist
  requestAnimationFrame(() => {
    const evt = new CustomEvent('includes:ready', { detail: { includes: results } });
    document.dispatchEvent(evt);
  });
}

// Run after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectIncludes, { once: true });
} else {
  injectIncludes();
}