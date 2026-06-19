/* OmniFlix · TMDB Cloudflare Worker Proxy
 * Routes: /3/... -> api.themoviedb.org  |  /t/p/... -> image.tmdb.org
 * Paste into Cloudflare dashboard editor. No Wrangler needed. */

const TMDB_API_ORIGIN = 'https://api.themoviedb.org';
const TMDB_IMG_ORIGIN = 'https://image.tmdb.org';
const EDGE_TTL_API = 300;
const EDGE_TTL_IMG = 86400;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
  'Access-Control-Max-Age': '86400',
};

addEventListener('fetch', (event) => { event.respondWith(handleRequest(event.request)); });

async function handleRequest(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
  const url = new URL(request.url);
  const path = url.pathname;
  let upstream, ttl;
  if (path.startsWith('/t/p/')) { upstream = TMDB_IMG_ORIGIN + path + url.search; ttl = EDGE_TTL_IMG; }
  else if (path.startsWith('/3/')) { upstream = TMDB_API_ORIGIN + path + url.search; ttl = EDGE_TTL_API; }
  else if (path === '/' || path === '') return new Response('OmniFlix TMDB proxy is live.\nRoutes:\n  /3/... -> api.themoviedb.org/3/...\n  /t/p/... -> image.tmdb.org/t/p/...', { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });
  else return new Response('Not found. Valid prefixes: /3/   /t/p/', { status: 404, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });
  const upstreamReq = new Request(upstream, { method: request.method, headers: { 'Accept': path.startsWith('/3/') ? 'application/json' : '*/*' }, redirect: 'follow', cf: { cacheTtl: ttl, cacheEverything: true } });
  let resp;
  try { resp = await fetch(upstreamReq); }
  catch (err) { return new Response(JSON.stringify({ success: false, error: 'upstream_fetch_failed', detail: String(err) }), { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }); }
  const out = new Response(resp.body, resp);
  Object.entries(CORS_HEADERS).forEach(([k, v]) => out.headers.set(k, v));
  out.headers.set('Cache-Control', `public, max-age=${ttl}, s-maxage=${ttl}`);
  out.headers.delete('set-cookie');
  return out;
}
