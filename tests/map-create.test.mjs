import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createMapFiles,mapPngInfo,mapFilePath,decodeMapPng} from '../obsidian/taelgarverse/maps/create-map-files.mjs';
import {parseMapBlock} from '../src/map-block.mjs';
const png=await sharp({create:{width:32,height:24,channels:4,background:'transparent'}}).png().toBuffer();
function setup(){
  const files=new Map(),writes=[];
  const put=(path,data)=>{const file={path,stat:{size:data.byteLength??data.length},data};files.set(path,file);return file;};
  const app={vault:{getAbstractFileByPath:path=>files.get(path),readBinary:async file=>file.data,
    createFolder:async path=>{if(files.has(path))throw new Error('exists');files.set(path,{path,children:[]});},
    create:async(path,data)=>{if(files.has(path))throw new Error('exists');writes.push(path);return put(path,data);},
    createBinary:async(path,data)=>{if(files.has(path))throw new Error('exists');writes.push(path);return put(path,data);}}};
  const options={imagePath:'assets/maps/world.png',manifestPath:'assets/maps/world.map.json',notePath:'Maps/World.md',sourceOffset:[5000,7000]};
  const validation={validateImage:async bytes=>{await sharp(bytes).stats();},newId:()=> 'map-test'};
  return {app,files,writes,put,options,validation};
}
test('create from a vault PNG keeps source bytes and creates a usable note and adjacent manifest',async()=>{
  const h=setup();h.files.set('assets',{path:'assets',children:[]});h.files.set('assets/maps',{path:'assets/maps',children:[]});h.put(h.options.imagePath,png);
  const result=await createMapFiles(h.app,h.options,h.validation);
  assert.equal(h.files.get(h.options.imagePath).data,png);assert.deepEqual(h.writes,[h.options.manifestPath,h.options.notePath]);
  assert.deepEqual(JSON.parse(h.files.get(h.options.manifestPath).data),{version:2,image:'world.png',sourceOffset:[5000,7000]});
  assert.deepEqual(parseMapBlock(result.source),{version:2,id:'map-test',source:'assets/maps/world.map.json'});
  assert.equal(h.files.get(h.options.notePath).data,'```taelgar-map\n'+result.source+'```\n');
});
test('import writes the exact PNG bytes before the manifest and note, creating parent folders',async()=>{
  const h=setup();await createMapFiles(h.app,{...h.options,imageBytes:png},h.validation);
  assert.deepEqual(Buffer.from(h.files.get(h.options.imagePath).data),png);
  assert.deepEqual(h.writes,[h.options.imagePath,h.options.manifestPath,h.options.notePath]);
  assert.ok(h.files.get('Maps').children);assert.ok(h.files.get('assets/maps').children);
});
test('collisions, invalid offsets, unsafe paths and failed decoding cause no file writes',async()=>{
  for(const property of ['imagePath','manifestPath','notePath']){
    const h=setup();h.put(h.options[property],'Keep me');
    await assert.rejects(createMapFiles(h.app,{...h.options,imageBytes:png},h.validation),/Already exists/);assert.deepEqual(h.writes,[]);assert.equal(h.files.get(h.options[property]).data,'Keep me');
  }
  for(const patch of [{sourceOffset:[-1,0]},{sourceOffset:[99999,0]},{sourceOffset:[1.5,0]},{notePath:'../Escape.md'},{manifestPath:'elsewhere/world.map.json'}]){
    const h=setup();await assert.rejects(createMapFiles(h.app,{...h.options,...patch,imageBytes:png},h.validation));assert.deepEqual(h.writes,[]);
  }
  const h=setup();await assert.rejects(createMapFiles(h.app,{...h.options,imageBytes:png},{validateImage:async()=>{throw new Error('decode failed');}}),/decode failed/);assert.deepEqual(h.writes,[]);
});
test('cancel during validation does not create files; concurrent output creation is detected',async()=>{
  const h=setup();await assert.rejects(createMapFiles(h.app,{...h.options,imageBytes:png},{...h.validation,isOpen:()=>false}),/cancelled/);assert.deepEqual(h.writes,[]);
  await assert.rejects(createMapFiles(h.app,{...h.options,imageBytes:png},{...h.validation,validateImage:async()=>{h.put(h.options.notePath,'Other writer');}}),/Already exists/);
  assert.deepEqual(h.writes,[]);assert.equal(h.files.get(h.options.notePath).data,'Other writer');
});
test('failed note creation reports retained files without deleting or overwriting them',async()=>{
  const h=setup(),create=h.app.vault.create;
  h.app.vault.create=async(p,text)=>{if(p===h.options.notePath)throw new Error('disk full');return create(p,text);};
  await assert.rejects(createMapFiles(h.app,{...h.options,imageBytes:png},h.validation),/Files retained for recovery: assets\/maps\/world.png, assets\/maps\/world.map.json/);
  assert.deepEqual(Buffer.from(h.files.get(h.options.imagePath).data),png);assert.ok(h.files.has(h.options.manifestPath));assert.ok(!h.files.has(h.options.notePath));
});
test('PNG preflight rejects truncated, animated and oversized files before browser decoding',()=>{
  assert.deepEqual(mapPngInfo(png),{width:32,height:24});
  assert.throws(()=>mapPngInfo(png.subarray(0,33)),/end chunk/);assert.throws(()=>mapPngInfo(Buffer.from('JPEG')),/static PNG/);
  const large=Buffer.from(png);large.writeUInt32BE(50001,16);assert.throws(()=>mapPngInfo(large),/dimensions/);
  const animated=Buffer.from(png);animated.write('acTL',37,'ascii');assert.throws(()=>mapPngInfo(animated),/Animated/);
  for(const name of ['../x.png','/x.png','.obsidian/x.png','assets//x.png','assets/x?.png','assets\\x.png',' x.png'])assert.throws(()=>mapFilePath(name,'.png'));
});
test('browser decoder checks actual pixels and releases temporary URLs on success and failure',async()=>{
  const revoked=[];let fail=false;
  const doc={defaultView:{Blob,URL:{createObjectURL:()=> 'blob:map',revokeObjectURL:url=>revoked.push(url)},Image:class{naturalWidth=32;naturalHeight=24;async decode(){if(fail)throw new Error('bad pixels');}}}};
  assert.deepEqual(await decodeMapPng(png,doc),{width:32,height:24});fail=true;await assert.rejects(decodeMapPng(png,doc),/bad pixels/);assert.equal(revoked.length,2);
});


test('source changes during decoding require a fresh selection and manifest suffixes stay loadable',async()=>{
  const h=setup();h.put(h.options.imagePath,png);
  await assert.rejects(createMapFiles(h.app,h.options,{...h.validation,validateImage:async()=>{h.files.get(h.options.imagePath).stat.mtime=2;}}),/source PNG changed/);
  assert.deepEqual(h.writes,[]);assert.throws(()=>mapFilePath('assets/world.MAP.JSON','.map.json'));
});
