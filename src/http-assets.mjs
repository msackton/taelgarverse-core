export const themeFiles = {'material.css':'vendor/material.css','taelgarverse.css':'taelgarverse.css','preview.css':'preview.css','release.js':'release.js','context.js':'context.js','navigation.js':'navigation.js','image-viewer.js':'image-viewer.js','diagrams.js':'generated/diagrams.js'};
export const contentTypes = {'.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg',
  '.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.pdf':'application/pdf','.heic':'image/heic',
  '.mp3':'audio/mpeg','.m4a':'audio/mp4','.wav':'audio/wav','.ogg':'audio/ogg','.flac':'audio/flac'};

export async function serveAsset(request,entry,read) {
  const headers=new Headers({'Content-Type':contentTypes[entry.extension] || 'application/octet-stream','Accept-Ranges':'bytes',
    'Cache-Control':'public, max-age=0, must-revalidate',ETag:entry.etag});
  const condition=request.headers.get('If-None-Match');
  if (condition && (condition==='*' || condition.split(',').map(s=>s.trim().replace(/^W\//,'')).includes(entry.etag))) return new Response(null,{status:304,headers});
  let start=0,end=entry.size-1,status=200;
  const range=request.headers.get('Range'), ifRange=request.headers.get('If-Range');
  if (range && (!ifRange || ifRange===entry.etag)) {
    const match=/^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) start=NaN;
    else if (match[1]) {start=Number(match[1]);if(match[2])end=Math.min(Number(match[2]),end);}
    else start=Math.max(0,entry.size-Number(match[2]));
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start>end || start>=entry.size) {
      headers.set('Content-Range','bytes */'+entry.size);
      headers.set('Content-Type','application/json');
      return new Response(JSON.stringify({detail:'Unsatisfiable byte range'}),{status:416,headers});
    }
    status=206;headers.set('Content-Range','bytes '+start+'-'+end+'/'+entry.size);
  }
  const length=Math.max(0,end-start+1);
  headers.set('Content-Length',String(length));
  const body=request.method==='HEAD' || !length ? null : await read({offset:start,length});
  return new Response(body,{status,headers});
}
