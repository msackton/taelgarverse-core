// Point clicks extend the current route. Each freehand stroke starts a separate
// route so lifting the pointer never invents an untraced connecting segment.
import {isClosedRoute} from './map-distance.mjs';

export function measurementRoutes(actions,stroke) {
  const routes=[];
  for(const action of [...actions,...(stroke?[{kind:'stroke',points:stroke}]:[])]){
    if(action.kind==='stroke' || !routes.length || isClosedRoute(routes.at(-1)))routes.push([...action.points]);
    else routes.at(-1).push(...action.points);
  }
  return routes;
}
