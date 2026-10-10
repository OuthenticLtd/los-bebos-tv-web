// Search.
// TV: self-sufficient. Every 3 h (only while nothing plays) it downloads the provider's three full lists onto the USB
// stick with its native downloader, shrinks them in small slices in the background (the screen never stalls) to one
// line per title, and deletes the raw lists. A search loads only that section's names and frees them afterwards.
// Phone / web: ask the home laptop (they already use it for everything else).
window.SEARCH = (function () {
  var TVMODE = !window.IS_ANDROID && !window.PREVIEW, SEP = '\u0001', KINDS = ['live', 'vod', 'series'];
  function norm(t) { t = String(t || ''); try { t = t.normalize('NFD'); } catch (e) {} return t.replace(/[̀-ͯ]/g, '').replace(/[ᴀ-ᶿ⁰-₟ʰ-˿]+/g, '').toLowerCase().replace(/[^a-z0-9Ѐ-ӿ]+/g, ' ').trim(); }
  function meta() { try { return JSON.parse(localStorage.getItem('doortv.sidx') || '{}') || {}; } catch (e) { return {}; } }
  function setMeta(m) { try { localStorage.setItem('doortv.sidx', JSON.stringify(m)); } catch (e) {} }
  // where the list lives: the TV's own storage (no USB stick needed); the stick only if that is not available
  var INT = null; if (TVMODE) { try { tizen.filesystem.resolve('downloads', function (d) { INT = d.fullPath || (d.toURI ? d.toURI().replace(/^file:\/\//, '') : null); }, function () {}, 'rw'); } catch (e) {} }
  function parent() { return INT || (window.DL && DL.usbDir ? DL.usbDir() : null); }
  function folder() { var d = parent(); return d ? d + '/.losbebos-search' : null; }
  function apiUrl(kind) { return CONFIG.server.replace(/\/+$/, '') + '/player_api.php?username=' + encodeURIComponent(CONFIG.username) + '&password=' + encodeURIComponent(CONFIG.password) + '&action=' + (kind === 'vod' ? 'get_vod_streams' : kind === 'series' ? 'get_series' : 'get_live_streams'); }
  function resolve(path, ok, bad) { try { tizen.filesystem.resolve(path, ok, bad || function () {}, 'rw'); } catch (e) { if (bad) bad(e); } }
  function del(name, cb) { var f = folder(); resolve(f, function (d) { try { d.deleteFile(f + '/' + name, function () { cb && cb(); }, function () { cb && cb(); }); } catch (e) { cb && cb(); } }, function () { cb && cb(); }); }
  function slog(o) { try { if (!CONFIG.relay) return; var x = new XMLHttpRequest(); x.open('POST', CONFIG.relay.replace(/\/+$/, '') + '/relay/selftest', true); x.send(JSON.stringify(Object.assign({ search: true, folder: folder() }, o))); } catch (e) {} }
  // stay out of the way: no list work while someone is using the remote (resumes a few seconds after the last key)
  var lastKey = 0; try { document.addEventListener('keydown', function () { lastKey = Date.now(); }, true); } catch (e) {}
  function active(ms) { return Date.now() - lastKey < ms; }
  function busy() { return window.PLAYER && PLAYER.isActive && PLAYER.isActive() && !(PLAYER.isLocal && PLAYER.isLocal()); }

  // ---- building (TV) ----
  var building = false;
  function ensureFolder(cb) {
    var d0 = parent(); if (!d0) return cb(false);
    resolve(d0, function (d) { try { d.resolve('.losbebos-search'); cb(true); } catch (e) { try { d.createDirectory('.losbebos-search'); cb(true); } catch (e2) { cb(false); } } }, function () { cb(false); });
  }
  function shrink(kind, cb) {   // raw-<kind>.json -> <kind>.idx, a slice at a time
    var f = folder(), raw = f + '/raw-' + kind + '.json', idField = kind === 'series' ? 'series_id' : 'stream_id', idRe = new RegExp('"' + idField + '":"?(\\d+)'), n = 0;
    resolve(f, function (d) {
      var out; try { out = d.createFile(kind + '.tmp'); } catch (e) { try { out = d.resolve(kind + '.tmp'); } catch (e2) { return cb(false); } }
      out.openStream('w', function (w) {
        resolve(raw, function (rf) {
          rf.openStream('r', function (r) {
            var buf = '', started = false;
            var step = function () {
              if (busy()) return setTimeout(step, 5000);   // something is playing: wait, the TV's attention goes to the picture
              if (active(2500)) return setTimeout(step, 800);   // the remote is in use: let the screen have the TV
              var lines = '', chunk = ''; try { chunk = r.eof ? '' : r.read(131072); } catch (e) { chunk = ''; }
              buf += chunk;
              if (!started) { var i0 = buf.indexOf('{'); if (i0 >= 0) { buf = buf.slice(i0); started = true; } }
              var cut;
              while (started && (cut = buf.indexOf('},{')) >= 0) { var rec = buf.slice(0, cut + 1); buf = buf.slice(cut + 2); lines += line(rec); }
              var end = r.eof || !chunk;
              if (end && started) { lines += line(buf.replace(/\]\s*$/, '')); buf = ''; }
              if (lines) { try { w.write(lines); } catch (e) {} }
              if (!end) return setTimeout(step, 40);
              try { r.close(); } catch (e) {} try { w.close(); } catch (e) {}
              try { d.moveTo(f + '/' + kind + '.tmp', f + '/' + kind + '.idx', true, function () { del('raw-' + kind + '.json'); cb(n); }, function () { cb(false); }); } catch (e) { cb(false); }
            };
            var pend = '';
            function line(rec) {   // a title containing '},{' splits a record in two: glue the pieces back until it parses
              if (pend) { rec = pend + ',' + rec; pend = ''; }
              var mn = /"name":"((?:[^"\\]|\\.)*)"/.exec(rec), mi = idRe.exec(rec);   // only the two fields we need: much faster than decoding the whole title
              if (!mn || !mi) { if (rec.length < 20000) pend = rec; return ''; }   // a piece of a title split at '},{': glue it to the next piece
              var x = { name: mn[1].indexOf('\\') >= 0 ? (function () { try { return JSON.parse('"' + mn[1] + '"'); } catch (e) { return mn[1]; } })() : mn[1] }; x[idField] = mi[1];
              if (kind === 'vod') { var me = /"container_extension":"(\w+)"/.exec(rec); x.container_extension = me ? me[1] : 'mp4'; } n++; var nm = String(x.name).replace(/[\u0001\n\r]/g, ' ');
              return norm(nm) + SEP + x[idField] + SEP + (kind === 'vod' ? (x.container_extension || 'mp4') : '') + SEP + nm + '\n'; }
            step();
          }, function () { cb(false); }, 'UTF-8');
        }, function () { cb(false); });
      }, function () { cb(false); }, 'UTF-8');
    }, function () { cb(false); });
  }
  function fetchRaw(kind, cb) {   // the TV's own downloader writes it to the stick (nothing big goes through JavaScript)
    del('raw-' + kind + '.json', function () {
      try { tizen.download.start(new tizen.DownloadRequest(apiUrl(kind), folder(), 'raw-' + kind + '.json'), { onprogress: function () {}, oncompleted: function () { cb(true); }, onfailed: function (i, er) { slog({ step: 'download failed', kind: kind, err: er && (er.name + ' ' + er.message) }); cb(false); }, oncanceled: function () { cb(false); } }); }
      catch (e) { slog({ step: 'download threw', kind: kind, err: e.name + ' ' + e.message }); cb(false); }
    });
  }
  var onFresh = null, onChange = null;   // the Search screen re-runs its query when a list was renewed
  function build(only) {
    if (building || !TVMODE || !folder()) return; if (busy()) return;
    // series first: 'is the new episode out?' is the usual question
    var kinds = only ? [only] : ['series', 'vod', 'live']; building = true; var m = meta(), got = Object.assign({}, m.n || {}), i = 0, changed = false; m.kat = m.kat || {}; slog({ step: 'start', storage: INT ? 'tv' : 'usb' });
    ensureFolder(function (ok) {
      if (!ok) { building = false; slog({ step: 'no folder' }); return; }
      (function next() {
        if (i >= kinds.length) { building = false; if (!only) m.at = Date.now(); m.n = got; setMeta(m); if (changed && onFresh) onFresh(); if (changed && onChange) onChange(); return; }
        var k = kinds[i++]; m.kat[k] = Date.now();   // all three right away (series first); only the shrinking pauses while the remote is in use
        var t0 = Date.now();
        fetchRaw(k, function (ok2) { if (!ok2) { building = false; m.failAt = Date.now(); setMeta(m); return; }
          resolve(folder() + '/raw-' + k + '.json', function (rf) {
            var size = rf.fileSize; m.size = m.size || {};
            // same size and rebuilt within 6 h: skip (a same-size change is caught by the 6 h full rebuild)
            m.full = m.full || {}; if (size && m.size[k] === size && (m.n || {})[k] && Date.now() - (m.full[k] || 0) < 6 * 3600 * 1000) { got[k] = m.n[k]; slog({ step: 'unchanged', kind: k, size: size }); return del('raw-' + k + '.json', function () { setTimeout(next, 1000); }); }   // same list as last time: nothing to rebuild
            slog({ step: 'downloaded', kind: k, size: size, secs: Math.round((Date.now() - t0) / 1000) }); var t1 = Date.now();
            shrink(k, function (n) { got[k] = n || 0; if (n) { m.size[k] = size; m.full[k] = Date.now(); changed = true; } slog({ step: 'built', kind: k, titles: n, secs: Math.round((Date.now() - t1) / 1000) }); if (cur && cur.kind === k) cur = null; setTimeout(next, 300); });
          }, function () { building = false; slog({ step: 'raw file not found', kind: k }); });
        });   // one list at a time
      })();
    });
  }
  // the TV is only on now and then: check as soon as the app opens (if the last check is 10+ min old), then every 30 min
  // while it stays on; only a list that changed is rebuilt, and search keeps working on the previous one meanwhile
  function maybeBuild(age) { var m = meta(); if (Date.now() - (m.at || 0) > age && Date.now() - (m.failAt || 0) > 5 * 60 * 1000) build(); }
  if (TVMODE) { setTimeout(function () { maybeBuild(10 * 60 * 1000); }, 8000); setInterval(function () { maybeBuild(30 * 60 * 1000); }, 5 * 60 * 1000); }

  // ---- searching (TV): one section's names in memory while the Search screen is open ----
  var cur = null;
  function load(kind, cb) {
    if (cur && cur.kind === kind) return cb(cur.blob);
    var f = folder(); if (!f) return cb(null);
    resolve(f + '/' + kind + '.idx', function (file) { file.readAsText(function (t) { cur = { kind: kind, blob: t }; cb(t); }, function () { cb(null); }, 'UTF-8'); }, function () { cb(null); });
  }
  function scan(blob, q, kind, limit) {
    var words = norm(q).split(' ').filter(Boolean), out = [], pos = 0, seen = 0; if (!words.length) return out;
    var w0 = words.slice().sort(function (a, b) { return b.length - a.length; })[0];
    while (out.length < 500) {
      var at = blob.indexOf(w0, pos); if (at < 0) break;
      var ls = blob.lastIndexOf('\n', at) + 1, sep = blob.indexOf(SEP, ls), le = blob.indexOf('\n', at); if (le < 0) le = blob.length;
      pos = le + 1; if (at > sep) continue;
      var n = blob.slice(ls, sep), ok = true; for (var j = 0; j < words.length; j++) if (n.indexOf(words[j]) < 0) { ok = false; break; }
      if (!ok) continue;
      var parts = blob.slice(sep + 1, le).split(SEP), p0 = (' ' + n).indexOf(' ' + words[0]);
      var pref = /^(en|a|bg|uk|us|4k a|gb) /.test(n) ? 0 : 300;
      out.push([(p0 === 0 ? 0 : p0 > 0 ? 1 : 2) * 1000 + pref + n.length, { id: parts[0], ext: parts[1] || null, name: parts.slice(2).join(SEP) }]);
    }
    out.sort(function (a, b) { return a[0] - b[0]; });
    return out.slice(0, limit).map(function (h) { return h[1]; });
  }

  // ---- phone / web: ask the laptop ----
  var seq = 0;
  function remote(q, kind, cb) {
    var u = API.homeApi ? API.homeApi('search') : null; if (!u) return cb(new Error('no home address'));
    u += '&limit=' + (kind ? 60 : 30) + (kind ? '&kind=' + kind : '') + '&q=' + encodeURIComponent(q);
    var my = ++seq, x = new XMLHttpRequest(); x.open('GET', u, true); x.timeout = 8000;
    x.onload = function () { if (my !== seq) return; var r = null; try { r = JSON.parse(x.responseText); } catch (e) {} if (x.status === 200 && r) cb(null, r); else cb(new Error('HTTP ' + x.status)); };
    x.onerror = x.ontimeout = function () { if (my === seq) cb(new Error('home laptop not reachable')); };
    x.send();
  }
  function find(q, kind, cb) {
    if (!TVMODE) return remote(q, kind, cb);
    var kinds = kind ? [kind] : KINDS, res = { live: [], vod: [], series: [] }, i = 0, my = ++seq;
    (function next() {
      if (my !== seq) return;
      if (i >= kinds.length) return cb(null, res);
      var k = kinds[i++];
      load(k, function (blob) {
        if (!blob) { var m = meta(); return cb(new Error(building || !m.at ? 'The search list is being prepared on the TV (a few minutes, only the first time).' : 'The search list is missing, rebuilding it now.')); }
        res[k] = scan(blob, q, k, kind ? 60 : 30); next();
      });
    })();
  }
  function freshen(kind, cb) {   // opening Search: renew that section's list if it is older than 10 minutes (one request)
    if (!TVMODE || !kind) return false; var m = meta(); if (Date.now() - ((m.kat || {})[kind] || m.at || 0) < 600000 || building) return false;
    onFresh = cb; build(kind); return building;
  }
  return { find: find, freshen: freshen, watch: function (cb) { onChange = cb; }, updating: function () { return building; }, release: function () { cur = null; onFresh = null; onChange = null; }, rebuild: build, status: function () { return { meta: meta(), building: building, folder: folder(), busy: busy() }; } };
})();
