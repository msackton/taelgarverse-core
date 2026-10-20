import test from 'node:test';
import assert from 'node:assert/strict';
import {createSearchController,searchParameters,highlightPieces,suggestionPosition} from '../public/search-overlay.js';

test('floating search preserves context, repeated campaign choices and normal query encoding',()=>{
  const params=searchParameters([['date','1730-01-01'],['context','custom'],['campaigns','dufr'],['campaigns','adma'],['dm','1'],['type','person'],['q','stale'],['offset','100'],['unrelated','discard']], '"Green Sea" & elves',20);
  assert.deepEqual(params.getAll('campaigns'),['dufr','adma']);
  assert.equal(params.get('date'),'1730-01-01');assert.equal(params.get('context'),'custom');assert.equal(params.get('dm'),'1');
  assert.equal(params.get('q'),'"Green Sea" & elves');assert.equal(params.get('offset'),'20');assert.equal(params.get('limit'),'20');
  assert.equal(params.has('unrelated'),false);assert.equal(params.get('type'),'person');
  assert.equal(searchParameters(params,'new query').get('type'),'person');
  assert.equal(searchParameters(params,'new query').has('offset'),false);
  assert.equal(new URLSearchParams(params.toString()).get('q'),'"Green Sea" & elves');
});

test('a newer query and closing the panel invalidate late responses even when abort is ignored',async()=>{
  const requests=[],seen=[],errors=[];
  const controller=createSearchController({search:(params,signal)=>new Promise((resolve,reject)=>requests.push({params,signal,resolve,reject})),
    onPending(){},onIdle(){},onResults:data=>seen.push(data),onError:error=>errors.push(error)});
  const old=controller.update(new URLSearchParams({q:'old'}),{immediate:true});
  const current=controller.update(new URLSearchParams({q:'current'}),{immediate:true});
  assert.equal(requests[0].signal.aborted,true);
  requests[1].resolve('current result');await current;
  requests[0].resolve('obsolete result');await old;
  assert.deepEqual(seen,['current result']);
  const closing=controller.update(new URLSearchParams({q:'closing'}),{immediate:true});
  controller.cancel();requests[2].resolve('closed result');await closing;
  const failing=controller.update(new URLSearchParams({q:'failure'}),{immediate:true});
  controller.cancel();requests[3].reject(new Error('late failure'));await failing;
  assert.deepEqual(seen,['current result']);assert.deepEqual(errors,[]);
});

test('typing is debounced, parameters are snapshotted and clearing cancels queued work',async()=>{
  const timers=new Map(),requests=[];let id=0,idle=0;
  const controller=createSearchController({search:async params=>{requests.push(params.toString());return {};},onPending(){},onResults(){},onError(){},onIdle(){idle++;},
    setTimer:(callback,delay)=>{assert.equal(delay,200);timers.set(++id,callback);return id;},clearTimer:key=>timers.delete(key)});
  controller.update(new URLSearchParams({q:'g'}));
  const params=new URLSearchParams({q:'green',campaigns:'dufr'});controller.update(params);
  params.set('campaigns','all');assert.equal(timers.size,1);
  await [...timers.values()][0]();
  assert.match(requests[0],/campaigns=dufr/);
  controller.update(new URLSearchParams({q:'pending'}));
  controller.update(new URLSearchParams({q:'  '}));
  assert.equal(timers.size,0);assert.equal(idle,1);assert.equal(requests.length,1);
});

test('active errors surface and a fresh request can recover',async()=>{
  const errors=[],seen=[];let fail=true;
  const controller=createSearchController({search:async()=>{if(fail)throw new Error('offline');return 'recovered';},onPending(){},onIdle(){},onError:error=>errors.push(error.message),onResults:data=>seen.push(data)});
  await controller.update(new URLSearchParams({q:'term'}),{immediate:true});
  fail=false;await controller.update(new URLSearchParams({q:'term'}),{immediate:true});
  assert.deepEqual(errors,['offline']);assert.deepEqual(seen,['recovered']);
});

test('excerpt highlights preserve literal text and reject malformed or overlapping ranges',()=>{
  const excerpt='🌿 <script> Green Sea';
  const pieces=highlightPieces(excerpt,[{start:3,end:11},{start:4,end:7},{start:-1,end:2},{start:12,end:17},{start:18,end:9000}]);
  assert.equal(pieces.map(part=>part.text).join(''),excerpt);
  assert.deepEqual(pieces.filter(part=>part.match).map(part=>part.text),['<script>','Green']);
  assert.deepEqual(highlightPieces('safe',null),[{text:'safe',match:false}]);
});

test('a selected content type can browse pages without a search phrase',async()=>{
  const queries=[];let idle=0;
  const controller=createSearchController({search:async params=>{queries.push(params.toString());return {};},onPending(){},onResults(){},onError(){},onIdle(){idle++;}});
  await controller.update(new URLSearchParams({q:'',type:'place'}),{immediate:true});
  assert.deepEqual(queries,['q=&type=place']);assert.equal(idle,0);
  await controller.update(new URLSearchParams({q:'',type:''}),{immediate:true});
  assert.equal(queries.length,1);assert.equal(idle,1);
});

test('search suggestions fit below the field and stay within narrow or shifted viewports',()=>{
  const desktop=suggestionPosition({left:280,top:10,bottom:48},{left:0,top:0,width:1280,height:720});
  assert.equal(desktop.edge,54);assert.equal(desktop.left,280);assert.equal(desktop.above,false);
  const phone=suggestionPosition({left:18,top:70,bottom:114},{left:0,top:0,width:390,height:400});
  assert.equal(phone.width,366);assert.equal(phone.left,12);assert.equal(phone.edge,120);
  assert.equal(phone.maxHeight,268);
  const bottom=suggestionPosition({left:600,top:600,bottom:644},{left:0,top:0,width:800,height:720});
  assert.equal(bottom.above,true);assert.equal(bottom.edge,594);assert.equal(bottom.left+bottom.width,788);
  assert.equal(suggestionPosition({left:0,top:900,bottom:944},{left:0,top:0,width:390,height:400}),null);
  const shifted=suggestionPosition({left:10,top:100,bottom:144},{left:5,top:80,width:320,height:300});
  assert.ok(shifted.left>=17);assert.ok(shifted.edge+shifted.maxHeight<=368);
});
