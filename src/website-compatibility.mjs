import {parse,parseExpressionAt} from 'acorn';
import {scanFencedCodeBlocks,applyReplacements,prefixMarkdownLines} from './markdown-fences.mjs';
import {getPageType} from './header-core/metadata.mjs';

const member=(node,object,property)=>node?.type==='MemberExpression' && !node.computed && node.object.type==='Identifier' && node.object.name===object && node.property.name===property;
const call=(node,object,property)=>node?.type==='CallExpression' && member(node.callee,object,property);
const literal=node=>node?.type==='Literal'?node.value:undefined;
const shape=node=>JSON.stringify(node,(key,value)=>['start','end','raw'].includes(key)?undefined:value);
const expression=source=>shape(parseExpressionAt(source,0,{ecmaVersion:'latest'}));
const currentName=expression('dv.current().file.name'),pageDate=expression('dv.current().pageTargetDate');
const isDate=node=>shape(node)===pageDate;
const fileOf=(node,param)=>shape(node)===expression(param+'.file');
const metadataOf=(node,param)=>fileOf(node,param) || shape(node)===expression(param+'.file.frontmatter');
const formats=new Set(['<name>','<name:x>','<name:t>','<name:n>','<name> (<pronunciation>)','<name:x> (<pronunciation>)',
  '<name> (<pronouns> <pronunciation>)','<ancestry> <maintype>','<lastknown:2> (<lastknowndate>)',
  '<lastknown:2r> (<lastknowndate>)','<lastknown:2Fr> (<lastknowndate>)','<home:1>','<home:1x>','<maintype>','<maintype:n>','<population>','<name:!>']);

function formatting(node,param) {
  return call(node,'util','s') && formats.has(literal(node.arguments[0])) && fileOf(node.arguments[1],param) &&
    (node.arguments.length===2 || node.arguments.length===3 && isDate(node.arguments[2]));
}
function arrow(node) {
  return node?.type==='ArrowFunctionExpression' && !node.async && node.params.length===1 && node.params[0].type==='Identifier' ? node.params[0].name:null;
}

// Parse, never execute, JavaScript. Match only a complete supported pipeline;
// extra statements, predicates, callbacks, calls, and columns prevent rewriting.
export function recognizeDataviewJs(source) {
  let program;try{program=parse(source,{ecmaVersion:'latest',allowAwaitOutsideFunction:true});}catch{return null;}
  if(program.body.length===1) {
    let node=program.body[0].expression;if(node?.type==='AwaitExpression')node=node.argument;
    if(call(node,'dv','view') && node.arguments.length===1 && literal(node.arguments[0])==='_scripts/view/get_CampaignInteractions')return {rule:'campaign-interactions',language:'taelgar-interactions',body:''};
  }
  if(program.body.length!==2)return null;
  const declaration=program.body[0],table=program.body[1].expression;
  if(declaration.type!=='VariableDeclaration' || declaration.declarations.length!==1)return null;
  const binding=declaration.declarations[0];
  if(binding.init?.name!=='customJS' || binding.id.type!=='ObjectPattern' || binding.id.properties.length!==1 ||
    binding.id.properties[0].computed || binding.id.properties[0].key?.name!=='util' || binding.id.properties[0].value?.name!=='util')return null;
  if(!call(table,'dv','table') || table.arguments.length!==2 || table.arguments[0].type!=='ArrayExpression')return null;
  const headings=table.arguments[0].elements.map(literal);
  let chain=table.arguments[1],mapped=false,predicate,sourceTag;
  while(chain?.type==='CallExpression' && chain.callee.type==='MemberExpression') {
    if(chain.callee.computed)return null;
    const method=chain.callee.property.name;
    if(method==='pages') {
      if(!call(chain,'dv','pages') || chain.arguments.length!==1)return null;
      sourceTag=literal(chain.arguments[0]);break;
    }
    if(chain.arguments.length!==1)return null;
    const fn=chain.arguments[0],param=arrow(fn);if(!param)return null;
    if(method==='map' && !mapped) {
      if(fn.body.type!=='ArrayExpression' || fn.body.elements.length!==headings.length || !fn.body.elements.every(n=>formatting(n,param)))return null;
      mapped=true;
    } else if(method==='sort' && mapped) {
      if(!formatting(fn.body,param))return null;
    } else if(method==='where' && mapped && !predicate)predicate={node:fn.body,param};
    else return null;
    chain=chain.callee.object;
  }
  if(!predicate || !['#person','#place'].includes(sourceTag))return null;
  let node=predicate.node,settlement=false;
  if(node.type==='LogicalExpression' && node.operator==='&&') {
    const condition=node.right;
    if(condition.type!=='BinaryExpression' || !['==','==='].includes(condition.operator) || literal(condition.right)!=='settlement' ||
      shape(condition.left)!==expression(predicate.param+'.file.frontmatter.typeOf'))return null;
    settlement=true;node=node.left;
  }
  const affiliated=call(node,'util','isAffiliated'),located=call(node,'util','inLocation');
  if(!affiliated && !located)return null;
  const args=node.arguments;
  const target=shape(args[0])===currentName?undefined:typeof literal(args[0])==='string' && literal(args[0]).trim()?literal(args[0]):null;
  if(target===null || !metadataOf(args[1],predicate.param) || args.length<2 || args.length>5)return null;
  if(affiliated && (sourceTag!=='#person' || args.length!==2 || settlement))return null;
  if(located && !args.slice(2).every(n=>typeof literal(n)==='boolean' || isDate(n)))return null;
  const type=affiliated?'members':sourceTag==='#person'?'residents':settlement?'settlements':'places';
  const accepted=type==='members' || type==='residents' ? [['Person','Info','Current Location'],['Person','Info','Current Location','Home']]:
    type==='settlements'?[['Place','Region','Type Of','Population']]:[['Place'],['Place','Type Of']];
  if(!accepted.some(h=>JSON.stringify(h)===JSON.stringify(headings)))return null;
  const body='type: '+type+'\nmode: table\n'+(target===undefined?'':'target: '+JSON.stringify(target)+'\n');
  return {rule:'legacy-'+type,language:'taelgar-index',body,indexOptions:{type,target}};
}

export function convertWebsiteNote(note,{sourcePath='',resolveTarget}={}) {
  const changes=[],unconverted=[];
  const replacements=[];
  for(const block of scanFencedCodeBlocks(note.body)) {
    if(block.language!=='dataviewjs' || !block.closed)continue;
    const recognized=recognizeDataviewJs(block.body);
    if(!recognized){unconverted.push({file:sourcePath,line:block.startLine,reason:'Unrecognized DataviewJS; retained for the existing cleanup policy.'});continue;}
    if(recognized.indexOptions) {
      const {type,target}=recognized.indexOptions,metadata=target?resolveTarget?.(target,sourcePath):note.metadata;
      const required=type==='members'?'group':'place';
      if(getPageType(metadata)!==required) {
        unconverted.push({file:sourcePath,line:block.startLine,reason:'Recognized '+type+' pattern requires a resolvable '+required+' target; retained for the existing cleanup policy.'});continue;
      }
    }
    const markdown='```'+recognized.language+'\n'+recognized.body+'```';
    replacements.push({start:block.start,end:block.end,text:prefixMarkdownLines(markdown,block.quotePrefix)+'\n'});
    changes.push({rule:recognized.rule,file:sourcePath,line:block.startLine});
  }
  const body=applyReplacements(note.body,replacements);
  return {note:body===note.body?note:{...note,body,source:note.source.slice(0,note.source.length-note.body.length)+body},changes,unconverted};
}
