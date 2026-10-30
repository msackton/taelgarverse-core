import {DateManager} from './dates.mjs';
import {NameManager} from './names.mjs';
import {WhereaboutsManager} from './locations.mjs';
import {AffiliationManager} from './affiliations.mjs';
import {TokenParser} from './templates.mjs';
import {EventManager} from './encounters.mjs';
import {OutputHandler} from './output.mjs';
export {createHeaderSnapshot} from './snapshot.mjs';
export {HeaderDataError} from './errors.mjs';
export {normalizeCampaignRegistry} from './campaigns.mjs';

// Dependency assembly is explicit and request-local. No app, Dataview, CustomJS,
// global calendar, or mutable request state is needed by these domain services.
export function createHeaderContext(snapshot,{date}={}) {
  const dates=new DateManager({date});
  const names=new NameManager({lookup:snapshot,coreMeta:snapshot.coreMeta,campaigns:snapshot.campaigns});
  const locations=new WhereaboutsManager({dates,names});
  // Affiliations use the same template engine as the surrounding header. The
  // callback breaks the construction cycle without a global service container.
  const affiliations=new AffiliationManager({dates,names,records:snapshot.affiliationCandidates,
    format:(...args)=>templates.formatDisplayString(...args)});
  const templates=new TokenParser({dates,names,locations,affiliations});
  const events=new EventManager({dates,names,locations,templates});
  const output=new OutputHandler({dates,names,locations,templates,affiliations,events});
  return {dates,names,locations,affiliations,templates,events,output};
}

// Compatibility boundary for notes that already contain saved generated headers.
export function renderHeader(snapshot,{source,name,metadata,date,headerType='website'}) {
  const {output}=createHeaderContext(snapshot,{date});
  return output.regenerateHeader(source,name,structuredClone(metadata),headerType==='static'?'static':'website').join('\n');
}

// Blocks generate the complete header directly, without dummy YAML or a saved
// header rewrite. Preserve the existing final newline in the Markdown contract.
export function renderBio(snapshot,{name,metadata,date,headerType='static',includeTitle=true}) {
  const {output}=createHeaderContext(snapshot,{date});
  const copy=structuredClone(metadata);
  const body=headerType==='static'?output.generateHeader(name,copy,{includeTitle}):output.generateWebsiteHeader(name,copy,{includeTitle});
  return body+'\n';
}

// Native callouts own only the information component, never surrounding prose,
// titles, pronunciation or saved-header/version compatibility rewrites.
export function renderHeaderCallout(snapshot,{name,metadata,date,mode='obsidian'}) {
  if(!['obsidian','website'].includes(mode))throw new Error('Unsupported header callout mode: '+mode);
  const {output}=createHeaderContext(snapshot,{date});
  const options={includeTitle:false,includePronunciation:false},copy=structuredClone(metadata);
  return mode==='website' ? output.generateWebsiteHeader(name,copy,options) : output.generateHeader(name,copy,options);
}
