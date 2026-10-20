import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {buildObsidian,releaseFiles,pluginSource} from './build-obsidian.mjs';
import {repositoryVersion} from './repository-version.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export const distributionRepo='msackton/taelgarverse-obsidian';
export const sourceRepo='msackton/taelgarverse-core';
let cachedToken;
function githubToken(){
  if(cachedToken)return cachedToken;
  cachedToken=process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if(!cachedToken){
    try{
      // Use the configured Git sign-in without printing or persisting credentials.
      const credential=execFileSync('git',['credential','fill'],{cwd:root,input:'protocol=https\nhost=github.com\nusername='+distributionRepo.split('/')[0]+'\n\n',
        encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'}});
      cachedToken=credential.match(/^password=(.+)$/m)?.[1].trim();
    }catch{ /* Give a useful error below, without leaking helper output. */ }
  }
  if(!cachedToken)throw new Error('GitHub sign-in unavailable. Sign in with Git Credential Manager or supply GH_TOKEN with Contents write access to '+distributionRepo);
  return cachedToken;
}

export async function githubRequest(endpoint,{method='GET',body,bytes,contentType='application/json'}={}){
  const url=new URL(endpoint.startsWith('https:')?endpoint:'https://api.github.com'+endpoint);
  if(!['api.github.com','uploads.github.com'].includes(url.hostname))throw new Error('Unexpected GitHub API host');
  const response=await fetch(url,{method,headers:{Authorization:'Bearer '+githubToken(),Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2026-03-10','Content-Type':contentType},body:bytes ?? (body===undefined?undefined:JSON.stringify(body)),signal:AbortSignal.timeout(60000)});
  if(!response.ok){const error=new Error('GitHub '+method+' '+url.pathname+' failed ('+response.status+')');error.status=response.status;throw error;}
  return response.status===204?null:await response.json();
}

async function verifySource(){
  const source=repositoryVersion(root);
  if(!source.commit || source.dirty)throw new Error('Commit the reviewed source changes before creating a plugin release');
  return source.commit;
}
function runTests(){
  execFileSync(process.execPath,['--test','tests/obsidian-maps.test.mjs','tests/obsidian-release.test.mjs','tests/map-measurement.test.mjs','tests/maps.test.mjs'],
    {cwd:root,windowsHide:true,stdio:'inherit'});
}

async function initializeRepository(request){
  const user=await request('/user');
  if(user.login.toLowerCase()!=='msackton')throw new Error('Repository initialization requires the msackton account');
  await request('/user/repos',{method:'POST',body:{name:'taelgarverse-obsidian',private:false,auto_init:true,
    description:'Taelgarverse for Obsidian: BRAT releases. Source lives in taelgarverse-core.'}});
  const readme=await request('/repos/'+distributionRepo+'/contents/README.md');
  await request('/repos/'+distributionRepo+'/contents/README.md',{method:'PUT',body:{message:'Document BRAT installation',sha:readme.sha,
    content:Buffer.from(await fs.readFile(path.join(pluginSource,'distribution-readme.md'))).toString('base64')}});
  await request('/repos/'+distributionRepo+'/contents/LICENSE',{method:'PUT',body:{message:'Include source license',
    content:Buffer.from(await fs.readFile(path.join(root,'LICENSE'))).toString('base64')}});
}

export async function releaseObsidian({notes,publish=false,initRepository=false},dependencies={}){
  const {request=githubRequest,build=buildObsidian,verify=verifySource,test=runTests}=dependencies;
  if(typeof notes!=='string' || !notes.trim())throw new Error('Release notes are required');
  const commit=await verify();
  test();
  const output=await build();
  if(await verify()!==commit)throw new Error('Source revision changed during release preparation; review and retry');
  const manifest=JSON.parse(await fs.readFile(path.join(output,'manifest.json'),'utf8'));
  // Ensure the source link is usable before publishing any binary artifacts.
  await request('/repos/'+sourceRepo+'/commits/'+commit);
  try{await request('/repos/'+distributionRepo);}
  catch(error){
    if(error.status!==404 || !initRepository)throw error;
    await initializeRepository(request);
  }
  const existing=await request('/repos/'+distributionRepo+'/releases?per_page=100');
  if(existing.some(release=>release.tag_name===manifest.version))throw new Error('Release '+manifest.version+' already exists; review its draft or bump the version. Existing assets are never overwritten.');
  const sourceUrl='https://github.com/'+sourceRepo+'/commit/'+commit;
  const provenance={plugin:manifest.id,version:manifest.version,sourceRepository:sourceRepo,sourceCommit:commit,sourceDirty:false,sourceUrl};
  await fs.writeFile(path.join(output,'release.json'),JSON.stringify(provenance,null,2)+'\n');
  const release=await request('/repos/'+distributionRepo+'/releases',{method:'POST',body:{tag_name:manifest.version,name:manifest.version,
    body:notes.trim()+'\n\nSource: '+sourceUrl,draft:true,prerelease:false}});
  let publishing=false;
  try{
    for(const file of [...releaseFiles,'versions.json','LICENSE','release.json']){
      const upload=release.upload_url.replace(/\{.*$/,'')+'?name='+encodeURIComponent(file);
      await request(upload,{method:'POST',bytes:await fs.readFile(path.join(output,file)),
        contentType:file.endsWith('.json')?'application/json':'application/octet-stream'});
    }
    if(publish){
      publishing=true;
      await request('/repos/'+distributionRepo+'/releases/'+release.id,{method:'PATCH',body:{draft:false,make_latest:'true'}});
    }
  }catch(error){
    throw new Error(error.message+(publishing?'. Uploads completed, but publication status must be checked at '+release.html_url:
      '. The incomplete draft remains at '+release.html_url+'; it has not been published.'));
  }
  return {url:release.html_url,version:manifest.version,published:publish};
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2),index=args.indexOf('--notes');
  if(index<0 || !args[index+1] || args.some((arg,i)=>!['--notes','--publish','--init-repository'].includes(arg) && i!==index+1)){
    throw new Error('Use --notes FILE [--publish] [--init-repository]. Default: create a draft. --init-repository may create the public '+distributionRepo+' repository.');
  }
  try{
    const result=await releaseObsidian({notes:await fs.readFile(args[index+1],'utf8'),publish:args.includes('--publish'),initRepository:args.includes('--init-repository')});
    console.log((result.published?'Published: ':'Draft ready: ')+result.url);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
