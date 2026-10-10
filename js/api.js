// Xtream Codes API client with small caches.
var API_REFRESH = null;
var API = (function () {
  var cache = {};
  // home routing is for the phone and the web only: the TV always talks to the provider directly (never depends on the laptop)
  function viaHome() { return !!(CONFIG.viaHome && window.HOME_BASE && CONFIG.homeToken); }   // TV: only if its switch is on (default: direct)
  function creds() { return viaHome() ? { u: 'pages', p: CONFIG.homeToken } : { u: CONFIG.username, p: CONFIG.password }; }
  function base() { return viaHome() ? window.HOME_BASE.replace(/\/+$/, '') + '/api' : CONFIG.server.replace(/\/+$/, ''); }
  function url(params) {
    var c = creds();
    var u = base() + '/player_api.php?username=' + encodeURIComponent(c.u) + '&password=' + encodeURIComponent(c.p);
    for (var k in params) u += '&' + k + '=' + encodeURIComponent(params[k]);
    return u;
  }
  function getJSON(params, ttlMs) {
    var key = JSON.stringify(params);
    var now = Date.now();
    if (cache[key] && now - cache[key].t < ttlMs) return Promise.resolve(cache[key].v);
    function refreshHome() {   // home address changed? (web: re-read api-base.txt; phone: reload HOME_BASE)
      if (window.PREVIEW && !window.IS_ANDROID && window.REFRESH_HOME) return Promise.resolve(window.REFRESH_HOME());
      if (window.IS_ANDROID && window.loadHomeBase) { var before = window.HOME_BASE; return window.loadHomeBase().then(function () { return window.HOME_BASE && window.HOME_BASE !== before; }); }
      return Promise.resolve(false);
    }
    API_REFRESH = refreshHome;
    var attempt = function () { return fetch(url(params), { cache: 'no-store' }); };
    return attempt().then(function (r) { if (r.status === 530 || r.status === 502 || r.status === 1033) return refreshHome().then(function (ch) { return ch ? attempt() : r; }); return r; }, function (e) { return refreshHome().then(function (ch) { if (ch) return attempt(); throw e; }); }).then(function (r) {
      if (r.status === 403 && window.PREVIEW && window.LOSBEBOS_LOGIN) { window.LOSBEBOS_LOGIN('Please sign in again'); throw new Error('sign-in needed'); }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (v) { if (ttlMs > 0) cache[key] = { t: now, v: v }; return v; });
  }
  var H = 3600 * 1000;
  return {
    account: function () { return getJSON({}, 10 * 60 * 1000); },
    categories: function (kind) { return getJSON({ action: 'get_' + (kind === 'vod' ? 'vod' : kind === 'series' ? 'series' : 'live') + '_categories' }, 30 * 60 * 1000); },   // always near-fresh: new categories within 30 min
    items: function (kind, categoryId) {
      var action = kind === 'vod' ? 'get_vod_streams' : kind === 'series' ? 'get_series' : 'get_live_streams';
      var p = { action: action }; if (categoryId) p.category_id = categoryId;
      return getJSON(p, 15 * 60 * 1000);   // a category is asked again after 15 min: new titles show up
    },
    allOnce: function (kind) { return getJSON({ action: kind === 'vod' ? 'get_vod_streams' : kind === 'series' ? 'get_series' : 'get_live_streams' }, 0); },   // search index: read once, not kept
    itemsOnce: function (kind, categoryId) { return getJSON({ action: kind === 'vod' ? 'get_vod_streams' : 'get_series', category_id: categoryId }, 0); },   // not kept in memory
    seriesInfo: function (seriesId) { return getJSON({ action: 'get_series_info', series_id: seriesId }, 15 * 60 * 1000); },   // new episodes within 15 min
    vodInfo: function (vodId) { return getJSON({ action: 'get_vod_info', vod_id: vodId }, 6 * H); },
    shortEpg: function (streamId) { return getJSON({ action: 'get_short_epg', stream_id: streamId, limit: 2 }, 5 * 60 * 1000); },
    streamUrl: function (kind, id, ext, name) {
      var c = creds(), b = base() + '/', cred = encodeURIComponent(c.u) + '/' + encodeURIComponent(c.p) + '/';
      if (kind === 'live') return b + 'live/' + cred + id + '.' + (viaHome() ? 'm3u8' : (CONFIG.liveFormat || 'ts'));
      if (kind === 'vod') return b + 'movie/' + cred + id + '.' + (ext || 'mp4');
      return b + 'series/' + cred + id + '.' + (ext || 'mp4');
    },
    directUrl: function (kind, id, ext) { var b = CONFIG.server.replace(/\/+$/, '') + '/', c = encodeURIComponent(CONFIG.username) + '/' + encodeURIComponent(CONFIG.password) + '/'; return b + (kind === 'vod' ? 'movie/' : 'series/') + c + id + '.' + (ext || 'mp4'); },   // provider, never via the laptop
    clearCache: function () { cache = {}; },
    now: function (cmd) { var u = API.homeApi('now'); if (!u) return Promise.reject(new Error('home laptop not reachable')); return fetch(u + (cmd ? '&cmd=' + cmd : ''), { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }); },
    shareUrl: function (it) {   // watch along: the home laptop's one shared copy of what the TV plays
      var b, t; if (window.IS_ANDROID) { if (!window.HOME_BASE || !CONFIG.homeToken) return null; b = window.HOME_BASE.replace(/\/+$/, '') + '/api'; t = CONFIG.homeToken; } else { b = base(); t = creds().p; }
      if (it.kind === 'live') return b + '/live/pages/' + encodeURIComponent(t) + '/' + it.id + '.m3u8';
      return b + '/watch/' + (it.kind === 'vod' ? 'movie' : 'series') + '/pages/' + encodeURIComponent(t) + '/' + it.id + '.' + (it.ext || 'mp4');
    },
    homeApi: function (path) {   // phone: the home laptop is used for shared memory, background and "with the TV" even when streaming directly
      if (window.IS_ANDROID) { if (!window.HOME_BASE || !CONFIG.homeToken) return null; return window.HOME_BASE.replace(/\/+$/, '') + '/api/' + path + '?username=pages&password=' + encodeURIComponent(CONFIG.homeToken); }
      var c = creds(); return base() + '/' + path + '?username=' + encodeURIComponent(c.u) + '&password=' + encodeURIComponent(c.p);
    },
    stateUrl: function () { return API.homeApi('state'); },
    alt: function (name) { var c = creds(); return fetch(base() + '/alt?username=' + encodeURIComponent(c.u) + '&password=' + encodeURIComponent(c.p) + '&name=' + encodeURIComponent(name), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : []; }); },
    refreshHome: function () { return API_REFRESH ? API_REFRESH() : Promise.resolve(false); },
    viaHome: viaHome
  };
})();

