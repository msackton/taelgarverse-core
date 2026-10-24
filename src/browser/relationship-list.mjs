import {filterWorldbuilding} from '../relationship-graph.mjs';

const groupName=(edge,id)=>{
  const outgoing=edge.source===id;
  switch(edge.kind){
    case 'mentions':return outgoing?'People mentioned':'Mentioned by';
    case 'member':return outgoing?'Organizations':'Members';
    case 'leader':return outgoing?'Organizations led':'Leaders';
    case 'organization':return outgoing?'Parent organization':'Organizations within';
    case 'contains':return outgoing?'Containing place':'Places within';
    case 'secondaryPlace':return outgoing?'Secondary containment':'Secondary places';
    case 'current':return outgoing?'Currently at':'People here';
    case 'lastKnown':return outgoing?'Last known at':'People last known here';
    case 'route':return 'Connected routes and places';
  }
};

export function mountRelationshipList(root,{loadData,openNote,initialRoot}){
  const doc=root.ownerDocument;let disposed=false,sequence=0;
  root.classList.add('tg-relationship-list');
  const el=(tag,parent,text)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;parent.append(n);return n;};
  const link=(parent,text,path,line)=>{const n=el('a',parent,text);n.href='#';n.className='internal-link';
    n.setAttribute('data-href',path);n.addEventListener('click',event=>{event.preventDefault();if(!disposed)openNote(path,line);});return n;};
  async function refresh(){
    if(disposed)return;const version=++sequence;
    root.setAttribute('aria-busy','true');
    try{
      const data=await loadData();if(disposed||version!==sequence)return;
      root.replaceChildren();const graph=filterWorldbuilding(data.graph,false),byId=new Map(graph.nodes.map(n=>[n.id,n]));
      const node=byId.get(initialRoot);
      if(!node){el('p',root,'No visible person, organization, or place for this note.');return;}
      const header=el('div',root);header.className='tg-relationship-list-header';
      el('strong',header,'Relationships');el('span',header,'DR '+graph.date);
      const groups=new Map();
      for(const edge of graph.edges){
        if(edge.source!==initialRoot&&edge.target!==initialRoot)continue;
        const heading=groupName(edge,initialRoot);if(!heading)continue;
        const other=byId.get(edge.source===initialRoot?edge.target:edge.source);if(!other)continue;
        if(!groups.has(heading))groups.set(heading,new Map());
        const rows=groups.get(heading);if(!rows.has(other.id))rows.set(other.id,{node:other,edges:[]});
        rows.get(other.id).edges.push(edge);
      }
      if(!groups.size)el('p',root,'No direct connections.');
      for(const [heading,rows] of groups){
        el('h4',root,heading);const list=el('ul',root);
        for(const row of [...rows.values()].sort((a,b)=>a.node.name.localeCompare(b.node.name))){
          const item=el('li',list);link(item,row.node.name,row.node.id);
          if(row.edges.every(e=>e.status==='past'))el('span',item,' · historical');
          const evidence=row.edges.flatMap(e=>e.evidence??[]);
          if(evidence.length){
            const details=el('details',item);el('summary',details,'Source');
            for(const evidenceItem of evidence){
              const paragraph=el('p',details,evidenceItem.excerpt);
              if(evidenceItem.date)el('small',paragraph,' · DR '+evidenceItem.date);
              else if(evidenceItem.before)el('small',paragraph,' · before DR '+evidenceItem.before);
              link(details,evidenceItem.line===undefined?'Open source':'Open passage · line '+(evidenceItem.line+1),evidenceItem.source,evidenceItem.line);
            }
          }
        }
      }
      const warnings=[...(graph.warnings??[]),...(data.warnings??[])];
      if(warnings.length){const details=el('details',root);el('summary',details,warnings.length+' data warnings');for(const warning of warnings)el('p',details,warning);}
    }catch(error){if(!disposed&&version===sequence)root.textContent='Relationships unavailable: '+error.message;}
    finally{if(!disposed&&version===sequence)root.removeAttribute('aria-busy');}
  }
  const ready=refresh();
  return {ready,refresh,dispose(){disposed=true;sequence++;root.replaceChildren();root.classList.remove('tg-relationship-list');root.removeAttribute('aria-busy');}};
}
