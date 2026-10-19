// Review controls live outside the preview viewport and never receive site styles.
(() => {
  const get = id => document.getElementById(id);
  const pages = JSON.parse(get('page-data').textContent);
  const assets = JSON.parse(get('current-assets').textContent);
  const frame = get('preview-frame'), picker = get('review-page');
  const preference = matchMedia('(prefers-color-scheme:dark)');
  const descriptions = {
    current:'Current site — the existing template, styles, and navigation. Proposal options are disabled to keep the reference unchanged.',
    classic:'Classic Encyclopedia — restrained serif headings, compact facts, and three columns. Contents float alongside long articles; short notes reclaim the space.',
    library:'Quiet Library — serif prose and subtle rules, with the same responsive navigation. Compare palettes independently of typography.',
    atlas:'Atlas Reference — wider maps and article space, with the same three-column navigation and small-screen behavior.'
  };
  let design = 'current', viewport = 'fit', revision = 0;
  pages.forEach((page, index) => picker.add(new Option(page.name, index)));
  const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
  const script = code => '<script>' + code + '<' + '/script>';
  function render(hash = '') {
    const page = pages[Number(picker.value)];
    const theme = get('appearance').value === 'system' ? (preference.matches ? 'dark' : 'light') : get('appearance').value;
    let source;
    if (design === 'current') {
      const bridge = `
        document.addEventListener('click',event=>{
          const link=event.target.closest('a');if(!link)return;
          const href=link.getAttribute('href');
          if(href&&href.startsWith('#')){event.preventDefault();document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView();}
          else if(href&&href.startsWith('/')){event.preventDefault();parent.postMessage({kind:'preview-link',href,label:link.textContent},'*');}
        });
        document.addEventListener('submit',event=>{event.preventDefault();parent.postMessage({kind:'reference-form'},'*');});
        document.querySelector('.context-form')?.addEventListener('change',event=>{event.currentTarget.reset();parent.postMessage({kind:'reference-context'},'*');});
        const targetHash=${json(hash)};
        if(targetHash)requestAnimationFrame(()=>document.getElementById(decodeURIComponent(targetHash.slice(1)))?.scrollIntoView());`;
      source = page.currentDocument.replace('</head>', () => '<style>' + assets.css + '</style></head>')
        .replace('</body>', () => script(assets.navigation) + script(bridge) + '</body>');
    } else {
      source = '<!doctype html><html lang="en" data-design="' + design + '" data-theme="' + theme + '" data-palette="' + get('palette').value + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TaelgarVerse</title><style>' + get('site-styles').textContent + '</style></head><body>' + get('proposal-template').innerHTML +
        '<script type="application/json" id="preview-data">' + json({page, hash, showNavigation:get('show-navigation').checked, showContents:get('show-contents').checked}) + '<' + '/script>' + script(get('preview-script').textContent) + '</body></html>';
    }
    // One always-visible frame, with a fresh document on every selection. Never
    // depend on reviving a hidden srcdoc frame when returning to the reference.
    frame.srcdoc = source.replace('<head>', '<head><!-- review revision ' + (++revision) + ' -->');
    frame.title = design === 'current' ? 'Current TaelgarVerse site reference' : `${design} proposal`;
    document.title = `${page.title} — TaelgarVerse design review`;
    get('proposal-options').disabled = design === 'current';
    get('design-description').textContent = descriptions[design];
  }
  function sizePreview() {
    const stage = get('preview-stage');
    const available = Math.max(1, stage.clientWidth - 2 * parseFloat(getComputedStyle(stage).paddingLeft));
    const width = {desktop:1440, tablet:900, mobile:390}[viewport] || Math.round(available);
    const scale = Math.min(1, available / width);
    const height = Math.max(600, window.innerHeight - stage.getBoundingClientRect().top - 24);
    frame.style.width = width + 'px';
    frame.style.height = height / scale + 'px';
    frame.style.transform = `scale(${scale})`;
    get('preview-size').style.width = width * scale + 'px';
    get('preview-size').style.height = height + 'px';
    get('viewport-status').textContent = `${width} px viewport${scale < .99 ? ` · ${Math.round(scale * 100)}% scale` : ''}`;
  }
  document.querySelectorAll('button[data-design]').forEach(button => button.addEventListener('click', () => {
    design = button.dataset.design;
    document.querySelectorAll('button[data-design]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    render(); sizePreview();
  }));
  document.querySelectorAll('button[data-viewport]').forEach(button => button.addEventListener('click', () => {
    viewport = button.dataset.viewport;
    document.querySelectorAll('button[data-viewport]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    sizePreview(); render();
  }));
  picker.addEventListener('change', () => render());
  get('proposal-options').addEventListener('change', () => render());
  preference.addEventListener('change', () => { if (design !== 'current' && get('appearance').value === 'system') render(); });
  new ResizeObserver(sizePreview).observe(get('preview-stage'));
  window.addEventListener('resize', sizePreview);
  function dialog(title, content) {
    get('dialog-title').textContent = title;
    get('dialog-content').replaceChildren(content);
    if (!get('offline-dialog').open) get('offline-dialog').showModal();
  }
  window.addEventListener('message', event => {
    if (event.source !== frame.contentWindow || !event.data) return;
    const data = event.data;
    if (data.kind === 'preview-link' && typeof data.href === 'string') {
      const url = new URL(data.href, 'https://offline.invalid');
      const index = pages.findIndex(page => url.pathname === '/page/' + page.slug);
      if (index >= 0) { picker.value = String(index); render(url.hash); return; }
    } else if (data.kind === 'preview-search' && typeof data.query === 'string') {
      const query = data.query.trim().toLowerCase(), list = document.createElement('ul');
      pages.forEach((page, index) => {
        if (!`${page.name} ${page.title}`.toLowerCase().includes(query)) return;
        const item = document.createElement('li'), button = document.createElement('button');
        button.textContent = page.title;
        button.addEventListener('click', () => { get('offline-dialog').close(); picker.value = String(index); render(); });
        item.append(button); list.append(item);
      });
      if (!list.children.length) list.textContent = 'No matching titles in the bundled pages.';
      dialog('Search this offline export', list); return;
    } else if (!['reference-context', 'reference-form'].includes(data.kind)) return;
    const paragraph = document.createElement('p');
    paragraph.textContent = data.kind === 'reference-context' ? 'Context dates and DM visibility require the live backend. This reference retains the selected page’s original context.' : data.kind === 'reference-form' ? 'This is an offline reference snapshot. Use the Page selector above to open one of the included pages.' : 'This destination is outside the pages bundled in the offline review. Use the Page selector above to explore the included pages.';
    dialog('Offline reference', paragraph);
  });
  sizePreview(); render();
})();
