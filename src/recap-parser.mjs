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
      people:names(metadata.NPCs),location:metadata.Locations || '',short:prose('Short'),transcriptPath:metadata['Polished Transcript'] || null});
  }
  if (!header.Campaign || !header['Session Number']) throw new Error('Recap has no campaign/session identity');
  return {key,campaign:header.Campaign,number:header['Session Number'],title:header['Desc Title'] || header.Title || '',...dates(header['DR Date']),scenes};
}
