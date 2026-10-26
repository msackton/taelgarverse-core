/* Reusable Leaflet detail behavior; no map replacement or coordinate change. */
(function(global){
  function attachDetailLayer(L,map,options){
    const {url,bounds,startZoom,endZoom,onChange=()=>{}}=options;
    if(!Number.isFinite(startZoom)||!Number.isFinite(endZoom)||endZoom<=startZoom)throw new Error('Invalid detail fade range');
    let overlay=null,loaded=false,failed=false,disposed=false;
    const opacityAt=z=>Math.max(0,Math.min(1,(z-startZoom)/(endZoom-startZoom)));
    function update(event){
      if(disposed)return;
      const zoom=event?.zoom??map.getZoom();
      const wanted=opacityAt(zoom);
      // Start loading just before detail becomes visible. Keep the base intact
      // until the image has loaded, including when the request fails.
      if(!overlay&&!failed&&zoom>=startZoom-.75){
        overlay=L.imageOverlay(url,bounds,{opacity:0,interactive:false,className:'regional-detail'});
        overlay.on('load',()=>{if(disposed)return;loaded=true;update();});
        overlay.on('error',()=>{if(disposed)return;failed=true;loaded=false;overlay.setOpacity(0);update();});
        overlay.addTo(map);
      }
      const opacity=loaded&&!failed?wanted:0;
      if(overlay)overlay.setOpacity(opacity);
      onChange({zoom,opacity,loaded,failed});
    }
    map.on('zoom zoomend zoomanim',update);
    update();
    return {opacityAt,update,destroy(){disposed=true;map.off('zoom zoomend zoomanim',update);overlay?.remove();}};
  }
  global.attachDetailLayer=attachDetailLayer;
})(window);
