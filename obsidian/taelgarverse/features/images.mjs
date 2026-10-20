import {Component,editorLivePreviewField} from 'obsidian';
import {ViewPlugin} from '@codemirror/view';
import {createImageViewer} from '../../../src/browser/image-viewer.mjs';
import {mountImageControls} from '../../../src/browser/image-controls.mjs';

export class ImagesFeature extends Component {
  constructor(plugin){
    super();this.plugin=plugin;this.enabled=false;this.disposed=false;
    this.reading=new Map();this.editors=new Map();this.viewers=new Map();
  }
  onload(){
    const feature=this;
    this.plugin.registerEditorExtension(ViewPlugin.fromClass(class {
      constructor(view){this.view=view;feature.editors.set(view,null);feature.mountEditor(view);}
      update(){feature.editors.get(this.view)?.refresh();}
      destroy(){feature.editors.get(this.view)?.dispose();feature.editors.delete(this.view);feature.pruneViewers();}
    }));
    const workspace=this.plugin.app.workspace;
    this.registerEvent(workspace.on('layout-change',()=>this.syncReading()));
    workspace.onLayoutReady(()=>{if(!this.disposed)this.syncReading();});
    this.setEnabled(this.plugin.settings.imageViewer);
  }
  viewer(doc){
    if(!this.viewers.has(doc))this.viewers.set(doc,createImageViewer(doc));
    return this.viewers.get(doc);
  }
  mountEditor(view){
    if(!this.enabled || this.disposed || this.editors.get(view))return;
    this.editors.set(view,mountImageControls(view.dom,this.viewer(view.dom.ownerDocument),{
      portal:true,
      include:()=>view.state.field(editorLivePreviewField,false)===true,
    }));
  }
  syncReading(){
    if(!this.enabled || this.disposed)return;
    const roots=new Set();
    this.plugin.app.workspace.iterateAllLeaves(leaf=>{
      if(leaf.view.getViewType()!=='markdown')return;
      const root=leaf.view.containerEl;roots.add(root);
      if(!this.reading.has(root)){
        // Scope inline styles to our feature without changing CodeMirror widgets.
        const hadClass=root.classList.contains('taelgar-images-enabled');
        root.classList.add('taelgar-images-enabled');
        const controls=mountImageControls(root,this.viewer(root.ownerDocument),{
          include:image=>!!image.closest('.markdown-preview-view,.markdown-reading-view') && !image.closest('.markdown-source-view'),
        });
        this.reading.set(root,{dispose(){
          controls.dispose();if(!hadClass)root.classList.remove('taelgar-images-enabled');
        }});
      }
    });
    for(const [root,controls] of this.reading)if(!roots.has(root)){controls.dispose();this.reading.delete(root);}
    this.pruneViewers();
  }
  pruneViewers(){
    const docs=new Set([...this.reading.keys(),...[...this.editors].filter(([,controls])=>controls).map(([view])=>view.dom)]
      .map(root=>root.ownerDocument));
    for(const [doc,viewer] of this.viewers)if(!docs.has(doc)){viewer.dispose();this.viewers.delete(doc);}
  }
  setEnabled(enabled){
    this.enabled=enabled===true;
    if(!this.enabled){
      for(const controls of this.reading.values())controls.dispose();this.reading.clear();
      for(const [view,controls] of this.editors){controls?.dispose();this.editors.set(view,null);}
      for(const viewer of this.viewers.values())viewer.dispose();this.viewers.clear();
      return;
    }
    this.syncReading();for(const view of this.editors.keys())this.mountEditor(view);
  }
  onunload(){this.disposed=true;this.setEnabled(false);this.editors.clear();}
}
