const common = ['name', 'type', 'currentLocation', 'lastKnown', 'home', 'origin', 'status'];
const people = [...common, 'info', 'born', 'died'];
const geography = [...common, 'region', 'population', 'created', 'destroyed'];
const fieldsFor = from => from === 'person' ? people : from === 'place' ? geography : [...common, 'created', 'destroyed'];

export function indexTableColumns(from, columns) {
  if (columns) return columns;
  if (Array.isArray(from)) return ['name', 'info', 'lastKnown', 'alive'];
  return from === 'person' ? ['name', 'info', 'currentLocation', 'home'] : ['name', 'type'];
}

export function validateIndexTableOptions({type, from, mode, columns, columnHeadings, sortBy}) {
  const base = Array.isArray(from) ? [...new Set(['kind', 'info', 'alive', ...from.flatMap(fieldsFor)])] : fieldsFor(from);
  const allowed = type === 'affiliation' ? [...base, 'roles', 'joined', 'left'] : base;
  for (const [key, value] of Object.entries({columns, sortBy})) {
    if (value === undefined) continue;
    if (mode !== 'table') throw new Error(key + ' requires mode: table.');
    if (!Array.isArray(value) || !value.length || value.some(field => !allowed.includes(field))) {
      throw new Error(key + ' must be a nonempty list of supported columns for ' + from + ': ' + allowed.join(', '));
    }
    if (new Set(value).size !== value.length) throw new Error(key + ' must not contain duplicates.');
  }
  if (columnHeadings === undefined) return;
  if (mode !== 'table') throw new Error('columnHeadings requires mode: table.');
  if (!columnHeadings || typeof columnHeadings !== 'object' || Array.isArray(columnHeadings)) {
    throw new Error('columnHeadings must be a mapping from displayed columns to labels.');
  }
  const displayed = new Set(indexTableColumns(from, columns));
  for (const [column, label] of Object.entries(columnHeadings)) {
    if (!displayed.has(column)) throw new Error('columnHeadings cannot rename undisplayed column: ' + column);
    if (typeof label !== 'string' || !label.trim()) {
      throw new Error('columnHeadings labels must be nonempty text.');
    }
  }
}

export function indexColumnHeading(from, column) {
  if (column === 'name') return from === 'person' ? 'Person' : from === 'place' ? 'Place' : 'Name';
  return {info:'Info', kind:'Kind', currentLocation:'Current Location', lastKnown:'Last Known Location', alive:'Alive',
    home:'Home', origin:'Origin', status:'Status', born:'Born', died:'Died',
    roles:'Roles', joined:'Joined', left:'Left', region:'Region', type:'Type Of', population:'Population', created:'Created', destroyed:'Destroyed'}[column];
}
