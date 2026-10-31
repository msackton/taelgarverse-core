export const noIndex='noindex, nofollow, noarchive, nosnippet, noimageindex';
export const robots='User-agent: ChatGPT-User\nUser-agent: Claude-User\nUser-agent: Perplexity-User\nAllow: /\n\nUser-agent: *\nDisallow: /\n';

// Intentionally includes search indexers and link-preview bots. Cloudflare's
// verified classification is trusted metadata; request headers cannot supply it.
const automatedAgent=/bot|crawl|spider|slurp|indexer|scraper|scanner|facebookexternalhit|meta-external|chatgpt-user|claude-user|perplexity-user|anthropic-ai|cohere-ai|headlesschrome|phantomjs|python-requests|python-urllib|aiohttp|httpx\/|scrapy|curl\/|wget\/|go-http-client|libwww-perl|node-fetch|undici|axios\/|postmanruntime|zgrab|nuclei|censys|masscan|^node$/i;

// Only Cloudflare-supplied classification grants this read-only exception.
// A matching User-Agent or an HTTP header cannot establish assistant identity.
export function isUserAssistant(request) {
  return ['GET','HEAD'].includes(request.method) && request.cf?.verifiedBotCategory==='AI Assistant';
}

export function isCrawler(request) {
  if(isUserAssistant(request))return false;
  const category=request.cf?.verifiedBotCategory;
  const verified=typeof category==='string' && category.trim()!=='' &&
    !['unknown','not computed','unverified'].includes(category.toLowerCase());
  const agent=request.headers.get('User-Agent') || '';
  return verified || request.cf?.botManagement?.verifiedBot===true || !agent.trim() || automatedAgent.test(agent);
}

export function crawlerResponse(request) {
  const pathname=new URL(request.url).pathname;
  if(pathname==='/robots.txt') {
    if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{Allow:'GET, HEAD','Cache-Control':'no-store'}});
    return new Response(request.method==='HEAD'?null:robots,{headers:{
      'Content-Type':'text/plain; charset=utf-8','Cache-Control':'public, max-age=3600',
    }});
  }
  // Monitoring may inspect health, but this never opens a content route. Keep the
  // normal publication/health checks intact instead of returning a synthetic OK.
  if(pathname==='/health' && ['GET','HEAD'].includes(request.method))return null;
  if(!isCrawler(request))return null;
  return new Response(request.method==='HEAD'?null:'Automated access is not permitted.\n',{status:403,headers:{
    'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  }});
}

export function withCrawlerHeaders(response,enabled) {
  // Preserve the WebSocket attachment on upgrade responses in consumers that
  // share this policy. Upgrades cannot be indexed by search engines.
  if(!enabled || response.status===101)return response;
  const headers=new Headers(response.headers);
  headers.set('X-Robots-Tag',noIndex);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
