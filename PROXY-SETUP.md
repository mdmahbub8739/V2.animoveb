# TMDB Proxy — 60-second setup

OmniFlix calls `api.themoviedb.org` and `image.tmdb.org` directly by default.
Both can be geo-blocked in some regions. **One Cloudflare Worker fixes everything.**

## How it routes

| Browser hits | Worker forwards to |
|---|---|
| `https://<worker>/3/trending/all/day` | `https://api.themoviedb.org/3/trending/all/day` |
| `https://<worker>/t/p/w780/abc.jpg` | `https://image.tmdb.org/t/p/w780/abc.jpg` |

## Deploy

1. dash.cloudflare.com → Workers & Pages → Create Worker
2. Deploy the default Hello World
3. Edit code → Select All → Delete
4. Paste `cloudflare-worker.js` → Save and deploy
5. Copy the `*.workers.dev` URL → paste into `config.js` as `TMDB_PROXY_BASE`

## Wire into config.js

```js
window.OMNIFLIX_CONFIG = {
  TMDB_PROXY_BASE: 'https://tmdb-proxy.your-name.workers.dev',
  PROXY_IMAGES: true,
  PIP_DEFAULT_ENABLED: true,
};
```

## Save Worker requests on images

Set `PROXY_IMAGES: false` to load images directly from TMDB CDN and save Worker quota.
