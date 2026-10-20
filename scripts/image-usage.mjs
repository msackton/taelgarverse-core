import {authoredBody,availableFrom,availableInContext,parseNote,publicationExclusions} from '../src/content-store.mjs';
import {filterComments} from '../src/comments.mjs';
import {createMarkdown,renderMarkdown} from '../src/markdown.mjs';
import {collectHtmlImageUsages} from '../src/images.mjs';

const dateString = key=>String(Math.floor(key/10000)).padStart(4,'0')+'-'+String(Math.floor(key/100)%100).padStart(2,'0')+'-'+String(key%100).padStart(2,'0');

// Inspect the same finite visibility states used by publication/search. This
// captures DM/date/campaign alternatives and reference-style image definitions,
// while excluding literal code, administrative comments and unsafe notes.
export function collectImageUsages(store,{homeSource=null,maxStatesPerNote=4096}={}) {
  const usages = new Map(), md = createMarkdown(), notesMarkdown = createMarkdown({html:false});
  const entries = [...store.bySlug.values()];
  if (homeSource!==null) entries.push({id:'_website/home.md',target:'index.md',note:typeof homeSource==='string' ? parseNote(homeSource) : homeSource,website:true});
  for (const entry of entries) {
    if (publicationExclusions(entry.note.metadata).includes('all')) continue;
    const source = authoredBody(entry.note);
    if (!/\.(?:png|jpe?g|webp|gif|heic)\b|<img\b/i.test(source)) continue;
    const conditions = [];
    try { filterComments(source,{date:'0001-01-01',source:entry.id,conditions}); }
    catch (error) { if (error.status===422) continue;throw error; }
    const codes = [...new Set(conditions.map(rule=>rule.campaign).filter(code=>code && code!=='none'))].sort();
    const dates = [...new Set([10101,availableFrom(entry),...conditions.map(rule=>rule.date)].filter(Boolean))].sort((a,b)=>a-b);
    if (codes.length>10 || 2**codes.length*dates.length*2>maxStatesPerNote) throw new Error('Image usage state limit exceeded for '+entry.id);
    const selections = codes.reduce((all,code)=>[...all,...all.map(selected=>[...selected,code])],[[]]), seen = new Set();
    for (const day of dates) for (const campaigns of selections) for (const dm of [false,true]) {
      const context = {date:dateString(day),campaigns,dm};
      if (!entry.website && !availableInContext(entry,context)) continue;
      const dmNotes = [], body = filterComments(source,{...context,source:entry.id,notes:dmNotes});
      const key = JSON.stringify([body,dmNotes]);if (seen.has(key)) continue;seen.add(key);
      const rendered = renderMarkdown(md,body,{store,entry,date:context.date,context,dmNotes,notesMarkdown,noteEmbeds:[],warnings:[]});
      collectHtmlImageUsages(store,rendered.html,usages);
    }
  }
  return usages;
}
