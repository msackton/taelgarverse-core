import fs from 'node:fs';
import path from 'node:path';
import {initializeHeaderRuntime,renderModuleHeader} from '../../src/header-runtime.mjs';
import {instantiate} from '../../src/worker-headers.mjs';
import {notes,registry} from '../fixtures/header-cases.mjs';

const coreMeta=JSON.parse(fs.readFileSync(new URL('../fixtures/header-display-rules.json',import.meta.url),'utf8'));

// The old stack is deliberately isolated as a characterization/reference path.
export function headerFixture({date='1720-01-01',baseNotes=notes,extraNotes={},displayRules={},campaignRegistry=registry,resolveLink}={}) {
  const input=structuredClone({pages:Object.entries({...baseNotes,...extraNotes}).map(([path,metadata])=>({path,metadata})),
    coreMeta:{...coreMeta,...displayRules},registry:campaignRegistry});
  const runtime=initializeHeaderRuntime(input,instantiate,{resolveLink});
  const services={state:{overrideDate:date,coreMeta:structuredClone(input.coreMeta)}};
  instantiate({customJS:services,app:runtime.app});
  services.state.campaignRegistry=services.init.normalizeCampaignRegistry(input.registry);
  services.state.coreMeta.campaigns=services.state.campaignRegistry;
  const metadata=target=>runtime.app.metadataCache.getFileCache(runtime.app.metadataCache.getFirstLinkpathDest(target)).frontmatter;
  return {input,runtime,services,metadata,
    file:target=>({name:path.posix.basename(target,'.md'),frontmatter:metadata(target)}),
    render(target,{headerType='website',source='---\n---\n',date:at=date}={}) {
      return renderModuleHeader(runtime,{source,name:path.posix.basename(target,'.md'),metadata:metadata(target),date:at,headerType});
    },
  };
}
