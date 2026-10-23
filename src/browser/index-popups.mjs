import {mountMemberFilters} from './index-members.mjs';

// Hosts own loading and cleanup. Lazy bodies are populated only after activation.
export function mountIndexPopups(root,{load}={}) {
  const disposers=[mountMemberFilters(root)];
  for(const details of root.querySelectorAll?.('.taelgar-index-popup') || []) {
    const doc=details.ownerDocument,summary=details.querySelector('summary'),panel=details.querySelector('.taelgar-index-panel');
    const close=panel.querySelector('.taelgar-index-close'),content=panel.querySelector('.taelgar-index-content');
    // Obsidian moves this panel outside the mounted note into a modal dialog.
    disposers.push(mountMemberFilters(panel));
    const dialog=doc.createElement('dialog'),modal=typeof dialog.showModal==='function';
    let disposed=false,pending,loaded=!details.hasAttribute('data-index-lazy'),controller,startedOutside=false;
    const ensureLoaded=()=>{
      if(loaded || pending || !load)return;
      controller=new AbortController();
      content.textContent='Loading…';content.setAttribute('role','status');panel.setAttribute('aria-busy','true');
      pending=Promise.resolve().then(()=>disposed ? '' : load(details,{signal:controller.signal})).then(html=>{
        if(disposed)return;
        content.innerHTML=html;content.removeAttribute('role');loaded=true;
      }).catch(error=>{
        if(disposed || error?.name==='AbortError')return;
        content.textContent='Index unavailable. Close and reopen to retry.';
      }).finally(()=>{if(!disposed)panel.removeAttribute('aria-busy');pending=null;});
    };
    dialog.className='taelgar-index-dialog';dialog.setAttribute('aria-label',panel.querySelector('h2').textContent);
    const restore=()=>{
      if(panel.parentNode===dialog)details.append(panel);
      close.hidden=true;dialog.remove();details.open=false;
      if(!doc.querySelector('.taelgar-index-dialog[open]'))doc.documentElement.classList.remove('taelgar-index-open');
      if(summary.isConnected)summary.focus();
    };
    const open=event=>{
      if(modal) {
        event.preventDefault();if(dialog.open)return;
        dialog.append(panel);doc.body.append(dialog);close.hidden=false;dialog.showModal();close.focus();
        doc.documentElement.classList.add('taelgar-index-open');
      } else if(details.open)return;
      ensureLoaded();
    };
    const toggle=()=>{if(details.open)ensureLoaded();};
    const dismiss=()=>dialog.close();
    const outside=event=>{const box=dialog.getBoundingClientRect();return event.clientX<box.left || event.clientX>box.right || event.clientY<box.top || event.clientY>box.bottom;};
    const down=event=>{startedOutside=event.target===dialog && outside(event);};
    const backdrop=event=>{if(startedOutside && event.target===dialog && outside(event))dismiss();};
    summary.addEventListener('click',open);details.addEventListener('toggle',toggle);close.addEventListener('click',dismiss);
    dialog.addEventListener('close',restore);dialog.addEventListener('pointerdown',down);dialog.addEventListener('click',backdrop);
    disposers.push(()=>{
      disposed=true;controller?.abort();
      summary.removeEventListener('click',open);details.removeEventListener('toggle',toggle);close.removeEventListener('click',dismiss);
      dialog.removeEventListener('close',restore);dialog.removeEventListener('pointerdown',down);dialog.removeEventListener('click',backdrop);
      if(dialog.open)dialog.close();if(panel.parentNode===dialog)details.append(panel);
      close.hidden=true;dialog.remove();
      if(!doc.querySelector('.taelgar-index-dialog[open]'))doc.documentElement.classList.remove('taelgar-index-open');
    });
  }
  return ()=>{for(const dispose of disposers)dispose();};
}
