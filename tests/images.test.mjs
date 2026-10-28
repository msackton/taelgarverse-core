import {testSettings} from './helpers/test-settings.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {load} from 'cheerio';
import sharp from 'sharp';
import {prepareImages,usedImageWidths} from '../scripts/build-images.mjs';
import {collectImageUsages} from '../scripts/image-usage.mjs';
import {ContentStore} from '../src/content-store.mjs';
import {responsiveImages} from '../src/images.mjs';
import {ROOT,isInside} from '../src/config.mjs';
import {Engine} from '../src/engine.mjs';
import {createServer} from '../src/server.mjs';
import {prepareContent} from '../scripts/prepare-cloudflare.mjs';
import {createWorker} from '../src/worker-handler.mjs';
import {createMarkdown,renderMarkdown} from '../src/markdown.mjs';

async function fixture(t) {
  await fs.mkdir(path.join(ROOT,'.cache'),{recursive:true});
  const directory = await fs.mkdtemp(path.join(ROOT,'.cache','responsive-test-'));
  t.after(async()=>{
    const resolved = await fs.realpath(directory);
    assert.ok(isInside(await fs.realpath(path.join(ROOT,'.cache')),resolved));
    await fs.rm(resolved,{recursive:true});
  });
  const filename = path.join(directory,'portrait.jpg');
  const pixels = Buffer.alloc(1800*1200*3);
  for (let i=0;i<pixels.length;i++) pixels[i] = (i*37+(i>>>9)*19)%256;
  await sharp(pixels,{raw:{width:1800,height:1200,channels:3}}).jpeg({quality:95}).toFile(filename);
  const entry = {id:'portrait.jpg',target:'portrait.jpg',extension:'.jpg',filename,note:null};
  const body='![[portrait.jpg|320]]';
  const gallery={id:'Gallery.md',target:'gallery.md',slug:'gallery',name:'Gallery',title:'Gallery',note:{metadata:{},body,source:body}};
  return {directory,entry,store:new ContentStore([entry,gallery],[])};
}

test('responsive derivatives retain original bytes, cache safely, never upscale, and keep full size out of inline candidates',async t=>{
  const {directory,entry,store} = await fixture(t), original = await fs.readFile(entry.filename);
  const cache = path.join(directory,'cache');
  const stats = await prepareImages(store,cache);
  assert.equal(stats.images,1);assert.equal(stats.variants,3);
  assert.deepEqual(await fs.readFile(entry.filename),original);
  assert.equal(entry.image.width,1800);assert.equal(entry.image.variants.at(-1).width,1800);
  const small = entry.image.variants.find(item=>item.width===320);
  assert.ok(small.bytes<original.length/4);
  const asset = store.assets.get(small.url.slice(8)), timestamp = (await fs.stat(asset.filename)).mtimeMs;
  await prepareImages(store,cache);
  assert.equal((await fs.stat(asset.filename)).mtimeMs,timestamp);
  await fs.unlink(asset.filename);
  await prepareImages(store,cache);
  assert.equal((await sharp(await fs.readFile(asset.filename)).metadata()).width,320);
  const html = responsiveImages('<p><img src="/assets/portrait.jpg" width="200" alt="Portrait"></p><p><img src="/assets/portrait.jpg"></p>',store), $ = load(html);
  assert.match($('img').first().attr('src'),/image-variants/);
  assert.equal($('img').first().attr('data-image-full'),'/assets/portrait.jpg');
  assert.equal($('img').first().attr('height'),'133');assert.match($('img').first().attr('sizes'),/200px/);
  assert.equal($('img').first().attr('loading'),'eager');assert.equal($('img').last().attr('loading'),'lazy');
  assert.match($('img').last().attr('sizes'),/^auto, /);
  assert.doesNotMatch($('img').first().attr('srcset'),/1800w|1920w|2560w|portrait.jpg/);
  assert.equal(JSON.parse($('img').first().attr('data-image-variants')).at(-1).width,1800);
});

