import {Component,MarkdownRenderChild} from 'obsidian';
import {campaignFences,campaignDefinitions,parseCampaignBlock} from '../../../src/campaign-blocks.mjs';
import {buildCampaignRecord,discoverCampaignSessionNotes} from '../../../src/campaign-records.mjs';
import {renderCampaignView} from '../../../src/campaign-view.mjs';
import {readCampaignSessionBundles} from '../../../src/vault-campaign-sessions.mjs';
import {ContentStore,parseNote} from '../../../src/content-store.mjs';
import {escapeHtml as escape} from '../../../src/common.mjs';
import {obsidianInternalLink,mountObsidianInternalLinks} from '../services/internal-links.mjs';

function noteEntries(app) {
  return app.vault.getMarkdownFiles().filter(file=>!file.path.startsWith('_sessions/') &&
    !file.path.split('/').some(part=>part.startsWith('.') || part==='_generated'))
    .map(file=>{
      const metadata=app.metadataCache.getFileCache(file)?.frontmatter || {};
      return {id:file.path,slug:file.path,target:file.path,name:file.basename,note:{metadata}};
    });
}

function campaignLink(target,label) {
  if(/^https?:\/\//i.test(target)) return '<a class="external-link" href="'+escape(target)+'">'+escape(label)+'</a>';
  if(/^[a-z][a-z0-9+.-]*:/i.test(target)) return escape(label);
  return obsidianInternalLink(target,label,'taelgar-campaign-link');
}

class CampaignBlockChild extends MarkdownRenderChild {
  constructor(feature,type,source,container,sourcePath) {
    super(container);
    Object.assign(this,{feature,type,source,sourcePath,sequence:0});
  }

  onload() {
    this.feature.childrenRendered.add(this);
    return this.render();
  }

  async render() {
    const sequence=++this.sequence;
    try {
      const options=parseCampaignBlock(this.type,this.source);
      const record=await this.feature.record(this.sourcePath,options);
      if(sequence!==this.sequence) return;
      this.disposeLinks?.();
      this.containerEl.innerHTML=renderCampaignView(this.type,record,options,campaignLink);
      this.disposeLinks=mountObsidianInternalLinks(this.containerEl,this.feature.app,record.indexPath,'.taelgar-campaign-link');
    } catch(error) {
      if(sequence!==this.sequence) return;
      this.disposeLinks?.();
      this.containerEl.innerHTML='<p role="status">'+escape(campaignFences[this.type]+': '+error.message)+'</p>';
    }
  }

  onunload() {
    this.sequence++;
    this.disposeLinks?.();
    this.feature.childrenRendered.delete(this);
  }
}

export class CampaignBlocksFeature extends Component {
  constructor(plugin) {
    super();
    this.plugin=plugin;
    this.app=plugin.app;
    this.childrenRendered=new Set();
    this.records=new Map();
    this.sources=new Set();
    this.bundleDirectories=new Set();
  }

  onload() {
    for(const [type,fence] of Object.entries(campaignFences)) {
      this.plugin.registerMarkdownCodeBlockProcessor(fence,(source,element,context)=>{
        context.addChild(new CampaignBlockChild(this,type,source,element,context.sourcePath));
      });
    }
    this.register(this.plugin.snapshots.subscribe(()=>this.invalidate()));
    if(this.app.vault.on) this.registerEvent(this.app.vault.on('modify',file=>{
      const path=file?.path;
      if(path && (this.sources.has(path) || [...this.bundleDirectories].some(directory=>path.startsWith(directory+'/'))))
        this.invalidate();
    }));
  }

  invalidate() {
    this.records.clear();
    this.noteIndex=null;
    for(const child of this.childrenRendered) child.sequence++;
    clearTimeout(this.timer);
    this.timer=setTimeout(()=>{
      for(const child of this.childrenRendered) void child.render();
    },100);
  }

  async record(sourcePath,options) {
    const snapshot=await this.plugin.snapshots.getSnapshot();
    const indexes=snapshot.campaignIndex,registry=snapshot.campaignRegistry;
    const owner=Object.keys(indexes).find(id=>indexes[id]===sourcePath);
    const campaign=options.campaign || owner;
    if(!campaign) throw new Error('Set campaign on a note outside the registered campaign index.');
    if(!Object.hasOwn(indexes,campaign)) throw new Error('Unknown campaign '+campaign+'.');
    if(owner && owner!==campaign) throw new Error('The '+owner+' index can only define its own campaign.');
    if(owner!==campaign && (options.overrides!==undefined || options.estimate!==undefined))
      throw new Error('Put overrides and estimates on the registered campaign index.');
    if(this.noteIndex?.snapshot!==snapshot) {
      const store=new ContentStore(noteEntries(this.app));
      this.records.clear();
      this.noteIndex={snapshot,store,sessionNotes:discoverCampaignSessionNotes(store,registry)};
    }
    if(!this.records.has(campaign)) {
      const pending=this.loadRecord(campaign,indexes[campaign],registry,this.noteIndex);
      this.records.set(campaign,pending);
      pending.catch(()=>{if(this.records.get(campaign)===pending) this.records.delete(campaign);});
    }
    return this.records.get(campaign);
  }

  async loadRecord(campaign,indexPath,registry,{store,sessionNotes}) {
    const directory=registry.campaigns[campaign].sessionBundleDirectory;
    if(directory) this.bundleDirectories.add(directory);
    const arcPaths=sessionNotes.arcs.get(campaign) || [];
    for(const path of [indexPath,...arcPaths]) this.sources.add(path);
    const read=async path=>{
      const file=this.app.vault.getAbstractFileByPath(path);
      if(!file) throw new Error('Missing campaign source '+path+'.');
      return {path,body:parseNote(await this.app.vault.cachedRead(file)).body};
    };
    const [index,...arcNotes]=await Promise.all([indexPath,...arcPaths].map(read));
    const root=this.app.vault.adapter.getBasePath?.();
    const sources=root && directory ? await readCampaignSessionBundles(root,registry,campaign) : {};
    return buildCampaignRecord({campaign,registry,indexPath,store,sessionNotes,arcNotes,
      definitions:campaignDefinitions(index.body,campaign),...sources});
  }

  onunload() {
    clearTimeout(this.timer);
    for(const child of this.childrenRendered) child.unload();
    this.records.clear();
    this.noteIndex=null;
  }
}
