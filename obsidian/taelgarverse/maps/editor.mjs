import {mountMap} from '../../../src/browser/map-view.mjs';
import {baselineViewConfig} from '../../../src/map-block.mjs';
import {mountTracingImage} from './tracing-image.mjs';
import {mountRegionEditor} from './regions.mjs';
import {mountTownPlacement} from './towns.mjs';

// Authoring uses the full exported source. A note's crop is only a viewport,
// and opening its editor never changes that note or its map definition.
export function mountMapEditor(root,{block,manifest,image,app,sourcePath,onSaved,manifestPath,layerDocuments,onLayersSaved}) {
  const doc=root.ownerDocument;
  root.classList.add('taelgar-map-editor');
  const heading=doc.createElement('h2');heading.textContent='Map editor';
  const help=doc.createElement('p');help.className='map-editor-help';
  help.textContent='Place towns or draw named region borders. Save each change explicitly.';
  const figure=doc.createElement('figure');figure.className='leaflet-map map-editor-map';
  const config=baselineViewConfig({version:2,source:block.source,grid:block.grid,height:'100%',width:'100%'},manifest,image);
  if(config.regionLayers)config.regionLayers=config.regionLayers.map(layer=>({...layer,toggleable:true}));
  figure.dataset.map=JSON.stringify(config);
  const canvas=doc.createElement('div');canvas.className='map-canvas';
  canvas.setAttribute('role','region');canvas.setAttribute('aria-label','Taelgar map editor');
  const caption=doc.createElement('figcaption'),status=doc.createElement('span');
  status.className='map-status';status.setAttribute('role','status');caption.append(status);
  figure.append(canvas,caption);root.replaceChildren(heading,help,figure);
  let towns,regions,tracing;
  const dispose=mountMap(figure,{baseImagePane:'tilePane',openRegionNote:note=>app.workspace.openLinkText(note,manifestPath,false),decorate:app?context=>{
    tracing=mountTracingImage({...context,figure,manifest});
    towns=mountTownPlacement({...context,figure,manifest,app,sourcePath,onSaved,editable:true});
    regions=mountRegionEditor({...context,figure,manifest,manifestPath,layerDocuments,app,onSaved:layers=>{dispose.updateRegions(layers.map(layer=>({...layer,toggleable:true})),manifest.sourceOffset);onLayersSaved?.();}});
    const cleanup=()=>{regions();towns();tracing();};cleanup.update=next=>towns.update(next);return cleanup;
  }:undefined});
  return {towns,dispose(){dispose();root.replaceChildren();root.classList.remove('taelgar-map-editor');}};
}
