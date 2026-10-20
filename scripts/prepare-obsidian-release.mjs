import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const SOURCE='msackton/taelgarverse-core', DISTRIBUTION='msackton/taelgarverse-obsidian';
const directory='obsidian/taelgarverse';
const files=['manifest.json','versions.json','release-notes.md'];
const semver=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const git=(root,args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();

function parts(version){
  if(typeof version!=='string' || !semver.test(version) || version.split('.').some(value=>!Number.isSafeInteger(Number(value)))){
    throw new Error('Use an x.y.z version without leading zeroes or prerelease suffixes');
  }
  return version.split('.').map(Number);
}
function compare(a,b){
  const left=parts(a),right=parts(b);
  for(let i=0;i<3;i++)if(left[i]!==right[i])return left[i]>right[i]?1:-1;
  return 0;
}
export function nextVersion(previous,bump){
  const [major,minor,patch]=parts(previous);
  const choices={patch:[major,minor,patch+1],minor:[major,minor+1,0],major:[major+1,0,0]};
  if(!Object.hasOwn(choices,bump))throw new Error('Choose --bump patch, minor, or major');
  const next=choices[bump];
  const version=next.join('.');parts(version);return version;
}

export function validateReleaseNotes(notes,version){
  parts(version);
  if(typeof notes!=='string')throw new Error('Release notes are required');
  const [title,...body]=notes.trim().split(/\r?\n/);
  const match=title?.match(/^(?:#{1,6}\s+)?Taelgarverse\s+(\d+\.\d+\.\d+)(?:\s+.*)?$/);
  if(match?.[1]!==version)throw new Error('Release notes must start with Taelgarverse '+version);
  if(!body.join('\n').trim())throw new Error('Release notes need a user-facing description below the title');
}

async function releaseFiles(root){
  const original=await Promise.all(files.map(async file=>{
    const filename=path.join(root,directory,file),stat=await fs.lstat(filename);
    if(!stat.isFile() || stat.isSymbolicLink())throw new Error('Release files must be regular files: '+file);
    return fs.readFile(filename,'utf8');
  }));
  const manifest=JSON.parse(original[0]),versions=JSON.parse(original[1]);
  if(manifest.id!=='taelgarverse')throw new Error('Expected the taelgarverse plugin manifest');
  parts(manifest.version);parts(manifest.minAppVersion);
  if(!versions || Array.isArray(versions) || typeof versions!=='object')throw new Error('Invalid versions.json');
  if(versions[manifest.version]!==manifest.minAppVersion)throw new Error('Manifest and versions.json must agree');
  return {manifest,versions,notes:original[2],original};
}

async function readJSON(url){
  const headers={Accept:'application/vnd.github+json'};
  const token=process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  // Public release downloads need no token. Never forward credentials to an asset URL.
  if(new URL(url).hostname==='api.github.com' && token)headers.Authorization='Bearer '+token;
  const response=await fetch(url,{headers,signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error('Cannot read published plugin release ('+response.status+'); check GitHub access and rate limits');
  return response.json();
}

export async function latestPluginRelease(request=readJSON){
  const release=await request('https://api.github.com/repos/'+DISTRIBUTION+'/releases/latest');
  parts(release.tag_name);
  if(release.draft || release.prerelease)throw new Error('The comparison release must be published and stable');
  if(!release.assets?.some(asset=>asset.name==='release.json'))throw new Error('Published release has no source provenance; do not guess the comparison commit');
  const provenance=await request('https://github.com/'+DISTRIBUTION+'/releases/download/'+release.tag_name+'/release.json');
  if(provenance.plugin!=='taelgarverse' || provenance.sourceRepository!==SOURCE || provenance.version!==release.tag_name ||
    provenance.sourceDirty!==false || !/^[a-f0-9]{40}$/.test(provenance.sourceCommit)){
    throw new Error('Published release provenance is invalid; do not guess the comparison commit');
  }
  return {version:provenance.version,sourceCommit:provenance.sourceCommit,
    url:'https://github.com/'+DISTRIBUTION+'/releases/tag/'+release.tag_name};
}

export async function inspectRelease({root=ROOT,readPublished=latestPluginRelease}={}){
  const {manifest}=await releaseFiles(root),published=await readPublished();
  parts(published.version);
  if(!/^[a-f0-9]{40}$/.test(published.sourceCommit))throw new Error('Invalid published source commit');
  try{git(root,['merge-base','--is-ancestor',published.sourceCommit,'HEAD']);}
  catch{throw new Error('Published source commit must exist in local history and be an ancestor of HEAD; fetch source history or use the correct branch');}
  return {
    published,
    current:{version:manifest.version,minAppVersion:manifest.minAppVersion,head:git(root,['rev-parse','HEAD'])},
    commits:git(root,['log','--format=%h %s',published.sourceCommit+'..HEAD']).split('\n').filter(Boolean),
    changedFiles:git(root,['diff','--name-status',published.sourceCommit,'--']).split('\n').filter(Boolean),
    untrackedFiles:git(root,['ls-files','--others','--exclude-standard']).split('\n').filter(Boolean),
    // This is evidence for the agent, not an automatic plugin-scope classifier.
    review:'Inspect the actual diff and shared dependencies. These lists include website-only changes and uncommitted work; untracked file contents need separate inspection.',
  };
}

export async function checkRelease({root=ROOT}={}){
  const {manifest,notes}=await releaseFiles(root);
  validateReleaseNotes(notes,manifest.version);
  return {version:manifest.version,minAppVersion:manifest.minAppVersion,
    tag:'obsidian/'+manifest.version,files:files.map(file=>directory+'/'+file)};
}

export async function prepareRelease({root=ROOT,bump,version,notesFile,readPublished=latestPluginRelease}={}){
  if(Boolean(bump)===Boolean(version))throw new Error('Choose exactly one of --bump or --version');
  if(!notesFile)throw new Error('Supply agent-written release notes with --notes-file; preparation never invents release notes');
  const inspection=await inspectRelease({root,readPublished}),state=await releaseFiles(root);
  const target=version || nextVersion(inspection.published.version,bump);
  if(compare(target,inspection.published.version)<=0)throw new Error('The new version must be greater than the published version');
  if(state.manifest.version!==inspection.published.version && state.manifest.version!==target){
    throw new Error('A different version is already being prepared; review it before replacing release files');
  }
  const notes=await fs.readFile(path.resolve(root,notesFile),'utf8');validateReleaseNotes(notes,target);
  if(Object.hasOwn(state.versions,target) && state.versions[target]!==state.manifest.minAppVersion){
    throw new Error('The target version already has a different compatibility entry');
  }
  const output=[JSON.stringify({...state.manifest,version:target},null,2)+'\n',
    JSON.stringify({...state.versions,[target]:state.manifest.minAppVersion},null,2)+'\n',notes.trim()+'\n'];
  // Validate the complete proposal before touching any release file. Restore earlier
  // writes if a later write fails; no Git or remote mutation happens here.
  const written=[];
  try{
    for(let i=0;i<files.length;i++){
      const filename=path.join(root,directory,files[i]);
      if(await fs.readFile(filename,'utf8')!==state.original[i])throw new Error('Release files changed during preparation; retry after review');
      written.push(i);await fs.writeFile(filename,output[i]);
    }
  }catch(error){
    for(const i of written)await fs.writeFile(path.join(root,directory,files[i]),state.original[i]);
    throw error;
  }
  return {...await checkRelease({root}),previous:inspection.published,
    next:'Review the release diff and test results. Preparation did not commit, tag, push, build release artifacts, or publish.'};
}

const help=`Agent release helper (run from core):
  node scripts/prepare-obsidian-release.mjs inspect
  node scripts/prepare-obsidian-release.mjs prepare --bump patch|minor|major --notes-file FILE
  node scripts/prepare-obsidian-release.mjs prepare --version X.Y.Z --notes-file FILE
  node scripts/prepare-obsidian-release.mjs check

inspect reads public release provenance and local Git history (including tracked
working changes). prepare writes only the three plugin release files. check is
offline. None of these commands commit, tag, push, or publish. See docs/obsidian-releases.md.
`;
export function parseOptions(args){
  if(args.length===0 || (args.length===1 && args[0]==='--help'))return {help:true};
  const [command,...rest]=args;
  if(!['inspect','prepare','check'].includes(command))throw new Error('Use inspect, prepare, or check; see --help');
  const options={command},names={'--bump':'bump','--version':'version','--notes-file':'notesFile'};
  for(let i=0;i<rest.length;i++){
    const name=Object.hasOwn(names,rest[i])?names[rest[i]]:undefined,value=rest[++i];
    if(command!=='prepare' || !name || options[name] || !value || value.startsWith('--'))throw new Error('Unknown, duplicate, or incomplete option; see --help');
    options[name]=value;
  }
  return options;
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    const options=parseOptions(process.argv.slice(2));
    if(options.help)console.log(help);
    else console.log(JSON.stringify(await ({inspect:inspectRelease,prepare:prepareRelease,check:checkRelease}[options.command])(options),null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
