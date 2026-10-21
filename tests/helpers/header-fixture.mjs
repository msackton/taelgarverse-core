import fs from 'node:fs';
import path from 'node:path';
import {createHeaderSnapshot,createHeaderContext,renderHeader} from '../../src/header-core/index.mjs';
import {notes,registry} from '../fixtures/header-cases.mjs';

const coreMeta=JSON.parse(fs.readFileSync(new URL('../fixtures/header-display-rules.json',import.meta.url),'utf8'));

// Keep the established test vocabulary at this seam while production uses the
// new services directly. Domain expectations and captured outputs stay fixed.
export function headerFixture({date='1720-01-01',baseNotes=notes,extraNotes={},displayRules={},campaignRegistry=registry,resolveLink}={}) {
  const input=structuredClone({pages:Object.entries({...baseNotes,...extraNotes}).map(([path,metadata])=>({path,metadata})),
    coreMeta:{...coreMeta,...displayRules},registry:campaignRegistry});
  const runtime=createHeaderSnapshot(input,{resolveLink});
  const context=createHeaderContext(runtime,{date});
  const services={DateManager:context.dates,NameManager:context.names,WhereaboutsManager:context.locations,
    AffiliationManager:context.affiliations,TokenParser:context.templates,EventManager:context.events,OutputHandler:context.output};
  const metadata=target=>runtime.resolve(target).metadata;
  return {input,runtime,services,metadata,
    file:target=>({name:path.posix.basename(target,'.md'),frontmatter:metadata(target)}),
    render(target,{headerType='website',source='---\n---\n',date:at=date}={}) {
      return renderHeader(runtime,{source,name:path.posix.basename(target,'.md'),metadata:metadata(target),date:at,headerType});
    },
  };
}

export function fixtureForCase(example) {
  return headerFixture({date:example.date,extraNotes:example.metadata?{
    [example.path]:{...notes[example.path],...example.metadata},
  }:{}});
}
