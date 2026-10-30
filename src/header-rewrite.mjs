import {parse} from 'yaml';
import MarkdownIt from 'markdown-it';
import {getPageType} from './header-core/metadata.mjs';
import {NameManager} from './header-core/names.mjs';
import {scanTopLevelCallouts} from './header-callout.mjs';
import {scanFencedCodeBlocks} from './markdown-fences.mjs';

const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
const unknown=/^(?:unknown|none|null|n\/a|\?)$/i;
// Standalone vaults without metadata.json retain the usual personal-name rules.
// A supplied vault configuration is authoritative; the shared name service
// merges its required, type and per-note display defaults in the normal order.
const fallbackNameRules={typeDisplayDefaults:{person:{defArt:''},power:{defArt:''},unknown:{defArt:''}}};
const list=value=>Array.isArray(value)?value:value==null?[]:[value];
const excludedHeaderTags=new Set(['session-note','meta','background','source','story']);

export function headerEligibility(metadata) {
  const tags=list(metadata.tags).filter(tag=>typeof tag==='string').flatMap(tag=>tag.split(/[\s,]+/))
    .map(tag=>tag.replace(/^#/,'').trim().toLowerCase()).filter(Boolean);
  if(!tags.length)return {eligible:false,reason:'Header ineligible: no tags.'};
  const excluded=tags.find(tag=>excludedHeaderTags.has(tag.split('/')[0]));
  if(excluded)return {eligible:false,reason:'Header ineligible: excluded tag '+excluded+'.'};
  return {eligible:true};
}

// The saved summary is intentionally plain text, with fixed approved formats.
// It neither evaluates tokens/JavaScript nor applies displayDefaults.boxInfo.
function text(value) {
  if(typeof value!=='string' && typeof value!=='number')return '';
  const result=String(value).replace(/\[\[([^\]]+)\]\]/g,(_,link)=>link.split('|')[1] || link.split('#')[0].split('/').at(-1).replace(/\.md$/i,''))
    .replace(/[\r\n]+/g,' ').trim();
  return unknown.test(result)?'':result;
}
const join=values=>values.map(text).filter(Boolean).join(', ');
const words=values=>values.map(text).filter(Boolean).join(' ');
const typeName=metadata=>text(metadata.typeOfAlias) || text(metadata.typeOf);
const unrestricted=entry=>['start','end','date'].every(key=>entry[key]==null || entry[key]==='');

function whereabouts(metadata) {
  if(typeof metadata.whereabouts==='string')return [{type:'home',location:metadata.whereabouts}];
  return Array.isArray(metadata.whereabouts)?metadata.whereabouts:[];
}

export function timelessLocation(metadata,type='home') {
  const records=whereabouts(metadata);
  // Malformed records could conceal a competing home. Do not guess.
  if(records.some(entry=>!entry || typeof entry!=='object' || Array.isArray(entry)))return '';
  const entries=records.filter(entry=>(entry.type==='primary'?'home':entry.type)===type);
  if(!entries.length || entries.some(entry=>!unrestricted(entry) || !text(entry.location)))return '';
  const locations=[...new Set(entries.map(entry=>text(entry.location)))];
  return locations.length===1?locations[0]:'';
}

function primaryAffiliations(metadata) {
  return [...new Set(list(metadata.affiliations).filter(entry=>entry && entry.type==='primary' && unrestricted(entry))
    .map(entry=>text(entry.org)).filter(Boolean))].join(' and ');
}

function dateParts(value) {
  if(value instanceof Date)value=value.toISOString().slice(0,10);
  const match=/^(\d{1,4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(text(value));
  if(!match)return null;
  const [,y,m,d]=match,year=Number(y),month=m?Number(m):null,day=d?Number(d):null;
  if(year<=1 || year>=9999 || month!==null && (month<1 || month>12) ||
    day!==null && (day<1 || day>[31,28,31,30,31,30,31,31,30,31,30,31][month-1]))return null;
  return {year,display:day?`${months[month-1]} ${day}, ${year}`:month?`${months[month-1]} ${year}`:String(year)};
}

function pronouns(metadata) {
  return text(metadata.pronouns) || (metadata.gender==='male'?'he/him':metadata.gender==='female'?'she/her':text(metadata.gender)?'they/them':'');
}

export function headerInfo(metadata) {
  const type=getPageType(metadata),primary=primaryAffiliations(metadata);
  let info;
  if(type==='person') {
    const born=dateParts(metadata.born),died=dateParts(metadata.died),home=timelessLocation(metadata);
    info=join([text(metadata.species).toLowerCase(),metadata.ancestry,pronouns(metadata),text(metadata.ka)?'ka '+text(metadata.ka):'',
      born?'b. '+born.year:'',died?'d. '+died.year:'',home?'lives in '+home:'']);
  } else if(type==='power')info=join([typeName(metadata),pronouns(metadata),primary?'part of '+primary:'']);
  else if(type==='place') {
    const home=timelessLocation(metadata),secondary=timelessLocation(metadata,'secondary');
    const location=[home,secondary].filter(Boolean).join(' / ');
    info=join([typeName(metadata),location?'in '+location:'']);
  } else if(type==='object')info=words([metadata.rarity,metadata.ancestry,metadata.subTypeOf ?? metadata.subtypeof,typeName(metadata)]);
  else if(type==='group')info=join([words([metadata.ancestry,metadata.subTypeOf ?? metadata.subtypeof,typeName(metadata)]),primary?'of '+primary:'']);
  else if(type==='event') {
    const start=dateParts(metadata.DR)?.display,end=dateParts(metadata.DR_end)?.display;
    info=join([typeName(metadata),metadata.partOf,start && end && start!==end?start+'–'+end:start || end]);
  } else info=join([typeName(metadata),metadata.partOf]);
  return info?'('+info+')':'';
}

export function savedHeaderTitle(metadata,filename,coreMeta=fallbackNameRules) {
  const path=filename.replace(/\\/g,'/'),basename=path.split('/').at(-1).replace(/\.md$/i,'');
  const page={path,name:basename,metadata};
  const names=new NameManager({lookup:{resolve:target=>[path,basename,basename+'.md'].includes(target)?page:null,pages:[page]},
    coreMeta,campaigns:[]});
  return (names.getName(path,'tn') || basename).replace(/[\r\n]+/g,' ').trim();
}

export function savedHeader(metadata,filename,newline='\n',coreMeta) {
  const title=savedHeaderTitle(metadata,filename,coreMeta);
  const lines=['# '+title];
  if(text(metadata.pronunciation))lines.push('*('+text(metadata.pronunciation)+')*');
  lines.push('> [!taelgar-header]');
  const info=headerInfo(metadata);if(info)lines.push('> '+info);
  return lines.join(newline)+newline;
}

// Only a leading H1 and pronunciation qualify as disposable header prefix.
// A comment, image, paragraph or other callout makes the boundary ambiguous.
function leadingTitle(body) {
  const blank='(?:[\\t ]*\\r?\\n)*';
  const heading='(?: {0,3}#[\\t ]+[^\\r\\n]*(?:\\r?\\n|$)|[^\\r\\n]+\\r?\\n {0,3}={2,}[\\t ]*(?:\\r?\\n|$))';
  const pronunciation='(?:[\\t ]*\\*\\([^\\r\\n]+\\)\\*[\\t ]*(?:\\r?\\n|$))?';
  return new RegExp('^'+blank+heading+blank+pronunciation+blank).exec(body)?.[0].length || 0;
}

function headerSource(source) {
  const bom=source.startsWith('\uFEFF')?1:0,content=source.slice(bom);
  const yaml=/^---[\t ]*\r?\n((?:[^\n]*\n)*?)---[\t ]*(?:\r?\n|$)/.exec(content);
  if(!yaml && /^---[\t ]*(?:\r?\n|$)/.test(content))throw new Error('Unclosed YAML frontmatter.');
  const parsed=yaml?parse(yaml[1],{version:'1.1',merge:true,uniqueKeys:false,maxAliasCount:100}):{};
  if(parsed!=null && (typeof parsed!=='object' || Array.isArray(parsed)))throw new Error('Frontmatter must be a mapping.');
  return {metadata:parsed || {},start:bom+(yaml?.[0].length || 0)};
}

export function headerSourceEligibility(source) {
  return headerEligibility(headerSource(source).metadata);
}

export function rewriteHeader(source,{filename='Untitled.md',add=false,coreMeta}={}) {
  const {metadata,start}=headerSource(source),eligibility=headerEligibility(metadata);
  // Source-writing policy only: return before inspecting any header syntax.
  // The renderer deliberately does not use this eligibility check.
  if(!eligibility.eligible)return {status:'skipped',reason:eligibility.reason};
  const body=source.slice(start);
  const callouts=scanTopLevelCallouts(body,['taelgar-header','info']);
  const titleEnd=leadingTitle(body);
  let candidate=callouts[0];
  // An ordinary article info callout is not a header. Explicit Add may insert
  // above it, but must not erase prose or ignore a later native insertion flag.
  if(candidate?.type==='info' && !metadata.headerVersion && (!titleEnd || titleEnd!==candidate.start)) {
    if(callouts.some(callout=>callout.type==='taelgar-header'))return {status:'skipped',problem:true,reason:'Unexpected content before the first header callout.'};
    candidate=null;
  }
  let end,kind;
  if(candidate) {
    const prefix=body.slice(0,candidate.start);
    if(prefix.trim() && titleEnd!==candidate.start)return {status:'skipped',problem:true,reason:'Unexpected content before the first header callout.'};
    if(candidate.type==='info' && !titleEnd && !metadata.headerVersion)return {status:'skipped',reason:'An ordinary info callout is not a recognized saved header.'};
    end=start+candidate.end;kind=candidate.type==='info'?'converted':'regenerated';
  } else {
    if(scanFencedCodeBlocks(body).some(block=>block.language==='taelgar-header'))return {status:'skipped',problem:true,reason:'Old header code fence requires explicit conversion.'};
    if(!add)return {status:'skipped',reason:'No recognized header; insert an empty taelgar-header callout or use Add header / --add.'};
    end=start+titleEnd;kind='added';
  }
  return replaceHeader(source,{metadata,start,end,kind,filename,coreMeta});
}

function replaceHeader(source,{metadata,start,end,kind,filename,coreMeta}) {
  const newline=source.includes('\r\n')?'\r\n':'\n',header=savedHeader(metadata,filename,newline,coreMeta);
  let replacement=header;
  const suffix=source.slice(end);
  if(suffix && !/^[\t ]*\r?\n/.test(suffix))replacement+=newline;
  const result=source.slice(0,start)+replacement+suffix;
  return {status:result===source?'unchanged':'changed',kind,start,end,replacement,before:source.slice(start,end),after:replacement,source:result};
}

// Publication uses the same saved-header writer, but never regenerates a native
// callout's authored title, pronunciation or fallback. Legacy syntax is converted
// here, outside all rendering adapters; the source-editing commands stay explicit.
export function migrateLegacyHeader(source,{filename='Untitled.md',coreMeta}={}) {
  const {metadata,start}=headerSource(source),eligibility=headerEligibility(metadata);
  if(!eligibility.eligible)return {status:'skipped',reason:eligibility.reason};
  const body=source.slice(start);
  const callouts=scanTopLevelCallouts(body,['taelgar-header','info']);
  if(callouts.some(callout=>callout.type==='taelgar-header'))return {status:'unchanged',reason:'Already uses a native header callout.'};
  const titleEnd=leadingTitle(body),isLeading=offset=>!body.slice(0,offset).trim() || titleEnd===offset;
  let fences=scanFencedCodeBlocks(body).filter(block=>block.language==='taelgar-header');
  if(fences.length) {
    const lines=new Set(new MarkdownIt({html:true}).parse(body,{}).filter(token=>token.type==='fence' && token.level===0).map(token=>token.map[0]+1));
    fences=fences.filter(block=>lines.has(block.startLine));
  }
  const fence=fences.find(block=>isLeading(block.start));
  if(fence) {
    if(!fence.closed || fence.body.trim() || fence.info.toLowerCase()!=='taelgar-header')
      return {status:'skipped',problem:true,reason:'Legacy header fence must be closed and empty; review it explicitly.'};
    return replaceHeader(source,{metadata,start,end:start+fence.end,kind:'converted',filename,coreMeta});
  }
  const marker=/^ {0,3}<!--\s*taelgar(?::|-)header\s*-->[\t ]*(?:\r?\n|$)/gm;
  for(const match of body.matchAll(marker))if(isLeading(match.index))
    return replaceHeader(source,{metadata,start,end:start+match.index+match[0].length,kind:'converted',filename,coreMeta});
  if(callouts.length)return rewriteHeader(source,{filename,coreMeta});
  if(fences.length)return {status:'skipped',problem:true,reason:'Unexpected content before a legacy header fence.'};
  return {status:'skipped',reason:'No recognized legacy header.'};
}
