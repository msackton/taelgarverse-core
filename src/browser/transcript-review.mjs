// Portable review Markdown and guarded transcript helpers own all writes.
export function mountTranscriptReview(root,{request,open,session,onChange=()=>{}}){
  const document=root.ownerDocument;let disposed=false,busy=false,snapshot,openIssue,passageQuery='';
  const el=(tag,text,parent=root)=>{const node=document.createElement(tag);if(text!=null)node.textContent=String(text);parent.append(node);return node;};
  const status=el('p','Loading transcript review…');status.setAttribute('role','status');
  const body=el('div',null);
  async function work(run){
    if(disposed||busy)return;busy=true;root.setAttribute('aria-busy','true');status.textContent='Loading…';
    try{await run();if(!disposed)status.textContent=snapshot?.downstreamNotice??'Ready. Apply only a decision you have reviewed.';}
    catch(error){if(!disposed)status.textContent=error.message;}
    finally{busy=false;root.removeAttribute('aria-busy');}
  }
  const call=fields=>request({sessionYaml:session,...fields});
  function button(parent,label,action){const node=el('button',label,parent);node.type='button';node.addEventListener('click',()=>void work(action));return node;}
  function field(parent,label,value='',tag='input'){
    const wrapper=el('label',label,parent),node=el(tag,null,wrapper);node.value=value;return node;
  }
  function context(parent,units){
    const block=el('details',null,parent);block.open=true;el('summary','Conversation context',block);
    for(const unit of units)el('p',`${unit.uid} · ${unit.speaker}: ${unit.text}`,block);
  }
  async function refresh(){snapshot=await call({command:'transcriptInspect'});if(!disposed)render();}
  function render(){
    body.replaceChildren();el('h2','Transcript fixes',body);
    el('p','Recover what was said, preserving spoken mistakes and uncertainty. Original and prepared references stay unchanged.',body);
    button(body,'Open readable transcript',()=>open(snapshot.paths.polishedMarkdown));
    button(body,'Open prepared UID reference',()=>open(snapshot.paths.prepared));
    if(snapshot.reportPath)button(body,'Open review Markdown',()=>open(snapshot.reportPath));
    button(body,'Reload transcript review',refresh);
    el('p',`${snapshot.issues.length} queued questions`,body);
    for(const issue of snapshot.issues){
      const section=el('details',null,body);el('summary',`${issue.uid}: ${issue.question}`,section);
      section.open=issue.id===openIssue;
      el('p',`Original: ${issue.original}`,section);
      el('p',`Target words: ${issue.target.before}`,section);
      if(issue.proposal)el('p',`Proposed: ${issue.proposal}`,section);
      for(const [i,alternative] of issue.alternatives.entries())el('p',`Alternative ${i+1}: ${alternative}`,section);
      el('p',issue.recommendation,section);context(section,issue.context);
      const choice=field(section,'Decision ','','select');
      const choices=[['pending','Keep pending'],['retain','Retain unresolved'],...(issue.proposal?[['proposed','Use proposed wording']]:[]),
        ...issue.alternatives.map((_,i)=>[`alternative ${i+1}`,`Use alternative ${i+1}`]),['correction','Supply correction']];
      for(const [value,label] of choices){const option=el('option',label,choice);option.value=value;}
      choice.value=issue.resolution;
      const correction=field(section,'Replacement words for a custom correction ',issue.correction??'');
      el('p','Review the affected readable turns below. Preserve their other words and speaker labels. If the accepted wording differs in punctuation, edit that turn explicitly.',section);
      const turns=issue.turns.map(turn=>({turn,input:field(section,`${turn.speaker} — readable turn `,turn.before,'textarea')}));
      function replacement(){
        if(choice.value==='correction')return correction.value;
        const full=choice.value==='proposed'?issue.proposal:choice.value.startsWith('alternative ')?issue.alternatives[Number(choice.value.split(' ')[1])-1]:null;
        if(full==null)return null;
        const prefix=issue.original.slice(0,issue.target.start),suffix=issue.original.slice(issue.target.end);
        if(!full.startsWith(prefix)||!full.endsWith(suffix))return null;
        return full.slice(prefix.length,suffix.length?-suffix.length:undefined);
      }
      let previewed,applyButton;
      const previewEl=el('div',null,section);
      function invalidate(){previewed=null;if(applyButton)applyButton.disabled=true;previewEl.replaceChildren();}
      section.addEventListener('input',invalidate);section.addEventListener('change',invalidate);
      const decision=()=>({command:'transcriptApply',token:snapshot.token,issue:issue.id,resolution:choice.value,correction:correction.value,
        turns:choice.value==='retain'?[]:turns.map(({turn,input})=>({index:turn.index,before:turn.before,after:input.value,substitutions:[]}))});
      button(section,'Copy replacement into matching turns',async()=>{
        const after=replacement();if(after==null)throw new Error('Choose a correction first. Retaining uncertainty needs no turn rewrite.');
        let changed=0;
        for(const entry of turns){
          const pieces=entry.turn.before.split(issue.target.before);
          if(pieces.length===2){entry.input.value=pieces.join(after);changed++;}
        }
        invalidate();
        if(!changed)throw new Error('No unique literal match in these turns. Review and edit the affected wording directly.');
      });
      button(section,'Preview transcript decision',async()=>{
        if(choice.value==='pending')throw new Error('Choose a decision, or leave this question pending.');
        const planned=decision(),key=JSON.stringify(planned);
        invalidate();
        const result=await call({...planned,command:'transcriptPreview'});if(disposed)return;
        if(JSON.stringify(decision())!==key)throw new Error('Your edits changed while preparing the preview. Preview again.');
        el('h4','Changes to save',previewEl);
        for(const change of result.changes){
          const details=el('details',null,previewEl);details.open=true;el('summary',change.path,details);el('pre',change.diff,details);
        }
        previewed=key;applyButton.disabled=false;
      });
      applyButton=button(section,'Apply this transcript decision',async()=>{
        const planned=decision();
        if(previewed!==JSON.stringify(planned))throw new Error('Preview your current decision before applying it.');
        const result=await call(planned);
        if(disposed)return;snapshot=result;render();await onChange();
      });
      applyButton.disabled=true;
    }
    {
      el('h3','Find a passage to correct',body);
      const query=field(body,'Find words, speaker, or UID ',passageQuery);
      const results=el('div',null,body);
      const passageEl=el('div',null,body);
      async function inspectPassage(uid){
        const passage=await call({command:'transcriptPassage',token:snapshot.token,uid});if(disposed)return;
        passageEl.replaceChildren();el('p',`Prepared original: ${passage.original}`,passageEl);
        el('p',`Current cleaned wording: ${passage.text}`,passageEl);context(passageEl,passage.context);
        const before=field(passageEl,'Exact words to correct ');
        button(passageEl,'Queue this passage for correction',async()=>{
          const result=await call({command:'transcriptPrepare',token:snapshot.token,uid:passage.uid,before:before.value});
          if(disposed)return;snapshot=result;
          openIssue=result.issues.find(issue=>issue.uid===passage.uid&&issue.target.before===before.value)?.id;
          render();await onChange();
        });
      }
      button(body,'Search transcript',async()=>{
        passageQuery=query.value.trim();
        const result=await call({command:'transcriptSearch',token:snapshot.token,query:passageQuery});if(disposed)return;
        results.replaceChildren();passageEl.replaceChildren();
        el('p',`${result.total} matching passages${result.total>result.passages.length?' — refine your search to see more':''}`,results);
        for(const passage of result.passages)button(results,`${passage.uid} · ${passage.speaker}: ${passage.text.slice(0,160)}`,()=>inspectPassage(passage.uid));
      });
    }
    if(snapshot.mode==='review'&&!snapshot.issues.length){
      el('h3','Finish transcript review',body);
      el('p','All queued decisions are resolved. Preview the completion record and temporary files to retire, then finish explicitly.',body);
      const planEl=el('div',null,body);let plan;
      button(body,'Preview finishing review',async()=>{
        plan=null;finish.disabled=true;
        const result=await call({command:'transcriptFinalizePreview',token:snapshot.token});if(disposed)return;
        plan=result;planEl.replaceChildren();el('p',`Update transcript completion in ${plan.update}`,planEl);
        el('p','Retire these temporary review and processing files:',planEl);
        const list=el('ul',null,planEl);for(const path of plan.retire)el('li',path,list);
        finish.disabled=false;
      });
      const finish=button(body,'Finish transcript review',async()=>{
        if(!plan)throw new Error('Preview finishing this review first.');
        const result=await call({command:'transcriptFinalize',token:snapshot.token,planSha256:plan.planSha256});
        if(disposed)return;snapshot=result;render();await onChange();
      });finish.disabled=true;
    }
  }
  return {ready:work(refresh),dispose(){disposed=true;root.replaceChildren();}};
}
