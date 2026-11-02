import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';

const script = await fs.readFile(new URL('../public/navigation.js',import.meta.url),'utf8');

function harness(labels,available) {
  const {document,window} = parseHTML('<nav class="breadcrumbs"><ol></ol></nav>');
  const list = document.querySelector('ol');
  for (const [index,label] of labels.entries()) {
    const item = document.createElement('li');
    const child = document.createElement(index === labels.length-1 ? 'span' : 'a');
    child.textContent = label;
    if (child.tagName === 'A') child.setAttribute('href','/page/'+index+'?date=1730-01-01&dm=1');
    else child.setAttribute('aria-current','page');
    item.append(child); list.append(item);
  }
  const items = [...list.children];
  // Simulate natural inline widths, including separators, independently of
  // the fitting code. Real CSS layout is checked in the browser.
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return {width:this.classList.contains('breadcrumb-overflow') ? 30 : this.textContent.length*7+(this === items[0] ? 0 : 20)};
  };
  Object.defineProperty(list,'clientWidth',{get:()=>available});
  let resize;
  vm.runInNewContext(script,{document,window,ResizeObserver:class {
    constructor(callback) { resize=callback; }
    observe() {}
  }});
  return {document,list,items,resize:width=>{available=width;resize();},
    visible:()=>items.filter(item=>!item.hidden).map(item=>item.textContent),
    menu:()=>[...list.querySelectorAll('.breadcrumb-overflow ul a')]};
}

test('breadcrumbs collapse oldest ancestors first and retain context links in the disclosure',()=>{
  const h = harness(['Home','Gazetteer','World of Taelgar','Greater Sembara','Sembara','Barony of Aveil','Aslain'],400);
  assert.deepEqual(h.visible(),['Home','Sembara','Barony of Aveil','Aslain']);
  assert.deepEqual(h.menu().map(link=>link.textContent),['Gazetteer','World of Taelgar','Greater Sembara']);
  assert.equal(h.list.querySelector('summary').getAttribute('aria-label'),'Show collapsed ancestors');
  assert.equal(h.document.querySelectorAll('[aria-current="page"]').length,1);
  for (const link of h.menu()) assert.match(link.getAttribute('href'),/date=1730-01-01&dm=1/);
});

test('breadcrumbs restore the whole trail on growth and handle a very long current title',()=>{
  const labels = ['Home','Places','Region','A very long current page title that cannot possibly fit'];
  const h = harness(labels,150);
  assert.deepEqual(h.visible(),[labels[0],labels[3]]);
  assert.equal(h.items.at(-1).firstElementChild.title,labels[3]);
  const details = h.list.querySelector('details'); details.open=true;
  h.resize(1000);
  assert.deepEqual(h.visible(),labels);
  assert.equal(h.menu().length,0);
  assert.equal(h.list.querySelector('.breadcrumb-overflow').hidden,true);
  assert.equal(details.open,false);
  h.resize(0); // The existing mobile breakpoint hides the trail.
  h.resize(150);
  assert.deepEqual(h.visible(),[labels[0],labels[3]]);
});

test('short trails need no middle disclosure, even with a long current page',()=>{
  const h = harness(['Home','A very long current page title'],80);
  assert.deepEqual(h.visible(),['Home','A very long current page title']);
  assert.equal(h.list.querySelector('.breadcrumb-overflow').hidden,true);
});
