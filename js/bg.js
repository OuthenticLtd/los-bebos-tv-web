// Home background: one picture, stored on each device once (localStorage) and shown as plain CSS. Nothing runs while watching.
// Changed from the web or phone (Settings > Background); the TV picks the new picture up once at start-up when it is at home.
var BG = (function () {
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function apply() {
    var el = document.getElementById('home-bg') || document.getElementById('screen-home'); if (!el) return;
    var d = get('doortv.bg');
    if (!d) { el.classList.remove('in'); el.style.backgroundImage = ''; return; }   // no photo: the stylesheet's dark gradient stays
    if (el.__src === d) return; el.__src = d; el.classList.remove('in');
    var img = new Image();   // decode first, then one opacity fade from the dark gradient into the photo (size and position come from the stylesheet)
    img.onload = img.onerror = function () { if (el.__src !== d) return; el.style.backgroundImage = 'url(' + d + ')'; setTimeout(function () { if (el.__src === d) el.classList.add('in'); }, 50); };
    img.src = d;
  }
  function timed(p, ms) { return new Promise(function (res, rej) { var d = false; var t = setTimeout(function () { if (!d) { d = true; rej(new Error('timeout')); } }, ms); p.then(function (v) { if (!d) { d = true; clearTimeout(t); res(v); } }, function (e) { if (!d) { d = true; clearTimeout(t); rej(e); } }); }); }
  function urls() {
    if (window.PREVIEW || window.IS_ANDROID) { var u = API.homeApi('bg'); if (!u) return null; return { ver: u + '&v=1', img: u }; }
    if (!window.PREVIEW && !window.IS_ANDROID && CONFIG.relay) { var b = CONFIG.relay.replace(/\/+$/, ''); return { ver: b + '/relay/bgver', img: b + '/relay/bg.jpg' }; }
    return null;
  }
  function blobToData(blob) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(blob); }); }
  function sync() {
    var u = urls(); if (!u) return Promise.resolve();
    return timed(fetch(u.ver, { cache: 'no-store' }), 2500).then(function (r) { return r.json(); }).then(function (j) {
      var have = Number(get('doortv.bgv') || 0);
      if (!j.v) { if (have) { set('doortv.bg', null); set('doortv.bgv', null); apply(); } return; }
      if (j.v === have) return;
      return timed(fetch(u.img, { cache: 'no-store' }), 15000).then(function (r) { return r.blob(); }).then(blobToData).then(function (d) { if (set('doortv.bg', d)) { set('doortv.bgv', String(j.v)); apply(); } });
    }).catch(function () {});
  }
  // pick a photo, crop to 1920x1080, compress (~250 KB), upload, use
  function choose(done) {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none'; document.body.appendChild(inp);
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0]; document.body.removeChild(inp); if (!f) return;
      var img = new Image(); var url = URL.createObjectURL(f);
      img.onload = function () {
        var c = document.createElement('canvas'); c.width = 1920; c.height = 1080; var g = c.getContext('2d');
        var sc = Math.max(1920 / img.width, 1080 / img.height), w = img.width * sc, h = img.height * sc;
        g.drawImage(img, (1920 - w) / 2, (1080 - h) / 2, w, h); URL.revokeObjectURL(url);
        var q = 0.82, d = c.toDataURL('image/jpeg', q); while (d.length > 450000 && q > 0.4) { q -= 0.1; d = c.toDataURL('image/jpeg', q); }
        set('doortv.bg', d); apply();
        var u = urls(); if (!u) { if (done) done('Saved on this device'); return; }
        fetch(u.img, { method: 'POST', body: d, headers: { 'Content-Type': 'text/plain' } }).then(function (r) { return r.json(); }).then(function (j) { if (j.v) set('doortv.bgv', String(j.v)); if (done) done('Background changed. The TV takes it the next time it starts at home.'); }).catch(function () { if (done) done('Saved here; could not reach the home laptop for the TV'); });
      };
      img.src = url;
    });
    inp.click();
  }
  function reset(done) {
    set('doortv.bg', null); set('doortv.bgv', null); apply();
    var u = urls(); if (u) fetch(u.img + '&reset=1', { cache: 'no-store' }).catch(function () {});
    if (done) done('Back to the dark background');
  }
  var lastCheck = 0;
  function maybeSync() { if (Date.now() - lastCheck < 120000) return; lastCheck = Date.now(); sync(); }   // home screen: at most every 2 minutes, one tiny request
  // TV: the app stays alive in the background, so start-up alone would miss a new picture: look again when the TV wakes and every 10 min (one tiny version request)
  if (!window.PREVIEW && !window.IS_ANDROID) { try { document.addEventListener('visibilitychange', function () { if (!document.hidden) sync(); }); } catch (e) {} setInterval(function () { if (!document.hidden) sync(); }, 600000); }
  return { apply: apply, sync: sync, maybeSync: maybeSync, choose: choose, reset: reset };
})();
