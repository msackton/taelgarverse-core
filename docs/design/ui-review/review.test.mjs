import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const bundle = fs.readFileSync(new URL('./TaelgarVerse-UI-Review.html', import.meta.url), 'utf8');
const extract = id => bundle.match(new RegExp('<script[^>]*id="' + id + '">([\\s\\S]*?)</script>'))[1];
const pages = JSON.parse(extract('page-data'));
const reviewScript = fs.readFileSync(new URL('./review.js', import.meta.url), 'utf8');
const previewScript = fs.readFileSync(new URL('./preview.js', import.meta.url), 'utf8');

// A small event/DOM harness exercises the shipped scripts without a browser.
// It deliberately does not claim to validate CSS layout or visual rendering.
class Element {
  constructor(value = '') {
    this.value = value; this.textContent = ''; this.innerHTML = ''; this.style = {};
    this.dataset = {}; this.attributes = {}; this.children = []; this.events = {};
    this.checked = true; this.clientWidth = 1480; this.contentWindow = {};
    const classes = new Set();
    this.classList = {toggle(name, force) { force ? classes.add(name) : classes.delete(name); }, contains:name => classes.has(name)};
  }
  addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
  fire(name, event = {}) { this.events[name]?.forEach(callback => callback(event)); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  removeAttribute(name) { delete this.attributes[name]; }
  add(option) { this.children.push(option); if (this.children.length === 1) this.value = String(option.value); }
  append(child) { child.parent?.children.splice(child.parent.children.indexOf(child), 1); this.children.push(child); child.parent = this; }
  remove() { this.removed = true; }
  querySelector() { return null; }
  focus() { this.focused = true; }
  reset() { this.wasReset = true; }
  replaceChildren(...children) { this.children = children; }
  getBoundingClientRect() { return {top:200}; }
  showModal() { this.open = true; }
  close() { this.open = false; }
}
function harness() {
  const nodes = new Map();
  const get = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  get('page-data').textContent = extract('page-data');
  get('current-assets').textContent = extract('current-assets');
  get('preview-script').textContent = extract('preview-script');
  get('site-styles').textContent = bundle.match(/<style id="site-styles">([\s\S]*?)<\/style>/)[1];
  get('proposal-template').innerHTML = bundle.match(/<template id="proposal-template">([\s\S]*?)<\/template>/)[1];
  get('appearance').value = 'light'; get('palette').value = 'stone';
  const buttons = key => (key === 'design' ? ['current','classic','library','atlas'] : ['fit','desktop','tablet','mobile']).map(value => {
    const button = get(key + '-' + value); button.dataset[key] = value; return button;
  });
  const window = new Element(); window.innerHeight = 1000;
  const document = {
    getElementById:get,
    querySelectorAll:selector => buttons(selector.includes('data-design') ? 'design' : 'viewport'),
    createElement:() => new Element()
  };
  vm.runInNewContext(reviewScript, {document, window, URL, Option:class {constructor(text,value){this.text=text;this.value=value;}}, matchMedia:() => ({matches:false,addEventListener(){}}), ResizeObserver:class {observe(){}}, getComputedStyle:() => ({paddingLeft:'20px'})});
  return {get, window, click:(key,value) => get(key+'-'+value).fire('click'), source:() => get('preview-frame').srcdoc};
}
function previewData(source) { return JSON.parse(source.match(/id="preview-data">([\s\S]*?)<\/script>/)[1]); }

test('reference survives repeated design switches and page changes', () => {
  const h = harness();
  let previous = h.source();
  for (let index = 0; index < pages.length; index++) {
    h.get('review-page').value = String(index); h.get('review-page').fire('change');
    for (const design of ['classic','library','atlas']) {
      h.click('design', design);
      assert.equal(previewData(h.source()).page.title, pages[index].title);
      assert.equal(h.get('proposal-options').disabled, false);
      h.click('design', 'current');
      assert.notEqual(h.source(), previous);
      assert.ok(h.source().includes(pages[index].html.match(/<h1[^>]*>.*?<\/h1>/)?.[0] || pages[index].title));
      assert.ok(h.source().includes('reference-context'));
      assert.equal(h.get('proposal-options').disabled, true);
      previous = h.source();
    }
  }
});

test('device controls set real frame widths and preserve page, style, and preferences', () => {
  const h = harness(); h.click('design', 'library');
  h.get('review-page').value = '4'; h.get('review-page').fire('change');
  h.get('palette').value = 'plum'; h.get('show-navigation').checked = false;
  for (const [device,width] of [['mobile',390],['tablet',900],['desktop',1440],['fit',1440]]) {
    h.click('viewport', device);
    assert.equal(h.get('preview-frame').style.width, width+'px');
    assert.match(h.source(), /data-design="library".*data-palette="plum"/);
    assert.equal(previewData(h.source()).page.name, 'Green Sea');
    assert.equal(previewData(h.source()).showNavigation, false);
  }
  h.get('preview-stage').clientWidth = 430;
  h.click('viewport', 'desktop');
  assert.equal(h.get('preview-frame').style.width, '1440px');
  assert.equal(h.get('preview-size').style.width, '390px');
});

test('bundled navigation preserves anchors and ignores messages from other frames', () => {
  const h = harness();
  const href = '/page/' + pages[2].slug + '#history';
  h.window.fire('message', {source:{}, data:{kind:'preview-link', href}});
  assert.equal(h.get('review-page').value, '0');
  h.click('design', 'classic');
  h.window.fire('message', {source:h.get('preview-frame').contentWindow, data:{kind:'preview-link', href}});
  assert.equal(h.get('review-page').value, '2');
  assert.equal(previewData(h.source()).hash, '#history');
});

function proposalHarness(width = 390, page = pages[0], enabled = true, section = 'Gazetteer') {
  const nodes = new Map(), events = new Element(), messages = [];
  const get = id => { if (!nodes.has(id)) nodes.set(id,new Element()); return nodes.get(id); };
  get('preview-data').textContent = JSON.stringify({page,showNavigation:enabled,showContents:enabled});
  const closeButtons = ['navigation','search','settings'].map(name => { const button = get(name + '-close'); button.dataset.closeDialog = name + '-dialog'; return button; });
  const roots = ['Home','Campaigns','People','Gazetteer','World Map','History','More pages'].map(label => {
    const root = new Element(), link = new Element();
    link.textContent = label; link.setAttribute('href', '/section/' + label);
    root.querySelector = selector => selector === '[aria-current="page"]' ? (label === section ? link : null) :
      selector === ':scope > details > ul > li' ? (!['Home','World Map'].includes(label) ? new Element() : null) : link;
    return root;
  });
  const document = {
    getElementById:get,
    querySelector:selector => selector === '#toc a' ? (page.toc ? {} : null) : get(selector),
    querySelectorAll:selector => selector === '[data-close-dialog]' ? closeButtons : selector === '#navigation .nav-tree > li' ? roots : [],
    createElement:() => new Element(),
    addEventListener:events.addEventListener.bind(events)
  };
  const media = [];
  vm.runInNewContext(previewScript, {document,matchMedia:query => {
    const value = new Element(); value.limit = query.includes('800') ? 800 : 1100; value.matches = width <= value.limit; media.push(value); return value;
  },addEventListener(){},ResizeObserver:class {observe(){}},parent:{postMessage:message => messages.push(message)},FormData:class {constructor(form){this.form=form;} get(){return this.form.value;}}});
  return {get,events,messages,roots,resize(width) { media.forEach(value => { value.matches = width <= value.limit; }); media.forEach(value => value.fire('change')); }};
}

test('main sections become header links with active section; mobile restores the full tree', () => {
  const {get,roots,resize} = proposalHarness(1440);
  const links = get('section-links').children.map(item => item.children[0]);
  assert.deepEqual(links.map(link => link.textContent), ['Home','Campaigns','People','Gazetteer','World Map','History','More pages']);
  assert.equal(links[3].href, '/section/Gazetteer');
  assert.equal(links[3].getAttribute('aria-current'), 'location');
  assert.equal(links.filter(link => link.getAttribute('aria-current')).length, 1);
  assert.equal(roots[3].classList.contains('active-section'), true);
  assert.equal(get('.site-navigation > summary').textContent, 'Gazetteer');
  resize(390);
  assert.equal(get('.site-navigation > summary').textContent, 'Explore Taelgar');
  assert.equal(get('navigation').parent, get('navigation-dialog-body'));
  assert.equal(get('section-links').children.length, 7);
  resize(1440);
  assert.equal(get('.site-navigation > summary').textContent, 'Gazetteer');
});

test('sections without children reclaim the desktop sidebar but keep mobile section navigation', () => {
  const {get,resize} = proposalHarness(1440,pages[0],true,'Home');
  assert.equal(get('navigation').hidden,true);
  assert.equal(get('.site-layout').classList.contains('no-nav'),true);
  assert.equal(get('section-navigation').hidden,false);
  resize(390);
  assert.equal(get('navigation').hidden,false);
  assert.equal(get('navigation-toggle').hidden,false);
  assert.equal(proposalHarness(1440,pages[0],false).get('section-navigation').hidden,true);
});

test('desktop uses sidebars; mobile mounts navigation in a drawer and removes contents', () => {
  for (const width of [390,900,1440]) for (const page of [pages[0],pages[4]]) for (const enabled of [true,false]) {
    const {get} = proposalHarness(width,page,enabled);
    assert.equal(get('.site-navigation').open, true);
    assert.equal(get('navigation').hidden, !enabled);
    assert.equal(get('navigation-toggle').hidden, !enabled);
    assert.equal(get('.contents-slot').hidden, !enabled || !page.toc || width <= 800);
    assert.equal(get('.site-layout').classList.contains('no-toc'), !enabled || !page.toc || width <= 800);
    assert.equal(get('.site-layout').classList.contains('no-nav'), !enabled);
    assert.equal(get('navigation').parent, get(width <= 800 ? 'navigation-dialog-body' : '.site-layout'));
    assert.equal(get('header-search').parent, get(width <= 1100 ? 'search-dialog-body' : '#header-search-slot'));
    assert.equal(get('context-controls').parent, get(width <= 800 ? 'settings-dialog-body' : '#header-context-slot'));
    assert.match(get('context-controls').innerHTML, /See Behind the Curtain/);
    assert.equal(get('contents-title').textContent, page.title);
    assert.equal(get('#navigation .nav-search').removed, true);
  }
});

test('hamburger, search and settings open and close; resizing restores single controls to header/sidebar', () => {
  const {get,resize} = proposalHarness();
  for (const [name,button] of [['navigation','navigation-toggle'],['search','search-toggle'],['settings','settings-toggle']]) {
    get(button).fire('click'); assert.equal(get(name+'-dialog').open,true);
    get(name+'-close').fire('click'); assert.equal(get(name+'-dialog').open,false);
    get(button).fire('click');
  }
  resize(1440);
  for (const name of ['navigation','search','settings']) assert.equal(get(name+'-dialog').open,false);
  assert.equal(get('navigation').parent,get('.site-layout'));
  assert.equal(get('header-search').parent,get('#header-search-slot'));
  assert.equal(get('context-controls').parent,get('#header-context-slot'));
  assert.equal(get('search-dialog-body').children.length,0);
  assert.equal(get('.contents-slot').hidden,false);
});

test('header search submits and context changes explain the offline snapshot', () => {
  const {get,events,messages} = proposalHarness();
  get('search-toggle').fire('click');
  const form = new Element('Chardon'); form.matches = selector => selector === '.header-search';
  events.fire('submit',{target:form,preventDefault(){}});
  assert.equal(messages[0].kind,'preview-search'); assert.equal(messages[0].query,'Chardon');
  assert.equal(get('search-dialog').open,false);
  get('settings-toggle').fire('click');
  get('.context-form').fire('change',{currentTarget:get('.context-form')});
  assert.equal(get('.context-form').wasReset,true);
  assert.equal(messages[1].kind,'reference-context');
  assert.equal(get('settings-dialog').open,false);
});

test('standalone bundle has no unresolved placeholders and every generated script parses', () => {
  assert.doesNotMatch(bundle, /__(PAGE_DATA|CURRENT_ASSETS|PREVIEW_SCRIPT|REVIEW_SCRIPT)__/);
  assert.equal(extract('preview-script').trim(), previewScript.trim());
  const h = harness();
  for (const design of ['current','classic','library','atlas']) {
    h.click('design', design);
    for (const match of h.source().matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  }
});

test('proposal fragment links scroll inside srcdoc instead of opening a nested review', () => {
  const {get,events} = proposalHarness();
  let scrolled = false, prevented = false;
  get('history').scrollIntoView = () => { scrolled = true; };
  events.fire('click', {target:{closest:() => ({getAttribute:() => '#history'})},preventDefault:() => { prevented = true; }});
  assert.equal(prevented, true);
  assert.equal(scrolled, true);
});
