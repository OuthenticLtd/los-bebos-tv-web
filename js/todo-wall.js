// Live wallpapers from the To Do task "* Background Los Bebos", the same photos on every device:
// the TV reads them from its own notes service, the web copy and the phone from the home laptop (/api/todobg).
// Active only while the Los Bebos home screen is showing: nothing runs during playback.
// One photo stays put; several crossfade every 10 s. While the task has photos they win over a photo picked
// by hand in Settings, which comes back when the task has none.
var TODO_WALL = (function () {
  var cfg = window.TV_TODO_BACKGROUND || {};
  var laptop = !!(window.PREVIEW || window.IS_ANDROID);
  if (!laptop && (!cfg.endpoint || !cfg.apiKey)) return { start: function () {}, active: function () { return false; } };
  var keys = [], urls = {}, sig = '', queue = Promise.resolve(), index = 0, shown = null, front = 0, layers = null, lastPoll = 0;
  var POLL_MS = laptop ? 30000 : 4500;   // the laptop looks at To Do at most once a minute itself
  function manual() { return false; }
  function laptopUrl(extra) { var u = window.API && API.homeApi ? API.homeApi('todobg') : null; return u ? u + (extra || '') : null; }
  function fetchJson(u) { return fetch(u, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw Error('HTTP ' + r.status); return r.json(); }); }
  function homeVisible() { var s = document.getElementById('screen-home'); return !document.hidden && s && !s.classList.contains('hidden'); }
  function xhr(method, path, type, body) { return new Promise(function (resolve, reject) { var x = new XMLHttpRequest(); x.open(method, cfg.endpoint + path); x.timeout = 60000; if (type) x.responseType = type; x.setRequestHeader('X-TV-Notes-Key', cfg.apiKey);
    x.onload = function () { if (x.status === 200 || x.status === 204) resolve(x.response); else reject(Error('HTTP ' + x.status)); }; x.onerror = x.ontimeout = function () { reject(Error('offline')); }; x.send(body || null); }); }
  function setup() { if (layers) return layers; var a = document.getElementById('home-bg'); if (!a) return null; var b = a.cloneNode(false); b.id = 'home-bg2'; b.style.backgroundImage = ''; b.classList.remove('in'); a.parentNode.insertBefore(b, a.nextSibling); layers = [a, b]; front = a.classList.contains('in') ? 0 : 1; return layers; }
  function paint(url) { if (url === shown || !setup()) return; var im = new Image(); im.onload = function () { var next = layers[1 - front]; next.__src = url; next.style.backgroundImage = 'url("' + url + '")'; next.classList.add('in'); layers[front].classList.remove('in'); front = 1 - front; shown = url; }; im.src = url; }
  // Chromium 76 ignores EXIF rotation; newer engines already apply it.
  var autoRotates = window.CSS && CSS.supports && CSS.supports('image-orientation', 'from-image');
  function orientation(buf) { var v = new DataView(buf); if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return 1; var o = 2;
    while (o + 4 < v.byteLength) { var m = v.getUint16(o), len = v.getUint16(o + 2); if (m === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) { var t = o + 10, le = v.getUint16(t) === 0x4949, ifd = t + v.getUint32(t + 4, le), n = v.getUint16(ifd, le);
      for (var i = 0; i < n; i++) { var e = ifd + 2 + i * 12; if (e + 10 > v.byteLength) break; if (v.getUint16(e, le) === 0x0112) return v.getUint16(e + 8, le); } return 1; } if ((m & 0xFF00) !== 0xFF00) break; o += 2 + len; } return 1; }
  function shrink(blob) { return new Promise(function (resolve, reject) { var r = new FileReader(); r.onload = function () { var rot = autoRotates ? 1 : orientation(r.result), url = URL.createObjectURL(blob), img = new Image();
    img.onload = function () { var w = img.naturalWidth, h = img.naturalHeight, turned = rot === 6 || rot === 8, dw = turned ? h : w, dh = turned ? w : h, k = Math.max(1920 / dw, 1080 / dh), x = (1920 - dw * k) / 2, y = (1080 - dh * k) * 0.47;
      var c = document.createElement('canvas'); c.width = 1920; c.height = 1080; var g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
      if (rot === 6) { g.translate(x + dw * k, y); g.rotate(Math.PI / 2); } else if (rot === 8) { g.translate(x, y + dh * k); g.rotate(-Math.PI / 2); } else if (rot === 3) { g.translate(x + dw * k, y + dh * k); g.rotate(Math.PI); } else g.translate(x, y);
      g.drawImage(img, 0, 0, w * k, h * k); URL.revokeObjectURL(url); img.onerror = null; img.src = ''; c.toBlob(function (b) { c.width = c.height = 0; b ? resolve(b) : reject(Error('encode')); }, 'image/jpeg', 0.86); };
    img.onerror = function () { URL.revokeObjectURL(url); reject(Error('decode')); }; img.src = url; }; r.onerror = reject; r.readAsArrayBuffer(blob.slice(0, 131072)); }); }
  function ensure(item) { if (urls[item.key]) return Promise.resolve();
    if (laptop) { var u = laptopUrl('&key=' + item.key); if (!u) return Promise.reject(Error('offline'));   // already shrunk on the laptop, cached by the browser
      return fetch(u).then(function (r) { if (!r.ok) throw Error('HTTP ' + r.status); return r.blob(); }).then(function (b) { if (keys.indexOf(item.key) >= 0) urls[item.key] = URL.createObjectURL(b); }); }
    var path = '/background?key=' + item.key;
    return xhr('GET', path, 'blob').then(function (b) { return item.ready ? b : shrink(b).then(function (small) { return xhr('PUT', path, null, small).then(function () { return small; }, function () { return small; }); }); })
      .then(function (b) { if (keys.indexOf(item.key) >= 0) urls[item.key] = URL.createObjectURL(b); }); }
  function ready() { return keys.filter(function (k) { return urls[k]; }); }
  function show() { var list = ready(); if (!list.length || manual()) return; index %= list.length; paint(urls[list[index]]); }
  function update(items) { var s = JSON.stringify(items); if (s === sig) return; sig = s; keys = items.map(function (i) { return i.key; });
    Object.keys(urls).forEach(function (k) { if (keys.indexOf(k) < 0) { if (urls[k] !== shown) URL.revokeObjectURL(urls[k]); delete urls[k]; } });
    if (!items.length) { shown = null;   // hand the screen back: the crossfade layer must not keep the last To Do photo on top
      if (layers) { layers[1].classList.remove('in'); layers[1].style.backgroundImage = ''; layers[1].__src = null; layers[0].__src = null; front = 0; }
      if (window.BG) BG.apply(); return; }
    items.forEach(function (item) { queue = queue.then(function () { return ensure(item); }).then(function () { if (ready().map(function (k) { return urls[k]; }).indexOf(shown) < 0) show(); }, function () {}); }); }
  function poll() { if (!homeVisible() || Date.now() - lastPoll < POLL_MS) return;
    var u = laptop ? laptopUrl() : null; if (laptop && !u) return;   // phone: the laptop's address is not known yet
    lastPoll = Date.now();
    (laptop ? fetchJson(u) : xhr('GET', '/notes', 'json')).then(function (j) { if (typeof j === 'string') j = JSON.parse(j); if (j && j.backgrounds && Array.isArray(j.backgrounds.losbebos)) update(j.backgrounds.losbebos); }, function () {}); }
  function tick() { if (!homeVisible()) return; poll(); }
  function cycle() { if (!homeVisible() || ready().length < 2 || manual()) return; index = (index + 1) % ready().length; show(); }
  return { active: function () { return ready().length > 0 && !manual(); }, start: function () { poll(); setInterval(tick, 5000); setInterval(cycle, 10000); document.addEventListener('visibilitychange', tick); }, _test: { update: update, ready: ready } };
})();
