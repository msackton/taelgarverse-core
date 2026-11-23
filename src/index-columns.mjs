const peopleColumns=['info','currentLocation','home','born','died'];
const placeColumns=['region','type','population','created','destroyed'];
const allowedColumns={
  members:[...peopleColumns,'roles','joined','left'],
  residents:peopleColumns,
  'people-in-place':peopleColumns,
  settlements:placeColumns,
  rivers:placeColumns,
  places:placeColumns,
};
const defaultPeople=['name','info','currentLocation','home'];
const defaultGeography=['name','type'];
const defaults={
  members:defaultPeople,
  residents:defaultPeople,
  'people-in-place':defaultPeople,
  settlements:['name','region','type','population'],
  rivers:defaultGeography,
  places:defaultGeography,
};
const nameHeadings={residents:'Person','people-in-place':'Person',members:'Person',settlements:'Place',places:'Place',rivers:'River'};
const headings={
  info:'Info',currentLocation:'Current Location',home:'Home',born:'Born',died:'Died',
  roles:'Roles',joined:'Joined',left:'Left',
  region:'Region',type:'Type Of',population:'Population',created:'Created',destroyed:'Destroyed',
};

export function validateIndexTableOptions({type,mode,columns,sortBy}) {
  for(const [key,value] of [['columns',columns],['sortBy',sortBy]]) {
    if(value===undefined)continue;
    if(mode!=='table')throw new Error(key+' requires mode: table.');
    if(!Array.isArray(value) || !value.length)throw new Error(key+' must be a nonempty list of column names.');
    for(const column of value) {
      if(column!=='name' && !allowedColumns[type].includes(column))throw new Error(key+' does not support '+String(column)+' for '+type+' indexes.');
    }
    if(new Set(value).size!==value.length)throw new Error(key+' must not contain duplicate columns.');
  }
}

export function indexTableColumns(type,columns) {
  return columns ?? defaults[type];
}

export function indexColumnHeading(type,column) {
  return column==='name' ? nameHeadings[type] : headings[column];
}

export function indexColumnValue(item,column) {
  if(column==='type')return item.settlementType ?? item.placeType;
  if(column==='roles')return item.details;
  return item[column];
}
