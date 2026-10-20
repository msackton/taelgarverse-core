export function searchParameters(entries,query,offset=0) {
  const params = new URLSearchParams();
  for (const [name,value] of entries) {
    if (['context','date','campaigns','dm','pov','type'].includes(name) && typeof value === 'string') params.append(name,value);
  }
  params.set('q',query);
  params.set('limit','20');
  if (offset) params.set('offset',String(offset));
  return params;
}

// A closed panel or a newer query must invalidate responses even if the
// browser/provider finishes a request after cancellation.
export function createSearchController({search,onPending,onResults,onError,onIdle,delay=200,setTimer=setTimeout,clearTimer=clearTimeout}) {
  let version=0,timer,request;
  function cancel() {
    version++;
    clearTimer(timer);
    request?.abort();
  }
  function update(params,{immediate=false}={}) {
    cancel();
    const current=version,snapshot=new URLSearchParams(params);
    if (!snapshot.get('q')?.trim() && !snapshot.get('type')) { onIdle(); return; }
    onPending();
    const run=async()=>{
      const controller=new AbortController();
      request=controller;
      try {
        const data=await search(snapshot,controller.signal);
        if (current===version) onResults(data);
      } catch (error) {
        if (current===version && error.name!=='AbortError') onError(error);
      }
    };
    if (immediate) return run();
    timer=setTimer(run,delay);
  }
  return {update,cancel};
}

export function highlightPieces(excerpt='',highlights=[]) {
  const pieces=[];
  let position=0;
  for (const range of Array.isArray(highlights) ? highlights : []) {
    const {start,end}=range || {};
    if (!Number.isInteger(start) || !Number.isInteger(end) || start<position || end<=start || end>excerpt.length) continue;
    if (start>position) pieces.push({text:excerpt.slice(position,start),match:false});
    pieces.push({text:excerpt.slice(start,end),match:true});position=end;
  }
  if (position<excerpt.length) pieces.push({text:excerpt.slice(position),match:false});
  return pieces;
}

export function suggestionPosition(rect,view,desiredWidth=620) {
  const gutter=12,gap=6;
  if (rect.bottom<=view.top || rect.top>=view.top+view.height) return null;
  const width=Math.min(desiredWidth,Math.max(0,view.width-gutter*2));
  const left=Math.max(view.left+gutter,Math.min(rect.left,view.left+view.width-width-gutter));
  const below=view.top+view.height-rect.bottom-gap-gutter,above=rect.top-view.top-gap-gutter;
  const upwards=below<200 && above>below;
  return {left,width,above:upwards,edge:upwards ? rect.top-gap : rect.bottom+gap,
    maxHeight:Math.max(0,Math.min(480,upwards ? above : below))};
}

