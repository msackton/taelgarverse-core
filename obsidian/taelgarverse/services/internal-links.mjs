import {escapeHtml as escape} from '../../../src/common.mjs';

export function obsidianInternalLink(target,label,className) {
  return '<a class="internal-link '+escape(className)+'" data-href="'+escape(target)+'" href="'+escape(target)+'">'+escape(label)+'</a>';
}

export function mountObsidianInternalLinks(container,app,sourcePath,selector) {
  const open=event=>{
    const link=event.target.closest?.(selector);
    if(event.button!==0 || !link || !container.contains(link)) return;
    event.preventDefault();
    event.stopPropagation();
    app.workspace.openLinkText(link.dataset.href,sourcePath,!!(event.ctrlKey || event.metaKey || event.shiftKey));
  };
  container.addEventListener('click',open);
  return ()=>container.removeEventListener('click',open);
}