test('authored callout, gallery and session captions stay attached to each image without replacing accessible alt text',async t=>{
  const {store} = await fixture(t), entry = store.bySlug.get('gallery');
  const source = [
    '> [!image|right standard] Hidden title\n> ![[portrait.jpg]]\n> *Delwath in Karawa as our campaign begins.*',
    '> [!image|figure large]\n> ![[portrait.jpg]]\n>\n> A **second** view with [context](https://example.test/).',
    '> [!image|hero]- Folded title\n> ![[portrait.jpg]]\n> *An establishing view.*',
    '> [!gallery]\n> - ![[portrait.jpg]]\n>   *The temple exterior.*\n> - ![[portrait.jpg]]\n>   *The central sanctuary.*',
    '<figure class="taelgar-session-zoom__image"><img src="/assets/portrait.jpg" alt="Visual description"><figcaption>A session caption.</figcaption></figure>',
    '![[portrait.jpg]]',
    '> [!image|right] Title is not a caption\n> ![[portrait.jpg]]',
    '<figure><img src="/assets/portrait.jpg" alt="Safe alt"><figcaption>&lt;img src=x onerror=alert(1)&gt; &amp; "quoted"</figcaption></figure>',
  ].join('\n\n');
  const rendered = renderMarkdown(createMarkdown(),source,{store,entry,date:'1750-01-01',context:{date:'1750-01-01',campaigns:[]},warnings:[]});
  const $ = load(responsiveImages(rendered.html,store));
  assert.deepEqual($('img').map((_,el)=>$(el).attr('data-image-caption') || '').get(),[
    'Delwath in Karawa as our campaign begins.',
    'A second view with context.',
    'An establishing view.',
    'The temple exterior.',
    'The central sanctuary.',
    'A session caption.',
    '', '', '<img src=x onerror=alert(1)> & "quoted"',
  ]);
  assert.equal($('img').first().attr('alt'),'Portrait');
  assert.equal($('figure img').first().attr('alt'),'Visual description');
  assert.equal($('.admonition.image em').first().text(),'Delwath in Karawa as our campaign begins.');
  assert.equal($('figcaption img').length,0,'caption text is not interpreted as markup');
  assert.equal($('.admonition.image a').first().attr('href'),'https://example.test/');
  const repeated = load(responsiveImages($.html(),store));
  assert.equal(repeated('img').first().attr('data-image-caption'),$('img').first().attr('data-image-caption'));
});

test('caption extraction ignores unrelated prose, ambiguous groups, hidden text and Behind the Curtain controls',()=>{
  const store = {assets:new Map()};
  const $ = load(responsiveImages([
    '<p><img src="image.png" alt="Alt only"> Ordinary article prose.</p>',
    '<figure><img src="a.png"><img src="b.png"><figcaption>Ambiguous shared caption.</figcaption></figure>',
    '<div class="admonition image"><p class="admonition-title">Hidden title</p><p><img src="c.png"><br><em>Visible caption.</em><sup class="dm-note-ref"><button>1</button></sup><span hidden>Hidden words</span></p><div popover>Private popup</div></div>',
    '<figure><img src="d.png" data-image-caption="Explicit caption"><figcaption>Other caption</figcaption></figure>',
    '<figure><img src="e.png"><figcaption> </figcaption></figure>',
  ].join('\n'),store));
  assert.deepEqual($('img').map((_,el)=>$(el).attr('data-image-caption') || '').get(),['','','','Visible caption.','Explicit caption','']);
});

