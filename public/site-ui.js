(() => {
  const get = id => document.getElementById(id), root = document.documentElement;
  const header = get('site-header'), brand = document.querySelector('.site-brand');
  if (!header || !brand) return;
  const narrow = matchMedia('(max-width:1100px)'), mobile = matchMedia('(max-width:800px)');
  const sidebar = get('site-navigation'), layout = document.querySelector('.layout');
  const panels = [
    {name:'navigation',content:sidebar,home:layout,first:'.nav-tree a'},
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
  const brandLabel = brand.querySelector('.site-brand-label') || brand;
  const originalBrand = brandLabel.textContent;
  const links = [...document.querySelectorAll('.page-contents a[href^="#"]')];
  const sections = links.map(link => document.getElementById(decodeURIComponent(link.hash.slice(1))));
  // Clamp elastic overscroll so bouncing at the page ends is not a direction change.
  const scrollPosition = () => Math.min(Math.max(0,scrollY),Math.max(0,root.scrollHeight-innerHeight));
  let lastY = scrollPosition(), downwardStart = lastY, returning = false, pending = false;
  function trackScroll() {
    const y = scrollPosition(), delta = y-lastY;
    lastY = y;
    if (y <= Math.max(80,header.getBoundingClientRect().height)) {
      back.hidden = true; returning = false;
    } else if (delta < 0 && !returning) {
      // Show on even a small upward movement, including on shorter pages.
      back.hidden = false;
    } else if (delta > 0) {
      returning = false;
      // Small touch/trackpad reversals should not make the control flicker away.
      if (y-downwardStart >= 12) back.hidden = true;
    }
    if (delta < 0) downwardStart = y;
  }
  function update() {
    const bottom = header.getBoundingClientRect().bottom;
    const past = title && title.getBoundingClientRect().bottom <= bottom;
    const label = past ? title.textContent : originalBrand;
    if (brandLabel.textContent !== label) brandLabel.textContent = label;
    brand.classList.toggle('is-page-title',!!past);
    brand.title = past ? label + ' — TaelgarVerse home' : originalBrand;
    brand.setAttribute('aria-label',past ? label + ' — TaelgarVerse home' : originalBrand + ' home');
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
  // An interrupted smooth return must not suppress later upward scrolling.
  const interruptReturn = () => { returning = false; };
  for (const event of ['wheel','touchstart','pointerdown','scrollend']) addEventListener(event,interruptReturn,{passive:true});
  addEventListener('keydown',event => {
    if (['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key)) interruptReturn();
  });
  new ResizeObserver(() => {
    root.style.setProperty('--header-height',header.getBoundingClientRect().height+'px');
    update();
  }).observe(header);
  addEventListener('scroll',() => {
    trackScroll();
    if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; update(); }); }
  },{passive:true});
  update();
})();
