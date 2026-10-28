export const DEFAULT_MAP_SYMBOL='square';
export const MAP_SYMBOLS=Object.freeze([
  {value:'square',label:'Filled square'},
  {value:'open-square',label:'Open square'},
  {value:'diagonal-square',label:'Diagonal square'},
  {value:'crossed-square',label:'Crossed square'},
  {value:'dot',label:'Dot'},
  {value:'triangle',label:'Triangle'},
  {value:'gate',label:'Gate'},
]);

export function mapSymbol(value){
  const symbol=MAP_SYMBOLS.find(item=>item.value===value);
  if(!symbol)throw new Error('Symbol must be one of: '+MAP_SYMBOLS.map(item=>item.value).join(', ')+'.');
  return symbol;
}
