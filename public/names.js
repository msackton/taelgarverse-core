(() => {
  const root=document.querySelector('[data-name-explorer]');
  if (!root) return;
  let pending,timer;
  async function navigate(url,{replace=false,history=true,focusSearch=false,detail=false}={}) {
    pending?.abort();
    const controller=new AbortController();pending=controller;
    const input=root.querySelector('[name="find"]'),selection=input ? [input.selectionStart,input.selectionEnd] : null;
    root.setAttribute('aria-busy','true');
    try {
      const endpoint=new URL(url,location.href);endpoint.pathname='/api/names';endpoint.hash='';
      const response=await fetch(endpoint,{signal:controller.signal});
      if (!response.ok) throw new Error('Request failed');
      const result=await response.json();
      if (controller!==pending) return;
      const parsed=new DOMParser().parseFromString(result.html,'text/html').querySelector('[data-name-explorer]');
      if (!parsed) throw new Error('Missing explorer');
      root.replaceChildren(...parsed.childNodes);
      root.className=parsed.className;
      if (history) window.history[replace?'replaceState':'pushState']({},'',url);
      if (focusSearch) {
        const next=root.querySelector('[name="find"]');next.focus({preventScroll:true});
        if (selection?.every(Number.isInteger)) next.setSelectionRange(...selection);
      } else if (detail) {
        root.querySelector('.names-shelf a[aria-current]')?.focus({preventScroll:true});
        if (matchMedia('(max-width:900px)').matches) root.querySelector('#name-detail').scrollIntoView({block:'start'});
      }
      // Context changes retain the current explorer filters.
      const fields=document.querySelector('#context-controls');
      for (const name of ['view','language','kind','find','name']) {
        const field=fields?.querySelector('[data-name-context="'+name+'"]');
        if (field) field.value=new URL(url,location.href).searchParams.get(name) || '';
      }
    } catch(error) {
      if (error.name==='AbortError' || controller!==pending) return;
      const message=root.querySelector('.names-load-error');
      message.hidden=false;message.replaceChildren('Could not load names. ');
      const link=document.createElement('a');link.href=url;link.textContent='Open this page';message.append(link);
    } finally { if (controller===pending) {root.removeAttribute('aria-busy');pending=null;} }
  }
  function formUrl(form) {
    const url=new URL(form.action);url.search=new URLSearchParams(new FormData(form));return url.pathname+url.search;
  }
  root.addEventListener('click',event=>{
    const link=event.target.closest('a[href]');
    if (!link || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target || link.hasAttribute('download')) return;
    const url=new URL(link.href);
    if (url.origin!==location.origin || url.pathname!=='/names') return;
    event.preventDefault();clearTimeout(timer);
    void navigate(url.pathname+url.search+url.hash,{detail:link.hasAttribute('data-name-link')});
  });
  root.addEventListener('submit',event=>{
    if (!event.target.matches('.names-filters')) return;
    event.preventDefault();clearTimeout(timer);void navigate(formUrl(event.target),{focusSearch:true});
  });
  root.addEventListener('change',event=>{
    if (event.target.matches('select[name="kind"]')) {clearTimeout(timer);void navigate(formUrl(event.target.form));}
  });
  root.addEventListener('input',event=>{
    if (!event.target.matches('[name="find"]') || event.isComposing) return;
    // Discard an earlier response as soon as typing resumes, including the
    // debounce interval before the next request starts.
    pending?.abort();pending=null;root.removeAttribute('aria-busy');
    clearTimeout(timer);timer=setTimeout(()=>{void navigate(formUrl(event.target.form),{replace:true,focusSearch:true});},250);
  });
  root.addEventListener('compositionend',event=>{
    if (!event.target.matches('[name="find"]')) return;
    clearTimeout(timer);void navigate(formUrl(event.target.form),{replace:true,focusSearch:true});
  });
  window.addEventListener('popstate',()=>{clearTimeout(timer);void navigate(location.href,{history:false});});
})();
