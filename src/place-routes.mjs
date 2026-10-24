import {parseDocument} from 'yaml';
import {filterComments} from './comments.mjs';
import {placeAppearance} from './place-appearance.mjs';

export const isRoutePlace=node=>node?.type==='place'&&['road','river'].includes(placeAppearance(node).kind);

// Only explicit typed map features establish physical connections. Coordinates
// are optional; prose mentions and the order of entries do not establish a route.
export function routeConnections(source) {
  const blank=text=>text.replace(/[^\n]/g,' ');
  const text=String(source).replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/,blank)
    .replace(/<!--[\s\S]*?-->/g,blank);
  const spans=[];filterComments(text,{spans,date:'9999-12-31'});
  const result=[];
  for(const span of spans.filter(s=>/^Metadata:map:v1$/i.test(s.marker??''))){
    const body=text.slice(span.bodyStart,span.bodyEnd);
    if(body.length>262144)throw new Error('Map metadata block is too large');
    const document=parseDocument(body);
    if(document.errors.length)throw new Error('Invalid map metadata: '+document.errors[0].message);
    const metadata=document.toJS({maxAliasCount:50});
    if(metadata?.locations===undefined)continue;
    if(!Array.isArray(metadata.locations))throw new Error('Map metadata locations must be a list');
    const line=text.slice(0,span.start).split('\n').length-1;
    for(const entry of metadata.locations){
      if(!entry||typeof entry.feature!=='string'||!entry.feature.trim())continue;
      const target=entry.feature.trim(),role=typeof entry.role==='string'?entry.role.trim():'endpoint';
      result.push({target,role,line,excerpt:(role||'endpoint')+': '+target});
    }
  }
  return result;
}
