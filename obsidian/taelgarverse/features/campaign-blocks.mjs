import {Component,MarkdownRenderChild} from 'obsidian';
import {campaignFences,parseCampaignBlock} from '../../../src/campaign-blocks.mjs';
import {campaignForBlock,campaignSourceEntry,createCampaignSource,isCampaignSourcePath} from '../../../src/campaign-source.mjs';
import {renderCampaignView} from '../../../src/campaign-view.mjs';
import {readCampaignSessionBundles} from '../../../src/vault-campaign-sessions.mjs';
import {escapeHtml as escape} from '../../../src/common.mjs';
import {obsidianInternalLink,mountObsidianInternalLinks} from '../services/internal-links.mjs';

function noteEntries(app) {
  return app.vault.getMarkdownFiles().filter(file=>isCampaignSourcePath(file.path))
    .map(file=>campaignSourceEntry(file.path,app.metadataCache.getFileCache(file)?.frontmatter || {}));
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
    this.source=null;
    for(const child of this.childrenRendered) child.sequence++;
    clearTimeout(this.timer);
    this.timer=setTimeout(()=>{
      for(const child of this.childrenRendered) void child.render();
    },100);
  }

  async record(sourcePath,options) {
    const snapshot=await this.plugin.snapshots.getSnapshot();
    const indexes=snapshot.campaignIndex,registry=snapshot.campaignRegistry;
    const campaign=campaignForBlock(indexes,sourcePath,options);
    if(this.source?.snapshot!==snapshot) {
      this.source={snapshot,...createCampaignSource({
        indexes,registry,entries:()=>noteEntries(this.app),
        readNote:path=>{
          this.sources.add(path);
          const file=this.app.vault.getAbstractFileByPath(path);
          if(!file) throw new Error('Missing campaign source '+path+'.');
          return this.app.vault.cachedRead(file);
        },
        readBundles:campaign=>{
          const directory=registry.campaigns[campaign].sessionBundleDirectory;
          const root=this.app.vault.adapter.getBasePath?.();
          if(directory) this.bundleDirectories.add(directory);
          if(root && directory) return readCampaignSessionBundles(root,registry,campaign);
        },
      })};
    }
    return this.source.load(campaign);
  }

  onunload() {
    clearTimeout(this.timer);
    for(const child of this.childrenRendered) child.unload();
    this.source=null;
  }
}
