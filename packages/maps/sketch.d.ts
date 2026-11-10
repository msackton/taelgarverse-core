export type MapPoint = {x:number;y:number};
export type SketchDrawing = {id:string;color:string;width:number;closed:boolean;points:MapPoint[];segments?:MapPoint[][]};
export type EraserPoint = MapPoint & {radius:number};
export type SketchPatch={id:string;expected:SketchDrawing|null;drawing:SketchDrawing|null;index:number};
export type SketchChange={id:string;before:SketchDrawing|null;after:SketchDrawing|null;beforeIndex:number;afterIndex:number};
export type SketchCommand = {type:'addDrawing';drawing:SketchDrawing}|{type:'removeDrawings';ids:string[]}|{type:'eraseDrawings';trail:EraserPoint[]}|{type:'clearDrawings'}|{type:'patchDrawings';patches:SketchPatch[]};
export function drawingPaths(drawing:SketchDrawing):MapPoint[][];
export function hitDrawing(drawings:SketchDrawing[],point:MapPoint,tolerance:number):string|undefined;
export function drawingsInBox(drawings:SketchDrawing[],box:MapPoint&{width:number;height:number}):string[];
export function eraserRadius(speed:number,previous?:number):number;
export function eraseDrawings(drawings:SketchDrawing[],trail:EraserPoint[]):SketchDrawing[];
export function applySketchCommand(drawings:SketchDrawing[],command:SketchCommand):SketchDrawing[];

export function sameDrawing(a:SketchDrawing|null,b:SketchDrawing|null):boolean;
export function sketchChanges(before:SketchDrawing[],after:SketchDrawing[]):SketchChange[];
export function sketchHistoryCommand(changes:SketchChange[],undo:boolean):Extract<SketchCommand,{type:'patchDrawings'}>;
export function canPatchDrawings(drawings:SketchDrawing[],patches:SketchPatch[]):boolean;
export function patchDrawings(drawings:SketchDrawing[],patches:SketchPatch[],options?:{strict?:boolean}):SketchDrawing[];
