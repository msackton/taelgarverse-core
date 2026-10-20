import {parseHTML} from 'linkedom';

export function imageDOM(body='') {
  const {document,window}=parseHTML('<html><body>'+body+'</body></html>');
  const resize=new Set(), mutations=new Set(), frames=new Map(), loads=[];
  let focus,frame=0,defer=false;
  Object.defineProperty(document,'activeElement',{get:()=>focus,configurable:true});
  window.HTMLElement.prototype.focus=function(){focus=this;};
  window.HTMLElement.prototype.getBoundingClientRect=function(){return {left:0,top:0,right:800,bottom:600,width:800,height:600};};
  window.HTMLElement.prototype.getClientRects=function(){return this.isConnected ? [this.getBoundingClientRect()] : [];};
  Object.defineProperty(window.HTMLElement.prototype,'clientWidth',{get:()=>800,configurable:true});
  Object.defineProperty(window.HTMLElement.prototype,'clientHeight',{get:()=>600,configurable:true});
  Object.defineProperty(window.HTMLElement.prototype,'clientLeft',{get:()=>0,configurable:true});
  Object.defineProperty(window.HTMLElement.prototype,'clientTop',{get:()=>0,configurable:true});
  Object.defineProperty(window.HTMLImageElement.prototype,'naturalWidth',{get:()=>1600,configurable:true});
  Object.defineProperty(window.HTMLImageElement.prototype,'naturalHeight',{get:()=>900,configurable:true});
  window.HTMLElement.prototype.showModal=function(){this.open=true;this.setAttribute('open','');};
  window.HTMLElement.prototype.close=function(){this.open=false;this.removeAttribute('open');this.dispatchEvent(new window.Event('close'));};
  window.HTMLElement.prototype.setPointerCapture=function(){};
  window.requestAnimationFrame=fn=>{frames.set(++frame,fn);return frame;};
  window.cancelAnimationFrame=id=>frames.delete(id);
  window.ResizeObserver=class {
    constructor(callback){this.callback=callback;this.targets=new Set();resize.add(this);}
    observe(target){this.targets.add(target);}
    unobserve(target){this.targets.delete(target);}
    disconnect(){this.targets.clear();resize.delete(this);}
  };
  const Observer=window.MutationObserver;
  window.MutationObserver=class extends Observer {
    constructor(callback){super(callback);mutations.add(this);}
    disconnect(){super.disconnect();mutations.delete(this);}
  };
  window.HTMLImageElement.prototype.decode=function(){
    return defer ? new Promise((resolve,reject)=>loads.push({image:this,resolve,reject})) : Promise.resolve();
  };
  const event=(target,type,fields={})=>{
    const result=new window.Event(type,{bubbles:true,cancelable:true});
    Object.assign(result,{button:0,...fields});target.dispatchEvent(result);return result;
  };
  return {document,window,resize,mutations,frames,loads,event,
    click:target=>event(target,'click'),
    deferLoads(){defer=true;},
    async flush(){await Promise.resolve();await Promise.resolve();for(const [id,fn] of [...frames]){frames.delete(id);fn();}await Promise.resolve();},
  };
}
