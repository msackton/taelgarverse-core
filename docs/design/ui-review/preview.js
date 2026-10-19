// Runs only inside the isolated proposal frame.
(() => {
  const {page, showNavigation, showContents, hash} = JSON.parse(document.getElementById('preview-data').textContent);
  const article = document.getElementById('article');
  article.innerHTML = page.html;
  const actions = document.getElementById('place-actions');
  const relationshipDialog = document.getElementById('relationship-dialog');
  let currentCards = [], currentKind = '';
  function drawCards() {
    const grid = document.getElementById('relationship-grid');
    grid.replaceChildren();
    const query = document.getElementById('relationship-filter').value.trim().toLowerCase();
    const filtered = currentCards.filter(card => `${card.name} ${card.description}`.toLowerCase().includes(query));
    filtered.forEach(card => {
      const item = document.createElement('li'), link = document.createElement('a');
      link.className = 'relationship-card'; link.href = card.href;
      const portrait = document.createElement('div'); portrait.className = 'relationship-portrait'; portrait.setAttribute('aria-hidden','true');
      if (card.image) {
        const image = document.createElement('img'); image.src = card.image; image.alt = ''; image.loading = 'lazy'; portrait.append(image);
      } else portrait.textContent = card.name.split(/\s+/).slice(0,2).map(word => word[0]).join('');
      const copy = document.createElement('div'), name = document.createElement('strong'), description = document.createElement('p');
      copy.className = 'relationship-card-copy'; name.textContent = card.name; description.textContent = card.description;
      copy.append(name,description); link.append(portrait,copy); item.append(link); grid.append(item);
    });
    const empty = document.getElementById('relationship-empty');
    empty.hidden = filtered.length > 0;
    empty.textContent = query ? 'No matching names or descriptions.' : `No ${currentKind} recorded for this place.`;
  }
  document.getElementById('relationship-filter').addEventListener('input',drawCards);
  for (const [kind,cards] of Object.entries(page.relationships || {})) {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = kind === 'residents' ? 'Residents' : 'Settlements';
    button.setAttribute('aria-haspopup','dialog'); button.setAttribute('aria-controls','relationship-dialog');
    button.addEventListener('click', () => {
      currentCards = cards; currentKind = kind;
      document.getElementById('relationship-title').textContent = `${button.textContent} of ${page.title}`;
      document.getElementById('relationship-context').textContent = kind === 'residents' ? `Recorded homes in ${page.title}, including its neighborhoods · ${page.context.date} DR` : `Settlements in ${page.title}, including its subregions · ${page.context.date} DR`;
      document.getElementById('relationship-filter').value = '';
      drawCards(); relationshipDialog.showModal();
    });
    actions.append(button);
  }
  if (actions.children.length) {
    const header = article.querySelector(':scope > .grid.cards') || article.querySelector('h1');
    header?.insertAdjacentElement('afterend',actions);
    actions.hidden = false;
  }
  relationshipDialog.addEventListener('click', event => {
    if (event.target !== relationshipDialog) return;
    const rect = relationshipDialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) relationshipDialog.close();
  });
  if (page.relatedFrom) {
    const back = document.getElementById('related-back'); back.hidden = false;
    back.textContent = '← Back to ' + page.relatedFrom.title; back.href = page.relatedFrom.href;
  }
  document.getElementById('navigation').innerHTML = page.navigation;
  document.getElementById('breadcrumbs').innerHTML = page.breadcrumbs;
  document.getElementById('toc').innerHTML = page.toc;
  document.getElementById('contents-title').textContent = page.title;
  // Reuse the real context choices and selected values from this snapshot.
  document.getElementById('context-controls').innerHTML = page.currentDocument.match(/<form class="context-form"[\s\S]*?<\/form>/)?.[0] || '';
  document.querySelector('#navigation .nav-search')?.remove();
  const navigationDetails = document.querySelector('.site-navigation');
  if (navigationDetails) navigationDetails.open = true;
  document.querySelector('.site-navigation > summary')?.addEventListener('click', event => event.preventDefault());
  document.querySelector('.context-form')?.addEventListener('change', event => {
    event.currentTarget.reset();
    document.getElementById('settings-dialog').close();
    parent.postMessage({kind:'reference-context'}, '*');
  });
  const hasContents = showContents && !!document.querySelector('#toc a');
  const hasNavigation = showNavigation && !!page.navigation;
  document.getElementById('navigation-toggle').hidden = !hasNavigation;
  const roots = [...document.querySelectorAll('#navigation .nav-tree > li')];
  const activeRoot = roots.find(root => root.querySelector('[aria-current="page"]'));
  const sectionHeading = document.querySelector('.site-navigation > summary');
  const rootLink = root => root?.querySelector(':scope > a, :scope > details > summary > a');
  const activeLabel = rootLink(activeRoot)?.textContent || 'Explore Taelgar';
  const hasSection = !!activeRoot?.querySelector(':scope > details > ul > li');
  roots.forEach(root => {
    const source = rootLink(root);
    if (!source) return;
    const item = document.createElement('li'), link = document.createElement('a');
    link.href = source.getAttribute('href');
    link.textContent = source.textContent;
    if (root === activeRoot) link.setAttribute('aria-current', 'location');
    root.classList.toggle('active-section', root === activeRoot);
    item.append(link);
    document.getElementById('section-links').append(item);
  });
  document.getElementById('section-navigation').hidden = !hasNavigation;
  const mobile = matchMedia('(max-width:800px)'), narrow = matchMedia('(max-width:1100px)');
  const panels = [
    {button:'navigation-toggle', dialog:'navigation-dialog', content:'navigation', desktop:'.site-layout', media:mobile, first:'.nav-tree a'},
    {button:'search-toggle', dialog:'search-dialog', content:'header-search', desktop:'#header-search-slot', media:narrow, first:'input'},
    {button:'settings-toggle', dialog:'settings-dialog', content:'context-controls', desktop:'#header-context-slot', media:mobile, first:'select'}
  ];
  panels.forEach(panel => {
    const dialog = document.getElementById(panel.dialog);
    document.getElementById(panel.button).addEventListener('click', () => {
      dialog.showModal();
      dialog.querySelector(panel.first)?.focus();
    });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
  });
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.closeDialog).close()));
  function configurePanels() {
    panels.forEach(panel => {
      const dialog = document.getElementById(panel.dialog);
      if (dialog.open) dialog.close();
      const destination = panel.media.matches ? document.getElementById(panel.dialog + '-body') : document.querySelector(panel.desktop);
      // Move, rather than duplicate, each control so IDs and form state stay unique.
      destination.append(document.getElementById(panel.content));
    });
    document.querySelector('.contents-slot').hidden = !hasContents || mobile.matches;
    document.querySelector('.site-layout').classList.toggle('no-toc', !hasContents || mobile.matches);
    const sidebarVisible = hasNavigation && (mobile.matches || hasSection);
    document.getElementById('navigation').hidden = !sidebarVisible;
    document.querySelector('.site-layout').classList.toggle('no-nav', !sidebarVisible);
    if (sectionHeading) sectionHeading.textContent = mobile.matches ? 'Explore Taelgar' : activeLabel;
  }
  configurePanels();
  mobile.addEventListener('change', configurePanels);
  narrow.addEventListener('change', configurePanels);
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--header-height', document.getElementById('site-header').getBoundingClientRect().height + 'px');
  }).observe(document.getElementById('site-header'));
  const links = [...document.querySelectorAll('#toc a')];
  const sections = links.map(link => document.getElementById(decodeURIComponent(link.hash.slice(1))));
  let pending = false;
  function trackSection() {
    pending = false;
    let active = 0;
    sections.forEach((section, index) => { if (section && section.getBoundingClientRect().top <= 120) active = index; });
    links.forEach((link, index) => {
      link.classList.toggle('active', index === active);
      if (index === active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  trackSection();
  addEventListener('scroll', () => { if (!pending) { pending = true; requestAnimationFrame(trackSection); } }, {passive:true});
  document.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link) return;
    const href = link.getAttribute('href');
    // srcdoc inherits the review document's base URL, so fragment links must
    // scroll this frame explicitly instead of navigating to the outer demo.
    if (href?.startsWith('#')) {
      event.preventDefault();
      const target = href === '#' ? document.documentElement : document.getElementById(decodeURIComponent(href.slice(1)));
      target?.scrollIntoView();
      if (href === '#article') target?.focus({preventScroll:true});
    } else if (href?.startsWith('/')) {
      event.preventDefault();
      if (relationshipDialog.open) relationshipDialog.close();
      parent.postMessage({kind:'preview-link', href, label:link.textContent}, '*');
    }
  });
  document.addEventListener('submit', event => {
    event.preventDefault();
    if (event.target.matches('.header-search')) {
      document.getElementById('search-dialog').close();
      parent.postMessage({kind:'preview-search', query:new FormData(event.target).get('q')}, '*');
    } else if (event.target.matches('.context-form')) {
      event.target.reset();
      document.getElementById('settings-dialog').close();
      parent.postMessage({kind:'reference-context'}, '*');
    }
  });
  if (hash) requestAnimationFrame(() => document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView());
})();
