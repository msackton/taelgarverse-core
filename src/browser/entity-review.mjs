// Confidence never substitutes for human review.
export function entityQueueEntries(snapshot){
  return snapshot.document.entities.map(row=>({key:row.id,row,decision:row.review.status==='humanReviewed'?'reviewed':'pending'}));
}
export function mountEntityReview(root,{request,open,session,mode='review',initialEntity,onSelect=()=>{}}){
  const document=root.ownerDocument;
  let snapshot,disposed=false,busy=false,selected=initialEntity?.replace(/^entity:/,''),filter='pending',notes=[],serial=0;
  root.classList.add(mode==='map'?'entity-review-map':'entity-review-queue');
  const el=(tag,text,parent=root)=>{const node=document.createElement(tag);if(text!=null)node.textContent=String(text);parent.append(node);return node;};
  const status=el('p','Loading entities…');status.setAttribute('role','status');const body=el('div',null);
  const call=fields=>request({sessionYaml:session,...fields});
  async function work(run){
    if(disposed||busy)return;busy=true;root.setAttribute('aria-busy','true');status.textContent='Working…';
    try{const message=await run();if(!disposed)status.textContent=message??'Ready.';}
    catch(error){if(!disposed)status.textContent=error.message;}
    finally{busy=false;root.removeAttribute('aria-busy');}
  }
  const button=(parent,label,run)=>{const node=el('button',label,parent);node.type='button';node.addEventListener('click',()=>void work(run));return node;};
  function field(parent,label,value='',tag='input'){
    const wrapper=el('label',label,parent),node=el(tag,null,wrapper);node.value=value??'';return node;
  }
  function select(parent,label,choices,value){const node=field(parent,label,'','select');for(const [key,text] of choices){el('option',text,node).value=key;}node.value=value;return node;}
  function link(parent,label,path,line){
    const a=el('a',label,parent);a.href='#';a.addEventListener('click',event=>{event.preventDefault();void work(()=>open(path,line));});return a;
  }
  const entries=()=>entityQueueEntries(snapshot).filter(entry=>mode==='map'||filter==='all'||entry.decision==='pending');
  async function load(){snapshot=await call({command:'inspect'});if(!disposed)render();return 'Ready. Changes save when you choose Save.';}
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
    snapshot=result;selected=entries()[Math.min(Math.max(0,index),entries().length-1)]?.key;render();return 'Entity change and feedback history saved.';
  }
  function editor(parent,row){
    const label=field(parent,'Entity label ',row.label);
    const kind=select(parent,'Kind ',[['npc','Person / NPC'],['divine','Divine being'],['item','Item'],['organization','Organization']],row.kind);
    const importance=select(parent,'Importance ',[['','Not assessed'],['star','Star'],['supporting','Supporting'],['cameo','Cameo']],row.importance??'');
    const review=select(parent,'Review status ',[['unreviewed','Unreviewed'],['automatedReviewed','Agent reviewed'],['humanReviewed','Human reviewed']],row.review.status);
    const note=field(parent,'Vault link ',row.note??'');note.placeholder='Vault-relative note path, or leave unlinked';
    const suggestions=el('datalist',null,parent);suggestions.id=`entity-review-notes-${++serial}`;note.setAttribute('list',suggestions.id);
    function populate(){suggestions.replaceChildren();for(const path of notes.filter(path=>path.toLowerCase().includes(note.value.toLowerCase())).slice(0,80))el('option',null,suggestions).value=path;}
    populate();note.addEventListener('input',populate);note.addEventListener('focus',()=>{if(notes.length)return;void request({command:'entityNoteChoices'}).then(result=>{if(!disposed){notes=result.paths;populate();}}).catch(error=>{if(!disposed)status.textContent=error.message;});});
    for(const candidate of row.candidates??[])link(parent,'Candidate: '+candidate,candidate);
    const reason=field(parent,'Reason (optional) ','','textarea');
    const changes=()=>({label:label.value.trim(),kind:kind.value,...(importance.value?{importance:importance.value}:{}),status:review.value,...((note.value.trim()||null)!==(row.note||null)?{note:note.value.trim()||null}:{})});
    button(parent,mode==='map'?'Save changes':'Save and next',()=>save(row,{changes:changes(),reason:reason.value}));
    button(parent,mode==='map'?'Mark human reviewed':'Accept and next',()=>save(row,{changes:{...changes(),status:'humanReviewed'},reason:reason.value}));
    button(parent,mode==='map'?'Remove entity':'Remove and next',()=>save(row,{action:'remove',reason:reason.value}));
    const comments=el('details',null,parent);el('summary','Agent feedback',comments);
    for(const item of snapshot.review.feedback.filter(item=>item.entity===row.id))el('p',`${item.status}: ${item.comment}${item.resolution?' · '+item.resolution:''}`,comments);
    const comment=field(comments,'Comment or question for agent ','','textarea');
    button(comments,'Save agent feedback',async()=>{snapshot=await call({command:'entityFeedback',entity:row.id,token:snapshot.token,comment:comment.value});if(!disposed)render();return 'Feedback saved for the agent.';});
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
  function identity(parent,row){
    el('strong',row.label,parent);el('p',`${row.id} · ${row.kind} · ${row.importance??'Importance not assessed'} · ${row.review.confidence} confidence · ${row.review.status}`,parent);
    if(row.identifiedLater)el('p','Identified later',parent);
    if(row.examinedInMirrorOfPast)el('p','Examined in the Mirror of the Past',parent);
    if(row.names?.length)el('p','Source names: '+row.names.join(', '),parent);
    if(row.note)link(parent,row.note,row.note);else el('p','Unlinked',parent);
  }
  function render(){
    body.replaceChildren();const all=entityQueueEntries(snapshot),queue=entries();
    el('h2',`${snapshot.session.campaign} ${snapshot.session.number??''} · ${mode==='map'?'Entities map':'Review entities'}`,body);
    el('p',`${all.filter(item=>item.decision==='pending').length} of ${all.length} not human reviewed`,body);
    const toolbar=el('div',null,body);toolbar.className='entity-queue-toolbar';
    button(toolbar,'Reload entities',load);if(snapshot.token.reviewSha256)link(toolbar,'Review feedback JSON',snapshot.reviewPath);
    if(mode==='map'){
      const table=el('table',null,body),head=el('tr',null,el('thead',null,table));for(const name of ['Entity and vault data','Source blocks','Review and edit'])el('th',name,head);
      const rows=el('tbody',null,table);
      for(const {row} of queue){const tr=el('tr',null,rows);identity(el('td',null,tr),row);evidence(el('td',null,tr),row);const edits=el('details',null,el('td',null,tr));el('summary','Edit entity / feedback',edits);editor(edits,row);}
      if(!queue.length)el('p','This map has no entities.',body);
      if(snapshot.document.exclusions?.length){const excluded=el('details',null,body);el('summary',`Excluded candidates (${snapshot.document.exclusions.length})`,excluded);for(const row of snapshot.document.exclusions)el('p',`${row.label}: ${row.reason}`,excluded);}
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
    const sessionFeedback=el('details',null,body);el('summary','Session feedback and history',sessionFeedback);
    for(const item of snapshot.review.feedback.filter(item=>item.entity==null||!snapshot.document.entities.some(row=>row.id===item.entity)))el('p',`${item.entity??'Session'} · ${item.status}: ${item.comment}`,sessionFeedback);
    const comment=field(sessionFeedback,'Session comment (missing entities, questions) ','','textarea');
    button(sessionFeedback,'Save session feedback',async()=>{snapshot=await call({command:'entityFeedback',token:snapshot.token,comment:comment.value});if(!disposed)render();return 'Session feedback saved.';});
    for(const item of [...snapshot.review.history].reverse())el('p',`${item.at} · ${item.actor} · ${item.entity??'Map'} · ${item.action}${item.reason?' · '+item.reason:''}`,sessionFeedback);
  }
  return {ready:work(load),dispose(){disposed=true;root.replaceChildren();}};
}
