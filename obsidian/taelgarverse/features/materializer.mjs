import LegacyMaterializer from '../materializer/legacy.cjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {obsidianHeaders,bioDate,obsidianIndex,hydrateObsidianIndex} from './headers.mjs';
import {obsidianInteractions,knownCampaigns,localInteractions} from './interaction-data.mjs';
import {renderBio} from '../../../src/header-core/index.mjs';
import {parseIndex} from '../../../src/indexes.mjs';
import {parseNote} from '../../../src/content-store.mjs';
import {leadingBioBlock,hasPrecedingH1} from '../../../src/bio-block.mjs';
import {scanFencedCodeBlocks,applyReplacements,prefixMarkdownLines} from '../../../src/markdown-fences.mjs';
import {indexMarkdown,interactionsMarkdown} from '../../../src/static-markdown.mjs';
import {DATAVIEW_EXPORT_VERSION} from '../../../src/dataview-export.mjs';

// The old static site retains its Dataview/CustomJS behavior. Native blocks are
// resolved through the same models as the desktop features before that pass.
export class MaterializerFeature extends LegacyMaterializer {
  get dataviewExportVersion(){return DATAVIEW_EXPORT_VERSION;}

  // Website mode returns DQL results without flattening native blocks or running
  // legacy JavaScript. Node owns all prepared-copy rewrites and publication.
  async exportDataview(request) {
    if(this.running)throw new Error('A Taelgarverse materialization request is already running.');
    this.running=true;
    try{return await this.plugin.exporter.runRequest(request);}
    finally{this.running=false;}
  }

  normalizeConfig(rawConfig) {
    const config=super.normalizeConfig(rawConfig);
    for(const key of ['indexRegistry','indexOverride']) {
      const value=rawConfig[key];
      if(value!==undefined && value!==null && (typeof value!=='string' || !value.trim() || value.startsWith('/') || value.includes('\\') || /^[a-z]:/i.test(value) || value.split('/').includes('..')))throw new Error(key+' must be a vault-relative path.');
      config[key]=value;
    }
    return config;
  }
  async runMaterialization(rawConfig) {
    const config=this.normalizeConfig(rawConfig);
    if(config.outputPath) {
      const source=await fs.realpath(config.vaultPath);
      let existing=config.outputPath,suffix=[];
      for(;;) {
        try{existing=await fs.realpath(existing);break;}
        catch(error){if(error.code!=='ENOENT')throw error;suffix.unshift(path.basename(existing));const parent=path.dirname(existing);if(parent===existing)throw error;existing=parent;}
      }
      const output=path.join(existing,...suffix),relative=path.relative(source,output),reverse=path.relative(output,source);
      const inside=value=>value==='' || (!value.startsWith('..'+path.sep) && value!=='..' && !path.isAbsolute(value));
      if(output===path.parse(output).root || inside(relative) || inside(reverse))throw new Error('Static output must be outside the vault and cannot contain the vault or be a filesystem root.');
      const inspect=async directory=>{
        let entries;try{entries=await fs.readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
        for(const entry of entries){if(entry.isSymbolicLink())throw new Error('Static output cannot contain symlinks.');if(entry.isDirectory())await inspect(path.join(directory,entry.name));}
      };
      await inspect(config.outputPath);
    }
    return super.runMaterialization(rawConfig);
  }

  async prepareRuntime(config) {
    const runtime=await super.prepareRuntime(config);
    runtime.headers=()=>runtime.headerSnapshot ??= obsidianHeaders(this.app,{indexRegistry:config.indexRegistry,indexOverride:config.indexOverride},'website');
    runtime.interactions=()=>runtime.interactionSnapshot ??= obsidianInteractions(this.app);
    return runtime;
  }

  async materializeMarkdown(original,file,runtime,core,config) {
    const replacements=[],issues=[];let nativeHeader=false,nativeBlocks=0,maps=0;
    const metadata=parseNote(original).metadata;
    const frontmatter=/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(original);
    const bodyStart=frontmatter?.[0].length || 0,leading=leadingBioBlock(original.slice(bodyStart));
    for(const block of scanFencedCodeBlocks(original)) {
      if(!['taelgar-header','taelgar-index','taelgar-interactions','taelgar-map'].includes(block.language))continue;
      if(block.language==='taelgar-header')nativeHeader=true;
      try {
        if(!block.closed)throw new Error('Unclosed '+block.language+' block.');
        let markdown;
        if(block.language==='taelgar-map') {
          const text=original.slice(block.start,block.end).replace(/^([ \t>]*[`~]{3,})taelgar-map\b/i,'$1leaflet');
          replacements.push({start:block.start,end:block.end,text});maps++;continue;
        } else {
          const snapshot=await runtime.headers(),date=config.overrideDate || bioDate(metadata,globalThis,snapshot.fallback);
          if(block.language==='taelgar-header') {
            if(block.body.trim())throw new Error('Leave the taelgar-header block empty.');
            const includeTitle=block.quoteDepth>0 || !hasPrecedingH1(original.slice(bodyStart),block.start-bodyStart);
            const headerType=config.headerType==='website'?'website':'static';
            markdown=renderBio(snapshot.runtime,{name:file.basename || file.name.replace(/\.md$/i,''),metadata,date,headerType,includeTitle});
            nativeHeader=true;
          } else if(block.language==='taelgar-index') {
            if(snapshot.registryError)throw snapshot.registryError;
            const options=parseIndex(block.body,snapshot.indexRegistry,{host:'website'});
            options.mode='table';
            markdown=!options.enabled?'':indexMarkdown(await hydrateObsidianIndex(this.app,obsidianIndex(this.app,snapshot,options,file.path,date),options,date));
          } else {
            if(block.body.trim())throw new Error('Leave the taelgar-interactions block empty.');
            const data=await runtime.interactions();
            markdown=interactionsMarkdown(knownCampaigns(data,metadata).map(campaign=>localInteractions(data,file.path,campaign,date,this.app)));
          }
          nativeBlocks++;
        }
        const start=block.language==='taelgar-header' && leading && bodyStart+leading.end===block.end?bodyStart:block.start;
        const title=start===bodyStart && block.language==='taelgar-header' ? leading?.title || '' : '';
        replacements.push({start,end:block.end,text:title+prefixMarkdownLines(markdown.trimEnd(),block.quotePrefix)+'\n'});
      } catch(error) {issues.push({type:'error',line:block.startLine,message:error.message});}
    }
    const source=applyReplacements(original,replacements);
    const result=await super.materializeMarkdown(source,file,runtime,core,nativeHeader?{...config,headerType:'none'}:config);
    result.report.counts.errors+=issues.length;result.report.issues.push(...issues);
    result.report.counts.taelgarBlocks=nativeBlocks;result.report.counts.mapsConverted=maps;
    result.changed=result.report.changed=result.content!==original;
    return result;
  }
}
