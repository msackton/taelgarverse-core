// Shared by the Node runner and the temporary Obsidian capture script.
// Tagged arrays avoid collisions with authored frontmatter object keys.
export function encode(value) {
  if(value===undefined)return ['undefined'];
  if(value===null || typeof value==='string' || typeof value==='boolean')return value;
  if(typeof value==='number')return Number.isFinite(value)?value:['number',String(value)];
  if(value.isLuxonDateTime)return ['date',value.toISO(),value.zoneName];
  if(value.isLuxonDuration)return ['duration',encode(value.toObject())];
  if(typeof value.withPath==='function' && typeof value.toObject==='function')return ['link',encode(value.toObject())];
  const kind=Object.prototype.toString.call(value);
  if(kind==='[object Map]')return ['map',[...value].map(([k,v])=>[encode(k),encode(v)])];
  if(kind==='[object Set]')return ['set',[...value].map(encode)];
  if(Array.isArray(value))return ['array',value.map(encode)];
  if(typeof value==='object')return ['object',Object.keys(value).sort().map(k=>[k,encode(value[k])])];
  throw new Error('Unsupported Dataview value: '+typeof value);
}

export function decode(value,engine) {
  if(!Array.isArray(value))return value;
  const [kind,data,zone]=value;
  switch(kind) {
    case 'undefined':return undefined;
    case 'number':return Number(data);
    case 'date':return engine.DateTime.fromISO(data,{zone});
    case 'duration':return engine.Duration.fromObject(decode(data,engine));
    case 'link':return engine.Link.fromObject(decode(data,engine));
    case 'array':return data.map(v=>decode(v,engine));
    case 'map':return new Map(data.map(([k,v])=>[decode(k,engine),decode(v,engine)]));
    case 'set':return new Set(data.map(v=>decode(v,engine)));
    case 'object':return Object.fromEntries(data.map(([k,v])=>[k,decode(v,engine)]));
    default:throw new Error('Unknown encoded Dataview type: '+kind);
  }
}

export async function evaluate(api,queries) {
  const results=[];
  for(const query of queries) {
    const started=performance.now();
    try {
      const result=await api.tryQuery(query.query,query.sourcePath);
      const markdown=await api.tryQueryMarkdown(query.query,query.sourcePath);
      results.push({id:query.id,status:'ok',result:encode(result),markdown,
        rows:result.values?.length ?? undefined,elapsedMs:performance.now()-started});
    } catch(error) {
      results.push({id:query.id,status:'error',message:String(error.message ?? error),elapsedMs:performance.now()-started});
    }
  }
  return results;
}

function firstDifference(left,right,at='$') {
  if(Object.is(left,right))return null;
  if(!left || !right || typeof left!=='object' || typeof right!=='object')return {at,left,right};
  if(Array.isArray(left)!==Array.isArray(right))return {at,left,right};
  const keys=[...new Set([...Object.keys(left),...Object.keys(right)])].sort();
  for(const key of keys) {
    if(!Object.hasOwn(left,key) || !Object.hasOwn(right,key))return {at:at+'.'+key,left:left[key],right:right[key]};
    const diff=firstDifference(left[key],right[key],at+'.'+key);if(diff)return diff;
  }
  return null;
}

function readable(value) {
  if(!Array.isArray(value))return value;
  const [kind,data,extra]=value;
  if(kind==='object')return Object.fromEntries(data.map(([k,v])=>[k,readable(v)]));
  if(kind==='array')return data.map(readable);
  if(kind==='link')return {$type:'link',...readable(data)};
  if(kind==='date')return {$type:'date',iso:data,zone:extra};
  return {$type:kind,value:data};
}

export function compareResults(queries,left,right) {
  const index=results=>{
    const map=new Map();
    for(const result of results){if(map.has(result.id))throw new Error('Duplicate result: '+result.id);map.set(result.id,result);}
    if(map.size!==queries.length || queries.some(q=>!map.has(q.id)))throw new Error('Result corpus is incomplete or contains unknown queries.');
    return map;
  };
  const a=index(left),b=index(right);
  return queries.map(q=>{
    const l=a.get(q.id),r=b.get(q.id);
    let difference;
    if(l.status!==r.status)difference={at:'$.status',left:l.status,right:r.status};
    else if(l.status==='error')difference=firstDifference(l.message,r.message,'$.message');
    else {
      const left=readable(l.result),right=readable(r.result);
      difference=firstDifference(left,right,'$.result') || firstDifference(l.markdown,r.markdown,'$.markdown');
      if(difference && Array.isArray(left.values) && Array.isArray(right.values) && firstDifference(left.values,right.values) &&
        JSON.stringify([...left.values].map(v=>JSON.stringify(v)).sort())===JSON.stringify([...right.values].map(v=>JSON.stringify(v)).sort()) &&
        !firstDifference({...left,values:[]},{...right,values:[]}))difference.kind='row-order';
    }
    return {id:q.id,sourcePath:q.sourcePath,line:q.line,category:q.category,
      outcome:difference?'different':l.status==='error'?'matching-error':l.rows===0?'matching-empty':'matching',
      leftRows:l.rows,rightRows:r.rows,...(difference?{difference}:{})};
  });
}
