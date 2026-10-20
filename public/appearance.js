// Run before styles load so saved appearance is applied before the first paint.
(() => {
  const key = 'taelgarverse-appearance', root = document.documentElement;
  const system = matchMedia('(prefers-color-scheme: dark)');
  const normalize = value => ['light','dark'].includes(value) ? value : 'system';
  let preference = 'system';
  try { preference = normalize(localStorage.getItem(key)); } catch { /* Storage may be unavailable. */ }
  function apply() {
    root.dataset.appearance = preference;
    root.dataset.theme = preference === 'system' ? (system.matches ? 'dark' : 'light') : preference;
    const select = document.getElementById('site-appearance');
    if (select) select.value = preference;
  }
  apply();
  system.addEventListener('change',apply);
  addEventListener('storage',event => {
    if (event.key !== key && event.key !== null) return;
    preference = normalize(event.newValue); apply();
  });
  document.addEventListener('DOMContentLoaded',() => {
    apply();
    document.getElementById('site-appearance')?.addEventListener('change',event => {
      preference = normalize(event.target.value);
      try { localStorage.setItem(key,preference); } catch { /* Still apply for this page. */ }
      apply();
    });
  });
})();
