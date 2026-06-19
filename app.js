/* ═══════════════════════════════════════════════════════════════════════════
 *  OMNIFLIX — Application
 *  Pure-frontend cinema. TMDB + multi-source iframes + localStorage.
 *
 *  Highlights:
 *    • History-API routing (clean URLs, no hash)
 *    • Layout-aware skeleton loaders for every view
 *    • Persistent player host with YouTube-style PiP mini-window (draggable)
 *    • Episode grid with season picker
 *    • Source-agnostic player chain (Aurora → Nebula → …) under majestic names
 * ═══════════════════════════════════════════════════════════════════════════ */

(() => {
  'use strict';
const _nativeOpen = window.open.bind(window);
window.open = () => null;

if ('navigation' in window) {
  window.navigation.addEventListener('navigate', (e) => {
    const dest = new URL(e.destination.url);
    if (dest.origin !== location.origin) {
      e.preventDefault(); // বাইরের কোনো URL এ navigate হতে দেবে না
    }
  });
}
  // ───── Config ─────────────────────────────────────────────────────────────
  // Runtime config from /config.js — keeps the proxy URL out of source.
  // Falls back to direct TMDB if config.js is missing, so the app still
  // boots in regions where TMDB's API isn't geo-blocked.
  const _CFG = (typeof window !== 'undefined' && window.OMNIFLIX_CONFIG) || {};
  const _stripSlash = (s) => String(s || '').replace(/\/+$/, '');
  const _PROXY = _stripSlash(_CFG.TMDB_PROXY_BASE);

  const TMDB_API_KEY = '21c94d1181ff795c2eef4fb690d24ab6';
  // If TMDB_PROXY_BASE is set (your Cloudflare Worker), every TMDB API
  // call routes through it — fixes the geo-block globally. The Worker
  // mirrors the exact /3/... path layout, so no other call sites change.
  const TMDB_BASE = _PROXY
    ? `${_PROXY}/3`
    : 'https://api.themoviedb.org/3';
  // Images go through the SAME Worker by default (the Worker also routes
  // /t/p/... → image.tmdb.org). Set PROXY_IMAGES:false in config.js to
  // load posters directly and save Worker requests.
  const _IMG_ORIGIN = (_PROXY && _CFG.PROXY_IMAGES !== false)
    ? _PROXY
    : 'https://image.tmdb.org';
  const IMG = (size, path) => path ? `${_IMG_ORIGIN}/t/p/${size}${path}` : null;

  const STORE_PROGRESS = 'peachifyProgress';
  const STORE_FAVS     = 'animowebFavorites';
  const STORE_ACCENT   = 'animowebAccent';
  const STORE_PIP      = 'animowebPipEnabled';      // 'on' | 'off'
  const STORE_DL       = 'animowebDlEnabled';       // 'on' | 'off'
  const STORE_DL_ACK   = 'animowebDlAck';           // '1' once user has seen the warning
  const STORE_NSFW     = 'animowebNsfwEnabled';     // 'on' | 'off'

  const DL_BASE = _stripSlash(_CFG.DL_BASE_URL || 'https://dl.peachify.top');
  function dlEnabled() {
    const v = localStorage.getItem(STORE_DL);
    if (v === 'on')  return true;
    if (v === 'off') return false;
    return _CFG.DL_DEFAULT_ENABLED !== false;
  }
  function setDlEnabled(on) {
    localStorage.setItem(STORE_DL, on ? 'on' : 'off');
    document.documentElement.classList.toggle('dl-disabled', !on);
  }
  function dlAcknowledged() { return localStorage.getItem(STORE_DL_ACK) === '1'; }
  function ackDl() { localStorage.setItem(STORE_DL_ACK, '1'); }
  function dlUrl(type, id, season, episode) {
    if (!id) return null;
    if (type === 'tv') return `${DL_BASE}/tv/${id}/${season || 1}/${episode || 1}`;
    return `${DL_BASE}/movie/${id}`;
  }

  function nsfwEnabled() {
    const v = localStorage.getItem(STORE_NSFW);
    if (v === 'on')  return true;
    if (v === 'off') return false;
    return !!_CFG.NSFW_DEFAULT_ENABLED;
  }
  function setNsfwEnabled(on) {
    localStorage.setItem(STORE_NSFW, on ? 'on' : 'off');
    document.documentElement.classList.toggle('nsfw-on', on);
  }
  function adultParam() { return `include_adult=${nsfwEnabled() ? 'true' : 'false'}`; }

  // ───── PiP (mini-player) preference ─────────────────────────────────────
  // User-controllable switch surfaced in the Settings sheet. When OFF:
  //   • the watch-page "Minimize" button hides,
  //   • the player never auto-shrinks when the stage scrolls off-screen,
  //   • navigating away from a video closes the player instead of pip.
  function pipEnabled() {
    const v = localStorage.getItem(STORE_PIP);
    if (v === 'on')  return true;
    if (v === 'off') return false;
    return _CFG.PIP_DEFAULT_ENABLED !== false;      // default ON
  }
  function setPipEnabled(on) {
    localStorage.setItem(STORE_PIP, on ? 'on' : 'off');
    document.documentElement.classList.toggle('pip-disabled', !on);
    // If the user disabled PiP while a video is currently floating,
    // slide it back into the stage (or close it if no stage is mounted).
    if (!on && typeof mini !== 'undefined' && mini && mini.state === 'mini') {
      const anchor = document.querySelector('.player-anchor');
      if (anchor) { mini.setStageAnchor(anchor); mini.toStage(); }
      else mini.close();
    }
  }

  // NSFW filter is now user-controlled in Settings. adultParam() is recomputed
  // at request time so toggling the switch takes effect on next fetch.

  const SHELVES = [
    { key: 'cerebral', genreId: 53, mediaType: 'movie', title: 'Mind-bending <em>thrillers</em>', sub: 'Films that refuse to leave your head.',
      query: () => `${TMDB_BASE}/discover/movie?api_key=${TMDB_API_KEY}&with_genres=53,9648&sort_by=vote_count.desc&vote_count.gte=2000&${adultParam()}` },
    { key: 'romance', genreId: 10749, mediaType: 'movie',  title: 'Slow-burn <em>romance</em>',      sub: 'Long looks, longer silences.',
      query: () => `${TMDB_BASE}/discover/movie?api_key=${TMDB_API_KEY}&with_genres=10749&sort_by=vote_average.desc&vote_count.gte=400&${adultParam()}` },
    { key: 'saturday', genreId: 28, mediaType: 'movie', title: 'Loud, dumb, <em>fun</em>',        sub: 'Pure Saturday-night escapism.',
      query: () => `${TMDB_BASE}/discover/movie?api_key=${TMDB_API_KEY}&with_genres=28&sort_by=popularity.desc&${adultParam()}` },
    { key: 'horror', genreId: 27, mediaType: 'movie',   title: 'Lights off, <em>volume up</em>',  sub: 'Modern horror that hits.',
      query: () => `${TMDB_BASE}/discover/movie?api_key=${TMDB_API_KEY}&with_genres=27&sort_by=vote_count.desc&vote_count.gte=800&${adultParam()}` },
    { key: 'anime', genreId: 16, mediaType: 'tv',    title: 'From <em>Japan</em>, with feeling', sub: 'Anime films & series, hand-picked.',
      query: () => `${TMDB_BASE}/discover/tv?api_key=${TMDB_API_KEY}&with_original_language=ja&with_genres=16&sort_by=popularity.desc&${adultParam()}` },
    { key: 'classics', genreId: 18, mediaType: 'movie', title: 'Untouchable <em>classics</em>',  sub: 'Films you should know by heart.',
      query: () => `${TMDB_BASE}/discover/movie?api_key=${TMDB_API_KEY}&sort_by=vote_average.desc&vote_count.gte=5000&primary_release_date.lte=2005-01-01&${adultParam()}` },
    { key: 'now', genreId: 0, mediaType: 'movie',      title: 'In <em>theaters</em> now',         sub: 'Currently playing on big screens.',
      query: () => `${TMDB_BASE}/movie/now_playing?api_key=${TMDB_API_KEY}&${adultParam()}` },
    { key: 'after-dark', genreId: 0, mediaType: 'movie', title: 'After <em>dark</em>',           sub: 'Adults-only · 18+ cinema.',
      query: () => `${TMDB_BASE}/discover/movie?api_key=${TMDB_API_KEY}&include_adult=true&certification_country=US&with_keywords=190370|158718&sort_by=popularity.desc&vote_count.gte=20` }
  ];

  // ───── Anime config ──────────────────────────────────────────────────
  // TMDB doesn't have a single "anime" tag; we approximate via:
  //   • original_language=ja
  //   • genre=Animation (16)
  // This combo + Japanese keyword filters gives 99%+ anime accuracy.
  const ANIME = {
    base:    (type, params={}) => {
      const url = new URL(`${TMDB_BASE}/discover/${type}`);
      url.searchParams.set('api_key', TMDB_API_KEY);
      url.searchParams.set('with_genres', '16');
      url.searchParams.set('with_original_language', 'ja');
      url.searchParams.set('include_adult', nsfwEnabled() ? 'true' : 'false');
      Object.entries(params).forEach(([k,v]) => v != null && url.searchParams.set(k,v));
      return url.toString();
    },
    rails: [
      { key: 'trending',  title: 'Trending <em>this season</em>', sub: 'What every otaku is watching right now.',
        params: { sort_by: 'popularity.desc' } },
      { key: 'top',       title: 'All-time <em>masterpieces</em>', sub: 'Highest-rated anime ever made.',
        params: { sort_by: 'vote_average.desc', 'vote_count.gte': 500 } },
      { key: 'newest',    title: 'Just <em>aired</em>',           sub: 'Freshly released — straight from Japan.',
        params: { sort_by: 'first_air_date.desc', 'vote_count.gte': 10 } },
      { key: 'action',    title: 'Action & <em>shounen</em>',     sub: 'Fight scenes that broke the internet.',
        params: { with_genres: '16,10759', sort_by: 'popularity.desc' } },
      { key: 'romance',   title: 'Heartbreak, in <em>animation</em>', sub: 'Slow-burn anime romance.',
        params: { with_genres: '16,10749', sort_by: 'popularity.desc' } },
      { key: 'ecchi',     title: 'After-hours <em>anime</em>',    sub: '18+ ecchi · mature, uncensored.',
        params: { with_keywords: '13141|210024', sort_by: 'popularity.desc', include_adult: 'true' } }
    ],
    moviesQuery: (params={}) => ANIME.base('movie', params),
    tvQuery:     (params={}) => ANIME.base('tv',    params)
  };

  const ACCENTS = [
    { name: 'Ember',   accent: '#FF3B30', soft: 'rgba(255,59,48,0.18)',    glow: 'rgba(255,59,48,0.55)' },
    { name: 'Citrus',  accent: '#FFB820', soft: 'rgba(255,184,32,0.20)',   glow: 'rgba(255,184,32,0.55)' },
    { name: 'Verdant', accent: '#00D2A8', soft: 'rgba(0,210,168,0.18)',    glow: 'rgba(0,210,168,0.55)' },
    { name: 'Cobalt',  accent: '#3A8DFF', soft: 'rgba(58,141,255,0.20)',   glow: 'rgba(58,141,255,0.55)' },
    { name: 'Iris',    accent: '#A668FF', soft: 'rgba(166,104,255,0.20)',  glow: 'rgba(166,104,255,0.55)' },
    { name: 'Rose',    accent: '#FF5C8A', soft: 'rgba(255,92,138,0.20)',   glow: 'rgba(255,92,138,0.55)' },
    { name: 'Mist',    accent: '#9CA3AF', soft: 'rgba(156,163,175,0.20)',  glow: 'rgba(156,163,175,0.55)' },
    { name: 'Sunburn', accent: '#FF7849', soft: 'rgba(255,120,73,0.20)',   glow: 'rgba(255,120,73,0.55)' },
    { name: 'Plum',    accent: '#C2410C', soft: 'rgba(194,65,12,0.20)',    glow: 'rgba(194,65,12,0.55)' },
    { name: 'Mint',    accent: '#34D399', soft: 'rgba(52,211,153,0.20)',   glow: 'rgba(52,211,153,0.55)' }
  ];

  // ───── Collapsible long text ──────────────────────────────────────────
  // Show only a brief preview (CSS line-clamp). User taps "Read more" to
  // expand. Threshold gates the toggle so short paragraphs never get one.
  function collapsible(text, lines = 2, threshold = 140) {
    if (text == null) return '';
    const raw = String(text);
    if (!raw.trim()) return '';
    const safe = html(raw);
    if (raw.length < threshold) return safe;
    return `<span class="clamp-wrap"><span class="clamp" style="--clamp:${lines}">${safe}</span><button class="clamp-toggle" type="button" onclick="OMNIFLIX.toggleClamp(this)">Read more</button></span>`;
  }

  // ───── Tiny utils ─────────────────────────────────────────────────────────
  const $  = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const debounce = (fn, ms=250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const html = (s) => String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const fmtMinutes = (n) => { if (!n) return ''; const h = Math.floor(n/60), m = n%60; return h ? `${h}h ${m}m` : `${m}m`; };
  const fmtYear  = (s) => (s || '').slice(0, 4);
  const fmtScore = (n) => n ? (Math.round(n*10)/10).toFixed(1) : '—';
  const matchPct = (n) => n ? Math.round(n * 10) : null;

  // ───── TMDB client ────────────────────────────────────────────────────────
  const cache = new Map();
  async function tmdb(path, params={}) {
    const url = new URL(path.startsWith('http') ? path : TMDB_BASE + path);
    url.searchParams.set('api_key', TMDB_API_KEY);
    url.searchParams.set('language', 'en-US');
    if (!url.searchParams.has('include_adult')) url.searchParams.set('include_adult', nsfwEnabled() ? 'true' : 'false');
    Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
    const key = url.toString();
    if (cache.has(key)) return cache.get(key);
    const p = fetch(key).then(r => r.json()).catch(() => null);
    cache.set(key, p);
    return p;
  }

  // ───── State helpers ──────────────────────────────────────────────────────
  function getProgressStore() {
    try { return JSON.parse(localStorage.getItem(STORE_PROGRESS) || '{}'); } catch { return {}; }
  }
  function getFavorites() {
    try { return JSON.parse(localStorage.getItem(STORE_FAVS) || '[]'); } catch { return []; }
  }
  function saveFavorites(arr) { localStorage.setItem(STORE_FAVS, JSON.stringify(arr)); }
  function toggleFavorite(item) {
    const id = String(item.id);
    const favs = getFavorites();
    const found = favs.findIndex(x => String(x.id) === id);
    if (found >= 0) { favs.splice(found, 1); toast('Removed from your list'); }
    else { favs.unshift({ id, type: item.type, title: item.title, poster_path: item.poster_path, year: item.year }); toast('Saved to your list', 'check'); }
    saveFavorites(favs);
    return found < 0;
  }
  function isFavorite(id) {
    return getFavorites().some(x => String(x.id) === String(id));
  }
  function removeProgress(id) {
    const s = getProgressStore();
    delete s[String(id)];
    localStorage.setItem(STORE_PROGRESS, JSON.stringify(s));
  }

  // ───── Toast ──────────────────────────────────────────────────────────────
  let toastTimer;
  function toast(msg, icon='information-line') {
    const el = $('#toast');
    el.innerHTML = `<i class="ri-${icon}"></i> ${html(msg)}`;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  // ───── Accent / theme ─────────────────────────────────────────────────────
  function applyAccent(a) {
    document.documentElement.style.setProperty('--accent', a.accent);
    document.documentElement.style.setProperty('--accent-soft', a.soft);
    document.documentElement.style.setProperty('--accent-glow', a.glow);
    localStorage.setItem(STORE_ACCENT, a.name);
  }
  function loadAccent() {
    const name = localStorage.getItem(STORE_ACCENT);
    const a = ACCENTS.find(x => x.name === name) || ACCENTS[0];
    applyAccent(a);
    return a;
  }
  function buildPalette() {
    const pal = $('#palette');
    const current = localStorage.getItem(STORE_ACCENT) || 'Ember';
    pal.innerHTML = ACCENTS.map(a =>
      `<button data-name="${a.name}" title="${a.name}" style="background:${a.accent};color:${a.accent}" class="${a.name===current ? 'active' : ''}"></button>`
    ).join('');
    $$('#palette button').forEach(b => {
      b.onclick = () => {
        const a = ACCENTS.find(x => x.name === b.dataset.name);
        applyAccent(a);
        $$('#palette button').forEach(x => x.classList.toggle('active', x.dataset.name === a.name));
        toast(`Accent: ${a.name}`, 'palette-line');
      };
    });
  }
  function getCurrentAccentHex() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    return (v || '#FF3B30').replace('#', '');
  }

  // ───── Cards / partials ───────────────────────────────────────────────────
  function normalizeMedia(m) {
    const type = m.media_type || (m.first_air_date ? 'tv' : (m.title ? 'movie' : null));
    return {
      id: m.id, type,
      title: m.title || m.name,
      poster_path: m.poster_path,
      backdrop_path: m.backdrop_path,
      overview: m.overview,
      year: fmtYear(m.release_date || m.first_air_date),
      vote_average: m.vote_average, vote_count: m.vote_count, genre_ids: m.genre_ids
    };
  }

  function titleCard(m) {
    const n = normalizeMedia(m);
    if (!n.type) return '';
    const poster = IMG('w342', n.poster_path);
    const rating = n.vote_average ? `<span class="title-card__rating"><i class="ri-star-fill"></i> ${fmtScore(n.vote_average)}</span>` : '';
    const badge  = `<span class="title-card__badge">${n.type === 'tv' ? 'Series' : 'Film'}</span>`;
    const art = poster
      ? `<img src="${poster}" alt="${html(n.title)}" loading="lazy" decoding="async">`
      : `<div class="title-card__placeholder"><i class="ri-${n.type==='tv'?'tv-2-line':'film-line'}"></i></div>`;
    return `<a class="title-card" href="/title/${n.type}/${n.id}" data-link>
      <div class="title-card__poster"><div class="title-card__shimmer"></div>${art}${rating}${badge}</div>
      <div class="title-card__meta">
        <div class="title-card__title">${html(n.title)}</div>
        <div class="title-card__sub">${n.year || '—'}</div>
      </div>
    </a>`;
  }

  function rankCard(m, rank) {
    const n = normalizeMedia(m);
    const poster = IMG('w342', n.poster_path);
    return `<a class="rank-card" href="/title/${n.type}/${n.id}" data-link>
      <div class="rank-card__num">${rank}</div>
      <div class="rank-card__poster">${poster ? `<img src="${poster}" alt="${html(n.title)}" loading="lazy">` : ''}</div>
    </a>`;
  }

  function continueCard(rec) {
    const isTV = rec.type === 'tv';
    const watched = rec.progress?.watched || 0;
    const duration = rec.progress?.duration || 1;
    const pct = Math.min(100, (watched / duration) * 100);
    const backdrop = rec.backdrop_path ? IMG('w780', rec.backdrop_path) : (rec.poster_path ? IMG('w780', rec.poster_path) : null);
    const epLabel = isTV && rec.last_season_watched
      ? `S${rec.last_season_watched} E${rec.last_episode_watched}`
      : (rec.type === 'movie' ? 'Film' : 'Series');
    const remaining = Math.max(0, Math.round((duration - watched) / 60));
    const url = isTV
      ? `/watch/tv/${rec.id}/${rec.last_season_watched || 1}/${rec.last_episode_watched || 1}`
      : `/watch/movie/${rec.id}`;
    return `<a class="continue-card" href="${url}" data-link>
      <div class="continue-card__art">
        ${backdrop ? `<img src="${backdrop}" alt="${html(rec.title)}" loading="lazy">` : ''}
        <div class="continue-card__play"><i class="ri-play-circle-fill"></i></div>
        <div class="continue-card__bar"><span style="width:${pct}%"></span></div>
      </div>
      <button class="continue-card__remove" title="Remove" onclick="event.preventDefault();event.stopPropagation();OMNIFLIX.removeContinue(${rec.id})"><i class="ri-close-line"></i></button>
      <div class="continue-card__body">
        <div class="continue-card__title">${html(rec.title)}</div>
        <div class="continue-card__meta"><span>${epLabel}</span><span>·</span><span>${remaining} min left</span></div>
      </div>
    </a>`;
  }

  function personCard(p, opts = {}) {
    const photo = IMG('w342', p.profile_path);
    const sub = opts.subtitle != null ? opts.subtitle : (p.known_for_department || 'Acting');
    const tag = opts.tag ? `<span class="person-card__pill">${html(opts.tag)}</span>` : '';
    return `<a class="person-card" href="/person/${p.id}" data-link>
      ${tag}
      <div class="person-card__avatar">
        ${photo
          ? `<img src="${photo}" alt="${html(p.name)}" loading="lazy">`
          : `<div class="person-card__placeholder"><i class="ri-user-3-line"></i></div>`}
      </div>
      <div class="person-card__name">${html(p.name)}</div>
      <div class="person-card__role">${html(sub)}</div>
    </a>`;
  }

  // ───── Skeleton helpers ───────────────────────────────────────────────────
  const sk = (cls='') => `<div class="sk ${cls}"></div>`;
  function skTitleCard()  { return `<div class="sk-card"><div class="sk sk--poster"></div><div class="sk sk--line sk--line-lg"></div><div class="sk sk--line sk--line-sm"></div></div>`; }
  function skRail(n=7)    { return `<div class="rail"><div class="rail__strip">${Array.from({length:n}, skTitleCard).join('')}</div></div>`; }
  function skRankRail(n=10){ return `<div class="rank-rail">${Array.from({length:n}, ()=>`<div class="sk-rank"><div class="sk sk--bigNum"></div><div class="sk sk--poster"></div></div>`).join('')}</div>`; }
  function skSection(title='') { return `<section class="section">${title ? `<header class="section__head"><div><h2 class="section__title">${title}</h2></div></header>`:'<header class="section__head"><div><div class="sk sk--line sk--line-title"></div><div class="sk sk--line sk--line-sub"></div></div></header>'}${skRail()}</section>`; }
  function skHero()       {
    return `<section class="hero hero--skeleton"><div class="hero__skbg"></div><div class="hero__scrim"></div><div class="hero__content"><div class="sk sk--line sk--eyebrow"></div><div class="sk sk--line sk--title-xl"></div><div class="sk sk--line sk--title-xl" style="width:55%"></div><div class="sk sk--line sk--meta"></div><div class="sk sk--line sk--meta" style="width:80%"></div><div class="sk sk--line sk--meta" style="width:65%"></div><div class="hero__actions"><div class="sk sk--btn"></div><div class="sk sk--btn-ghost"></div></div></div></section>`;
  }
  function skGrid(n=18, cls='browse-grid') {
    return `<div class="${cls}">${Array.from({length:n}, ()=>`<div class="sk-card"><div class="sk sk--poster"></div><div class="sk sk--line sk--line-lg"></div><div class="sk sk--line sk--line-sm"></div></div>`).join('')}</div>`;
  }
  function skEpisodes(n=8) {
    return `<div class="episodes-grid">${Array.from({length:n}, ()=>`<div class="sk-episode"><div class="sk sk--still"></div><div class="sk sk--line sk--line-lg"></div><div class="sk sk--line sk--line-sm"></div><div class="sk sk--line sk--line-sm" style="width:60%"></div></div>`).join('')}</div>`;
  }
  function skDetail()     {
    return `<section class="detail-hero detail-hero--skeleton"><div class="detail-hero__skbg"></div><div class="detail-hero__scrim"></div><div class="detail-hero__content"><div class="sk sk--detailPoster"></div><div class="detail-hero__skmeta"><div class="sk sk--line sk--eyebrow"></div><div class="sk sk--line sk--title-xl"></div><div class="sk sk--line sk--meta" style="width:60%"></div><div class="sk sk--line sk--meta" style="width:90%"></div><div class="sk sk--line sk--meta" style="width:85%"></div><div class="sk sk--line sk--meta" style="width:78%"></div><div class="detail-hero__actions"><div class="sk sk--btn"></div><div class="sk sk--btn-ghost"></div></div></div></div></section>`;
  }
  function skPersonHero() {
    return `<section class="person-hero person-hero--skeleton"><div class="person-hero__skbg"></div><div class="person-hero__inner"><div class="sk sk--avatar"></div><div style="flex:1;min-width:0"><div class="sk sk--line sk--eyebrow"></div><div class="sk sk--line sk--title-xl"></div><div class="sk sk--line sk--meta" style="width:55%"></div><div class="sk sk--line sk--meta" style="width:40%"></div></div></div></section>`;
  }

  // ───── Router (History API — no hash) ─────────────────────────────────────
  const routes = {
    home: renderHome,
    movies: () => renderBrowse('movie'),
    tv: () => renderBrowse('tv'),
    anime: renderAnime,
    'anime-title': renderAnimeTitleRoute,
    'anime-watch': renderAnimeWatchRoute,
    people: renderPeople,
    list: renderList,
    title: renderTitleDetail,
    person: renderPersonDetail,
    watch: renderWatch,
    genre: renderGenre
  };

  function parsePath() {
    const raw = (location.pathname || '/').replace(/^\/+/, '');
    if (!raw) return { name: 'home', args: [] };
    const parts = raw.split('/').filter(Boolean).map(decodeURIComponent);
    return { name: parts[0], args: parts.slice(1) };
  }

  function setActiveNav(name) {
    // anime-title and anime-watch should highlight the Anime nav tab
    const resolved = (name === 'anime-title' || name === 'anime-watch') ? 'anime' : name;
    const target = ['home','movies','tv','anime','people','list'].includes(resolved) ? resolved : null;
    $$('.topnav__links a, .bottomnav a').forEach(a => {
      a.classList.toggle('active', a.dataset.route === target);
    });
  }

  async function route() {
    const { name, args } = parsePath();
    const fn = routes[name] || routes.home;
    setActiveNav(name);
    $('#search').classList.remove('open');

    // If we leave /watch, only auto-close the player if it was full-stage
    // (i.e. user navigated away without explicitly minimizing first).
    // If the player is already in mini-mode, keep it floating across navigation.
    if (name !== 'watch') {
      detachWatchAnchor();
      if (mini.state === 'stage') mini.close();
    }

    window.scrollTo({ top: 0 });

    const view = $('#view');
    view.classList.add('view--leaving');
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 40)));
    view.classList.remove('view--leaving');
    view.classList.add('view--entering');
    try { await fn(...args); }
    catch (err) {
      console.error('[route] failed', err);
      view.innerHTML = renderError('Something went sideways. Try again?');
    }
    requestAnimationFrame(() => view.classList.remove('view--entering'));
  }

  function navigate(to, replace=false) {
    if (replace) history.replaceState({}, '', to);
    else         history.pushState({}, '', to);
    route();
  }

  window.addEventListener('popstate', route);

  // Intercept anchor clicks for in-app navigation (data-link)
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-link]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('http') || a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    if (href === location.pathname) return;
    navigate(href);
  });

  // ───── HOME ───────────────────────────────────────────────────────────────
  async function renderHome() {
    const view = $('#view');
    // Layout-aware skeleton scaffold
    view.innerHTML = `
      ${skHero()}
      ${skSection()}
      ${skSection()}
      <section class="section"><header class="section__head"><div><div class="sk sk--line sk--line-title"></div></div></header>${skRankRail()}</section>
      ${skSection()}
      ${skSection()}
      ${skSection()}
    `;

    // Hero + parallel data
    // Use allSettled so one slow/failed endpoint doesn't blank the entire page
    // (this was the root cause of the "lonely user icon on a black page" bug
    // on mobile when the data network is flaky).
    const results = await Promise.allSettled([
      tmdb('/trending/all/day'),
      tmdb('/movie/top_rated'),
      tmdb('/person/popular'),
      tmdb('/genre/movie/list'),
      tmdb('/genre/tv/list')
    ]);
    const [trending, top, popularPeople, genresMov, genresTV] =
      results.map(r => r.status === 'fulfilled' ? r.value : null);

    // Hard failure guard — if literally nothing came back, show empty-state
    if (!trending && !top && !popularPeople) {
      view.innerHTML = `
        <section class="empty-state">
          <div class="empty-state__icon"><i class="ri-wifi-off-line"></i></div>
          <div class="empty-state__title">We can't reach the catalogue right now</div>
          <div class="empty-state__hint">Check your connection and try again — your watchlist and progress are saved locally.</div>
          <button class="btn-ghost" onclick="location.reload()"><i class="ri-refresh-line"></i> Retry</button>
        </section>
      `;
      return;
    }

    const heroItems = (trending?.results || []).filter(x => x.backdrop_path).slice(0, 6);

    // Now build real DOM
    view.innerHTML = `
      <section class="hero" id="hero">
        <div class="hero__dots" id="heroDots"></div>
      </section>
      ${section('continue', 'Pick up where you <em>left off</em>', 'Your watch progress lives in your browser.')}
      ${section('trending', 'Trending <em>this week</em>', 'What everyone is watching, right now.')}
      ${section('top10', 'The <em>Top 10</em>', 'Most loved films on the planet today.', 'rank')}
      ${section('chips', 'Browse by <em>genre</em>', '', 'custom')}
      ${section('shelf-1', '', '')}
      ${section('shelf-2', '', '')}
      ${section('shelf-3', '', '')}
      ${section('vibes', 'A <em>curated</em> mood board', 'Hand-picked shelves for any night.', 'custom')}
      ${section('shelf-4', '', '')}
      ${section('shelf-5', '', '')}
      ${section('people', 'People to <em>discover</em>', 'Following the cast and crew.')}
      ${footer()}
    `;

    renderHero(heroItems);

    // Continue watching
    const progStore = getProgressStore();
    const continueItems = Object.values(progStore)
      .filter(x => x && x.progress && x.progress.duration > 0 && (x.progress.watched / x.progress.duration) < 0.97)
      .sort((a, b) => (b.last_updated || 0) - (a.last_updated || 0))
      .slice(0, 12);
    const contSec = $('#sec-continue');
    if (contSec) {
      if (continueItems.length) contSec.querySelector('.rail').innerHTML = continueItems.map(continueCard).join('');
      else contSec.remove();
    }

    // Trending rail
    $('#sec-trending .rail').innerHTML = (trending?.results || []).slice(0, 16).map(titleCard).join('');

    // Top 10
    $('#sec-top10 .rank-rail').innerHTML = (top?.results || []).slice(0, 10).map((m, i) => rankCard(m, i + 1)).join('');

    // Genre chips
    const allGenres = [
      ...((genresMov && genresMov.genres) || []).map(g => ({...g, type: 'movie'})),
      ...((genresTV && genresTV.genres) || []).map(g => ({...g, type: 'tv'}))
    ];
    const dedup = new Map();
    allGenres.forEach(g => { if (!dedup.has(g.name)) dedup.set(g.name, g); });
    const featured = Array.from(dedup.values()).slice(0, 14);
    $('#sec-chips .section__body').innerHTML = `<div class="chips">${featured.map(g =>
      `<a class="chip" href="/genre/${g.type}/${g.id}/${encodeURIComponent(g.name)}" data-link>${html(g.name)}</a>`
    ).join('')}</div>`;

    // ── Vibe mood grid (render EAGERLY) ─────────────────────────────
    // Previously this grid was only painted after every shelf-data fetch
    // had resolved. If TMDB was slow / geo-blocked the mood board ended
    // up permanently empty. We now render the cards immediately from the
    // static SHELVES config (titles always present, gradient fallback),
    // then progressively swap in backdrops as data arrives.
    const vibeAccents = ['#FF3B30','#3A8DFF','#A668FF','#00D2A8','#FFB820','#FF5C8A','#FF7849','#FF2DAA'];
    const renderVibeCard = (s, i, bg) => `
      <a class="vibe-card" href="/genre/${s.mediaType || 'movie'}/${s.genreId || 0}/${encodeURIComponent(s.title.replace(/<[^>]*>/g,''))}"
         data-link data-vibe="${s.key}"
         style="--vc:${vibeAccents[i % vibeAccents.length]}">
        <div class="vibe-card__bg" data-bg ${bg ? `style="background-image:url(${bg})"` : ''}></div>
        <div class="vibe-card__tint"></div>
        <div class="vibe-card__veil"></div>
        <span class="vibe-card__sub">${html(s.key)}</span>
        <h3 class="vibe-card__title">${s.title}</h3>
      </a>`;
    const vibesBody = $('#sec-vibes .section__body');
    if (vibesBody) {
      vibesBody.innerHTML = `<div class="vibe-grid">${
        SHELVES.map((s, i) => renderVibeCard(s, i, null)).join('')
      }</div>`;
    }

    // Curated shelves — fetch in parallel; each individually resilient.
    const shelfData = await Promise.all(
      SHELVES.map(s =>
        fetch(s.query())
          .then(r => r.ok ? r.json() : { results: [] })
          .catch(() => ({ results: [] }))
      )
    );
    const shelfSlots = ['shelf-1','shelf-2','shelf-3','shelf-4','shelf-5'];
    const picks = [0, 1, 4, 3, 5];
    shelfSlots.forEach((slotId, idx) => {
      const shelf = SHELVES[picks[idx]];
      const data = shelfData[picks[idx]];
      const sec = $('#sec-' + slotId);
      if (!sec) return;
      sec.querySelector('.section__title').innerHTML = shelf.title;
      const subEl = sec.querySelector('.section__sub');
      if (subEl) subEl.textContent = shelf.sub;
      else {
        const head = sec.querySelector('.section__head > div');
        if (head) head.insertAdjacentHTML('beforeend', `<div class="section__sub">${html(shelf.sub)}</div>`);
      }
      sec.querySelector('.rail').innerHTML = (data?.results || []).slice(0, 16).map(titleCard).join('');
    });

    // Progressive enhancement: swap in real backdrops on existing vibe
    // cards. If every TMDB call failed the gradient-only fallback we
    // painted above stays — the mood board never appears blank.
    if (vibesBody) {
      SHELVES.forEach((s, i) => {
        const sample = shelfData[i]?.results?.find(r => r.backdrop_path);
        const bg = sample ? IMG('w780', sample.backdrop_path) : null;
        if (!bg) return;
        const card = vibesBody.querySelector(`.vibe-card[data-vibe="${s.key}"] [data-bg]`);
        if (card) card.style.backgroundImage = `url(${bg})`;
      });
    }

    // People
    $('#sec-people .rail').innerHTML = (popularPeople?.results || []).slice(0, 12).map(personCard).join('');

    startHeroRotation();
  }

  function section(id, title, sub, mode='rail') {
    let body;
    if (mode === 'rank')        body = `<div class="rank-rail"></div>`;
    else if (mode === 'custom') body = `<div class="section__body"></div>`;
    else                        body = `<div class="rail"><div class="rail__strip">${Array.from({length:7}, skTitleCard).join('')}</div></div>`;
    return `<section class="section" id="sec-${id}">
      <header class="section__head">
        <div>
          <h2 class="section__title">${title || ''}</h2>
          ${sub ? `<div class="section__sub">${sub}</div>` : ''}
        </div>
      </header>
      ${body}
    </section>`;
  }

  function renderHero(items) {
    if (!items.length) return;
    const slides = items.map((m, i) => {
      const n = normalizeMedia(m);
      const bg = IMG('original', n.backdrop_path);
      const score = matchPct(n.vote_average);
      const tagline = m.overview ? m.overview.split('. ')[0] + '.' : '';
      return `<div class="hero__slide ${i===0?'active':''}" data-i="${i}">
        <div class="hero__backdrop" style="background-image:url(${bg})"></div>
        <div class="hero__scrim"></div>
        <div class="hero__content">
          <span class="eyebrow"><span class="dot"></span> Featured · ${n.type === 'tv' ? 'Series' : 'Film'}</span>
          <h1 class="hero__title">${html(n.title)}</h1>
          <div class="hero__meta">
            ${score ? `<span class="score"><i class="ri-star-fill"></i> ${score}%</span>` : ''}
            ${score ? `<span class="dot"></span>` : ''}
            <span>${n.year || ''}</span>
            <span class="dot"></span>
            <span class="mono">${n.type === 'tv' ? 'SERIES' : 'FILM'}</span>
          </div>
          <p class="hero__synopsis">${collapsible(tagline, 2, 140)}</p>
          <div class="hero__actions">
            <button class="btn-primary" onclick="OMNIFLIX.openWatchById('${n.type}', ${n.id})"><i class="ri-play-fill"></i> Watch now</button>
            <a class="btn-ghost" href="/title/${n.type}/${n.id}" data-link><i class="ri-information-line"></i> More info</a>
          </div>
        </div>
      </div>`;
    }).join('');
    const dots = items.map((_, i) => `<button class="${i===0?'active':''}" data-i="${i}"></button>`).join('');
    $('#hero').insertAdjacentHTML('afterbegin', slides);
    $('#heroDots').innerHTML = dots;
    $$('#heroDots button').forEach(b => {
      b.addEventListener('click', () => setHeroSlide(parseInt(b.dataset.i)));
    });
  }

  let heroIndex = 0;
  let heroTimer = null;
  function setHeroSlide(i) {
    const slides = $$('#hero .hero__slide');
    const dots = $$('#heroDots button');
    if (!slides.length) return;
    heroIndex = (i + slides.length) % slides.length;
    slides.forEach((s, idx) => s.classList.toggle('active', idx === heroIndex));
    dots.forEach((d, idx) => d.classList.toggle('active', idx === heroIndex));
  }
  function startHeroRotation() {
    if (heroTimer) clearInterval(heroTimer);
    heroTimer = setInterval(() => setHeroSlide(heroIndex + 1), 7500);
    wireHeroSwipe(); // attach swipe gesture once slides exist
  }

  // ── Hero touch-swipe (left/right to change slide) ─────────────────────
  function wireHeroSwipe() {
    const hero = document.getElementById('hero');
    if (!hero || hero._swipeWired) return;
    hero._swipeWired = true;
    let sx = 0, sy = 0, tracking = false, swallow = false;
    hero.addEventListener('pointerdown', (e) => {
      // Only track plain touch swipes — let buttons/links work normally
      if (e.pointerType === 'mouse') return;
      if (e.target.closest('button, a')) return;
      sx = e.clientX; sy = e.clientY; tracking = true; swallow = false;
    }, { passive: true });
    hero.addEventListener('pointermove', (e) => {
      if (!tracking) return;
      const dx = Math.abs(e.clientX - sx), dy = Math.abs(e.clientY - sy);
      // Once we know it's a horizontal swipe, claim the gesture
      if (!swallow && dx > 12 && dx > dy * 1.4) swallow = true;
    }, { passive: true });
    hero.addEventListener('pointerup', (e) => {
      if (!tracking) return;
      tracking = false;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        setHeroSlide(heroIndex + (dx < 0 ? 1 : -1));
        // Reset the auto-rotate timer so the slide they swiped to stays a while
        if (heroTimer) {
          clearInterval(heroTimer);
          heroTimer = setInterval(() => setHeroSlide(heroIndex + 1), 7500);
        }
      }
    }, { passive: true });
    hero.addEventListener('pointercancel', () => { tracking = false; });
  }

  // ───── BROWSE ─────────────────────────────────────────────────────────────
  let browseState = { type: 'movie', sort: 'popularity.desc', genre: null, page: 1, hasMore: true, results: [] };
  async function renderBrowse(type) {
    browseState = { type, sort: 'popularity.desc', genre: null, page: 1, hasMore: true, results: [] };
    const subtitle = type === 'movie' ? 'A library of cinema, hand-picked from across the world.' : 'Long-form storytelling at its finest.';

    $('#view').innerHTML = `
      <header class="page-header">
        <span class="eyebrow page-header__eyebrow"><span class="dot"></span> ${type === 'movie' ? 'Cinema' : 'Television'}</span>
        <h1 class="page-header__title">All <em>${type === 'movie' ? 'films' : 'series'}</em></h1>
        <p class="page-header__sub">${subtitle}</p>
      </header>
      <div class="filter-bar"><div class="sk sk--line sk--meta" style="width:120px"></div></div>
      <section class="section">${skGrid(18)}</section>
    `;

    const genres = (await tmdb('/genre/' + type + '/list')).genres || [];

    $('#view').innerHTML = `
      <header class="page-header">
        <span class="eyebrow page-header__eyebrow"><span class="dot"></span> ${type === 'movie' ? 'Cinema' : 'Television'}</span>
        <h1 class="page-header__title">All <em>${type === 'movie' ? 'films' : 'series'}</em></h1>
        <p class="page-header__sub">${subtitle}</p>
      </header>
      <div class="filter-bar">
        <span class="filter-bar__label">Sort</span>
        <button class="chip active" data-sort="popularity.desc">Popular</button>
        <button class="chip" data-sort="vote_average.desc">Top rated</button>
        <button class="chip" data-sort="${type==='movie'?'release_date.desc':'first_air_date.desc'}">Newest</button>
        <span class="filter-bar__label" style="margin-left:auto">Genre</span>
        <select id="genreSelect" class="chip" style="background:var(--bg-2);color:var(--text);padding-right:36px;">
          <option value="">Any</option>
          ${genres.map(g => `<option value="${g.id}">${html(g.name)}</option>`).join('')}
        </select>
      </div>
      <section class="section">
        <div class="browse-grid" id="browseGrid"></div>
        <div class="load-more">
          <button class="btn-ghost" id="loadMore"><i class="ri-add-line"></i> Load more</button>
        </div>
      </section>
      ${footer()}
    `;

    $$('.filter-bar [data-sort]').forEach(b => b.addEventListener('click', () => {
      $$('.filter-bar [data-sort]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      browseState.sort = b.dataset.sort;
      browseState.page = 1;
      browseState.results = [];
      $('#browseGrid').innerHTML = '';
      loadBrowse();
    }));
    $('#genreSelect').addEventListener('change', (e) => {
      browseState.genre = e.target.value || null;
      browseState.page = 1; browseState.results = [];
      $('#browseGrid').innerHTML = '';
      loadBrowse();
    });
    $('#loadMore').addEventListener('click', loadBrowse);

    loadBrowse();
  }

  async function loadBrowse() {
    const grid = $('#browseGrid');
    // Append placeholder skeletons during load
    const placeholderHtml = Array.from({length:12}, () =>
      `<div class="sk-card sk-card--inline"><div class="sk sk--poster"></div><div class="sk sk--line sk--line-lg"></div><div class="sk sk--line sk--line-sm"></div></div>`
    ).join('');
    grid.insertAdjacentHTML('beforeend', placeholderHtml);

    const { type, sort, genre, page } = browseState;
    const params = { sort_by: sort, page };
    if (genre) params.with_genres = genre;
    if (sort === 'vote_average.desc') params['vote_count.gte'] = 200;
    const data = await tmdb('/discover/' + type, params);

    // Remove placeholders
    $$('.sk-card--inline', grid).forEach(el => el.remove());

    const results = (data.results || []).filter(r => r.poster_path);
    browseState.results.push(...results);
    browseState.hasMore = page < (data.total_pages || 1);
    grid.insertAdjacentHTML('beforeend', results.map(r => titleCard({...r, media_type: type})).join(''));
    browseState.page += 1;
    $('#loadMore').style.display = browseState.hasMore ? '' : 'none';
  }

  // ───── GENRE ──────────────────────────────────────────────────────────────
  async function renderGenre(type, id, name) {
    name = decodeURIComponent(name || 'Genre');
    $('#view').innerHTML = `
      <header class="page-header">
        <span class="eyebrow page-header__eyebrow"><span class="dot"></span> Genre · ${type === 'tv' ? 'Series' : 'Films'}</span>
        <h1 class="page-header__title"><em>${html(name)}</em></h1>
        <p class="page-header__sub">Most loved ${type === 'tv' ? 'series' : 'films'} in this genre.</p>
      </header>
      <section class="section">
        <div class="browse-grid" id="genreGrid">${skGrid(18, 'browse-grid')
          .replace('<div class="browse-grid">','<div style="display:contents">').replace(/<\/div>$/,'</div>')}</div>
        <div class="load-more"><button class="btn-ghost" id="loadMore"><i class="ri-add-line"></i> Load more</button></div>
      </section>
      ${footer()}
    `;
    const state = { page: 1, hasMore: true, first: true };
    const grid = $('#genreGrid');
    async function load() {
      const data = await tmdb('/discover/' + type, { with_genres: id, sort_by: 'popularity.desc', page: state.page });
      if (state.first) { grid.innerHTML = ''; state.first = false; }
      const r = (data.results || []).filter(x => x.poster_path);
      grid.insertAdjacentHTML('beforeend', r.map(m => titleCard({...m, media_type: type})).join(''));
      state.hasMore = state.page < (data.total_pages || 1);
      state.page += 1;
      $('#loadMore').style.display = state.hasMore ? '' : 'none';
    }
    $('#loadMore').addEventListener('click', load);
    load();
  }

  // ───── ANIME — powered by Anikoto API + MegaPlay ────────────────────────
  async function renderAnime() {
    const view = $('#view');
    view.innerHTML = '<div id="alViewRoot" class="al-view-root"></div>';
    if (window.AnikotoModule) {
      await window.AnikotoModule.renderPage(document.getElementById('alViewRoot'));
    } else if (window.AniListModule) {
      await window.AniListModule.renderPage(document.getElementById('alViewRoot'));
    } else {
      view.innerHTML = '<p style="color:#f87171;padding:40px">Anime module not loaded.</p>';
    }
  }

  // ───── ANIME TITLE — series detail via Anikoto ─────────────────────────
  async function renderAnimeTitleRoute(slug) {
    if (window.AnikotoModule) {
      await window.AnikotoModule.renderAnimeTitle(slug);
    } else {
      $('#view').innerHTML = '<p style="color:#f87171;padding:40px">Anime module not loaded.</p>';
    }
  }

  // ───── ANIME WATCH — episode player via MegaPlay ───────────────────────
  async function renderAnimeWatchRoute(slug, embedId, language) {
    if (window.AnikotoModule) {
      await window.AnikotoModule.renderAnimeWatch(slug, embedId, language);
    } else {
      $('#view').innerHTML = '<p style="color:#f87171;padding:40px">Anime module not loaded.</p>';
    }
  }

  // Stub — Anikoto module handles its own grid
  async function loadAnimeGrid() {}


  // ───── PEOPLE ─────────────────────────────────────────────────────────────
  let peopleState = { mode: 'popular', q: '', page: 1, hasMore: true };
  async function renderPeople() {
    peopleState = { mode: 'popular', q: '', page: 1, hasMore: true };
    $('#view').innerHTML = `
      <header class="page-header">
        <span class="eyebrow page-header__eyebrow"><span class="dot"></span> Cast · Directors · Crew</span>
        <h1 class="page-header__title">The <em>people</em></h1>
        <p class="page-header__sub">Search for any actor, director, or crew member. Dive into their entire filmography.</p>
      </header>
      <div class="filter-bar">
        <span class="filter-bar__label">Showing</span>
        <button class="chip active" data-mode="popular">Popular</button>
        <button class="chip" data-mode="trending_day">Trending today</button>
        <button class="chip" data-mode="trending_week">Trending this week</button>
        <button class="chip chip--anime" data-mode="anime_vas"><i class="ri-sparkling-2-fill"></i> Anime VAs &amp; characters</button>
        <button class="btn-ghost" style="margin-left:auto" onclick="OMNIFLIX.openSearch('person')"><i class="ri-search-line"></i> Search a name</button>
      </div>
      <section class="section">
        <div class="people-grid" id="peopleGrid"></div>
        <div class="load-more"><button class="btn-ghost" id="loadMore"><i class="ri-add-line"></i> Load more</button></div>
      </section>
      ${footer()}
    `;
    $$('.filter-bar [data-mode]').forEach(b => b.addEventListener('click', () => {
      $$('.filter-bar [data-mode]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      peopleState.mode = b.dataset.mode;
      peopleState.page = 1;
      $('#peopleGrid').innerHTML = '';
      loadPeople();
    }));
    $('#loadMore').addEventListener('click', loadPeople);
    loadPeople();
  }

  // Anime VA / character aggregation cache — computed once per session.
  // Strategy: scan the most-popular anime TV shows + films, merge their
  // /credits cast, dedupe by person id, score by total appearances × pop,
  // and attach the most-recurring character to each card.
  let _animeVACache = null;
  async function buildAnimeVAList() {
    if (_animeVACache) return _animeVACache;
    // Fetch top anime in parallel: TV (2 pages) + films (1 page)
    const tvUrls = [1, 2].map(p => ANIME.tvQuery({ sort_by: 'popularity.desc', page: p }));
    const mvUrls = [1].map(p => ANIME.moviesQuery({ sort_by: 'popularity.desc', page: p }));
    const lists = await Promise.all(
      tvUrls.map(u => fetch(u).then(r => r.json()).catch(() => ({ results: [] })))
        .concat(mvUrls.map(u => fetch(u).then(r => r.json()).catch(() => ({ results: [] }))))
    );
    const tvShows = lists.slice(0, 2).flatMap(l => (l.results||[]).slice(0, 10).map(x => ({ ...x, _t: 'tv' })));
    const films   = lists.slice(2).flatMap(l => (l.results||[]).slice(0, 8).map(x => ({ ...x, _t: 'movie' })));
    const titles  = [...tvShows, ...films];

    // Fetch credits in parallel — TMDB tolerates a couple dozen concurrent reqs.
    const credits = await Promise.all(
      titles.map(t => tmdb(`/${t._t}/${t.id}/credits`).catch(() => ({ cast: [] })))
    );

    // Aggregate cast across all anime credits.
    const acc = new Map();   // personId -> { person, count, characters: Map<char, n>, totalPop }
    credits.forEach((c, idx) => {
      const t = titles[idx];
      (c?.cast || []).slice(0, 12).forEach(cast => {
        if (!cast.profile_path) return;          // skip without a photo
        const k = String(cast.id);
        let rec = acc.get(k);
        if (!rec) {
          rec = { person: cast, count: 0, chars: new Map(), titles: [] };
          acc.set(k, rec);
        }
        rec.count += 1;
        const ch = (cast.character || '').replace(/\s*\(voice\)\s*/i, '').trim();
        if (ch) rec.chars.set(ch, (rec.chars.get(ch) || 0) + 1);
        if (rec.titles.length < 3) rec.titles.push(t.name || t.title);
      });
    });

    // Rank: appearances first, then popularity tiebreak.
    const ranked = [...acc.values()]
      .map(r => {
        // Pick the most-common character role for this person.
        let topChar = ''; let topN = 0;
        r.chars.forEach((n, ch) => { if (n > topN) { topN = n; topChar = ch; } });
        return {
          ...r.person,
          _animeCount: r.count,
          _topChar:    topChar,
          _knownFor:   r.titles.slice(0, 2).join(' · ')
        };
      })
      .sort((a, b) =>
        (b._animeCount - a._animeCount) ||
        ((b.popularity || 0) - (a.popularity || 0))
      );

    _animeVACache = ranked;
    return ranked;
  }

  async function loadPeople() {
    const grid = $('#peopleGrid');
    const placeholderHtml = Array.from({length:12}, () =>
      `<div class="sk-person"><div class="sk sk--avatar"></div><div class="sk sk--line sk--line-lg"></div><div class="sk sk--line sk--line-sm"></div></div>`
    ).join('');
    grid.insertAdjacentHTML('beforeend', placeholderHtml);

    // Anime VAs / characters → computed locally (one-shot, then paginated client-side).
    if (peopleState.mode === 'anime_vas') {
      const ranked = await buildAnimeVAList();
      $$('.sk-person', grid).forEach(el => el.remove());
      const pageSize = 24;
      const start = (peopleState.page - 1) * pageSize;
      const slice = ranked.slice(start, start + pageSize);
      grid.insertAdjacentHTML('beforeend', slice.map(p => personCard(p, {
        subtitle: p._topChar ? `as ${p._topChar}` : (p._knownFor || 'Voice acting'),
        tag: p._animeCount > 1 ? `${p._animeCount} anime` : ''
      })).join(''));
      peopleState.hasMore = (start + pageSize) < ranked.length;
      peopleState.page += 1;
      $('#loadMore').style.display = peopleState.hasMore ? '' : 'none';
      return;
    }

    const endpoints = { popular: '/person/popular', trending_day: '/trending/person/day', trending_week: '/trending/person/week' };
    const data = await tmdb(endpoints[peopleState.mode], { page: peopleState.page });

    $$('.sk-person', grid).forEach(el => el.remove());

    const results = (data.results || []).filter(p => p.profile_path);
    grid.insertAdjacentHTML('beforeend', results.map(p => personCard(p)).join(''));
    peopleState.hasMore = peopleState.page < (data.total_pages || 1);
    peopleState.page += 1;
    $('#loadMore').style.display = peopleState.hasMore ? '' : 'none';
  }

  // ───── PERSON DETAIL ──────────────────────────────────────────────────────
  async function renderPersonDetail(id) {
    $('#view').innerHTML = skPersonHero() + `<div class="person-bio-wrap"><div><div class="sk sk--line sk--eyebrow"></div>${Array.from({length:6}, ()=>'<div class="sk sk--line sk--meta"></div>').join('')}</div><aside class="person-facts"><div class="sk sk--line sk--line-lg"></div>${Array.from({length:4}, ()=>'<div class="sk sk--line sk--meta"></div>').join('')}</aside></div>` + `<section class="section">${skGrid(8)}</section>`;
    const data = await tmdb('/person/' + id, { append_to_response: 'combined_credits,images,external_ids' });

    const backdrop =
      (data.combined_credits?.cast || []).concat(data.combined_credits?.crew || [])
        .map(c => c.backdrop_path).find(Boolean)
      || data.profile_path;

    const cast = (data.combined_credits?.cast || []).filter(c => c.poster_path);
    const crew = (data.combined_credits?.crew || []).filter(c => c.poster_path);
    const sortByPop = (a, b) => (b.popularity || 0) - (a.popularity || 0);
    cast.sort(sortByPop); crew.sort(sortByPop);

    const totalCredits = cast.length + crew.length;
    const bio = (data.biography || '').trim();
    const lifeline = data.birthday ? lifeText(data.birthday, data.deathday) : null;

    $('#view').innerHTML = `
      <section class="person-hero">
        <div class="person-hero__bg" style="background-image:url(${IMG('w1280', backdrop) || ''})"></div>
        <div class="person-hero__inner">
          <div class="person-hero__avatar">
            ${data.profile_path
              ? `<img src="${IMG('w500', data.profile_path)}" alt="${html(data.name)}">`
              : `<div class="person-card__placeholder"><i class="ri-user-3-line"></i></div>`}
          </div>
          <div>
            <span class="eyebrow"><span class="dot"></span> ${html(data.known_for_department || 'Person')}</span>
            <h1 class="person-hero__name">${html(data.name)}</h1>
            <div class="person-hero__stats">
              ${lifeline ? `<span class="stat-pill"><i class="ri-cake-2-line"></i> ${lifeline}</span>` : ''}
              ${data.place_of_birth ? `<span class="stat-pill"><i class="ri-map-pin-line"></i> ${html(data.place_of_birth)}</span>` : ''}
              <span class="stat-pill"><i class="ri-film-line"></i> ${totalCredits} credits</span>
              ${data.popularity ? `<span class="stat-pill"><i class="ri-fire-line"></i> ${data.popularity.toFixed(1)} pop.</span>` : ''}
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              ${data.external_ids?.imdb_id ? `<a class="btn-ghost" target="_blank" rel="noopener" href="https://www.imdb.com/name/${data.external_ids.imdb_id}"><i class="ri-imdb-line"></i> IMDb</a>` : ''}
              ${data.homepage ? `<a class="btn-ghost" target="_blank" rel="noopener" href="${data.homepage}"><i class="ri-global-line"></i> Website</a>` : ''}
            </div>
          </div>
        </div>
      </section>

      <div class="person-bio-wrap">
        <div>
          <span class="eyebrow"><span class="dot"></span> Biography</span>
          <div class="person-bio ${bio.length > 280 ? 'collapsed' : ''}" id="personBio">${html(bio || 'No biography on record.')}</div>
          ${bio.length > 280 ? `<button class="person-bio-toggle" id="bioToggle"><i class="ri-arrow-down-s-line"></i> Read more</button>` : ''}
        </div>
        <aside class="person-facts">
          <h4>Quick facts</h4>
          <dl>
            ${data.known_for_department ? `<div><dt>Known For</dt><dd>${html(data.known_for_department)}</dd></div>` : ''}
            ${genderLabel(data.gender) ? `<div><dt>Gender</dt><dd>${html(genderLabel(data.gender))}</dd></div>` : ''}
            ${data.birthday ? `<div><dt>Born</dt><dd>${fmtDate(data.birthday)}</dd></div>` : ''}
            ${data.deathday ? `<div><dt>Died</dt><dd>${fmtDate(data.deathday)}</dd></div>` : ''}
            ${data.place_of_birth ? `<div><dt>From</dt><dd>${html(data.place_of_birth)}</dd></div>` : ''}
            ${(data.also_known_as || [])[0] ? `<div><dt>Also Known As</dt><dd>${html((data.also_known_as || []).slice(0,3).join(' · '))}</dd></div>` : ''}
          </dl>
        </aside>
      </div>

      <section class="section">
        <header class="section__head">
          <div>
            <h2 class="section__title">As <em>cast</em></h2>
            <div class="section__sub">${cast.length} appearances</div>
          </div>
        </header>
        <div class="browse-grid" id="personCastGrid">${cast.slice(0, 24).map(c => titleCard({ ...c })).join('')}</div>
        ${cast.length > 24 ? `<div class="load-more" style="margin-top:16px"><button class="btn-ghost" id="loadMoreCast" data-shown="24"><i class="ri-add-line"></i> Show more (${cast.length - 24} remaining)</button></div>` : ''}
      </section>

      ${crew.length ? `<section class="section">
        <header class="section__head">
          <div>
            <h2 class="section__title">As <em>crew</em></h2>
            <div class="section__sub">${crew.length} credits — directing, writing, producing &amp; more</div>
          </div>
        </header>
        <div class="browse-grid" id="personCrewGrid">${crew.slice(0, 24).map(c => titleCard({ ...c })).join('')}</div>
        ${crew.length > 24 ? `<div class="load-more" style="margin-top:16px"><button class="btn-ghost" id="loadMoreCrew" data-shown="24"><i class="ri-add-line"></i> Show more (${crew.length - 24} remaining)</button></div>` : ''}
      </section>` : ''}

      ${footer()}
    `;

    const toggle = $('#bioToggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const bioEl = $('#personBio');
        bioEl.classList.toggle('collapsed');
        toggle.innerHTML = bioEl.classList.contains('collapsed')
          ? '<i class="ri-arrow-down-s-line"></i> Read more'
          : '<i class="ri-arrow-up-s-line"></i> Show less';
      });
    }

    // Cast pagination
    const loadMoreCast = $('#loadMoreCast');
    if (loadMoreCast) {
      loadMoreCast.addEventListener('click', () => {
        const grid = $('#personCastGrid');
        let shown = parseInt(loadMoreCast.dataset.shown, 10);
        const next = cast.slice(shown, shown + 24);
        grid.insertAdjacentHTML('beforeend', next.map(c => titleCard({ ...c })).join(''));
        shown += next.length;
        loadMoreCast.dataset.shown = shown;
        if (shown >= cast.length) {
          loadMoreCast.closest('.load-more').remove();
        } else {
          loadMoreCast.innerHTML = `<i class="ri-add-line"></i> Show more (${cast.length - shown} remaining)`;
        }
      });
    }

    // Crew pagination
    const loadMoreCrew = $('#loadMoreCrew');
    if (loadMoreCrew) {
      loadMoreCrew.addEventListener('click', () => {
        const grid = $('#personCrewGrid');
        let shown = parseInt(loadMoreCrew.dataset.shown, 10);
        const next = crew.slice(shown, shown + 24);
        grid.insertAdjacentHTML('beforeend', next.map(c => titleCard({ ...c })).join(''));
        shown += next.length;
        loadMoreCrew.dataset.shown = shown;
        if (shown >= crew.length) {
          loadMoreCrew.closest('.load-more').remove();
        } else {
          loadMoreCrew.innerHTML = `<i class="ri-add-line"></i> Show more (${crew.length - shown} remaining)`;
        }
      });
    }
  }

  function lifeText(birth, death) {
    const b = new Date(birth);
    if (death) {
      const d = new Date(death);
      const age = Math.floor((d - b) / (365.25 * 86400 * 1000));
      return `${b.getFullYear()} – ${d.getFullYear()} (aged ${age})`;
    }
    const age = Math.floor((Date.now() - b.getTime()) / (365.25 * 86400 * 1000));
    return `${b.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} (age ${age})`;
  }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); }
    catch { return iso; }
  }
  function genderLabel(g) { return ({ 1: 'Female', 2: 'Male', 3: 'Non-binary' })[g] || null; }

  // ───── TITLE DETAIL ───────────────────────────────────────────────────────
  async function renderTitleDetail(type, id) {
    $('#view').innerHTML = skDetail() + `<section class="section"><header class="section__head"><div><div class="sk sk--line sk--line-title"></div></div></header>${skRail()}</section>`;
    const data = await tmdb(`/${type}/${id}`, { append_to_response: 'credits,videos,recommendations,external_ids' });
    if (!data || data.success === false) {
      $('#view').innerHTML = renderError("Couldn't find that title.");
      return;
    }

    const isTV = type === 'tv';
    const title = data.title || data.name;
    const year = fmtYear(data.release_date || data.first_air_date);
    const score = matchPct(data.vote_average);
    const runtime = isTV
      ? (data.episode_run_time?.[0] ? data.episode_run_time[0] + ' min/ep' : '')
      : fmtMinutes(data.runtime);
    const genres = (data.genres || []).map(g => g.name);
    const fav = isFavorite(id);

    $('#view').innerHTML = `
      <section class="detail-hero">
        <div class="detail-hero__bg" style="background-image:url(${IMG('original', data.backdrop_path)})"></div>
        <div class="detail-hero__scrim"></div>
        <div class="detail-hero__content">
          <div class="detail-hero__poster">
            ${data.poster_path ? `<img src="${IMG('w500', data.poster_path)}" alt="">` : ''}
          </div>
          <div>
            <span class="eyebrow"><span class="dot"></span> ${isTV ? 'Series' : 'Film'} · ${year || '—'}</span>
            <h1 class="detail-hero__title">${html(title)}</h1>
            ${data.tagline ? `<div class="detail-hero__tagline">${html(data.tagline)}</div>` : ''}
            <div class="detail-hero__meta">
              ${score ? `<span style="color:var(--accent);font-weight:600;display:inline-flex;align-items:center;gap:6px;"><i class="ri-star-fill"></i> ${score}% match</span>` : ''}
              ${score ? `<span class="dot"></span>` : ''}
              ${runtime ? `<span class="mono">${runtime}</span>` : ''}
              ${runtime ? `<span class="dot"></span>` : ''}
              <span class="mono">${(data.vote_count || 0).toLocaleString()} votes</span>
              ${isTV && data.number_of_seasons ? `<span class="dot"></span><span class="mono">${data.number_of_seasons} season${data.number_of_seasons>1?'s':''}</span>` : ''}
            </div>
            ${genres.length ? `<div class="genre-tags">${genres.map(g => `<span class="genre-tag">${html(g)}</span>`).join('')}</div>` : ''}
            <p class="detail-hero__overview">${collapsible(data.overview || '', 3, 220)}</p>
            <div class="detail-hero__actions">
              <button class="btn-primary" onclick="OMNIFLIX.openWatchById('${type}', ${id})"><i class="ri-play-fill"></i> Watch ${isTV ? 'S1 E1' : 'now'}</button>
              <button class="btn-ghost btn-dl" data-dl-type="${type}" data-dl-id="${id}" data-dl-s="1" data-dl-e="1"><i class="ri-download-cloud-2-line"></i> Download<span class="btn-dl__tag">3rd-party</span></button>
              <button class="btn-ghost" id="favBtn" onclick="OMNIFLIX.toggleFav(${id}, '${type}', '${html(title).replace(/'/g, '&apos;')}', '${data.poster_path || ''}', '${year}')">
                <i class="ri-${fav ? 'check-line' : 'bookmark-line'}"></i> ${fav ? 'In your list' : 'Add to list'}
              </button>
              ${data.external_ids?.imdb_id ? `<a class="btn-ghost" target="_blank" rel="noopener" href="https://www.imdb.com/title/${data.external_ids.imdb_id}"><i class="ri-imdb-line"></i> IMDb</a>` : ''}
            </div>
          </div>
        </div>
      </section>

      ${isTV ? renderEpisodesShell(data) : ''}

      <section class="section">
        <header class="section__head"><div><h2 class="section__title">The <em>cast</em></h2></div></header>
        <div class="cast-rail">
          ${(data.credits?.cast || []).slice(0, 20).map(c => `
            <a class="cast-chip" href="/person/${c.id}" data-link>
              <div class="cast-chip__photo">${c.profile_path ? `<img src="${IMG('w185', c.profile_path)}" loading="lazy">` : '<div class="person-card__placeholder"><i class="ri-user-3-line"></i></div>'}</div>
              <div class="cast-chip__name">${html(c.name)}</div>
              <div class="cast-chip__role">${html(c.character || '')}</div>
            </a>`).join('')}
        </div>
      </section>

      <section class="section">
        <header class="section__head"><div><h2 class="section__title">More like <em>this</em></h2></div></header>
        <div class="rail">${(data.recommendations?.results || []).filter(r => r.poster_path).slice(0, 16).map(r => titleCard({...r, media_type: type})).join('')}</div>
      </section>

      ${footer()}
    `;

    if (isTV) wireEpisodes(data);
  }

  function renderEpisodesShell(data) {
    const seasons = (data.seasons || []).filter(s => s.season_number > 0);
    if (!seasons.length) return '';
    return `<section class="section section--episodes">
      <header class="section__head">
        <div>
          <h2 class="section__title">Choose an <em>episode</em></h2>
          <div class="section__sub">${data.number_of_episodes || 0} episodes total · ${data.number_of_seasons} season${data.number_of_seasons>1?'s':''}</div>
        </div>
        <div class="section__head-right">
          <select id="seasonSelect" class="season-select" aria-label="Season">
            ${seasons.map(s => `<option value="${s.season_number}">${html(s.name)} · ${s.episode_count} ep</option>`).join('')}
          </select>
        </div>
      </header>
      <div class="season-bar season-bar--scroll" id="seasonBar">
        ${seasons.map((s, i) => `<button class="season-pill ${i===0?'active':''}" data-s="${s.season_number}"><span class="season-pill__n">${s.season_number}</span><span class="season-pill__name">${html(s.name).replace(/^Season /,'')}</span><span class="season-pill__count">${s.episode_count} ep</span></button>`).join('')}
      </div>
      <div class="episodes-grid" id="episodesGrid">${skEpisodes(8)}</div>
    </section>`;
  }

  // Episode pager — large anime seasons (50, 100, 500+ eps) destroyed scroll
  // performance and froze the player. Paginate at EPISODES_PER_PAGE per page
  // with prev/next + jump-to-page.
  const EPISODES_PER_PAGE = 24;

  function renderEpisodePage(eps, seasonNum, showId, page) {
    const pages = Math.max(1, Math.ceil(eps.length / EPISODES_PER_PAGE));
    const p = Math.max(1, Math.min(pages, page));
    const start = (p - 1) * EPISODES_PER_PAGE;
    const slice = eps.slice(start, start + EPISODES_PER_PAGE);

    const cards = slice.map(ep => `
      <a class="episode" href="/watch/tv/${showId}/${seasonNum}/${ep.episode_number}" data-link>
        <div class="episode__still">
          ${ep.still_path ? `<img src="${IMG('w300', ep.still_path)}" loading="lazy">` : `<div class="episode__still-fallback"><i class="ri-film-line"></i></div>`}
          <span class="episode__num">E${ep.episode_number}</span>
          <span class="episode__playhint"><i class="ri-play-fill"></i></span>
          <button class="episode__dl btn-dl" data-dl-type="tv" data-dl-id="${showId}" data-dl-s="${seasonNum}" data-dl-e="${ep.episode_number}" title="Download" aria-label="Download episode ${ep.episode_number}"><i class="ri-download-cloud-2-line"></i></button>
        </div>
        <div class="episode__body">
          <div class="episode__title">${html(ep.name)}</div>
          <div class="episode__meta"><span>${ep.air_date ? fmtDate(ep.air_date) : ''}</span>${ep.runtime ? `<span class="dot"></span><span>${ep.runtime} min</span>`:''}${ep.vote_average ? `<span class="dot"></span><span><i class="ri-star-fill" style="color:var(--accent)"></i> ${fmtScore(ep.vote_average)}</span>`:''}</div>
          <div class="episode__overview">${html(ep.overview || 'No summary available.')}</div>
        </div>
      </a>
    `).join('');

    // Build a compact pager: « < 1 … 4 [5] 6 … 12 > »
    function pageRange(cur, total) {
      const out = new Set([1, total, cur-1, cur, cur+1]);
      const arr = [...out].filter(x => x >= 1 && x <= total).sort((a,b)=>a-b);
      const final = [];
      let prev = 0;
      arr.forEach(x => {
        if (x - prev > 1) final.push('…');
        final.push(x); prev = x;
      });
      return final;
    }
    const pagerHtml = pages > 1 ? `
      <nav class="ep-pager" aria-label="Episode pages">
        <button class="ep-pager__btn" data-go="${p-1}" ${p===1?'disabled':''} aria-label="Previous page"><i class="ri-arrow-left-s-line"></i></button>
        ${pageRange(p, pages).map(x =>
          x === '…' ? `<span class="ep-pager__sep">…</span>`
                    : `<button class="ep-pager__btn ${x===p?'active':''}" data-go="${x}">${x}</button>`
        ).join('')}
        <button class="ep-pager__btn" data-go="${p+1}" ${p===pages?'disabled':''} aria-label="Next page"><i class="ri-arrow-right-s-line"></i></button>
        <span class="ep-pager__range">${start+1}–${Math.min(start+EPISODES_PER_PAGE, eps.length)} of ${eps.length}</span>
      </nav>` : '';

    return cards + pagerHtml;
  }

  function wireEpisodes(data) {
    const seasons = (data.seasons || []).filter(s => s.season_number > 0);
    if (!seasons.length) return;

    // Per-season pager state (so the user's page survives switching seasons).
    const pageBySeason = {};
    let currentSeason = seasons[0].season_number;
    let currentEps = [];

    const renderPage = (page) => {
      pageBySeason[currentSeason] = page;
      const grid = $('#episodesGrid');
      if (!grid) return;
      grid.innerHTML = renderEpisodePage(currentEps, currentSeason, data.id, page);
      // Wire pager
      $$('.ep-pager__btn[data-go]', grid).forEach(btn => {
        btn.addEventListener('click', () => {
          const p = parseInt(btn.dataset.go);
          if (Number.isFinite(p)) {
            renderPage(p);
            // Smooth scroll to top of episodes section for context.
            $('#episodesGrid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
      });
    };

    const showSeason = async (n) => {
      currentSeason = n;
      $$('#seasonBar .season-pill').forEach(b => b.classList.toggle('active', parseInt(b.dataset.s) === n));
      const sel = $('#seasonSelect'); if (sel) sel.value = String(n);
      $('#episodesGrid').innerHTML = skEpisodes(8);
      const s = await tmdb(`/tv/${data.id}/season/${n}`);
      currentEps = s.episodes || [];
      if (!currentEps.length) {
        $('#episodesGrid').innerHTML = '<p style="color:var(--text-mute);padding:24px">No episode data available for this season.</p>';
        return;
      }
      renderPage(pageBySeason[n] || 1);
    };

    $$('#seasonBar .season-pill').forEach(b => b.addEventListener('click', () => showSeason(parseInt(b.dataset.s))));
    $('#seasonSelect')?.addEventListener('change', e => showSeason(parseInt(e.target.value)));
    showSeason(seasons[0].season_number);
  }

  // ═════ PERSISTENT PLAYER + MINI (PIP) MANAGER ═════════════════════════════
  //
  //  The iframe lives inside #playerFrame and is NEVER moved in the DOM
  //  during stage⇄mini transitions. We only animate the player-host's
  //  transform/width/height. Playback continues seamlessly.
  //
  //  Performance:
  //   • Position uses GPU-only `transform: translate3d()` (no layout thrash)
  //   • Scroll-sync is throttled with a single rAF tick
  //   • Layout/paint containment isolates re-renders
  //
  const playerHost      = () => $('#player-host');
  const loaderBgEl      = () => $('#playerLoaderBg');
  const loaderStatusEl  = () => $('#playerLoaderStatus');

  const mini = {
    state: 'hidden',          // 'hidden' | 'stage' | 'mini'
    activePlayer: null,
    activeCtx: null,
    anchor: null,
    miniPos: null,
    miniSize: null,           // { w, h } — persisted across mini sessions
    _syncRaf: 0,
    _lastRect: null,

    hasPlayer() { return !!this.activePlayer; },

    _apply(x, y, w, h) {
      const host = playerHost();
      if (!host) return;
      host.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
      host.style.width  = Math.round(w) + 'px';
      host.style.height = Math.round(h) + 'px';
    },

    _syncToStage() {
      if (this.state !== 'stage' || !this.anchor || !document.body.contains(this.anchor)) return;
      const r = this.anchor.getBoundingClientRect();
      // Stage uses position:absolute (document-relative), so we add scroll
      // offsets. This lets the browser composite-scroll the player together
      // with the page — no JS sync lag, no wobble.
      const docX = r.left + window.scrollX;
      const docY = r.top  + window.scrollY;
      const last = this._lastRect;
      if (last && last.left === docX && last.top === docY && last.width === r.width && last.height === r.height) return;
      this._lastRect = { left: docX, top: docY, width: r.width, height: r.height };
      this._apply(docX, docY, r.width, r.height);
    },

    ensureGeometry() {
      if (this.state !== 'stage') return;
      if (this._syncRaf) return;
      this._syncRaf = requestAnimationFrame(() => {
        this._syncRaf = 0;
        this._syncToStage();
      });
    },

    setStageAnchor(anchor) {
      this.anchor = anchor;
      this._lastRect = null;
    },

    // Resolve the live bottom-nav height from the DOM (the CSS variable
    // --bottomnav-h is defined via calc(env(...)) and parseInt() on that
    // returns NaN). This is what previously caused the mini player to slip
    // behind the bottom-nav on mobile.
    _bottomNavH() {
      const el = document.querySelector('.bottomnav');
      if (!el) return 0;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
      return el.offsetHeight || 0;
    },

    // Resolve the live top-nav height so the mini player never floats
    // underneath the branding / navigation bar.
    _topNavH() {
      const el = document.querySelector('.topnav');
      if (!el) return 0;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
      return el.offsetHeight || 0;
    },

    // Clamp a mini-player width to safe min/max and snap to 16:9 height.
    // Also clamps height against the available viewport (minus bottom-nav and top-nav).
    clampSize(mw) {
      const vw = window.innerWidth, vh = window.innerHeight;
      const isMobile = vw < 860 || (matchMedia && matchMedia('(pointer: coarse)').matches);
      const minW = isMobile ? 160 : 220;
      const maxW = Math.min(vw - 16, isMobile ? Math.round(vw * 0.92) : 720);
      mw = Math.max(minW, Math.min(maxW, mw));
      let mh = Math.round(mw * 9 / 16);
      const topNavH = this._topNavH();
      const maxH = vh - (isMobile ? (this._bottomNavH() + topNavH + 16) : 24);
      if (mh > maxH) { mh = maxH; mw = Math.round(mh * 16 / 9); }
      return { w: Math.round(mw), h: Math.round(mh) };
    },

    // Clamp a mini-player position so it stays inside the viewport,
    // above the bottom-nav, and below the top-nav.
    clampPos(x, y, w, h) {
      const vw = window.innerWidth, vh = window.innerHeight;
      const isMobile = vw < 860 || (matchMedia && matchMedia('(pointer: coarse)').matches);
      const bottomPad = isMobile ? (this._bottomNavH() + 8) : 8;
      const topPad = this._topNavH() + 8;
      return {
        x: Math.max(8, Math.min(vw - w - 8, x)),
        y: Math.max(topPad, Math.min(vh - h - bottomPad, y)),
      };
    },

    toStage() {
      const host = playerHost();
      const cameFromMini = (this.state === 'mini');

      if (cameFromMini && this.anchor && document.body.contains(this.anchor)) {
        // Crossing from position:fixed (mini, viewport-coords) to
        // position:absolute (stage, document-coords). Convert the current
        // viewport-coord transform into doc-coords WITHOUT a transition,
        // then re-enable transitions and animate to the stage rect. This
        // avoids a one-frame visual jump when the coord system flips.
        const cur = this.miniPos || { x: 0, y: 0 };
        const curDocX = cur.x + window.scrollX;
        const curDocY = cur.y + window.scrollY;
        host.style.transition = 'none';
        host.setAttribute('data-mode', 'stage');
        this.state = 'stage';
        host.style.transform = `translate3d(${Math.round(curDocX)}px, ${Math.round(curDocY)}px, 0)`;
        // Force reflow so the no-transition state is committed.
        // eslint-disable-next-line no-unused-expressions
        host.offsetHeight;
        host.style.transition = '';
        this._lastRect = null;
        requestAnimationFrame(() => this._syncToStage());
        return;
      }

      host.setAttribute('data-mode', 'stage');
      this.state = 'stage';
      this._lastRect = null;
      requestAnimationFrame(() => this._syncToStage());
    },

    toMini() {
      const host = playerHost();
      const cameFromStage = (this.state === 'stage');
      const w = window.innerWidth, h = window.innerHeight;
      const isMobile = w < 860 || (matchMedia && matchMedia('(pointer: coarse)').matches);
      // Mini size: persisted default if available, otherwise compute.
      let baseW;
      if (this.miniSize && this.miniSize.w) {
        baseW = this.miniSize.w;
      } else {
        baseW = isMobile ? Math.min(220, Math.round(w * 0.56)) : 340;
      }
      // Single source of truth for clamping (shared with resize/pinch).
      const sized = this.clampSize(baseW);
      const mw = sized.w, mh = sized.h;
      const bottomNavH = this._bottomNavH();
      const padX = isMobile ? 12 : 20;
      const padY = isMobile ? (bottomNavH + 14) : 20;
      const rawPos = this.miniPos || { x: w - mw - padX, y: h - mh - padY };
      const pos = this.clampPos(rawPos.x, rawPos.y, mw, mh);

      if (cameFromStage) {
        // Crossing from position:absolute (stage, doc-coords) to
        // position:fixed (mini, viewport-coords). Capture the current
        // on-screen rect, switch modes with transitions off, set an
        // equivalent viewport-coord transform, then animate to the mini
        // target so the move is smooth and seamless.
        const r = host.getBoundingClientRect();
        host.style.transition = 'none';
        host.setAttribute('data-mode', 'mini');
        this.state = 'mini';
        host.style.transform = `translate3d(${Math.round(r.left)}px, ${Math.round(r.top)}px, 0)`;
        host.style.width  = Math.round(r.width)  + 'px';
        host.style.height = Math.round(r.height) + 'px';
        // Force reflow so the no-transition state is committed.
        // eslint-disable-next-line no-unused-expressions
        host.offsetHeight;
        host.style.transition = '';
        this.miniPos = pos;
        this.miniSize = { w: mw, h: mh };
        // Apply target on next frame so the transition actually runs.
        requestAnimationFrame(() => this._apply(pos.x, pos.y, mw, mh));
        return;
      }

      host.setAttribute('data-mode', 'mini');
      this.state = 'mini';
      this.miniPos = pos;
      this.miniSize = { w: mw, h: mh };
      this._apply(pos.x, pos.y, mw, mh);
    },

    close() {
      const host = playerHost();
      host.setAttribute('data-mode', 'hidden');
      host.style.transform = '';
      host.style.width = '';
      host.style.height = '';
      host.style.transition = '';
      this.state = 'hidden';
      this._lastRect = null;
      if (this.activePlayer) {
        try { this.activePlayer.destroy(); } catch (_) {}
        this.activePlayer = null;
      }
      this.activeCtx = null;
      this.anchor = null;
    },

    expand() {
      // One-tap restore: animate the mini player straight back to its
      // stage position — no navigation round-trip, no second tap needed.
      const ctx = this.activeCtx;
      if (!ctx) return;

      // If the watch page is currently mounted (the .player-anchor ghost
      // is in the DOM) we already have a target — just bind the anchor and
      // run the existing mini→stage animation. Bring the anchor into view
      // smoothly so the user doesn't have to hunt for it.
      const anchor = document.querySelector('.player-anchor');
      if (anchor && document.body.contains(anchor)) {
        this.setStageAnchor(anchor);
        this.toStage();
        try { anchor.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        catch (_) { anchor.scrollIntoView(); }
        return;
      }

      // The user is on some other page (home / search / etc.). Navigate to
      // the watch page; its route handler will call attachStageAnchor()
      // which in turn calls mini.toStage() — the player will animate from
      // its current mini position straight into the stage in one motion.
      const path = ctx.type === 'tv'
        ? `/watch/tv/${ctx.id}/${ctx.season}/${ctx.episode}`
        : `/watch/movie/${ctx.id}`;
      navigate(path);
    },

    setLoading(isLoading, sourceName, status) {
      const host = playerHost();
      if (!host) return;
      host.classList.toggle('is-loading', !!isLoading);
      const nameEl = $('#sourceName');
      if (sourceName && nameEl) nameEl.textContent = sourceName;
      const statusEl = loaderStatusEl();
      if (!statusEl) return;
      if (status === 'exhausted') statusEl.textContent = 'All sources unavailable. Try again later.';
      else if (isLoading)         statusEl.textContent = `Connecting via ${sourceName || 'source'}…`;
      else                        statusEl.textContent = '';
    }
  };

  // rAF-throttled viewport sync (stage mode only).
  //
  // Stage uses position:absolute (document-relative), so it scrolls together
  // with the page natively on the compositor — no JS sync needed for scroll,
  // and no more "wobble / lurching up and down" jelly effect. We only resync
  // on layout-affecting events: resize and orientation change.
  let _vpRaf = 0;
  function handleViewportChange() {
    if (mini.state !== 'stage') return;
    if (_vpRaf) return;
    _vpRaf = requestAnimationFrame(() => {
      _vpRaf = 0;
      mini._lastRect = null;
      mini._syncToStage();
    });
  }
  window.addEventListener('resize', handleViewportChange, { passive: true });
  window.addEventListener('orientationchange', handleViewportChange, { passive: true });

  // ── Mini chrome interactions: drag + tap-to-expand + buttons ──────────────
  (function wireMiniInteractions() {
    const host = $('#player-host');
    const shield = $('#miniShield');
    const expandBtn = $('#miniExpand');
    // Close button intentionally removed — it used to destroy the player and
    // leave a blank stage when the user returned to the watch page.
    if (!host || !shield) return;

    let dragging = false, moved = false;
    let startX = 0, startY = 0, origX = 0, origY = 0;
    let activePointerId = null;
    let touchTimer = null;
    // Pinch state — referenced by the drag handler so a 2-finger gesture
    // immediately suspends single-finger dragging (the two would fight).
    const pinch = { active: false, startDist: 0, startW: 0, startH: 0, anchorX: 0, anchorY: 0 };

    const showTouchControls = () => {
      host.classList.add('show-controls');
      clearTimeout(touchTimer);
      touchTimer = setTimeout(() => host.classList.remove('show-controls'), 2400);
    };

    // ── Physics state ──────────────────────────────────────────────────────
    let velX = 0, velY = 0;
    let lastMoveX = 0, lastMoveY = 0, lastMoveT = 0;
    let inertiaRaf = 0;

    function cancelInertia() {
      if (inertiaRaf) { cancelAnimationFrame(inertiaRaf); inertiaRaf = 0; }
    }

    // Corner-snap: find the nearest of the 4 corners and spring to it.
    function snapToCorner() {
      if (mini.state !== 'mini') return;
      const w = host.offsetWidth, h = host.offsetHeight;
      const vw = window.innerWidth, vh = window.innerHeight;
      const pad = 12;
      const isMobile = vw < 860 || (matchMedia && matchMedia('(pointer: coarse)').matches);
      const bottomPad = isMobile ? (mini._bottomNavH() + pad) : pad;
      const topPad = mini._topNavH() + pad;

      const cx = mini.miniPos.x + w / 2;
      const cy = mini.miniPos.y + h / 2;
      const corners = [
        { x: pad,          y: topPad },
        { x: vw - w - pad, y: topPad },
        { x: pad,          y: vh - h - bottomPad },
        { x: vw - w - pad, y: vh - h - bottomPad },
      ];
      let best = corners[0], bestD = Infinity;
      corners.forEach(c => {
        const d = Math.hypot((c.x + w / 2) - cx, (c.y + h / 2) - cy);
        if (d < bestD) { bestD = d; best = c; }
      });

      const startX2 = mini.miniPos.x, startY2 = mini.miniPos.y;
      const targetX = best.x, targetY = best.y;
      const DURATION = 320;
      const t0 = performance.now();

      function easeOutExpo(t) {
        return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      }

      function step(now) {
        const t = Math.min((now - t0) / DURATION, 1);
        const e = easeOutExpo(t);
        const nx = startX2 + (targetX - startX2) * e;
        const ny = startY2 + (targetY - startY2) * e;
        mini.miniPos = { x: nx, y: ny };
        host.style.transform = `translate3d(${Math.round(nx)}px, ${Math.round(ny)}px, 0)`;
        if (t < 1) inertiaRaf = requestAnimationFrame(step);
        else { mini.miniPos = { x: targetX, y: targetY }; inertiaRaf = 0; }
      }
      inertiaRaf = requestAnimationFrame(step);
    }

    // Inertia scroll after drag release.
    function launchInertia() {
      const FRICTION = 0.88;
      const MIN_SPEED = 0.4;

      function step() {
        if (mini.state !== 'mini') { inertiaRaf = 0; return; }
        velX *= FRICTION;
        velY *= FRICTION;

        if (Math.abs(velX) < MIN_SPEED && Math.abs(velY) < MIN_SPEED) {
          snapToCorner();
          return;
        }

        const w = host.offsetWidth, h = host.offsetHeight;
        const vw = window.innerWidth, vh = window.innerHeight;
        const isMobile = vw < 860 || (matchMedia && matchMedia('(pointer: coarse)').matches);
        const bottomPad = isMobile ? (mini._bottomNavH() + 8) : 8;
        const topWall = mini._topNavH() + 8;
        let nx = mini.miniPos.x + velX;
        let ny = mini.miniPos.y + velY;

        // Bounce off walls with energy loss
        if (nx < 8) { nx = 8; velX = Math.abs(velX) * 0.35; }
        if (nx > vw - w - 8) { nx = vw - w - 8; velX = -Math.abs(velX) * 0.35; }
        if (ny < topWall) { ny = topWall; velY = Math.abs(velY) * 0.35; }
        if (ny > vh - h - bottomPad) { ny = vh - h - bottomPad; velY = -Math.abs(velY) * 0.35; }

        mini.miniPos = { x: nx, y: ny };
        host.style.transform = `translate3d(${Math.round(nx)}px, ${Math.round(ny)}px, 0)`;
        inertiaRaf = requestAnimationFrame(step);
      }
      inertiaRaf = requestAnimationFrame(step);
    }

    const onPointerDown = (e) => {
      if (mini.state !== 'mini') return;
      cancelInertia();
      activePointerId = e.pointerId;
      shield.setPointerCapture?.(e.pointerId);
      dragging = true; moved = false;
      startX = e.clientX; startY = e.clientY;
      origX = mini.miniPos.x; origY = mini.miniPos.y;
      lastMoveX = e.clientX; lastMoveY = e.clientY; lastMoveT = performance.now();
      velX = 0; velY = 0;
      host.classList.add('is-dragging');
      if (e.pointerType === 'touch') showTouchControls();
      e.preventDefault();
    };

    const onPointerMove = (e) => {
      if (!dragging || e.pointerId !== activePointerId) return;
      if (pinch.active) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;

      const now = performance.now();
      const dt = Math.max(now - lastMoveT, 1);
      // Exponential moving average velocity (px/frame at 60fps)
      const rawVx = (e.clientX - lastMoveX) / dt * 16.67;
      const rawVy = (e.clientY - lastMoveY) / dt * 16.67;
      velX = velX * 0.6 + rawVx * 0.4;
      velY = velY * 0.6 + rawVy * 0.4;
      lastMoveX = e.clientX; lastMoveY = e.clientY; lastMoveT = now;

      const w = host.offsetWidth, h = host.offsetHeight;
      const pad = 8;
      const isMobile = window.innerWidth < 860 || (matchMedia && matchMedia('(pointer: coarse)').matches);
      const bottomPad = isMobile ? (mini._bottomNavH() + pad) : pad;
      const topWall = mini._topNavH() + pad;
      let nx = origX + dx, ny = origY + dy;
      nx = Math.max(pad, Math.min(window.innerWidth - w - pad, nx));
      ny = Math.max(topWall, Math.min(window.innerHeight - h - bottomPad, ny));
      mini.miniPos = { x: nx, y: ny };
      host.style.transform = `translate3d(${Math.round(nx)}px, ${Math.round(ny)}px, 0)`;
      e.preventDefault();
    };

    const onPointerUp = (e) => {
      if (!dragging || e.pointerId !== activePointerId) return;
      dragging = false;
      host.classList.remove('is-dragging');
      try { shield.releasePointerCapture?.(activePointerId); } catch (_) {}
      activePointerId = null;

      if (moved) {
        // Launch physics: if fast throw → inertia → corner snap, else direct snap
        const speed = Math.hypot(velX, velY);
        if (speed > 2.5) launchInertia();
        else snapToCorner();
        return;
      }

      const now = Date.now();
      if (now - mini._lastTapTime < 320) {
        clearTimeout(mini._singleTapTimer);
        mini._lastTapTime = 0;
        mini.expand();
      } else {
        mini._lastTapTime = now;
        clearTimeout(mini._singleTapTimer);
        mini._singleTapTimer = setTimeout(() => {
          showTouchControls();
          mini._lastTapTime = 0;
        }, 320);
      }
    };

    shield.addEventListener('pointerdown', onPointerDown);
    shield.addEventListener('pointermove', onPointerMove);
    shield.addEventListener('pointerup', onPointerUp);
    shield.addEventListener('pointercancel', onPointerUp);

    if (expandBtn) {
      expandBtn.addEventListener('click', (e) => { e.stopPropagation(); mini.expand(); });
    }

    // ── YouTube-style resize ────────────────────────────────────────────
    //   • Corner drag handle (desktop + touch)
    //   • Two-finger pinch-to-zoom anywhere on the mini player (touch only)
    //   • Aspect ratio is locked to 16:9; size is clamped to viewport.
    const resizeBtn = $('#miniResize');

    // ── Corner-drag resize on the handle ────────────────────────────────
    if (resizeBtn) {
      let rzActive = false, rzId = null;
      let rzStartX = 0, rzStartY = 0, rzStartW = 0, rzStartH = 0;
      let rzAnchorX = 0, rzAnchorY = 0; // top-left of player at resize start

      const onResizeDown = (e) => {
        if (mini.state !== 'mini') return;
        rzActive = true;
        rzId = e.pointerId;
        try { resizeBtn.setPointerCapture(e.pointerId); } catch (_) {}
        rzStartX = e.clientX; rzStartY = e.clientY;
        rzStartW = host.offsetWidth; rzStartH = host.offsetHeight;
        rzAnchorX = mini.miniPos ? mini.miniPos.x : 0;
        rzAnchorY = mini.miniPos ? mini.miniPos.y : 0;
        host.classList.add('is-resizing');
        e.preventDefault(); e.stopPropagation();
      };
      const onResizeMove = (e) => {
        if (!rzActive || e.pointerId !== rzId) return;
        // Use the larger axis delta so it feels natural in both directions.
        const dx = e.clientX - rzStartX;
        const dy = (e.clientY - rzStartY) * (16 / 9); // normalize Y to W scale
        const delta = Math.max(dx, dy);
        const next = mini.clampSize(rzStartW + delta);
        const pos  = mini.clampPos(rzAnchorX, rzAnchorY, next.w, next.h);
        mini.miniSize = next;
        mini.miniPos  = pos;
        host.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
        host.style.width  = next.w + 'px';
        host.style.height = next.h + 'px';
        e.preventDefault();
      };
      const onResizeUp = (e) => {
        if (!rzActive || e.pointerId !== rzId) return;
        rzActive = false;
        try { resizeBtn.releasePointerCapture(rzId); } catch (_) {}
        rzId = null;
        host.classList.remove('is-resizing');
      };
      resizeBtn.addEventListener('pointerdown',   onResizeDown);
      resizeBtn.addEventListener('pointermove',   onResizeMove);
      resizeBtn.addEventListener('pointerup',     onResizeUp);
      resizeBtn.addEventListener('pointercancel', onResizeUp);
      // Prevent the button click from bubbling into drag/expand logic.
      resizeBtn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); });
    }

    // ── Two-finger pinch-to-zoom on the mini player (YouTube-style) ─────
    //   Uses raw touch events on the shield. Once a 2nd finger lands the
    //   drag/tap logic is suspended for this gesture.
    const distOf = (t1, t2) => {
      const dx = t1.clientX - t2.clientX, dy = t1.clientY - t2.clientY;
      return Math.hypot(dx, dy);
    };
    shield.addEventListener('touchstart', (e) => {
      if (mini.state !== 'mini') return;
      if (e.touches.length === 2) {
        pinch.active = true;
        pinch.startDist = Math.max(10, distOf(e.touches[0], e.touches[1]));
        pinch.startW = host.offsetWidth;
        pinch.startH = host.offsetHeight;
        pinch.anchorX = mini.miniPos ? mini.miniPos.x : 0;
        pinch.anchorY = mini.miniPos ? mini.miniPos.y : 0;
        // Suspend any in-flight single-pointer drag so the two don't fight.
        dragging = false;
        moved = true; // prevent the drag-end from being treated as a tap
        host.classList.remove('is-dragging');
        host.classList.add('is-pinching', 'is-resizing');
        e.preventDefault();
      }
    }, { passive: false });
    shield.addEventListener('touchmove', (e) => {
      if (!pinch.active || e.touches.length < 2) return;
      const d = Math.max(10, distOf(e.touches[0], e.touches[1]));
      const scale = d / pinch.startDist;
      const next  = mini.clampSize(Math.round(pinch.startW * scale));
      const pos   = mini.clampPos(pinch.anchorX, pinch.anchorY, next.w, next.h);
      mini.miniSize = next;
      mini.miniPos  = pos;
      host.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
      host.style.width  = next.w + 'px';
      host.style.height = next.h + 'px';
      e.preventDefault();
    }, { passive: false });
    const endPinch = (e) => {
      if (!pinch.active) return;
      if (e.touches && e.touches.length >= 2) return;
      pinch.active = false;
      host.classList.remove('is-pinching', 'is-resizing');
    };
    shield.addEventListener('touchend',    endPinch);
    shield.addEventListener('touchcancel', endPinch);
  })();

  // Expose a viewport-safe reclamp for orientation / visualViewport resize.
  window.__miniReclamp = function reclampMini() {
    if (mini.state === 'mini' && mini.miniPos) {
      // Force fresh clamp using current viewport
      const saved = mini.miniPos;
      mini.miniPos = saved; // re-run toMini logic clamps with new size
      mini.toMini();
    } else if (mini.state === 'stage') {
      mini._lastRect = null;
      mini.ensureGeometry();
    }
  };

  function attachStageAnchor(anchor) {
    mini.setStageAnchor(anchor);
    mini.toStage();
    // Auto-minimize when the stage anchor scrolls completely out of view.
    // Mirrors the YouTube / Netflix "scroll to pip" behavior on mobile.
    // Skip entirely when the user disabled PiP in Settings.
    if (mini._stageObs) { try { mini._stageObs.disconnect(); } catch(_){} }
    if (!pipEnabled()) return;
    try {
      mini._stageObs = new IntersectionObserver((entries) => {
        const e = entries[0];
        if (!e || mini.state !== 'stage') return;
        if (!pipEnabled()) return;          // re-check at fire-time
        // Only auto-pip on small screens (desktop keeps the full stage).
        const isMobile = window.innerWidth < 860 || (matchMedia && matchMedia('(pointer: coarse)').matches);
        if (!isMobile) return;
        if (e.intersectionRatio === 0) mini.toMini();
      }, { threshold: [0, 0.01, 0.5] });
      mini._stageObs.observe(anchor);
    } catch (_) { /* old browsers */ }
  }
  function detachWatchAnchor() {
    if (mini._stageObs) { try { mini._stageObs.disconnect(); } catch(_){} mini._stageObs = null; }
  }

  // Global scroll-state class — CSS uses it to instantly hide mini chrome
  // (otherwise the fade-on-hover transition can lag a frame and feel jittery).
  (function wireScrollState() {
    let t = 0;
    const root = document.documentElement;
    const onScroll = () => {
      if (!root.classList.contains('is-scrolling')) root.classList.add('is-scrolling');
      clearTimeout(t);
      t = setTimeout(() => root.classList.remove('is-scrolling'), 140);
    };
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
  })();

  // ───── WATCH ──────────────────────────────────────────────────────────────
  async function renderWatch(...args) {
    let type, id, season, episode;
    if (args[0] === 'tv') { type = 'tv'; id = args[1]; season = args[2] || 1; episode = args[3] || 1; }
    else { type = args[0]; id = args[1]; }

    // Watch page skeleton (immediate)
    $('#view').innerHTML = `
      <section class="watch-page">
        <div class="watch-page__bar">
          <button class="icon-btn" onclick="history.length>1 ? history.back() : OMNIFLIX.go('/')"><i class="ri-arrow-left-line"></i></button>
          <div class="watch-page__crumb"><div class="sk sk--line sk--meta" style="width:240px"></div></div>
          <button class="icon-btn" id="watchMinimize" title="Minimize"><i class="ri-picture-in-picture-exit-line"></i></button>
          <button class="icon-btn" id="watchSourceBtn" title="Choose source"><i class="ri-server-line"></i></button>
        </div>
        <div class="watch-page__stage" id="watchStage">
          <div class="player-anchor" id="playerAnchor"></div>
        </div>
        <div class="watch-page__source" id="serverPick">
          <div class="watch-page__source-icon"><i class="ri-pulse-line"></i></div>
          <div class="watch-page__source-body">
            <div class="watch-page__source-label">Streaming source</div>
            <div class="watch-page__source-name" id="sourceName">Connecting…</div>
          </div>
          <i class="ri-arrow-right-s-line"></i>
        </div>
        <div class="watch-page__info">
          <div>
            <div class="sk sk--line sk--title-xl" style="width:60%"></div>
            <div class="sk sk--line sk--meta" style="width:40%"></div>
            <div class="sk sk--line sk--meta"></div>
            <div class="sk sk--line sk--meta" style="width:90%"></div>
          </div>
          <aside class="watch-page__aside">
            <h4>What's next</h4>
            <div class="sk sk--continue"></div>
          </aside>
        </div>
      </section>
    `;

    // Position the player-host over the anchor (this creates stage mode)
    attachStageAnchor($('#playerAnchor'));

    const data = await tmdb(`/${type}/${id}`);
    if (!data || data.success === false) {
      $('#view').innerHTML = renderError("Couldn't load that title.");
      return;
    }
    const title = data.title || data.name;
    const year  = fmtYear(data.release_date || data.first_air_date);

    let epData = null;
    if (type === 'tv') {
      epData = await tmdb(`/tv/${id}/season/${season}/episode/${episode}`).catch(() => null);
    }

    // Set crumb + info
    const crumb = type === 'tv'
      ? `<span>Series</span><span class="sep">·</span><b>${html(title)}</b><span class="sep">·</span><span>S${season} E${episode}</span>`
      : `<span>Film</span><span class="sep">·</span><b>${html(title)}</b>`;
    $('.watch-page__crumb').innerHTML = crumb;

    const watchTitle = type === 'tv' ? `${html(title)} — <em>S${season} E${episode}</em>` : html(title);

    $('.watch-page__info').innerHTML = `
      <div>
        <h1 class="watch-page__title">${watchTitle}</h1>
        ${type === 'tv' && epData?.name ? `<div class="serif" style="font-style:italic;color:var(--text-dim);font-size:22px;margin-bottom:14px">${html(epData.name)}</div>` : ''}
        <div class="watch-page__meta">
          <span>${year || ''}</span><span class="dot"></span>
          <span class="mono">${type === 'tv' ? 'SERIES' : 'FILM'}</span>
          ${data.vote_average ? `<span class="dot"></span><span style="color:var(--accent)"><i class="ri-star-fill"></i> ${fmtScore(data.vote_average)}</span>` : ''}
        </div>
        <p class="watch-page__overview">${collapsible(epData?.overview || data.overview || '', 2, 180)}</p>
        <a class="btn-ghost" href="/title/${type}/${id}" data-link><i class="ri-movie-2-line"></i> Similar titles like this</a>
      </div>
      ${type === 'tv' ? '' : `
      <aside class="watch-page__aside">
        <h4>What's next</h4>
        <div id="nextUp"></div>
      </aside>`}
    `;

    // Backdrop on the player loader (so the skeleton has flavor)
    const bg = IMG('original', data.backdrop_path || data.poster_path);
    const lbg = loaderBgEl();
    if (bg && lbg) lbg.style.backgroundImage = `url(${bg})`;

    // Episode list (TV) or Up-next (Movie)
    if (type === 'tv') {
      // Render the full episode picker for the whole series, right under the
      // info section. Reuses the same shell+wiring as the title-detail page.
      const watchPage = $('.watch-page');
      if (watchPage && data.seasons?.length) {
        const epsShell = renderEpisodesShell(data);
        if (epsShell) {
          watchPage.insertAdjacentHTML('beforeend', `<div class="watch-page__episodes">${epsShell}</div>`);
          // Default the season picker to the currently-playing season
          wireEpisodes(data);
          // Switch to the active season immediately (wireEpisodes opens season 1)
          const activeBtn = $(`#seasonBar .season-pill[data-s="${season}"]`);
          if (activeBtn) activeBtn.click();
          // After episodes render, mark the active one
          setTimeout(() => {
            $$('#episodesGrid .episode').forEach(el => {
              if (el.getAttribute('href') === `/watch/tv/${id}/${season}/${episode}`) {
                el.classList.add('episode--playing');
              }
            });
          }, 50);
        }
      }
    } else {
      const recs = await tmdb(`/movie/${id}/recommendations`).catch(() => null);
      const first = (recs?.results || []).find(r => r.poster_path);
      if (first && $('#nextUp')) {
        $('#nextUp').innerHTML = `
          <a class="continue-card" style="flex:1;background:var(--bg-1)" href="/watch/movie/${first.id}" data-link>
            <div class="continue-card__art">
              ${first.backdrop_path ? `<img src="${IMG('w780', first.backdrop_path)}">` : ''}
              <div class="continue-card__play"><i class="ri-play-circle-fill"></i></div>
            </div>
            <div class="continue-card__body">
              <div class="continue-card__title">${html(first.title)}</div>
              <div class="continue-card__meta"><span>Up next</span></div>
            </div>
          </a>`;
      } else if ($('#nextUp')) {
        $('#nextUp').innerHTML = '<p style="color:var(--text-mute);font-size:13px">No suggestions just yet.</p>';
      }
    }

    // Set up the player (reuse if same media is already playing — preserves playback)
    const samePlayingMovie = mini.activePlayer && mini.activeCtx
      && mini.activeCtx.type === type && String(mini.activeCtx.id) === String(id)
      && (type !== 'tv' || (String(mini.activeCtx.season) === String(season) && String(mini.activeCtx.episode) === String(episode)));

    if (!samePlayingMovie) {
      // Tear down old, make new
      if (mini.activePlayer) { try { mini.activePlayer.destroy(); } catch(_){} mini.activePlayer = null; }
      mini.activePlayer = new StellarPlayer('#playerFrame', {
        accent: getCurrentAccentHex(),
        onLoading: (loading, name, status) => mini.setLoading(loading, name, status),
        onSourceChange: (name) => { if ($('#sourceName')) $('#sourceName').textContent = name; },
        onEvent: () => {},
        onProgress: () => {}
      });
      if (type === 'tv') mini.activePlayer.playEpisode(id, parseInt(season), parseInt(episode));
      else               mini.activePlayer.playMovie(id);
      mini.activeCtx = {
        type, id, season, episode,
        title, year, poster: data.poster_path, backdrop: data.backdrop_path
      };
    } else {
      mini.activeCtx.title = title;
    }

    // Wire watch-page controls. The Minimize button is only useful when
    // PiP is enabled — hide it otherwise so the chrome stays clean.
    const minBtn = $('#watchMinimize');
    minBtn.hidden = !pipEnabled();
    minBtn.addEventListener('click', () => {
      if (!pipEnabled()) {
        toast('Mini player is off · turn it on in Settings', 'picture-in-picture-2-line');
        return;
      }
      mini.toMini();
    });
    const openSource = () => openSourceModal();
    $('#watchSourceBtn').addEventListener('click', openSource);
    $('#serverPick').addEventListener('click', openSource);
  }

  function openSourceModal() {
    if (!mini.activePlayer) return;
    const existing = $('#sourceModal');
    if (existing) existing.remove();
    const m = document.createElement('div');
    m.id = 'sourceModal';
    m.className = 'source-modal open';
    const list = mini.activePlayer.listSources().map((s, i) => `
      <button class="source-row ${s.name === mini.activePlayer.currentSourceName() ? 'active' : ''}" data-i="${s.index}">
        <div class="source-row__num">${String(i+1).padStart(2,'0')}</div>
        <div class="source-row__body">
          <div class="source-row__name">${html(s.name)}</div>
          <div class="source-row__sub">${s.index === 0 ? 'Primary · auto-selected' : 'Failover'}</div>
        </div>
        <i class="ri-${s.name === mini.activePlayer.currentSourceName() ? 'check-line' : 'arrow-right-s-line'}"></i>
      </button>`).join('');
    m.innerHTML = `
      <div class="source-modal__panel">
        <div class="source-modal__head">
          <h3 class="serif"><em>Choose</em> a stream</h3>
          <button class="icon-btn" onclick="this.closest('.source-modal').classList.remove('open');setTimeout(()=>this.closest('.source-modal').remove(),240)"><i class="ri-close-line"></i></button>
        </div>
        <p>Streams auto-switch if one fails. You can also pick manually.</p>
        <div class="source-rows">${list}</div>
        <div class="source-modal__hint"><i class="ri-shield-keyhole-line"></i> Constellation routing — provider names are abstracted for stability.</div>
      </div>`;
    document.body.appendChild(m);
    $$('#sourceModal .source-row').forEach(row => {
      row.addEventListener('click', () => {
        const i = parseInt(row.dataset.i);
        mini.activePlayer.setSource(i);
        if ($('#sourceName')) $('#sourceName').textContent = mini.activePlayer.currentSourceName() || '—';
        m.classList.remove('open');
        setTimeout(() => m.remove(), 240);
        toast('Switched stream');
      });
    });
    m.addEventListener('click', (e) => { if (e.target === m) { m.classList.remove('open'); setTimeout(() => m.remove(), 240); } });
  }

  // ───── LIST ───────────────────────────────────────────────────────────────
  function renderList() {
    const favs = getFavorites();
    if (!favs.length) {
      $('#view').innerHTML = `
        <header class="page-header">
          <span class="eyebrow page-header__eyebrow"><span class="dot"></span> Saved</span>
          <h1 class="page-header__title">Your <em>list</em></h1>
        </header>
        <div class="empty">
          <div class="empty__icon"><i class="ri-bookmark-line"></i></div>
          <h3 class="serif"><em>Nothing here yet.</em></h3>
          <p>Tap the bookmark on any title to save it. Your list lives in this browser only — no account needed.</p>
          <a class="btn-primary" href="/" data-link><i class="ri-arrow-left-line"></i> Back to discover</a>
        </div>
        ${footer()}
      `;
      return;
    }
    $('#view').innerHTML = `
      <header class="page-header">
        <span class="eyebrow page-header__eyebrow"><span class="dot"></span> Saved · ${favs.length} titles</span>
        <h1 class="page-header__title">Your <em>list</em></h1>
        <p class="page-header__sub">Picks you saved for later. Synced to your browser, never the cloud.</p>
      </header>
      <section class="section">
        <div class="browse-grid">${favs.map(f => titleCard({
          id: f.id, title: f.title, name: f.title,
          poster_path: f.poster_path,
          release_date: f.year ? `${f.year}-01-01` : '',
          media_type: f.type
        })).join('')}</div>
      </section>
      ${footer()}
    `;
  }

  // ───── SEARCH ─────────────────────────────────────────────────────────────
  function openSearch(scope='all') {
    $('#search').classList.add('open');
    $('#searchInput').focus();
    $('#searchInput').dataset.scope = scope;
    if (!$('#searchInput').value) populateSearchSuggest();
  }
  function closeSearch() { $('#search').classList.remove('open'); }

  async function populateSearchSuggest() {
    $('#searchSuggest').hidden = false;
    $('#searchResults').hidden = true;

    const genres = (await tmdb('/genre/movie/list')).genres || [];
    // Anime gets a featured first chip; NSFW/After-dark gets a tinted chip.
    $('#searchChips').innerHTML = `
      <a class="chip chip--anime" href="/anime" data-link onclick="OMNIFLIX.closeSearch()"><i class="ri-sparkling-2-fill"></i> Anime</a>
      <a class="chip chip--adult" href="/genre/movie/0/After%20dark" data-link onclick="OMNIFLIX.closeSearch()"><i class="ri-moon-clear-line"></i> 18+</a>
      ${genres.slice(0, 10).map(g => `
        <a class="chip" href="/genre/movie/${g.id}/${encodeURIComponent(g.name)}" data-link onclick="OMNIFLIX.closeSearch()">${html(g.name)}</a>
      `).join('')}
    `;

    const trending = await tmdb('/trending/all/week');
    $('#searchTrending').innerHTML = (trending.results || []).slice(0, 12).map(titleCard).join('');
  }

  const onSearch = debounce(async () => {
    const q = $('#searchInput').value.trim();
    if (!q) { populateSearchSuggest(); return; }
    $('#searchSuggest').hidden = true;
    $('#searchResults').hidden = false;
    $('#searchResults').innerHTML = `<div class="group">${skGrid(10)}</div>`;

    // Search uses the user's NSFW preference.
    const data = await tmdb('/search/multi', { query: q, include_adult: nsfwEnabled() ? 'true' : 'false' });
    const results = (data.results || []).filter(r => r.media_type !== 'company' && r.media_type !== 'collection');

    // Detect anime-leaning hits to surface a dedicated group at the top.
    const isAnime = (r) =>
      (r.media_type === 'tv' || r.media_type === 'movie') &&
      (r.original_language === 'ja') &&
      Array.isArray(r.genre_ids) && r.genre_ids.includes(16);

    const anime  = results.filter(r => isAnime(r) && r.poster_path);
    const animeIds = new Set(anime.map(a => `${a.media_type}:${a.id}`));
    const movies = results.filter(r => r.media_type === 'movie' && r.poster_path && !animeIds.has(`movie:${r.id}`));
    const tvs    = results.filter(r => r.media_type === 'tv'    && r.poster_path && !animeIds.has(`tv:${r.id}`));
    const people = results.filter(r => r.media_type === 'person' && r.profile_path);

    if (!movies.length && !tvs.length && !people.length && !anime.length) {
      $('#searchResults').innerHTML = `<div class="empty"><div class="empty__icon"><i class="ri-search-line"></i></div><h3 class="serif"><em>No results.</em></h3><p>Try a different spelling or a director's name.</p></div>`;
      return;
    }
    $('#searchResults').innerHTML = `
      ${anime.length ? `<div class="group group--anime"><h4><i class="ri-sparkling-2-fill" style="color:var(--accent)"></i> Anime · ${anime.length}</h4><div class="browse-grid">${anime.slice(0, 12).map(titleCard).join('')}</div></div>` : ''}
      ${movies.length ? `<div class="group"><h4>Films · ${movies.length}</h4><div class="browse-grid">${movies.slice(0, 12).map(titleCard).join('')}</div></div>` : ''}
      ${tvs.length ? `<div class="group"><h4>Series · ${tvs.length}</h4><div class="browse-grid">${tvs.slice(0, 12).map(titleCard).join('')}</div></div>` : ''}
      ${people.length ? `<div class="group"><h4>People · ${people.length}</h4><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">${people.slice(0, 12).map(p => `
        <a class="s-person" href="/person/${p.id}" data-link onclick="OMNIFLIX.closeSearch()">
          <div class="s-person__photo">${p.profile_path ? `<img src="${IMG('w185', p.profile_path)}">` : ''}</div>
          <div class="s-person__body">
            <div class="s-person__name">${html(p.name)}</div>
            <div class="s-person__dept">${html(p.known_for_department || 'Person')}</div>
          </div>
        </a>`).join('')}</div></div>` : ''}
    `;
  }, 280);

  // ───── Misc ───────────────────────────────────────────────────────────────
  function footer() {
    return `<footer class="footer">
      <a class="brand">
        <svg class="brand__logo" viewBox="0 0 64 64" aria-hidden="true"><use href="#omni-mark"/></svg>
        <span class="brand__name">Omni<em>Flix</em></span>
      </a>
      <p>A cinematic streaming experience. Hand-built for the love of film.</p>
      <p>Browse, discover, watch — beautifully, with zero accounts and zero tracking.</p>
      <div class="footer__legal">O · MMXXVI · Made for the love of cinema</div>
    </footer>`;
  }

  function renderError(msg) {
    return `<div class="empty">
      <div class="empty__icon"><i class="ri-error-warning-line"></i></div>
      <h3 class="serif"><em>${html(msg)}</em></h3>
      <a class="btn-primary" href="/" data-link><i class="ri-arrow-left-line"></i> Back to home</a>
    </div>${footer()}`;
  }

  // ───── Boot ───────────────────────────────────────────────────────────────
  const cursor = $('#cursorSpot');
  if (cursor) {
    document.addEventListener('mousemove', (e) => {
      cursor.style.transform = `translate3d(${e.clientX - 270}px, ${e.clientY - 270}px, 0)`;
    });
  }

  const topnav = document.querySelector('.topnav');
  window.addEventListener('scroll', () => {
    topnav?.classList.toggle('scrolled', window.scrollY > 20);
  }, { passive: true });

  $('#searchBtn').addEventListener('click', () => openSearch());
  $('#searchClose').addEventListener('click', closeSearch);
  $('#searchInput').addEventListener('input', onSearch);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSearch();
    if ((e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key === 'k')) && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) {
      e.preventDefault(); openSearch();
    }
  });

  $('#themeBtn').addEventListener('click', () => {
    buildPalette();
    refreshPipToggle();
    $('#themeSheet').classList.add('open');
  });
  $('#themeClose').addEventListener('click', () => $('#themeSheet').classList.remove('open'));
  $('#themeSheet').addEventListener('click', (e) => { if (e.target === $('#themeSheet')) $('#themeSheet').classList.remove('open'); });

  // ───── PiP toggle wire-up ─────────────────────────────────────────────
  function refreshPipToggle() {
    const sw = $('#pipToggle');
    const row = $('#pipRow');
    if (!sw) return;
    const on = pipEnabled();
    sw.setAttribute('aria-checked', on ? 'true' : 'false');
    sw.classList.toggle('switch--on', on);
    if (row) row.classList.toggle('setting-row--off', !on);
  }
  $('#pipToggle')?.addEventListener('click', () => {
    const next = !pipEnabled();
    setPipEnabled(next);
    refreshPipToggle();
    toast(next ? 'Mini player on' : 'Mini player off',
          next ? 'picture-in-picture-2-line' : 'picture-in-picture-exit-line');
    const minBtn = $('#watchMinimize');
    if (minBtn) minBtn.hidden = !next;
  });
  document.documentElement.classList.toggle('pip-disabled', !pipEnabled());

  // ───── Downloads toggle + modal ─────────────────────────────────────────
  function refreshDlToggle() {
    const sw = $('#dlToggle');
    if (!sw) return;
    const on = dlEnabled();
    sw.setAttribute('aria-checked', on ? 'true' : 'false');
    sw.classList.toggle('switch--on', on);
    $('#dlRow')?.classList.toggle('setting-row--off', !on);
  }
  $('#dlToggle')?.addEventListener('click', () => {
    const next = !dlEnabled();
    setDlEnabled(next);
    refreshDlToggle();
    toast(next ? 'Downloads enabled' : 'Downloads disabled',
          next ? 'download-cloud-2-line' : 'forbid-line');
  });
  refreshDlToggle();
  document.documentElement.classList.toggle('dl-disabled', !dlEnabled());

  function refreshNsfwToggle() {
    const sw = $('#nsfwToggle');
    if (!sw) return;
    const on = nsfwEnabled();
    sw.setAttribute('aria-checked', on ? 'true' : 'false');
    sw.classList.toggle('switch--on', on);
    $('#nsfwRow')?.classList.toggle('setting-row--off', !on);
  }
  $('#nsfwToggle')?.addEventListener('click', () => {
    const next = !nsfwEnabled();
    setNsfwEnabled(next);
    refreshNsfwToggle();
    cache.clear();
    toast(next ? 'After-dark unlocked' : 'After-dark hidden',
          next ? 'moon-clear-line' : 'sun-line');
    if (parsePath().name === 'home') route();
  });
  refreshNsfwToggle();
  document.documentElement.classList.toggle('nsfw-on', nsfwEnabled());

  // ───── DL warning modal ─────────────────────────────────────────────────
  const dlModal = $('#dlModal');
  let _pendingDl = null;
  function openDlModal(payload) {
    _pendingDl = payload || null;
    dlModal?.classList.add('open');
    dlModal?.setAttribute('aria-hidden', 'false');
  }
  function closeDlModal() {
    dlModal?.classList.remove('open');
    dlModal?.setAttribute('aria-hidden', 'true');
    _pendingDl = null;
  }
  dlModal?.querySelectorAll('[data-dl-close]').forEach(el => el.addEventListener('click', closeDlModal));
  $('#dlModalAccept')?.addEventListener('click', () => {
    ackDl();
    const p = _pendingDl;
    closeDlModal();
    if (p) launchDownload(p, true);
    toast('Downloads enabled · use an ad-blocker', 'download-cloud-2-line');
  });
  $('#dlModalDisable')?.addEventListener('click', () => {
    setDlEnabled(false);
    refreshDlToggle();
    closeDlModal();
    toast('Downloads disabled', 'forbid-line');
  });

  function launchDownload({ type, id, season, episode, title }, skipChecks) {
    if (!skipChecks) {
      if (!dlEnabled()) { toast('Downloads are off. Enable in Settings.', 'forbid-line'); return; }
      if (!dlAcknowledged()) { openDlModal({ type, id, season, episode, title }); return; }
    }
    const u = dlUrl(type, id, season, episode);
    if (!u) { toast('No download link for this title', 'error-warning-line'); return; }
    const w = _nativeOpen(u, '_blank', 'noopener,noreferrer');
    if (!w) { location.href = u; return; }
    toast('Opening download · dl.peachify.top', 'download-cloud-2-line');
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-dl');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    launchDownload({
      type: btn.dataset.dlType,
      id: btn.dataset.dlId,
      season: btn.dataset.dlS,
      episode: btn.dataset.dlE,
    });
  }, true);

  loadAccent();
  setTimeout(() => $('#splash').classList.add('gone'), 1100);
  setTimeout(() => $('#splash').remove(), 2000);

  // ── Global <img> error fallback ─────────────────────────────────────────
  // Network hiccups (mobile data, slow CDN) shouldn't leave broken-image
  // icons. Mark the img and let CSS render a styled placeholder.
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (t && t.tagName === 'IMG' && !t.classList.contains('img-error')) {
      t.classList.add('img-error');
      // Stop the browser from retrying repeatedly
      t.removeAttribute('src');
    }
  }, true);

  // ── Tablet/phone-rotation safety net ────────────────────────────────────
  // Re-clamp the mini player when the visual viewport changes (URL bar
  // hide/show on iOS, soft keyboard, rotation). Without this, the floating
  // window can end up underneath the bottom nav after URL-bar collapse.
  const reclamp = () => {
    if (window.OMNIFLIX && window.__miniReclamp) window.__miniReclamp();
  };
  window.addEventListener('orientationchange', reclamp);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', reclamp);
  }

  // GitHub-Pages 404 → SPA redirect: restore the originally-requested path.
  try {
    const stashed = sessionStorage.getItem('omniflix:redirect');
    if (stashed) {
      sessionStorage.removeItem('omniflix:redirect');
      if (stashed && stashed !== location.pathname + location.search + location.hash) {
        history.replaceState({}, '', stashed);
      }
    }
  } catch (_) {}

  // Initial route — already at correct pathname (History API)
  route();

  // ───── Public API ─────────────────────────────────────────────────────────
  window.OMNIFLIX = {
    openTitle: (type, id) => navigate(`/title/${type}/${id}`),
    openSearch, closeSearch,
    openWatchById: (type, id) => navigate(`/watch/${type}/${id}`),
    go: (path) => navigate(path),
    toggleFav: (id, type, title, poster_path, year) => {
      toggleFavorite({ id, type, title, poster_path, year });
      const btn = $('#favBtn');
      if (btn) {
        const f = isFavorite(id);
        btn.innerHTML = `<i class="ri-${f ? 'check-line' : 'bookmark-line'}"></i> ${f ? 'In your list' : 'Add to list'}`;
      }
    },
    removeContinue: (id) => {
      removeProgress(id);
      if (parsePath().name === 'home') route();
      toast('Removed from continue watching');
    },
    toggleClamp: (btn) => {
      const w = btn.closest('.clamp-wrap');
      if (!w) return;
      const open = w.classList.toggle('is-open');
      btn.textContent = open ? 'Show less' : 'Read more';
    },
    miniExpand: () => mini.expand(),
    miniClose: () => mini.close(),
    download: (type, id, season, episode) => launchDownload({ type, id, season, episode }),
    dlEnabled: () => dlEnabled(),
    setDlEnabled: (on) => { setDlEnabled(on); refreshDlToggle(); },
    nsfwEnabled: () => nsfwEnabled(),
    setNsfwEnabled: (on) => { setNsfwEnabled(on); refreshNsfwToggle(); cache.clear(); }
  };
  window.ANIMOWEB = window.OMNIFLIX;
  window.ANIMOWEB_CONFIG = _CFG;
})();
