// Platform shim. On the Samsung TV this does nothing (real webapis/tizen exist). In the Android app it maps
// the TV player API onto the native bridge, adds touch input and the Cast button. In the PC preview, stub.js runs instead.
(function () {
  var isAndroid = typeof window.AndroidBridge !== 'undefined';
  window.IS_ANDROID = isAndroid;
  if (!isAndroid) return;
  var B = window.AndroidBridge;
  window.LOCAL_CONFIG = window.LOCAL_CONFIG || {}; window.LOCAL_CONFIG.posFactor = '1';
  window.tizen = { tvinputdevice: { registerKey: function () {} }, application: { getCurrentApplication: function () { return { exit: function () { B.exitApp(); } }; } }, systeminfo: { getPropertyValue: function (k, ok) { ok({ resolutionWidth: 1920, resolutionHeight: 1080 }); } } };
  var listener = null, timer = 0, lastState = 'NONE';
  var handlers = {};
  window.__native = { emit: function (name, payload) {
    if (name === 'onsubtitlechange') { if (listener && listener.onsubtitlechange) listener.onsubtitlechange(payload.d, payload.t); return; }
    if (name === 'onbufferingstart' || name === 'onbufferingcomplete' || name === 'onstreamcompleted') { if (listener && listener[name]) listener[name](); return; }
    if (name === 'onerror') { if (window.PHONE_LOG) window.PHONE_LOG('playerError', payload); if (listener && listener.onerror) listener.onerror(payload); return; }
    if (handlers[name]) handlers[name].forEach(function (f) { f(payload); });
  } };
  function on(name, f) { (handlers[name] = handlers[name] || []).push(f); }
  window.__nativeOn = on;
  window.__tvKey = function (code) { var ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true }); Object.defineProperty(ev, 'keyCode', { get: function () { return code; } }); document.dispatchEvent(ev); };
  window.webapis = { avplay: {
    open: function (url) { if (window.PHONE_LOG) window.PHONE_LOG('open', url.replace(/\/\/[^/]+\/(live|movie|series)\/[^/]+\/[^/]+\//, '//host/$1/***/')); B.open(url); }, close: function () { clearInterval(timer); B.close(); }, stop: function () { clearInterval(timer); B.stop(); },
    setDisplayRect: function (x, y, w, h) { B.setDisplayRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); },
    setDisplayMethod: function (m) { B.setDisplayMethod(m); }, setListener: function (l) { listener = l; }, setStreamingProperty: function () {},
    prepareAsync: function (ok, fail) {
      var done = false;
      var h = function () { if (done) return; done = true; handlers.ready = (handlers.ready || []).filter(function (f) { return f !== h; }); ok(); };
      on('ready', h); B.prepare();
      setTimeout(function () { if (!done && lastState !== 'PLAYING') { /* still buffering: let the player keep trying */ } }, 20000);
    },
    getDuration: function () { return B.getDuration(); }, getState: function () { return B.getState(); },
    play: function () { B.play(); clearInterval(timer); timer = setInterval(function () { var t = B.getPosition(); if (listener && listener.oncurrentplaytime) listener.oncurrentplaytime(t); }, 1000); },
    pause: function () { B.pause(); }, seekTo: function (ms) { B.seekTo(ms); },
    getTotalTrackInfo: function () { try { return JSON.parse(B.getTotalTrackInfo()); } catch (e) { return []; } },
    setSelectTrack: function (type, index) { B.setSelectTrack(type, String(index)); }, setSilentSubtitle: function (s) { B.setSilentSubtitle(!!s); }
  } };
  // ---- casting ----
  // Google Cast (Chromecast / Google TV / Cast-enabled TVs on this Wi-Fi), like YouTube's Cast button
  window.CAST = {
    devices: [], active: null, status: null,
    discover: function (cb) { handlers.castDevices = []; on('castDevices', function (list) { window.CAST.devices = list || []; if (cb) cb(window.CAST.devices); }); B.castDiscover(); },
    play: function (id, url, title, posMs) { window.CAST.status = null; if (B.castPlayAt) B.castPlayAt(id, url, title || '', Math.round(posMs || 0)); else B.castPlay(id, url, title || ''); },
    control: function (cmd, posMs) { if (B.castControl) B.castControl(cmd, Math.round(posMs || 0)); },
    stop: function () { if (window.CAST.active) B.castStop(window.CAST.active.id); window.CAST.active = null; window.CAST.status = null; },
    serve: function (url, mime) { try { return B.castServe ? B.castServe(url, mime || 'video/mp4') : ''; } catch (e) { return ''; } },   // a downloaded copy, offered on this phone's Wi-Fi address for the TV
    serveStop: function () { try { if (B.castServeStop) B.castServeStop(); } catch (e) {} },
    mirror: function () { try { return !!(B.openMirrorSettings && B.openMirrorSettings()); } catch (e) { return false; } }
  };
  on('castStatus', function (st) { window.CAST.status = st; if (window.PLAYER && PLAYER.castStatus) PLAYER.castStatus(st); });
  on('castEnded', function () { window.CAST.active = null; window.CAST.status = null; if (window.PLAYER && PLAYER.castEnded) PLAYER.castEnded(); });
  window.PHONE_LOG = function (tag, extra) {
    try { if (!window.HOME_BASE || !window.API || !API.homeApi) return; var u = API.homeApi('diag'); if (!u) return;
      fetch(u, { method: 'POST', body: JSON.stringify({ tag: tag, extra: extra, t: Date.now(), ua: navigator.userAgent.slice(0, 120) }), headers: { 'Content-Type': 'text/plain' } }).catch(function () {}); } catch (e) {}
  };
  window.addEventListener('error', function (e) { window.PHONE_LOG('jsError', String(e.message) + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno); });
  on('onerror', function () {});
  on('castStarted', function (d) { window.CAST.active = d; if (window.UI) UI.toast('Playing on ' + d.name, 3000); });
  on('castDevices', function (l) { if (window.PHONE_LOG) window.PHONE_LOG('castDevices', (l || []).map(function (d) { return d.name; })); });
  on('castError', function (m) { if (window.PHONE_LOG) window.PHONE_LOG('castError', m); });
  on('castError', function (m) { if (window.UI) UI.toast('Cast: ' + m, 4000); });
  // ---- fit the 1920x1080 design to the phone screen (height-fitted, centred), same mapping as the native video rect ----
  // upright phone: a 1080x1920 canvas with its own layout (.portrait); sideways: the usual 1920x1080. The native video
  // window uses the same mapping (MainActivity.applyRect picks the design size from the view's orientation).
  var lastPortrait = null, NAV = { l: 0, t: 0, r: 0, b: 0 };
  // Android's navigation buttons (sent by the app in screen pixels): the page canvas keeps clear of them; the video itself still fills the screen
  window.NAV_INSETS = function (l, t, r, b) { var d = window.devicePixelRatio || 1; NAV = { l: l / d, t: t / d, r: r / d, b: b / d }; fit(); };
  function fit() {
    var app = document.getElementById('app'); if (!app) return;
    try { if (B.getNavInsets) { var ni = JSON.parse(B.getNavInsets()), d0 = window.devicePixelRatio || 1; NAV = { l: ni[0] / d0, t: ni[1] / d0, r: ni[2] / d0, b: ni[3] / d0 }; } } catch (e) {}
    // upright: 1080 wide and as tall as the phone really is (S26: ~1080x2400), so no black bands top and bottom
    // sideways: 1080 high and as WIDE as the phone really is (S26: ~2400x1080), so screens and player controls use the whole screen
    var aw = Math.max(200, window.innerWidth - NAV.l - NAV.r), ah = Math.max(200, window.innerHeight - NAV.t - NAV.b);
    var por = ah > aw, W = por ? 1080 : Math.max(1920, Math.round(1080 * aw / ah)), H = por ? Math.max(1920, Math.round(1080 * ah / aw)) : 1080;
    app.style.width = W + 'px'; app.style.height = H + 'px';
    try { if (B.setDesign) B.setDesign(W, H); } catch (e) {}
    window.DESIGN_W = W; window.DESIGN_H = H;
    if (document.body) { document.body.classList.toggle('portrait', por); document.body.classList.toggle('wide', !por && W > 1920); }
    var s = Math.min(aw / W, ah / H);
    app.style.transformOrigin = '0 0'; app.style.transform = 'scale(' + s + ')';
    app.style.left = Math.round(NAV.l + (aw - W * s) / 2) + 'px'; app.style.top = Math.round(NAV.t + (ah - H * s) / 2) + 'px'; window.APP_SCALE = 1;
    if (lastPortrait !== null && lastPortrait !== por && window.PLAYER && PLAYER.relayout) { PLAYER.relayout(); setTimeout(PLAYER.relayout, 120); setTimeout(PLAYER.relayout, 450); }
    lastPortrait = por;
  }
  window.PREVIEW = true; // disables the app's own fit()
  // phone: no page zoom / pull-to-refresh / text selection fighting the app; lists scroll natively (touchmode)
  var st = document.createElement('style');
  st.textContent = 'html,body{touch-action:none;overscroll-behavior:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;background:transparent !important;} #app{background:transparent;} input,textarea{touch-action:manipulation;-webkit-user-select:text;user-select:text;}';
  (document.head || document.documentElement).appendChild(st);
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  window.addEventListener('load', function () { fit(); setTimeout(fit, 300); }); window.addEventListener('resize', fit);
})();
