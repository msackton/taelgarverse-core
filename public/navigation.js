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

if (matchMedia('(max-width: 800px)').matches) {
  document.querySelector('.site-navigation')?.removeAttribute('open');
}
if (matchMedia('(max-width: 1100px)').matches) {
  document.querySelectorAll('.page-toc > details').forEach(section=>section.removeAttribute('open'));
}
const sidebar = document.querySelector('.site-sidebar');
const current = sidebar?.querySelector('[aria-current="page"]');
if (current && matchMedia('(min-width: 801px)').matches) {
  const offset = current.getBoundingClientRect().top - sidebar.getBoundingClientRect().top;
  if (offset > sidebar.clientHeight - 40) sidebar.scrollTop += offset - sidebar.clientHeight / 2;
}
const links = [...document.querySelectorAll('.page-toc a[href^="#"]')];
const sections = links.map(link=>document.getElementById(decodeURIComponent(link.hash.slice(1))));
let pending = false;
function trackSection() {
  pending = false;
  let active = 0;
  sections.forEach((section,index)=>{ if (section && section.getBoundingClientRect().top <= 120) active = index; });
  links.forEach((link,index)=>{
    link.classList.toggle('is-active',index===active);
    if (index===active) link.setAttribute('aria-current','location');
    else link.removeAttribute('aria-current');
  });
}
if (links.length) {
  trackSection();
  addEventListener('scroll',()=>{ if (!pending) { pending = true; requestAnimationFrame(trackSection); } },{passive:true});
}
