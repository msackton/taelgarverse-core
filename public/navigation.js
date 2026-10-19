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
