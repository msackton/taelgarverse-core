// Native details remain usable without dialog support. Each host owns cleanup
// so closing a note cannot leave a detached popup or its event handlers behind.
export function mountIndexPopups(root) {
  const disposers=[];
  for (const details of root.querySelectorAll?.('.taelgar-index-popup') || []) {
    const doc=details.ownerDocument,dialog=doc.createElement('dialog');
    if (typeof dialog.showModal !== 'function') continue;
    const summary=details.querySelector('summary'),panel=details.querySelector('.taelgar-index-panel');
    const close=panel.querySelector('.taelgar-index-close');
    dialog.className='taelgar-index-dialog';
    dialog.setAttribute('aria-label',panel.querySelector('h2').textContent);
    let startedOutside=false;
    const restore=()=>{
      if (panel.parentNode === dialog) details.append(panel);
      close.hidden=true;dialog.remove();details.open=false;
      if(!doc.querySelector('.taelgar-index-dialog[open]'))doc.documentElement.classList.remove('taelgar-index-open');
      if (summary.isConnected) summary.focus();
    };
    const open=event=>{
      event.preventDefault();
      if (dialog.open) return;
      dialog.append(panel);doc.body.append(dialog);close.hidden=false;
      dialog.showModal();close.focus();
      doc.documentElement.classList.add('taelgar-index-open');
    };
    const dismiss=()=>dialog.close();
    const outside=event=>{
      const box=dialog.getBoundingClientRect();
      return event.clientX<box.left || event.clientX>box.right || event.clientY<box.top || event.clientY>box.bottom;
    };
    const down=event=>{startedOutside=event.target===dialog && outside(event);};
    const backdrop=event=>{if(startedOutside && event.target===dialog && outside(event))dismiss();};
    summary.addEventListener('click',open);close.addEventListener('click',dismiss);
    dialog.addEventListener('close',restore);dialog.addEventListener('pointerdown',down);dialog.addEventListener('click',backdrop);
    disposers.push(()=>{
      summary.removeEventListener('click',open);close.removeEventListener('click',dismiss);
      dialog.removeEventListener('close',restore);dialog.removeEventListener('pointerdown',down);dialog.removeEventListener('click',backdrop);
      if(dialog.open)dialog.close();
      if(panel.parentNode===dialog)details.append(panel);
      close.hidden=true;dialog.remove();
      if(!doc.querySelector('.taelgar-index-dialog[open]'))doc.documentElement.classList.remove('taelgar-index-open');
    });
  }
  return ()=>{for(const dispose of disposers)dispose();};
}
