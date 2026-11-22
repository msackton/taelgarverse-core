import {createHeaderContext} from '../../src/header-core/index.mjs';

// Recreate the full historical formats around the maintained callout body.
function formatFullHeader(snapshot,{name,metadata,date,headerType,includeTitle=true}) {
  const {output,templates}=createHeaderContext(snapshot,{date});
  const frontmatter=structuredClone(metadata);
  const file={name,frontmatter};
  const title=includeTitle ? templates.formatDisplayString('# <name:tn>',file)+'\n' : '';
  if(headerType==='static'){
    const pronunciation=templates.formatDisplayString('<(*()pronunciation()*)>',file);
    return title+(pronunciation ? pronunciation+'\n' : '')+output.generateObsidianCallout(name,frontmatter);
  }
  const pronunciation=frontmatter.pronunciation ? templates.formatDisplayString('<pronunciation>',file) : '';
  return title+(pronunciation ? ':speaker:{ .middle } *('+pronunciation+')*  \n' : '')+output.generateWebsiteCallout(name,frontmatter);
}

export function renderFullHeader(snapshot,{headerType='static',...request}) {
  return formatFullHeader(snapshot,{headerType,...request})+'\n';
}

// Preserve the former replacement rules for comparison with frozen outputs.
export function renderSavedHeader(snapshot,{source,name,metadata,date,headerType='website'}) {
  const lines=source.split('\n');
  let yamlEnd=lines.findIndex((line,index)=>index>0 && line==='---');
  if(yamlEnd>0){
    const version=metadata.version==='old' ? 'legacy' : '2023.11.25';
    const versionIndex=lines.slice(0,yamlEnd).findIndex(line=>line.trim().startsWith('headerVersion'));
    if(versionIndex>=0)lines[versionIndex]='headerVersion: '+version;
    else {
      lines.splice(1,0,'headerVersion: '+version);
      yamlEnd++;
    }
  }

  let headerEnd=lines.findIndex((line,index)=>index>yamlEnd && !line.trim());
  if(headerEnd===-1)headerEnd=lines.length;
  const firstNonblank=lines.findIndex((line,index)=>index>headerEnd && line.trim());
  if(firstNonblank!==-1)headerEnd=firstNonblank-1;
  if(!lines.slice(yamlEnd,headerEnd).some(line=>line.trim().startsWith('#')))headerEnd=yamlEnd;

  lines.splice(yamlEnd+1,headerEnd-yamlEnd,formatFullHeader(snapshot,{name,metadata,date,headerType}));
  return lines.join('\n');
}
