import {createImageViewer} from './image-viewer.mjs';

const owners = new WeakMap(), hosts = new WeakMap();
const excluded = 'a,button,dialog,[popover],.twemoji,[role="button"],.leaflet-map,.leaflet-container,.metadata-container,.frontmatter-container';

export function mountImageControls(root,viewer,{include=()=>true,portal=false}={}) {
  const doc = root.ownerDocument, win = doc.defaultView, records = new Map();
  let disposed = false, frame;
  const position = () => {
    frame = undefined;
    if (disposed) return;
    for (const {image,control,host} of records.values()) {
      const rect = image.getBoundingClientRect(), parent = host.getBoundingClientRect();
      control.hidden = !image.getClientRects().length || rect.width<32 || rect.height<32;
      if (portal) {
        const viewport=root.getBoundingClientRect();
        control.hidden ||= rect.right<viewport.left || rect.left>viewport.right || rect.bottom<viewport.top || rect.top>viewport.bottom;
      }
      control.style.left = (rect.right-(portal?0:parent.left+host.clientLeft)-38)+'px';
      control.style.top = (rect.top-(portal?0:parent.top+host.clientTop)+6)+'px';
    }
  };
  const schedule = () => {if (!disposed && frame===undefined) frame=win.requestAnimationFrame(position);};
  const observer = new win.ResizeObserver(schedule);
  const remove = image => {
    const record = records.get(image);
    if (!record) return;
    viewer.closeFor(image);observer.unobserve(image);
    image.removeEventListener('click',record.click,true);image.removeEventListener('load',schedule);
    record.control.remove();
    if (!portal) {
      if (!record.hadClass) image.classList.remove('image-enlarge');
      const host = hosts.get(record.host);
      if (--host.count===0) {if (!host.hadClass) record.host.classList.remove('image-zoom-host');hosts.delete(record.host);}
    }
    records.delete(image);owners.delete(image);
    if (![...records.values()].some(item=>item.host===record.host)) observer.unobserve(record.host);
  };
  const refresh = () => {
    if (disposed) return;
    const images = new Set([...root.querySelectorAll('img[src]')].filter(image=>!image.closest(excluded) && include(image)));
    for (const image of records.keys()) if (!images.has(image)) remove(image);
    for (const image of images) {
      const previous = records.get(image);
      if (previous) {
        if (previous.src!==image.getAttribute('src')) viewer.closeFor(image);
        previous.src=image.getAttribute('src');continue;
      }
      if (owners.has(image)) continue;
      const control = doc.createElement('button'), host = portal ? doc.body : image.parentElement;
      control.type='button';control.className='image-zoom-control';control.title='Enlarge image';
      control.setAttribute('aria-label','Enlarge image'+(image.alt ? ': '+image.alt : ''));
      control.setAttribute('aria-haspopup','dialog');
      control.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      const click = event => {
        if (event.defaultPrevented || event.button!==0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        event.preventDefault();event.stopPropagation();viewer.open(image,control);
      };
      control.addEventListener('click',click);image.addEventListener('click',click,true);
      const hadClass = image.classList.contains('image-enlarge');
      if (portal) {
        // CodeMirror owns its widget DOM. Keep controls outside the editor.
        control.classList.add('image-zoom-control--portal');control.style.position='fixed';host.append(control);
      } else {
        image.classList.add('image-enlarge');
        if (!hosts.has(host)) hosts.set(host,{count:0,hadClass:host.classList.contains('image-zoom-host')});
        hosts.get(host).count++;host.classList.add('image-zoom-host');image.after(control);
      }
      const record={image,control,host,click,hadClass,src:image.getAttribute('src')};
      records.set(image,record);owners.set(image,record);
      observer.observe(image);if (!portal) observer.observe(host);image.addEventListener('load',schedule);
    }
    schedule();
  };
  const mutations = new win.MutationObserver(changes=>{
    if (changes.some(change=>change.type==='attributes' || [...change.addedNodes,...change.removedNodes].some(node=>
      node.nodeType===1 && (node.matches('img') || node.querySelector('img'))))) refresh();
  });
  mutations.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['src','srcset','alt']});
  root.addEventListener('toggle',schedule,true);win.addEventListener('resize',schedule);win.addEventListener('scroll',schedule,true);
  if (portal) observer.observe(root);
  refresh();
  return {refresh,dispose() {
    if (disposed) return;disposed=true;mutations.disconnect();observer.disconnect();
    if (frame!==undefined) win.cancelAnimationFrame(frame);
    root.removeEventListener('toggle',schedule,true);win.removeEventListener('resize',schedule);win.removeEventListener('scroll',schedule,true);
    for (const image of [...records.keys()]) remove(image);
  }};
}

export function mountImages(root,options) {
  if (!root) return ()=>{};
  const viewer = createImageViewer(root.ownerDocument), controls = mountImageControls(root,viewer,options);
  return ()=>{controls.dispose();viewer.dispose();};
}
