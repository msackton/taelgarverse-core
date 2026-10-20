import {MAP_CALIBRATIONS,HEX_GRID} from './map-calibrations.mjs';

const byHash=new Map(MAP_CALIBRATIONS.map(item=>[item.sha256,item]));
export const hasHexCalibration=entry=>MAP_CALIBRATIONS.some(item=>item.image===entry.id);

// Convert each display-coordinate axis back to original image pixels, then
// apply the 24-mile hex calibration. Display stretching, zoom and tile sizes
// never change the resulting distance. These are flat image distances.
export function measurementOptions(data,entry={},bounds=data.bounds) {
  const calibration=byHash.get(entry.sha256);
  if(calibration){
    const perPixel=HEX_GRID.milesAcross*calibration.referenceScale/HEX_GRID.pixelsAcross;
    return {unit:'miles',hexMiles:HEX_GRID.milesAcross,
      xScale:calibration.width*perPixel/(bounds[1][1]-bounds[0][1]),
      yScale:calibration.height*perPixel/(bounds[1][0]-bounds[0][0])};
  }
  // A known map with changed bytes must be recalibrated rather than silently
  // falling back to the old, potentially distorted display-coordinate scale.
  if(hasHexCalibration(entry))return null;
  const scale=data.scale ?? 1,unit=data.unit === undefined ? 'map units' : data.unit;
  if(typeof scale!=='number' || !Number.isFinite(scale) || scale<=0 ||
    typeof unit!=='string' || !unit.trim() || unit.trim().length>40 || /[\x00-\x1f\x7f]/.test(unit))return null;
  return {xScale:scale,yScale:scale,unit:unit.trim()};
}

export function routeDistance(points,{xScale=1,yScale=1}={}) {
  let total=0;
  for(let i=1;i<points.length;i++)total+=Math.hypot((points[i].lat-points[i-1].lat)*yScale,(points[i].lng-points[i-1].lng)*xScale);
  return total;
}

export function formatDistance(distance,unit) {
  return distance.toLocaleString(undefined,{maximumFractionDigits:distance>0 && distance<1?2:1})+' '+unit;
}
