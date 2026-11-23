import {RenderError,escapeHtml,pageUrl,parseDM} from './common.mjs';
import {classifyRoute} from './routes.mjs';
import {document} from './render-engine.mjs';
import {contextQuery} from './header.mjs';
import {searchInput,searchPages} from './search.mjs';
import {searchTypes} from './search-types.mjs';
import {searchView,searchErrorView} from './search-view.mjs';
import {homepage} from './homepage.mjs';
import {resolveDiagramLink} from './diagram-links.mjs';
import {mapCatalogue} from './map-catalogue.mjs';

const apiSpec = {
  openapi:'3.1.0', info:{title:'TaelgarVerse rendering API',version:'0.2.0'},
  paths:{
    '/api/maps':{get:{summary:'List published map views or resolve one map definition',parameters:[
      {name:'q',in:'query',schema:{type:'string',maxLength:200},description:'Filter map title, source page or block ID before pagination'},
      {name:'id',in:'query',schema:{type:'string'},description:'Map identity returned by the catalogue; returns a full configuration'},
      {name:'page',in:'query',schema:{type:'string'},description:'Limit to maps authored directly in one page'},
      {name:'revision',in:'query',schema:{type:'string'},description:'Require the current content revision; a changed revision returns 409'},
      {name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:100,default:50}},
      {name:'offset',in:'query',schema:{type:'integer',minimum:0,maximum:10000,default:0}},
      {name:'context',in:'query',schema:{type:'string'}},{name:'date',in:'query',schema:{type:'string'}},
      {name:'campaigns',in:'query',schema:{type:'string'}},{name:'dm',in:'query',schema:{type:'boolean'}}],
      responses:{200:{description:'Version 1 map catalogue or resolved map, with source revision and absolute asset URLs'},
        400:{description:'Invalid parameters'},404:{description:'Unavailable map or page'},409:{description:'Content revision changed'}}}},
    '/api/search':{get:{summary:'Search visible note text, titles and aliases',parameters:[
      {name:'q',in:'query',schema:{type:'string',maxLength:256},description:'Words match together; quotes request an exact phrase'},
      {name:'type',in:'query',schema:{type:'string',enum:['',...searchTypes.map(([type])=>type)]},description:'Filter by the existing vault content-type tags; empty means all content'},
      {name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:50,default:20}},
      {name:'offset',in:'query',schema:{type:'integer',minimum:0,maximum:1000,default:0}},
      {name:'context',in:'query',schema:{type:'string'}},{name:'date',in:'query',schema:{type:'string'}},
      {name:'campaigns',in:'query',schema:{type:'string'}},{name:'dm',in:'query',schema:{type:'boolean'}}],
      responses:{200:{description:'Context-filtered results with URLs, plain-text excerpts, highlight ranges, pagination and fallback status'},400:{description:'Invalid query or context'}}}},
    '/api/page':{get:{summary:'Render a page for an in-world DR date',
      parameters:[{name:'page',in:'query',required:true,schema:{type:'string'}},
        {name:'date',in:'query',schema:{type:'string',pattern:'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'}},
        {name:'context',in:'query',schema:{type:'string'},description:'modern, custom, or a campaign context ID'},
        {name:'campaigns',in:'query',schema:{type:'string'},description:'Custom only: all, comma-separated campaign codes, or empty for none; repeated parameters are also accepted'},
        {name:'dm',in:'query',schema:{type:'boolean',default:false},description:'See Behind the Curtain: 1/true shows comment notes and Campaign:none blocks; a viewing preference available to every visitor'}],
      responses:{200:{description:'Article HTML, TOC, backlinks, campaign interactions, date, campaigns and warnings'},400:{description:'Invalid input'},
        404:{description:'Missing/excluded/future page'},409:{description:'Ambiguous page'},422:{description:'Unsafe comment syntax or header error'}}}},
    '/health':{get:{summary:'Content snapshot status',responses:{200:{description:'Indexed page count and warnings'}}}},
    '/api/contexts':{get:{summary:'Available contexts, dates, campaign codes and date provenance',responses:{200:{description:'Context catalogue and warnings'}}}},
    '/api/diagram-links':{get:{summary:'Resolve diagram destinations in the source article context',parameters:[
      {name:'source',in:'query',required:true,schema:{type:'string'}},
      {name:'target',in:'query',required:true,schema:{type:'array',maxItems:100,items:{type:'string',maxLength:2048}}},
      {name:'context',in:'query',schema:{type:'string'}},{name:'date',in:'query',schema:{type:'string'}},
      {name:'campaigns',in:'query',schema:{type:'string'}},{name:'dm',in:'query',schema:{type:'boolean'}}],
      responses:{200:{description:'Ordered destinations; null for unavailable or unsafe links'},400:{description:'Invalid input'},404:{description:'Unavailable source article'}}}},
    '/api/navigation':{get:{summary:'Load children of a site navigation branch',parameters:[
      {name:'branch',in:'query',required:true,schema:{type:'string'}},
      {name:'page',in:'query',schema:{type:'string'},description:'Current page slug'},
      {name:'context',in:'query',schema:{type:'string'}},{name:'date',in:'query',schema:{type:'string'}},
      {name:'campaigns',in:'query',schema:{type:'string'},description:'Custom campaign selection'},
      {name:'dm',in:'query',schema:{type:'boolean'}}],responses:{200:{description:'Branch title and HTML list items'},404:{description:'Unavailable branch'}}}},
  },
};
function send(status,body,type='application/json') { return new Response(type==='application/json' ? JSON.stringify(body) : body,{status,headers:{'Content-Type':type+'; charset=utf-8'}}); }
function shell(title, content,header = '') {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml(title) + '</title><link rel="stylesheet" href="/theme/preview.css"></head><body>' + header + '<main>' + content + '</main></body></html>';
}
async function dispatch(request,engine,{route=classifyRoute(request),renderPage=(page,date,context,dm,campaigns)=>engine.render(page,date,context,dm,undefined,campaigns),renderHome=(context,siteHost)=>engine.renderHome(context,undefined,siteHost),search=engine.search?.bind(engine),assets,theme,runtime='node',revision,releases=engine.releases}={}) {
      if (route.name === 'methodNotAllowed') { return new Response(JSON.stringify({detail:'Method not allowed'}),{status:405,headers:{Allow:'GET, HEAD','Content-Type':'application/json'}}); }
      if (route.error) throw route.error;
      const {url,pathname,tail} = route;
      let site;
      try { site = engine.campaignSites.forHost(url.hostname); }
      catch (error) {
        if (error.status !== 404 || pathname.startsWith('/api/')) throw error;
        return send(404,shell('Campaign site not found','<h1>Campaign site not found</h1><p><a href="https://www.taelgar.org/">Visit TaelgarVerse</a></p>'),'text/html');
      }
      // A campaign hostname is authoritative, even for API and manually edited URLs.
      const date = site ? site.date : url.searchParams.get('date') ?? undefined;
      const contextId = site ? site.contextId : url.searchParams.get('context') ?? undefined;
      const selectedCampaigns = site ? site.campaigns : url.searchParams.has('campaigns') ? url.searchParams.getAll('campaigns') : undefined;
      const dm = parseDM(url.searchParams.get('dm'));
      const lock = context => site ? {...context,label:site.label || context.label,locked:true,site:site.host} : context;
      const resolveContext = () => lock({...engine.contexts.resolve(contextId,date,selectedCampaigns),dm});
      const contextOptions = site ? site.contextId==='custom' ? [resolveContext()] : engine.contexts.list().filter(context=>context.id===site.contextId) : engine.contexts.list();
      const renderArticle = async (...args) => { const result=await renderPage(...args);return {...result,context:lock(result.context)}; };
      if (route.name === 'health') return send(200,{status:'ok',pages:engine.store.bySlug.size,index_warnings:engine.store.warnings,context_warnings:engine.contexts.warnings,runtime,revision});
      if (route.name === 'contexts') return send(200,{contexts:contextOptions,warnings:engine.contexts.warnings,...(site ? {locked:true,site:site.host} : {})});
      if (route.name === 'openapi') return send(200,apiSpec);
      if (route.name === 'maps') {
        const currentRevision=revision??engine.store.revision??null;
        if(url.searchParams.has('revision') && url.searchParams.get('revision')!==currentRevision)
          throw new RenderError(409,'Content revision changed; reload the map catalogue');
        const integer=(name,fallback,min,max)=>{
          const raw=url.searchParams.get(name);
          if(raw===null)return fallback;
          if(!/^\d+$/.test(raw) || !Number.isSafeInteger(+raw) || +raw<min || +raw>max)throw new RenderError(400,'Invalid '+name);
          return +raw;
        };
        const id=url.searchParams.get('id'),page=url.searchParams.get('page'),q=url.searchParams.get('q')??'';
        if(q.length>200)throw new RenderError(400,'Map search is limited to 200 characters');
        if(id!==null && !/^map-[a-f0-9]{32}$/.test(id) || page!==null && (!page.trim() || page.length>2048))
          throw new RenderError(400,'Invalid map or page');
        return send(200,await mapCatalogue(engine,{context:resolveContext(),origin:url.origin,revision:currentRevision,siteHost:site?.host,
          id,page,q,limit:integer('limit',50,1,100),offset:integer('offset',0,0,10000)}));
      }
      if (route.name === 'diagramLinks') {
        const source = url.searchParams.get('source'), targets = url.searchParams.getAll('target');
        if (!source || !targets.length || targets.length > 100 || targets.some(target => target.length > 2048)) {
          throw new RenderError(400,'source and 1–100 targets of at most 2048 characters are required');
        }
        const {entry,context} = engine.resolvePage(source,date,contextId,dm,selectedCampaigns);
        return send(200,{links:targets.map(target => resolveDiagramLink(target,{store:engine.store,entry,context,origin:url.origin}))});
      }
      if (route.name === 'navigation') {
        const branch = url.searchParams.get('branch');
        if (!branch) throw new RenderError(400,'branch is required');
        const context = resolveContext();
        return send(200,engine.navigation.branch(context,branch,url.searchParams.get('page')));
      }
      if (route.name === 'pageApi') {
        const page = url.searchParams.get('page');
        if (!page) throw new RenderError(400,'page is required');
        return send(200,await renderArticle(page,date,contextId,dm,selectedCampaigns));
      }
      if (route.name === 'searchApi'){
        const context=resolveContext();
        const input=searchInput(url.searchParams.get('q') || '',{limit:url.searchParams.get('limit') ?? 20,offset:url.searchParams.get('offset') ?? 0,type:url.searchParams.get('type') ?? ''});
        return send(200,await searchPages(engine,search,input,context));
      }
      if (route.name === 'article') {
        try { return send(200,document(await renderArticle(tail,date,contextId,dm,selectedCampaigns),contextOptions,engine.navigation,releases),'text/html'); }
        catch (error) {
          if (error.status !== 404) throw error;
          const context = resolveContext();
          return send(404,document({title:'Page unavailable',html:'<h1>Page unavailable</h1><p>' + escapeHtml(error.message) +
            (site ? '. Return to ' : '. Choose another context or return to ') + '<a href="/?q=&amp;' + escapeHtml(contextQuery(context).toString()) + '">search</a>.</p>',
            toc:'',warnings:[],context},contextOptions,engine.navigation,releases),'text/html');
        }
      }
      if (route.name === 'docs') {
        return send(200,shell('TaelgarVerse API','<h1>TaelgarVerse rendering API</h1><p>GET <code>/api/page?page=Zahara&amp;date=1730-02-01</code></p>' +
          '<form action="/api/page"><label>Page <input name="page" value="Zahara" required></label><label> Date (DR) ' +
          '<input name="date" value="' + engine.settings.default_date + '"></label><button>Try request</button></form>' +
          '<p>Returns article <code>html</code>, <code>toc</code>, <code>backlinks</code>, page/title/date/campaign context, and rendering warnings.</p>' +
          '<p><a href="/openapi.json">OpenAPI schema</a> · <a href="/?q=">Search</a></p>'),'text/html');
      }
      if (route.name === 'browse') {
        const context = resolveContext();
        const view = engine.navigation.view(context,undefined,tail);
        const node = view.visible.get(tail);
        const items = node.children.map(child=>view.visible.get(child.id)).map(child=>'<li><a href="' + escapeHtml(engine.navigation.url(child,context)) + '">' + escapeHtml(child.label) + '</a></li>').join('');
        const overview = node.entry ? '<p><a href="' + escapeHtml(pageUrl(node.entry.slug,context.date,context)) + '">Read the overview</a></p>' : '';
        return send(200,document({title:node.label,html:'<h1>' + escapeHtml(node.label) + '</h1>' + overview +
          '<ul class="section-pages">' + items + '</ul>',toc:'',warnings:[],context,navigationId:node.id},contextOptions,engine.navigation,releases),'text/html');
      }
      if (route.name === 'home' || route.name === 'searchPage') {
        const query = url.searchParams.get('q') || '';
        const context = resolveContext();
        if (route.name === 'home') {
          const home = await renderHome(context,site?.host);
          if (home) return send(200,document({...homepage(home,context,engine.store),context},contextOptions,engine.navigation,releases),'text/html');
        }
        let input;
        const type=url.searchParams.get('type') ?? '';
        try{input=searchInput(query,{limit:url.searchParams.get('limit') ?? 20,offset:url.searchParams.get('offset') ?? 0,type});}
        catch(error){if(error.status!==400)throw error;return send(400,document({title:'Search Taelgar',html:searchErrorView(query,context,error.message,type),toc:'',warnings:[],context,query,searchType:searchTypes.some(([value])=>value===type)?type:'',search:true},contextOptions,engine.navigation,releases),'text/html');}
        const results=await searchPages(engine,search,input,context);
        return send(200,document({title:query?'Search: '+query:'Search Taelgar',html:searchView(results),toc:'',warnings:[],context,query,searchType:input.type,search:true},contextOptions,engine.navigation,releases),'text/html');
      }
      if (route.name === 'asset') {
        const entry=engine.store.assets.get(tail);
        if (!entry) throw new RenderError(404,'Asset not found');
        return assets(entry,request);
      }
      if (route.name === 'theme') return theme(tail,request);
      throw new RenderError(404,'Page not found');
}

export async function handleRequest(request,engine,options) {
  let response;
  try { response=await dispatch(request,engine,options); }
  catch (error) {
    const status=error instanceof URIError ? 400 : error.status || (error.code==='ENOENT' ? 404 : 500);
    if (status===500 || error.cause) console.error(error);
    response=send(status,{detail:status===500 ? 'Internal rendering error' : error.message});
  }
  const headers=new Headers(response.headers);
  if (!headers.has('Cache-Control')) headers.set('Cache-Control','no-store');
  headers.set('X-Content-Type-Options','nosniff');
  if (request.method==='HEAD') { await response.body?.cancel(); return new Response(null,{status:response.status,headers}); }
  return new Response(response.body,{status:response.status,headers});
}
