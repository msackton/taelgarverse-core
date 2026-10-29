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
    this.state={source:state?.source,sourcePath:state?.sourcePath??'',...(state?.blockSource?{blockSource:state.blockSource}:{}),...(Number.isInteger(state?.blockLine)?{blockLine:state.blockLine}:{})};
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
      const baseline=await loadObsidianBaseline(this.app,this.state.blockSource??JSON.stringify({version:2,source:this.state.source}),this.state.sourcePath);
      if(this.closed || sequence!==this.sequence || !this.feature.active)return;
      const session=this.state.blockSource?{path:this.state.sourcePath,guard:captureMapBlock(await readMapNote(this.app,this.state.sourcePath),{source:this.state.blockSource,lineHint:this.state.blockLine})}:undefined;
      if(this.closed || sequence!==this.sequence || !this.feature.active)return;
      this.editor=mountMapEditor(this.contentEl,{...baseline,image:baseline.config.image,app:this.app,sourcePath:this.state.sourcePath,
        session,onDetailSaved:(result,previous)=>{this.state.blockSource=result.source;this.state.blockLine=result.session.guard.lineHint;this.feature.refreshMap(this.state.sourcePath,result.block.id,result.source,previous);},
        onLayersSaved:()=>{for(const child of this.feature.maps)void child.onload();},
        onPathSaved:(file,path)=>{
          for(const child of this.feature.maps)child.paths?.updateNote(file,path);
          for(const view of this.feature.editors)view.editor?.paths?.updateNote(file,path);
        },
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
  const existing=[...feature.editors].find(view=>view.state.source===baseline.manifestPath && view.state.sourcePath===path && view.state.blockSource===guard.body && view.state.blockLine===guard.lineHint);
  const leaf=existing?.leaf??feature.app.workspace.getLeaf('tab');
  if(!existing)await leaf.setViewState({type:MAP_EDITOR_VIEW,active:true,state:{source:baseline.manifestPath,sourcePath:path,blockSource:guard.body,blockLine:guard.lineHint}});
  await feature.app.workspace.revealLeaf(leaf);
  return leaf.view;
}
