// Delegate changes so controls also work in asynchronously loaded popup bodies.
// Each index owns its checkbox state; no note, query cache or other grid changes.
export function mountMemberFilters(root) {
  const change=event=>{
    const checkbox=event.target;
    if(!checkbox.matches?.('input[data-index-include-historical]'))return;
    const index=checkbox.closest('.taelgar-index');
    if(!index || !root.contains(index))return;
    let visible=0;
    for(const item of index.querySelectorAll('[data-index-member]')) {
      item.hidden=item.hasAttribute('data-index-deceased') && !checkbox.checked;
      if(!item.hidden)visible++;
    }
    const empty=index.querySelector('.taelgar-index-empty');
    if(empty)empty.hidden=visible>0;
    const results=index.querySelector('[data-index-results]');
    if(results)results.hidden=visible===0;
  };
  root.addEventListener('change',change);
  return ()=>root.removeEventListener('change',change);
}
