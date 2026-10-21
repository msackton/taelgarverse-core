import {escapeHtml as h,contextQuery} from './common.mjs';
import {nameTypes,namePartTypes} from './names.mjs';

const displayLanguage=value=>value==='Unknown'?'Unassigned':value;
const statusLabel=value=>value ? value[0].toUpperCase()+value.slice(1) : '';
export function namesUrl(result,changes={}) {
  const query=contextQuery(result.context),input={...result.input,...changes};
  for (const key of ['view','language','kind','find','name','offset']) if (input[key]) query.set(key,String(input[key]));
  return '/names?'+query;
}
const link=(url,label,attributes='')=>'<a href="'+h(url)+'" '+attributes+'>'+label+'</a>';

function detail(result) {
  const item=result.selected;
  if (!item) return '<aside class="names-detail" id="name-detail" aria-label="Name details"><p>Select a name to explore its details.</p></aside>';
  if (item.sources) {
    const recorded=item.languageSource==='Recorded component';
    return '<aside class="names-detail" id="name-detail" aria-label="Name details"><div class="names-eyebrow">'+(item.type==='given'?'First name':'Surname')+'</div><h2>'+h(item.name)+'</h2>'+
      '<div class="names-detail-language">'+h(displayLanguage(item.language))+'</div>'+
      (item.pronunciation?'<div class="names-pronunciation">'+h(item.pronunciation)+(['proposed','disputed','unresolved'].includes(item.status)?'<span class="names-uncertain">'+h(statusLabel(item.status))+' entry</span>':'')+'</div>':'')+
      (item.meaning?'<p>'+h(item.meaning)+'</p>':'')+
      '<p class="names-part-explanation">'+(recorded?'Recorded as a name component.':item.languageSource==='Recorded personal name'?'Recorded as a personal name.':'Split from recorded full names. This grouping follows the full name’s language; the component’s own language may differ.')+'</p>'+
      '<div class="names-part-sources"><h3>Seen in '+item.sources.length+(item.sources.length===1?' person’s name':' people’s names')+'</h3><ul>'+item.sources.map(source=>'<li>'+link(namesUrl(result,{view:'names',language:'',kind:'',find:'',name:source.id,offset:0})+'#name-detail',h(source.name),'data-name-link')+
        (source.name!==source.subject?'<small>'+h(source.subject)+'</small>':'')+
        (['proposed','disputed','unresolved','inferred'].includes(source.status)?'<small>'+h(statusLabel(source.status))+' name record</small>':'')+
        link(source.url,'Read article ↗','class="names-part-article"')+'</li>').join('')+'</ul></div>'+
      (item.inferred?'<p class="names-source">Browsing split · Unconfirmed in the vault</p>':'')+'</aside>';
  }
  const unsettled=['proposed','disputed','unresolved'].includes(item.status);
  const pronunciation=item.pronunciation ? '<div class="names-pronunciation">'+h(item.pronunciation)+
    (unsettled && item.pronunciationSource!=='Frontmatter'?'<span class="names-uncertain">'+h(statusLabel(item.status))+' entry</span>':'')+'</div>' : '';
  const field=(label,value)=>value?'<div class="names-field"><dt>'+label+'</dt><dd>'+h(value)+'</dd></div>':'';
  return '<aside class="names-detail" id="name-detail" aria-label="Name details"><div class="names-eyebrow">A closer look</div><h2>'+h(item.name)+'</h2>'+
    '<div class="names-detail-language">'+h(displayLanguage(item.language))+'</div>'+pronunciation+
    '<dl>'+field('Recorded meaning',item.meaning)+field('Name role',item.role)+field('Recorded source form',item.derivedFrom)+
    (item.catalogLanguage?'<div class="names-field names-uncertain"><dt>Different catalog assignment</dt><dd>'+h(item.catalogLanguage)+'</dd></div>':'')+
    '<div class="names-field"><dt>Subject</dt><dd>'+link(item.url,h(item.subject),'class="names-subject-link"')+'</dd></div></dl>'+
    (result.related.length?'<div class="names-related"><h3>Other names for this subject</h3><ul>'+result.related.map(other=>'<li>'+link(namesUrl(result,{language:'',kind:'',find:'',name:other.id,offset:0})+'#name-detail',h(other.name),'data-name-link')+'<span>'+h(displayLanguage(other.language))+'</span></li>').join('')+'</ul></div>':'')+
    (item.components.length?'<div class="names-components"><h3>Recorded components</h3><ul>'+item.components.map(part=>'<li><span>'+h(part.name)+'</span><small>'+h(displayLanguage(part.language))+(part.role?' · '+h(part.role):'')+'</small></li>').join('')+'</ul></div>':'')+
    '<p class="names-source">'+h(item.languageSource)+(item.status?' · '+h(statusLabel(item.status)):'')+'</p>'+
    link(item.url,'Read the article <span aria-hidden="true">↗</span>','class="names-read-article"')+'</aside>';
}

