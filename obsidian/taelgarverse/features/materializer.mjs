import LegacyMaterializer from '../materializer/legacy.cjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {obsidianHeaders,bioDate,obsidianIndex} from './headers.mjs';
import {obsidianInteractions,knownCampaigns,localInteractions} from './interaction-data.mjs';
import {renderHeaderCallout} from '../../../src/header-core/index.mjs';
import {parseIndex} from '../../../src/indexes.mjs';
import {parseNote} from '../../../src/content-store.mjs';
import {scanHeaderCallouts} from '../../../src/header-callout.mjs';
import {scanFencedCodeBlocks,applyReplacements,prefixMarkdownLines} from '../../../src/markdown-fences.mjs';
import {indexMarkdown,interactionsMarkdown} from '../../../src/static-markdown.mjs';
import {DATAVIEW_EXPORT_VERSION} from '../../../src/dataview-export.mjs';
import {parseMapBlock} from '../../../src/map-block.mjs';

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
    runtime.headers=()=>runtime.headerSnapshot ??= obsidianHeaders(this.app);
    runtime.interactions=()=>runtime.interactionSnapshot ??= obsidianInteractions(this.app);
    return runtime;
  }

  async materializeMarkdown(original,file,runtime,core,config) {
    const replacements=[],issues=[];let nativeBlocks=0,maps=0;
    const metadata=parseNote(original).metadata;
    const frontmatter=/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(original);
    const bodyStart=frontmatter?.[0].length || 0;
    for(const callout of scanHeaderCallouts(original.slice(bodyStart))) {
      try {
        const snapshot=await runtime.headers(),date=config.overrideDate || bioDate(metadata,globalThis,snapshot.fallback);
        const text=renderHeaderCallout(snapshot.runtime,{name:file.basename || file.name.replace(/\.md$/i,''),metadata,date,
          mode:config.headerType==='website'?'website':'obsidian'}).trimEnd()+'\n';
        replacements.push({start:bodyStart+callout.start,end:bodyStart+callout.end,text});nativeBlocks++;
      } catch(error) {issues.push({type:'error',line:original.slice(0,bodyStart+callout.start).split('\n').length,message:error.message});}
    }
    for(const block of scanFencedCodeBlocks(original)) {
      if(replacements.some(range=>block.start>=range.start && block.start<range.end))continue;
      if(!['taelgar-index','taelgar-interactions','taelgar-map'].includes(block.language))continue;
      try {
        if(!block.closed)throw new Error('Unclosed '+block.language+' block.');
        let markdown;
        if(block.language==='taelgar-map') {
          if(parseMapBlock(block.body).version===2)throw new Error('Version 2 manifest maps require the Taelgarverse renderer; static Leaflet conversion is unsupported.');
          const text=original.slice(block.start,block.end).replace(/^([ \t>]*[`~]{3,})taelgar-map\b/i,'$1leaflet');
          replacements.push({start:block.start,end:block.end,text});maps++;continue;
        } else {
          const snapshot=await runtime.headers(),date=config.overrideDate || bioDate(metadata,globalThis,snapshot.fallback);
          if(block.language==='taelgar-index') {
            const options=parseIndex(block.body);
            markdown=options.show==='obsidian'?'':indexMarkdown(obsidianIndex(this.app,snapshot,options,file.path,date));
          } else {
            if(block.body.trim())throw new Error('Leave the taelgar-interactions block empty.');
            const data=await runtime.interactions();
            markdown=interactionsMarkdown(knownCampaigns(data,metadata).map(campaign=>localInteractions(data,file.path,campaign,date,this.app)));
          }
          nativeBlocks++;
        }
        replacements.push({start:block.start,end:block.end,text:prefixMarkdownLines(markdown.trimEnd(),block.quotePrefix)+'\n'});
      } catch(error) {issues.push({type:'error',line:block.startLine,message:error.message});}
    }
    const source=applyReplacements(original,replacements);
    const result=await super.materializeMarkdown(source,file,runtime,core,{...config,headerType:'none'});
    result.report.counts.errors+=issues.length;result.report.issues.push(...issues);
    result.report.counts.taelgarBlocks=nativeBlocks;result.report.counts.mapsConverted=maps;
    result.changed=result.report.changed=result.content!==original;
    return result;
  }
}
