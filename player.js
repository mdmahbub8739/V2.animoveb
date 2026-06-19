/* ========================================================================= *
 * OmniFlix · Stellar Player                                                 *
 * Drop-in multi-source video embed without auto-fallback.                  *
 * * Public, source-agnostic API: * player.playMovie(tmdbId) * player.playEpisode(tmdbId, season, episode) * player.next() // manually jump to next source * player.setSource(index) // force a specific source * player.listSources() // [{ index, name }] * player.currentSourceName() * * Sources are exposed to the UI under majestic constellation names ONLY. * No provider domain is leaked through any public surface. * ========================================================================= */
(function(global) {
  'use strict';

  // ── Provider origins (used only internally) ────────────────────────────────
  const O_SS = 'https://screenscape.me'; // ScreenScape (Primary)
  const O_A = 'https://web.nxsha.app';   // Aurora / Halo / Orion / Vega
  const O_B = 'https://cinemaos.tech';   // Nebula
  const O_C = 'https://peachify.top';    // Eclipse / Lumen / Solstice
  const O_VR = 'https://vidrock.ru';     // Stellar (VidRock)

  const TRUSTED_ORIGINS = [O_SS, O_A, O_B, O_C, O_VR];
  const PROGRESS_STORAGE_KEY = 'peachifyProgress'; // kept for cross-source resume

  // ── helpers ────────────────────────────────────────────────────────────────
  function validId(id) {
    if (id == null) return false;
    if (typeof id === 'number') return Number.isFinite(id) && id > 0;
    if (typeof id !== 'string') return false;
    if (/^\d+$/.test(id)) return true;
    if (/^tt\d{6,}$/.test(id)) return true;
    return false;
  }

  function readProgressStore() {
    try {
      return JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY) || '{}');
    } catch (_) {
      return {};
    }
  }

  function writeProgressStore(store) {
    try {
      localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(store));
    } catch (_) {}
  }

  function resumeFor(ctx) {
    const store = readProgressStore();
    const rec = store[String(ctx.id)];
    if (!rec) return 0;
    if (ctx.type === 'tv') {
      const key = `s${ctx.season}e${ctx.episode}`;
      const ep = rec.show_progress && rec.show_progress[key];
      return ep && ep.progress ? Math.floor(ep.progress.watched || 0) : 0;
    }
    return rec.progress ? Math.floor(rec.progress.watched || 0) : 0;
  }

  // ── URL builders ───────────────────────────────────────────────────────────
  function buildScreenscapeUrl(ctx, opts = {}) {
    const p = new URLSearchParams();
    
    // Automatically determine whether to use tmdb or imdb parameter
    if (typeof ctx.id === 'string' && /^tt\d+/.test(ctx.id)) {
      p.set('imdb', ctx.id);
    } else {
      p.set('tmdb', String(ctx.id));
    }
    
    p.set('type', ctx.type);
    
    if (ctx.type === 'tv') {
      if (ctx.season != null) p.set('s', String(ctx.season));
      if (ctx.episode != null) p.set('e', String(ctx.episode));
    }
    
    // Enforce default language preference to Hindi as requested
    p.set('lan', opts.lan || 'hindi');
    
    return `${O_SS}/embed?${p.toString()}`;
  }

  function buildVidrockUrl(ctx /*, opts */ ) {
    const path = ctx.type === 'tv' ? `/tv/${ctx.id}/${ctx.season}/${ctx.episode}` : `/movie/${ctx.id}`;
    return `${O_VR}${path}`;
  }

  function buildAuroraUrl(ctx, opts = {}) {
    const path = ctx.type === 'tv' ? `/embed/tv/${ctx.id}/${ctx.season}/${ctx.episode}` : `/embed/movie/${ctx.id}`;
    const p = new URLSearchParams();
    if (opts.lang) p.set('lang', opts.lang);
    if (opts.sub) p.set('sub', opts.sub);
    if (opts.server) p.set('server', opts.server);
    p.set('one_server', 'true');
    const qs = p.toString();
    return `${O_A}${path}${qs ? '?' + qs : ''}`;
  }

  function buildNebulaUrl(ctx, opts = {}) {
    const path = ctx.type === 'tv' ? `/player/${ctx.id}/${ctx.season}/${ctx.episode}` : `/player/${ctx.id}`;
    const p = new URLSearchParams();
    if (opts.accent) p.set('theme', String(opts.accent).replace('#', ''));
    if (opts.autoPlay !== false) p.set('autoPlay', 'true');
    p.set('title', 'false');
    p.set('poster', 'false');
    if (ctx.type === 'tv') {
      if (opts.autoNext != null) p.set('autoNext', String(opts.autoNext));
      if (opts.showNextBtn === false) p.set('nextButton', 'false');
    }
    const startAt = opts.startAt != null ? opts.startAt : resumeFor(ctx);
    if (startAt && startAt > 5) p.set('startTime', Math.floor(startAt));
    return `${O_B}${path}?${p.toString()}`;
  }

  function buildPeachifyUrl(ctx, opts = {}) {
    const path = ctx.type === 'tv' ? `/embed/tv/${ctx.id}/${ctx.season}/${ctx.episode}` : `/embed/movie/${ctx.id}`;
    const p = new URLSearchParams();
    if (opts.dub) p.set('dub', opts.dub);
    if (opts.audio) p.set('audio', opts.audio);
    if (opts.sub) p.set('sub', opts.sub);
    if (opts.subtitle) p.set('subtitle', opts.subtitle);
    if (opts.quality) p.set('quality', String(opts.quality));
    if (opts.server) p.set('server', opts.server);
    if (opts.api) p.set('api', opts.api);
    if (opts.accent) p.set('accent', String(opts.accent).replace('#', ''));
    if (opts.autoPlay === false) p.set('autoPlay', 'false');
    if (ctx.type === 'tv') {
      if (opts.autoNext != null) p.set('autoNext', String(opts.autoNext));
      if (opts.showNextBtn === false) p.set('showNextBtn', 'false');
    }
    const startAt = opts.startAt != null ? opts.startAt : resumeFor(ctx);
    if (startAt && startAt > 5) p.set('startAt', Math.floor(startAt));

    const isHide = (v) => v === false || v === 0 || v === 'false' || v === '0' || v === 'off' || v === 'hide';
    const hideKeys = ['pip', 'cast', 'fullscreen', 'volume', 'servers', 'captions', 'quality', 'play', 'rewind', 'forward', 'timegroup', 'timeslider', 'settings'];
    if (opts.hide && typeof opts.hide === 'object') {
      hideKeys.forEach(k => {
        if (isHide(opts.hide[k])) p.set(k, 'hide');
      });
    }
    const qs = p.toString();
    return `${O_C}${path}${qs ? '?' + qs : ''}`;
  }

  // ── Server list (ScreenScape configured as Primary) ────────────────────────
  function defaultChain() {
    return [
       { name: 'Lumen-Hindi', kind: 'peachify', opts: { dub: 'Hindi' } },
      { name: 'ScreenScape', kind: 'screenscape', opts: { lan: 'hindi' } },
      { name: 'Aurora-Hindi', kind: 'aurora', opts: { lang: 'hi' } },
     
      { name: 'Nebula', kind: 'nebula', opts: {} },
      { name: 'Orion-Hindi', kind: 'aurora', opts: { server: 'ZetPly-[Multi-Lang]', lang: 'hi' } },
      { name: 'Stellar', kind: 'vidrock', opts: {} },
      { name: 'Eclipse', kind: 'peachify', opts: { dub: 'Hindi' } },
      { name: 'Solstice', kind: 'peachify', opts: { dub: 'Hindi' } },
      { name: 'Halo', kind: 'aurora', opts: { server: 'MbPly-[Multi-Lang]', lang: 'hi' } },
      { name: 'OrVid', kind: 'aurora', opts: { server: 'OrVid-[Multi-Lang]', lang: 'hi' } },
      { name: 'Vega', kind: 'aurora', opts: { server: 'Xuhd-[Multi-Lang]', lang: 'hi' } }
    ];
  }

  // ── main class ─────────────────────────────────────────────────────────────
  class StellarPlayer {
    constructor(target, options = {}) {
      this.host = (typeof target === 'string') ? document.querySelector(target) : target;
      if (!this.host) throw new Error('StellarPlayer: target element not found');

      this.opts = Object.assign({
        accent: null,
        autoPlay: true,
        autoNext: true,
        showNextBtn: true,
        hide: null,
        servers: defaultChain(),
        onEvent: null,
        onProgress: null,
        onSourceChange: null,
        onLoading: null
      }, options || {});

      this.ctx = null;
      this.serverIndex = 0;
      this._iframe = null;
      this._installListener();
    }

    // ----- public API --------------------------------------------------------
    playMovie(id, perCallOpts) {
      if (!validId(id)) {
        console.warn('StellarPlayer: invalid id', id);
        return false;
      }
      this.ctx = { type: 'movie', id, _opts: perCallOpts || {} };
      this.serverIndex = 0;
      this._mount();
      return true;
    }

    playEpisode(id, season, episode, perCallOpts) {
      if (!validId(id)) {
        console.warn('StellarPlayer: invalid id', id);
        return false;
      }
      this.ctx = { type: 'tv', id, season, episode, _opts: perCallOpts || {} };
      this.serverIndex = 0;
      this._mount();
      return true;
    }

    next() {
      this._rotate('manual next()');
    }

    setSource(i) {
      if (i < 0 || i >= this.opts.servers.length) return;
      this.serverIndex = i;
      this._mount();
    }

    listSources() {
      return this.opts.servers.map((s, i) => ({ index: i, name: s.name }));
    }

    currentSourceName() {
      const s = this.opts.servers[this.serverIndex];
      return s ? s.name : null;
    }

    destroy() {
      this.host.innerHTML = '';
      this._iframe = null;
      window.removeEventListener('message', this._onMessage);
    }

    // back-compat alias methods
    setServer(i) { return this.setSource(i); }
    listServers() { return this.listSources(); }
    currentServerName() { return this.currentSourceName(); }

    // ----- internals ---------------------------------------------------------
    _mount() {
      if (!this.ctx) return;
      const srv = this.opts.servers[this.serverIndex];
      if (!srv) return;

      const merged = Object.assign({
        accent: this.opts.accent,
        autoPlay: this.opts.autoPlay,
        autoNext: this.opts.autoNext,
        showNextBtn: this.opts.showNextBtn,
        hide: this.opts.hide
      }, srv.opts || {}, this.ctx._opts || {});

      let url;
      if (srv.kind === 'screenscape') url = buildScreenscapeUrl(this.ctx, merged);
      else if (srv.kind === 'vidrock') url = buildVidrockUrl(this.ctx, merged);
      else if (srv.kind === 'aurora') url = buildAuroraUrl(this.ctx, merged);
      else if (srv.kind === 'nebula') url = buildNebulaUrl(this.ctx, merged);
      else url = buildPeachifyUrl(this.ctx, merged);

      // signal loading
      if (typeof this.opts.onLoading === 'function') this.opts.onLoading(true, srv.name);
      if (typeof this.opts.onSourceChange === 'function') this.opts.onSourceChange(srv.name, this.serverIndex);

      // Replace iframe
      this.host.innerHTML = '';
      const ifr = document.createElement('iframe');
      ifr.src = url;
      ifr.style.cssText = 'width:100%;height:100%;border:0;display:block;background:#000;';
      ifr.setAttribute('allowfullscreen', '');
      ifr.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write');
      ifr.setAttribute('referrerpolicy', 'origin');
      ifr.setAttribute('loading', 'eager');
      this._iframe = ifr;
      this.host.appendChild(ifr);
    }

    _rotate(reason) {
      const next = this.serverIndex + 1;
      if (next >= this.opts.servers.length) {
        console.warn('[StellarPlayer] All sources exhausted —', reason);
        if (typeof this.opts.onLoading === 'function') {
          this.opts.onLoading(false, this.currentSourceName(), 'exhausted');
        }
        return;
      }
      this.serverIndex = next;
      const name = this.opts.servers[next].name;
      console.info('[StellarPlayer] Manually switching to', name, '—', reason);
      this._mount();
    }

    _installListener() {
      this._onMessage = (event) => {
        if (!TRUSTED_ORIGINS.includes(event.origin)) return;
        const msg = event.data;
        if (!msg || typeof msg !== 'object') return;

        // Core platform sync data
        if (msg.type === 'MEDIA_DATA' && msg.data) {
          const store = readProgressStore();
          if (Array.isArray(msg.data)) {
            msg.data.forEach((rec) => {
              if (!rec || rec.id == null) return;
              store[String(rec.id)] = rec;
            });
          } else {
            Object.keys(msg.data).forEach(k => {
              const rec = msg.data[k];
              if (!rec) return;
              const key = rec.id != null ? String(rec.id) : String(k).replace(/^m/, '');
              store[key] = rec;
            });
          }
          writeProgressStore(store);
          try {
            localStorage.setItem('vidRockProgress', JSON.stringify(Object.values(store)));
          } catch (_) {}
          if (typeof this.opts.onProgress === 'function') this.opts.onProgress(store);
        }

        if (msg.type === 'PLAYER_EVENT' && msg.data) {
          if (typeof this.opts.onLoading === 'function') this.opts.onLoading(false, this.currentSourceName());
          if (typeof this.opts.onEvent === 'function') this.opts.onEvent(msg.data);
          const ev = msg.data.event;
          if (ev === 'error' || ev === 'no_sources' || ev === 'sources_failed') {
            console.warn('[StellarPlayer] Source reported error. Auto-switching disabled: ' + ev);
          }
        }
      };
      window.addEventListener('message', this._onMessage);
    }
  }

  // Expose
  StellarPlayer.defaultChain = defaultChain;
  global.StellarPlayer = StellarPlayer;
  global.PeachifyPlayer = StellarPlayer; // Back-compat alias
})(typeof window !== 'undefined' ? window : globalThis);
