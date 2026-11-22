import {campaignDefinitions} from './campaign-blocks.mjs';
import {buildCampaignRecord,discoverCampaignSessionNotes} from './campaign-records.mjs';
import {ContentStore,parseNote} from './content-store.mjs';

export function isCampaignSourcePath(path) {
  return !path.startsWith('_sessions/') &&
    !path.split('/').some(part=>part.startsWith('.') || part==='_generated');
}

export function campaignSourceEntry(path,metadata) {
  const name=path.split('/').at(-1).replace(/\.md$/i,'');
  return {id:path,slug:path,target:path,name,note:{metadata}};
}

export function campaignForBlock(indexes,sourcePath,options) {
  const owner=Object.keys(indexes).find(id=>indexes[id]===sourcePath);
  const campaign=options.campaign || owner;
  if(!campaign) throw new Error('Set campaign on a note outside the registered campaign index.');
  if(!Object.hasOwn(indexes,campaign)) throw new Error('Unknown campaign '+campaign+'.');
  if(owner && owner!==campaign) throw new Error('The '+owner+' index can only define its own campaign.');
  if(owner!==campaign && (options.overrides!==undefined || options.estimate!==undefined))
    throw new Error('Put overrides and estimates on the registered campaign index.');
  return campaign;
}

export function createCampaignSource({indexes,registry,entries,readNote,readBundles}) {
  const records=new Map();
  let noteIndex;
  const read=async path=>({path,body:parseNote(await readNote(path)).body});
  async function build(campaign) {
    if(!noteIndex) {
      // Obsidian's metadata cache and the filesystem enumerate files differently.
      // Keep roster and evidence order independent of the host.
      const ordered=[...entries()].sort((a,b)=>a.id<b.id ? -1 : a.id>b.id ? 1 : 0);
      const store=new ContentStore(ordered);
      noteIndex={store,sessionNotes:discoverCampaignSessionNotes(store,registry)};
    }
    const {store,sessionNotes}=noteIndex;
    const indexPath=indexes[campaign];
    const [[index,...arcNotes],bundles]=await Promise.all([
      Promise.all([indexPath,...(sessionNotes.arcs.get(campaign) || [])].map(read)),
      readBundles?.(campaign),
    ]);
    return buildCampaignRecord({campaign,indexPath,registry,store,sessionNotes,arcNotes,
      definitions:campaignDefinitions(index.body,campaign),...bundles});
  }
  return {
    indexes,
    load(campaign) {
      if(!records.has(campaign)) {
        const pending=build(campaign);
        records.set(campaign,pending);
        pending.catch(()=>{if(records.get(campaign)===pending) records.delete(campaign);});
      }
      return records.get(campaign);
    },
  };
}
