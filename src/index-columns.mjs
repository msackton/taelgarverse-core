import {parseDRDate} from './campaign-calendar.mjs';
import {indexObject,indexScalar,validateIndexField,indexNumber,indexBoolean} from './index-fields.mjs';

export const indexPresets=Object.freeze({
  name:{label:'Name',field:'page.name'},
  person:{label:'Person',template:'<name> (<pronouns> <pronunciation>)'},
  info:{label:'Info',template:'<ancestry> <maintype>'},
  type:{label:'Type Of',template:'<maintype:n>'},
  population:{label:'Population',template:'<population>'},
  home:{label:'Home',template:'<home:1>',empty:'Unknown'},
  region:{label:'Region',field:'location.region',empty:'Unknown'},
  lastKnown:{label:'Current Location',template:'<lastknown:2> (<lastknowndate>)',empty:'Unknown'},
  lastKnownCompact:{label:'Current Location',template:'<lastknown:2Fr> (<lastknowndate>)',empty:'Unknown'},
  start:{label:'Start',field:'life.start'},end:{label:'End',field:'life.end'},
  role:{label:'Role',field:'membership.title'},organization:{label:'Organization',field:'membership.org'},
  joined:{label:'Joined',field:'membership.start'},left:{label:'Left',field:'membership.end'},
  status:{label:'Status',field:'membership.status'},
  image:{label:'Image',content:'image',empty:''},firstSentence:{label:'Description',content:'firstSentence',empty:''},
});
export const indexFormats=new Set(['text','number','date','boolean','link','list']);
export const cardPositions=['title','subtitle','body','footer'];
const ownKeys=(value,allowed,name)=>{for(const key of Object.keys(value))if(!allowed.includes(key))throw new Error('Unknown '+name+' option: '+key);};

export function indexDisplay(value,{card=false,sort=false,membership=true}={}) {
  if(!sort && typeof value==='string') {
    if(!Object.hasOwn(indexPresets,value) || card && value==='image')throw new Error('Unknown '+(card?'card':'column')+' preset: '+value);
    const preset={...indexPresets[value]};
    if(!membership && preset.field?.startsWith('membership.'))throw new Error('Membership display requires an affiliation query.');
    return {...preset,...(card && preset.empty===undefined?{empty:''}:{})};
  }
  if(!indexObject(value))throw new Error('A display item must be a preset or field/template definition.');
  ownKeys(value,sort?['field','format','direction']:['label','field','template','format','separator','empty','trueText','falseText'],sort?'sort':'display');
  if(!sort && !card && (typeof value.label!=='string' || !value.label.trim()))throw new Error('A custom table column needs a label.');
  if(value.label!==undefined && (typeof value.label!=='string' || !value.label.trim()))throw new Error('A display label must be non-empty text.');
  if(sort || value.field!==undefined) {
    validateIndexField(value.field);
    if(!membership && value.field.startsWith('membership.'))throw new Error('Membership display requires an affiliation query.');
  }
  if(!sort && (value.field!==undefined)===(value.template!==undefined))throw new Error('Use exactly one field or template.');
  if(value.template!==undefined && (typeof value.template!=='string' || !value.template.trim()))throw new Error('A template must be non-empty text.');
  if(value.template!==undefined && ['format','separator','trueText','falseText'].some(key=>value[key]!==undefined))throw new Error('Templates use their own formatting.');
  if(value.format!==undefined && !indexFormats.has(value.format))throw new Error('Unknown display format: '+value.format);
  for(const key of ['empty','separator','trueText','falseText'])if(value[key]!==undefined && typeof value[key]!=='string')throw new Error(key+' must be text.');
  if(['trueText','falseText'].some(key=>value[key]!==undefined) && value.format!=='boolean')throw new Error('trueText/falseText require boolean formatting.');
  if(value.direction!==undefined && !['asc','desc'].includes(value.direction))throw new Error('Sort direction must be asc or desc.');
  return {...value,...(!sort && card && value.empty===undefined?{empty:''}:{})};
}

export function indexColumns(value=['name'],options={}) {
  if(!Array.isArray(value) || !value.length || value.length>64)throw new Error('columns must be a non-empty list, with at most 64 columns.');
  return value.map(item=>indexDisplay(item,options));
}
export function parseIndexSort(value=[],options={}) {
  if(!Array.isArray(value) || value.length>32)throw new Error('sort must be a list with at most 32 keys.');
  return value.map(item=>indexDisplay(item,{...options,sort:true}));
}
export function indexCards(value={},options={}) {
  if(!indexObject(value))throw new Error('cards must be an object.');
  ownKeys(value,[...cardPositions,'image','count'],'card');
  for(const key of ['image','count'])if(value[key]!==undefined && typeof value[key]!=='boolean')throw new Error('cards.'+key+' must be a boolean.');
  const result={image:value.image??true,count:value.count??false};
  for(const position of cardPositions) {
    const source=value[position]===undefined?(position==='title'?'name':null):value[position];
    const items=source===null?[]:Array.isArray(source)?source:[source];
    if(items.length>32 || position==='title' && !items.length)throw new Error('Invalid card position: '+position);
    result[position]=items.map(item=>indexDisplay(item,{...options,card:true}));
  }
  return result;
}

