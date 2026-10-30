// A manual queue over saved AI proposals. High-confidence defaults are display
// policy; only an explicit human decision writes humanReviewed.
export function entityQueueEntries(snapshot){
  const state=snapshot.reviewState,requests=state.requests??{};
  const entities=snapshot.document.entities.map(row=>{
    const key='entity:'+row.id,requested=!!requests[key];
    const excluded=state.excluded.includes(row.id);
    const invalid=state.invalidated.includes(row.id)||state.deferred.includes(row.id);
    const human=row.review.status==='humanReviewed'&&!invalid;
    const aiDefault=!human&&!invalid&&!requested&&!excluded&&row.review.confidence==='high';
    const last=[...state.history].reverse().find(event=>event.entity===row.id);
    const decision=requested?'changes':invalid?'pending':excluded?'excluded':human?(last?.action==='include'||last?.action==='includeCandidate'?'included':'accepted'):aiDefault?'accepted':'pending';
    return {key,row,type:'entity',decision,aiDefault};
  });
  const exclusions=(snapshot.exclusionRecords??[]).map(row=>({key:row.key,row,type:'exclusion',
    decision:requests[row.key]?'changes':row.decision==='excluded'?'excluded':'pending',aiDefault:false}));
  return [...entities,...exclusions].sort((a,b)=>Number(a.decision!=='pending')-Number(b.decision!=='pending')||Number(a.type==='exclusion')-Number(b.type==='exclusion')||({low:0,medium:1,high:2}[a.row.review?.confidence]??3)-({low:0,medium:1,high:2}[b.row.review?.confidence]??3)||a.row.label.localeCompare(b.row.label));
}

