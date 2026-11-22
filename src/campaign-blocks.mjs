import {parseDocument} from 'yaml';
import {scanFencedCodeBlocks} from './markdown-fences.mjs';
import {sessionNumber} from './session-bundles.mjs';

export const campaignFences = {roster:'taelgar-roster', sessions:'taelgar-session'};
export const playerRoles = ['core','other'];
export const characterKinds = ['member','guest','companion','associated'];
export const sessionKinds = ['adventure','solo','inter-session','meeting'];
export const rosterColumns = ['player','role','character','attendance','note'];
export const sessionPeopleColumns = ['characters','participants','people'];
export const sessionColumns = ['session','title','played','dr',...sessionPeopleColumns,'account','evidence','note'];
export const summaryFields = ['first','latest','count','played','dr'];

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = value => Array.isArray(value) ? value : [value];
const own = (value,key) => Object.hasOwn(value,key);

function keys(value,allowed,label) {
  if (!isObject(value)) throw new Error(label+' must be a mapping.');
  const unknown = Object.keys(value).find(key=>!allowed.includes(key));
  if (unknown) throw new Error(label+' has an unknown field '+unknown+'.');
}

function text(value,label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(label+' must be text.');
}

function choice(value,allowed,label) {
  if (!allowed.includes(value)) throw new Error(label+' must be one of '+allowed.join(', ')+'.');
}

function choices(value,allowed,label) {
  const values = list(value);
  if (!values.length || new Set(values).size !== values.length) throw new Error(label+' must contain distinct values.');
  for (const item of values) choice(item,allowed,label);
  return values;
}

function number(value) {
  if ((typeof value !== 'string' && !Number.isSafeInteger(value)) || sessionNumber(value) === null)
    throw new Error('Use a whole session number or quote the full point number.');
  return sessionNumber(value);
}

function sources(value) {
  for (const item of list(value)) text(item,'Evidence');
}

function date(value) {
  if (typeof value === 'string' || Number.isInteger(value)) {
    text(String(value),'Date');
    return;
  }
  keys(value,['on','from','through','label','qualifier','evidence','alternatives'],'Date');
  const {on,from,through,label,qualifier,evidence,alternatives} = value;
  if ([on!==undefined,from!==undefined || through!==undefined,label!==undefined,alternatives!==undefined].filter(Boolean).length !== 1)
    throw new Error('A date needs on, from/through, label, or alternatives.');
  if ((from===undefined)!==(through===undefined)) throw new Error('A date window needs from and through.');
  for (const item of [on,from,through,label,qualifier]) if(item!==undefined) text(item,'Date');
  if (evidence!==undefined) sources(evidence);
  if (alternatives!==undefined) {
    if (!Array.isArray(alternatives) || alternatives.length<2 || alternatives.some(item=>isObject(item) && own(item,'alternatives')))
      throw new Error('An unresolved date needs at least two date alternatives.');
    alternatives.forEach(date);
  }
}

function rosterOverride(value) {
  keys(value,['player','character','role','kind','note','description','draft'],'Roster override');
  for (const field of ['player','character','note','description']) if (own(value,field)) text(value[field],field);
  if (!value.player && !value.character) throw new Error('A roster override needs a player or character.');
  if (own(value,'role')) choice(value.role,[...playerRoles,null],'role');
  if (own(value,'kind')) choice(value.kind,characterKinds,'kind');
  if (own(value,'draft') && typeof value.draft !== 'boolean') throw new Error('draft must be true or false.');
  if (!value.character && (own(value,'kind') || own(value,'description'))) throw new Error('kind and description require a character.');
}

function participant(value) {
  keys(value,['player','character','role'],'Attendance row');
  text(value.player,'Attendance player');
  if (own(value,'character')) text(value.character,'Attendance character');
  if (own(value,'role')) choice(value.role,['player','dm'],'Attendance role');
}

