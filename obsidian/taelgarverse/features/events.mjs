import {Component,MarkdownRenderChild,MarkdownRenderer} from 'obsidian';
import {eventColumns,parseEvents} from '../../../src/events.mjs';
import {obsidianEvents} from '../services/events.mjs';

class EventChild extends MarkdownRenderChild {
  constructor(plugin,source,element,sourcePath) {
    super(element);
    Object.assign(this,{plugin,source,sourcePath});
    this.sequence=0;
  }

  onload() {
    this.containerEl.classList.add('taelgar-events-host');
    this.register(this.plugin.events.subscribe(()=>void this.render()));
    this.register(this.plugin.snapshots.subscribe(()=>void this.render()));
    return this.render();
  }

  async render() {
    const sequence=++this.sequence;
    const element=this.containerEl,doc=element.ownerDocument,app=this.plugin.app;
    let content;
    try {
      const options=parseEvents(this.source);
      element.hidden=options.show==='website';
      if(element.hidden)return;
      const [index,snapshot]=await Promise.all([this.plugin.events.getIndex(),this.plugin.snapshots.getSnapshot()]);
      if(sequence!==this.sequence)return;
      const rows=obsidianEvents(app,index,snapshot,options,this.sourcePath);
      const section=doc.createElement('section');
      section.className='taelgar-index taelgar-events';
      section.setAttribute('aria-label','Events');
      if(options.heading) {
        const heading=doc.createElement('h2');
        heading.textContent='Events';section.append(heading);
      }
      if(!rows.length) {
        const empty=doc.createElement('em');
        empty.textContent='No events found.';section.append(empty);
      } else {
        const scroll=doc.createElement('div'),table=doc.createElement('table');
        scroll.className='taelgar-index-table-scroll';table.className='taelgar-index-table';
        const head=doc.createElement('thead'),headerRow=doc.createElement('tr'),body=doc.createElement('tbody');
        head.append(headerRow);table.append(head,body);
        for(const title of eventColumns) {
          const column=doc.createElement('th');
          column.scope='col';column.textContent=title;headerRow.append(column);
        }
        content=this.addChild(new Component());
        for(let start=0;start<rows.length;start+=24) {
          await Promise.all(rows.slice(start,start+24).map(async event=>{
            const row=doc.createElement('tr'),date=doc.createElement('td'),cell=doc.createElement('td'),file=doc.createElement('td');
            const link=doc.createElement('a');
            date.textContent=event.label;
            row.append(date,cell,file);body.append(row);
            link.className='internal-link';link.href=event.path;link.dataset.href=event.path;link.textContent=event.file;
            link.addEventListener('click',click=>{
              click.preventDefault();
              void app.workspace.openLinkText(event.path,event.path,click.ctrlKey || click.metaKey);
            });
            file.append(link);
            await MarkdownRenderer.render(app,event.text,cell,event.path,content);
          }));
          if(sequence!==this.sequence){if(!this.disposed)this.removeChild(content);return;}
        }
        scroll.append(table);section.append(scroll);
      }
      if(this.content)this.removeChild(this.content);
      this.content=content;element.replaceChildren(section);
    } catch(error) {
      if(content && !this.disposed)this.removeChild(content);
      if(sequence!==this.sequence)return;
      if(this.content){this.removeChild(this.content);this.content=null;}
      const paragraph=doc.createElement('p');
      paragraph.className='taelgar-index-error';paragraph.textContent='Timeline unavailable: '+error.message;
      element.hidden=false;element.replaceChildren(paragraph);
    }
  }

  onunload() {
    this.disposed=true;
    this.sequence++;
    this.containerEl.replaceChildren();
  }
}

export class EventsFeature extends Component {
  constructor(plugin){super();this.plugin=plugin;}
  onload() {
    this.plugin.registerMarkdownCodeBlockProcessor('taelgar-events',(source,element,context)=>
      context.addChild(new EventChild(this.plugin,source,element,context.sourcePath)));
  }
}
