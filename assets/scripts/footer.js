
  document.querySelectorAll('.js-year').forEach(el => {
    el.textContent = String(new Date().getFullYear());
  });
