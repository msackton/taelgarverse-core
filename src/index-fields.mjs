const unsafe = new Set(['__proto__','prototype','constructor']);
const pageFields = new Set(['name','path','kind','tags','mainType']);
const lifeFields = new Set(['exists','active','start','end']);
const locationFields = new Set(['home','region','current','lastKnown','secondary']);
const membershipFields = new Set(['org','title','start','end','status']);
export const indexObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const indexScalar = value => typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value);

export function validateIndexField(field,{filter=false}={}) {
  if(typeof field!=='string')throw new Error('An index field must be a property path.');
  const [namespace,...parts]=field.split('.');
  if(!parts.length || parts.length>16 || parts.some(key=>!key.trim() || unsafe.has(key)))throw new Error('Invalid index field: '+field);
  const known=namespace==='metadata' || parts.length===1 && (
    namespace==='page' && pageFields.has(parts[0]) || namespace==='life' && lifeFields.has(parts[0]) ||
    !filter && (namespace==='location' && locationFields.has(parts[0]) || namespace==='membership' && membershipFields.has(parts[0])));
  if(!known || filter && namespace==='life' && !['exists','active'].includes(parts[0]))throw new Error('Unsupported '+(filter?'filter':'display')+' field: '+field);
  return field;
}

export function metadataValues(metadata,parts) {
  let value=metadata;
  for(const key of parts) {
    if(!indexObject(value) || !Object.hasOwn(value,key))return [];
    value=value[key];
  }
  return (Array.isArray(value)?value:[value]).filter(indexScalar);
}

const numeric=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
export function indexNumber(value) {
  if(typeof value==='number')return Number.isFinite(value)?value:undefined;
  if(typeof value!=='string' || !numeric.test(value.trim()))return undefined;
  const number=Number(value);return Number.isFinite(number)?number:undefined;
}
export function indexBoolean(value) {
  if(typeof value==='boolean')return value;
  if(typeof value==='string' && /^(true|false)$/i.test(value.trim()))return value.trim().toLowerCase()==='true';
}

export const indexOperators = new Set(['eq','ne','in','exists','gt','gte','lt','lte']);
export function validateIndexCondition(condition,{relationship=true}={}) {
  if(!indexObject(condition))throw new Error('An index condition must be an object.');
  if(Object.hasOwn(condition,'all')) {
    if(Object.keys(condition).length!==1 || !Array.isArray(condition.all) || !condition.all.length || condition.all.length>128)throw new Error('all must be a non-empty flat list of conditions.');
    for(const child of condition.all) {
      if(child?.all!==undefined)throw new Error('Nested filter groups are not supported.');
      validateIndexCondition(child,{relationship});
    }
    if(condition.all.filter(child=>child.relation).length>1)throw new Error('An index can have at most one relationship condition.');
    return;
  }
  if(condition.relation!==undefined) {
    if(!relationship || !['home','affiliation','watershed'].includes(condition.relation))throw new Error('Unsupported index relationship.');
    const affiliation=condition.relation==='affiliation';
    const allowed=affiliation?['relation','target','state','recursive']:['relation','within','recursive'];
    for(const key of Object.keys(condition))if(!allowed.includes(key))throw new Error('Unknown relationship option: '+key);
    const target=condition[affiliation?'target':'within'];
    if(typeof target!=='string' || !target.trim())throw new Error('A relationship needs a target reference.');
    if(target.startsWith('$') && !['$source','$target'].includes(target))throw new Error('Unknown reference variable: '+target);
    if(condition.recursive!==undefined && typeof condition.recursive!=='boolean')throw new Error('recursive must be a boolean.');
    if(affiliation && !['current','former'].includes(condition.state??'current'))throw new Error('Affiliation state must be current or former.');
    return;
  }
  validateIndexField(condition.field,{filter:true});
  for(const key of Object.keys(condition))if(!['field','as',...indexOperators].includes(key))throw new Error('Unknown filter option: '+key);
  if(condition.as!==undefined && !['text','number'].includes(condition.as))throw new Error('Filter as must be text or number.');
  const operators=Object.keys(condition).filter(key=>indexOperators.has(key));
  if(operators.length!==1)throw new Error('A field predicate needs exactly one comparison operator.');
  const operator=operators[0],operand=condition[operator];
  if(operator==='exists') {
    if(typeof operand!=='boolean')throw new Error('exists must be a boolean.');
  } else if(operator==='in') {
    if(!Array.isArray(operand) || !operand.length || operand.length>256 || operand.some(value=>!indexScalar(value)))throw new Error('in must be a non-empty list of scalar values.');
  } else if(!indexScalar(operand))throw new Error('A comparison needs a scalar value.');
  if(['gt','gte','lt','lte'].includes(operator) && indexNumber(operand)===undefined)throw new Error('Ordered filters require numeric operands.');
}

export const indexConditions = where => where?.all || (where?[where]:[]);
export function matchIndexField(condition,values) {
  const present=values.filter(value=>value!==undefined && value!==null && value!=='' && indexScalar(value));
  if(Object.hasOwn(condition,'exists'))return Boolean(present.length)===condition.exists;
  const convert=value=>condition.as==='number'?indexNumber(value):condition.as==='text' && indexScalar(value)?String(value):value;
  const comparable=present.map(convert).filter(indexScalar);
  const equal=(a,b)=>typeof a===typeof b && (typeof a==='string' && condition.field!=='page.path'?a.toLowerCase()===b.toLowerCase():a===b);
  const operator=Object.keys(condition).find(key=>indexOperators.has(key));
  const operands=(operator==='in'?condition.in:[condition[operator]]).map(convert).filter(indexScalar);
  if(!comparable.length || !operands.length)return false;
  const found=comparable.some(value=>operands.some(operand=>equal(value,operand)));
  if(['eq','in'].includes(operator))return found;
  if(operator==='ne')return comparable.some(value=>operands.some(operand=>typeof value===typeof operand)) && !found;
  return comparable.some(value=>typeof value==='number' && typeof operands[0]==='number' && (
    operator==='gt'?value>operands[0]:operator==='gte'?value>=operands[0]:operator==='lt'?value<operands[0]:value<=operands[0]));
}
