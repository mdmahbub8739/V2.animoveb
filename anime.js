(function (global) {
  'use strict';

  /* ─────────────────────────────────────────────────────────────────────────
   * Constants
   * ───────────────────────────────────────────────────────────────────────── */
  const AL_API          = 'https://graphql.anilist.co';
  const ANIZIP          = 'https://api.ani.zip/mappings';
  const SWR_KEY         = 'omniflix_anilist_swr_v1';
  const SWR_TTL         = 1000 * 60 * 60 * 6;
  const MEGAPLAY_BASE   = 'https://megaplay.buzz';
  const MEGAPLAY_ORIGIN = 'https://megaplay.buzz';

  const _qCache   = new Map();
  const _mapCache = new Map();
  const _pending  = new Map();

  const $   = (s, r = document) => r.querySelector(s);
  const $$  = (s, r = document) => Array.from(r.querySelectorAll(s));
  const html = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'": '&#39;' }[c]));
  const fmtScore = (n) => n ? (Math.round(n) / 10).toFixed(1) : '\u2014';

  /* ─────────────────────────────────────────────────────────────────────────
   * SWR cache helpers
   * ───────────────────────────────────────────────────────────────────────── */
  function swrRead(key) {
    try {
      const raw = localStorage.getItem(SWR_KEY);
      if (!raw) return null;
      const all = JSON.parse(raw);
      const rec = all[key];
      if (!rec) return null;
      return { data: rec.d, stale: (Date.now() - rec.t) > SWR_TTL };
    } catch { return null; }
  }
  function swrWrite(key, data) {
    try {
      const raw = localStorage.getItem(SWR_KEY);
      const all = raw ? JSON.parse(raw) : {};
      all[key] = { d: data, t: Date.now() };
      localStorage.setItem(SWR_KEY, JSON.stringify(all));
    } catch {}
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * GraphQL fetch
   * ───────────────────────────────────────────────────────────────────────── */
  async function gql(query, variables = {}) {
    const key = JSON.stringify({ query, variables });
    if (_qCache.has(key))   return _qCache.get(key);
    if (_pending.has(key))  return _pending.get(key);
    const p = fetch(AL_API, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify({ query, variables }),
    })
      .then(r  => { if (!r.ok) throw new Error('AniList ' + r.status); return r.json(); })
      .then(j  => { if (j.errors) throw new Error(j.errors[0].message);
                    _qCache.set(key, j.data); _pending.delete(key); return j.data; })
      .catch(e => { _pending.delete(key); throw e; });
    _pending.set(key, p);
    return p;
  }

  async function gqlSwr(swrKey, query, variables, onData) {
    const cached = swrRead(swrKey);
    if (cached) { onData(cached.data, true); if (!cached.stale) return; }
    try {
      const fresh = await gql(query, variables);
      swrWrite(swrKey, fresh);
      onData(fresh, false);
    } catch (e) { if (!cached) throw e; }
  }

  function prefetchMapping(anilistId) {
    if (_mapCache.has(anilistId)) return _mapCache.get(anilistId);
    const p = fetch(`${ANIZIP}?anilist_id=${anilistId}`)
      .then(r => r.ok ? r.json() : null).catch(() => null);
    _mapCache.set(anilistId, p);
    return p;
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * GraphQL queries
   * ───────────────────────────────────────────────────────────────────────── */
  const CARD_FRAG = `
    fragment Card on Media {
      id
      title { romaji english }
      coverImage { extraLarge large medium color }
      format averageScore seasonYear
      startDate { year }
    }
  `;

  const HERO_QUERY = `
    ${CARD_FRAG}
    query {
      trending: Page(perPage: 16) { media(type: ANIME, sort: TRENDING_DESC, isAdult: false) { ...Card } }
      hero: Page(perPage: 5) {
        media(type: ANIME, sort: TRENDING_DESC, status: RELEASING, isAdult: false) {
          ...Card bannerImage description(asHtml: false) genres
        }
      }
    }
  `;

  const RAILS_QUERY = `
    ${CARD_FRAG}
    query($season: MediaSeason, $year: Int) {
      season:   Page(perPage: 16) { media(type: ANIME, sort: POPULARITY_DESC, season: $season, seasonYear: $year, isAdult: false) { ...Card } }
      popular:  Page(perPage: 16) { media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) { ...Card } }
      topRated: Page(perPage: 16) { media(type: ANIME, sort: SCORE_DESC,       isAdult: false) { ...Card } }
      action:   Page(perPage: 16) { media(type: ANIME, sort: TRENDING_DESC, genre: "Action",  isAdult: false) { ...Card } }
      romance:  Page(perPage: 16) { media(type: ANIME, sort: TRENDING_DESC, genre: "Romance", isAdult: false) { ...Card } }
    }
  `;

  const BROWSE_QUERY = `
    ${CARD_FRAG}
    query($page: Int, $perPage: Int, $sort: [MediaSort], $genre: String, $format: MediaFormat, $status: MediaStatus, $search: String) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage }
        media(type: ANIME, sort: $sort, genre: $genre, format: $format, status: $status, search: $search, isAdult: false) { ...Card }
      }
    }
  `;

  const RAIL_PAGE_QUERY = `
    ${CARD_FRAG}
    query($page: Int, $sort: [MediaSort], $genre: String, $season: MediaSeason, $seasonYear: Int, $status: MediaStatus) {
      Page(page: $page, perPage: 12) {
        pageInfo { hasNextPage }
        media(type: ANIME, sort: $sort, genre: $genre, season: $season, seasonYear: $seasonYear, status: $status, isAdult: false) { ...Card }
      }
    }
  `;

  /* NEW: Full series detail query used by the watch page */
  const DETAIL_QUERY = `
    query($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        title { romaji english native }
        coverImage { extraLarge large color }
        bannerImage
        description(asHtml: false)
        episodes
        status
        format
        duration
        genres
        averageScore
        seasonYear
        studios(isMain: true) { nodes { name } }
        nextAiringEpisode { episode airingAt }
      }
    }
  `;

  /* ─────────────────────────────────────────────────────────────────────────
   * Helpers
   * ───────────────────────────────────────────────────────────────────────── */
  function currentSeason() {
    const m = new Date().getMonth();
    const s = ['WINTER','WINTER','SPRING','SPRING','SPRING','SUMMER','SUMMER','SUMMER','FALL','FALL','FALL','WINTER'];
    return { season: s[m], year: new Date().getFullYear() };
  }
  function titleOf(m)  { return m.title?.english || m.title?.romaji || 'Unknown'; }
  function coverOf(m)  { return m.coverImage?.extraLarge || m.coverImage?.large || m.coverImage?.medium || ''; }
  function yearOf(m)   { return m.seasonYear || m.startDate?.year || ''; }
  function fmtFormat(f){ return ({ TV:'Series', TV_SHORT:'Short', MOVIE:'Film', SPECIAL:'Special', OVA:'OVA', ONA:'ONA', MUSIC:'Music' })[f] || f || ''; }

  /* ─────────────────────────────────────────────────────────────────────────
   * MegaPlay URL builder  (AniList ID path)
   * https://megaplay.buzz/stream/ani/{anilist-id}/{ep-num}/{lang}
   * ───────────────────────────────────────────────────────────────────────── */
  function buildMegaplayUrl(anilistId, epNum, lang) {
    return `${MEGAPLAY_BASE}/stream/ani/${anilistId}/${epNum || 1}/${lang || 'sub'}`;
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Card / skeleton templates
   * ───────────────────────────────────────────────────────────────────────── */
  function animeCard(m) {
    const poster = coverOf(m);
    const rating = m.averageScore
      ? `<span class="title-card__rating"><i class="ri-star-fill"></i> ${fmtScore(m.averageScore)}</span>` : '';
    const isFilm = m.format === 'MOVIE';
    const badge  = `<span class="title-card__badge">${isFilm ? 'Film' : 'Series'}</span>`;
    const art    = poster
      ? `<img src="${poster}" alt="${html(titleOf(m))}" loading="lazy" decoding="async">`
      : `<div class="title-card__placeholder"><i class="ri-${isFilm ? 'film-line' : 'tv-2-line'}"></i></div>`;
    return `<a class="title-card" href="#" data-anilist="${m.id}" data-format="${m.format || ''}" data-poster="${html(poster)}" data-title="${html(titleOf(m))}">
      <div class="title-card__poster"><div class="title-card__shimmer"></div>${art}${rating}${badge}</div>
      <div class="title-card__meta">
        <div class="title-card__title">${html(titleOf(m))}</div>
        <div class="title-card__sub">${yearOf(m) || '\u2014'}</div>
      </div>
    </a>`;
  }

  function skTitleCard() {
    return `<div class="sk-card"><div class="sk sk--poster"></div><div class="sk sk--line sk--line-lg"></div><div class="sk sk--line sk--line-sm"></div></div>`;
  }
  function skRail() {
    return `<div class="rail"><div class="rail__strip">${Array.from({ length: 7 }, skTitleCard).join('')}</div></div>`;
  }
  function skHero() {
    return `<section class="hero an-hero-sk">
      <div class="an-hero-sk__bg"></div>
      <div class="hero__scrim"></div>
      <div class="hero__content">
        <div class="an-hero-sk__eyebrow"></div>
        <div class="an-hero-sk__title"></div>
        <div class="an-hero-sk__meta"></div>
        <div class="an-hero-sk__line"></div>
        <div class="an-hero-sk__line" style="width:70%"></div>
        <div class="an-hero-sk__actions">
          <div class="an-hero-sk__btn"></div>
          <div class="an-hero-sk__btn an-hero-sk__btn--ghost"></div>
        </div>
      </div>
    </section>`;
  }

  function section(id, title, sub, key, params) {
    return `<section class="section an-rail" id="${id}" data-rail-key="${key || ''}" data-rail-params='${params ? JSON.stringify(params) : ''}'>
      <header class="section__head">
        <div>
          <h2 class="section__title">${title}</h2>
          ${sub ? `<div class="section__sub">${sub}</div>` : ''}
        </div>
      </header>
      ${skRail()}
    </section>`;
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Toast (kept for error feedback)
   * ───────────────────────────────────────────────────────────────────────── */
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'an-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('is-visible'));
    setTimeout(() => { t.classList.remove('is-visible'); setTimeout(() => t.remove(), 240); }, 2600);
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * MegaPlay postMessage listener
   * ───────────────────────────────────────────────────────────────────────── */
  function installMegaplayListener(onComplete, onProgress) {
    cleanupMegaplayListener();
    const handler = (event) => {
      if (event.origin !== MEGAPLAY_ORIGIN) return;
      let data = event.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (e) { return; }
      }
      if (!data || typeof data !== 'object') return;

      // megacloud channel events (MegaPlay uses megacloud internally)
      if (data.channel === 'megacloud') {
        if (data.event === 'complete' && typeof onComplete === 'function') onComplete();
        if (data.event === 'time'     && typeof onProgress === 'function') onProgress(data);
      }
      // watching-log events
      if (data.type === 'watching-log' && typeof onProgress === 'function') onProgress(data);
    };
    window.__anMegaplayHandler = handler;
    window.addEventListener('message', handler);
  }

  function cleanupMegaplayListener() {
    if (window.__anMegaplayHandler) {
      window.removeEventListener('message', window.__anMegaplayHandler);
      window.__anMegaplayHandler = null;
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Anime detail / watch page
   * ───────────────────────────────────────────────────────────────────────── */

  /* Entry point: called when user clicks any anime card */
  async function resolveAndOpen(anilistId) {
    const root = document.getElementById('alViewRoot');
    if (!root) return;
    openAnimeDetail(root, anilistId);
  }

  async function openAnimeDetail(root, anilistId) {
    root.innerHTML = `
      <div class="an-detail-loading">
        <div class="an-detail-spinner"></div>
        <span>Loading\u2026</span>
      </div>`;
    try {
      const data = await gql(DETAIL_QUERY, { id: anilistId });
      if (!data?.Media) throw new Error('No media returned');
      renderDetailPage(root, data.Media);
    } catch (e) {
      root.innerHTML = `
        <div style="padding:40px 48px">
          <button class="btn-ghost" id="anDetailBackErr"><i class="ri-arrow-left-line"></i> Back to Anime</button>
          <p class="an-empty" style="margin-top:24px">Could not load this title. Please try again.</p>
        </div>`;
      document.getElementById('anDetailBackErr')
        ?.addEventListener('click', () => AniListModule.renderPage(root));
    }
  }

  function renderDetailPage(root, media) {
    const id       = media.id;
    const titleStr = media.title?.english || media.title?.romaji || 'Unknown';
    const cover    = media.coverImage?.extraLarge || media.coverImage?.large || '';
    const banner   = media.bannerImage || cover;
    const rawDesc  = (media.description || '').replace(/<[^>]+>/g, '');
    const desc     = rawDesc.slice(0, 420);
    const isMovie  = media.format === 'MOVIE';
    const studio   = media.studios?.nodes?.[0]?.name || '';
    const genres   = (media.genres || []).slice(0, 5);
    const score    = media.averageScore;
    const year     = media.seasonYear || '';
    const fmt      = fmtFormat(media.format);
    const ongoing  = media.status === 'RELEASING';

    /* Episode count — pick best available */
    const airedEps = media.nextAiringEpisode?.episode
      ? media.nextAiringEpisode.episode - 1 : null;
    const epCount  = isMovie ? 1 : (media.episodes || airedEps || 12);
    const epLabel  = (ongoing && airedEps) ? ` \u00b7 ${airedEps} aired` : '';

    root.innerHTML = `
      <div class="an-detail" id="anDetailRoot">

        <!-- Topbar -->
        <div class="an-detail__topbar">
          <button class="an-detail__back" id="anDetailBack">
            <i class="ri-arrow-left-s-line"></i> Anime
          </button>
        </div>

        <!-- Hero banner -->
        <div class="an-detail__hero" style="background-image:url(${html(banner)})">
          <div class="an-detail__hero-scrim"></div>
          <div class="an-detail__hero-content">
            ${cover ? `<img class="an-detail__cover" src="${html(cover)}" alt="${html(titleStr)}" loading="lazy">` : ''}
            <div class="an-detail__meta-block">
              <h1 class="an-detail__title">${html(titleStr)}</h1>
              <div class="an-detail__meta-row">
                ${score ? `<span class="an-meta-score"><i class="ri-star-fill"></i> ${score}%</span>` : ''}
                ${year  ? `<span>${year}</span>` : ''}
                <span>${html(fmt)}</span>
                ${!isMovie ? `<span>${epCount} eps${epLabel}</span>` : ''}
                ${ongoing   ? `<span class="an-badge-airing">Airing</span>` : ''}
                ${studio    ? `<span>${html(studio)}</span>` : ''}
              </div>
              ${genres.length ? `<div class="an-detail__genres">${genres.map(g => `<span class="an-genre-tag">${html(g)}</span>`).join('')}</div>` : ''}
              ${desc ? `<p class="an-detail__desc">${html(desc)}${rawDesc.length > 420 ? '\u2026' : ''}</p>` : ''}
            </div>
          </div>
        </div>

        <!-- Player -->
        <div class="an-detail__player-section">
          <div class="an-detail__player-header">
            <div class="an-now-playing">
              <i class="ri-play-circle-fill"></i>
              <span id="anNowPlayingText">${isMovie ? html(titleStr) : 'Select an episode below'}</span>
            </div>
            <div class="an-detail__player-controls">
              <div class="an-lang-toggle">
                <button class="an-lang-btn active" data-lang="sub">SUB</button>
                <button class="an-lang-btn" data-lang="dub">DUB</button>
              </div>
              <div class="an-server-tag">
                <i class="ri-server-fill"></i> MegaPlay
              </div>
            </div>
          </div>

          <div class="an-frame-wrap">
            <div class="an-frame-placeholder" id="anFramePlaceholder" ${isMovie ? 'style="display:none"' : ''}>
              <div class="an-frame-placeholder__inner">
                <i class="ri-play-large-fill"></i>
                <span>${isMovie ? 'Loading player\u2026' : 'Pick an episode to start watching'}</span>
              </div>
            </div>
            <iframe
              id="anMegaplayFrame"
              class="an-frame"
              frameborder="0" scrolling="no" allowfullscreen
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write"
              ${isMovie ? '' : 'style="display:none"'}
            ></iframe>
          </div>
        </div>

        <!-- Episode Grid (series only) -->
        ${!isMovie ? `
          <div class="an-detail__eps-section">
            <div class="an-eps-header">
              <h3 class="an-eps-title">Episodes</h3>
              <span class="an-eps-count-badge">${epCount}${epLabel}</span>
            </div>
            <div class="an-eps-grid" id="anEpsGrid">
              ${Array.from({ length: epCount }, (_, i) => `
                <button class="an-ep-btn" data-ep="${i + 1}" title="Episode ${i + 1}">
                  <span class="an-ep-num">${i + 1}</span>
                  <span class="an-ep-lbl">EP ${i + 1}</span>
                </button>`).join('')}
            </div>
          </div>
        ` : ''}

      </div>`;

    /* ── Playback state ──────────────────────────────────────────────────── */
    let activeEp   = null;
    let activeLang = 'sub';

    function playEp(ep, lang) {
      activeEp   = ep;
      activeLang = lang || activeLang;

      const frame       = document.getElementById('anMegaplayFrame');
      const placeholder = document.getElementById('anFramePlaceholder');
      const nowText     = document.getElementById('anNowPlayingText');

      if (!frame) return;
      frame.src          = buildMegaplayUrl(id, ep, activeLang);
      frame.style.display = 'block';
      if (placeholder) placeholder.style.display = 'none';
      if (nowText) nowText.textContent = isMovie ? titleStr : `Episode ${ep}`;

      /* Highlight active episode button */
      root.querySelectorAll('.an-ep-btn').forEach(b => b.classList.remove('active'));
      root.querySelector(`.an-ep-btn[data-ep="${ep}"]`)?.classList.add('active');

      /* Scroll player into view */
      root.querySelector('.an-detail__player-section')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    /* Auto-play for movies */
    if (isMovie) setTimeout(() => playEp(1, 'sub'), 80);

    /* Episode grid clicks */
    root.querySelector('#anEpsGrid')?.addEventListener('click', e => {
      const btn = e.target.closest('.an-ep-btn');
      if (!btn) return;
      playEp(+btn.dataset.ep, activeLang);
    });

    /* Sub / Dub toggle */
    root.querySelectorAll('.an-lang-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        root.querySelectorAll('.an-lang-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeLang = btn.dataset.lang;
        if (activeEp != null) playEp(activeEp, activeLang);
      });
    });

    /* Back button */
    root.querySelector('#anDetailBack')?.addEventListener('click', () => {
      cleanupMegaplayListener();
      AniListModule.renderPage(root);
    });

    /* MegaPlay postMessage: auto-next on episode complete */
    installMegaplayListener(
      () => {
        if (!isMovie && activeEp != null && activeEp < epCount) {
          playEp(activeEp + 1, activeLang);
        }
      },
      null
    );
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Card click wiring (browse + rails)
   * ───────────────────────────────────────────────────────────────────────── */
  function wireCards(root) {
    root.addEventListener('click', (e) => {
      const card = e.target.closest('.title-card[data-anilist]');
      if (!card) return;
      e.preventDefault();
      resolveAndOpen(+card.dataset.anilist);
    });
    let hoverTimer;
    root.addEventListener('pointerover', (e) => {
      const card = e.target.closest('.title-card[data-anilist]');
      if (!card) return;
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => prefetchMapping(+card.dataset.anilist), 250);
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Hero carousel
   * ───────────────────────────────────────────────────────────────────────── */
  function renderHeroSlide(m, i, active) {
    const hasBanner = !!m.bannerImage;
    const bg        = m.bannerImage || coverOf(m);
    const score     = m.averageScore || 0;
    const desc      = (m.description || '').replace(/<[^>]+>/g, '').split('. ')[0].slice(0, 200);
    return `<div class="hero__slide ${active ? 'active' : ''}" data-i="${i}" data-bg-type="${hasBanner ? 'banner' : 'cover'}">
      <div class="hero__backdrop" style="background-image:url(${bg})"></div>
      <div class="hero__scrim"></div>
      <div class="hero__content">
        <span class="eyebrow"><span class="dot"></span> Featured \u00b7 Anime</span>
        <h1 class="hero__title">${html(titleOf(m))}</h1>
        <div class="hero__meta">
          ${score ? `<span class="score"><i class="ri-star-fill"></i> ${score}%</span><span class="dot"></span>` : ''}
          <span>${yearOf(m) || ''}</span>
          <span class="dot"></span>
          <span class="mono">${fmtFormat(m.format).toUpperCase()}</span>
        </div>
        <p class="hero__synopsis">${html(desc)}${desc.length >= 200 ? '\u2026' : ''}</p>
        <div class="hero__actions">
          <button class="btn-primary" data-anilist="${m.id}" data-format="${m.format || ''}"><i class="ri-play-fill"></i> Watch now</button>
          <button class="btn-ghost"   data-anilist="${m.id}" data-format="${m.format || ''}"><i class="ri-information-line"></i> More info</button>
        </div>
      </div>
    </div>`;
  }

  function wireHero(wrap, items) {
    wrap.querySelectorAll('button[data-anilist]').forEach(b => {
      b.addEventListener('click', () => resolveAndOpen(+b.dataset.anilist));
    });
    if (items.length < 2) return;
    const slides = wrap.querySelectorAll('.hero__slide');
    const dots   = wrap.querySelector('.hero__dots');
    let idx = 0, timer = null;

    function setSlide(i) {
      idx = ((i % slides.length) + slides.length) % slides.length;
      slides.forEach((s, j) => s.classList.toggle('active', j === idx));
      if (dots) dots.querySelectorAll('button').forEach((d, j) => d.classList.toggle('active', j === idx));
    }
    function startTimer() {
      if (timer) clearInterval(timer);
      timer = setInterval(() => setSlide(idx + 1), 7000);
    }
    startTimer();
    if (dots) {
      dots.querySelectorAll('button').forEach((d, i) => d.addEventListener('click', () => { setSlide(i); startTimer(); }));
    }
    let sx = 0, sy = 0, tracking = false;
    wrap.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || e.target.closest('button, a')) return;
      sx = e.clientX; sy = e.clientY; tracking = true;
    }, { passive: true });
    wrap.addEventListener('pointerup', (e) => {
      if (!tracking) return; tracking = false;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { setSlide(idx + (dx < 0 ? 1 : -1)); startTimer(); }
    }, { passive: true });
    wrap.addEventListener('pointercancel', () => { tracking = false; }, { passive: true });
  }

  function paintHero(view, items) {
    const filtered = items.filter(m => m.bannerImage || coverOf(m)).slice(0, 5);
    if (!filtered.length) return;
    const markup = `<section class="hero hero--anime">
      ${filtered.map((m, i) => renderHeroSlide(m, i, i === 0)).join('')}
      ${filtered.length > 1 ? `<div class="hero__dots">${filtered.map((_, i) => `<button class="${i === 0 ? 'active' : ''}" aria-label="Slide ${i + 1}"></button>`).join('')}</div>` : ''}
    </section>`;
    const old = view.querySelector('.hero');
    if (old) old.outerHTML = markup; else view.insertAdjacentHTML('afterbegin', markup);
    wireHero(view.querySelector('.hero'), filtered);
  }

  function paintRail(view, sel, items) {
    const sec  = view.querySelector(sel);
    if (!sec) return;
    const rail = sec.querySelector('.rail');
    if (!rail) return;
    if (!items?.length) { rail.outerHTML = '<p class="an-empty">No titles found.</p>'; return; }
    rail.innerHTML = `<div class="rail__strip">${items.map(animeCard).join('')}</div>`;
    setupRailInfinite(sec);
  }

  function setupRailInfinite(sec) {
    if (sec.dataset.infiniteWired === '1') return;
    sec.dataset.infiniteWired = '1';
    const strip = sec.querySelector('.rail__strip');
    const rail  = sec.querySelector('.rail');
    if (!strip || !rail) return;
    let page = 1, loading = false, exhausted = false;

    const sentinel = document.createElement('div');
    sentinel.className = 'an-rail-end';
    strip.appendChild(sentinel);

    const params = sec.dataset.railParams ? JSON.parse(sec.dataset.railParams) : null;
    if (!params) return;

    const io = new IntersectionObserver(async (entries) => {
      if (!entries[0].isIntersecting || loading || exhausted) return;
      loading = true;
      sentinel.classList.add('is-loading');
      try {
        page += 1;
        const data  = await gql(RAIL_PAGE_QUERY, { ...params, page });
        const items = data.Page?.media || [];
        if (items.length) {
          const frag = document.createElement('div');
          frag.innerHTML = items.map(animeCard).join('');
          [...frag.children].forEach(c => strip.insertBefore(c, sentinel));
        }
        if (!data.Page?.pageInfo?.hasNextPage) { exhausted = true; sentinel.classList.add('is-done'); }
      } catch {} finally {
        loading = false;
        sentinel.classList.remove('is-loading');
      }
    }, { root: rail, rootMargin: '0px 600px 0px 0px' });

    io.observe(sentinel);
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Main page render
   * ───────────────────────────────────────────────────────────────────────── */
  async function renderPage(view) {
    const { season, year } = currentSeason();

    view.innerHTML = `
      ${skHero()}
      ${section('an-trending', 'Trending <em>right now</em>',   'What the community is watching this week.', 'trending', { sort: ['TRENDING_DESC'] })}
      ${section('an-season',   `${season.charAt(0)+season.slice(1).toLowerCase()} <em>${year}</em>`, 'Currently airing this season.', 'season', { sort: ['POPULARITY_DESC'], season, seasonYear: year })}
      ${section('an-popular',  'Most <em>popular</em>',         'All-time fan favourites.',                  'popular',  { sort: ['POPULARITY_DESC'] })}
      ${section('an-toprated', '<em>Top</em>-rated',            'Highest community scores.',                 'topRated', { sort: ['SCORE_DESC'] })}
      ${section('an-action',   'Action & <em>adventure</em>',   'Battles, heroes, impossible odds.',         'action',   { sort: ['TRENDING_DESC'], genre: 'Action' })}
      ${section('an-romance',  '<em>Romance</em> & drama',      'Heartbreak in animation.',                  'romance',  { sort: ['TRENDING_DESC'], genre: 'Romance' })}
      <section class="section" id="an-browse">
        <header class="section__head">
          <div>
            <h2 class="section__title">Browse <em>anime</em></h2>
            <div class="section__sub">Filter the full AniList catalogue.</div>
          </div>
        </header>
        <div class="chips" id="anFilters" style="margin-bottom:14px">
          <button class="chip active" data-filter="sort" data-value="TRENDING_DESC">Trending</button>
          <button class="chip" data-filter="sort" data-value="POPULARITY_DESC">Popular</button>
          <button class="chip" data-filter="sort" data-value="SCORE_DESC">Top rated</button>
          <button class="chip" data-filter="sort" data-value="START_DATE_DESC">Newest</button>
        </div>
        <div class="chips" id="anGenres" style="margin-bottom:14px">
          <button class="chip active" data-filter="genre" data-value="">All genres</button>
          ${['Action','Adventure','Comedy','Drama','Fantasy','Horror','Mystery','Romance',
             'Sci-Fi','Slice of Life','Sports','Supernatural','Thriller','Psychological','Mecha','Ecchi']
            .map(g => `<button class="chip" data-filter="genre" data-value="${g}">${g}</button>`).join('')}
        </div>
        <div class="browse-grid" id="anBrowseGrid">${Array.from({ length: 18 }, skTitleCard).join('')}</div>
        <div class="an-load-more"><button class="btn-ghost" id="anLoadMore"><i class="ri-add-line"></i> Load more</button></div>
      </section>
    `;

    wireCards(view);

    gqlSwr('hero', HERO_QUERY, {}, (data) => {
      if (!view.isConnected) return;
      paintHero(view, data.hero?.media || []);
      paintRail(view, '#an-trending', data.trending?.media || []);
    });

    gqlSwr('rails:' + season + year, RAILS_QUERY, { season, year }, (data) => {
      if (!view.isConnected) return;
      paintRail(view, '#an-season',   data.season?.media   || []);
      paintRail(view, '#an-popular',  data.popular?.media  || []);
      paintRail(view, '#an-toprated', data.topRated?.media || []);
      paintRail(view, '#an-action',   data.action?.media   || []);
      paintRail(view, '#an-romance',  data.romance?.media  || []);
    });

    setupBrowse(view);
  }

  function setupBrowse(view) {
    const state  = { sort: 'TRENDING_DESC', genre: '', format: '', status: '', search: '', page: 1, hasMore: true, loading: false };
    const grid   = view.querySelector('#anBrowseGrid');
    const loadBtn= view.querySelector('#anLoadMore');

    async function load(reset = false) {
      if (state.loading) return;
      if (reset) { state.page = 1; state.hasMore = true; grid.innerHTML = Array.from({ length: 18 }, skTitleCard).join(''); }
      if (!state.hasMore) return;
      state.loading = true;
      try {
        const vars = {
          page: state.page, perPage: 24, sort: [state.sort],
          ...(state.genre  && { genre:  state.genre }),
          ...(state.format && { format: state.format }),
          ...(state.status && { status: state.status }),
          ...(state.search && { search: state.search }),
        };
        const data  = await gql(BROWSE_QUERY, vars);
        const items = data.Page?.media || [];
        if (reset) grid.innerHTML = '';
        else $$('.sk-card', grid).forEach(el => el.remove());
        grid.insertAdjacentHTML('beforeend', items.map(animeCard).join(''));
        state.hasMore = !!data.Page?.pageInfo?.hasNextPage;
        state.page++;
      } catch {
        if (reset) grid.innerHTML = '<p class="an-empty">Failed to load. Try again.</p>';
      }
      state.loading = false;
      if (loadBtn) loadBtn.style.display = state.hasMore ? '' : 'none';
    }

    function bindChips(containerSel, key) {
      view.querySelectorAll(`${containerSel} .chip`).forEach(c => {
        c.addEventListener('click', () => {
          view.querySelectorAll(`${containerSel} .chip`).forEach(x => x.classList.remove('active'));
          c.classList.add('active');
          state[key] = c.dataset.value || '';
          load(true);
        });
      });
    }
    bindChips('#anFilters', 'sort');
    bindChips('#anGenres',  'genre');
    loadBtn?.addEventListener('click', () => load(false));
    load(true);
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * Nav auto-hide on scroll
   * ───────────────────────────────────────────────────────────────────────── */
  function initTopnavAutoHide() {
    if (window.__anTopnavWired) return;
    window.__anTopnavWired = true;
    const nav = document.querySelector('.topnav');
    if (!nav) return;
    let last = window.scrollY, ticking = false, idleTimer = null;
    function update() {
      const y     = window.scrollY;
      const delta = y - last;
      if (y < 30) { nav.classList.remove('an-nav-hidden'); nav.classList.remove('an-nav-solid'); }
      else         { nav.classList.add('an-nav-solid'); }
      if (Math.abs(delta) > 5) {
        if (delta > 0 && y > 80) nav.classList.add('an-nav-hidden');
        else                     nav.classList.remove('an-nav-hidden');
        last = y;
      }
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => nav.classList.remove('an-nav-hidden'), 1200);
      ticking = false;
    }
    window.addEventListener('scroll', () => { if (!ticking) { requestAnimationFrame(update); ticking = true; } }, { passive: true });
    update();
  }
  initTopnavAutoHide();

  global.AniListModule = { renderPage };
})(window);
