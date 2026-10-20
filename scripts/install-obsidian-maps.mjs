// Compatibility entry point. --enable also retires the old Map Tools plugin ID.
import {installObsidian} from './install-obsidian.mjs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export {installObsidian as installObsidianMaps};
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2),index=args.indexOf('--vault');
  if(index<0 || !args[index+1] || args.some((value,i)=>!['--vault','--enable'].includes(value) && i!==index+1))throw new Error('Use --vault PATH [--enable]');
  console.log('Installed Taelgarverse plugin: '+await installObsidian(args[index+1],{enable:args.includes('--enable')}));
  console.log('Restart Obsidian to apply the plugin change.');
}
