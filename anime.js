/* ═══════════════════════════════════════════════════════════════════════════
 *  ANIME MODULE — powered by Anikoto API + MegaPlay streaming
 *
 *  Catalog:  https://anikotoapi.site
 *    • GET /recent-anime?page=&per_page=   → { ok, data:[...], pagination }
 *    • GET /series/{NUMERIC_ID}            → { ok, data:{ anime:{...}, episodes:[...] } }
 *      ⚠ series endpoint requires the numeric `id`, NOT the slug.
 *
 *  Stream:   https://megaplay.buzz/stream/s-2/{episode_embed_id}/{sub|dub}
 *
 *  Exports: window.AnikotoModule = { renderPage, renderAnimeTitle, renderAnimeWatch }
 * ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const _CFG = global.OMNIFLIX_CONFIG || {};
  const ANIKOTO  = _CFG.ANIKOTO_API  || 'https://anikotoapi.site';
  const MEGAPLAY = _CFG.MEGAPLAY_BASE || 'https://megaplay.buzz';
  const DEF_LANG = _CFG.ANIME_DEFAULT_LANGUAGE || 'sub';
  const PER_PAGE = _CFG.ANIME_PER_PAGE || 20;

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const html = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ── Anikoto fetch helper ──────────────────────────────────────────────────
  const _apiCache = new Map();

  async function anikoto(path, ttl = 1000 * 60 * 10) {
    const url = `${ANIKOTO}${path}`;
    const cached = _apiCache.get(url);
    if (cached && Date.now() - cached.ts < ttl) return cached.data;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Anikoto ${res.status}: ${path}`);
    const json = await res.json();
    if (json && json.ok === false) throw new Error(json.error || 'Anikoto error');
    _apiCache.set(url, { data: json, ts: Date.now() });
    return json;
  }

  // ── Skeleton helpers ──────────────────────────────────────────────────────
  function skCard() {
    return `<div class="sk-card"><div class="sk sk--poster"></div><div class="sk sk--line sk--line-lg"></div><div class="sk sk--line sk--line-sm"></div></div>`;
  }
  function skRail() {
    return `<div class="rail"><div class="rail__strip">${Array.from({ length: 7 }, skCard).join('')}</div></div>`;
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

  // ── Toast ─────────────────────────────────────────────────────────────────
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'an-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('is-visible'));
    setTimeout(() => { t.classList.remove('is-visible'); setTimeout(() => t.remove(), 240); }, 2400);
  }

  // ── Anime card (Anikoto data shape) — links by NUMERIC id ─────────────────
  function animeCard(item) {
    const poster = item.poster || '';
    const title  = item.title || item.native || 'Unknown';
    const year   = item.year || '';
    const id     = item.id;          // numeric — required by /series/{id}
    const rating = item.rating && item.rating !== 'N/A'
      ? `<span class="title-card__rating"><i class="ri-star-fill"></i> ${html(item.rating)}</span>` : '';

    const badges = [];
    if (item.is_sub && item.is_sub > 0) badges.push('SUB');
    if (item.is_dub && item.is_dub > 0) badges.push('DUB');
    const badgeHtml = badges.length
      ? `<span class="title-card__badge">${badges.join(' · ')}</span>` : '';

    const art = poster
      ? `<img src="${poster}" alt="${html(title)}" loading="lazy" decoding="async">`
      : `<div class="title-card__placeholder"><i class="ri-tv-2-line"></i></div>`;

    return `<a class="title-card" href="/anime-title/${id}" data-link
               data-anikoto-id="${id}" data-poster="${html(poster)}" data-title="${html(title)}">
      <div class="title-card__poster"><div class="title-card__shimmer"></div>${art}${rating}${badgeHtml}</div>
      <div class="title-card__meta">
        <div class="title-card__title">${html(title)}</div>
        <div class="title-card__sub">${year || '—'}${item.status ? ' · ' + html(item.status) : ''}</div>
      </div>
    </a>`;
  }

  function sectionHtml(id, title, sub) {
    return `<section class="section an-rail" id="${id}">
      <header class="section__head">
        <div>
          <h2 class="section__title">${title}</h2>
          ${sub ? `<div class="section__sub">${sub}</div>` : ''}
        </div>
      </header>
      ${skRail()}
    </section>`;
  }

  // ── Topnav auto-hide ──────────────────────────────────────────────────────
  function initTopnavAutoHide() {
    if (window.__anTopnavWired) return;
    window.__anTopnavWired = true;
    const nav = document.querySelector('.topnav');
    if (!nav) return;
    let last = window.scrollY, ticking = false, idleTimer = null;
    function update() {
      const y = window.scrollY;
      const delta = y - last;
      if (y < 30) { nav.classList.remove('an-nav-hidden'); nav.classList.remove('an-nav-solid'); }
      else { nav.classList.add('an-nav-solid'); }
      if (Math.abs(delta) > 5) {
        if (delta > 0 && y > 80) nav.classList.add('an-nav-hidden');
        else nav.classList.remove('an-nav-hidden');
        last = y;
      }
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => nav.classList.remove('an-nav-hidden'), 1200);
      ticking = false;
    }
    window.addEventListener('scroll', () => {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    update();
  }
  initTopnavAutoHide();

  // ── Paint helpers ─────────────────────────────────────────────────────────
  function paintRailFromItems(view, selector, items) {
    const sec = view.querySelector(selector);
    if (!sec) return;
    const rail = sec.querySelector('.rail');
    if (!rail) return;
    if (!items?.length) {
      rail.outerHTML = '<p class="an-empty">No titles found.</p>';
      return;
    }
    rail.innerHTML = `<div class="rail__strip">${items.map(animeCard).join('')}</div>`;
  }

  function paintHero(view, items) {
    const filtered = items.filter(m => m.background_image || m.poster).slice(0, 5);
    if (!filtered.length) return;

    const slides = filtered.map((m, i) => {
      const bg = m.background_image || m.poster;
      const hasBanner = !!m.background_image;
      const title = m.title || m.native || 'Unknown';
      const desc = (m.description || '').replace(/<[^>]+>/g, '').split('. ')[0].slice(0, 200);
      const genres = m.terms_by_type?.genre || [];

      return `<div class="hero__slide ${i === 0 ? 'active' : ''}" data-i="${i}" data-bg-type="${hasBanner ? 'banner' : 'cover'}">
        <div class="hero__backdrop" style="background-image:url(${bg})"></div>
        <div class="hero__scrim"></div>
        <div class="hero__content">
          <span class="eyebrow"><span class="dot"></span> Featured · Anime</span>
          <h1 class="hero__title">${html(title)}</h1>
          <div class="hero__meta">
            ${m.rating && m.rating !== 'N/A' ? `<span class="score"><i class="ri-star-fill"></i> ${html(m.rating)}</span><span class="dot"></span>` : ''}
            <span>${m.year || ''}</span>
            ${genres.length ? `<span class="dot"></span><span class="mono">${html(genres.slice(0, 3).join(' · ')).toUpperCase()}</span>` : ''}
          </div>
          <p class="hero__synopsis">${html(desc)}${desc.length >= 200 ? '…' : ''}</p>
          <div class="hero__actions">
            <a class="btn-primary" href="/anime-title/${m.id}" data-link><i class="ri-play-fill"></i> Watch now</a>
            <a class="btn-ghost" href="/anime-title/${m.id}" data-link><i class="ri-information-line"></i> More info</a>
          </div>
        </div>
      </div>`;
    }).join('');

    const dots = filtered.length > 1
      ? `<div class="hero__dots">${filtered.map((_, i) => `<button class="${i === 0 ? 'active' : ''}" aria-label="Slide ${i + 1}"></button>`).join('')}</div>` : '';

    const heroHtml = `<section class="hero hero--anime">${slides}${dots}</section>`;
    const old = view.querySelector('.hero');
    if (old) old.outerHTML = heroHtml;
    else view.insertAdjacentHTML('afterbegin', heroHtml);

    wireHeroSlider(view.querySelector('.hero'), filtered);
  }

  function wireHeroSlider(wrap, items) {
    if (!wrap || items.length < 2) return;
    const slides = wrap.querySelectorAll('.hero__slide');
    const dots = wrap.querySelector('.hero__dots');
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
      dots.querySelectorAll('button').forEach((d, i) =>
        d.addEventListener('click', () => { setSlide(i); startTimer(); }));
    }

    let sx = 0, tracking = false;
    wrap.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || e.target.closest('button, a')) return;
      sx = e.clientX; tracking = true;
    }, { passive: true });
    wrap.addEventListener('pointerup', (e) => {
      if (!tracking) return;
      tracking = false;
      const dx = e.clientX - sx;
      if (Math.abs(dx) > 50) { setSlide(idx + (dx < 0 ? 1 : -1)); startTimer(); }
    }, { passive: true });
    wrap.addEventListener('pointercancel', () => { tracking = false; }, { passive: true });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  renderPage — Anime home (browse rails + grid)
  // ═══════════════════════════════════════════════════════════════════════════
  async function renderPage(view) {
    view.innerHTML = `
      ${skHero()}
      ${sectionHtml('an-latest', 'Latest <em>updates</em>', 'Recently updated anime.')}
      ${sectionHtml('an-airing', 'Currently <em>airing</em>', 'Shows airing this season.')}
      <section class="section" id="an-browse">
        <header class="section__head">
          <div>
            <h2 class="section__title">Browse <em>anime</em></h2>
            <div class="section__sub">Explore the full Anikoto catalogue.</div>
          </div>
        </header>
        <div class="browse-grid" id="anBrowseGrid">${Array.from({ length: 18 }, skCard).join('')}</div>
        <div class="an-load-more"><button class="btn-ghost" id="anLoadMore"><i class="ri-add-line"></i> Load more</button></div>
      </section>
    `;

    try {
      const res = await anikoto(`/recent-anime?page=1&per_page=${PER_PAGE}`);
      const items = res.data || [];

      paintHero(view, items);
      paintRailFromItems(view, '#an-latest', items);

      const airing = items.filter(i => i.status === 'Currently Airing');
      paintRailFromItems(view, '#an-airing', airing.length ? airing : items.slice(0, 10));
    } catch (e) {
      console.error('[Anikoto] Failed to load home data', e);
      const hero = view.querySelector('.hero');
      if (hero) hero.outerHTML = '';
      const sec = view.querySelector('#an-latest');
      if (sec) sec.innerHTML = `<p class="an-empty">Couldn't load anime. ${html(e.message)}</p>`;
    }

    setupBrowseGrid(view);
  }

  function setupBrowseGrid(view) {
    const grid = view.querySelector('#anBrowseGrid');
    const loadBtn = view.querySelector('#anLoadMore');
    let page = 1, loading = false, hasMore = true;

    async function load() {
      if (loading || !hasMore) return;
      loading = true;
      if (loadBtn) loadBtn.disabled = true;
      try {
        const res = await anikoto(`/recent-anime?page=${page}&per_page=${PER_PAGE}`);
        const items = res.data || [];
        if (page === 1) grid.innerHTML = '';
        grid.insertAdjacentHTML('beforeend', items.map(animeCard).join(''));
        hasMore = res.pagination ? page < res.pagination.total_pages : items.length >= PER_PAGE;
        page++;
      } catch (e) {
        if (page === 1) grid.innerHTML = `<p class="an-empty">Failed to load. ${html(e.message)}</p>`;
      }
      loading = false;
      if (loadBtn) { loadBtn.disabled = false; loadBtn.style.display = hasMore ? '' : 'none'; }
    }

    loadBtn?.addEventListener('click', load);
    load();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  renderAnimeTitle — Series detail (/anime-title/{NUMERIC_ID})
  // ═══════════════════════════════════════════════════════════════════════════
  async function renderAnimeTitle(id) {
    const view = $('#view');

    view.innerHTML = `
      <section class="watch-page" style="max-width:1100px;margin:0 auto;padding:20px 16px">
        <div class="watch-page__bar">
          <button class="icon-btn" onclick="history.length>1 ? history.back() : OMNIFLIX.go('/anime')"><i class="ri-arrow-left-line"></i></button>
          <div class="watch-page__crumb"><div class="sk sk--line sk--meta" style="width:240px"></div></div>
        </div>
        <div style="margin-top:24px">
          <div class="sk sk--line sk--title-xl" style="width:60%"></div>
          <div class="sk sk--line sk--meta" style="width:40%;margin-top:12px"></div>
          <div class="sk sk--line sk--meta" style="margin-top:8px"></div>
          <div class="sk sk--line sk--meta" style="width:90%;margin-top:8px"></div>
        </div>
      </section>
    `;

    try {
      const res = await anikoto(`/series/${encodeURIComponent(id)}`);
      const payload  = res.data || {};
      const data     = payload.anime || {};
      const episodes = Array.isArray(payload.episodes) ? payload.episodes : [];

      const title   = data.title || data.native || 'Unknown';
      const poster  = data.poster || '';
      const banner  = data.background_image || poster;
      const desc    = (data.description || '').replace(/<[^>]+>/g, '');
      const year    = data.year || '';
      const status  = data.status || '';
      const rating  = data.rating && data.rating !== 'N/A' ? data.rating : '';
      const genres  = data.terms_by_type?.genre || [];
      const studios = data.terms_by_type?.studios || [];
      const hasSub  = data.is_sub && data.is_sub > 0;
      const hasDub  = data.is_dub && data.is_dub > 0;

      view.innerHTML = `
        <div class="anime-detail">
          <div class="anime-detail__banner" style="background-image:url(${banner})">
            <div class="anime-detail__banner-scrim"></div>
          </div>

          <section class="anime-detail__body">
            <div class="anime-detail__top">
              ${poster ? `<img class="anime-detail__poster" src="${poster}" alt="${html(title)}">` : ''}
              <div class="anime-detail__info">
                <button class="icon-btn anime-detail__back" onclick="history.length>1 ? history.back() : OMNIFLIX.go('/anime')"><i class="ri-arrow-left-line"></i></button>
                <h1 class="anime-detail__title">${html(title)}</h1>
                ${data.alternative ? `<div class="anime-detail__alt">${html(data.alternative)}</div>` : ''}
                <div class="anime-detail__meta">
                  ${year ? `<span>${year}</span><span class="dot"></span>` : ''}
                  ${status ? `<span class="mono">${html(status).toUpperCase()}</span>` : ''}
                  ${rating ? `<span class="dot"></span><span style="color:var(--accent)"><i class="ri-star-fill"></i> ${html(rating)}</span>` : ''}
                  ${hasSub ? '<span class="dot"></span><span class="chip chip--sm">SUB</span>' : ''}
                  ${hasDub ? '<span class="chip chip--sm" style="margin-left:4px">DUB</span>' : ''}
                </div>
                ${genres.length ? `<div class="anime-detail__genres">${genres.map(g => `<span class="chip">${html(g)}</span>`).join('')}</div>` : ''}
                ${studios.length ? `<div class="anime-detail__studios" style="margin-top:6px;color:var(--text-dim);font-size:13px">Studio: ${html(studios.join(', '))}</div>` : ''}
                ${desc ? `<p class="anime-detail__desc">${html(desc)}</p>` : ''}
              </div>
            </div>

            <div class="anime-detail__episodes">
              <h2 class="section__title" style="margin-bottom:16px">Episodes <em>(${episodes.length})</em></h2>

              ${hasSub && hasDub ? `
              <div class="anime-detail__lang-toggle" style="margin-bottom:16px">
                <button class="chip ${DEF_LANG === 'sub' ? 'active' : ''}" data-lang="sub">SUB</button>
                <button class="chip ${DEF_LANG === 'dub' ? 'active' : ''}" data-lang="dub">DUB</button>
              </div>` : ''}

              <div class="anime-detail__ep-grid" id="anEpGrid">
                ${episodes.length
                  ? episodes.map((ep) => {
                    const epNum   = ep.number;
                    const epTitle = ep.title || `Episode ${epNum}`;
                    const embedId = ep.episode_embed_id || '';
                    const lang    = DEF_LANG;
                    return `<a class="episode anime-episode" href="/anime-watch/${id}/${embedId}/${lang}" data-link
                               data-embed-id="${embedId}" data-ep-num="${epNum}">
                      <div class="episode__thumb">
                        ${poster ? `<img src="${poster}" alt="Ep ${epNum}" loading="lazy">` : ''}
                        <div class="episode__play"><i class="ri-play-circle-fill"></i></div>
                      </div>
                      <div class="episode__body">
                        <div class="episode__number">E${epNum}</div>
                        <div class="episode__title">${html(epTitle)}</div>
                      </div>
                    </a>`;
                  }).join('')
                  : '<p class="an-empty">No episodes available yet.</p>'
                }
              </div>
            </div>
          </section>
        </div>
      `;

      // Language toggle — rewrite episode hrefs
      const langBtns = view.querySelectorAll('.anime-detail__lang-toggle .chip');
      langBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          langBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const lang = btn.dataset.lang;
          view.querySelectorAll('.anime-episode').forEach(a => {
            a.setAttribute('href', `/anime-watch/${id}/${a.dataset.embedId}/${lang}`);
          });
        });
      });

    } catch (err) {
      console.error('[Anikoto] Series load failed', err);
      view.innerHTML = `
        <section style="padding:60px 20px;text-align:center">
          <h2 style="color:var(--text)">Couldn't load this anime</h2>
          <p style="color:var(--text-dim);margin-top:8px">${html(err.message)}</p>
          <a class="btn-ghost" href="/anime" data-link style="margin-top:20px"><i class="ri-arrow-left-line"></i> Back to anime</a>
        </section>
      `;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  renderAnimeWatch — Episode player (/anime-watch/{ID}/{embedId}/{lang})
  // ═══════════════════════════════════════════════════════════════════════════
  async function renderAnimeWatch(id, embedId, language) {
    const lang = language || DEF_LANG;
    const view = $('#view');
    const streamUrl = `${MEGAPLAY}/stream/s-2/${embedId}/${lang}`;

    view.innerHTML = `
      <section class="watch-page">
        <div class="watch-page__bar">
          <button class="icon-btn" onclick="history.length>1 ? history.back() : OMNIFLIX.go('/anime-title/${html(id)}')"><i class="ri-arrow-left-line"></i></button>
          <div class="watch-page__crumb"><div class="sk sk--line sk--meta" style="width:240px"></div></div>
          <div class="anime-watch__lang-btns">
            <button class="chip ${lang === 'sub' ? 'active' : ''}" data-lang="sub">SUB</button>
            <button class="chip ${lang === 'dub' ? 'active' : ''}" data-lang="dub">DUB</button>
          </div>
        </div>
        <div class="anime-watch__player">
          <iframe src="${streamUrl}" width="100%" height="100%" frameborder="0" scrolling="no"
                  allowfullscreen allow="autoplay; encrypted-media; fullscreen"></iframe>
        </div>
        <div class="watch-page__info" style="padding:16px">
          <div class="sk sk--line sk--title-xl" style="width:50%"></div>
          <div class="sk sk--line sk--meta" style="width:30%;margin-top:8px"></div>
        </div>
        <div class="anime-watch__episodes">
          <h3 class="section__title" style="padding:0 16px;margin-bottom:12px">Episodes</h3>
          <div class="anime-watch__ep-list" id="anWatchEpList">
            ${Array.from({ length: 6 }, skCard).join('')}
          </div>
        </div>
      </section>
    `;

    // Sub/dub toggle navigates to same episode in other language
    view.querySelectorAll('.anime-watch__lang-btns .chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const newLang = btn.dataset.lang;
        if (newLang !== lang && global.OMNIFLIX?.go) {
          global.OMNIFLIX.go(`/anime-watch/${id}/${embedId}/${newLang}`);
        }
      });
    });

    // MegaPlay postMessage — auto-next + progress
    const msgHandler = function (event) {
      let data = event.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (e) { return; }
      }
      if (!data || typeof data !== 'object') return;

      if (data.event === 'complete') {
        const nextLink = view.querySelector('.anime-episode.is-next');
        if (nextLink) { toast('Loading next episode…'); nextLink.click(); }
      }
      if (data.event === 'time' || data.type === 'watching-log') {
        try {
          const store = JSON.parse(localStorage.getItem('animeWatchProgress') || '{}');
          store[embedId] = {
            time: data.time || data.currentTime || 0,
            duration: data.duration || 0,
            percent: data.percent || 0,
            id, lang, ts: Date.now()
          };
          localStorage.setItem('animeWatchProgress', JSON.stringify(store));
        } catch (_) {}
      }
    };
    window.addEventListener('message', msgHandler);
    const observer = new MutationObserver(() => {
      if (!view.querySelector('.anime-watch__player')) {
        window.removeEventListener('message', msgHandler);
        observer.disconnect();
      }
    });
    observer.observe(view, { childList: true });

    // Load series data for title + episode list
    try {
      const res = await anikoto(`/series/${encodeURIComponent(id)}`);
      const payload  = res.data || {};
      const data     = payload.anime || {};
      const episodes = Array.isArray(payload.episodes) ? payload.episodes : [];
      const title    = data.title || data.native || 'Unknown';

      const currentIdx = episodes.findIndex(ep => String(ep.episode_embed_id) === String(embedId));
      const currentEp  = currentIdx >= 0 ? episodes[currentIdx] : null;
      const epNum      = currentEp ? currentEp.number : '?';

      const crumb = view.querySelector('.watch-page__crumb');
      if (crumb) {
        crumb.innerHTML = `<span>Anime</span><span class="sep">·</span><b>${html(title)}</b><span class="sep">·</span><span>Episode ${epNum}</span>`;
      }

      const infoBlock = view.querySelector('.watch-page__info');
      if (infoBlock) {
        infoBlock.innerHTML = `
          <h1 class="watch-page__title">${html(title)} — <em>Episode ${epNum}</em></h1>
          ${currentEp?.title ? `<div class="serif" style="font-style:italic;color:var(--text-dim);font-size:18px;margin-top:4px">${html(currentEp.title)}</div>` : ''}
          <a class="btn-ghost" href="/anime-title/${id}" data-link style="margin-top:12px"><i class="ri-information-line"></i> Series details</a>
        `;
      }

      const epListEl = view.querySelector('#anWatchEpList');
      if (epListEl && episodes.length) {
        epListEl.innerHTML = episodes.map((ep, i) => {
          const num = ep.number;
          const eId = ep.episode_embed_id || '';
          const isCurrent = String(eId) === String(embedId);
          const isNext = i === currentIdx + 1;
          const epTitle = ep.title || `Episode ${num}`;
          return `<a class="anime-episode episode ${isCurrent ? 'is-playing' : ''} ${isNext ? 'is-next' : ''}"
                     href="/anime-watch/${id}/${eId}/${lang}" data-link data-embed-id="${eId}">
            <div class="episode__body" style="padding:8px 12px">
              <div class="episode__number" style="${isCurrent ? 'color:var(--accent)' : ''}">
                ${isCurrent ? '<i class="ri-play-fill"></i> ' : ''}E${num}
              </div>
              <div class="episode__title">${html(epTitle)}</div>
            </div>
          </a>`;
        }).join('');

        const playing = epListEl.querySelector('.is-playing');
        if (playing) playing.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else if (epListEl) {
        epListEl.innerHTML = '<p class="an-empty">No episode list available.</p>';
      }

    } catch (err) {
      console.error('[Anikoto] Series data load failed for watch page', err);
      const infoBlock = view.querySelector('.watch-page__info');
      if (infoBlock) {
        infoBlock.innerHTML = `<p style="color:var(--text-dim)">Could not load series info.</p>
          <a class="btn-ghost" href="/anime" data-link><i class="ri-arrow-left-line"></i> Back to anime</a>`;
      }
    }
  }

  // ── Expose ────────────────────────────────────────────────────────────────
  global.AnikotoModule = { renderPage, renderAnimeTitle, renderAnimeWatch };
  global.AniListModule = { renderPage };  // back-compat

})(window);