export function mountEntityReview(root,{request,open,session,onChange=()=>{},initialEntity,onSelect=()=>{}}){
  const document=root.ownerDocument;
  let snapshot,disposed=false,busy=false,filter='pending',selected=initialEntity?(initialEntity.includes(':')?initialEntity:'entity:'+initialEntity):null,notes=[];
  root.classList.add('entity-review-queue');
  const el=(tag,text,parent=root)=>{const node=document.createElement(tag);if(text!=null)node.textContent=String(text);parent.append(node);return node;};
  const status=el('p','Loading entity queue…');status.setAttribute('role','status');
  const body=el('div',null);
  const call=fields=>request({sessionYaml:session,...fields});
  async function work(run){
    if(disposed||busy)return;busy=true;root.setAttribute('aria-busy','true');status.textContent='Saving…';
    try{const message=await run();if(!disposed)status.textContent=message??'Ready.';}
    catch(error){if(!disposed)status.textContent=error.message;}
    finally{busy=false;root.removeAttribute('aria-busy');}
  }
  const button=(parent,label,run)=>{const node=el('button',label,parent);node.type='button';node.addEventListener('click',()=>void work(run));return node;};
  function field(parent,label,value='',tag='input'){
    const wrapper=el('label',label,parent),node=el(tag,null,wrapper);node.value=value??'';return node;
  }
  function select(parent,label,choices,value){
    const node=field(parent,label,'','select');for(const [key,text] of choices){const option=el('option',text,node);option.value=key;}node.value=value;return node;
  }
  function filtered(){return entityQueueEntries(snapshot).filter(entry=>filter==='all'||entry.decision===(filter==='changes'?'changes':'pending'));}
  async function load(){
    snapshot=await call({command:'inspect',notes:[]});if(disposed)return;
    if(selected&&!filtered().some(entry=>entry.key===selected))filter='all';
    render();return 'Ready. Direct decisions save immediately.';
  }
  async function save(entry,action,fields={}){
    const previous=filtered(),index=previous.findIndex(item=>item.key===entry.key);
    let token=snapshot.token;
    if(fields.note&&fields.note!==entry.row.note){
      const inspected=await call({command:'inspect',notes:[fields.note]});
      if(disposed)return;
      if(inspected.token.mapSha256!==token.mapSha256)throw new Error('Entity map changed; reload before saving the link.');
      token=inspected.token;
    }
    const result=await call({command:'entityQueueDecision',token,key:entry.key,action,...fields});
    if(disposed)return;snapshot=result;
    selected=filtered()[Math.min(Math.max(0,index),filtered().length-1)]?.key??null;
    render();await onChange();return action==='needsChanges'?'Change request saved for agent export.':'Decision saved.';
  }
  function render(){
    body.replaceChildren();const all=entityQueueEntries(snapshot),queue=filtered();
    el('h2',`${snapshot.session.campaign} ${snapshot.session.number??''} · Entity review`,body);
    el('p',`${all.filter(item=>item.decision==='pending').length} awaiting a decision · ${all.filter(item=>item.aiDefault).length} accepted by AI confidence · ${all.filter(item=>item.decision==='changes').length} changes needed`,body);
    const toolbar=el('div',null,body);toolbar.className='entity-queue-toolbar';
    const picker=select(toolbar,'Show ',[['pending','Needs review'],['all','All entities and exclusions'],['changes','Changes needed']],filter);
    picker.addEventListener('change',()=>{if(busy)return;filter=picker.value;selected=null;render();status.textContent='Ready.';});
    button(toolbar,'Reload queue',load);
    const exportButton=button(toolbar,'Export changes needed',async()=>{
      const result=await call({command:'exportEntityFeedback',token:snapshot.token});
      return `Exported ${result.count} change requests to ${result.path}`;
    });
    exportButton.disabled=!Object.keys(snapshot.reviewState.requests??{}).length;
    if(!queue.length){el('p',filter==='pending'?'No items awaiting a decision. High-confidence defaults are accepted; open All to inspect or change them.':'No items in this view.',body);return;}
    let index=queue.findIndex(item=>item.key===selected);if(index<0)index=0;
    const entry=queue[index];selected=entry.key;onSelect(selected);
    const nav=el('div',null,body);nav.className='entity-queue-toolbar';
    el('span',`${index+1} of ${queue.length}`,nav);
    button(nav,'Previous',()=>{selected=queue[(index+queue.length-1)%queue.length].key;render();});
    button(nav,'Skip for now',()=>{selected=queue[(index+1)%queue.length].key;render();return 'Skipped without changing the saved decision.';});
    const card=el('section',null,body);card.className='entity-review-card';
    el('h3',entry.row.label,card);
    el('p',`${entry.type==='exclusion'?'AI excluded candidate':`${entry.row.kind} · ${entry.row.review.confidence} confidence`} · ${entry.aiDefault?'Accepted by AI default':entry.decision==='pending'?'No decision yet':entry.decision}`,card);
    if(entry.row.identifiedLater)el('p','Identified later',card).className='entity-later-identity';
    if(entry.row.reason)el('p','Rationale: '+entry.row.reason,card);
    if(snapshot.reviewState.invalidated.includes(entry.row.id))el('p','Evidence changed. This decision needs another look.',card);
    const note=field(card,'Vault link ',entry.row.note??'');note.placeholder='Choose a note, or leave unlinked';
    const suggestions=el('datalist',null,card);suggestions.id='entity-queue-notes';note.setAttribute('list',suggestions.id);
    const populate=()=>{suggestions.replaceChildren();for(const path of notes.filter(path=>path.toLowerCase().includes(note.value.toLowerCase())).slice(0,80)){const option=el('option',null,suggestions);option.value=path;}};
    note.addEventListener('input',populate);
    populate();note.addEventListener('focus',()=>{if(notes.length)return;void request({command:'entityNoteChoices'}).then(result=>{if(!disposed){notes=result.paths;populate();}}).catch(error=>{if(!disposed)status.textContent=error.message;});},{once:true});
    for(const candidate of entry.row.candidates??[])button(card,candidate,()=>{note.value=candidate;});
    if(entry.row.note)button(card,'Open linked note',()=>open(entry.row.note));
    let kind;
    if(entry.type==='exclusion')kind=select(card,'Include as ',[['','Choose a kind'],['npc','Person / NPC'],['divine','Divine being'],['item','Item'],['organization','Organization']],'');
    const actions=el('div',null,card);actions.className='entity-queue-toolbar';
    if(entry.type==='entity'){
      const excluded=snapshot.reviewState.excluded.includes(entry.row.id);
      button(actions,excluded?'Include and next':'Accept and next',()=>save(entry,excluded?'include':'accept',{note:note.value.trim()||null}));
      button(actions,excluded?'Keep excluded and next':'Exclude and next',()=>save(entry,'exclude'));
    }else{
      button(actions,'Include and next',()=>save(entry,'include',{kind:kind.value,note:note.value.trim()||null}));
      button(actions,'Keep excluded and next',()=>save(entry,'keepExcluded'));
    }
    const changes=el('details',null,card);el('summary','Changes needed',changes);
    const comment=field(changes,'What should the agent change? ',snapshot.reviewState.requests?.[entry.key]?.comment??'','textarea');
    button(changes,'Save change request and next',()=>save(entry,'needsChanges',{comment:comment.value}));
    const evidence=el('details',null,card);el('summary','Transcript evidence',evidence);const evidenceBody=el('div',null,evidence);let evidenceLoaded=false;
    evidence.addEventListener('toggle',()=>{
      if(!evidence.open||evidenceLoaded||busy)return;evidenceLoaded=true;
      void work(async()=>{
        try{
        if(entry.type==='entity'){
          const result=await call({command:'evidence',entity:entry.row.id,mapSha256:snapshot.token.mapSha256});if(disposed)return;
          for(const passage of result.passages){el('p',`${passage.source.startUid}–${passage.source.endUid}`,evidenceBody);el('pre',passage.text,evidenceBody);button(evidenceBody,'Open transcript passage',()=>open(passage.path,passage.line));}
        }else{
          const transcript=await call({command:'transcriptInspect'});
          const passage=await call({command:'transcriptPassage',token:transcript.token,uid:entry.row.source.startUid});
          if(!disposed)for(const unit of passage.context)el('p',`${unit.uid} · ${unit.speaker}: ${unit.text}`,evidenceBody);
        }
        }catch(error){evidenceLoaded=false;evidenceBody.replaceChildren();throw error;}
      });
    });
    const flag=el('details',null,card);el('summary','Name transcribed incorrectly',flag);const flagBody=el('div',null,flag);let flagLoaded=false;
    flag.addEventListener('toggle',()=>{
      if(!flag.open||flagLoaded||busy)return;flagLoaded=true;
      void work(async()=>{try{await transcriptionForm(flagBody,entry,flag);}catch(error){flagLoaded=false;flagBody.replaceChildren();throw error;}});
    });
  }
  async function transcriptionForm(parent,entry,details){
    const transcript=await call({command:'transcriptInspect'});if(disposed)return;
    const ranges=entry.row.occurrences?.map(item=>item.source)??[entry.row.source];
    const uids=transcript.uids.filter((uid,index)=>ranges.some(range=>transcript.uids.indexOf(range.startUid)<=index&&index<=transcript.uids.indexOf(range.endUid)));
    if(!uids.length)throw new Error('The entity evidence no longer resolves to transcript UIDs.');
    const uid=select(parent,'Occurrence ',uids.map(value=>[value,value]),uids[0]);
    const text=el('pre',null,parent),before=field(parent,'Exact words transcribed incorrectly '),suggestion=field(parent,'Suggested spelling (optional) '),comment=field(parent,'Explanation (optional) ');
    let version=0;
    async function passage(){
      const current=++version,result=await call({command:'transcriptPassage',token:transcript.token,uid:uid.value});
      if(disposed||current!==version)return;text.textContent=`${result.speaker}: ${result.text}`;
      before.value=result.text.split(entry.row.label).length===2?entry.row.label:'';
    }
    uid.addEventListener('change',()=>void work(passage));await passage();
    button(parent,'Queue transcription review',async()=>{
      const result=await call({command:'entityTranscriptionFlag',token:snapshot.token,key:entry.key,transcriptToken:transcript.token,
        uid:uid.value,before:before.value,suggestion:suggestion.value,comment:comment.value});
      if(disposed)return;transcript.token=result.token;await onChange();details.open=false;
      return 'Transcription issue queued. The entity decision is unchanged.';
    });
  }
  return {ready:work(load),dispose(){disposed=true;root.replaceChildren();}};
}
