import type * as Leaflet from 'leaflet';
import type {SketchDrawing,SketchCommand} from './sketch.js';
export type MapToolsOptions={mount?:HTMLElement;scope?:'local'|'shared';editable?:boolean;drawings?:SketchDrawing[];fullscreenTarget?:HTMLElement;onCommand?:(command:SketchCommand)=>void|Promise<void>;onError?:(message:string)=>void};
export type MapViewerHandle=(()=>void)&{
  stopTools():void;
  updateTools(value:Pick<MapToolsOptions,'drawings'|'editable'>):void;
  update(config:Record<string,unknown>):void;
  updateDetails(detailLayers:unknown[]):void;
  updateRegions(regionLayers:unknown[],sourceOffset?:[number,number]):void;
};
export function mountMap(figure:HTMLElement,options?:{allowSketch?:boolean;tools?:MapToolsOptions;openRegionNote?:(note:string)=>void;baseImagePane?:string;decorate?:(context:{L:typeof Leaflet;map:Leaflet.Map;canvas:HTMLElement;config:Record<string,unknown>})=>(()=>void)}):MapViewerHandle;
