import fs from 'node:fs';

const names = ['octicons-info-24','octicons-location-24','octicons-people-24','material-calendar','simple-dungeonsanddragons'];
const icons = names.map(name=>[name,fs.readFileSync(new URL('../public/icons/'+name+'.svg',import.meta.url),'utf8')]);
icons.push(['speaker','🔈']);

const output = new URL('../src/icons.mjs',import.meta.url);
const source = '// Generated from public/icons by scripts/build-icons.mjs.\n' +
  'export const icons = new Map(' + JSON.stringify(icons) + ');\n';
if (!fs.existsSync(output) || fs.readFileSync(output,'utf8') !== source) fs.writeFileSync(output,source);