test('PNG transparency and pixels survive lossless conversion; animations and authored image choices stay intact',async t=>{
  const {directory,store} = await fixture(t);
  const png = path.join(directory,'drawing.png'), bytes = await sharp({create:{width:80,height:40,channels:4,background:'#468acf80'}}).png().toBuffer();
  await fs.writeFile(png,bytes);
  const drawing = {id:'drawing.png',target:'drawing.png',extension:'.png',filename:png,note:null};
  store.entries.push(drawing);store.assets.set(drawing.target,drawing);
  store.canonical.set(drawing.id,new Set([drawing]));
  const animation = path.join(directory,'animated.webp');
  const frames = Buffer.alloc(8*16*3,180);frames.fill(230,frames.length/2);
  await sharp(frames,{raw:{width:8,height:16,channels:3,pageHeight:8}}).webp({loop:0,delay:[100,100]}).toFile(animation);
  const animated = {id:'animated.webp',target:'animated.webp',extension:'.webp',filename:animation,note:null};
  store.entries.push(animated);store.assets.set(animated.target,animated);
  store.canonical.set(animated.id,new Set([animated]));
  store.bySlug.get('gallery').note.body+='\n![[drawing.png|80]]\n![[animated.webp]]\n';
  await prepareImages(store,path.join(directory,'cache'));
  assert.equal(animated.image,undefined);
  const converted = store.assets.get(drawing.image.variants[0].url.slice(8));
  assert.equal((await sharp(await fs.readFile(converted.filename)).metadata()).hasAlpha,true);
  assert.deepEqual(await sharp(await fs.readFile(converted.filename)).raw().toBuffer(),await sharp(bytes).raw().toBuffer());
  const $ = load(responsiveImages('<details><summary>Hidden</summary><img src="/assets/drawing.png"></details><img src="/assets/drawing.png" loading="lazy" srcset="custom.webp 2x"><span class="twemoji"><img src="emoji.png"></span>',store));
  assert.equal($('details img').attr('loading'),'lazy');assert.equal($('img').eq(1).attr('srcset'),'custom.webp 2x');
  assert.equal($('.twemoji img').attr('loading'),undefined);
});

test('fixed declared widths generate only used 1x/2x sizes and a popup; nearby/reused widths combine without upscaling',()=>{
  assert.deepEqual(usedImageWidths(1800,1200,[[{width:300}]]),[
    {width:300,inline:true},{width:600,inline:true},{width:1800,inline:false},
  ]);
  assert.deepEqual(usedImageWidths(1800,1200,[[{width:240}],[{width:300}]]).filter(item=>item.inline).map(item=>item.width),[300,600]);
  assert.deepEqual(usedImageWidths(200,100,[[{width:300}]]),[{width:200,inline:true}]);
  assert.deepEqual(usedImageWidths(1800,1200,[[{height:200}]]).filter(item=>item.inline).map(item=>item.width),[300,600]);
  const chain=usedImageWidths(1800,1200,[[{width:300}],[{width:375}],[{width:468}]]).filter(item=>item.inline);
  for (const required of [300,375,468,600,750,936]) assert.ok(chain.some(item=>item.width>=required && item.width<=required*1.25),'merged size stays within 25% of '+required);
});

test('usage planning finds alternative reference definitions, DM images, HTML, tables and homepage images while omitting unused/literal/administrative references',async t=>{
  const {directory,entry} = await fixture(t);
  const media = ['portrait.jpg','public.jpg','dm.jpg','unused.jpg','code.jpg','admin.jpg','home.jpg','html.jpg','table.jpg'].map(name=>({...entry,id:name,target:name,filename:path.join(directory,name)}));
  const body=[
    '![[portrait.jpg|300]]','![Alternative][view]',
    '%%^Date:1750%%','[view]: dm.jpg','%%^End%%',
    '%%^Date:1750b%%','[view]: public.jpg','%%^End%%',
    '%%DM ![[dm.jpg|400]]%%',
    '%%^Metadata:images%%','![[admin.jpg]]','%%^End%%',
    '```markdown','![[code.jpg]]','```',
    '<img src="html.jpg" width="200">','',
    '| Image |','| --- |','| ![[table.jpg]] |',
  ].join('\n');
  const page={id:'Gallery.md',target:'gallery.md',slug:'gallery',name:'Gallery',title:'Gallery',note:{metadata:{},body,source:body}};
  const store=new ContentStore([...media,page],[]), plan=collectImageUsages(store,{homeSource:'![[home.jpg|240]]'});
  for (const name of ['portrait.jpg','public.jpg','dm.jpg','home.jpg','html.jpg','table.jpg']) assert.ok(plan.has(name),name);
  for (const name of ['unused.jpg','code.jpg','admin.jpg']) assert.equal(plan.has(name),false,name);
  assert.deepEqual(plan.get('portrait.jpg'),[[{width:300}]]);
  assert.deepEqual(plan.get('table.jpg'),[[{width:90,height:90}]]);
  assert.deepEqual(plan.get('html.jpg'),[[{width:200}]]);
  await prepareImages(store,path.join(directory,'cache'),{usages:new Map([['portrait.jpg',plan.get('portrait.jpg')]])});
  assert.ok(store.assets.get('portrait.jpg').image);
  assert.equal(store.assets.get('unused.jpg').image,undefined);
});

