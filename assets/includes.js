async function injectIncludes(){
  const nodes = document.querySelectorAll('[data-include]');
  await Promise.all([...nodes].map(async el => {
    const url = el.getAttribute('data-include');
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) return;
    const html = await res.text();
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    el.replaceWith(...tmp.childNodes);
  }));
  // announce on the next frame so layout/IDs exist
  requestAnimationFrame(() => {
    document.dispatchEvent(new Event('includes:ready'));
  });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectIncludes);
} else {
  injectIncludes();
}