# TMDB Proxy — 60-second setup

OmniFlix calls `api.themoviedb.org` (catalogue/search) and
`image.tmdb.org` (posters/backdrops) directly by default. Both can be
geo-blocked in some regions, which leaves the home rails, search
results, the *curated mood board*, and every image empty. **One tiny
Cloudflare Worker fixes everything globally — through a single URL.**

## How the Worker routes traffic

The Worker forwards requests based on the path:

| Browser hits | Worker forwards to |
|---|---|
| `https://<worker>/3/trending/all/day` | `https://api.themoviedb.org/3/trending/all/day` |
| `https://<worker>/t/p/w780/abc.jpg` | `https://image.tmdb.org/t/p/w780/abc.jpg` |

Both `/3/...` and `/t/p/...` are real TMDB path prefixes, so the
routing is unambiguous. You only paste **one URL** into `config.js`.

## 1.  Deploy the Worker

1. Open <https://dash.cloudflare.com> → **Workers & Pages** →
   **Create application** → **Create Worker**.
2. Give it any name (e.g. `tmdb-proxy`) → **Deploy**. Cloudflare creates
   a default "Hello World" Worker.
3. Click **Edit code** on the Worker page.
4. **Select all** the existing code and **delete it.**
5. Open `cloudflare-worker.js` from this folder, **copy the entire
   file**, and paste it into the Cloudflare editor.
6. Click **Save and deploy**.

You'll get a URL like `https://tmdb-proxy.<your-name>.workers.dev`.
Open it in a browser tab — you should see:

> `OmniFlix TMDB proxy is live. …`

**Quick sanity checks:**

* `https://<worker>.workers.dev/3/configuration` should return JSON
  (404 means routing is wrong; 401 means TMDB rejected — fine, only
  proves the proxy is alive).
* `https://<worker>.workers.dev/t/p/w200/8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg`
  should load a movie poster.

**Note about formats.** The Worker uses the classic
`addEventListener('fetch', …)` *Service Worker* syntax — that's what
the Cloudflare dashboard editor expects. No `export default`, no
Wrangler CLI needed.

## 2.  Wire it into OmniFlix

Open **`config.js`** (next to `index.html`) and paste your Worker URL:

```js
window.OMNIFLIX_CONFIG = {
  TMDB_PROXY_BASE:     'https://tmdb-proxy.your-name.workers.dev',
  PROXY_IMAGES:        true,    // images go through the same Worker
  PIP_DEFAULT_ENABLED: true,
};
```

Hard-refresh the app. Every TMDB call (catalogue, search, the mood
board) AND every poster/backdrop now route through your Worker.

## 3.  Want to save Worker requests on images?

Posters are loaded on almost every card, so they multiply Worker
requests fast (Cloudflare free tier = 100k req/day). If `image.tmdb.org`
is **not** blocked in your region, you can skip image proxying:

```js
PROXY_IMAGES: false,
```

Now only the JSON API goes through the Worker; images load directly
from TMDB's CDN.

## 4.  Custom domain (optional)

In the Worker → **Triggers** → **Custom domains** you can attach
e.g. `tmdb.example.com`. Update `TMDB_PROXY_BASE` to match.

---

## Picture-in-Picture (mini-player) toggle

The mini-player ("PiP") that floats when you scroll out of the watch
page is **user-controllable**. Open the accent picker (the contrast
icon in the top-right) — the very first row is the **Mini player**
switch. Flip it OFF and:

* the *Minimize* button on the watch page disappears,
* the player no longer auto-shrinks when you scroll the page,
* navigating away from a video closes the player cleanly.

The user's choice is remembered in `localStorage`. The fleet-wide
default for *new* visitors is controlled by `PIP_DEFAULT_ENABLED` in
`config.js`.
