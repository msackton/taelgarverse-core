import {RenderError,escapeHtml,pageUrl,parseDM} from './common.mjs';
import {document} from './render-engine.mjs';
import {contextQuery} from './header.mjs';
import {availableInContext} from './content-store.mjs';
import {homepage} from './homepage.mjs';
import {resolveDiagramLink} from './diagram-links.mjs';

const apiSpec = {
  openapi:'3.1.0', info:{title:'TaelgarVerse rendering API',version:'0.2.0'},
  paths:{
    '/api/page':{get:{summary:'Render a page for an in-world DR date',
      parameters:[{name:'page',in:'query',required:true,schema:{type:'string'}},
        {name:'date',in:'query',schema:{type:'string',pattern:'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'}},
        {name:'context',in:'query',schema:{type:'string'},description:'modern, custom, or a campaign context ID'},
        {name:'campaigns',in:'query',schema:{type:'string'},description:'Custom only: all, comma-separated campaign codes, or empty for none; repeated parameters are also accepted'},
        {name:'dm',in:'query',schema:{type:'boolean',default:false},description:'See Behind the Curtain: 1/true shows comment notes and Campaign:none blocks; a viewing preference available to every visitor'}],
      responses:{200:{description:'Article HTML, TOC, backlinks, date, campaigns and warnings'},400:{description:'Invalid input'},
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
async function route(request,engine,{renderPage=(page,date,context,dm,campaigns)=>engine.render(page,date,context,dm,undefined,campaigns),renderHome=context=>engine.renderHome(context),assets,theme,runtime='node',revision,releases=engine.releases}={}) {
      if (!['GET','HEAD'].includes(request.method)) { return new Response(JSON.stringify({detail:'Method not allowed'}),{status:405,headers:{Allow:'GET, HEAD','Content-Type':'application/json'}}); }
      const url = new URL(request.url);
      const pathname = decodeURIComponent(url.pathname);
      const date = url.searchParams.get('date') ?? undefined;
      const contextId = url.searchParams.get('context') ?? undefined;
      const selectedCampaigns = url.searchParams.has('campaigns') ? url.searchParams.getAll('campaigns') : undefined;
      const dm = parseDM(url.searchParams.get('dm'));
      if (pathname === '/health') return send(200,{status:'ok',pages:engine.store.bySlug.size,index_warnings:engine.store.warnings,context_warnings:engine.contexts.warnings,runtime,revision});
      if (pathname === '/api/contexts') return send(200,{contexts:engine.contexts.list(),warnings:engine.contexts.warnings});
      if (pathname === '/openapi.json') return send(200,apiSpec);
      if (pathname === '/api/diagram-links') {
        const source = url.searchParams.get('source'), targets = url.searchParams.getAll('target');
        if (!source || !targets.length || targets.length > 100 || targets.some(target => target.length > 2048)) {
          throw new RenderError(400,'source and 1–100 targets of at most 2048 characters are required');
        }
        const {entry,context} = engine.resolvePage(source,date,contextId,dm,selectedCampaigns);
        return send(200,{links:targets.map(target => resolveDiagramLink(target,{store:engine.store,entry,context,origin:url.origin}))});
      }
      if (pathname === '/api/navigation') {
        const branch = url.searchParams.get('branch');
        if (!branch) throw new RenderError(400,'branch is required');
        const context = {...engine.contexts.resolve(contextId,date,selectedCampaigns),dm};
        return send(200,engine.navigation.branch(context,branch,url.searchParams.get('page')));
      }
      if (pathname === '/api/page') {
        const page = url.searchParams.get('page');
        if (!page) throw new RenderError(400,'page is required');
        return send(200,await renderPage(page,date,contextId,dm,selectedCampaigns));
      }
      if (pathname.startsWith('/page/')) {
        try { return send(200,document(await renderPage(pathname.slice(6),date,contextId,dm,selectedCampaigns),engine.contexts.list(),engine.navigation,releases),'text/html'); }
        catch (error) {
          if (error.status !== 404) throw error;
          const context = {...engine.contexts.resolve(contextId,date,selectedCampaigns), dm};
          return send(404,document({title:'Page unavailable',html:'<h1>Page unavailable</h1><p>' + escapeHtml(error.message) +
            '. Choose another context or return to <a href="/?q=&amp;' + escapeHtml(contextQuery(context).toString()) + '">the page finder</a>.</p>',
            toc:'',warnings:[],context},engine.contexts.list(),engine.navigation,releases),'text/html');
        }
      }
      if (pathname === '/docs') {
        return send(200,shell('TaelgarVerse API','<h1>TaelgarVerse rendering API</h1><p>GET <code>/api/page?page=Zahara&amp;date=1730-02-01</code></p>' +
          '<form action="/api/page"><label>Page <input name="page" value="Zahara" required></label><label> Date (DR) ' +
          '<input name="date" value="' + engine.settings.default_date + '"></label><button>Try request</button></form>' +
          '<p>Returns article <code>html</code>, <code>toc</code>, <code>backlinks</code>, page/title/date/campaign context, and rendering warnings.</p>' +
          '<p><a href="/openapi.json">OpenAPI schema</a> · <a href="/?q=">Page finder</a></p>'),'text/html');
      }
      if (pathname.startsWith('/browse/')) {
        const context = {...engine.contexts.resolve(contextId,date,selectedCampaigns),dm};
        const view = engine.navigation.view(context,undefined,pathname.slice(8));
        const node = view.visible.get(pathname.slice(8));
        const items = node.children.map(child=>view.visible.get(child.id)).map(child=>'<li><a href="' + escapeHtml(engine.navigation.url(child,context)) + '">' + escapeHtml(child.label) + '</a></li>').join('');
        const overview = node.entry ? '<p><a href="' + escapeHtml(pageUrl(node.entry.slug,context.date,context)) + '">Read the overview</a></p>' : '';
        return send(200,document({title:node.label,html:'<h1>' + escapeHtml(node.label) + '</h1>' + overview +
          '<ul class="section-pages">' + items + '</ul>',toc:'',warnings:[],context,navigationId:node.id},engine.contexts.list(),engine.navigation,releases),'text/html');
      }
      if (pathname === '/') {
        const query = url.searchParams.get('q') || '';
        const context = {...engine.contexts.resolve(contextId,date,selectedCampaigns), dm};
        const searchContext = [...contextQuery(context)].map(([key,value])=>'<input type="hidden" name="' + key + '" value="' + escapeHtml(value) + '">').join('');
        const searchForm = '<form role="search" aria-label="Find a page">' + searchContext +
          '<input name="q" aria-label="Find a page" value="' + escapeHtml(query) + '"><button>Find a page</button></form>';
        if (!url.searchParams.has('q')) {
          const home = await renderHome(context);
          if (home) return send(200,document({...homepage(home,context,engine.store),title:'TaelgarVerse',context},engine.contexts.list(),engine.navigation,releases),'text/html');
        }
        const entries = [...engine.store.bySlug.values()].sort((a,b) => a.slug.localeCompare(b.slug))
          .filter(e => availableInContext(e,context) && (e.slug + ' ' + e.title).toLowerCase().includes(query.toLowerCase())).slice(0,100);
        const links = entries.map(e => '<li><a href="' + escapeHtml(pageUrl(e.slug,context.date,context)) + '">' + escapeHtml(e.title) + '</a></li>').join('');
        return send(200,document({title:'TaelgarVerse',html:'<h1>TaelgarVerse</h1><p>Explore the world, browse campaign resources, or find a page.</p>' +
          searchForm +
          '<p>Up to 100 matching pages.</p><ul>' + links + '</ul>',toc:'',warnings:[],context,query},engine.contexts.list(),engine.navigation,releases),'text/html');
      }
      if (pathname.startsWith('/assets/')) {
        const entry=engine.store.assets.get(pathname.slice(8));
        if (!entry) throw new RenderError(404,'Asset not found');
        return assets(entry,request);
      }
      if (pathname.startsWith('/theme/')) return theme(pathname.slice(7),request);
      throw new RenderError(404,'Page not found');
}

export async function handleRequest(request,engine,options) {
  let response;
  try { response=await route(request,engine,options); }
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
