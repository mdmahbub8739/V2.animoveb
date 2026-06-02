/* =========================================================================
 * OmniFlix · Stellar Player  (v2 — ScreenScape Primary Edition)
 * Drop-in multi-source video embed without auto-fallback.
 *
 * Public API:
 *  player.playMovie(tmdbId [, perCallOpts])
 *  player.playEpisode(tmdbId, season, episode [, perCallOpts])
 *  player.next()                    – manually jump to next source
 *  player.setSource(index)          – force a specific source
 *  player.listSources()             – [{ index, name }]
 *  player.currentSourceName()
 *  player.setLanguage(lang)         – switch language ('hindi' | 'bangla' | 'eng' …)
 *  player.getLanguage()             – current active language string
 *
 *  ScreenScape Progress API (postMessage):
 *  player.ss.getProgress(tmdb [,s, e])   – resolves with progress object
 *  player.ss.setProgress(tmdb, sec [,s,e]) – sets watched position
 *  player.ss.getWatchHistory()           – resolves with history array
 *  player.ss.getAllHistoryDetailed()      – resolves with detailed history
 *
 * Sources are exposed to the UI under majestic constellation names ONLY.
 * No provider domain is leaked through any public surface.
 * =========================================================================
 */
(function (global) {
    'use strict';

    // ── Provider origins (used only internally) ────────────────────────────
    const O_A  = 'https://web.nxsha.app';    // Aurora / Halo / Orion / Vega
    const O_B  = 'https://cinemaos.tech';    // Nebula
    const O_C  = 'https://peachify.top';     // Eclipse / Lumen
    const O_VR = 'https://vidrock.ru';       // Stellar (VidRock)
    const O_SS = 'https://screenscape.me';   // ScreenScape ★ PRIMARY

    const TRUSTED_ORIGINS    = [O_SS, O_A, O_B, O_C, O_VR];
    const PROGRESS_STORAGE_KEY = 'stellarProgress';

    // ── Supported languages ────────────────────────────────────────────────
    // Canonical internal token → per-provider representations
    const LANG_MAP = {
        hindi:  { aurora: 'hi',      peachify: 'Hindi',   screenscape: 'hindi',  label: 'Hindi'   },
        bangla: { aurora: 'bn',      peachify: 'Bengali', screenscape: 'bengali',label: 'Bangla'  },
        eng:    { aurora: 'en',      peachify: 'English', screenscape: 'eng',    label: 'English' },
        tamil:  { aurora: 'ta',      peachify: 'Tamil',   screenscape: 'tamil',  label: 'Tamil'   },
        telugu: { aurora: 'te',      peachify: 'Telugu',  screenscape: 'telugu', label: 'Telugu'  },
    };

    // Normalise any raw lang value to a canonical token
    function canonicalLang(raw) {
        const s = String(raw || 'hindi').toLowerCase().trim();
        if (s === 'hindi' || s === 'hi' || s.includes('hin')) return 'hindi';
        if (s === 'bangla' || s === 'bengali' || s === 'bn' || s.includes('ben') || s.includes('ban')) return 'bangla';
        if (s === 'eng'  || s === 'en'  || s === 'english') return 'eng';
        if (s === 'tamil'|| s === 'ta')  return 'tamil';
        if (s === 'telugu'||s === 'te')  return 'telugu';
        return s; // pass-through for unlisted langs
    }

    function getCleanLang(kind, canonical) {
        const entry = LANG_MAP[canonical];
        if (!entry) return canonical; // unknown lang – pass raw
        return entry[kind] || canonical;
    }

    // ── Local progress store helpers ───────────────────────────────────────
    function readProgressStore() {
        try { return JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY) || '{}'); }
        catch (_) { return {}; }
    }
    function writeProgressStore(store) {
        try { localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(store)); }
        catch (_) {}
    }
    function resumeFor(ctx) {
        const store = readProgressStore();
        const rec   = store[String(ctx.id)];
        if (!rec) return 0;
        if (ctx.type === 'tv') {
            const key = `s${ctx.season}e${ctx.episode}`;
            const ep  = rec.show_progress && rec.show_progress[key];
            return ep && ep.progress ? Math.floor(ep.progress.watched || 0) : 0;
        }
        return rec.progress ? Math.floor(rec.progress.watched || 0) : 0;
    }

    // ── URL builders ───────────────────────────────────────────────────────

    /** ScreenScape — primary source */
    function buildScreenscapeUrl(ctx, langCanonical) {
        const p = new URLSearchParams();
        if (typeof ctx.id === 'string' && ctx.id.startsWith('tt')) {
            p.set('imdb', ctx.id);
        } else {
            p.set('tmdb', ctx.id);
        }
        p.set('type', ctx.type);
        if (ctx.type === 'tv') {
            p.set('s', ctx.season);
            p.set('e', ctx.episode);
        }
        p.set('lan', getCleanLang('screenscape', langCanonical));
        return `${O_SS}/embed?${p.toString()}`;
    }

    function buildVidrockUrl(ctx) {
        const path = ctx.type === 'tv'
            ? `/tv/${ctx.id}/${ctx.season}/${ctx.episode}`
            : `/movie/${ctx.id}`;
        return `${O_VR}${path}`;
    }

    function buildAuroraUrl(ctx, langCanonical, extraOpts = {}) {
        const path = ctx.type === 'tv'
            ? `/embed/tv/${ctx.id}/${ctx.season}/${ctx.episode}`
            : `/embed/movie/${ctx.id}`;
        const p = new URLSearchParams();
        p.set('lang', getCleanLang('aurora', langCanonical));
        if (extraOpts.sub)    p.set('sub', extraOpts.sub);
        if (extraOpts.server) p.set('server', extraOpts.server);
        p.set('one_server', 'true');
        return `${O_A}${path}?${p.toString()}`;
    }

    function buildNebulaUrl(ctx, extraOpts = {}) {
        const path = ctx.type === 'tv'
            ? `/player/${ctx.id}/${ctx.season}/${ctx.episode}`
            : `/player/${ctx.id}`;
        const p = new URLSearchParams();
        if (extraOpts.accent) p.set('theme', String(extraOpts.accent).replace('#', ''));
        p.set('autoPlay', 'true');
        p.set('title', 'false');
        p.set('poster', 'false');
        if (ctx.type === 'tv' && extraOpts.autoNext != null) p.set('autoNext', String(extraOpts.autoNext));
        const startAt = resumeFor(ctx);
        if (startAt > 5) p.set('startTime', Math.floor(startAt));
        return `${O_B}${path}?${p.toString()}`;
    }

    function buildPeachifyUrl(ctx, langCanonical, extraOpts = {}) {
        const path = ctx.type === 'tv'
            ? `/embed/tv/${ctx.id}/${ctx.season}/${ctx.episode}`
            : `/embed/movie/${ctx.id}`;
        const p = new URLSearchParams();
        p.set('dub', getCleanLang('peachify', langCanonical));
        if (extraOpts.sub)      p.set('sub', extraOpts.sub);
        if (extraOpts.quality)  p.set('quality', String(extraOpts.quality));
        if (extraOpts.server)   p.set('server', extraOpts.server);
        if (extraOpts.accent)   p.set('accent',  String(extraOpts.accent).replace('#', ''));
        if (ctx.type === 'tv' && extraOpts.autoNext != null) p.set('autoNext', String(extraOpts.autoNext));
        const startAt = resumeFor(ctx);
        if (startAt > 5) p.set('startAt', Math.floor(startAt));
        return `${O_C}${path}?${p.toString()}`;
    }

    // ── Default server chain — ScreenScape FIRST ──────────────────────────
    function defaultChain() {
        return [
            // ★ PRIMARY — ScreenScape (Hindi default, Bangla-switchable)
            { name: 'ScreenScape',   kind: 'screenscape', opts: {} },

            // Fallbacks in preferred order
            { name: 'Aurora',        kind: 'aurora',      opts: {} },
            { name: 'Lumen',         kind: 'peachify',    opts: {} },
            { name: 'Nebula',        kind: 'nebula',      opts: {} },
            { name: 'Orion',         kind: 'aurora',      opts: { server: 'ZetPly-[Multi-Lang]' } },
            { name: 'Stellar',       kind: 'vidrock',     opts: {} },
            { name: 'Eclipse',       kind: 'peachify',    opts: {} },
            { name: 'Halo',          kind: 'aurora',      opts: { server: 'MbPly-[Multi-Lang]'  } },
            { name: 'OrVid',         kind: 'aurora',      opts: { server: 'OrVid-[Multi-Lang]'  } },
            { name: 'Vega',          kind: 'aurora',      opts: { server: 'Xuhd-[Multi-Lang]'   } },
        ];
    }

    // ── ScreenScape postMessage Progress API helper ────────────────────────
    class ScreenScapeAPI {
        constructor(playerRef) {
            this._player  = playerRef;
            this._pending = {};       // requestId → { resolve, reject, timer }
            this._reqSeq  = 0;
        }

        _iframe() { return this._player._iframe; }

        _post(type, extra = {}) {
            return new Promise((resolve, reject) => {
                const iframe = this._iframe();
                if (!iframe || !iframe.contentWindow) {
                    return reject(new Error('[ScreenScapeAPI] No active ScreenScape iframe'));
                }
                const reqId = `ss-req-${++this._reqSeq}`;
                const timer = setTimeout(() => {
                    delete this._pending[reqId];
                    reject(new Error(`[ScreenScapeAPI] Timeout waiting for ${type}`));
                }, 8000);

                this._pending[reqId] = { resolve, reject, timer };
                iframe.contentWindow.postMessage({ type, requestId: reqId, ...extra }, O_SS);
            });
        }

        _dispatch(event) {
            const rid  = event.data && event.data.requestId;
            const pend = rid && this._pending[rid];
            if (!pend) return false;

            clearTimeout(pend.timer);
            delete this._pending[rid];
            pend.resolve(event.data);
            return true;
        }

        /** Get watch progress for a specific title */
        getProgress(tmdb, season, episode) {
            return this._post('SCREENSCAPE_GET_PROGRESS', { tmdb, season, episode });
        }

        /** Set watched position (seconds) */
        setProgress(tmdb, seconds, season, episode) {
            return this._post('SCREENSCAPE_SET_PROGRESS', { tmdb, seconds, season, episode });
        }

        /** Basic watch history */
        getWatchHistory() {
            return this._post('SCREENSCAPE_GET_WATCH_HISTORY');
        }

        /** Watch history with progress */
        getWatchHistoryWithProgress() {
            return this._post('SCREENSCAPE_GET_WATCH_HISTORY_WITH_PROGRESS');
        }

        /** Full detailed history */
        getAllHistoryDetailed() {
            return this._post('SCREENSCAPE_GET_ALL_WATCH_HISTORY_DETAILED');
        }
    }

    // ── Main player class ─────────────────────────────────────────────────
    class StellarPlayer {
        constructor(target, options = {}) {
            this.host = (typeof target === 'string')
                ? document.querySelector(target)
                : target;
            if (!this.host) throw new Error('StellarPlayer: target element not found');

            this.opts = Object.assign({
                accent:        null,
                autoPlay:      true,
                autoNext:      true,
                showNextBtn:   true,
                hide:          null,
                lang:          'hindi',          // ← default language
                servers:       defaultChain(),
                onEvent:       null,
                onProgress:    null,
                onSourceChange:null,
                onLoading:     null,
                onLangChange:  null,
            }, options || {});

            // Normalise initial lang
            this._lang    = canonicalLang(this.opts.lang);

            this.ctx          = null;
            this.serverIndex  = 0;
            this._iframe      = null;

            // ScreenScape Progress API
            this.ss = new ScreenScapeAPI(this);

            this._installListener();
        }

        // ── Public API ─────────────────────────────────────────────────────

        playMovie(id, perCallOpts) {
            if (!validId(id)) { console.warn('StellarPlayer: invalid id', id); return false; }
            this.ctx = { type: 'movie', id, _opts: perCallOpts || {} };
            this.serverIndex = 0;
            this._mount();
            return true;
        }

        playEpisode(id, season, episode, perCallOpts) {
            if (!validId(id)) { console.warn('StellarPlayer: invalid id', id); return false; }
            this.ctx = { type: 'tv', id, season, episode, _opts: perCallOpts || {} };
            this.serverIndex = 0;
            this._mount();
            return true;
        }

        next() { this._rotate('manual next()'); }

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

        /**
         * Switch language on-the-fly and reload current content.
         * @param {string} lang  'hindi' | 'bangla' | 'eng' | 'tamil' | 'telugu' | raw code
         */
        setLanguage(lang) {
            const canon = canonicalLang(lang);
            if (canon === this._lang) return; // no-op
            this._lang = canon;
            if (typeof this.opts.onLangChange === 'function') {
                this.opts.onLangChange(canon, LANG_MAP[canon] ? LANG_MAP[canon].label : canon);
            }
            // Re-mount from current source with new lang
            if (this.ctx) this._mount();
        }

        /** Returns the current canonical language token */
        getLanguage() { return this._lang; }

        /** Returns the human-readable label for the current language */
        getLanguageLabel() {
            const entry = LANG_MAP[this._lang];
            return entry ? entry.label : this._lang;
        }

        /** Returns the list of built-in switchable languages */
        listLanguages() {
            return Object.entries(LANG_MAP).map(([token, v]) => ({ token, label: v.label }));
        }

        destroy() {
            this.host.innerHTML = '';
            this._iframe = null;
            window.removeEventListener('message', this._onMessage);
        }

        // Aliases for backward-compat
        setServer(i)       { return this.setSource(i); }
        listServers()      { return this.listSources(); }
        currentServerName(){ return this.currentSourceName(); }

        // ── Internals ──────────────────────────────────────────────────────

        _mount() {
            if (!this.ctx) return;
            const srv = this.opts.servers[this.serverIndex];
            if (!srv) return;

            const lang    = this._lang;
            const extra   = Object.assign({}, srv.opts || {}, this.ctx._opts || {}, {
                accent:      this.opts.accent,
                autoPlay:    this.opts.autoPlay,
                autoNext:    this.opts.autoNext,
                showNextBtn: this.opts.showNextBtn,
                hide:        this.opts.hide,
            });

            let url;
            switch (srv.kind) {
                case 'screenscape': url = buildScreenscapeUrl(this.ctx, lang);               break;
                case 'aurora':      url = buildAuroraUrl(this.ctx, lang, extra);             break;
                case 'nebula':      url = buildNebulaUrl(this.ctx, extra);                   break;
                case 'vidrock':     url = buildVidrockUrl(this.ctx);                         break;
                default:            url = buildPeachifyUrl(this.ctx, lang, extra);           break;
            }

            if (typeof this.opts.onLoading === 'function')
                this.opts.onLoading(true, srv.name);
            if (typeof this.opts.onSourceChange === 'function')
                this.opts.onSourceChange(srv.name, this.serverIndex);

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
                if (typeof this.opts.onLoading === 'function')
                    this.opts.onLoading(false, this.currentSourceName(), 'exhausted');
                return;
            }
            this.serverIndex = next;
            const name = this.opts.servers[next].name;
            console.info('[StellarPlayer] Switching to', name, '—', reason);
            this._mount();
        }

        _installListener() {
            this._onMessage = (event) => {
                if (!TRUSTED_ORIGINS.includes(event.origin)) return;
                const msg = event.data;
                if (!msg || typeof msg !== 'object') return;

                // ── ScreenScape Progress API responses ─────────────────────
                const ssTypes = [
                    'SCREENSCAPE_WATCH_HISTORY_RESPONSE',
                    'SCREENSCAPE_WATCH_HISTORY_WITH_PROGRESS_RESPONSE',
                    'SCREENSCAPE_ALL_WATCH_HISTORY_DETAILED_RESPONSE',
                    'SCREENSCAPE_PROGRESS_RESPONSE',
                    'SCREENSCAPE_SET_PROGRESS_RESPONSE',
                ];
                if (ssTypes.includes(msg.type)) {
                    this.ss._dispatch(event);
                    // Also surface progress to app callback
                    if (msg.watchHistory || msg.progress) {
                        if (typeof this.opts.onProgress === 'function')
                            this.opts.onProgress(msg.watchHistory || msg.progress);
                    }
                    return;
                }

                // ── Legacy MEDIA_DATA (VidRock / Peachify) ─────────────────
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
                    try { localStorage.setItem('vidRockProgress', JSON.stringify(Object.values(store))); }
                    catch (_) {}
                    if (typeof this.opts.onProgress === 'function') this.opts.onProgress(store);
                }

                // ── Generic player events ──────────────────────────────────
                if (msg.type === 'PLAYER_EVENT' && msg.data) {
                    if (typeof this.opts.onLoading === 'function')
                        this.opts.onLoading(false, this.currentSourceName());
                    if (typeof this.opts.onEvent === 'function')
                        this.opts.onEvent(msg.data);
                    const ev = msg.data.event;
                    if (ev === 'error' || ev === 'no_sources' || ev === 'sources_failed') {
                        console.warn('[StellarPlayer] Source reported error. Auto-switching disabled: ' + ev);
                    }
                }
            };
            window.addEventListener('message', this._onMessage);
        }
    }

    // ── Expose ─────────────────────────────────────────────────────────────
    StellarPlayer.defaultChain = defaultChain;
    StellarPlayer.LANG_MAP     = LANG_MAP;
    global.StellarPlayer  = StellarPlayer;
    global.PeachifyPlayer = StellarPlayer; // backward compat

})(typeof window !== 'undefined' ? window : globalThis);

/* =========================================================================
 * Quick-start examples
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. Basic — movie, default Hindi, ScreenScape first:
 *    const p = new StellarPlayer('#player');
 *    p.playMovie(597);
 *
 * 2. Switch to Bangla:
 *    p.setLanguage('bangla');
 *
 * 3. Play a TV episode:
 *    p.playEpisode(1396, 1, 1);
 *
 * 4. Get watch progress from ScreenScape:
 *    p.ss.getProgress(597).then(console.log);
 *
 * 5. Set progress at 120 s:
 *    p.ss.setProgress(597, 120);
 *
 * 6. Full watch history:
 *    p.ss.getAllHistoryDetailed().then(console.log);
 *
 * 7. Language switcher UI helper:
 *    p.listLanguages()
 *    // → [{ token:'hindi', label:'Hindi' }, { token:'bangla', label:'Bangla' }, …]
 *
 * =========================================================================
 */