export function namesView(result) {
  const {input}=result,parts=input.view==='parts',types=parts?namePartTypes:nameTypes;
  const contextFields=[...contextQuery(result.context)].map(([key,value])=>'<input type="hidden" name="'+h(key)+'" value="'+h(value)+'">').join('');
  const views='<nav class="names-views" aria-label="Explore names">'+[['parts','First & last names'],['names','All recorded names']].map(([view,label])=>link(namesUrl(result,{view,kind:'',name:'',find:'',offset:0}),h(label),view===input.view?'aria-current="page"':'')).join('')+'</nav>';
  const languageLink=({language,count})=>link(namesUrl(result,{language,name:'',offset:0}),h(displayLanguage(language))+'<span>'+count.toLocaleString('en')+'</span>',language===input.language?'aria-current="true"':'');
  const common=result.languages.filter(item=>item.language!=='Unknown' && item.count>=10);
  const more=result.languages.filter(item=>item.language!=='Unknown' && item.count<10);
  const nav='<nav class="names-languages" aria-label="Name languages"><h2>Languages</h2>'+
    link(namesUrl(result,{language:'',name:'',offset:0}),'All languages'+ '<span>'+result.languages.reduce((n,x)=>n+x.count,0).toLocaleString('en')+'</span>',!input.language?'aria-current="true"':'')+
    common.map(languageLink).join('')+(more.length?'<details class="names-more-languages"'+(more.some(item=>item.language===input.language)?' open':'')+'><summary>More languages ('+more.length+')</summary>'+more.map(languageLink).join('')+'</details>':'')+
    result.languages.filter(item=>item.language==='Unknown').map(languageLink).join('')+'</nav>';
  const options='<option value="">'+(parts?'First names & surnames':'All subjects')+'</option>'+types.map(([type,label])=>{
    const count=result.types.find(item=>item.type===type)?.count || 0;
    return '<option value="'+type+'"'+(type===input.kind?' selected':'')+(!count && type!==input.kind?' disabled':'')+'>'+label+' ('+count.toLocaleString('en')+')</option>';
  }).join('');
  const form='<form class="names-filters" action="/names" method="get" role="search" aria-label="Find names">'+contextFields+'<input type="hidden" name="view" value="'+h(input.view)+'">'+
    (input.language?'<input type="hidden" name="language" value="'+h(input.language)+'">':'')+
    '<label class="names-find"><span class="sr-only">Find a name or subject</span><input type="search" name="find" maxlength="256" placeholder="Find a name or subject" value="'+h(input.find)+'" autocomplete="off"></label>'+
    '<label><span class="sr-only">'+(parts?'Name part':'Subject type')+'</span><select name="kind" aria-label="'+(parts?'Name part':'Subject type')+'">'+options+'</select></label><button type="submit">Find</button></form>';
  const groups=result.groups.map(group=>'<section class="names-group" aria-labelledby="names-'+group.type+'"><div class="names-group-heading"><h3 id="names-'+group.type+'">'+group.label+'</h3>'+
    (!input.kind && group.total>group.items.length ? link(namesUrl(result,{kind:group.type,offset:0,name:''}),'Browse all '+group.total.toLocaleString('en')):'')+'</div><ul class="names-shelf">'+
    group.items.map(item=>'<li>'+link(namesUrl(result,{name:item.id})+'#name-detail','<span class="names-word">'+h(item.name)+'</span><span class="names-caption">'+h(displayLanguage(item.language))+
      (parts?' · '+item.sources.length+(item.sources.length===1?' person':' people'):['proposed','disputed','unresolved','inferred'].includes(item.status)?' · '+h(item.status):'')+'</span>', 'data-name-link'+(result.selected?.id===item.id?' aria-current="true"':''))+'</li>').join('')+'</ul></section>').join('');
  const page=result.pagination;
  const pagination=page && (page.previous || page.next) ? '<nav class="names-pagination" aria-label="Name pages">'+
    (page.previous?link(namesUrl(result,{offset:page.offset-page.limit,name:''}),'← Previous'):'<span></span>')+
    '<span>'+String(page.offset+1)+'–'+Math.min(page.offset+page.limit,result.total)+' of '+result.total.toLocaleString('en')+'</span>'+
    (page.next?link(namesUrl(result,{offset:page.offset+page.limit,name:''}),'Next →'):'<span></span>')+'</nav>':'';
  const empty=result.available?'No names match these filters.':'Names are not included in this content publication yet.';
  return '<section class="name-explorer'+(parts?' name-explorer--parts':'')+'" data-name-explorer><header class="names-heading"><span class="names-eyebrow">The names of Taelgar</span><h1>'+(parts?'Find a name that fits.':'A world in its names.')+'</h1>'+
    '<p>'+(parts?'First names and surnames from the people of Taelgar. Explore a language and see the names in use.':'Browse languages, discover alternate forms, and follow a name back to its story.')+'</p></header>'+views+
    '<p class="names-load-error" role="alert" hidden></p><div class="names-layout">'+nav+
    '<div class="names-main">'+form+'<div class="names-results-heading"><h2>'+h(input.language?displayLanguage(input.language):'All languages')+'</h2>'+
    '<p role="status" aria-live="polite">'+result.total.toLocaleString('en')+(parts?' name parts · ':result.total===1?' name form · ':' name forms · ')+result.subjects.toLocaleString('en')+(parts?(result.subjects===1?' person':' people'):result.subjects===1?' subject':' subjects')+'</p></div>'+
    (parts?'<p class="names-split-note">A browsing split of recorded names, with titles and descriptive endings left out. Select a name to see its source.</p>':'')+
    '<div class="names-groups">'+(groups || '<p class="names-empty">'+empty+'</p>')+'</div>'+pagination+'</div>'+detail(result)+'</div></section>';
}
