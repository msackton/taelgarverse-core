// Confidence never substitutes for human review.
export function entityQueueEntries(snapshot){
  return snapshot.document.entities.map(row=>({key:row.id,row,decision:row.review.status==='humanReviewed'?'reviewed':'pending'}));
}
export function mountEntityReview(root,{request,open,session,mode='review',initialEntity,onSelect=()=>{},onBack,onSwitch}){
  const document=root.ownerDocument;
  let snapshot,disposed=false,busy=false,selected=initialEntity?.replace(/^entity:/,''),filter='pending',notes=[],serial=0,popup;
  root.classList.add(mode==='map'?'entity-review-map':'entity-review-queue');
  const el=(tag,text,parent=root)=>{const node=document.createElement(tag);if(text!=null)node.textContent=String(text);parent.append(node);return node;};
  const navigation=el('div',null);navigation.className='entity-review-topbar';
  const status=el('span','Loading entities…',navigation);status.setAttribute('role','status');const body=el('div',null);
  const call=fields=>request({sessionYaml:session,...fields});
  async function work(run){
    if(disposed||busy)return;busy=true;root.setAttribute('aria-busy','true');status.textContent='Working…';
    try{const message=await run();if(!disposed)status.textContent=message??'Ready.';}
    catch(error){if(!disposed)status.textContent=error.message;}
    finally{busy=false;root.removeAttribute('aria-busy');}
  }
  const button=(parent,label,run)=>{const node=el('button',label,parent);node.type='button';node.addEventListener('click',()=>void work(run));return node;};
  if(onBack)navigation.insertBefore(button(navigation,'Back to sessions',onBack),status);
  if(onSwitch)navigation.insertBefore(button(navigation,mode==='map'?'Entity-by-entity review':'Show entities map',onSwitch),status);
  navigation.insertBefore(button(navigation,mode==='map'?'Reload list':'Reload entities',load),status);
  function field(parent,label,value='',tag='input'){
    const wrapper=el('label',label,parent),node=el(tag,null,wrapper);node.value=value??'';return node;
  }
  function select(parent,label,choices,value){const node=field(parent,label,'','select');for(const [key,text] of choices){el('option',text,node).value=key;}node.value=value;return node;}
  function help(parent,text){const node=el('small',text,parent);node.className='entity-review-help';return node;}
  function confidenceInfo(parent,row,explain=false){
    const line=el('div',null,parent);line.className='entity-review-confidence-line';
    const badge=el('span','Confidence: '+({high:'High',medium:'Medium',low:'Low'}[row.review.confidence]??'Not assessed'),line);
    badge.className='entity-review-confidence';
    badge.title='The agent’s confidence in the full entity decision: inclusion, identity match, type, and role in this session. This is separate from human review status.';
    if(explain&&(row.confidenceExplanation||['medium','low'].includes(row.review.confidence))){
      const explanation=el('span',row.confidenceExplanation??'No confidence explanation was recorded for this decision.',line);
      explanation.className='entity-confidence-explanation';explanation.setAttribute('aria-label','Agent confidence explanation');
    }
  }
  function excludeButton(parent,row,label,changes,initialReason=()=> '',placement){
    let form;
    return button(parent,label,()=>{
      if(form)return;
      const host=placement?.();
      form=el('div',null,host?.parent??parent);form.className='entity-exclusion-form';
      const reason=field(form,'Exclusion reason ',initialReason(),'textarea');reason.rows=2;
      help(form,'Briefly explain why this entity should be excluded (up to 40 words).');
      button(form,'Confirm exclude',()=>{
        if(!reason.value.trim())throw new Error('Enter an exclusion reason.');
        return save(row,{action:'exclude',reason:reason.value.trim(),...(changes?{changes:changes()}: {})});
      });
      button(form,'Cancel',()=>{form.remove();form=null;host?.close();});
    });
  }
  const noteName=path=>path.split('/').at(-1).replace(/\.md$/i,'');
  function link(parent,label,path,line){
    const a=el('a',label,parent);a.href='#';a.addEventListener('click',event=>{event.preventDefault();if(popup?.dialog.contains(a))closePopup(false);void work(()=>open(path,line));});return a;
  }
  const entries=()=>entityQueueEntries(snapshot).filter(entry=>mode==='map'||filter==='all'||entry.decision==='pending');
  async function load(){
    const result=await call({command:'inspect'});if(disposed)return;
    if(result.confirmationRequired){sourceConfirmation(result);return 'Confirmation required before continuing.';}
    snapshot=result;render();return snapshot.session.metadataWarning??'Ready.';
  }
  function sourceConfirmation(result){
    closePopup(false);body.replaceChildren();
    el('h2','Transcript or session inputs changed',body);
    el('p',`${result.session.campaign} ${result.session.number??''}`.trim(),body);
    el('p','The entity map was checked against an earlier version. Confirm that you want to continue with the current transcript. Existing entity decisions will be kept; confirmation does not recheck them.',body);
    const changes=el('details',null,body);el('summary','Changed source fingerprints',changes);
    for(const change of result.sourceChanges){
      el('h4',change.name,changes);
      el('p','Previous SHA: '+(change.previousSha256??'Not recorded'),changes);
      el('p','Current SHA: '+(change.currentSha256??'No longer registered'),changes);
    }
    button(body,'Continue with current transcript',async()=>{
      const confirmed=await call({command:'confirmSourceChanges',token:result.token});if(disposed)return;
      snapshot=confirmed;render();return 'Source changes confirmed. Existing entity decisions kept.';
    }).classList.add('mod-cta');
  }
  async function save(row,fields){
    const previous=entries(),index=previous.findIndex(item=>item.key===row.id);
    let token=snapshot.token;
    if(fields.changes?.note&&fields.changes.note!==row.note){
      const inspected=await call({command:'inspect',notes:[fields.changes.note]});
      if(disposed)return;
      if(inspected.token.mapSha256!==token.mapSha256||inspected.token.reviewSha256!==token.reviewSha256)throw new Error('Review changed; reload before saving.');
      token=inspected.token;
    }
    const result=await call({command:'entityUpdate',token,entity:row.id,...fields});if(disposed)return;
    snapshot=result;
    const remaining=new Set(entries().map(item=>item.key));
    selected=Array.from({length:previous.length},(_,offset)=>previous[(Math.max(0,index)+offset+1)%previous.length]?.key)
      .find(key=>remaining.has(key))??entries()[0]?.key;
    render();return 'Changes saved.';
  }
  function editor(parent,row){
    const form=el('div',null,parent);form.className='entity-review-fields';
    const label=field(form,'Name in this session ',row.label);
    help(label.parentElement,'The name or description shown in this entity map. Changing it does not rename a vault note.');
    const kind=select(form,'Entity type ',[['npc','Person / NPC'],['divine','Divine being'],['item','Item'],['organization','Organization']],row.kind);
    const importance=select(form,'Role in this session ',[['','Not assessed'],['star','Star'],['supporting','Supporting'],['cameo','Cameo']],row.importance??'');
    const note=field(form,'Linked vault note ',row.note??'');note.parentElement.className='entity-review-wide';note.placeholder='Search notes, or leave blank';
    help(note.parentElement,'Choose the existing note for this entity. Leave blank if it has no matching note.');
    const suggestions=el('datalist',null,parent);suggestions.id=`entity-review-notes-${++serial}`;note.setAttribute('list',suggestions.id);
    function populate(){suggestions.replaceChildren();for(const path of notes.filter(path=>path.toLowerCase().includes(note.value.toLowerCase())).slice(0,80))el('option',null,suggestions).value=path;}
    populate();note.addEventListener('input',populate);note.addEventListener('focus',()=>{if(notes.length)return;void request({command:'entityNoteChoices'}).then(result=>{if(!disposed){notes=result.paths;populate();}}).catch(error=>{if(!disposed)status.textContent=error.message;});});
    if(row.candidates?.length){const candidates=el('p','Possible matches: ',parent);for(const candidate of row.candidates)link(candidates,noteName(candidate),candidate).title=candidate;}
    const explanation=el('details',null,parent);el('summary','Explain this change (optional)',explanation);
    const reason=field(explanation,'Change note ','','textarea');
    reason.placeholder='For example: This is the same person as the guide in the previous session.';
    help(explanation,'Saved with your edit or exclusion so the agent can understand your correction.');
    const changes=()=>({label:label.value.trim(),kind:kind.value,...(importance.value?{importance:importance.value}:{}),status:'humanReviewed',...((note.value.trim()||null)!==(row.note||null)?{note:note.value.trim()||null}:{})});
    if(!row.note){
      const noteActions=el('div',null,form);noteActions.className='entity-review-wide';
      const create=el('button','Create staging note',noteActions);create.type='button';create.setAttribute('aria-haspopup','dialog');create.setAttribute('aria-expanded','false');
      create.addEventListener('click',()=>{
        if(disposed||busy)return;
        if(note.value.trim()){status.textContent='Clear the linked-note field before creating a staging note.';return;}
        const values=changes();
        stagingDialog(create,row,{label:values.label,kind:values.kind,...(values.importance?{importance:values.importance}:{})},reason.value);
      });
    }
    const actions=el('div',null,parent);actions.className='entity-review-actions';
    button(actions,mode==='map'?'Save changes':'Save and next',()=>save(row,{changes:changes(),reason:reason.value})).classList.add('mod-cta');
    if(row.review.status==='humanReviewed')button(actions,'Reopen review',()=>save(row,{changes:{...changes(),status:'unreviewed'},reason:reason.value}));
    excludeButton(actions,row,'Exclude and next',()=>({...changes(),status:row.review.status}),()=>reason.value);
    help(parent,'Saving applies your edits and marks this entity reviewed.');
    if(row.review.status==='humanReviewed')help(parent,'Reopen review saves your edits and marks this entity as needing another review.');
    const comments=el('details',null,parent);comments.className='entity-review-feedback';el('summary','Feedback on this entity',comments);
    help(comments,'Save a question or request about '+row.label+'. Leave it unreviewed while it needs an answer; in the review queue, choose Skip for now to continue. For an already reviewed entity, choose Reopen review before asking the agent to revise it.');
    for(const item of snapshot.review.feedback.filter(item=>item.entity===row.id))el('p',`${item.status==='resolved'?'Resolved':'Waiting for agent'}: ${item.comment}${item.resolution?' · '+item.resolution:''}`,comments);
    const comment=field(comments,'Message for the agent ','','textarea');
    button(comments,'Save entity feedback',async()=>{snapshot=await call({command:'entityFeedback',entity:row.id,token:snapshot.token,comment:comment.value});if(!disposed)render();return 'Question saved. Leave unresolved entities unreviewed; the main entities map has the agent follow-up instructions.';});
  }
  function evidence(parent,row){
    for(const item of snapshot.evidence?.[row.id]??[])link(parent,`${item.source.startUid}–${item.source.endUid}`,item.path,item.line);
    const details=el('details',null,parent);el('summary','Read source passages',details);const passages=el('div',null,details);let loaded=false;
    details.addEventListener('toggle',()=>{
      if(!details.open||loaded||busy)return;
      void work(async()=>{
        const result=await call({command:'evidence',entity:row.id,mapSha256:snapshot.token.mapSha256});if(disposed)return;
        for(const passage of result.passages){el('pre',passage.text,passages);link(passages,'Open source passage',passage.path,passage.line);}loaded=true;
      });
    });
  }
  async function passages(parent,fields,current){
    const result=await call({command:'evidence',...fields,mapSha256:snapshot.token.mapSha256});
    if(disposed||!current())return;
    el('h4','Source passages',parent);
    for(const passage of result.passages){el('pre',passage.text,parent);link(parent,'Open source passage',passage.path,passage.line);}
  }
  function inlineChoice(parent,row,label,choices,value,fieldName){
    const choice=el('select',null,parent);for(const [key,text] of choices)el('option',text,choice).value=key;
    choice.value=value;choice.setAttribute('aria-label',`${label} for ${row.label}`);
    choice.addEventListener('change',()=>{
      if(busy){choice.value=value;return;}
      void work(async()=>{
        try{return await save(row,{changes:{[fieldName]:choice.value}});}
        catch(error){choice.value=value;throw error;}
      });
    });
  }
  function closePopup(restoreFocus=true){
    if(!popup)return;
    const previous=popup;popup=null;
    if(previous.dialog.open)previous.dialog.close();
    previous.dialog.remove();previous.trigger.setAttribute('aria-expanded','false');
    if(restoreFocus&&!disposed&&previous.trigger.isConnected)previous.trigger.focus?.({preventScroll:true});
  }
  function stagingDialog(trigger,row,changes,reason){
    closePopup(false);
    const dialog=el('dialog',null);dialog.className='entity-review-dialog';dialog.setAttribute('aria-label','Create staging note');dialog.setAttribute('aria-modal','true');
    const state={dialog,trigger};popup=state;
    const header=el('div',null,dialog);header.className='entity-review-dialog-header';el('h3','Create staging note',header);
    const close=el('button','Cancel',header);close.type='button';close.addEventListener('click',()=>closePopup());
    dialog.addEventListener('cancel',event=>{event.preventDefault();if(popup===state)closePopup();});
    dialog.addEventListener('close',()=>{if(popup===state)closePopup();});
    const content=el('div',null,dialog);content.className='entity-review-dialog-content';
    help(content,'Choose a name for an empty staging note. The note will be linked to this entity; it will still need your review.');
    const unclear=/^(?:a|an|the|unnamed|unknown|unidentified|some|several)\b/i.test(changes.label);
    const name=field(content,'Note name ',unclear?'':changes.label);name.autofocus=true;
    if(unclear)help(content,'This entity has a descriptive label. Enter the name you want to use for its staging note.');
    const destination=el('p','',content);destination.className='entity-staging-destination';
    const folder=snapshot.session.stagingFolder;
    const update=()=>{destination.textContent=folder?folder+'/'+(name.value.trim().replace(/\.md$/i,'')||'<note name>')+'.md':snapshot.session.stagingUnavailable??'Reload entities to load the staging folder.';};
    name.addEventListener('input',update);update();
    const message=el('p','',content);message.setAttribute('role','status');
    const confirm=button(content,'Create empty note',async()=>{
      try{
        if(!folder)throw new Error(destination.textContent);
        if(!name.value.trim())throw new Error('Enter a name for the staging note.');
        message.textContent='Creating and linking note…';confirm.disabled=true;
        const result=await call({command:'createStagingNote',entity:row.id,token:snapshot.token,name:name.value.trim(),changes,reason});
        if(!disposed){
          snapshot=result;selected=row.id;
          if(popup===state)closePopup(false);
          render();
          const note=result.document.entities.find(item=>item.id===row.id)?.note;
          [...body.querySelectorAll('.entity-review-vault-note a')].find(link=>link.title===note)?.focus({preventScroll:true});
        }
        return 'Empty staging note created and linked. Review the entity before choosing '+(mode==='map'?'Accept.':'Save and next.');
      }catch(error){if(popup===state){message.textContent=error.message;confirm.disabled=false;}throw error;}
    });
    confirm.classList.add('mod-cta');dialog.showModal();trigger.setAttribute('aria-expanded','true');
  }
  function detailsButton(cell,row,exclusionIndex){
    const trigger=el('button','Details',cell);trigger.type='button';
    trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-label',`Details for ${row.label}`);
    trigger.addEventListener('click',()=>{
      if(disposed||busy)return;
      closePopup(false);
      const dialog=el('dialog',null);dialog.className='entity-review-dialog';
      dialog.setAttribute('aria-label',`${row.label} — Details`);dialog.setAttribute('aria-modal','true');
      const state={dialog,trigger};popup=state;
      const current=()=>!disposed&&popup===state&&dialog.open;
      const header=el('div',null,dialog);header.className='entity-review-dialog-header';el('h3',row.label+' — Details',header);
      const close=el('button','Close',header);close.type='button';close.autofocus=true;close.setAttribute('aria-label','Close details');
      close.addEventListener('click',()=>closePopup());
      dialog.addEventListener('cancel',event=>{event.preventDefault();if(popup===state)closePopup();});
      dialog.addEventListener('close',()=>{if(popup===state)closePopup();});
      const outside=event=>{const box=dialog.getBoundingClientRect();return event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom;};
      let startedOutside=false;
      dialog.addEventListener('pointerdown',event=>{startedOutside=event.target===dialog&&outside(event);});
      dialog.addEventListener('click',event=>{if(event.target===dialog&&startedOutside&&outside(event)&&popup===state)closePopup();});
      const content=el('div',null,dialog);content.className='entity-review-dialog-content';
      if(exclusionIndex==null){
        confidenceInfo(content,row,true);
        if(!row.note){
          const create=el('button','Create staging note',content);create.type='button';create.setAttribute('aria-haspopup','dialog');
          create.addEventListener('click',()=>{
            if(disposed||busy)return;
            stagingDialog(trigger,row,{label:row.label,kind:row.kind,...(row.importance?{importance:row.importance}:{})},'');
          });
        }
      }
      const loading=el('p','Loading source passages…',content);loading.setAttribute('role','status');
      const sources=el('div',null,content);
      const retry=button(content,'Retry loading passages',loadPassages);retry.hidden=true;
      async function loadPassages(){
        if(!current())return;
        retry.hidden=true;loading.hidden=false;loading.textContent='Loading source passages…';sources.replaceChildren();
        try{await passages(sources,exclusionIndex==null?{entity:row.id}:{exclusionIndex},current);if(current())loading.hidden=true;}
        catch(error){if(current()){loading.textContent=error.message;retry.hidden=false;}}
      }
      if(exclusionIndex==null){
        el('h4','Active agent feedback',content);
        const active=snapshot.review.feedback.filter(item=>item.entity===row.id&&item.status==='open');
        for(const item of active)el('p',item.comment,content);
        if(!active.length)help(content,'No active feedback for this entity.');
        const comment=field(content,'Message for the agent ','','textarea');
        const feedbackStatus=el('p','',content);feedbackStatus.setAttribute('role','status');
        button(content,'Save entity feedback',async()=>{
          try{const result=await call({command:'entityFeedback',entity:row.id,token:snapshot.token,comment:comment.value});if(!disposed){snapshot=result;render();}return 'Feedback saved. Use Follow up with the agent below.';}
          catch(error){if(current())feedbackStatus.textContent=error.message;throw error;}
        });
      }
      dialog.showModal();trigger.setAttribute('aria-expanded','true');void loadPassages();
    });
  }
  function renderMap(parent,queue){
    const includedScroll=el('div',null,parent);includedScroll.className='entity-map-table-scroll';
    const table=el('table',null,includedScroll);table.className='entity-map-table';
    const head=el('tr',null,el('thead',null,table));
    for(const name of ['Entity','Type','Status','Role','Details','Accept','Exclude'])el('th',name,head);
    const rows=el('tbody',null,table);
    for(const {row} of queue){
      const tr=el('tr',null,rows),entityCell=el('td',null,tr);identity(entityCell,row);
      inlineChoice(el('td',null,tr),row,'Type',[['npc','NPC'],['divine','Divine'],['item','Item'],['organization','Organization']],row.kind,'kind');
      inlineChoice(el('td',null,tr),row,'Status',[['unreviewed','Unreviewed'],['automatedReviewed','Agent reviewed'],['humanReviewed','Human reviewed']],row.review.status,'status');
      const roles=[['star','Star'],['supporting','Supporting'],['cameo','Cameo']];
      if(!row.importance)roles.unshift(['','Not assessed']);
      inlineChoice(el('td',null,tr),row,'Role',roles,row.importance??'','importance');
      detailsButton(el('td',null,tr),row);
      const accept=button(el('td',null,tr),'Accept',()=>save(row,{changes:{status:'humanReviewed'}}));
      accept.disabled=row.review.status==='humanReviewed';accept.setAttribute('aria-label',`Accept ${row.label}`);
      const exclusion=el('td',null,tr);
      excludeButton(exclusion,row,'Exclude',undefined,undefined,()=>{
        const expanded=el('tr',null,rows);expanded.className='entity-map-exclusion-row';tr.after(expanded);
        entityCell.setAttribute('rowspan','2');tr.classList.add('entity-map-row-excluding');
        const parent=el('td',null,expanded);parent.colSpan=6;
        return {parent,close(){expanded.remove();entityCell.removeAttribute('rowspan');tr.classList.remove('entity-map-row-excluding');}};
      }).setAttribute('aria-label',`Exclude ${row.label}`);
    }
    if(!queue.length)el('td','No included entities.',el('tr',null,rows)).colSpan=7;
    el('h3','Excluded entities',parent);
    const excludedScroll=el('div',null,parent);excludedScroll.className='entity-map-table-scroll';
    const excluded=el('table',null,excludedScroll);excluded.className='entity-exclusions-table';
    const excludedHead=el('tr',null,el('thead',null,excluded));
    for(const name of ['Name / label','Exclusion reason','Details','Include'])el('th',name,excludedHead);
    const excludedRows=el('tbody',null,excluded);
    for(const [index,row] of (snapshot.document.exclusions??[]).entries()){
      const tr=el('tr',null,excludedRows);el('td',row.label,tr);el('td',row.reason,tr);
      detailsButton(el('td',null,tr),row,index);
      const cell=el('td',null,tr),info=snapshot.exclusionDetails?.[index];
      const include=async fields=>{
        let token=snapshot.token;
        if(info?.restoreNotes?.length){
          const inspected=await call({command:'inspect',notes:info.restoreNotes});
          if(disposed)return;
          if(inspected.token.mapSha256!==token.mapSha256||inspected.token.reviewSha256!==token.reviewSha256)throw new Error('Review changed; reload before including.');
          token=inspected.token;
        }
        snapshot=await call({command:'exclusionInclude',exclusionIndex:index,token,...fields});
        if(!disposed)render();return 'Entity included; review its restored fields before accepting.';
      };
      button(cell,'Include',()=>{
        if(info?.restorable)return include({});
        if(cell.querySelector('select'))return;
        const form=el('div',null,cell);
        help(form,'This candidate has no saved type or role. Choose both before including it.');
        const kind=select(form,'Type',[['','Choose type'],['npc','NPC'],['divine','Divine'],['item','Item'],['organization','Organization']],'');
        const importance=select(form,'Role',[['','Choose role'],['star','Star'],['supporting','Supporting'],['cameo','Cameo']],'');
        button(form,'Confirm include',()=>{
          if(!kind.value||!importance.value)throw new Error('Choose an entity type and role before including.');
          return include({kind:kind.value,importance:importance.value});
        });
        button(form,'Cancel',()=>form.remove());
      }).setAttribute('aria-label',`Include ${row.label}`);
    }
    if(!excludedRows.children.length)el('td','No excluded entities.',el('tr',null,excludedRows)).colSpan=4;
  }
  function identity(parent,row){
    el('strong',row.label,parent).className='entity-review-name';
    confidenceInfo(parent,row,mode!=='map');
    const openQuestions=snapshot.review.feedback.filter(item=>item.entity===row.id&&item.status==='open').length;
    if(openQuestions)help(parent,`${openQuestions} open ${openQuestions===1?'question':'questions'} for the agent.`);
    if(row.identifiedLater)el('p','Identified later',parent);
    if(row.examinedInMirrorOfPast)el('p','Examined in the Mirror of the Past',parent);
    if(row.names?.length&&!(row.names.length===1&&row.names[0]===row.label))help(parent,'Named in the source as: '+row.names.join(', '));
    const target=el('p','Vault note: ',parent);target.className='entity-review-vault-note';
    if(row.note)link(target,noteName(row.note),row.note).title=row.note;else el('span','No matching note',target);
  }
  function render(){
    closePopup(false);
    body.replaceChildren();const all=entityQueueEntries(snapshot),queue=entries();
    const metadata=snapshot.session;
    const dates=metadata.drStart?`${metadata.drStart}${metadata.drEnd&&metadata.drEnd!==metadata.drStart?' – '+metadata.drEnd:''} DR`:'';
    el('h2',[`${metadata.campaign} ${metadata.number??''}`.trim(),dates,metadata.realWorldDate].filter(Boolean).join(' · ')+` — ${mode==='map'?'List of Entities':'Review entities'}`,body);
    const summary=el('div',null,body);summary.className='entity-review-summary';
    el('span',`${all.filter(item=>item.decision==='pending').length} of ${all.length} not human reviewed`,summary);
    if(metadata.transcriptPath)link(summary,'Transcript',metadata.transcriptPath);
    if(metadata.sessionNotePath)link(summary,'Session note',metadata.sessionNotePath);
    const toolbar=el('div',null,body);toolbar.className='entity-queue-toolbar';
    if(mode==='map'){
      renderMap(body,queue);
    }else{
      const picker=select(toolbar,'Show ',[['pending','Not human reviewed'],['all','All entities']],filter);picker.addEventListener('change',()=>{if(busy)return;filter=picker.value;selected=null;render();});
      if(!queue.length){el('p','No entities remain in this view.',body);}
      else {
      let index=queue.findIndex(item=>item.key===selected);if(index<0)index=0;
      const {row}=queue[index];selected=row.id;onSelect(selected);
      el('span',`${index+1} of ${queue.length}`,toolbar);
      button(toolbar,'Previous',()=>{selected=queue[(index+queue.length-1)%queue.length].key;render();});
      button(toolbar,'Skip for now',()=>{selected=queue[(index+1)%queue.length].key;render();return 'Skipped without changing review status.';});
      const card=el('section',null,body);card.className='entity-review-card';identity(card,row);evidence(card,row);editor(card,row);
      }
    }
    if(mode==='map'){
      const sessionFeedback=el('details',null,body);sessionFeedback.className='entity-review-feedback';el('summary','Feedback on this session',sessionFeedback);
      help(sessionFeedback,'Leave a request for the agent about the whole entity map, such as a missing entity or a broader correction. For a specific entity, use Feedback on this entity. The agent reads saved feedback when you ask it to; saving does not run it.');
      for(const item of snapshot.review.feedback.filter(item=>item.entity==null||!snapshot.document.entities.some(row=>row.id===item.entity)))el('p',`${item.record?.label??'Session'} · ${item.status==='resolved'?'Resolved':'Waiting for agent'}: ${item.comment}${item.resolution?' · '+item.resolution:''}`,sessionFeedback);
      const comment=field(sessionFeedback,'Message about this session ','','textarea');
      button(sessionFeedback,'Save session feedback',async()=>{snapshot=await call({command:'entityFeedback',token:snapshot.token,comment:comment.value});if(!disposed)render();return 'Question saved. Use Follow up with the agent below to work through it.';});
      const openQuestions=snapshot.review.feedback.filter(item=>item.status==='open').length;
      const handoff=el('details',null,body);handoff.className='entity-review-feedback';handoff.open=openQuestions>0;
      el('summary',`Follow up with the agent${openQuestions?` (${openQuestions} open ${openQuestions===1?'question':'questions'})`:''}`,handoff);
      help(handoff,'Feedback waits here until you ask an agent to work on it. Saving a question does not send it to an agent.');
      const steps=el('ol',null,handoff);
      el('li','Save your question under Feedback on this entity or Feedback on this session.',steps);
      el('li','Leave unresolved entities unreviewed. In the review queue, use Skip for now to continue. Set Status to Unreviewed if an entity was already reviewed.',steps);
      el('li','Paste the request below into your agent chat. Work through any questions with the agent; it records the outcome when the issue is resolved.',steps);
      el('li','Choose Reload list after the agent finishes. Review the result yourself, then use Accept when satisfied. Resolving feedback does not mark an entity human reviewed.',steps);
      const prompt=field(handoff,'Request to paste into your agent chat ',`Use the check-session-entities skill to resolve feedback with my help for this session: ${session}. Read the saved entity-review feedback and change history, work through the open questions with me, and record the resolutions.`,'textarea');
      prompt.readOnly=true;prompt.rows=4;
      const history=el('details',null,body);el('summary','Change history',history);
      if(snapshot.token.reviewSha256)link(history,'Review feedback JSON',snapshot.reviewPath);
      for(const item of [...snapshot.review.history].reverse())el('p',`${item.at} · ${item.actor} · ${snapshot.document.entities.find(row=>row.id===item.entity)?.label??item.before?.label??'Entity map'} · ${item.action}${item.reason?' · '+item.reason:''}`,history);
      if(!snapshot.review.history.length)help(history,'No changes saved yet.');
    }
  }
  return {ready:work(load),dispose(){disposed=true;closePopup(false);root.replaceChildren();}};
}
