function section(text,heading) {
  const lines=text.split('\n'),start=lines.findIndex(line=>line.trim()===heading);
  if(start<0)return '';
  const next=lines.findIndex((line,i)=>i>start && /^## /.test(line));
  return lines.slice(start+1,next<0 ? undefined : next).join('\n');
}
function fields(text) {return Object.fromEntries([...text.matchAll(/^- ([^:\n]+):\s*(.*)$/gm)].map(match=>[match[1],match[2].trim()]));}
function dates(value) {
  const match=/^(\d{4}-\d{2}-\d{2})(?:\s+(?:to|->|–)\s+(\d{4}-\d{2}-\d{2}))?\s*$/.exec(value || '');
  return {date:match?.[1] || null,end:match?.[2] || null};
}
export function parseSessionRecap(text,key='<recap>') {
  text=text.replace(/\r\n?/g,'\n');
  const header=fields(section(text,'## Session Header'));
  const cast=section(text,'## Cast').split(/^### NPCs\s*$/m)[1]?.split(/^### /m)[0] || '';
  const metPeople=[...cast.matchAll(/^-\s+(.+?)\s+\(([^)]+)\)\s*:/gm)]
    .filter(match=>match[2].split(',').some(status=>status.trim().toLowerCase()==='met')).map(match=>match[1].trim());
  if (!header.Campaign || !header['Session Number']) throw new Error('Recap has no campaign/session identity');
  return {key,campaign:header.Campaign,number:header['Session Number'],title:header['Desc Title'] || header.Title || '',
    tagline:header.Tagline || '',...dates(header['DR Date']),metPeople};
}
