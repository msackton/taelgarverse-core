import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {Navigation} from '../src/navigation.mjs';

const entry = (target,title,metadata = {})=>({id:target,target,title,slug:target.slice(0,-3),note:{metadata}});
const context = {id:'custom',kind:'custom',date:'1730-01-01',campaigns:[],dm:true};
const entries = [
  entry('people/people.md','People'), entry('people/humans/zora.md','Zora'), entry('people/humans/anna.md','Anna'),
  entry('places/region/region.md','The Region'),entry('places/region/town.md','Town'),
  entry('places/future.md','Future',{activeYear:1740}), entry('places/campaign.md','Campaign',{excludePublish:['one']}),
  entry('extra/other.md','Other'),
];
const source = '- [Home](index.md)\n- [People](people/people.md)\n    - {glob: people/, exclude: people.md}\n' +
  '- Places\n    - {glob: places/}\n- Flat\n    - {glob: people/;places/;flatten, exclude: people.md;future.md}\n' +
  '- [Unpublished](missing.md)\n';
const navigation = () => new Navigation({entries},source);

test('curated order, natural leaf ordering, directory indexes and fallback coverage',()=>{
  const nav = navigation();
  assert.deepEqual(nav.roots.slice(0,4).map(node=>node.label),['Home','People','Places','Flat']);
  const humans = nav.roots[1].children[0];
  assert.equal(humans.label,'Humans');
  assert.deepEqual(humans.children.map(node=>node.label),['Anna','Zora']);
  const region = nav.roots[2].children.find(node=>node.label==='The Region');
  assert.equal(region.entry.slug,'places/region/region');
  assert.deepEqual(region.children.map(node=>node.label),['Town']);
  assert.equal(nav.roots[3].children.some(node=>node.label==='Future'),false);
  assert.equal(nav.roots[3].children.some(node=>node.label==='Town'),true);
  assert.equal(nav.paths.get('extra/other').at(0).label,'More pages');
});

test('sidebar opens only the current path, with active page and breadcrumbs',()=>{
  const nav = navigation(), view = nav.view(context,'people/humans/anna');
  const $ = load(nav.sidebar(view),{},false);
  assert.equal($('[aria-current="page"]').text(),'Anna');
  assert.equal($('details[data-nav-url][open]').length,2);
  assert.ok($('details:not([open]) [data-loaded="false"] a').length);
  const breadcrumbs = load(nav.breadcrumbs(view),{},false);
  assert.deepEqual(breadcrumbs('li').map((_,el)=>breadcrumbs(el).text()).get(),['Home','People','Humans','Anna']);
  for (const link of $('a[href]').toArray()) {
    const url = new URL($(link).attr('href'),'http://localhost');
    assert.equal(url.searchParams.get('date'),context.date);
    assert.equal(url.searchParams.get('dm'),'1');
  }
});

test('date and campaign visibility apply to lazy branches and remove missing leaves',()=>{
  const nav = navigation(), places = nav.roots[2];
  const early = nav.branch({...context,campaigns:['one']},places.id);
  assert.doesNotMatch(early.html,/>Future<|>Campaign</);
  const later = nav.branch({...context,date:'1750-01-01'},places.id);
  assert.match(later.html,/>Future</); assert.match(later.html,/>Campaign</);
  const sidebar = nav.sidebar(nav.view(context));
  assert.doesNotMatch(sidebar,/Unpublished/);
  assert.throws(()=>nav.branch(context,'missing'),{status:404});
  assert.throws(()=>nav.branch(context,nav.paths.get('places/future').at(-1).id),{status:404});
});

test('navigation escapes source labels and works with no curated template',()=>{
  const nav = new Navigation({entries:[entry('places/town.md','<script>Town</script>')]});
  const places = nav.roots.find(node=>node.label==='Places');
  const html = nav.branch(context,places.id).html;
  assert.doesNotMatch(html,/<script>/);
  assert.match(html,/&lt;script&gt;Town/);
  assert.equal(nav.paths.get('places/town').length,2);
});

test('section URLs remain stable as notes are added and current-page markers are unique',()=>{
  const before = navigation(), after = new Navigation({entries:[...entries,entry('people/humans/aaron.md','Aaron')]},source);
  assert.equal(before.paths.get('people/humans/anna').at(-1).id,after.paths.get('people/humans/anna').at(-1).id);
  assert.equal(before.roots[2].id,after.roots[2].id);
  const $ = load(after.sidebar(after.view(context,'people/people')),{},false);
  assert.equal($('[aria-current="page"]').length,1);
});
