export function searchParameters(entries,query,offset=0) {
  const params = new URLSearchParams();
  for (const [name,value] of entries) {
    if (['context','date','campaigns','dm','type'].includes(name) && typeof value === 'string') params.append(name,value);
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

export function initializeSearch(doc) {
  const get=id=>doc.getElementById(id),dialog=get('search-dialog'),headerForm=get('header-search');
  if (!dialog || typeof dialog.showModal!=='function' || !headerForm || typeof fetch!=='function') return;
  const form=get('search-dialog-form'),input=get('search-dialog-query'),results=get('search-dialog-results');
  const type=get('search-dialog-type');
  const status=get('search-dialog-status'),errorNotice=get('search-dialog-error'),fallback=get('search-dialog-fallback');
  const pagination=get('search-dialog-pagination'),previous=get('search-dialog-previous'),next=get('search-dialog-next');
  const toggle=get('search-toggle'),root=doc.documentElement;
  let context=[],sourceForm,sourceInput,opener,readingPosition,offset=0,limit=20,startedOutside=false;
  const params=page=>searchParameters([...context,['type',type.value]],input.value,page);
  const busy=value=>{results.setAttribute('aria-busy',String(value));previous.disabled=value;next.disabled=value;};
  const clear=()=>{results.replaceChildren();pagination.hidden=true;errorNotice.hidden=true;fallback.hidden=true;};
  const controller=createSearchController({
    async search(query,signal) {
      const response=await fetch('/api/search?'+query,{signal,credentials:'same-origin',cache:'no-store'});
      const data=await response.json();
      if (!response.ok) {
        const error=new Error('Search request failed');
        if (response.status===400 && typeof data.detail==='string') error.displayMessage=data.detail;
        throw error;
      }
      return data;
    },
    onIdle(){clear();busy(false);status.textContent='Search names, phrases, and words from the notes.';},
    onPending(){clear();busy(true);status.textContent='Searching…';},
    onError(error){
      clear();busy(false);status.textContent='';
      errorNotice.textContent=error.displayMessage || 'Search could not load. Try again, or open the search page.';
      errorNotice.hidden=false;fallback.href='/?'+params(0);fallback.hidden=false;
    },
    onResults(data) {
      if (!Array.isArray(data.results) || !Number.isInteger(data.limit) || data.limit<1 || data.limit>50 ||
          !Number.isInteger(data.offset) || data.offset<0 || data.offset>1000 || data.results.length>data.limit) throw new Error('Invalid search response');
      const list=doc.createElement('ol');list.className='floating-search-list';list.start=data.offset+1;
      for (const item of data.results) {
        if (typeof item.url!=='string' || typeof item.title!=='string' || typeof item.page!=='string') throw new Error('Invalid search result');
        const url=new URL(item.url,location.href);
        if (url.origin!==location.origin || !url.pathname.startsWith('/page/')) throw new Error('Invalid search destination');
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
      status.textContent=summary+(data.notice ? ' '+data.notice : '');
    }
  });
  function update(immediate=false,page=0) {
    if (sourceInput) sourceInput.value=input.value;
    if (sourceForm) {
      let field=sourceForm.querySelector('[name="type"]');
      if (!field && type.value) {
        field=doc.createElement('input');field.type='hidden';field.name='type';sourceForm.append(field);
      }
      if (field) field.value=type.value;
    }
    controller.update(params(page),{immediate});
  }
  function searchForm(element) {
    const candidate=element?.closest?.('form[role="search"]');
    if (!candidate || candidate===form) return null;
    const url=new URL(candidate.action,location.href);
    return url.origin===location.origin && url.pathname==='/' ? candidate : null;
  }
  function open(source=headerForm,trigger=toggle,immediate=true) {
    sourceForm=source;
    sourceInput=source.querySelector('input[name="q"]');
    type.value=new FormData(source).get('type') || '';
    input.value=sourceInput?.value || '';
    context=[...new FormData(source)].filter(([name,value])=>['context','date','campaigns','dm'].includes(name) && typeof value==='string');
    form.querySelectorAll('input[type="hidden"]').forEach(field=>field.remove());
    for (const [name,value] of context) {
      const field=doc.createElement('input');field.type='hidden';field.name=name;field.value=value;form.append(field);
    }
    opener=trigger;
    const opening=!dialog.open;
    if (opening) {
      readingPosition={left:scrollX,top:scrollY,behavior:'instant'};
      dialog.showModal();
    }
    root.classList.add('site-dialog-open');
    toggle?.setAttribute('aria-expanded','true');sourceInput?.setAttribute('aria-expanded','true');
    input.focus({preventScroll:true});input.setSelectionRange(input.value.length,input.value.length);
    if (opening) scrollTo(readingPosition);
    update(immediate);
  }
  if (toggle) {toggle.hidden=false;toggle.setAttribute('aria-expanded','false');toggle.addEventListener('click',()=>open());}
  doc.querySelectorAll('form[role="search"] input[name="q"]').forEach(field=>{
    if (field===input) return;
    field.setAttribute('aria-haspopup','dialog');field.setAttribute('aria-controls','search-dialog');
  });
  doc.addEventListener('submit',event=>{
    const source=searchForm(event.target);
    if (source) {event.preventDefault();open(source,event.submitter || source.querySelector('input[name="q"]'));}
  });
  doc.addEventListener('click',event=>{
    const field=event.target.closest('input[type="search"][name="q"]'),source=searchForm(field);
    if (source) open(source,field);
  });
  doc.addEventListener('input',event=>{
    const source=searchForm(event.target);
    if (source && event.target.name==='q' && !event.isComposing) open(source,event.target,false);
  });
  form.addEventListener('submit',event=>{event.preventDefault();update(true);});
  input.addEventListener('input',event=>{if (!event.isComposing) update();});
  input.addEventListener('compositionend',()=>update());
  type.addEventListener('change',()=>update(true));
  previous.addEventListener('click',()=>update(true,Math.max(0,offset-limit)));
  next.addEventListener('click',()=>update(true,offset+limit));
  dialog.querySelector('[data-close-dialog="search-dialog"]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('cancel',()=>controller.cancel());
  dialog.addEventListener('close',()=>{
    controller.cancel();
    root.classList.toggle('site-dialog-open',Boolean(doc.querySelector('.site-dialog[open]')));
    toggle?.setAttribute('aria-expanded','false');sourceInput?.setAttribute('aria-expanded','false');
    const target=opener?.isConnected && opener.getClientRects().length ? opener : toggle;
    if (target?.getClientRects().length) target.focus({preventScroll:true});
    if (readingPosition) scrollTo(readingPosition);
  });
  const outside=event=>{
    const rect=dialog.getBoundingClientRect();
    return event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom;
  };
  dialog.addEventListener('pointerdown',event=>{startedOutside=outside(event);});
  dialog.addEventListener('click',event=>{if (event.target===dialog && startedOutside && outside(event)) dialog.close();});
  dialog.addEventListener('keydown',event=>{
    if (!['ArrowDown','ArrowUp'].includes(event.key)) return;
    const links=[...results.querySelectorAll('a[href]')],index=links.indexOf(doc.activeElement);
    if (!links.length || doc.activeElement!==input && index<0) return;
    if (doc.activeElement===input && event.key==='ArrowUp') return;
    event.preventDefault();
    const target=event.key==='ArrowDown' ? Math.min(index+1,links.length-1) : index-1;
    (target<0 ? input : links[target]).focus();
  });
}

if (typeof document!=='undefined') initializeSearch(document);
