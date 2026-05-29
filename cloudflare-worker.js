/* =========================================================================
 *  OmniFlix · TMDB Cloudflare Worker Proxy   (Service Worker syntax)
 *  -------------------------------------------------------------------------
 *  One Worker, one URL — handles BOTH the TMDB v3 API and the TMDB image
 *  CDN. Routes by path prefix:
 *
 *     /3/...    →  https://api.themoviedb.org/3/...   (catalogue, search…)
 *     /t/p/...  →  https://image.tmdb.org/t/p/...    (posters + backdrops)
 *
 *  Works with the default Cloudflare dashboard editor — no Wrangler, no
 *  build step, no `export default` needed. Paste, save, deploy.
 *
 *  ┌─────────────────────────────────────────────────────────────────┐
 *  │  Deploy in 60 seconds:                                          │
 *  │  1.  dash.cloudflare.com → Workers & Pages → Create application │
 *  │  2.  Create Worker → name it → Deploy (makes a Hello World).    │
 *  │  3.  Open the Worker → Edit code → SELECT ALL → DELETE.         │
 *  │  4.  Paste THIS entire file. Click Save and deploy.             │
 *  │  5.  Copy the *.workers.dev URL → paste into config.js. Done.   │
 *  └─────────────────────────────────────────────────────────────────┘
 * ========================================================================= */

const TMDB_API_ORIGIN = 'https://api.themoviedb.org';   // /3/...
const TMDB_IMG_ORIGIN = 'https://image.tmdb.org';       // /t/p/...

const EDGE_TTL_API = 300;        // 5 min for API JSON
const EDGE_TTL_IMG = 86400;      // 24 h for images (they're immutable)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
  'Access-Control-Max-Age':       '86400',
};

addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const path = url.pathname;

  // ── Route by path prefix ────────────────────────────────────────────
  let upstream, ttl;
  if (path.startsWith('/t/p/')) {
    // TMDB image CDN — posters, backdrops, profiles, etc.
    upstream = TMDB_IMG_ORIGIN + path + url.search;
    ttl = EDGE_TTL_IMG;
  } else if (path.startsWith('/3/')) {
    // TMDB v3 API — catalogue, search, details, genres, etc.
    upstream = TMDB_API_ORIGIN + path + url.search;
    ttl = EDGE_TTL_API;
  } else if (path === '/' || path === '') {
    return new Response(
      'OmniFlix TMDB proxy is live.\n\n' +
      'Routes:\n' +
      '  /3/...    →  api.themoviedb.org/3/...\n' +
      '  /t/p/...  →  image.tmdb.org/t/p/...\n\n' +
      'Use this URL as TMDB_PROXY_BASE in config.js.',
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } }
    );
  } else {
    return new Response(
      'Not found. Valid prefixes: /3/   /t/p/',
      { status: 404, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } }
    );
  }

  // ── Forward upstream (clean headers, edge cache) ────────────────────
  const upstreamReq = new Request(upstream, {
    method:   request.method,
    headers:  { 'Accept': path.startsWith('/3/') ? 'application/json' : '*/*' },
    redirect: 'follow',
    cf:       { cacheTtl: ttl, cacheEverything: true },
  });

  let resp;
  try {
    resp = await fetch(upstreamReq);
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: 'upstream_fetch_failed', detail: String(err) }),
      { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  // Re-emit with CORS + cache hints. Strip any cookies the upstream tries
  // to set on our origin.
  const out = new Response(resp.body, resp);
  Object.entries(CORS_HEADERS).forEach(([k, v]) => out.headers.set(k, v));
  out.headers.set('Cache-Control', `public, max-age=${ttl}, s-maxage=${ttl}`);
  out.headers.delete('set-cookie');
  return out;
}