export function initializeSearch(doc) {
  const get=id=>doc.getElementById(id),panel=get('search-suggestions'),headerForm=get('header-search');
  const win=doc.defaultView;
  if (!panel || !headerForm || typeof win.fetch!=='function') return;
  const header=get('site-header'),toggle=get('search-toggle'),type=get('suggestions-type');
  const results=get('search-results'),status=get('search-status'),errorNotice=get('search-error'),fallback=get('search-fallback');
  const pagination=get('search-pagination'),previous=get('search-previous'),next=get('search-next');
  let context=[],sourceForm,sourceInput,offset=0,limit=20,frame=0,restoringFocus=false;
  const params=page=>searchParameters([...context,['type',type.value]],sourceInput?.value || '',page);
  const busy=value=>{results.setAttribute('aria-busy',String(value));previous.setAttribute('aria-disabled',String(value));next.setAttribute('aria-disabled',String(value));};
  const clear=(pending=false)=>{results.replaceChildren();if (!pending) pagination.hidden=true;errorNotice.hidden=true;fallback.hidden=true;};
  const controller=createSearchController({
    async search(query,signal) {
      const response=await win.fetch('/api/search?'+query,{signal,credentials:'same-origin',cache:'no-store'});
      const data=await response.json();
      if (!response.ok) {
        const error=new Error('Search request failed');
        if (response.status===400 && typeof data.detail==='string') error.displayMessage=data.detail;
        throw error;
      }
      return data;
    },
    onIdle(){clear();busy(false);status.textContent='Search names, phrases, and words from the notes.';},
    onPending(){clear(true);busy(true);status.textContent='Searching…';},
    onError(error){
      clear();busy(false);status.textContent='';
      errorNotice.textContent=error.displayMessage || 'Search could not load. Try again, or open the search page.';
      errorNotice.hidden=false;fallback.href='/?'+params(0);fallback.hidden=false;position();
    },
    onResults(data) {
      if (!Array.isArray(data.results) || !Number.isInteger(data.limit) || data.limit<1 || data.limit>50 ||
          !Number.isInteger(data.offset) || data.offset<0 || data.offset>1000 || data.results.length>data.limit) throw new Error('Invalid search response');
      const list=doc.createElement('ol');list.className='floating-search-list';list.start=data.offset+1;
      for (const item of data.results) {
        if (typeof item.url!=='string' || typeof item.title!=='string' || typeof item.page!=='string') throw new Error('Invalid search result');
        const url=new URL(item.url,win.location.href);
        if (url.origin!==win.location.origin || !url.pathname.startsWith('/page/')) throw new Error('Invalid search destination');
        const row=doc.createElement('li'),heading=doc.createElement('h3'),link=doc.createElement('a'),path=doc.createElement('p');
        link.href=url.href;link.textContent=item.title;heading.append(link);
        path.className='floating-search-path';path.textContent=item.page.replaceAll('/',' / ');
        row.append(heading,path);
        if (typeof item.excerpt==='string' && item.excerpt) {
          const excerpt=doc.createElement('p');excerpt.className='floating-search-excerpt';
          for (const piece of highlightPieces(item.excerpt,item.highlights)) {
            if (!piece.match) excerpt.append(doc.createTextNode(piece.text));
            else {const mark=doc.createElement('mark');mark.textContent=piece.text;excerpt.append(mark);}
          }
          row.append(excerpt);
        }
        list.append(row);
      }
      results.replaceChildren(list);results.scrollTop=0;busy(false);
      offset=data.offset;limit=data.limit;
      previous.hidden=offset===0;next.hidden=!data.hasMore || offset+limit>1000;
      pagination.hidden=previous.hidden && next.hidden;
      const summary=data.results.length ? (offset+1)+'–'+(offset+data.results.length)+' matching results.' : 'No matching pages. Try fewer words or another name.';
      status.textContent=summary+(data.notice ? ' '+data.notice : '');position();
    }
  });
  function mobileInput(visible) {
    header.classList.toggle('has-search-input',visible);
    toggle?.setAttribute('aria-expanded',String(visible));
    toggle?.setAttribute('aria-label',visible ? 'Close search' : 'Open search');
  }
  function close({restore=false,collapse=false}={}) {
    controller.cancel();panel.hidden=true;busy(false);sourceInput?.setAttribute('aria-expanded','false');
    if (collapse) mobileInput(false);
    if (restore) {
      restoringFocus=true;
      try {(collapse && toggle?.getClientRects().length ? toggle : sourceInput)?.focus({preventScroll:true});}
      finally {restoringFocus=false;}
    }
  }
  function position() {
    if (panel.hidden || !sourceInput) return;
    const viewport=win.visualViewport;
    const view={left:viewport?.offsetLeft || 0,top:viewport?.offsetTop || 0,
      width:Math.min(viewport?.width || win.innerWidth,doc.documentElement.clientWidth),height:viewport?.height || win.innerHeight};
    const bounds=suggestionPosition(sourceInput.getBoundingClientRect(),view);
    if (!sourceInput.getClientRects().length || !bounds || bounds.maxHeight<100) {close();return;}
    panel.style.left=bounds.left+'px';panel.style.width=bounds.width+'px';panel.style.maxHeight=bounds.maxHeight+'px';
    panel.style.top=bounds.above ? 'auto' : bounds.edge+'px';
    panel.style.bottom=bounds.above ? (win.innerHeight-bounds.edge)+'px' : 'auto';
  }
  function schedulePosition() {
    if (!panel.hidden && !frame) frame=win.requestAnimationFrame(()=>{frame=0;position();});
  }
  function attach(source) {
    if (sourceForm===source) return;
    close();sourceForm=source;sourceInput=source.querySelector('input[name="q"]');
    type.value=new FormData(source).get('type') || '';
    context=[...new FormData(source)].filter(([name,value])=>['context','date','campaigns','dm'].includes(name) && typeof value==='string');
  }
  function update(immediate=false,page=0) {
    if (!sourceInput) return;
    let field=sourceForm.querySelector('[name="type"]');
    if (!field && type.value) {
      field=doc.createElement('input');field.type='hidden';field.name='type';sourceForm.append(field);
    }
    if (field) field.value=type.value;
    if (!sourceInput.value.trim() && !type.value) {close();clear();return;}
    panel.hidden=false;sourceInput.setAttribute('aria-expanded','true');position();
    if (!panel.hidden) controller.update(params(page),{immediate});
  }
  function searchForm(element) {
    const candidate=element?.closest?.('form[role="search"]');
    if (!candidate) return null;
    const url=new URL(candidate.action,win.location.href);
    return url.origin===win.location.origin && url.pathname==='/' ? candidate : null;
  }
  const queryField=target=>target?.matches?.('input[type="search"][name="q"]');
  doc.querySelectorAll('form[role="search"] input[name="q"]').forEach(field=>{
    field.setAttribute('aria-haspopup','dialog');field.setAttribute('aria-controls','search-suggestions');field.setAttribute('aria-expanded','false');
  });
  if (toggle) {
    toggle.hidden=false;
    toggle.addEventListener('click',()=>{
      if (header.classList.contains('has-search-input')) {close({restore:true,collapse:true});return;}
      mobileInput(true);attach(headerForm);sourceInput.focus({preventScroll:true});update(true);
    });
  }
  doc.addEventListener('focusin',event=>{
    if (restoringFocus) return;
    const source=queryField(event.target) && searchForm(event.target);
    if (source) {attach(source);if (panel.hidden) update(true);}
    else if (!panel.contains(event.target) && !sourceForm?.contains(event.target)) close();
  });
  doc.addEventListener('click',event=>{
    const source=queryField(event.target) && searchForm(event.target);
    if (source && panel.hidden) {attach(source);update(true);}
  });
  doc.addEventListener('pointerdown',event=>{
    if (!panel.contains(event.target) && !sourceForm?.contains(event.target)) close();
  });
  doc.addEventListener('submit',event=>{
    const source=searchForm(event.target);
    if (source) {event.preventDefault();attach(source);update(true);}
  });
  for (const name of ['input','compositionend']) doc.addEventListener(name,event=>{
    const source=queryField(event.target) && searchForm(event.target);
    if (source && !event.isComposing) {attach(source);update();}
  });
  doc.addEventListener('change',event=>{
    const source=event.target.name==='type' && searchForm(event.target);
    if (source) {attach(source);type.value=event.target.value;update(true);}
  });
  type.addEventListener('change',()=>update(true));
  previous.addEventListener('click',()=>{if (results.getAttribute('aria-busy')!=='true') update(true,Math.max(0,offset-limit));});
  next.addEventListener('click',()=>{if (results.getAttribute('aria-busy')!=='true') update(true,offset+limit);});
  doc.addEventListener('keydown',event=>{
    if (event.key==='Escape' && (!panel.hidden || header.classList.contains('has-search-input') && header.contains(event.target))) {
      event.preventDefault();close({restore:true,collapse:win.matchMedia('(max-width:1100px)').matches && sourceForm===headerForm});return;
    }
    if (panel.hidden) return;
    if (event.key==='Tab' && event.target===sourceInput && !event.shiftKey) {event.preventDefault();type.focus();return;}
    if (event.key==='Tab' && event.target===type && event.shiftKey) {event.preventDefault();sourceInput.focus({preventScroll:true});return;}
    if (!['ArrowDown','ArrowUp'].includes(event.key)) return;
    const links=[...results.querySelectorAll('a[href]')],index=links.indexOf(doc.activeElement);
    if (!links.length || doc.activeElement!==sourceInput && index<0) return;
    if (doc.activeElement===sourceInput && event.key==='ArrowUp') return;
    event.preventDefault();
    const target=event.key==='ArrowDown' ? Math.min(index+1,links.length-1) : index-1;
    (target<0 ? sourceInput : links[target]).focus({preventScroll:target<0});
  });
  win.addEventListener('resize',schedulePosition);
  win.addEventListener('scroll',event=>{if (!panel.contains(event.target)) schedulePosition();},{capture:true,passive:true});
  win.visualViewport?.addEventListener('resize',schedulePosition);
  win.visualViewport?.addEventListener('scroll',schedulePosition);
}

if (typeof document!=='undefined') initializeSearch(document);
