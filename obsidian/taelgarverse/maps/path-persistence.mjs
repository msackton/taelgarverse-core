import {Document,parseDocument,isMap} from 'yaml';
import {storedMapPath,validateMapPath,validateMapPathGeometry,resolveMapPath,pathGeometryText} from '../../../src/map-feature-path.mjs';

import {readMapNote,writeMapNote} from './persistence.mjs';

function pathField(text){
  const start=/^(?:\uFEFF)?---[ \t]*\r?\n/.exec(text),bom=text.startsWith('\uFEFF')?1:0;
  if(!start)return {from:bom,to:bom,raw:null,path:null,frontmatter:false};
  const tail=text.slice(start[0].length),end=/^---[ \t]*(?:\r?\n|$)/m.exec(tail);
  if(!end)throw new Error('The note has unclosed frontmatter; fix it before saving a path.');
  const source=tail.slice(0,end.index),doc=parseDocument(source,{keepSourceTokens:true,uniqueKeys:true});
  if(doc.errors.length || (doc.contents && !isMap(doc.contents)))throw new Error('The note has invalid frontmatter; fix it before saving a path.');
  if(doc.contents?.flow)throw new Error('Use block-style frontmatter before saving a path.');
  const value=doc.toJS({maxAliasCount:0}),pair=doc.contents?.items.find(p=>p.key?.value==='mapPath');
  const key=pair?.key??doc.contents?.items[0]?.key,pos=key?.range?.[0]??0,lineStart=source.lastIndexOf('\n',pos-1)+1,indent=source.slice(lineStart,pos);
  if(!/^[ \t]*$/.test(indent))throw new Error('Use ordinary frontmatter keys before saving a path.');
  if(!pair)return {from:start[0].length+source.length,to:start[0].length+source.length,raw:null,path:null,frontmatter:true,indent};
  const from=start[0].length+lineStart,to=start[0].length+(pair.value?.range?.[2]??pair.key.range[2]);
  return {from,to,raw:text.slice(from,to),path:storedMapPath(value.mapPath),frontmatter:true,indent};
}
export function captureMapPath(text){const field=pathField(text);return {raw:field.raw,path:field.path};}
export function patchMapPath(text,guard,value){
  const field=pathField(text);
  if(field.raw!==guard.raw)throw new Error('This note’s saved path changed. Cancel and choose the note again before saving.');
  const path=value===null?null:validateMapPath(value),newline=text.includes('\r\n')?'\r\n':'\n';
  let replacement=path===null?'':new Document({mapPath:path}).toString({lineWidth:0}).trimEnd().split('\n').map(line=>(field.indent??'')+line).join(newline)+newline;
  if(!field.frontmatter && path)replacement='---'+newline+replacement+'---'+newline;
  const result=text.slice(0,field.from)+replacement+text.slice(field.to);
  return {text:result,from:field.from,to:field.to,replacement,path,guard:captureMapPath(result)};
}

export async function readMapPathDocument(app,definition){
  if(!definition)return {path:null,document:null};
  const metadata=validateMapPath(definition);
  if(!metadata.source)return {path:metadata,document:null};
  const file=app.vault.getAbstractFileByPath(metadata.source);
  if(!file || file.stat?.size>2_000_000)throw new Error('Path geometry missing or too large: '+metadata.source);
  const text=await app.vault.read(file);
  if(text.length>2_000_000)throw new Error('Path geometry is too large: '+metadata.source);
  const data=validateMapPathGeometry(JSON.parse(text));
  return {path:resolveMapPath(metadata,data),document:{source:metadata.source,text,data}};
}

async function ensurePathFolder(app){
  for(const folder of ['_maps','_maps/paths'])if(!app.vault.getAbstractFileByPath(folder)){
    try{await app.vault.createFolder(folder);}catch(error){if(!app.vault.getAbstractFileByPath(folder))throw error;}
  }
}

// Save geometry first, then attach/update its note reference. Existing files use
// compare-and-swap and a guarded rollback if the note transaction fails. New
// files survive an attachment failure as a recoverable, explicitly named draft.
export async function saveMapPathNote(app,session,value,{isOpen=()=>true}={}){
  const check=()=>{if(!isOpen())throw new Error('The map editor closed before saving.');};
  check();
  const current=await readMapNote(app,session.path);check();
  patchMapPath(current,session.guard,value); // Preflight before any geometry writes.
  if(value===null)return writeMapNote(app,session.path,text=>{check();return patchMapPath(text,session.guard,null);});
  const path=resolveMapPath(value),document=session.document;
  if(document){
    const file=app.vault.getAbstractFileByPath(document.source);
    if(!file || await app.vault.read(file)!==document.text)throw new Error('Path geometry changed or was removed. Cancel and choose the note again; your draft is retained.');
    check();
  }
  const shared=document && app.vault.getMarkdownFiles().some(file=>file.path!==session.path && app.metadataCache.getFileCache(file)?.frontmatter?.mapPath?.source===document.source);
  const existing=shared?null:document;
  const source=existing?.source??'_maps/paths/'+session.path.split('/').at(-1).replace(/\.md$/i,'').replace(/[^a-zA-Z0-9_-]+/g,'-').slice(0,64)+'-'+crypto.randomUUID()+'.map-path.json';
  const data={version:1,points:path.points};
  const text=existing && JSON.stringify(existing.data)===JSON.stringify(data)?existing.text:pathGeometryText(data);
  const metadata={kind:path.kind,importance:path.importance,source};
  let changed=false,created=false;
  try{
    if(existing){
      const file=app.vault.getAbstractFileByPath(source);
      if(!file)throw new Error('Path geometry was removed. Cancel and choose the note again.');
      await app.vault.process(file,current=>{
        check();if(current!==existing.text)throw new Error('Path geometry changed. Cancel and choose the note again; your draft is retained.');
        changed=text!==existing.text;return text;
      });
    }else{
      await ensurePathFolder(app);check();await app.vault.create(source,text);created=true;
    }
    check();
    const result=await writeMapNote(app,session.path,text=>{check();return patchMapPath(text,session.guard,metadata);});
    return {...result,path,document:{source,text,data}};
  }catch(error){
    if(changed){
      try{
        const file=app.vault.getAbstractFileByPath(source);if(!file)throw new Error('Missing');
        await app.vault.process(file,current=>{if(current!==text && current!==existing.text)throw new Error('Changed again');return existing.text;});
      }catch{throw new Error(error.message+' Could not restore geometry because it changed again; inspect '+source+'. Your draft is retained.');}
    }
    if(created)throw new Error(error.message+' The geometry remains at '+source+' for recovery; your draft is retained.');
    throw error;
  }
}
