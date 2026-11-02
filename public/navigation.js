// Native details and section links remain usable without JavaScript.
async function loadBranch(details) {
  const children = details.querySelector(':scope > [data-nav-children]');
  if (!details.open || children.dataset.loaded === 'true' || children.getAttribute('aria-busy') === 'true') return;
  children.setAttribute('aria-busy','true');
  try {
    const response = await fetch(details.dataset.navUrl);
    if (!response.ok) throw new Error('Navigation unavailable');
    const result = await response.json();
    children.innerHTML = result.html;
    children.dataset.loaded = 'true';
  } catch {
    // Keep the server-rendered Browse section link as a fallback.
    if (!children.querySelector('button')) {
      const item = document.createElement('li'), retry = document.createElement('button');
      retry.type = 'button'; retry.textContent = 'Retry loading';
      retry.addEventListener('click',()=>loadBranch(details));
      item.append(retry); children.append(item);
    }
  } finally { children.removeAttribute('aria-busy'); }
}
document.addEventListener('toggle',event=>{
  if (event.target.matches('details[data-nav-url]')) loadBranch(event.target);
},true);

// Keep the current page and its nearest ancestors; older ancestors remain
// available in a native, keyboard-accessible disclosure.
for (const nav of document.querySelectorAll('.breadcrumbs')) {
  const list = nav.querySelector('ol'), items = [...list.children];
  if (items.length < 2) continue;
  const overflow = document.createElement('li'), details = document.createElement('details');
  const summary = document.createElement('summary'), menu = document.createElement('ul');
  overflow.className = 'breadcrumb-overflow'; overflow.hidden = true;
  summary.textContent = '…'; summary.setAttribute('aria-label','Show collapsed ancestors');
  details.append(summary,menu); overflow.append(details); items[0].after(overflow);
  for (const item of items) {
    const label = item.firstElementChild;
    label.title = label.textContent;
  }
  const fit = () => {
    const available = list.clientWidth;
    if (!available) return;
    list.classList.add('is-measuring');
    for (const item of items) item.hidden = false;
    overflow.hidden = true;
    const widths = items.map(item=>item.getBoundingClientRect().width);
    let total = widths.reduce((sum,width)=>sum+width,0);
    const collapsed = [];
    if (total > available && items.length > 2) {
      overflow.hidden = false;
      total += overflow.getBoundingClientRect().width;
      for (let index=1; index<items.length-1 && total>available; index++) {
        items[index].hidden = true;
        total -= widths[index];
        collapsed.push(items[index].cloneNode(true));
      }
    }
    for (const item of collapsed) item.hidden = false;
    menu.replaceChildren(...collapsed);
    if (!collapsed.length) details.open = false;
    list.classList.remove('is-measuring');
  };
  details.addEventListener('keydown',event=>{
    if (event.key === 'Escape') {
      details.open = false; summary.focus(); event.preventDefault();
    }
  });
  document.addEventListener('click',event=>{
    if (!details.contains(event.target)) details.open = false;
  });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(nav);
  else window.addEventListener('resize',fit);
  document.fonts?.ready.then(fit);
  fit();
}
