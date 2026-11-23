const common = ['name', 'type', 'currentLocation', 'home'];
const people = [...common, 'info', 'born', 'died'];
const geography = [...common, 'region', 'population', 'created', 'destroyed'];

export function indexTableColumns(from, columns) {
  if (columns) return columns;
  return from === 'person' ? ['name', 'info', 'currentLocation', 'home'] : ['name', 'type'];
}

export function validateIndexTableOptions({from, mode, columns, sortBy}) {
  const allowed = from === 'person' ? people : from === 'place' ? geography : [...common, 'created', 'destroyed'];
  for (const [key, value] of Object.entries({columns, sortBy})) {
    if (value === undefined) continue;
    if (mode !== 'table') throw new Error(key + ' requires mode: table.');
    if (!Array.isArray(value) || !value.length || value.some(field => !allowed.includes(field))) {
      throw new Error(key + ' must be a nonempty list of supported columns for ' + from + ': ' + allowed.join(', '));
    }
    if (new Set(value).size !== value.length) throw new Error(key + ' must not contain duplicates.');
  }
}

export function indexColumnHeading(from, column) {
  if (column === 'name') return from === 'person' ? 'Person' : from === 'place' ? 'Place' : 'Name';
  return {info:'Info', currentLocation:'Current Location', home:'Home', born:'Born', died:'Died',
    region:'Region', type:'Type Of', population:'Population', created:'Created', destroyed:'Destroyed'}[column];
}