test('Node and Worker serve small image variants with original downloads, ranges, cache validation and context filtering',async t=>{
  const {directory,entry} = await fixture(t), original = await fs.readFile(entry.filename);
  await fs.writeFile(path.join(directory,'Gallery.md'),'# Gallery\n\n> [!image|figure]\n> ![[portrait.jpg|200]]\n> *Shared caption.* %%DM Private caption.%%\n\n%%^Campaign:none%%\n![[portrait.jpg]]\n%%^End%%\n');
  const settings = {...testSettings(),source_dir:directory,nav_source:null,home_source:null};
  const engine = new Engine(settings), server = createServer(engine);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base = 'http://127.0.0.1:'+server.address().port;
  const local = await (await fetch(base+'/api/page?page=Gallery')).json(), $local = load(local.html);
  assert.equal($local('img').length,1);
  assert.equal($local('img').attr('data-image-caption'),'Shared caption.');
  const smallURL = $local('img').attr('src');
  const small = await fetch(base+smallURL);assert.match(small.headers.get('content-type'),/image\/webp/);
  assert.ok((await small.arrayBuffer()).byteLength<original.length/4);
  assert.deepEqual(Buffer.from(await (await fetch(base+'/assets/portrait.jpg')).arrayBuffer()),original);
  const report = await prepareContent(settings,path.join(directory,'package'));
  const uploads = JSON.parse(await fs.readFile(report.manifestFile,'utf8')), index = JSON.parse(await fs.readFile(report.indexFile,'utf8'));
  const objects = new Map(uploads.map(item=>[item.key,item.file])), reads = [];
  const bucket = {async get(key,options={}) {
    reads.push(key);
    if (key==='published/current.json') return {json:async()=>({revision:report.revision})};
    if (!objects.has(key)) return null;
    const data = await fs.readFile(objects.get(key)), range = options.range;
    return {size:data.length,json:async()=>JSON.parse(data),body:new Blob([range ? data.subarray(range.offset,range.offset+range.length) : data]).stream()};
  }};
  const worker = createWorker(), env = {CONTENT:bucket,ASSETS:{fetch:async()=>new Response('')}};
  const request = (url,headers={},method='GET')=>worker.fetch(new Request('https://example.test'+url,{headers,method}),env);
  const page = await (await request('/api/page?page=Gallery')).json(), $ = load(page.html);
  assert.equal($('img').length,1);assert.equal($('img').attr('src'),smallURL);
  assert.equal($('img').attr('data-image-caption'),'Shared caption.');
  const full = index.entries.find(item=>item.id==='portrait.jpg');
  assert.ok(!reads.includes(full.objectKey),'rendering must not fetch original image bytes');
  const dmPage = load((await (await request('/api/page?page=Gallery&dm=1')).json()).html);
  assert.equal(dmPage('img').length,2);
  assert.equal(dmPage('img').first().attr('data-image-caption'),'Shared caption.');
  assert.equal(dmPage('img').last().attr('data-image-caption'),undefined);
  const response = await request(smallURL), data = Buffer.from(await response.arrayBuffer());
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/image\/webp/);
  assert.match(response.headers.get('cache-control'),/immutable/);
  assert.equal((await request(smallURL,{'If-None-Match':response.headers.get('etag')})).status,304);
  assert.equal((await request(smallURL,{},'HEAD')).headers.get('content-length'),String(data.length));
  const range = await request(smallURL,{Range:'bytes=0-15'});assert.equal(range.status,206);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()),data.subarray(0,16));
  assert.deepEqual(Buffer.from(await (await request('/assets/portrait.jpg')).arrayBuffer()),original);
  assert.ok(index.entries.some(item=>item.generatedImageVariant && item.objectKey));
  assert.ok(!JSON.stringify(index).includes(directory));
});
