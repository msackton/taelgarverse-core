import {RenderError} from './common.mjs';
import {runtimeHash,validRuntimeDescriptor} from './runtime-format.mjs';

const failure=()=>new RenderError(503,'Campaign record snapshot is invalid');
const campaignFile=campaign=>'runtime/campaigns/'+campaign+'.json';

export async function compileCampaignSnapshots(source) {
  const descriptors={},objects=new Map();
  for(const [campaign,indexPath] of Object.entries(source.indexes)) {
    let record;
    try { record=await source.load(campaign); }
    catch(error) {
      descriptors[campaign]={indexPath,error:error.message};
      continue;
    }
    // Session rows can be referenced by several players on the roster.
    const roster=record.roster.map(player=>({...player,attendance:player.attendance.map(session=>session.key)}));
    const json=JSON.stringify({...record,roster});
    const file=campaignFile(campaign);
    descriptors[campaign]={indexPath,file,sha256:runtimeHash(json)};
    objects.set(file,json);
  }
  return {descriptors,objects};
}

export function campaignSnapshotEntries(descriptors) {
  if(descriptors===undefined) return [];
  if(!descriptors || typeof descriptors!=='object' || Array.isArray(descriptors)) throw failure();
  const entries=Object.entries(descriptors);
  for(const [campaign,descriptor] of entries) {
    if(!/^[a-z][a-z0-9]*$/.test(campaign) || typeof descriptor?.indexPath!=='string') throw failure();
    if(descriptor.error!==undefined) {
      if(typeof descriptor.error!=='string' || descriptor.file!==undefined) throw failure();
    } else if(!validRuntimeDescriptor(descriptor) || descriptor.file!==campaignFile(campaign)) {
      throw failure();
    }
  }
  return entries;
}

export function snapshotCampaignSource(descriptors,read) {
  if(descriptors===undefined) return undefined;
  const indexes=Object.fromEntries(campaignSnapshotEntries(descriptors).map(([campaign,descriptor])=>[campaign,descriptor.indexPath]));
  return {indexes,async load(campaign) {
    const descriptor=descriptors[campaign];
    if(descriptor.error!==undefined) throw new Error(descriptor.error);
    const record=await read(descriptor);
    if(record?.campaign!==campaign || record.indexPath!==descriptor.indexPath ||
      !Array.isArray(record.sessions) || !Array.isArray(record.roster)) throw failure();
    const sessions=new Map(record.sessions.map(session=>[session.key,session]));
    const roster=record.roster.map(player=>{
      if(!Array.isArray(player.attendance)) throw failure();
      const attendance=player.attendance.map(key=>sessions.get(key));
      if(attendance.some(session=>!session)) throw failure();
      return {...player,attendance};
    });
    return {...record,roster};
  }};
}