// Favourites and recents in localStorage.
var STORE = (function () {
  var KEYS = ['doortv.pos', 'doortv.favs', 'doortv.recent', 'doortv.gone', 'doortv.lastep', 'doortv.tracks', 'doortv.aspect', 'doortv.config', 'doortv.tvdl'];   // tvdl: 'download this on the TV' requests
  var pushTimer = 0;
  function read(k, d) { try { var s = localStorage.getItem(k); return s ? JSON.parse(s) : d; } catch (e) { return d; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); localStorage.setItem('doortv.updatedAt', String(Date.now())); } catch (e) {} if (KEYS.indexOf(k) >= 0) schedulePush(); }
  function stateUrl() {
    if (window.PREVIEW || window.IS_ANDROID) return API.stateUrl();
    return CONFIG.relay ? CONFIG.relay.replace(/\/+$/, '') + '/relay/state' : null;
  }
  function snapshot() { var o = { updatedAt: Number(read('doortv.updatedAt', 0)) || Date.now() }; KEYS.forEach(function (k) { var v = read(k, null); if (v !== null && k !== 'doortv.config') o[k] = v; }); return o; }
  function mergeLists(loc, rem, gone, prefix, isRecent) {   // entry by entry: newest copy of each item wins, removals win only over older adds
    var m = {}, keyOf = function (x) { return x.kind + ':' + x.id; };
    [loc || [], rem || []].forEach(function (arr) { arr.forEach(function (x, i) { if (!x || x.kind === undefined) return; var at = x.at || (isRecent ? 1000 - i : 1 + i), k = keyOf(x), cur = m[k]; if (!cur || at > (cur.at || 0)) m[k] = Object.assign({}, x, { at: at }); }); });
    var out = Object.keys(m).map(function (k) { return m[k]; }).filter(function (x) { return !((gone || {})[prefix + keyOf(x)] >= x.at); });
    out.sort(function (a, b) { return isRecent ? b.at - a.at : a.at - b.at; });
    return isRecent ? out.slice(0, 40) : out;
  }
  function applyRemote(remote) {
    if (!remote) return; var localAt = Number(read('doortv.updatedAt', 0)) || 0, remoteNewer = (remote.updatedAt || 0) > localAt;
    var gone = Object.assign({}, read('doortv.gone', {})); Object.keys(remote['doortv.gone'] || {}).forEach(function (g) { gone[g] = Math.max(gone[g] || 0, remote['doortv.gone'][g]); });
    try { localStorage.setItem('doortv.gone', JSON.stringify(gone)); } catch (e) {}
    var changed = false;
    ['doortv.favs', 'doortv.recent'].forEach(function (k) { var loc = read(k, null), rem = remote[k]; if (!rem && !loc) return;
      var mg = mergeLists(loc, rem, gone, k === 'doortv.favs' ? 'favs|' : 'recent|', k === 'doortv.recent'); if (JSON.stringify(mg) !== JSON.stringify(rem)) changed = true;
      try { localStorage.setItem(k, JSON.stringify(mg)); } catch (e) {} });
    if (changed) schedulePush();   // the laptop is missing something this device has: send it
    KEYS.forEach(function (k) { if (k === 'doortv.config' || k === 'doortv.favs' || k === 'doortv.recent' || k === 'doortv.gone' || !(k in remote)) return; var loc = read(k, null), rem = remote[k];
      if (loc === null) { try { localStorage.setItem(k, JSON.stringify(rem)); } catch (e) {} return; }
      if (Array.isArray(rem) || Array.isArray(loc)) { if (remoteNewer) try { localStorage.setItem(k, JSON.stringify(rem)); } catch (e) {} return; }
      var merged = Object.assign({}, remoteNewer ? loc : rem, remoteNewer ? rem : loc); try { localStorage.setItem(k, JSON.stringify(merged)); } catch (e) {} });
  }
  function timed(p, ms) { return new Promise(function (res, rej) { var d = false; var t = setTimeout(function () { if (!d) { d = true; rej(new Error('timeout')); } }, ms); p.then(function (v) { if (!d) { d = true; clearTimeout(t); res(v); } }, function (e) { if (!d) { d = true; clearTimeout(t); rej(e); } }); }); }
  function pull() { var u = stateUrl(); if (!u) return Promise.resolve(false); return timed(fetch(u, { cache: 'no-store' }), 2500).then(function (r) { return r.ok ? r.json() : null; }).then(function (remote) { applyRemote(remote); return true; }).catch(function () { return false; }); }
  function push() { var u = stateUrl(); if (!u) return; try { fetch(u, { method: 'POST', body: JSON.stringify(snapshot()), headers: { 'Content-Type': 'text/plain' } }).catch(function () {}); } catch (e) {} }
  var lastPush = 0, lastPull = 0, dirty = false;
  // leaving the page / app: send pending changes at once so nothing is lost
  function flush() { if (!dirty) return; dirty = false; clearTimeout(pushTimer); var u = stateUrl(); if (!u) return; var body = JSON.stringify(snapshot()); try { if (navigator.sendBeacon && navigator.sendBeacon(u, body)) return; } catch (e) {} push(); }
  try { window.addEventListener('pagehide', flush); document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); }); } catch (e) {}
  function schedulePush() { dirty = true; clearTimeout(pushTimer); var wait = Math.max(1500, 20000 - (Date.now() - lastPush)); pushTimer = setTimeout(function () { lastPush = Date.now(); dirty = false; push(); }, wait); }
  return {
    favs: function () {
      var f = read('doortv.favs', null); if (f === null) { f = (typeof DEFAULT_FAVS !== 'undefined') ? DEFAULT_FAVS.slice() : []; write('doortv.favs', f); }
      // seed additions made in later versions once, unless the user removed them on purpose
      var seeded = read('doortv.seeded', []), changed = false;
      (typeof DEFAULT_FAVS !== 'undefined' ? DEFAULT_FAVS : []).forEach(function (d) { var key = d.kind + ':' + d.id; if (seeded.indexOf(key) >= 0) return; seeded.push(key); if (!f.some(function (x) { return x.kind === d.kind && String(x.id) === String(d.id); })) { f.push(d); changed = true; } });
      write('doortv.seeded', seeded); if (changed) write('doortv.favs', f);
      return f;
    },
    saveFavs: function (f) { write('doortv.favs', f); },
    isFav: function (kind, id) { return STORE.favs().some(function (f) { return f.kind === kind && String(f.id) === String(id); }); },
    toggleFav: function (entry) {
      var favs = STORE.favs(); var i = -1;
      favs.forEach(function (f, idx) { if (f.kind === entry.kind && String(f.id) === String(entry.id)) i = idx; });
      if (i >= 0) { favs.splice(i, 1); var gn = read('doortv.gone', {}); gn['favs|' + entry.kind + ':' + entry.id] = Date.now(); write('doortv.gone', gn); } else { entry.at = Date.now(); if (entry.kind === 'live' && !entry.type) entry.type = /sport|dazn|movistar|tnt|premier|eurosport|liga|football|soccer|ring|action/i.test((entry.name || '') + ' ' + (entry.group || '') + ' ' + (entry.provider || '')) ? 'sport' : 'tv'; favs.push(entry); }
      write('doortv.favs', favs); return i < 0;
    },
    recents: function () { return read('doortv.recent', []); },
    addRecent: function (entry) {
      var r = STORE.recents().filter(function (f) { return !(f.kind === entry.kind && String(f.id) === String(entry.id)); });
      r.unshift(Object.assign({}, entry, { at: Date.now() })); write('doortv.recent', r.slice(0, 40));
    },
    aspectFor: function (key) { return read('doortv.aspect', {})[key]; },
    setAspectFor: function (key, v) { var a = read('doortv.aspect', {}); a[key] = v; write('doortv.aspect', a); },
    lastEpisode: function (seriesId) { return read('doortv.lastep', {})[String(seriesId)]; },
    setLastEpisode: function (seriesId, ep) { var m = read('doortv.lastep', {}); m[String(seriesId)] = ep; write('doortv.lastep', m); },
    trackPref: function (key) { return key ? read('doortv.tracks', {})[key] : null; },
    setTrackPref: function (key, v) { if (!key) return; var m = read('doortv.tracks', {}); m[key] = v; write('doortv.tracks', m); },
    sync: function () { lastPull = Date.now(); return pull(); }, pushNow: push,
    maybeSync: function () { if (Date.now() - lastPull < 60000) return Promise.resolve(false); lastPull = Date.now(); return pull(); },
    position: function (key) { return read('doortv.pos', {})[key] || 0; },
    setPosition: function (key, ms, dur) { var p = read('doortv.pos', {}); p[key] = ms; var keys = Object.keys(p); if (keys.length > 200) delete p[keys[0]]; write('doortv.pos', p); if (dur > 0) { var d = read('doortv.dur', {}); d[key] = dur; var dk = Object.keys(d); if (dk.length > 200) delete d[dk[0]]; write('doortv.dur', d); } },
    duration: function (key) { return read('doortv.dur', {})[key] || 0; }
  };
})();
