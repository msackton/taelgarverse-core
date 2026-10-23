import path from 'node:path';
import MarkdownIt from 'markdown-it';
import YAML from 'yaml';

const parser=new MarkdownIt();
const cleanPath=value=>path.posix.normalize(value).replace(/^\/+|\/+$/g,'');
const stripSubpath=value=>value.split('#')[0];

// This is deliberately a small, measurable CachedMetadata adapter, not a claim
// to implement Obsidian's Markdown parser or filename-disambiguation rules.
export function cachedMetadata(source) {
  const lines=source.split('\n'),offsets=[];
  let offset=0;for(const line of lines){offsets.push(offset);offset+=line.length+1;}
  const point=(line,col=0)=>({line,col,offset:(offsets[line] ?? source.length)+col});
  const position=(start,end)=>({start:point(start),end:point(Math.max(start,end-1),(lines[Math.max(start,end-1)] || '').replace(/\r$/,'').length)});
  // Obsidian's metadata index includes wiki links inside %% comments, even
  // though Reading View hides that prose. Keep them for Dataview parity.
  let masked=source;
  const metadata={sections:[],headings:[],listItems:[],tags:[],links:[],embeds:[],frontmatterLinks:[]};
  if(/^\uFEFF?---\r?\n/.test(source)) {
    let end=1;while(end<lines.length && !/^(---|\.\.\.)\s*$/.test(lines[end]))end++;
    if(end===lines.length)throw new Error('Unclosed YAML frontmatter.');
    const document=YAML.parseDocument(lines.slice(1,end).join('\n'),{uniqueKeys:false});
    if(document.errors.length)throw new Error(document.errors[0].message);
    metadata.frontmatter=document.toJSON() || {};
    if(typeof metadata.frontmatter!=='object' || Array.isArray(metadata.frontmatter))throw new Error('Frontmatter must be a mapping.');
    const boundary=offsets[end]+lines[end].length;
    masked=masked.slice(0,boundary).replace(/[^\n]/g,' ')+masked.slice(boundary);
    const visit=(value,key)=>{
      if(typeof value==='string')for(const match of value.matchAll(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g))metadata.frontmatterLinks.push({key,link:match[1],displayText:match[2] ?? match[1]});
      else if(Array.isArray(value))value.forEach((v,i)=>visit(v,key+'.'+i));
      else if(value && typeof value==='object')for(const [k,v] of Object.entries(value))visit(v,key?key+'.'+k:k);
    };
    visit(metadata.frontmatter,'');
  }
  const tokens=parser.parse(masked,{}),parents=[];
  let searchable=masked.split('\n');
  for(let i=0;i<tokens.length;i++) {
    const token=tokens[i],map=token.map;
    if(['fence','code_block','html_block'].includes(token.type) && map)for(let n=map[0];n<map[1];n++)searchable[n]=' '.repeat(searchable[n].length);
    if(map && ['paragraph_open','heading_open','bullet_list_open','ordered_list_open'].includes(token.type)) {
      metadata.sections.push({type:token.type.includes('list')?'list':token.type==='heading_open'?'heading':'paragraph',position:position(...map)});
    }
    if(token.type==='heading_open')metadata.headings.push({heading:tokens[i+1].content,level:Number(token.tag.slice(1)),position:position(...map)});
    if(token.type==='list_item_open') {
      const first=lines[map[0]],task=first.match(/^[\s>]*(?:[-+*]|\d+[.)])\s+\[(.)?\]/);
      const item={position:position(...map),parent:parents.at(-1) ?? -1};
      if(task)item.task=task[1] ?? '';
      const block=first.match(/\s\^([\w-]+)\s*$/);if(block)item.id=block[1];
      metadata.listItems.push(item);parents.push(map[0]);
    } else if(token.type==='list_item_close')parents.pop();
  }
  // Link/tag extraction skips code and frontmatter. Inline backticks
  // are masked separately so their offsets still refer to the original file.
  searchable=searchable.map(line=>line.replace(/(`+)(.*?)\1/g,m=>' '.repeat(m.length)));
  for(let line=0;line<searchable.length;line++) {
    const text=searchable[line];
    const linkPosition=match=>({start:point(line,match.index),end:point(line,match.index+match[0].length)});
    for(const match of text.matchAll(/(!?)\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g)) {
      if(match.index>0 && text[match.index-1]==='\\')continue;
      metadata[match[1]?'embeds':'links'].push({link:match[2],displayText:match[3] ?? match[2],original:match[0],position:linkPosition(match)});
    }
    for(const match of text.matchAll(/(!?)\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      if(/^[\w+.-]+:/.test(match[3]))continue;
      let target=match[3];try{target=decodeURIComponent(target);}catch{}
      metadata[match[1]?'embeds':'links'].push({link:target,displayText:match[2],original:match[0],position:linkPosition(match)});
    }
    for(const match of text.matchAll(/(?:^|\s)(#[\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu))metadata.tags.push({tag:match[1],position:linkPosition(match)});
  }
  return metadata;
}

export function resolver(files,{resolutions=[],strict=false}={}) {
  const names=files.map(file=>typeof file==='string'?file:file.path);
  const all=new Set(names),folded=new Map(names.map(name=>[name.toLocaleLowerCase(),name]));
  const suffixes=new Map();
  for(const name of names) {
    const parts=name.toLocaleLowerCase().split('/');
    for(let i=1;i<parts.length;i++) {
      const suffix=parts.slice(i).join('/');
      for(const key of new Set([suffix,suffix.replace(/\.md$/i,'')])) {
        if(!suffixes.has(key))suffixes.set(key,[]);suffixes.get(key).push(name);
      }
    }
  }
  const captured=new Map(resolutions.map(([origin,target,dest])=>[JSON.stringify([origin,target]),dest]));
  const ambiguities=new Map(),missing=new Set(),memo=new Map();
  function resolve(target,origin='') {
    const key=JSON.stringify([origin,target]);
    if(captured.has(key)){const dest=captured.get(key);return dest?{path:dest}:null;}
    if(strict){missing.add(key);throw new Error('Uncaptured link resolution: '+key);}
    if(memo.has(key))return memo.get(key);
    let raw=stripSubpath(target).replace(/\\/g,'/');
    if(!raw)return origin?{path:origin}:null;
    try{raw=decodeURIComponent(raw);}catch{}
    const candidatesFor=value=>{const clean=cleanPath(value);return [clean,clean+'.md'].map(v=>all.has(v)?v:folded.get(v.toLocaleLowerCase())).find(Boolean);};
    const local=candidatesFor(path.posix.join(path.posix.dirname(origin),raw));
    if(local && !raw.startsWith('/'))return {path:local};
    const direct=candidatesFor(raw);if(direct)return {path:direct};
    const suffix=cleanPath(raw).toLocaleLowerCase();
    const candidates=[...(suffixes.get(suffix) || [])];
    const folder=path.posix.dirname(origin).split('/');
    const score=name=>{const parts=name.split('/');let common=0;while(common<folder.length && parts[common]===folder[common])common++;return (folder.length-common)+(parts.length-1-common);};
    candidates.sort((a,b)=>score(a)-score(b) || a.localeCompare(b));
    if(candidates.length>1)ambiguities.set(key,{target,origin,candidates});
    const result=candidates.length?{path:candidates[0]}:null;memo.set(key,result);return result;
  }
  return {resolve,ambiguities,missing};
}

export function createIndex(engine,files,{resolutions,strict=false,resolvedLinks,starred=[]}={}) {
  const links=resolver(files,{resolutions,strict});
  const names=files.map(f=>typeof f==='string'?f:f.path),all=new Set(names),folders=new Set(['']);
  for(const file of names){let folder=path.posix.dirname(file);while(folder!=='.'){folders.add(folder);folder=path.posix.dirname(folder);}}
  const prefix={
    nodeExists:folder=>folders.has(folder.replace(/^\/|\/$/g,'')),
    pathExists:file=>all.has(file),
    get:(folder,filter)=>new Set(names.filter(n=>(!folder || n.startsWith(folder+'/')) && (!filter || filter(n)))),
    resolveRelative:(file,origin)=>all.has(path.posix.join(path.posix.dirname(origin),file))?path.posix.join(path.posix.dirname(origin),file):file,
  };
  const metadataCache={getFirstLinkpathDest:links.resolve,resolvedLinks:resolvedLinks || {}};
  const marked=new Set(starred);
  const index={pages:new Map(),tags:new engine.ValueCaseInsensitiveIndexMap(),etags:new engine.ValueCaseInsensitiveIndexMap(),
    links:new engine.IndexMap(),starred:{starred:file=>marked.has(file)},prefix,metadataCache,
    vault:{getMarkdownFiles:()=>names.filter(n=>/\.md$/i.test(n)).map(path=>({path}))}};
  index.csv={get:async()=>{throw new Error('CSV sources are outside this experimental harness.');}};
  function add(page,{canonicalize=false}={}) {
    if(canonicalize)page=engine.PageMetadata.canonicalize(page,link=>{const dest=links.resolve(link.path,page.path);return dest?link.withPath(dest.path):link;});
    else page=new engine.PageMetadata(page.path,page);
    index.pages.set(page.path,page);index.tags.set(page.path,page.fullTags());index.etags.set(page.path,page.tags);
    index.links.set(page.path,new Set(page.links.map(l=>l.path)));
    if(!resolvedLinks)metadataCache.resolvedLinks[page.path]=Object.fromEntries(page.links.filter(l=>all.has(l.path)).map(l=>[l.path,1]));
  }
  const settings={...engine.DEFAULT_SETTINGS};
  const api=new engine.DataviewApi({metadataCache,vault:index.vault},index,settings,'0.5.68');
  return {index,api,add,links};
}

export function restoreIndexTables(index,tables) {
  for(const [target,table] of [[index.tags.delegate,tables.tags],[index.etags.delegate,tables.etags],[index.links,tables.links]]) {
    target.map=table.map;target.invMap=table.invMap;
  }
}
