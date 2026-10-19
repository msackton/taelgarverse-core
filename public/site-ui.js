(() => {
  const get = id => document.getElementById(id), root = document.documentElement;
  const header = get('site-header'), brand = document.querySelector('.site-brand');
  if (!header || !brand) return;
  const narrow = matchMedia('(max-width:1100px)'), mobile = matchMedia('(max-width:800px)');
  const sidebar = get('site-navigation'), layout = document.querySelector('.layout');
  const panels = [
    {name:'navigation',content:sidebar,home:layout,first:'.nav-tree a'},
    {name:'search',content:get('header-search'),home:get('header-search-slot'),first:'input[type="search"]'},
    {name:'settings',content:get('context-controls'),home:get('header-context-slot'),first:'#site-appearance'}
  ];
  // Keep the server-rendered links/forms usable when dialogs aren't supported.
  const dialogsSupported = panels.every(panel => typeof get(panel.name+'-dialog')?.showModal === 'function');
  if (dialogsSupported) {
    root.classList.add('site-interactive');
    panels.forEach(panel => {
      const dialog = get(panel.name+'-dialog'), button = get(panel.name+'-toggle');
      if (!button) return;
      button.hidden = false;
      button.addEventListener('click',() => {
        dialog.showModal();
        root.classList.add('site-dialog-open');
        dialog.querySelector(panel.first)?.focus();
      });
      dialog.addEventListener('close',() => {
        root.classList.remove('site-dialog-open');
        if (button.getClientRects().length) button.focus({preventScroll:true});
      });
      let startedOutside = false;
      const outside = event => {
        const rect = dialog.getBoundingClientRect();
        return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
      };
      dialog.addEventListener('pointerdown',event => { startedOutside = outside(event); });
      dialog.addEventListener('click',event => { if (event.target === dialog && startedOutside && outside(event)) dialog.close(); });
    });
    document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click',() => get(button.dataset.closeDialog).close()));
    function configure() {
      panels.forEach(panel => {
        const dialog = get(panel.name+'-dialog');
        if (dialog.open) dialog.close();
        if (panel.content) (narrow.matches ? get(panel.name+'-dialog-body') : panel.home).append(panel.content);
      });
      if (sidebar) sidebar.querySelector('.site-navigation').open = true;
      if (sidebar && !narrow.matches) requestAnimationFrame(() => {
        const current = sidebar.querySelector('[aria-current="page"]');
        if (!current) return;
        const offset = current.getBoundingClientRect().top - sidebar.getBoundingClientRect().top;
        if (offset > sidebar.clientHeight - 40) sidebar.scrollTop += offset - sidebar.clientHeight / 2;
      });
    }
    configure();
    narrow.addEventListener('change',configure);
  }
  // Below the article, backlinks remain available even though the mobile TOC is hidden.
  const backlinks = document.querySelector('.page-backlinks');
  if (backlinks) {
    const configureBacklinks = () => { backlinks.open = !mobile.matches; };
    configureBacklinks(); mobile.addEventListener('change',configureBacklinks);
  }
  const title = document.querySelector('.article-main h1'), back = get('back-to-top');
  const originalBrand = brand.textContent;
  const links = [...document.querySelectorAll('.page-contents a[href^="#"]')];
  const sections = links.map(link => document.getElementById(decodeURIComponent(link.hash.slice(1))));
  let lastY = Math.max(0,scrollY), direction = 0, distance = 0, returning = false, pending = false;
  function update(track = false) {
    const bottom = header.getBoundingClientRect().bottom;
    const past = title && title.getBoundingClientRect().bottom <= bottom;
    const label = past ? title.textContent : originalBrand;
    if (brand.textContent !== label) brand.textContent = label;
    brand.classList.toggle('is-page-title',!!past);
    brand.title = past ? label + ' — TaelgarVerse home' : originalBrand;
    brand.setAttribute('aria-label',past ? label + ' — TaelgarVerse home' : originalBrand);
    const y = Math.max(0,scrollY), delta = y-lastY;
    if (track && delta) {
      const next = Math.sign(delta);
      distance = direction === next ? distance + Math.abs(delta) : Math.abs(delta);
      direction = next;
      if (next > 0) returning = false;
      if (!returning && distance >= 12) back.hidden = next > 0 || y <= 500;
    }
    if (y <= 500) { back.hidden = true; returning = false; }
    lastY = y;
    let active = 0;
    sections.forEach((section,index) => { if (section && section.getBoundingClientRect().top <= bottom+24) active = index; });
    links.forEach((link,index) => {
      link.classList.toggle('is-active',index===active);
      if (index===active) link.setAttribute('aria-current','location');
      else link.removeAttribute('aria-current');
    });
  }
  back.addEventListener('click',() => {
    returning = true; back.hidden = true;
    scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth'});
    brand.focus({preventScroll:true});
  });
  new ResizeObserver(() => {
    root.style.setProperty('--header-height',header.getBoundingClientRect().height+'px');
    update();
  }).observe(header);
  addEventListener('scroll',() => {
    if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; update(true); }); }
  },{passive:true});
  update();
})();
