import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script = fs.readFileSync(new URL('../public/site-ui.js',import.meta.url),'utf8');
function page({height=5000,viewport=800,reduced=false,titleText}={}) {
  const events = {}, frames = [];
  let resize, click, headerHeight=64;
  const root = {scrollHeight:height,style:{setProperty(){}},classList:{add(){}}};
  const header = {getBoundingClientRect:()=>({bottom:headerHeight,height:headerHeight})};
  const brandLabel = {textContent:'TaelgarVerse'}, logo = {};
  const brand = {querySelector:selector=>selector==='.site-brand-label' ? brandLabel : selector==='img' ? logo : null,
    classList:{toggle(){}},setAttribute(){},focus(){},
    get textContent(){return brandLabel.textContent;},
    set textContent(value){throw new Error('Replacing brand content would remove the home icon');}};
  const title = titleText ? {textContent:titleText,getBoundingClientRect:()=>({bottom:180-context.scrollY})} : null;
  const back = {hidden:true,addEventListener:(event,callback)=>{if(event==='click') click=callback;}};
  const nodes = {'site-header':header,'back-to-top':back};
  const context = {
    document:{documentElement:root,getElementById:id=>nodes[id] || null,
      querySelector:selector=>selector==='.site-brand' ? brand : selector==='.article-main h1' ? title : null,querySelectorAll:()=>[]},
    matchMedia:query=>({matches:query.includes('reduced-motion') && reduced}),
    scrollY:0,innerHeight:viewport,
    addEventListener:(event,callback)=>{events[event]=callback;},
    requestAnimationFrame:callback=>frames.push(callback),
    ResizeObserver:class {constructor(callback){resize=callback;} observe(){resize();}},
    scrollTo:options=>{context.lastScroll=options;}
  };
  vm.runInNewContext(script,context);
  return {back,brand,brandLabel,logo,context,click:()=>click(),
    scroll(y){context.scrollY=y;events.scroll();},
    resize(y){if(y!==undefined) context.scrollY=y;headerHeight=72;resize();},
    frame(){while(frames.length) frames.shift()();},
    event(name,data={}){events[name](data);}
  };
}

test('back to top appears on small upward scrolls, including pages shorter than 500px of travel',()=>{
  const p=page({height:1200});
  p.scroll(250); assert.equal(p.back.hidden,true);
  p.scroll(249); assert.equal(p.back.hidden,false);
  p.scroll(250); assert.equal(p.back.hidden,false); // Ignore tiny downward jitter.
  p.scroll(262); assert.equal(p.back.hidden,true);
  p.scroll(261); assert.equal(p.back.hidden,false);
  p.scroll(64); assert.equal(p.back.hidden,true);
});

test('header resizing and animation-frame batching do not consume upward scroll movement',()=>{
  const p=page();
  p.scroll(900); p.frame();
  p.resize(898); // ResizeObserver runs before the scroll event.
  p.scroll(898); p.resize(); p.frame();
  assert.equal(p.back.hidden,false);
});

test('smooth return stays hidden but user interruption allows the next upward scroll',()=>{
  for (const event of ['wheel','touchstart','pointerdown','scrollend','keydown']) {
    const p=page();
    p.scroll(900); p.scroll(898); p.click();
    assert.equal(p.context.lastScroll.top,0);
    assert.equal(p.context.lastScroll.behavior,'smooth');
    p.scroll(800); assert.equal(p.back.hidden,true);
    p.event(event,{key:'ArrowUp'});
    p.scroll(799); assert.equal(p.back.hidden,false,event);
  }
});

test('elastic overscroll does not show the control and reduced motion returns immediately',()=>{
  const p=page({height:1200,reduced:true});
  p.scroll(400); p.scroll(450); p.scroll(400);
  assert.equal(p.back.hidden,true);
  p.scroll(399); assert.equal(p.back.hidden,false);
  p.click(); assert.equal(p.context.lastScroll.behavior,'instant');
  p.scroll(0); p.scroll(-30); p.scroll(0);
  assert.equal(p.back.hidden,true);
});

test('scrolling replaces only the brand label and keeps the home icon',()=>{
  const p=page({titleText:'A long article title'});
  assert.equal(p.brandLabel.textContent,'TaelgarVerse');
  p.scroll(300); p.frame();
  assert.equal(p.brandLabel.textContent,'A long article title');
  assert.equal(p.brand.querySelector('img'),p.logo);
  p.scroll(0); p.frame();
  assert.equal(p.brandLabel.textContent,'TaelgarVerse');
  assert.equal(p.brand.querySelector('img'),p.logo);
});
