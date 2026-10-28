import {ItemView} from 'obsidian';
import {captureMapBlock} from '../../../src/map-block.mjs';
import {loadObsidianBaseline} from './manifest.mjs';
import {readMapNote} from './persistence.mjs';
import {mountMapEditor} from './editor.mjs';
export const MAP_EDITOR_VIEW='taelgar-map-editor';

export class MapEditorView extends ItemView {
  constructor(leaf,feature){super(leaf);this.feature=feature;this.state={};this.sequence=0;this.closed=false;}
  getViewType(){return MAP_EDITOR_VIEW;}
  getDisplayText(){return 'Map editor';}
  getIcon(){return 'map';}
  getState(){return {...this.state};}
  async setState(state,result){
    this.state={source:state?.source,sourcePath:state?.sourcePath??''};
    if(!this.closed)await this.render();
    await super.setState(state,result);
  }
  onOpen(){this.closed=false;this.feature.editors.add(this);}
  async render(){
    const sequence=++this.sequence;
    this.editor?.dispose();this.editor=null;
    this.contentEl.textContent='Loading map…';
    try{
      if(typeof this.state.source!=='string')throw new Error('Open a version 2 map from a note to choose its source.');
      const baseline=await loadObsidianBaseline(this.app,JSON.stringify({version:2,source:this.state.source}),this.state.sourcePath);
      if(this.closed || sequence!==this.sequence || !this.feature.active)return;
      this.editor=mountMapEditor(this.contentEl,{...baseline,image:baseline.config.image,app:this.app,sourcePath:this.state.sourcePath,
        onSaved:(file,location)=>{
          for(const child of this.feature.maps)child.towns?.updateNote(file,location);
          for(const view of this.feature.editors)view.editor?.towns?.updateNote(file,location);
        }});
    }catch(error){if(!this.closed && sequence===this.sequence)this.contentEl.textContent='Map editor unavailable: '+error.message;}
  }
  onClose(){this.closed=true;this.sequence++;this.editor?.dispose();this.editor=null;this.feature.editors.delete(this);}
}

export async function openMapEditor(feature,path,selection){
  const guard=captureMapBlock(await readMapNote(feature.app,path),selection);
  const baseline=await loadObsidianBaseline(feature.app,guard.body,path);
  if(!feature.active)return;
  // Reuse an open source editor without resetting its in-progress town draft.
  const existing=[...feature.editors].find(view=>view.state.source===baseline.manifestPath);
  const leaf=existing?.leaf??feature.app.workspace.getLeaf('tab');
  if(!existing)await leaf.setViewState({type:MAP_EDITOR_VIEW,active:true,state:{source:baseline.manifestPath,sourcePath:path}});
  await feature.app.workspace.revealLeaf(leaf);
  return leaf.view;
}
