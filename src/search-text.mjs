import {load} from 'cheerio';

// Search authored, rendered prose. Executable source, generated controls and
// transcluded note bodies are not search text. The renderer appends DM popups
// only when requested; their prose is retained, but their controls are removed.
export function proseSections(html) {
  const $=load(html,{},false);
  $('script,style,template,svg,button,.dm-note-ref,.dm-note-header,.dm-block-label,.mermaid-diagram,.taelgar-index,.taelgar-index-buttons,.taelgar-index-error').remove();
  $('.admonition.warning').filter((_,el)=>$(el).find('.admonition-title').text()==='Dynamic content unavailable').remove();
  $('[hidden],[aria-hidden="true"]').remove();
  const sections=[];let heading='',text='';
  const flush=()=>{const value=text.replace(/[\t \r]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
    if(value || heading)sections.push({heading,text:value});text='';};
  const walk=node=>{
    if(node.type==='text'){text+=node.data;return;}
    const tag=node.name || '';
    if(/^h[1-6]$/.test(tag)){flush();heading=$(node).text().trim();return;}
    const block=/^(p|div|li|tr|table|blockquote|pre|ul|ol|section|article)$/.test(tag);
    if(block)text+='\n\n';for(const child of node.children || [])walk(child);if(block)text+='\n\n';
  };
  for(const node of $.root().contents().toArray())walk(node);flush();return sections;
}
export const searchText=html=>proseSections(html).map(s=>(s.heading?s.heading+'\n\n':'')+s.text).join('\n\n');
