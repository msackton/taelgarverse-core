// Large files are assigned to an image only after the reader asks for detail.
(() => {
  const viewer = document.createElement('dialog');
  const images = [...document.querySelectorAll('.article-main img[src]')].filter(image =>
    !image.closest('a,button,dialog,[popover],.twemoji,[role="button"],.leaflet-map,.leaflet-container'));
  if (typeof viewer.showModal !== 'function' || !images.length) return;
  const button = (label,action) => {
    const control = document.createElement('button');control.type = 'button';control.textContent = label;
    control.addEventListener('click',action);return control;
  };
  viewer.className = 'image-viewer';viewer.setAttribute('aria-label','Image viewer');
  const toolbar = document.createElement('div');toolbar.className = 'image-viewer-toolbar';
  const download = document.createElement('a');download.textContent = 'Download';download.download = '';
  const zoom = button('Pan / zoom',()=>setDetail(!detail));zoom.setAttribute('aria-pressed','false');
  const minus = button('−',()=>changeScale(scale/1.5));minus.setAttribute('aria-label','Zoom out');
  const plus = button('+',()=>changeScale(scale*1.5));plus.setAttribute('aria-label','Zoom in');
  const fit = button('Fit to screen',()=>setDetail(false));
  const close = button('Close',()=>viewer.close());close.autofocus = true;
  const zoomControls = document.createElement('span');zoomControls.className = 'image-viewer-zoom-controls';
  zoomControls.append(minus,plus,fit);zoomControls.hidden = true;
  toolbar.append(download,zoom,zoomControls,close);
  const stage = document.createElement('div');stage.className = 'image-viewer-stage';
  stage.tabIndex = 0;stage.setAttribute('role','region');stage.setAttribute('aria-label','Enlarged image');
  const preview = document.createElement('img');preview.className = 'image-viewer-preview';preview.draggable = false;
  stage.append(preview);
  const status = document.createElement('p');status.className = 'image-viewer-status';status.setAttribute('role','status');
  const caption = document.createElement('p');caption.className = 'image-viewer-caption';
  viewer.append(toolbar,stage,status,caption);document.body.append(viewer);
  let opener,source,full,detail = false,scale = 1,x = 0,y = 0,fitWidth = 1,fitHeight = 1,token = 0,fullReady = false;
  const pointers = new Map();let gesture;
  function dimensions() {
    return {width:Number(source?.dataset.imageWidth) || source?.naturalWidth || preview.naturalWidth || 1,
      height:Number(source?.dataset.imageHeight) || source?.naturalHeight || preview.naturalHeight || 1};
  }
  function layout() {
    if (!viewer.open) return;
    const {width,height} = dimensions(), factor = Math.min(stage.clientWidth/width,stage.clientHeight/height,1);
    fitWidth = width*factor;fitHeight = height*factor;
    preview.style.width = fitWidth+'px';preview.style.height = fitHeight+'px';
    const maxX = Math.max(0,(fitWidth*scale-stage.clientWidth)/2), maxY = Math.max(0,(fitHeight*scale-stage.clientHeight)/2);
    x = Math.max(-maxX,Math.min(maxX,x));y = Math.max(-maxY,Math.min(maxY,y));
    preview.style.transform = 'translate('+x+'px,'+y+'px) scale('+scale+')';
    minus.disabled = scale<=1;plus.disabled = scale>=maxScale();
  }
  function maxScale() { return Math.max(4,Math.min(32,dimensions().width/Math.max(1,fitWidth)*2)); }
  function changeScale(next,point) {
    if (!detail) return;
    const previous = scale;scale = Math.max(1,Math.min(maxScale(),next));
    const rect = stage.getBoundingClientRect(), px = point ? point.x-rect.left-rect.width/2 : 0, py = point ? point.y-rect.top-rect.height/2 : 0;
    x = px-(px-x)*scale/previous;y = py-(py-y)*scale/previous;layout();
  }
  async function loadImage(url,requestToken,message) {
    const candidate = new Image();candidate.decoding = 'async';candidate.src = url;
    try {
      await candidate.decode();
      if (!viewer.open || requestToken!==token) return false;
      preview.src = candidate.src;status.textContent = message;layout();return true;
    } catch {
      if (viewer.open && requestToken===token) status.textContent = 'The larger image could not load. You can retry or download it.';
      return false;
    }
  }
  async function setDetail(enabled) {
    detail = enabled;pointers.clear();gesture = undefined;
    zoom.setAttribute('aria-pressed',String(enabled));zoomControls.hidden = !enabled;
    stage.classList.toggle('image-viewer-stage--zoom',enabled);
    scale = 1;x = y = 0;layout();
    const requestToken = ++token;
    if (!enabled) { status.textContent = '';zoom.focus({preventScroll:true});await loadScreen(requestToken);return; }
    stage.focus({preventScroll:true});
    const instructions = 'Drag to pan. Use +/−, arrow keys, the mouse wheel, or pinch to zoom.';
    if (fullReady) { preview.src = full;status.textContent = instructions;changeScale(Math.min(2,maxScale()));return; }
    status.textContent = 'Loading full-resolution image…';
    if (await loadImage(full,requestToken,instructions)) { fullReady = true;changeScale(Math.min(2,maxScale())); }
  }
  async function loadScreen(requestToken) {
    let variants;
    try { variants = JSON.parse(source.dataset.imageVariants || '[]'); } catch { variants = []; }
    if (!variants.length) return;
    // Popup sizing follows the actual fitted width, including tall portraits.
    const needed = fitWidth*Math.min(devicePixelRatio || 1,2);
    const variant = variants.find(item=>item.width>=needed) || variants.at(-1);
    if (preview.getAttribute('src')===variant.url) return;
    status.textContent = 'Loading image…';await loadImage(variant.url,requestToken,'');
  }
  function open(image,control) {
    source = image;opener = control;full = image.dataset.imageFull || image.currentSrc || image.src;
    fullReady = false;detail = false;scale = 1;x = y = 0;pointers.clear();
    zoom.setAttribute('aria-pressed','false');zoomControls.hidden = true;stage.classList.remove('image-viewer-stage--zoom');
    preview.src = image.currentSrc || image.src;preview.alt = image.alt;download.href = full;
    download.setAttribute('aria-label','Download full-resolution image'+(image.alt ? ': '+image.alt : ''));
    caption.textContent = image.alt;caption.hidden = !image.alt;status.textContent = '';
    viewer.showModal();document.documentElement.classList.add('image-viewer-open');layout();
    loadScreen(++token);
  }
  viewer.addEventListener('close',()=>{
    ++token;pointers.clear();source = undefined;preview.removeAttribute('src');
    document.documentElement.classList.remove('image-viewer-open');opener?.focus({preventScroll:true});
  });
  preview.addEventListener('load',layout);
  viewer.addEventListener('keydown',event=>{
    const controls = [...viewer.querySelectorAll('a[href],button:not([disabled]),[tabindex="0"]')].filter(item=>item.getClientRects().length);
    if (event.key==='Tab') {
      if (!event.shiftKey && document.activeElement===controls.at(-1)) {event.preventDefault();controls[0].focus();}
      else if (event.shiftKey && document.activeElement===controls[0]) {event.preventDefault();controls.at(-1).focus();}
    }
    if (!detail || event.target!==stage) return;
    if (['+','=','-','0','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) event.preventDefault();
    if (event.key==='+' || event.key==='=') changeScale(scale*1.5);
    if (event.key==='-') changeScale(scale/1.5);
    if (event.key==='0') setDetail(false);
    if (event.key==='ArrowLeft') x+=50;if (event.key==='ArrowRight') x-=50;
    if (event.key==='ArrowUp') y+=50;if (event.key==='ArrowDown') y-=50;layout();
  });
  // A click on the empty stage closes the fitted popup. Drag/pinch never closes it.
  let backdropStart = false;
  viewer.addEventListener('pointerdown',event=>{backdropStart = !detail && (event.target===stage || event.target===viewer);});
  viewer.addEventListener('click',event=>{if (backdropStart && !detail && (event.target===stage || event.target===viewer)) viewer.close();});
  stage.addEventListener('wheel',event=>{
    if (!detail) return;event.preventDefault();changeScale(scale*Math.exp(-event.deltaY*0.002),{x:event.clientX,y:event.clientY});
  },{passive:false});
  const state = ()=>{
    const points = [...pointers.values()], center = {x:points.reduce((n,p)=>n+p.x,0)/points.length,y:points.reduce((n,p)=>n+p.y,0)/points.length};
    return {center,distance:points.length>1 ? Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y) : 0};
  };
  stage.addEventListener('pointerdown',event=>{
    if (!detail || event.button!==0) return;event.preventDefault();stage.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});gesture = state();
  });
  stage.addEventListener('pointermove',event=>{
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});const next = state();
    x+=next.center.x-gesture.center.x;y+=next.center.y-gesture.center.y;
    if (gesture.distance && next.distance) changeScale(scale*next.distance/gesture.distance,next.center);
    else layout();gesture = next;
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) stage.addEventListener(type,event=>{
    pointers.delete(event.pointerId);gesture = pointers.size ? state() : undefined;
  });
  new ResizeObserver(()=>{
    layout();if (viewer.open && !detail) loadScreen(++token);
  }).observe(stage);
  const controls = [];
  let positionPending = false;
  const positionControls = ()=>{
    positionPending = false;
    for (const {image,control,host} of controls) {
      const rect = image.getBoundingClientRect(), parent = host.getBoundingClientRect();
      control.hidden = !image.getClientRects().length || rect.width<32 || rect.height<32;
      control.style.left = (rect.right-parent.left-host.clientLeft-38)+'px';
      control.style.top = (rect.top-parent.top-host.clientTop+6)+'px';
    }
  };
  const schedulePositions = ()=>{if (!positionPending) {positionPending = true;requestAnimationFrame(positionControls);}};
  const observer = new ResizeObserver(schedulePositions);
  for (const image of images) {
    const control = button('',()=>open(image,control));control.className = 'image-zoom-control';
    control.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    control.title = 'Enlarge image';control.setAttribute('aria-label','Enlarge image'+(image.alt ? ': '+image.alt : ''));control.setAttribute('aria-haspopup','dialog');
    const host = image.parentElement;host.classList.add('image-zoom-host');image.after(control);
    image.classList.add('image-enlarge');image.addEventListener('click',()=>open(image,control));
    controls.push({image,control,host});observer.observe(image);observer.observe(host);
    image.addEventListener('load',schedulePositions);
  }
  document.addEventListener('toggle',schedulePositions,true);addEventListener('resize',schedulePositions);
  positionControls();
})();
