import {parseHTML} from 'linkedom';

export function createMapEditorDOM(){
  const dom=parseHTML('<figure><div class="map-canvas"></div><figcaption></figcaption></figure>');
  // Linkedom needs a writable select.value for the editor controls.
  Object.defineProperty(dom.window.HTMLSelectElement.prototype,'value',{
    configurable:true,
    get(){
      const selected=Array.from(this.options).find(option=>option.selected);
      return selected?.value ?? this.options[0]?.value ?? '';
    },
    set(value){
      for(const option of this.options)option.removeAttribute('selected');
      const selected=Array.from(this.options).find(option=>option.value===String(value));
      if(selected)selected.selected=true;
    },
  });
  return dom;
}
