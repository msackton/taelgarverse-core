// Node-only reader. The Worker receives the compiled projection, never files
// from _sessions or the full structured recap/transcript.
import fs from 'node:fs';
import path from 'node:path';

function section(text,heading) {
  const lines=text.split('\n'),start=lines.findIndex(line=>line.trim()===heading);
  if(start<0)return '';
  const next=lines.findIndex((line,i)=>i>start && /^## /.test(line));
  return lines.slice(start+1,next<0 ? undefined : next).join('\n');
}
function fields(text) {return Object.fromEntries([...text.matchAll(/^- ([^:\n]+):\s*(.*)$/gm)].map(match=>[match[1],match[2].trim()]));}
function names(value) {
  if (!value || /^(none|unknown)$/i.test(value)) return [];
  return (value.match(/\[\[[^\]]+\]\]|[^,]+/g) || []).map(item=>item.trim()).filter(Boolean);
}
function dates(value) {
  const match=/^(\d{4}-\d{2}-\d{2})(?:\s+(?:to|->|–)\s+(\d{4}-\d{2}-\d{2}))?\s*$/.exec(value || '');
  return {date:match?.[1] || null,end:match?.[2] || null};
}
export function parseSessionRecap(text,key='<recap>') {
  text=text.replace(/\r\n?/g,'\n');
  const header=fields(section(text,'## Session Header'));
  const body=section(text,'## Recap'), scenes=[];
  for (const match of body.matchAll(/^###\s+(recap-[\w-]+)\s*\|\s*(.+)\n([\s\S]*?)(?=^### |$(?![\s\S]))/gm)) {
    const metadata=fields(match[3]);
    const prose=heading=>new RegExp('^#### '+heading+'\\s*\\n([\\s\\S]*?)(?=^#### |$(?![\\s\\S]))','m').exec(match[3])?.[1].trim() || '';
    scenes.push({id:match[1],title:match[2].trim(),...dates(metadata.Date),
      people:names(metadata.NPCs),location:metadata.Locations || '',short:prose('Short')});
  }
  if (!header.Campaign || !header['Session Number']) throw new Error('Recap has no campaign/session identity');
  return {key,campaign:header.Campaign,number:header['Session Number'],title:header['Desc Title'] || header.Title || '',...dates(header['DR Date']),scenes};
}
export function readSessionRecaps(settings) {
  if (!settings.vault_dir) return [];
  const root=path.join(settings.vault_dir,'_sessions'),files=[];
  function directories(directory) {
    if(!fs.existsSync(directory))return [];
    return fs.readdirSync(directory,{withFileTypes:true}).filter(entry=>entry.isDirectory()&&!entry.isSymbolicLink()).sort((a,b)=>a.name.localeCompare(b.name));
  }
  for (const campaign of directories(root)) for (const session of directories(path.join(root,campaign.name))) {
    const cleaned=path.join(root,campaign.name,session.name,'cleaned');
    if (!fs.existsSync(cleaned) || fs.lstatSync(cleaned).isSymbolicLink()) continue;
    for (const file of fs.readdirSync(cleaned,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      if (!file.isFile() || !file.name.endsWith('-session-recap.md')) continue;
      const filename=path.join(cleaned,file.name);
      if (fs.statSync(filename).size>8*1024*1024) throw new Error('Session recap is too large: '+file.name);
      files.push({key:path.relative(settings.vault_dir,filename).split(path.sep).join('/'),text:fs.readFileSync(filename,'utf8').replace(/\r\n?/g,'\n')});
    }
  }
  return files;
}
export function readInteractionBundles(settings) {
  const bundles=[],warnings=[];
  for (const {key,text} of readSessionRecaps(settings)) {
    try {bundles.push(parseSessionRecap(text,key));}catch(error){warnings.push(key+': '+error.message);}
  }
  return {bundles,warnings};
}
