import {mountEntityReview} from './entity-review.mjs';
// Host-independent entity review. Persistence belongs to the vault helper.
export function mountSessionReview(root,{request,open,initialState={},onStartupStep=()=>{}}){
  const document=root.ownerDocument;
  let disposed=false,busy=false,session=initialState.session,selected=initialState.entity,stage=initialState.stage==='review'?'review':'map',entityView;
  root.classList.add('taelgar-session-review');
  const el=(tag,text,parent=root)=>{const node=document.createElement(tag);if(text!=null)node.textContent=String(text);parent.append(node);return node;};
  const status=el('p','Loading sessions…');status.setAttribute('role','status');
  const controls=el('div',null),index=el('div',null),body=el('div',null);
  async function work(run){
    if(busy||disposed)return;busy=true;status.textContent='Loading…';
    try{await run();if(!disposed)status.textContent='Ready.';}
    catch(error){if(!disposed)status.textContent=error.message;}
    finally{busy=false;}
  }
  const button=(parent,label,run)=>{const node=el('button',label,parent);node.type='button';node.addEventListener('click',()=>void work(run));return node;};
  function clear(){entityView?.dispose();entityView=null;body.replaceChildren();}
  async function loadIndex(){
    const result=await request({command:'index'});if(disposed)return;
    index.replaceChildren();const sessions=result.sessions.filter(row=>row.entities!=null||row.stage==='error');
    el('h2',`Sessions with an entities map (${sessions.length})`,index);
    const label=el('label','Find session ',index),search=el('input',null,label),table=el('table',null,index);
    function render(){
      table.replaceChildren();const head=el('tr',null,el('thead',null,table));
      for(const name of ['Session','Human review','Actions'])el('th',name,head);
      const rows=el('tbody',null,table);
      for(const row of sessions){
        const name=`${row.campaign??''} ${row.number??''}`.trim()||row.sessionYaml;
        if(!`${name} ${row.sessionYaml}`.toLowerCase().includes(search.value.toLowerCase()))continue;
        const tr=el('tr',null,rows);el('td',name,tr);
        el('td',row.error?`Cannot inspect: ${row.error}`:row.pending===0?'Human reviewed':`Unreviewed · ${row.pending??row.entities} of ${row.entities}`,tr);
        const actions=el('td',null,tr);
        for(const [label,mode] of [['Show entities map','map'],['Review entities','review']]){
          button(actions,label,async()=>{session=row.sessionYaml;selected=null;stage=mode;await loadSession();}).disabled=!!row.error;
        }
      }
      if(!rows.children.length)el('td','No matching sessions with an entities map.',el('tr',null,rows)).colSpan=3;
    }
    search.addEventListener('input',render);render();
    onStartupStep('index:rendered');
  }
  async function loadSession(){
    clear();index.hidden=true;controls.hidden=true;status.hidden=true;
    const pane=el('div',null,body);
    entityView=mountEntityReview(pane,{request,open,session,mode:stage,initialEntity:selected,onSelect:key=>{selected=key;},
      onBack:async()=>{clear();session=null;selected=null;index.hidden=false;controls.hidden=false;status.hidden=false;await loadIndex();},
      onSwitch:async()=>{stage=stage==='map'?'review':'map';selected=null;await loadSession();}});
    await entityView.ready;
  }
  button(controls,'Refresh sessions',loadIndex);
  if(session)button(controls,'Resume selected session',loadSession);
  const ready=work(loadIndex);
  return {ready,getState:()=>({session,entity:selected,stage}),restore:async state=>{
    const changed=session!==state.session||stage!==state.stage||selected!==state.entity;
    session=state.session;selected=state.entity;stage=state.stage==='review'?'review':'map';
    if(changed){clear();index.hidden=false;controls.hidden=false;status.hidden=false;status.textContent='Saved selection restored. Choose a session to continue.';}
  },dispose(){disposed=true;clear();root.replaceChildren();}};
}