export function defaultIndexFormat(field) {
  if(['life.start','life.end','membership.start','membership.end'].includes(field))return 'date';
  if(field==='page.name' || field.startsWith('location.') || field==='membership.org')return 'link';
  return field==='page.tags'?'list':'text';
}
const textOf=parts=>parts.map(part=>typeof part==='string'?part:part.name || '').join('');

export function evaluateIndexColumn(column,page,roles,{dates,templates,at,formattedParts,linkParts,valuesFor,row}) {
  if(column.content) return {parts:column.content==='image'?(row.imageTarget?[{kind:'image',target:row.imageTarget,name:row.name}]:[]):[{kind:'firstSentence'}],sort:null};
  if(column.template!==undefined) {
    const parts=formattedParts(templates.formatDisplayString(column.template,{name:page.name,frontmatter:page.metadata},at),page.path);
    return {parts:parts.length?parts:[column.empty??'—'],sort:textOf(parts)||null};
  }
  const format=column.format??defaultIndexFormat(column.field),entries=[];
  for(const value of valuesFor(page,column.field,roles)) {
    if(value===undefined || value===null || value==='')continue;
    let parts,sort;
    if(format==='date') {
      if(!indexScalar(value) && !value.isNormalizedDate)continue;
      if(indexScalar(value)) {try{parseDRDate(value);}catch{continue;}}
      const date=dates.normalizeDate(value);
      if(!date || date.isHiddenDate || !Number.isFinite(date.sort))continue;
      parts=[date.display];sort=date.indexSort??date.sort;
    } else if(format==='number') {
      const number=indexNumber(value);if(number===undefined)continue;
      parts=[number.toLocaleString('en-US')];sort=number;
    } else if(format==='boolean') {
      const boolean=indexBoolean(value);if(boolean===undefined)continue;
      parts=[boolean?column.trueText??'Yes':column.falseText??'No'];sort=boolean;
    } else if(indexObject(value) && value.name!==undefined) {
      parts=format==='link'?[{path:value.path,name:value.name}]:[value.name];
      if(value.pronunciation)parts.push(' ('+value.pronunciation+')');
      sort=value.name;
    } else {
      if(!indexScalar(value))continue;
      parts=format==='link'?linkParts(String(value),page.path):formattedParts(String(value),page.path);
      sort=typeof value==='number' || typeof value==='boolean'?value:textOf(parts);
    }
    if(!entries.some(entry=>JSON.stringify(entry.parts)===JSON.stringify(parts)))entries.push({parts,sort});
  }
  return {parts:entries.length?entries.flatMap((entry,i)=>i?[column.separator??' · ',...entry.parts]:entry.parts):[column.empty??'—'],sort:entries[0]?.sort??null};
}

export function indexNeedsContent(options,kind,mode=options.mode) {
  if(mode==='table')return options.columns.some(column=>column.content===kind);
  return kind==='image' && options.cards.image || cardPositions.some(position=>options.cards[position].some(item=>item.content===kind));
}
export function hydrateIndexItem(item,{image,firstSentence}={}) {
  const fill=parts=>parts.flatMap(part=>part?.kind==='image'?image?[{...part,src:image}]:[]:part?.kind==='firstSentence'?firstSentence?[firstSentence]:[]:[part]);
  item.cells=item.cells.map(fill);
  for(const position of cardPositions)item.card[position]=item.card[position].map(fill).filter(parts=>parts.some(part=>typeof part!=='string' || part.trim()));
  if(!item.card.title.length)item.card.title=[[{path:item.path,name:item.name}]];
  item.image=image;
  return item;
}
const collator=new Intl.Collator('en',{sensitivity:'base',numeric:true});
export function compareIndexValues(a,b,direction='asc') {
  if(a===null || b===null)return a===b?0:a===null?1:-1;
  const compared=typeof a==='number' && typeof b==='number' || typeof a==='boolean' && typeof b==='boolean'?Number(a)-Number(b):collator.compare(String(a),String(b));
  return direction==='desc'?-compared:compared;
}
