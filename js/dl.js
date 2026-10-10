// Downloads for offline viewing.
//   TV:    USB stick. Films/episodes you watch are copied in the background (so a lost connection continues from the stick),
//          plus a Download button. Uses the TV's own download service: keeps going while the TV shows something else.
//   Phone: app storage, Download button (Android's DownloadManager; its notification shows progress too).
//   Web:   the browser saves the file (the laptop marks the English audio/subtitles as default inside the file).
// Copies are ONLY deleted by hand (Downloads > Delete). Watching does not delete; a full disk stops the new download with a message.
// Provider safety: one download at a time per device, at most 3 attempts per file, attempts minutes apart.
var DL = (function () {
  var KEY = 'doortv.dl', AUTO_AFTER = 30000, FOLDER = 'LosBebosTV', MARGIN = 300 * 1048576;
  var TV = !window.PREVIEW && !window.IS_ANDROID && !!(window.tizen && window.tizen.download);
  var PHONE = !!(window.IS_ANDROID && window.AndroidBridge);
  var WEB = !!window.PREVIEW && !window.IS_ANDROID;   // note: the phone app sets PREVIEW too (shared touch layout)
  var dir = null, dirObj = null, usbBase = null, freeBytes = -1, listeners = [], pollT = 0, autoT = 0, inited = false;
  function now() { return Date.now(); }
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  var db = load();   // per device, never synced (each device has its own files)
  function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} }
  var saveT = 0; function saveSoon() { if (!saveT) saveT = setTimeout(function () { saveT = 0; save(); }, 10000); }   // progress is written at most every 10 s
  var repT = 0;
  function reportTV() {   // TV: tell the laptop what is on the stick / downloading (light: at most every 20 s, LAN only)
    if (!TV || !CONFIG.relay || repT) return;
    repT = setTimeout(function () { repT = 0;
      try { var x = new XMLHttpRequest(); x.open('POST', CONFIG.relay.replace(/\/+$/, '') + '/relay/dlstate', true);
        x.send(JSON.stringify({ list: all().map(function (e) { return { key: e.key, title: e.title, state: e.state, got: e.got || 0, total: e.total || 0, paused: !!e.paused, tries: e.tries || 0, err: e.err || '', log: e.log || [], folder: e.folder || '' }; }) })); } catch (er) {}
    }, 20000);
  }
  var emitT = 0, lastEmit = 0;
  function emit(force) {
    reportTV();
    var run = function () { lastEmit = now(); emitT = 0; listeners.forEach(function (f) { try { f(); } catch (e) {} }); };
    if (force || now() - lastEmit > 1000) { clearTimeout(emitT); emitT = 0; run(); } else if (!emitT) emitT = setTimeout(run, 1000);
  }
  function diag(tag, e, x) { if (window.DIAG) try { window.DIAG('dl-' + tag, { key: e && e.key, state: e && e.state, got: e && e.got, total: e && e.total, file: e && e.file, dir: dir, x: x || null }); } catch (er) {} }
  function ev(e, t) { if (!e) return; e.log = (e.log || []).concat([new Date().toTimeString().slice(0, 8) + ' ' + t + ' @' + mb(e.got || 0)]).slice(-10); }   // why it did what it did (reported to the laptop)
  function key(it) { return it.kind + ':' + it.id; }
  function fileOf(it) { return (it.kind === 'vod' ? 'film-' : 'ep-') + it.id + '.' + String(it.ext || 'mp4').replace(/[^a-z0-9]/gi, '').toLowerCase(); }
  function all() { return Object.keys(db).map(function (x) { return db[x]; }); }
  function list() { return all().sort(function (a, b) { return b.created - a.created; }); }
  function titleOf(it) { var n = it.name || ''; if (it.seriesName) n = (window.UI && UI.niceName ? UI.niceName(it.seriesName) : it.seriesName) + '  ' + n.split(' - ')[0] + (n.indexOf(' - ') > 0 ? ' - ' + n.split(' - ').slice(1).join(' - ') : ''); return n; }
  function track(e, got, tot) {   // smoothed speed for the "time left" estimate
    var t = now(); if (tot > 0) e.total = tot;
    if (e.rt && got > e.rg) { var sp = (got - e.rg) / Math.max(0.5, (t - e.rt) / 1000); e.speed = e.speed ? e.speed * 0.7 + sp * 0.3 : sp; }
    if (!e.rt || t - e.rt > 1500) { e.rt = t; e.rg = got; }
    e.got = got;
  }
  function left(e) { if (!e.speed || !e.total || e.got >= e.total) return ''; var sec = (e.total - e.got) / e.speed; return sec < 90 ? 'under 2 min left' : sec < 3600 ? 'about ' + Math.round(sec / 60) + ' min left' : 'about ' + (sec / 3600).toFixed(1) + ' h left'; }
  function info(e) { if (TV && !dir && e.state === 'queued') return 'Waiting for the USB stick';
    if (e.state === 'queued' && e.waitWatch) return 'Waits until you stop watching (one stream per account), then starts again from the beginning';
    if (e.state === 'downloading' && e.retrying && !e.paused) return 'Connection dropped, continuing from ' + (e.total ? Math.floor(100 * (e.got || 0) / e.total) : 0) + '% (' + mb(e.got || 0) + ') in a moment';
    if (TV && e.via === 'laptop' && e.state === 'downloading') { var p0 = e.total ? Math.floor(100 * (e.got || 0) / e.total) : 0;
      if (e.phase === 'copy') return 'Last step: copying to the USB stick, ' + p0 + '%';
      if (e.waiting) return 'Waiting at ' + p0 + ' %: someone is watching (one stream per account), continues by itself';
      if (e.paused) return 'Paused while you watch, ' + p0 + '% (continues from here)';
      return (e.retrying ? 'Connection dropped, continuing from ' + p0 + '% in a moment' : p0 + '%, ' + mb(e.got || 0) + ' of ' + mb(e.total || 0) + (e.speed > 0 && e.total ? ', about ' + Math.max(1, Math.round((e.total - e.got) / e.speed / 60)) + ' min left' : '')) + '  (via the home laptop)'; }
    var ob = e.state === 'queued' ? othersBusy() : null; if (ob) return 'Waiting: the ' + whoName(ob.who) + ' is downloading ' + ob.title + ' first'; if (e.state === 'queued') return e.tries ? 'Provider busy (another device is using the account). Trying again every 30 s, try ' + (e.tries + 1) + '.' : 'Waiting to download';
    if (e.why) return e.why + (e.total ? ', ' + pct(e) + '% of ' + mb(e.total) : '');
    if (e.stall) return 'No data for a minute: another stream may be using the account (' + pct(e) + '%)';
    if (!e.total) return e.state === 'queued' ? 'Waiting' : 'Starting...'; return pct(e) + '%,  ' + mb(e.got) + ' of ' + mb(e.total) + (left(e) ? ',  ' + left(e) : ''); }
  function pct(e) { return e.total > 0 ? Math.min(99, Math.floor(e.got / e.total * 100)) : 0; }
  function mb(b) { return b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : Math.round(b / 1048576) + ' MB'; }

  // ---------------- storage adapters ----------------
  function rmFile(file, cb) {
    cb = cb || function () {};
    if (TV) { if (!dirObj || !file) return cb(); try { dirObj.deleteFile(dir + '/' + file, function () { cb(); }, function () { cb(); }); } catch (e) { cb(); } return; }
    if (PHONE) { try { AndroidBridge.dlRemove(0, file); } catch (e) {} return cb(); }
    cb();
  }
  function initTV(cb) {
    try {
      tizen.filesystem.listStorages(function (l) {
        var u = l.filter(function (s) { return s.type === 'EXTERNAL' && s.state === 'MOUNTED'; })[0];
        if (!u) { dir = null; dirObj = null; emit(true); if (cb) cb(); return; }
        tizen.filesystem.resolve(u.label, function (d) {
          var base = String(d.toURI ? d.toURI() : d.fullPath).replace(/^file:\/\//, '');
          var sub = null; try { sub = d.resolve(FOLDER); } catch (e) { try { sub = d.createDirectory(FOLDER); } catch (e2) { sub = null; } }
          if (!sub) { dir = null; dirObj = null; emit(true); if (cb) cb(); return; }
          usbBase = base; dir = base + '/' + FOLDER; dirObj = sub; freeSpace(); emit(true); if (cb) cb();
        }, function () { dir = null; emit(true); if (cb) cb(); }, 'rw');
      }, function () { if (cb) cb(); });
    } catch (e) { if (cb) cb(); }
  }
  function freeSpace(cb) {
    if (PHONE) { try { freeBytes = Number(AndroidBridge.dlFree()); } catch (e) {} if (cb) cb(freeBytes); return; }
    try { tizen.systeminfo.getPropertyValue('STORAGE', function (s) { var u = (s.units || []).filter(function (x) { return x.isRemovable || /USB/i.test(x.type || ''); })[0]; if (u) { freeBytes = u.availableCapacity; emit(); } if (cb) cb(freeBytes); }, function () { if (cb) cb(freeBytes); }); } catch (e) { if (cb) cb(freeBytes); }
  }
  // not enough space: nothing is deleted automatically, the new download is stopped instead
  function makeRoom(e, needed, cb) { freeSpace(function (free) { cb(free < 0 || free >= needed + MARGIN); }); }
  // TV: a small description file next to every finished download (<file>.json), so the app recognises its downloads
  // even after its own memory is reset (reinstall). Unknown files are NEVER deleted automatically (2026-10-07: a reset made
  // the app delete a finished 4.2 GB download as an "unknown file").
  var META = ['kind', 'id', 'ext', 'name', 'title', 'icon', 'seriesId', 'seriesName', 'aspectKey', 'folder', 'total', 'done', 'created', 'tracks'];
  function writeMeta(e) {
    if (!TV || !dirObj || e.state !== 'done') return;
    var m = { v: 1 }; META.forEach(function (k) { if (e[k] !== undefined && e[k] !== null) m[k] = e[k]; });
    try { var f; try { f = dirObj.resolve(e.file + '.json'); } catch (x) { f = dirObj.createFile(e.file + '.json'); }
      f.openStream('w', function (st) { try { st.write(JSON.stringify(m)); } catch (x) {} st.close(); }, function () {}, 'UTF-8'); } catch (x) {}
  }
  function readMeta(name, cb) { try { dirObj.resolve(name).readAsText(function (t) { try { cb(JSON.parse(t)); } catch (x) { cb(null); } }, function () { cb(null); }, 'UTF-8'); } catch (x) { cb(null); } }
  // what is really on the disk: drop records whose finished file is gone; adopt described files the app does not know
  function reconcile(cb) {
    var names = null;
    var finish = function () {
      if (names && names.length) all().forEach(function (e) { if (e.state === 'done' && !e.rel && names.indexOf(e.file) < 0) delete db[e.key]; });   // moved files (e.rel) live elsewhere; an EMPTY scan means the stick was not readable yet, not that the files are gone
      save(); if (cb) cb();
    };
    if (TV) {
      if (!dirObj) return finish();
      try { dirObj.listFiles(function (fl) {
        names = fl.filter(function (f) { return f.isFile; }).map(function (f) { return f.name; });
        var known = all().map(function (e) { return e.file; });
        var adopt = names.filter(function (n) { return /^(film|ep)-\d+\.\w+$/.test(n) && known.indexOf(n) < 0; });   // everything of ours on the stick is listed again
        var left = adopt.length; if (!left) return finish();
        adopt.forEach(function (n) { var mm = /^(film|ep)-(\d+)\.(\w+)$/.exec(n), plain = { kind: mm[1] === 'film' ? 'vod' : 'series', id: Number(mm[2]), ext: mm[3], name: (mm[1] === 'film' ? 'Film ' : 'Episode ') + mm[2], title: (mm[1] === 'film' ? 'Film ' : 'Episode ') + mm[2] };
          (names.indexOf(n + '.json') >= 0 ? readMeta : function (x, cb) { cb(null); })(n + '.json', function (m) { m = m || plain;
          if (m && m.id && m.kind) { var k = m.kind + ':' + m.id; if (!db[k]) { var e = { key: k, file: n, state: 'done', got: m.total || 0, touched: now(), auto: false }; META.forEach(function (x) { if (m[x] !== undefined) e[x] = m[x]; }); e.got = e.total || 0; db[k] = e; diag('adopt', e); } }
          if (--left === 0) finish();
        }); });
      }, finish); } catch (e) { finish(); }
      return;
    }
    if (PHONE) { try { names = JSON.parse(AndroidBridge.dlFiles() || '[]'); } catch (e) { names = null; } return finish(); }
    finish();
  }
  // downloads that were running when the app last closed
  function recover() {
    all().forEach(function (e) {
      if (e.state !== 'downloading') return;
      if (TV && e.via === 'laptop') { if (e.phase === 'copy') { try { tizen.download.cancel(e.dlId); } catch (x) {} } e.state = 'queued'; e.paused = false; e.notBefore = 0; return; }
      if (TV && RESUME) {   // continue from the partial file; an old built-in download still running is stopped first (one stream per account)
        if (!e.resume && e.dlId) { try { tizen.download.cancel(e.dlId); } catch (x) {} rmFile(e.file); e.got = 0; }
        e.state = 'queued'; e.paused = false; e.notBefore = 0; return;
      }
      if (TV) {
        var st = null; try { st = tizen.download.getState(e.dlId); } catch (x) { st = null; }
        if (st === 'DOWNLOADING' || st === 'QUEUED' || st === 'PAUSED' || st === 'FAILED') {   // the job survived (app kept running in the background): carry on from where it is
          ev(e, 'app reopened, job still there (' + st + '), continuing');
          try { tizen.download.setListener(e.dlId, cbTV(e)); if (st === 'PAUSED' || st === 'FAILED') { e.paused = false; tizen.download.resume(e.dlId); } return; } catch (x) {} }
        if (st === 'COMPLETED') { e.state = 'done'; e.done = now(); e.touched = now(); return; }
        ev(e, 'app was closed during the download (' + (st || 'job gone') + '), starting again'); e.state = 'queued'; e.got = 0; rmFile(e.file); rmFile(e.file + '.part'); e.resume = false;
      }
    });
    save();
  }
  function sweep() {}   // no time limit: copies stay until watched (he decided 2026-10-07)

  // ---------------- queue ----------------
  function busy() { return all().some(function (e) { return e.state === 'downloading'; }); }
  function watching() { return !!(window.PLAYER && PLAYER.isActive && PLAYER.isActive() && !(PLAYER.isLocal && PLAYER.isLocal())); }   // a copy playing uses no stream
  // downloads on the other devices (reported to the home laptop): the first one running has priority everywhere
  var others = null, othersAt = 0, tvNow = null;
  function me() { return TV ? 'tv' : PHONE ? 'phone' : 'web'; }
  function busyUrl() { if (TV) return CONFIG.relay ? CONFIG.relay.replace(/\/+$/, '') + '/relay/dlbusy?me=tv' : null; var u = API.homeApi ? API.homeApi('dlbusy') : null; return u ? u + '&me=' + me() : null; }
  function checkOthers(cb, timeoutMs) {
    var u = busyUrl(); if (!u) { others = null; tvNow = null; return cb && cb(); }
    try { var x = new XMLHttpRequest(); x.open('GET', u, true); x.timeout = timeoutMs || 4000;
      x.onload = function () { try { var jb = JSON.parse(x.responseText); others = jb.busy || null; tvNow = jb.tv || null; othersAt = now(); } catch (er) { others = null; tvNow = null; } tvYield(); if (tvNow && window.PLAYER && PLAYER.tvTakeover) PLAYER.tvTakeover(tvNow); emit(); cb && cb(); };
      x.onerror = x.ontimeout = function () { cb && cb(); }; x.send(); } catch (er) { cb && cb(); }
  }
  function tvYield() {   // phone: the TV is playing -> pause our downloads (one stream, the TV first); continue when it stops
    if (!PHONE) return; var tvOn = !!(others && others.playing);
    all().forEach(function (x) {
      if (tvOn && x.state === 'downloading' && !x.paused) { try { AndroidBridge.dlPause(x.dlId); x.paused = true; x.tvPaused = true; } catch (er) {} }
      else if (!tvOn && x.tvPaused) { x.tvPaused = false; if (!watching()) { try { AndroidBridge.dlResume(x.dlId); x.paused = false; } catch (er) {} } }
    }); save();
  }
  function othersBusy() { return others && now() - othersAt < 90000 ? others : null; }
  function whoName(w) { return w === 'tv' ? 'TV' : w === 'phone' ? 'phone' : w; }
  function pump() {
    if (!canHere() || busy() || watching()) return;
    if (othersBusy() && all().some(function (e) { return e.state === 'queued'; })) { setTimeout(function () { checkOthers(pump); }, 20000); return; }   // another device is downloading: it goes first
    var q = all().filter(function (e) { return e.state === 'queued' && (!e.notBefore || e.notBefore <= now()); }).sort(function (a, b) { return a.created - b.created; })[0];
    if (q) start(q);
    else { var later = all().filter(function (e) { return e.state === 'queued'; }).map(function (e) { return e.notBefore || 0; }).sort()[0]; if (later) setTimeout(pump, Math.max(1000, later - now() + 500)); }
  }
  // TV and phone download straight from the provider (never through the laptop)
  function urlOf(e) { return (PHONE || TV) && CONFIG.username && API.directUrl ? API.directUrl(e.kind, e.id, e.ext) : API.streamUrl(e.kind, e.id, e.ext, e.name); }
  function start(e) { ev(e, 'start'); e.waitWatch = false;
    e.roomChecked = false; e.lastMove = 0; e.lastGot = 0; e.why = ''; e.stall = false;
    e.state = 'downloading'; if (!(TV && RESUME) && !PHONE) e.got = 0; e.total = e.total || 0; save(); emit(true); diag('start', e, urlOf(e).replace(/\/\/[^/]+\/(movie|series)\/[^/]+\/[^/]+\//, '//provider/$1/'));
    if (TV && relay() && CONFIG.dlViaLaptop && e.via !== 'direct') return tvViaLaptop(e);   // off: he wants the download on the TV itself
    if (TV && RESUME) { e.resume = true; return tvGet(e); }
    if (TV) { e.via = 'direct'; e.phase = ''; }   // the TV downloads natively: no leftover laptop-path fields (they made a running download look like a laptop one)
    (PHONE ? function (f, cb) { cb(); } : rmFile)(e.file, function () {   // phone: a partial file is resumed by the app's downloader
      if (!db[e.key]) return;
      if (TV) {
        try { var req = new tizen.DownloadRequest(urlOf(e), dir, e.file); e.dlId = tizen.download.start(req, cbTV(e)); save(); }
        catch (x) { fail(e); }
      } else if (PHONE) {
        var id = -1, alt = ''; try { if (window.HOME_BASE && CONFIG.homeToken) { var hb = window.HOME_BASE.replace(/\/+$/, ''); alt = hb + '/api/' + (e.kind === 'vod' ? 'movie' : 'series') + '/pages/' + encodeURIComponent(CONFIG.homeToken) + '/' + e.id + '.' + e.ext + '?me=phone'; } } catch (x) {}
        try { id = Number(AndroidBridge.dlStart2 ? AndroidBridge.dlStart2(urlOf(e), alt, e.file, e.title) : AndroidBridge.dlStart(urlOf(e), e.file, e.title)); } catch (x) { id = -1; }
        if (id < 0) return fail(e);
        e.dlId = id; save(); poll();
      }
    });
  }
  // TV: own downloader that continues where it stopped (the built-in one starts from zero after every drop).
  // Light on purpose: 32 MB Range pieces with XHR (one callback per piece, the browser does the rest), appended to
  // <file>.part on the stick, renamed to <file> when complete. A drop only costs the piece in flight.
  var RESUME = false;   // OFF: writing video from JavaScript froze the TV (Tizen copies every byte through JS). The native downloader is used, with its own resume.
  var PIECE = 32 * 1048576, tvx = {};   // key -> { xhr, stop }
  function partSize(e, cb) { try { tizen.filesystem.resolve(dir + '/' + e.file + '.part', function (f) { cb(f.fileSize || 0); }, function () { cb(0); }, 'r'); } catch (x) { cb(0); } }
  function tvGet(e) {
    partSize(e, function (have) {
      if (!db[e.key] || e.state !== 'downloading' || tvx[e.key]) return;
      var job = { xhr: null, stop: false }; tvx[e.key] = job;
      e.got = have; e.lastTryGot = have; emit(true);
      var end = function (err) {
        if (tvx[e.key] === job) delete tvx[e.key];
        if (!db[e.key]) return rmFile(e.file + '.part');
        if (e.paused) { save(); emit(true); return; }   // paused while watching: continues from here afterwards
        e.err = String(err || 'stopped').slice(0, 80); fail(e);
      };
      var piece = function () {
        if (job.stop || !db[e.key]) return end('stopped');
        if (e.total > 0 && e.got >= e.total) {
          try { dirObj.moveTo(dir + '/' + e.file + '.part', dir + '/' + e.file, true, function () { if (tvx[e.key] === job) delete tvx[e.key]; done(e); }, function () { end('rename failed'); }); } catch (x) { end('rename failed'); }
          return;
        }
        var x = new XMLHttpRequest(); job.xhr = x;
        x.open('GET', urlOf(e), true); x.responseType = 'arraybuffer'; x.timeout = 120000;
        x.setRequestHeader('Range', 'bytes=' + e.got + '-' + (e.got + PIECE - 1));
        x.onprogress = function (ev) { var g = e.got; track(e, g + (ev.loaded || 0), e.total); e.got = g; };   // only feeds the speed estimate (e.got stays the bytes safely on the stick), no repaint
        x.onload = function () {
          if (job.stop) return end('stopped');
          if (x.status !== 206 && !(x.status === 200 && e.got === 0)) return end('HTTP ' + x.status);
          var cr = /\/(\d+)\s*$/.exec(x.getResponseHeader('Content-Range') || ''), data = x.response;
          if (cr) e.total = Number(cr[1]); else if (x.status === 200) e.total = data.byteLength;
          if (!data || !data.byteLength) return end('empty piece');
          if (!e.roomChecked && e.total > 0) { e.roomChecked = true; makeRoom(e, e.total - e.got, function (ok) { if (!ok && db[e.key]) { job.stop = true; delete db[e.key]; rmFile(e.file + '.part'); save(); emit(true); if (window.UI) UI.toast('Not enough space on the USB stick for ' + e.title + '. Delete something in Downloads first.', 6000); setTimeout(pump, 500); } }); }
          var fh; try { fh = tizen.filesystem.openFile(dir + '/' + e.file + '.part', e.got > 0 ? 'a' : 'w'); } catch (er) { return end('cannot write to the stick'); }
          var bytes = new Uint8Array(data);
          fh.writeDataNonBlocking(bytes, function () {
            try { fh.closeNonBlocking(function () {}, function () {}); } catch (er) {}
            e.got += bytes.length; e.tries = 0; e.err = ''; job.xhr = null; data = null; bytes = null;
            emit(true); saveSoon(); setTimeout(piece, 0);
          }, function () { try { fh.close(); } catch (er) {} end('write failed'); });
        };
        x.onerror = function () { end('network error'); }; x.ontimeout = function () { end('timeout'); }; x.onabort = function () { end('stopped'); };
        x.send();
      };
      piece();
    });
  }
  // TV, normal path: the home laptop fetches from the provider and continues from the last byte after any drop; when it
  // has the whole file the TV copies it over the home network with its native downloader (no provider involved, so a
  // hiccup there costs seconds). Without the laptop the TV downloads directly (that one starts over after a drop).
  function relay() { return CONFIG.relay ? CONFIG.relay.replace(/\/+$/, '') : null; }
  function lapCall(e, op, cb) {
    var u = relay() + '/relay/fetch?file=' + encodeURIComponent(e.file) + '&kind=' + e.kind + '&id=' + encodeURIComponent(e.id) + '&ext=' + encodeURIComponent(e.ext || 'mp4') + '&title=' + encodeURIComponent(e.title || '') + '&size=' + (e.total || 0) + (op ? '&op=' + op : '');
    try { var x = new XMLHttpRequest(); x.open('GET', u, true); x.timeout = 8000; x.onload = function () { var j = null; try { j = JSON.parse(x.responseText); } catch (er) {} cb && cb(x.status === 200 ? j : null); }; x.onerror = x.ontimeout = function () { cb && cb(null); }; x.send(); } catch (er) { cb && cb(null); }
  }
  function tvViaLaptop(e) {
    e.via = 'laptop'; if (!e.phase) e.phase = 'laptop'; e.lapFails = 0; save(); emit(true);
    if (e.phase === 'copy') return tvCopy(e);
    (function lap() {
      if (!db[e.key] || e.state !== 'downloading' || e.via !== 'laptop' || e.phase !== 'laptop') return;
      lapCall(e, e.paused ? 'pause' : '', function (j) {
        if (!db[e.key] || e.state !== 'downloading' || e.phase !== 'laptop') return;
        if (!j) { e.lapFails = (e.lapFails || 0) + 1; e.err = 'home laptop not answering'; emit();
          if (e.lapFails >= 6 && !(e.got > 0)) { e.via = 'direct'; e.phase = ''; save(); return start(e); }   // laptop off from the start: download directly
          return setTimeout(lap, 10000); }
        if (j.state === 'nospace') { ev(e, 'laptop disk nearly full, downloading directly'); e.via = 'direct'; e.phase = ''; save(); return start(e); }
        e.lapFails = 0; e.err = j.err || ''; e.retrying = j.state === 'retrying'; e.waiting = j.state === 'waiting';
        if (j.total > 0 && !e.roomChecked) { e.roomChecked = true; makeRoom(e, j.total, function (ok) { if (!ok && db[e.key]) { lapCall(e, 'cancel'); delete db[e.key]; save(); emit(true); if (window.UI) UI.toast('Not enough space on the USB stick for ' + e.title + '. Delete something in Downloads first.', 6000); setTimeout(pump, 500); } }); if (!db[e.key]) return; }
        if (j.total > 0) track(e, j.got, j.total); else e.got = j.got;
        if (j.state === 'ready') { e.phase = 'copy'; e.got = 0; save(); emit(true); return tvCopy(e); }
        emit(); saveSoon(); setTimeout(lap, 5000);
      });
    })();
  }
  function tvCopy(e) {
    rmFile(e.file, function () {
      if (!db[e.key] || e.state !== 'downloading') return;
      e.copyStart = now();
      try { var req = new tizen.DownloadRequest(relay() + '/relay/file/' + encodeURIComponent(e.file), dir, e.file); e.dlId = tizen.download.start(req, cbTV(e)); save(); }
      catch (x) { fail(e); }
    });
  }
  function tvStop(e) { var j = tvx[e.key]; if (j) { j.stop = true; try { if (j.xhr) j.xhr.abort(); } catch (x) {} } }
  function cbTV(e) {
    return {
      onprogress: function (id, got, tot) { if (!db[e.key]) return; if (tot > 0 && got >= tot) setTimeout(function () { if (db[e.key] && e.state === 'downloading') { var s0 = ''; try { s0 = tizen.download.getState(id); } catch (x) {} if (s0 === 'COMPLETED') done(e); } }, 8000); if (got > (e.got || 0)) { e.nresume = 0; e.retrying = false; } track(e, got, tot); if (tot > 0 && !e.roomChecked) { e.roomChecked = true; makeRoom(e, tot - got, function (ok) { if (!ok && db[e.key]) { try { tizen.download.cancel(e.dlId); } catch (x) {} delete db[e.key]; rmFile(e.file); save(); emit(true); if (window.UI) UI.toast('Not enough space on the USB stick for ' + e.title + '. Delete something in Downloads first.', 6000); setTimeout(pump, 500); } }); } if (!e.lastDiag || now() - e.lastDiag > 15000) { e.lastDiag = now(); diag('progress', e); } e.got = got; e.total = tot || e.total; emit(); saveSoon(); },
      oncompleted: function (id, path) { if (!db[e.key]) { rmFile(String(path).split('/').pop()); return; } e.file = String(path).split('/').pop(); done(e); },
      onfailed: function (id, er) {
        e.err = er ? String(er.name || '') + ' ' + String(er.message || '') : '';
        if (e.via === 'laptop' && e.phase === 'copy') { e.err = 'copy from the laptop stopped, copying again'; return fail(e); }
        if (!db[e.key] || e.paused) return;
        // dropped connection: the TV's downloader continues from the same byte (verified on this TV 2026-10-07).
        // Keep asking it to, waiting a little longer each time (the provider may be busy); never start over unless the job is gone.
        e.nresume = (e.nresume || 0) + 1; e.retrying = true; ev(e, 'connection dropped (' + e.err + '), resuming'); emit(true);
        var wait = Math.min(60000, 5000 * Math.pow(2, Math.min(4, e.nresume - 1)));
        setTimeout(function () {
          if (!db[e.key] || e.state !== 'downloading' || e.paused) return;
          try { tizen.download.resume(id); ev(e, 'resume asked'); } catch (x) { var st = ''; try { st = tizen.download.getState(id); } catch (y) { st = ''; } if (st === 'DOWNLOADING' || st === 'QUEUED') return; ev(e, 'resume impossible (' + (x && x.message) + '), starting again'); return fail(e); }
        }, wait);
      },
      oncanceled: function () {}
    };
  }
  function done(e) { fsGen++; if (e.via === 'laptop') { lapCall(e, 'done'); e.phase = ''; } diag('done', e); e.state = 'done'; e.got = e.total; e.done = now(); e.touched = now(); save(); writeMeta(e); freeSpace(); emit(true); pump(); }
  // a failed attempt never removes the download: it tries again every 30 s (2 min after 20 tries) until it
  // finishes or is cancelled by hand. Usually the cause is the account's one stream being busy on another device.
  var STALL_MS = function () { return window.__stallMs || 180000; };
  function tvStallCheck() {   // no new bytes for 3 min: ask the job to go on; still nothing 3 min later: start that part again (the priority ladder in fail() keeps knocking)
    all().forEach(function (e) {
      if (e.state !== 'downloading' || e.paused || e.via === 'laptop' || e.resume || !e.dlId) { e.wdAt = 0; return; }
      if (e.got !== e.wdGot || !e.wdAt) { e.wdGot = e.got; e.wdAt = now(); e.wdNudged = false; return; }
      if (now() - e.wdAt < STALL_MS()) return;
      var st = ''; try { st = tizen.download.getState(e.dlId); } catch (x) {}
      if (!e.wdNudged) { e.wdNudged = true; e.wdAt = now(); ev(e, 'no data for ' + Math.round(STALL_MS() / 60000) + ' min (' + (st || 'state unknown') + '), asking it to go on'); try { if (st === 'DOWNLOADING') tizen.download.pause(e.dlId); } catch (x) {} setTimeout(function () { try { tizen.download.resume(e.dlId); } catch (x) {} }, 1500); emit(true); return; }
      ev(e, 'still no data (' + (st || 'state unknown') + '), starting again'); try { tizen.download.cancel(e.dlId); } catch (x) {} e.wdAt = 0; e.wdNudged = false; e.dlId = 0; fail(e);
    });
  }
  function fail(e) {
    if (!db[e.key]) return;
    diag('fail', e);
    var moved = (e.got || 0) > (e.lastTryGot || 0) + 1048576;   // it got somewhere: continue right away from that point
    e.tries = moved ? 1 : (e.tries || 0) + 1; if (!PHONE && !e.resume) rmFile(e.file);   // phone and TV keep the partial file and continue from it
    var secs = moved ? 3 : e.tries < 20 ? 30 : 120;   // the download has priority: keep knocking every 30 s so it grabs the stream the moment it is free
    e.state = 'queued'; if (!e.resume && !PHONE) e.got = 0; e.notBefore = now() + secs * 1000;
    save(); emit(true); setTimeout(pump, 500);
  }
  // phone: DownloadManager status (1 pending, 2 running, 4 paused, 8 done, 16 failed)
  function poll() {
    clearTimeout(pollT); if (!PHONE) return;
    var act = all().filter(function (e) { return e.state === 'downloading' && e.dlId > 0; });
    if (!act.length) return;
    var res = []; try { res = JSON.parse(AndroidBridge.dlQuery(JSON.stringify(act.map(function (e) { return e.dlId; }))) || '[]'); } catch (x) {}
    act.forEach(function (e) {
      var r = res.filter(function (x) { return String(x.id) === String(e.dlId); })[0];
      if (!r) return fail(e);
      if (r.got > (e.lastGot || 0) || (r.status === 4 && r.reason === 5)) { e.lastGot = r.got; e.lastMove = now(); e.stall = false; } else if (!e.lastMove) e.lastMove = now();
      e.paused = r.status === 4 && r.reason === 5;
      e.why = r.status === 4 && r.reason !== 5 ? 'Reconnecting' + (r.err ? ' (' + String(r.err).slice(0, 60) + ')' : '') : (r.status === 1 ? 'starting' : '');
      e.route = r.alt ? 'via home' : 'direct';
      e.stall = r.status === 2 && now() - e.lastMove > 60000;
      if (window.PHONE_LOG && (!e.lastLog || now() - e.lastLog > 30000)) { e.lastLog = now(); window.PHONE_LOG('dl', { s: r.status, r: r.reason, got: r.got, total: r.total, err: r.err, alt: r.alt }); }
      // the downloader retries by itself (also when locked); only after 25 min without data start over
      if (!e.paused && now() - e.lastMove > 1500000) { e.lastMove = now(); try { AndroidBridge.dlRemove(e.dlId, e.file); } catch (x) {} return fail(e); }   // no data for 3 min: start again (max 3 tries, minutes apart)
      track(e, r.got > 0 ? r.got : e.got, r.total > 0 ? r.total : e.total);
      if (e.total > 0 && !e.roomChecked) { e.roomChecked = true; (function (ee) { makeRoom(ee, ee.total - ee.got, function (ok) { if (!ok && db[ee.key]) { try { AndroidBridge.dlRemove(ee.dlId, ee.file); } catch (x) {} delete db[ee.key]; save(); emit(true); if (window.UI) UI.toast('Not enough space on the phone for ' + ee.title + '. Delete something in Downloads first.', 6000); } }); })(e); }
      if (r.status === 8) done(e); else if (r.status === 16) fail(e);
    });
    emit(); saveSoon();
    pollT = setTimeout(poll, 1500);
  }
  var fsGen = 1; function fsChanged() { fsGen++; emit(true); }   // bumped when a file appears or disappears (the Downloads screen re-reads the list on it)
  function removeEntry(e) {
    diag('remove', e);
    if (e.state === 'downloading') {
      if (TV) { tvStop(e); if (e.via === 'laptop') lapCall(e, 'cancel'); try { tizen.download.cancel(e.dlId); } catch (x) {} }
      if (PHONE) { try { AndroidBridge.dlRemove(e.dlId, e.file); } catch (x) {} }
    }
    delete db[e.key]; save();
    if (e.rel && e.state === 'done') { fsx.remove(e.rel, false, function () { freeSpace(); fsChanged(); }); }
    else { rmFile(e.file, function () { freeSpace(); fsChanged(); }); if (TV) { rmFile(e.file + '.json'); rmFile(e.file + '.part'); } }   // the list is told again once the file is really gone (deleting on the stick is asynchronous)
    emit(true); setTimeout(pump, 300);
  }
  // 'download this on the TV' requests arrive through the shared sync (key doortv.tvdl); each is taken once
  function takeRequests() {
    if (!TV || !dir) return;
    var req = {}, done = {}; try { req = JSON.parse(localStorage.getItem('doortv.tvdl') || '{}') || {}; done = JSON.parse(localStorage.getItem('doortv.tvdlDone') || '{}') || {}; } catch (e) { return; }
    var changed = false;
    Object.keys(req).forEach(function (k) { var r = req[k]; if (!r || !r.id || (done[k] || 0) >= (r.t || 0)) return; done[k] = r.t || 1; changed = true; if (!db[k]) { diag('request', { key: k }); window.DL.add(r); } });
    if (changed) try { localStorage.setItem('doortv.tvdlDone', JSON.stringify(done)); } catch (e) {}
  }
  function canHere() { return (TV && !!dir) || PHONE; }

  // ---------------- web: the browser saves the file ----------------
  var web = {};
  function webDownload(it) {
    var did = String(it.id) + '-' + now();
    var url = API.streamUrl(it.kind, it.id, it.ext, it.name) + '?download=1&did=' + encodeURIComponent(did) + '&name=' + encodeURIComponent(titleOf(it));
    var a = document.createElement('a'); a.href = url; a.rel = 'noopener'; a.style.display = 'none'; document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 2000);
    web[key(it)] = { state: 'downloading', got: 0, total: 0, did: did };
    var p = API.homeApi('dlprog');
    (function tick() {
      var w = web[key(it)]; if (!w || w.did !== did) return;
      fetch(p + '&did=' + encodeURIComponent(did), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
        if (j && j.size) track(w, j.sent, j.size);
        if (j && j.done && !j.ok && j.error) { delete web[key(it)]; emit(true); if (window.UI) UI.toast(j.error === 'busy' ? 'The provider refused: another stream is playing on the account. Try again when nothing else is watching.' : 'The download could not start. Try again in a minute.', 7000); return; }
        if (j && j.done) { w.state = 'done'; emit(true); setTimeout(function () { if (web[key(it)] === w) { delete web[key(it)]; emit(true); } }, 15000); return; }
        emit(); setTimeout(tick, 2000);
      }).catch(function () { setTimeout(tick, 4000); });
    })();
    emit(true);
  }

  // ---------------- file browser: TV = the whole USB stick, phone = Downloads/Los Bebos TV ----------------
  var VIDEO = /\.(mkv|mp4|avi|m4v|mov|ts|m2ts|webm|mpg|mpeg|wmv|flv)$/i;
  function cleanRel(rel) { return String(rel || '').replace(/\\/g, '/').split('/').filter(function (p) { return p && p !== '.' && p !== '..'; }).join('/'); }
  function hidden(n) { return /^\.|^\$|^System Volume Information$|^LOST\.DIR$|\.json$/i.test(n); }
  function byRel(rel) { return all().filter(function (e) { return (e.rel || (TV ? FOLDER + '/' + e.file : e.file)) === rel; })[0] || null; }
  var fsx = {
    ready: function () { return (TV && !!usbBase) || PHONE; },
    list: function (rel, cb) {
      rel = cleanRel(rel); var done = function (items) {
        items = items.filter(function (f) { return !hidden(f.name) && (f.dir || VIDEO.test(f.name)); }).map(function (f) {
          var r = (rel ? rel + '/' : '') + f.name, e = f.dir ? null : byRel(r);
          return { name: f.name, rel: r, dir: !!f.dir, size: f.size || 0, entry: e, title: f.dir ? (r === FOLDER ? 'Los Bebos TV downloads' : f.name) : e ? e.title : f.name.replace(VIDEO, '').replace(/[._]+/g, ' ').trim(), icon: e ? e.icon : '' };
        });
        items.sort(function (a, b) { return a.dir !== b.dir ? (a.dir ? -1 : 1) : a.title.localeCompare(b.title); });
        cb(items);
      };
      if (TV) { if (!usbBase) return cb([]); try { tizen.filesystem.resolve(usbBase + (rel ? '/' + rel : ''), function (d) { d.listFiles(function (fl) { done(fl.map(function (f) { return { name: f.name, dir: f.isDirectory, size: f.fileSize }; })); }, function () { cb([]); }); }, function () { cb([]); }, 'r'); } catch (e) { cb([]); } return; }
      if (PHONE) { var l = []; try { l = JSON.parse(AndroidBridge.fsList(rel) || '[]'); } catch (e) {} return done(l); }
      cb([]);
    },
    url: function (rel) { rel = cleanRel(rel); if (TV) return 'file://' + usbBase + '/' + rel; var p = ''; try { p = AndroidBridge.fsPath(rel); } catch (e) {} return p ? 'file://' + encodeURI(p) : ''; },
    remove: function (rel, isDir, cb) {
      rel = cleanRel(rel); if (!rel) return cb(false);
      var e = isDir ? null : byRel(rel); if (e) { delete db[e.key]; save(); }
      if (isDir) all().forEach(function (x) { if (x.rel && x.rel.indexOf(rel + '/') === 0) delete db[x.key]; }); save();
      if (TV) { var parent = usbBase + (rel.indexOf('/') > 0 ? '/' + rel.slice(0, rel.lastIndexOf('/')) : ''), full = usbBase + '/' + rel;
        try { tizen.filesystem.resolve(parent, function (d) { if (isDir) d.deleteDirectory(full, true, function () { cb(true); fsChanged(); }, function () { cb(false); }); else d.deleteFile(full, function () { try { d.deleteFile(full + '.json', function () {}, function () {}); } catch (y) {} cb(true); fsChanged(); }, function () { cb(false); }); }, function () { cb(false); }, 'rw'); } catch (x) { cb(false); } return; }
      if (PHONE) { var ok = false; try { ok = AndroidBridge.fsDelete(rel); } catch (x) {} cb(ok); fsChanged(); return; }
      cb(false);
    },
    move: function (rel, destDir, cb) {
      rel = cleanRel(rel); destDir = cleanRel(destDir); var name = rel.split('/').pop(), to = (destDir ? destDir + '/' : '') + name;
      if (to === rel) return cb(true);
      var e = byRel(rel);
      var after = function (ok) { if (ok && e) { e.rel = to; save(); writeMetaAt(e); } fsChanged(); cb(ok); };
      if (TV) { try { tizen.filesystem.resolve(usbBase, function (d) { d.moveTo(usbBase + '/' + rel, usbBase + '/' + to, false, function () {
          d.moveTo(usbBase + '/' + rel + '.json', usbBase + '/' + to + '.json', true, function () {}, function () {}); after(true); }, function () { after(false); }); }, function () { after(false); }, 'rw'); } catch (x) { after(false); } return; }
      if (PHONE) { var ok = false; try { ok = AndroidBridge.fsMove(rel, destDir); } catch (x) {} return after(ok); }
      cb(false);
    },
    mkdir: function (rel, cb) {
      rel = cleanRel(rel); if (!rel) return cb(false);
      if (TV) { var parent = usbBase + (rel.indexOf('/') > 0 ? '/' + rel.slice(0, rel.lastIndexOf('/')) : ''); try { tizen.filesystem.resolve(parent, function (d) { try { d.createDirectory(rel.split('/').pop()); cb(true); } catch (x) { cb(false); } }, function () { cb(false); }, 'rw'); } catch (x) { cb(false); } return; }
      if (PHONE) { var ok = false; try { ok = AndroidBridge.fsMkdir(rel); } catch (x) {} return cb(ok); }
      cb(false);
    }
  };
  function writeMetaAt(e) { if (!TV || !usbBase || !e.rel) return; var m = { v: 1 }; META.forEach(function (k) { if (e[k] !== undefined && e[k] !== null) m[k] = e[k]; });
    try { var parent = usbBase + (e.rel.indexOf('/') > 0 ? '/' + e.rel.slice(0, e.rel.lastIndexOf('/')) : ''); tizen.filesystem.resolve(parent, function (d) { var n = e.rel.split('/').pop() + '.json', f; try { f = d.resolve(n); } catch (x) { f = d.createFile(n); } f.openStream('w', function (st) { st.write(JSON.stringify(m)); st.close(); }, function () {}, 'UTF-8'); }, function () {}, 'rw'); } catch (x) {} }

  // ---------------- public ----------------
  return {
    init: function () {
      if (inited) return; inited = true;
      if (TV) { var self = this; inited = false; return void setTimeout(function () { inited = true; self.__init(); }, 4000); }   // TV: after the app is up, never during startup
      this.__init();
    },
    __init: function () {
      all().forEach(function (e) { if (e.auto) { delete db[e.key]; } }); save();   // the old copy-while-watching entries
      all().forEach(function (e) { if (e.state === 'queued') e.notBefore = 0; }); save();   // opening the app retries at once
      var go = function () { if (TV) { rmFile('selftest.bin'); rmFile('selftest-b.bin'); } reconcile(function () { recover(); sweep(); pump(); if (PHONE) poll(); emit(true); takeRequests(); }); };
      if (TV) setInterval(takeRequests, 30000);
      checkOthers(); setInterval(checkOthers, 20000);   // one tiny request every 20 s (LAN on the TV)
      if (!TV) setInterval(function () { if (watching()) checkOthers(); }, 5000);   // phone / web streaming: look every 5 s so the TV can take over quickly
      if (TV) setInterval(tvStallCheck, 10000);   // the TV's downloader can sit silent after a dropped connection (provider busy, 460): watch the byte count
      if (PHONE) { try { var ru = API.homeApi('dlstate'); if (ru && AndroidBridge.dlReportTo) AndroidBridge.dlReportTo(ru + '&me=phone'); } catch (x) {} }
      if (TV) { var stickTries = 0; var stickT = setInterval(function () { if (dir || ++stickTries > 40) { clearInterval(stickT); return; } initTV(function () { if (dir) { reconcile(function () { pump(); emit(true); }); } }); }, 5000);   // cold start: the USB stick mounts a few seconds after the app opens
      initTV(go); try { tizen.filesystem.addStorageStateChangeListener(function () { setTimeout(function () { initTV(function () { reconcile(function () { pump(); emit(true); }); }); }, 1500); }); } catch (e) {} }
      else if (PHONE) { freeSpace(); go(); }
      setInterval(function () { sweep(); pump(); }, 3600000);
    },
    available: function () { return WEB || canHere(); },
    reason: function () { if (TV && !dir) return 'Plug a USB stick into the TV to download'; if (!TV && !PHONE && !WEB) return 'Downloads are not available here'; return ''; },
    where: function () {
      if (TV) return dir ? 'USB stick' + (freeBytes > 0 ? ', ' + mb(freeBytes) + ' free' : '') : 'no USB stick plugged in';
      if (PHONE) return 'phone, Downloads / Los Bebos TV folder' + (freeBytes > 0 ? ', ' + mb(freeBytes) + ' free' : '');
      return 'saved by your browser';
    },
    state: function (it) {
      var e = WEB ? web[key(it)] : db[key(it)]; if (!e) return null;
      return { state: e.state, pct: e.state === 'done' ? 100 : pct(e), got: e.got || 0, total: e.total || 0, info: e.state === 'done' ? 'Ready' : (e.paused ? 'Paused while you watch, ' : '') + info(e) };
    },
    // Download button
    add: function (it) {
      if (WEB) { var ob = othersBusy(); if (ob) return 'The ' + whoName(ob.who) + ' is downloading ' + ob.title + ' (' + (ob.total ? Math.round(100 * ob.got / ob.total) : 0) + '%). Downloads have priority, try again when it is finished.'; webDownload(it); return 'Download started, see your browser\'s downloads'; }
      if (!canHere() && !TV) return this.reason();
      var k = key(it); if (db[k]) { if (db[k].auto) { db[k].auto = false; save(); } return ''; }
      var e = { key: k, kind: it.kind, id: it.id, ext: it.ext || 'mp4', name: it.name, title: titleOf(it), icon: it.icon || '', seriesId: it.seriesId || null, seriesName: it.seriesName || null, aspectKey: it.aspectKey || null, file: fileOf(it), state: 'queued', got: 0, total: 0, created: now(), touched: now(), auto: false, tracks: null };
      db[k] = e; save(); emit(true);
      // remember the track languages for offline play (one small header read, like starting playback)
      if (/mkv$/i.test(e.ext) && window.MKV) MKV.readTracks(urlOf(e)).then(function (r) { if (db[k]) { db[k].tracks = r; save(); } pump(); }).catch(function () { pump(); });
      else pump();
      return busy() && db[k].state === 'queued' ? 'Added to downloads (waiting for the current one)' : 'Downloading...';
    },
    remove: function (it) { var e = db[key(it)]; if (e) removeEntry(e); var w = web[key(it)]; if (w) { delete web[key(it)]; try { fetch(API.homeApi('dlcancel') + '&did=' + encodeURIComponent(w.did), { cache: 'no-store' }); } catch (x) {} emit(true); } },
    removeKey: function (k) { var e = db[k]; if (e) removeEntry(e); },
    // a finished copy: play it instead of the internet stream
    local: function (it) {
      var e = db[key(it)]; if (!e || e.state !== 'done') return null;
      if (TV && dir) return { url: 'file://' + (e.rel ? usbBase + '/' + e.rel : dir + '/' + e.file), tracks: e.tracks, where: 'USB stick' };
      if (PHONE) { var p = ''; try { p = e.rel && AndroidBridge.fsPath ? AndroidBridge.fsPath(e.rel) : AndroidBridge.dlPath(e.file); } catch (x) {} if (p) return { url: 'file://' + encodeURI(p), tracks: e.tracks, where: 'phone' }; }
      return null;
    },
    touch: function (it) { var e = db[key(it)]; if (e) { e.touched = now(); save(); } },
    watched: function (it) { var e = db[key(it)]; if (e) { e.touched = now(); save(); } },   // kept: only manual delete removes copies
    // TV: the title being watched gets copied to the stick in the background; unfinished copies of other titles are dropped
    // The IPTV account gives full speed to ONE stream: a download running next to playback is starved (tested 2026-10-07).
    // So nothing is copied while watching, and a running TV download pauses until playback stops.
    tvPlaying: function () { return tvNow && now() - othersAt < 90000 ? tvNow : null; },   // what the TV plays (also a copy from its stick), for the 'watch along' card
    refreshBusy: function (cb) { checkOthers(cb, 2500); },   // a fresh look right before a stream starts
    priority: function () {
      var h = all().filter(function (e) { return e.state === 'downloading' && !e.paused; })[0];
      if (h && (TV || PHONE)) return { here: true, tv: TV && h.via !== 'laptop', title: h.title, info: info(h) };
      var o = othersBusy(); if (o) return { here: false, playing: !!o.playing, who: whoName(o.who), title: o.title, info: (o.total ? Math.round(100 * o.got / o.total) : 0) + '%' };
      return null;
    },
    playing: function (it) {
      var e = it ? db[key(it)] : null; if (e) { e.touched = now(); save(); }
      if (!TV && !PHONE) return;
      if (it && (it.localUrl || (it.kind !== 'live' && e && e.state === 'done'))) return;   // a copy on the stick / phone uses no stream: the download keeps going
      all().forEach(function (x) { if (x.state === 'downloading' && !x.paused) { try {
        if (TV && x.via !== 'laptop') {   // the TV's paused download keeps the provider's only connection for good (measured 12+ min): drop it, it starts again after watching
          tvStop(x); try { tizen.download.cancel(x.dlId); } catch (er2) {} ev(x, 'stopped for watching (a paused download keeps the provider busy), starts again afterwards');
          x.state = 'queued'; x.got = 0; x.dlId = 0; x.paused = false; x.notBefore = 0; x.tries = 0; x.nresume = 0; x.retrying = false; x.waitWatch = true; rmFile(x.file); save(); emit(true); return;
        }
        x.paused = true; if (TV && x.via === 'laptop') { if (x.phase === 'laptop') lapCall(x, 'pause'); else x.paused = false; } else if (TV && x.resume) tvStop(x); else if (TV) tizen.download.pause(x.dlId); else AndroidBridge.dlPause(x.dlId); save(); emit(true); } catch (er) {} } });
    },
    // phone: Android cannot pause a download. Watching while one runs would break it (one stream per account), so ask first.
    phoneBusy: function () { return false; },   // the app's own downloader pauses while you watch, no question needed
    suspendPhone: function () {   // "Watch anyway": stop the download now, it restarts by itself after playback
      all().forEach(function (x) { if (x.state === 'downloading') { try { AndroidBridge.dlRemove(x.dlId, x.file); } catch (er) {} x.state = 'queued'; x.got = 0; x.dlId = 0; x.notBefore = 0; } });
      save(); emit(true);
    },
    stopped: function () {
      setTimeout(function () {
        if (watching()) return;
        all().forEach(function (x) { if (x.paused) { x.paused = false; try { if (TV && x.via === 'laptop') { if (x.phase === 'laptop') lapCall(x, 'resume'); } else if (TV && x.resume) { if (!tvx[x.key]) tvGet(x); } else if (TV) tizen.download.resume(x.dlId); else AndroidBridge.dlResume(x.dlId); } catch (er) { var s1 = ''; try { s1 = TV ? tizen.download.getState(x.dlId) : ''; } catch (y) {} if (s1 === 'DOWNLOADING' || s1 === 'QUEUED') return; ev(x, 'could not continue after watching (' + (er && er.message) + '), starting again'); x.state = 'queued'; x.got = 0; } } });
        save(); emit(true); pump();
      }, 3000);
    },
    list: function () { return WEB ? [] : list(); },
    fsGen: function () { return fsGen; },
    summary: function () {
      var l = WEB ? [] : list(); if (!l.length) return '';
      var d = l.filter(function (e) { return e.state === 'done'; }).length, a = l.filter(function (e) { return e.state === 'downloading'; })[0], q = l.filter(function (e) { return e.state === 'queued'; }).length;
      return [d ? d + ' ready' : '', a ? 'downloading ' + pct(a) + '%' : '', q ? q + ' waiting' : ''].filter(Boolean).join(', ');
    },
    describe: function (e) {
      if (e.state === 'done') return 'Ready' + (e.total ? ', ' + mb(e.total) : '') + (e.auto ? ' (copied while watching)' : '');
      if (e.state === 'downloading') return (e.paused ? 'Paused while you watch, ' : 'Downloading ') + info(e);
      if (e.tries) return 'Retrying soon (attempt ' + (e.tries + 1) + ' of 3)';
      return 'Waiting';
    },
    folders: function () { var f = {}; all().forEach(function (e) { if (e.folder) f[e.folder] = true; }); return Object.keys(f).sort(); },
    setFolder: function (k, name) { var e = db[k]; if (!e) return; e.folder = name || ''; e.touched = now(); save(); writeMeta(e); emit(true); },
    fs: fsx, VIDEO: VIDEO,
    pct: pct,
    onChange: function (f) { listeners.push(f); },
    usbDir: function () { return TV ? dir : null; }, isTV: TV, isPhone: PHONE, isWeb: WEB
  };
})();