function sessionOverride(value) {
  keys(value,['number','id','kind','title','played','date','dr','drEnd','attendance','characters','companions','account','evidence','note'],'Session override');
  if (own(value,'number') === own(value,'id')) throw new Error('A session override needs either number or id.');
  if (own(value,'number')) value.number=number(value.number);
  if (own(value,'id') && (typeof value.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id)))
    throw new Error('An unnumbered event needs a lowercase hyphenated id.');
  if (own(value,'kind')) choice(value.kind,sessionKinds,'kind');
  if (value.id && !['meeting','inter-session'].includes(value.kind)) throw new Error('An unnumbered event needs kind: meeting or inter-session.');
  for (const field of ['title','account','note']) if (own(value,field)) text(value[field],field);
  if (own(value,'played') && own(value,'date')) throw new Error('Use one of played and date.');
  for (const field of ['played','date','dr','drEnd']) if(own(value,field) && value[field]!==null) list(value[field]).forEach(date);
  if (own(value,'evidence')) sources(value.evidence);
  for (const field of ['attendance','characters','companions']) if(own(value,field) && value[field]!==null) {
    if (!Array.isArray(value[field])) throw new Error(field+' must be a list or null.');
    value[field].forEach(field==='attendance' ? participant : item=>text(item,field));
  }
}

export function parseCampaignBlock(type,source='') {
  if (!source.trim()) return {};
  const doc=parseDocument(source,{uniqueKeys:true});
  if (doc.errors.length) throw new Error(doc.errors[0].message);
  const options=doc.toJS({maxAliasCount:0});
  const roster=type==='roster';
  keys(options,['campaign','columns','overrides',...(roster ? ['playerRole','characterKind','characterPresence'] : ['kinds','summary','estimate'])],campaignFences[type]);
  if (own(options,'campaign') && (typeof options.campaign!=='string' || !/^[a-z][a-z0-9]*$/.test(options.campaign)))
    throw new Error('campaign must be a registered lowercase ID.');
  for (const [field,allowed] of Object.entries(roster ? {columns:rosterColumns,playerRole:playerRoles,characterKind:characterKinds}
    : {columns:sessionColumns,kinds:sessionKinds,summary:summaryFields})) {
    if (own(options,field) && !(field==='summary' && [true,false,'only'].includes(options.summary)))
      options[field]=choices(options[field],allowed,field);
  }
  if (own(options,'characterPresence') && typeof options.characterPresence!=='boolean')
    throw new Error('characterPresence must be true or false.');
  if (own(options,'overrides')) {
    if (!Array.isArray(options.overrides)) throw new Error('overrides must be a list.');
    options.overrides.forEach(roster ? rosterOverride : sessionOverride);
  }
  if (own(options,'estimate')) {
    keys(options.estimate,['count','first','latest','played','dr','note','evidence'],'Campaign estimate');
    if (own(options.estimate,'count') && (!Number.isSafeInteger(options.estimate.count) || options.estimate.count<0))
      throw new Error('An estimated count must be a nonnegative integer.');
    for(const field of ['first','latest']) if(own(options.estimate,field)) options.estimate[field]=number(options.estimate[field]);
    for(const field of ['played','dr']) if(own(options.estimate,field)) date(options.estimate[field]);
    if(own(options.estimate,'note')) text(options.estimate.note,'note');
    if(own(options.estimate,'evidence')) sources(options.estimate.evidence);
  }
  return options;
}

export function campaignDefinitions(body,campaign) {
  const definitions={};
  const fences=scanFencedCodeBlocks(body);
  for (const [type,language] of Object.entries(campaignFences)) {
    const matches=fences.filter(fence=>fence.language===language);
    if (matches.length>1) throw new Error('The '+campaign+' index defines '+language+' more than once.');
    if (!matches.length) continue;
    const options=parseCampaignBlock(type,matches[0].body);
    if (options.campaign && options.campaign!==campaign) throw new Error('The '+campaign+' index can only define its own campaign.');
    definitions[type]=options;
  }
  return definitions;
}
