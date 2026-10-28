import {captureMapBlock,patchMapBlock} from '../../../src/map-block.mjs';

export function mapEditors(app,path){
  const editors=new Set();
  for(const leaf of app.workspace.getLeavesOfType?.('markdown')??[]){
    const view=leaf.view;
    if(view.file?.path===path && view.editor && view.getMode?.()==='source')editors.add(view.editor);
  }
  return [...editors];
}
function editorText(editors){
  const texts=editors.map(editor=>editor.getValue());
  if(texts.some(text=>text!==texts[0]))throw new Error('Open editors for this note disagree. Reconcile them before saving; your map draft is retained.');
  return texts[0];
}
export async function readMapNote(app,path){
  const editors=mapEditors(app,path);if(editors.length)return editorText(editors);
  const file=app.vault.getAbstractFileByPath(path);if(!file)throw new Error('The originating note was moved or deleted.');
  return app.vault.read(file);
}
export async function openMapSession(app,path,selection){
  return {path,guard:captureMapBlock(await readMapNote(app,path),selection)};
}
export async function saveMapSession(app,session,draft,manifest){
  const result=await writeMapNote(app,session.path,text=>patchMapBlock(text,session.guard,draft,manifest));
  return {session:{path:session.path,guard:result.guard},block:result.block,source:result.guard.body};
}

// Both map drawing and town placement preserve live editor buffers and use
// atomic vault updates for closed notes. The patcher owns its conflict guard.
export async function writeMapNote(app,path,patcher){
  const editors=mapEditors(app,path);let result;
  if(editors.length){
    const text=editorText(editors);result=patcher(text);
    // No await between checking live buffers and issuing the range transaction.
    // Obsidian may synchronize split views after the first transaction.
    for(const editor of editors){
      if(editor.getValue()===result.text)continue;
      if(editor.getValue()!==text)throw new Error('Editor changed during Save; keep this draft and reload.');
      editor.transaction({changes:[{from:editor.offsetToPos(result.from),to:editor.offsetToPos(result.to),text:result.replacement}]},'taelgar-map');
    }
  }else{
    const file=app.vault.getAbstractFileByPath(path);if(!file)throw new Error('The originating note was moved or deleted.');
    await app.vault.process(file,text=>{
      if(mapEditors(app,path).length)throw new Error('The note opened in an editor during Save. Retry Save against its current buffer.');
      result=patcher(text);return result.text;
    });
  }
  return result;
}
