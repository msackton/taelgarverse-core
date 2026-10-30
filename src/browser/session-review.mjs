import {mountTranscriptReview} from './transcript-review.mjs';
import {mountEntityReview} from './entity-review.mjs';
// Host-independent review UI; the Python helper owns all persistence and guards.
export function mountSessionReview(root,{request,open,initialState={},onStartupStep=()=>{}}){
  onStartupStep('mount:start');
  const document=root.ownerDocument;
  let disposed=false,busy=false,session=initialState.session,selected=initialState.entity,stage=initialState.stage??'entities',transcriptView,entityView;
  root.classList.add('taelgar-session-review');
  const el=(tag,text,parent=root)=>{const node=document.createElement(tag);if(text!=null)node.textContent=String(text);parent.append(node);return node;};
  const status=el('p','Loading sessions…');status.setAttribute('role','status');
  const controls=el('div',null),index=el('div',null),body=el('div',null);
  onStartupStep('mount:dom-created');
  const button=(parent,label,run)=>{const node=el('button',label,parent);node.type='button';node.addEventListener('click',()=>void work(run));return node;};
  async function work(run){
    if(busy||disposed)return;busy=true;root.setAttribute('aria-busy','true');status.textContent='Loading…';
    try{const message=await run();if(!disposed)status.textContent=typeof message==='string'?message:'Ready.';}
    catch(error){if(!disposed)status.textContent=error.message;}
    finally{busy=false;root.removeAttribute('aria-busy');}
  }
  function input(parent,label,value='',tag='input'){
    const wrapper=el('label',label,parent),field=el(tag,null,wrapper);field.value=value??'';return field;
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
      for(const name of ['Session','Transcript','Entities'])el('th',name,head);
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
        button(transcript,`Review transcript${row.transcriptPending==null?'':` (${row.transcriptPending})`}`,async()=>{session=row.sessionYaml;selected=null;stage='transcript';await loadSession();}).disabled=!transcriptAvailable;
        const entities=el('td',null,tr);
        button(entities,`Review entities${row.entities==null?'':` (${row.entities})`}`,async()=>{session=row.sessionYaml;selected=null;stage='entities';await loadSession();}).disabled=row.stage!=='reviewable';
      }
    }
    search.addEventListener('input',render);readyOnly.addEventListener('change',render);render();
    el('p','Counts are discovery hints. Opening a session validates its current sources and evidence.',index);
    onStartupStep('index:rendered');
  }
  async function loadSession(){
    transcriptView?.dispose();entityView?.dispose();transcriptView=null;entityView=null;
    body.replaceChildren();index.hidden=true;controls.hidden=true;
    button(body,'Back to sessions',async()=>{
      transcriptView?.dispose();entityView?.dispose();transcriptView=null;entityView=null;
      body.replaceChildren();index.hidden=false;controls.hidden=false;await loadIndex();
    });
    const pane=el('div',null,body);
    if(stage==='transcript'){
      transcriptView=mountTranscriptReview(pane,{request,open,session,onChange:loadIndex});
      await transcriptView.ready;return;
    }
    entityView=mountEntityReview(pane,{request,open,session,onChange:loadIndex,initialEntity:selected,onSelect:key=>{selected=key;}});
    await entityView.ready;
  }
  button(controls,'Refresh session index',loadIndex);
  const connection=el('details',null,controls);el('summary','Python connection tools',connection);
  button(connection,'Inspect Python setup',async()=>{
    const result=await request({command:'connectionInfo'});
    return `Python executable: ${result.executable}. Obsidian runtime: ${result.appExecutable??'unavailable'} (${result.arch??'unknown architecture'}). Electron ${result.electron??'unavailable'}; Node ${result.node}. This inspection did not launch Python.`;
  });
  button(connection,'Check Python connection',async()=>{
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
    if(changed){transcriptView?.dispose();transcriptView=null;entityView?.dispose();entityView=null;body.replaceChildren();index.hidden=false;controls.hidden=false;status.textContent='Saved selection restored. Reload selected session to continue.';}
  },dispose:()=>{disposed=true;transcriptView?.dispose();entityView?.dispose();root.replaceChildren();}};
}
