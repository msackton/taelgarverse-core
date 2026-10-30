import {mountTranscriptReview} from './transcript-review.mjs';
// Host-independent review UI; the Python helper owns all persistence and guards.
export function mountSessionReview(root,{request,open,initialState={},onStartupStep=()=>{}}){
  onStartupStep('mount:start');
  const document=root.ownerDocument;
  let disposed=false,busy=false,session=initialState.session,selected=initialState.entity,snapshot,filter='all',detailVersion=0,stage=initialState.stage??'entities',transcriptView;
  root.classList.add('taelgar-session-review');
  const el=(tag,text,parent=root)=>{const node=document.createElement(tag);if(text!=null)node.textContent=String(text);parent.append(node);return node;};
  const status=el('p','Loading sessions…');status.setAttribute('role','status');
  const controls=el('div',null),index=el('div',null),body=el('div',null);
  onStartupStep('mount:dom-created');
  const button=(parent,label,run)=>{const node=el('button',label,parent);node.type='button';node.addEventListener('click',()=>void work(run));return node;};
  async function work(run){
    if(busy||disposed)return;busy=true;root.setAttribute('aria-busy','true');status.textContent='Loading…';
    try{const message=await run();if(!disposed)status.textContent=typeof message==='string'?message:'Ready. Decisions apply only when you select a decision button.';}
    catch(error){if(!disposed)status.textContent=error.message;}
    finally{busy=false;root.removeAttribute('aria-busy');}
  }
  function input(parent,label,value='',tag='input'){
    const wrapper=el('label',label,parent),field=el(tag,null,wrapper);field.value=value??'';return field;
  }
  function select(parent,label,values,value){
    const field=input(parent,label,'','select');for(const v of values){const option=el('option',v,field);option.value=v;}field.value=value;return field;
  }
  async function loadIndex(){
    onStartupStep('index:request');
    const result=await request({command:'index'});if(disposed)return;
    onStartupStep('index:received');
    index.replaceChildren();el('h2',`Sessions (${result.sessions.length})`,index);
    const search=input(index,'Find session '),readyOnly=input(index,'Reviewable only ');readyOnly.type='checkbox';readyOnly.checked=true;
    const table=el('table',null,index);
    function render(){
      table.replaceChildren();const head=el('tr',null,table);
      for(const name of ['Session','Transcript','Entities','Needs attention','Human decisions'])el('th',name,head);
      for(const row of result.sessions){
        const name=`${row.campaign??''} ${row.number??''}`.trim()||row.sessionYaml;
        if(readyOnly.checked&&row.stage!=='reviewable'&&row.transcriptStage!=='reviewable'||!`${name} ${row.sessionYaml}`.toLowerCase().includes(search.value.toLowerCase()))continue;
        const tr=el('tr',null,table),cell=el('td',null,tr);
        const transcriptAvailable=['reviewable','complete','complete_with_uncertainty'].includes(row.transcriptStage)&&/\/cleaned\/[^/]+-session\.yaml$/.test(row.sessionYaml);
        button(cell,name,async()=>{
          if(row.stage!=='reviewable'&&!transcriptAvailable){await open(row.sessionYaml);return;}
          session=row.sessionYaml;selected=null;stage=row.transcriptPending>0?'transcript':row.stage==='reviewable'?'entities':'transcript';await loadSession();
        });
        const transcript=el('td',null,tr);
        button(transcript,`${row.transcriptStage??'not indexed'}${row.transcriptPending==null?'':` (${row.transcriptPending})`}`,async()=>{session=row.sessionYaml;selected=null;stage='transcript';await loadSession();}).disabled=!transcriptAvailable;
        const entities=el('td',null,tr);
        button(entities,`${row.entities??'—'} · ${row.error??row.stage}`,async()=>{session=row.sessionYaml;selected=null;stage='entities';await loadSession();}).disabled=row.stage!=='reviewable';
        for(const value of [row.pending??'—',row.human??'—'])el('td',value,tr);
      }
    }
    search.addEventListener('input',render);readyOnly.addEventListener('change',render);render();
    el('p','Counts are discovery hints. Opening a session validates its current sources and evidence.',index);
    onStartupStep('index:rendered');
  }
  async function loadSession(notes=[]){
    transcriptView?.dispose();transcriptView=null;
    body.replaceChildren();snapshot=null;detailVersion++;
    if(stage==='transcript'){
      transcriptView=mountTranscriptReview(body,{request,open,session,onChange:loadIndex});
      await transcriptView.ready;return;
    }
    const result=await request({command:'inspect',sessionYaml:session,notes});if(disposed)return;
    snapshot=result;renderSession();if(selected)await renderDetail();
  }
  function renderSession(){
    detailVersion++;body.replaceChildren();
    el('h2',`${snapshot.session.campaign} ${snapshot.session.number??''}`,body);
    const assessment=snapshot.dateValidation;
    if(assessment)el('p',`Dates: ${assessment.result} — ${assessment.reason}`,body);
    const toolbar=el('div',null,body);
    for(const kind of ['all','npc','divine','item','organization'])button(toolbar,kind,async()=>{filter=kind;renderSession();});
    const state=snapshot.reviewState;
    const rows=snapshot.document.entities.filter(row=>filter==='all'||row.kind===filter).sort((a,b)=>{
      const rank=r=>Number(r.review.confidence==='high')*2+Number(r.review.status!=='unreviewed');
      return rank(a)-rank(b)||a.label.localeCompare(b.label);
    });
    const table=el('table',null,body),head=el('tr',null,table);
    for(const name of ['Entity','Kind','Note / candidates','Confidence','Review'])el('th',name,head);
    for(const row of rows){
      const tr=el('tr',null,table),name=el('td',null,tr);
      button(name,row.label,async()=>{selected=row.id;await renderDetail();detail.scrollIntoView?.({block:'start'});});
      el('td',row.kind,tr);const notes=el('td',null,tr);
      for(const p of row.note?[row.note]:row.candidates??[])button(notes,p,()=>open(p));
      if(!notes.childNodes.length)el('span','No page',notes);
      el('td',row.review.confidence,tr);
      el('td',row.review.status+(state.excluded.includes(row.id)?' · excluded':'')+(state.deferred.includes(row.id)?' · deferred':'')+(state.invalidated.includes(row.id)?' · evidence changed':''),tr);
    }
    const excluded=el('details',null,body);el('summary',`Excluded candidates (${snapshot.document.exclusions?.length??0})`,excluded);
    for(const [i,row] of (snapshot.document.exclusions??[]).entries()){
      const line=el('p',`${row.label}: ${row.reason} (${row.source.startUid}–${row.source.endUid}) `,excluded);
      button(line,'Review for inclusion',async()=>{
        detail.replaceChildren();el('h3',row.label,detail);
        const id=input(detail,'New stable ID '),kind=select(detail,'Kind ',['npc','divine','item','organization'],'npc');
        const reason=input(detail,'Why include this entity? ');
        button(detail,'Include candidate',async()=>{
          await decide({action:'includeCandidate',reason:reason.value,exclusionIndex:i,
            newEntity:{id:id.value,kind:kind.value,label:row.label,reason:reason.value,occurrences:[{source:row.source}],review:{confidence:'medium',status:'unreviewed'}}});
        });
      });
    }
    el('p',`${state.history.length} saved decisions. Merge, split, and exclusion history flags dependent interaction references for recheck.`,body);
    const history=el('details',null,body);el('summary','Decision history',history);
    for(const event of state.history.slice().reverse())el('p',`${event.at} · ${event.entity} · ${event.action}: ${event.reason}`,history);
    detail=el('section',null,body);
  }
  let detail;
  async function decide(fields){
    const result=await request({command:'apply',sessionYaml:session,token:snapshot.token,entity:selected,...fields});
    if(fields.newEntity)selected=fields.newEntity.id;
    if(disposed)return;snapshot=result;renderSession();if(selected)await renderDetail();await loadIndex();
  }
  async function renderDetail(){
    const row=snapshot.document.entities.find(r=>r.id===selected);if(!row)return;
    const version=++detailVersion;
    detail.replaceChildren();el('h3',`${row.id} — ${row.label}`,detail);
    const evidence=await request({command:'evidence',sessionYaml:session,entity:row.id,mapSha256:snapshot.token.mapSha256});
    if(disposed||version!==detailVersion)return;
    const form=el('div',null,detail);
    const label=input(form,'Source label ',row.label),kind=select(form,'Kind ',['npc','divine','item','organization'],row.kind);
    const note=input(form,'Matched note path ',row.note),candidates=input(form,'Candidate paths (one per line) ',(row.candidates??[]).join('\n'),'textarea');
    const rationale=input(form,'Identity / selection reason ',row.reason),confidence=select(form,'Confidence ',['high','medium','low'],row.review.confidence);
    const reason=input(form,'Decision explanation ');
    const patch=()=>({label:label.value,kind:kind.value,note:note.value||null,candidates:candidates.value.split('\n').map(x=>x.trim()).filter(Boolean),...(rationale.value?{reason:rationale.value}:{})});
    button(form,'Inspect changed note targets',async()=>{
      const changed=patch(),explanation=reason.value;
      const result=await request({command:'inspect',sessionYaml:session,notes:[...(changed.note?[changed.note]:[]),...changed.candidates]});
      if(disposed)return;
      if(result.token.mapSha256!==snapshot.token.mapSha256)throw new Error('Entity map changed; reload the session.');
      snapshot=result;renderNotes();reason.value=explanation;
    });
    for(const [action,text] of [['accept','Accept'],['correct','Apply correction'],['defer','Defer'],['exclude','Exclude'],['include','Include']])button(form,text,()=>decide({action,patch:patch(),confidence:confidence.value,reason:reason.value}));
    let notes;
    function renderNotes(){
      notes?.remove();notes=el('div',null,detail);
      for(const [p,text] of Object.entries(snapshot.notes)){
        if(![note.value,...candidates.value.split('\n').map(x=>x.trim())].includes(p))continue;
        const section=el('details',null,notes);el('summary',p,section);button(section,'Open page',()=>open(p));el('pre',text,section);
      }
    }
    renderNotes();
    for(const passage of evidence.passages){
      const section=el('details',null,detail);section.open=true;
      el('summary',`${passage.owner} · ${passage.source.startUid}–${passage.source.endUid}`,section);
      button(section,'Open original source',()=>open(passage.path,passage.line));el('pre',passage.text,section);
    }
    const identity=el('details',null,detail);el('summary','Merge or split identities',identity);
    const mergeTargets=[];
    for(const other of snapshot.document.entities.filter(x=>x.id!==row.id)){
      const check=input(identity,`Merge ${other.label} into ${row.label} `);check.type='checkbox';mergeTargets.push([other,check]);
    }
    button(identity,'Merge selected identities',()=>{
      const others=mergeTargets.filter(([,check])=>check.checked).map(([other])=>other);
      const refs=[row,...others].flatMap(r=>r.occurrences);
      const unique=[...new Map(refs.map(x=>[JSON.stringify(x),x])).values()].sort((a,b)=>a.source.startUid.localeCompare(b.source.startUid,undefined,{numeric:true}));
      return decide({action:'merge',others:others.map(r=>r.id),occurrences:unique,patch:patch(),confidence:confidence.value,reason:reason.value});
    });
    el('p','Split into two identities. The continuing identity keeps its ID; select the passages belonging to the second identity. A shared introduction may belong to both.',identity);
    const newId=input(identity,'Second identity ID '),newLabel=input(identity,'Second identity label ');
    const assignments=row.occurrences.map((occurrence,i)=>{
      const field=select(identity,`${occurrence.source.startUid}–${occurrence.source.endUid} `,['continuing','second','both'],'continuing');return [occurrence,field];
    });
    button(identity,'Split identities',()=>{
      const first={...row,...patch(),occurrences:assignments.filter(([,field])=>field.value!=='second').map(([ref])=>ref)};
      const second={id:newId.value,label:newLabel.value,kind:kind.value,reason:rationale.value||reason.value,
        review:{confidence:confidence.value,status:'unreviewed'},occurrences:assignments.filter(([,field])=>field.value!=='continuing').map(([ref])=>ref)};
      return decide({action:'split',entities:[first,second],confidence:confidence.value,reason:reason.value});
    });
  }
  button(controls,'Refresh session index',loadIndex);
  button(controls,'Inspect Python setup',async()=>{
    const result=await request({command:'connectionInfo'});
    return `Python executable: ${result.executable}. Obsidian runtime: ${result.appExecutable??'unavailable'} (${result.arch??'unknown architecture'}). Electron ${result.electron??'unavailable'}; Node ${result.node}. This inspection did not launch Python.`;
  });
  button(controls,'Check Python connection',async()=>{
    const result=await request({command:'connectionCheck'});
    if(result.connection!=='ok')throw new Error('Unexpected Python connection response');
    return `Python ${result.pythonVersion} connected: ${result.executable}`;
  });
  button(controls,'Reload selected session',async()=>{if(session)await loadSession();});
  onStartupStep('mount:controls-created');
  const ready=work(loadIndex);
  return {ready,getState:()=>({session,entity:selected,stage}),restore:async state=>{
    const changed=session!==state.session||stage!==(state.stage??'entities')||selected!==state.entity;
    session=state.session;selected=state.entity;stage=state.stage??'entities';
    if(changed){transcriptView?.dispose();transcriptView=null;snapshot=null;detailVersion++;body.replaceChildren();status.textContent='Saved selection restored. Reload selected session to continue.';}
  },dispose:()=>{disposed=true;detailVersion++;transcriptView?.dispose();root.replaceChildren();}};
}
