// A disposable build hint, never an authority for published content or retention.
export const DERIVATIVE_MANIFEST_KEY='build-cache/derivatives-v1.json';
const hashPattern=/^[a-f0-9]{64}$/;
const positive=value=>Number.isSafeInteger(value) && value>0;

export function validRecord(id,record){
  const [kind,key]=id.split('/');
  if(!['images','maps'].includes(kind) || id!==kind+'/'+key || !hashPattern.test(key || '') || !record || !Array.isArray(record.outputs) || !record.outputs.length)return false;
  const prefix=(kind==='images'?'image-variants/':'map-tiles/')+key+'/';
  const targets=new Set();
  return record.outputs.every(output=>{
    if(typeof output?.target!=='string' || !output.target.startsWith(prefix) ||
      !(kind==='images'?/^\d+\.webp$/:/^-?\d+\/\d+\/\d+\.webp$/).test(output.target.slice(prefix.length)) ||
      !/^assets\/[a-f0-9]{64}$/.test(output.key || '') || !positive(output.size) || targets.has(output.target))return false;
    targets.add(output.target);return true;
  });
}

export function manifestRecords(value){
  if(value?.schemaVersion!==1 || !value.records || typeof value.records!=='object' || Array.isArray(value.records))return {};
  return Object.fromEntries(Object.entries(value.records).filter(([id,record])=>validRecord(id,record)));
}

export async function readDerivativeManifest(storage){
  try{return manifestRecords(await storage.getJSON(DERIVATIVE_MANIFEST_KEY));}
  catch(error){if(error instanceof SyntaxError)return {};throw error;}
}

export class DerivativeCache {
  constructor(records={},inventory=new Map()){
    this.records=records;this.inventory=inventory;this.used=new Map();this.hits={images:0,maps:0};
  }
  static async load(storage){
    const records=await readDerivativeManifest(storage);
    const inventory=new Map(Object.keys(records).length?(await storage.list('assets/')).map(o=>[o.key,o.size]):[]);
    return new DerivativeCache(records,inventory);
  }
  get(kind,key,validate){
    const record=this.records[kind+'/'+key];
    if(!validRecord(kind+'/'+key,record) || !record.outputs.every(o=>this.inventory.get(o.key)===o.size) || !validate(record))return null;
    this.hits[kind]++;return record;
  }
  record(kind,key,data,targets){this.used.set(kind+'/'+key,{data,targets});}
  manifest(entries){
    const assets=new Map(entries.filter(e=>!e.note).map(e=>[e.target,e]));
    const records={};
    for(const [id,{data,targets}] of this.used){
      const outputs=targets.map(target=>{const asset=assets.get(target);return {target,key:asset?.objectKey,size:asset?.size};});
      const record={data,outputs};
      if(!validRecord(id,record))throw new Error('Invalid generated derivative record: '+id);
      records[id]=record;
    }
    return {schemaVersion:1,records};
  }
}

// Called under the publication lock, only after every asset upload succeeds.
// Drop stale hints without pinning the assets they used to reference.
export async function saveDerivativeManifest(storage,manifest,inventory){
  const records={...await readDerivativeManifest(storage),...manifestRecords(manifest)};
  for(const [id,record] of Object.entries(records))if(!record.outputs.every(o=>inventory.get(o.key)===o.size))delete records[id];
  await storage.putDerivativeManifest({schemaVersion:1,records});
}
