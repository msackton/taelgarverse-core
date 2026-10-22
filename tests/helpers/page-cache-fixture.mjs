import fs from 'node:fs';
import {ContentStore,parseNote} from '../../src/content-store.mjs';
import {buildBacklinkIndex} from '../../src/backlinks.mjs';
import {compileRuntime} from '../../scripts/compile-runtime.mjs';

const coreMeta=JSON.parse(fs.readFileSync(new URL('../fixtures/runtime-v1.json',import.meta.url),'utf8')).index.coreMeta;
export const coreRelease={commit:'c'.repeat(40),dirty:false,publishedAt:'2026-10-21T12:00:00.000Z'};
export function publication({revision='a'.repeat(64),text='Original biography.',linked='Other',home='# Welcome\n\n[[Person]]',siteCampaigns='dufr'}={}) {
  const notes={
    'Person.md':'---\ntags: [person]\nborn: 1700-01-01\n---\n<!-- taelgar:header -->\n\n'+text+' [['+linked+']]\n\n%% secret detail %%\n\n%%^Campaign:dufr%%Frontier paragraph.%%^End%%\n\n%%^Date:1730-01-01%%Later paragraph.%%^End%%',
    [linked+'.md']:'Reference [[Person]].',
    'Future.md':'---\nPOV: 1750s\n---\nFuture body.',
    'Broken.md':'%% unclosed',
    'Frontier Session.md':'---\ntags: [session-note]\ncampaign: dufr\nDR: 1745-01-01\n---\nSession.',
    'Adder Session.md':'---\ntags: [session-note]\ncampaign: adma\nDR: 1740-01-01\n---\nSession.',
  };
  const entries=Object.entries(notes).map(([id,source])=>({id,name:id.slice(0,-3),title:id.slice(0,-3),extension:'.md',
    target:id.toLowerCase().replaceAll(' ','-'),slug:id.slice(0,-3).toLowerCase().replaceAll(' ','-'),note:parseNote(source)}));
  const settings={default_date:'1748-01-01',campaigns:[],respect_pov_dates:true},store=new ContentStore(entries,[],settings);
  const index={entries,settings,warnings:[],sourceVersion:{commit:'d'.repeat(40),dirty:false},coreMeta,
    registry:{campaigns:{frontier:{name:'Frontier',code:'dufr'},adder:{name:'Adder',code:'adma'}}},backlinks:buildBacklinkIndex(store),
    navigationSource:'- [Home](index.md)\n- World\n    - {glob: .}',homeSource:home,
    campaignHomes:{frontier:'---\ncampaigns: ['+siteCampaigns+']\nenforcePoV: 1\n---\n# Campaign home'}};
  const compiled=compileRuntime(index,store),pointer={revision,commit:'d'.repeat(40),dirty:false,completedAt:'2026-10-21T10:00:00.000Z'};
  const objects=new Map([...compiled.objects].map(([file,json])=>['revisions/'+revision+'/'+file,json]));
  objects.set('revisions/'+revision+'/runtime.json',JSON.stringify({...compiled.manifest,revision}));
  objects.set('published/current.json',JSON.stringify(pointer));
  return {objects,pointer};
}

export class Bucket {
  constructor(objects) {this.objects=new Map(objects);this.calls=[];}
  async get(key) {
    this.calls.push(key);
    const value=this.objects.get(key);
    return value===undefined ? null : {text:async()=>value,json:async()=>JSON.parse(value)};
  }
}

export class PageCache {
  constructor() {this.values=new Map();this.matches=[];this.puts=[];}
  async match(request) {
    this.matches.push(request.url);
    const value=this.values.get(request.url);
    return value ? new Response(value.body,{status:200,headers:value.headers}) : undefined;
  }
  async put(request,response) {
    this.puts.push(request.url);
    this.values.set(request.url,{body:await response.text(),headers:[...response.headers]});
  }
}
