import {mountMap} from '../../../src/browser/map-view.mjs';
import {baselineViewConfig} from '../../../src/map-block.mjs';
import {mountTownPlacement} from './towns.mjs';

// Authoring uses the full exported source. A note's crop is only a viewport,
// and opening its editor never changes that note or its map definition.
export function mountMapEditor(root,{block,manifest,image,app,sourcePath,onSaved}) {
  const doc=root.ownerDocument;
  root.classList.add('taelgar-map-editor');
  const heading=doc.createElement('h2');heading.textContent='Map editor';
  const help=doc.createElement('p');help.className='map-editor-help';
  help.textContent='Place a town, or choose an existing town to move it. Save each position to its town note.';
  const figure=doc.createElement('figure');figure.className='leaflet-map map-editor-map';
  const config=baselineViewConfig({version:2,source:block.source,grid:block.grid,height:'100%',width:'100%'},manifest,image);
  figure.dataset.map=JSON.stringify(config);
  const canvas=doc.createElement('div');canvas.className='map-canvas';
  canvas.setAttribute('role','region');canvas.setAttribute('aria-label','Taelgar map editor');
  const caption=doc.createElement('figcaption'),status=doc.createElement('span');
  status.className='map-status';status.setAttribute('role','status');caption.append(status);
  figure.append(canvas,caption);root.replaceChildren(heading,help,figure);
  let towns;
  const dispose=mountMap(figure,{decorate:app?context=>{
    towns=mountTownPlacement({...context,figure,manifest,app,sourcePath,onSaved,editable:true});return towns;
  }:undefined});
  return {towns,dispose(){dispose();root.replaceChildren();root.classList.remove('taelgar-map-editor');}};
}
