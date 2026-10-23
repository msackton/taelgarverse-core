import vm from 'node:vm';
import {bundleIdentity} from './bundle.mjs';
export {bundleIdentity,sha256} from './bundle.mjs';

// Evaluate the trusted pinned bundle without loading the Obsidian plugin.
// UI-only classes are inert at module evaluation; any UI use fails explicitly.
// node:vm is a compatibility context, NOT a sandbox for untrusted code.
export async function loadEngine(directory,{now=Date.now(),zone,locale='en-US'}={}) {
  const {source,identity}=await bundleIdentity(directory);
  const unsupported=name=>()=>{throw new Error('Unsupported host API: '+name);};
  class Component {constructor(){throw new Error('Obsidian components cannot run in the Node harness.');}}
  const strict=(name,value)=>new Proxy(value,{get(target,key){
    if(Object.hasOwn(target,key))return target[key];
    throw new Error('Unsupported host API: '+name+'.'+String(key));
  }});
  const obsidian=strict('obsidian',{Component,Plugin:class extends Component{},MarkdownRenderChild:class extends Component{},
    PluginSettingTab:class{},Setting:class{},TFile:class{},TFolder:class{},MarkdownView:class{},
    Platform:{isMobile:false},debounce:unsupported('debounce')});
  const modules={obsidian,
    '@codemirror/view':strict('codemirror/view',{WidgetType:class{}}),
    '@codemirror/state':strict('codemirror/state',{RangeValue:class{},StateField:{define:()=>({})},StateEffect:{define:()=>({})}}),
    '@codemirror/language':strict('codemirror/language',{})};
  const module={exports:{}};
  const context=vm.createContext({module,exports:module.exports,console,Buffer,TextEncoder,TextDecoder,
    performance,Intl,Map,Set, // Shared collections preserve instanceof checks across the worker transfer seam.
    navigator:{language:locale,userAgent:'Dataview Node comparison harness'},
    require:name=>{if(Object.hasOwn(modules,name))return modules[name];throw new Error('Unsupported module: '+name);},
    setTimeout:unsupported('setTimeout'),setInterval:unsupported('setInterval'),clearTimeout,clearInterval});
  context.window=context;context.self=context;
  vm.runInContext(source+'\nmodule.exports={DataviewApi,PageMetadata,IndexMap,ValueCaseInsensitiveIndexMap,DEFAULT_SETTINGS,Link,DateTime,Duration,Settings,Transferable};',context,{timeout:10000});
  const engine=module.exports;
  engine.Settings.now=()=>now;engine.Settings.defaultLocale=locale;
  if(zone)engine.Settings.defaultZone=zone;
  const match=source.match(/createBase64WorkerFactory\('([^']+)'/);
  if(!match)throw new Error('Dataview importer seam is unavailable.');
  let worker=Buffer.from(match[1],'base64').toString('utf8');
  const end=worker.lastIndexOf('})();');
  if(end<0)throw new Error('Dataview importer wrapper changed.');
  worker=worker.slice(0,end)+'globalThis.importPage=runImport;globalThis.transfer=Transferable.transferable;Settings.now=()=>'+JSON.stringify(now)+';'+
    'Settings.defaultLocale='+JSON.stringify(locale)+';'+(zone?'Settings.defaultZone='+JSON.stringify(zone)+';':'')+worker.slice(end);
  const importer=vm.createContext({console,Map,Set,Intl,onmessage:undefined});
  vm.runInContext(worker,importer,{timeout:10000});
  engine.parsePage=(file,contents,stat,metadata)=>engine.Transferable.value(importer.transfer(importer.importPage(file,contents,stat,metadata)));
  return {engine,identity};
}
