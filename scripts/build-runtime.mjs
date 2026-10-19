import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parse} from 'acorn';
import {pathToFileURL} from 'node:url';
import {ROOT,loadSettings} from '../src/config.mjs';

export const headerFiles = {
  DateManager:'dataUtil.js',NameManager:'nameManager.js',WhereaboutsManager:'whereabouts.js',
  TokenParser:'tokenParser.js',AffiliationManager:'affiliationManager.js',EventManager:'eventManager.js',
  OutputHandler:'outputs.js',util:'metadataUtils.js',init:'loadMetadata.js',
};

// Parse calls before translating Obsidian's prototype helpers. Never rewrite
// matching words in prose, comments, regular expressions, or string literals.
export function standardHelpers(source) {
  const ast = parse(source,{ecmaVersion:'latest',sourceType:'script'}), patches = [];
  if (ast.body.length!==1 || ast.body[0].type!=='ClassDeclaration') throw new Error('Expected one CustomJS class');
  function visit(node) {
    if (!node || typeof node!=='object') return;
    if (node.type==='CallExpression' && node.callee.type==='MemberExpression' && !node.callee.computed) {
      const property = node.callee.property;
      if (property.name==='contains') patches.push([property.start,property.end,'includes']);
      else if (['first','last'].includes(property.name) && !node.arguments.length) {
        patches.push([property.start,property.end,'at'],[node.end-1,node.end-1,property.name==='first' ? '0' : '-1']);
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value==='object') visit(value);
    }
  }
  visit(ast);
  for (const [start,end,text] of patches.sort((a,b)=>b[0]-a[0])) source=source.slice(0,start)+text+source.slice(end);
  return source;
}

export function buildRuntime(settings = loadSettings(),output = path.join(ROOT,'.generated')) {
  const writeChanged = (file,text)=>{
    if (!fs.existsSync(file) || fs.readFileSync(file,'utf8')!==text) fs.writeFileSync(file,text);
  };
  const hash = createHash('sha256');
  const declarations = Object.entries(headerFiles).map(([name,file])=>{
    const source = fs.readFileSync(path.join(settings.vault_dir,'_scripts/customJS',file),'utf8').replace(/\r\n?/g,'\n');
    hash.update(file+'\0'+source);
    return '  customJS.' + name + ' = new (' + standardHelpers(source) + ')();';
  });
  const revision = hash.digest('hex');
  fs.mkdirSync(output,{recursive:true});
  writeChanged(path.join(output,'headers.mjs'),'// Generated from trusted vault CustomJS. No runtime evaluation or global prototype changes.\n' +
    'export const headerRevision = ' + JSON.stringify(revision) + ';\nexport function instantiate({customJS,app}) {\n' +
    '  const window = {app};\n  const console = {log(){},warn(){},error(){}};\n' + declarations.join('\n') + '\n}\n');
  const names = ['octicons-info-24','octicons-location-24','octicons-people-24','material-calendar','simple-dungeonsanddragons'];
  const icons = names.map(name=>[name,fs.readFileSync(path.join(ROOT,'public/icons',name+'.svg'),'utf8')]);
  icons.push(['speaker','🔈']);
  writeChanged(path.join(ROOT,'src/icons.mjs'),'// Generated from public/icons by scripts/build-runtime.mjs.\nexport const icons = new Map(' + JSON.stringify(icons) + ');\n');
  return {revision,output};
}
if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const result=buildRuntime(); console.log('Header modules ready: ' + result.revision.slice(0,12));
}
