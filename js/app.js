(function () {
  function registerKeys() {
    try {
      var keys = ['ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaRewind', 'MediaFastForward', 'ChannelUp', 'ChannelDown', 'Info', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
      keys.forEach(function (k) { try { tizen.tvinputdevice.registerKey(k); } catch (e) {} });
    } catch (e) {}
  }
  function clock() { var d = new Date(); document.getElementById('clock').textContent = d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) + '  ' + d.toTimeString().slice(0, 5); }
  function status() {
    API.account().then(function (a) { var u = a && a.user_info ? a.user_info : {}; var exp = u.exp_date ? (function (d) { return d.getDate() + ' ' + ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()] + ' ' + d.getFullYear(); })(new Date(Number(u.exp_date) * 1000)) : '?';
      document.getElementById('home-status').textContent = 'Los Bebos TV  |  ' + (window.IS_ANDROID ? (API.viaHome() ? 'via home laptop (Bulgarian connection)' : 'direct') : (window.PREVIEW ? 'via home laptop (Bulgarian connection)' : 'direct')) + '  |  account ' + (u.status || '?') + ', valid until ' + exp;
    }).catch(function (e) { document.getElementById('home-status').textContent = 'Cannot reach ' + CONFIG.server + ' (' + e.message + '). Check Settings.'; });
  }
  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    if (UI.askKey && UI.askKey(k)) { e.preventDefault(); return; }
    if (PLAYER.isActive() && !PLAYER.isPreview()) { if (PLAYER.onKey(e)) e.preventDefault(); return; }
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    var s = UI.current(); var handled = s && s.key ? s.key(k) : false;
    if (!handled && k === 10009) { if (!UI.pop()) { try { tizen.application.getCurrentApplication().exit(); } catch (e2) {} } handled = true; }
    if (handled) e.preventDefault();
  });
  // Fit the 1920x1080 design to whatever canvas the TV gives the app (seen: 2560x1440 on this 4K set).
  function fit() {
    if (window.PREVIEW) return;   // the PC preview scales the page itself
    var sw = window.innerWidth || 1920, sh = window.innerHeight || 1080;
    var sc = Math.min(sw / 1920, sh / 1080);
    window.APP_SCALE = sc;
    var app = document.getElementById('app');
    app.style.transform = 'scale(' + sc + ')';
    app.style.left = Math.round((sw - 1920 * sc) / 2) + 'px'; app.style.top = Math.round((sh - 1080 * sc) / 2) + 'px';
  }
  window.addEventListener('resize', fit);
  function diag(tag, extra) {
    if (!CONFIG.debug) return;
    try {
      var d = { tag: tag, innerW: window.innerWidth, innerH: window.innerHeight, outerW: window.outerWidth, outerH: window.outerHeight, dpr: window.devicePixelRatio, screenW: screen.width, screenH: screen.height, availW: screen.availWidth, availH: screen.availHeight, docW: document.documentElement.clientWidth, docH: document.documentElement.clientHeight, bodyW: document.body.clientWidth, scale: window.APP_SCALE, ua: navigator.userAgent, extra: extra || null };
      try {
        d.scroll = { hw: document.documentElement.scrollWidth, hh: document.documentElement.scrollHeight, bw: document.body.scrollWidth, bh: document.body.scrollHeight, ow: document.documentElement.offsetWidth, oh: document.documentElement.offsetHeight };
        var out = []; var all = document.querySelectorAll('body *');
        for (var i = 0; i < all.length && out.length < 25; i++) { var r = all[i].getBoundingClientRect(); if (r.right > 1921 || r.bottom > 1081 || r.left < -1 || r.top < -1) out.push((all[i].id || all[i].tagName) + '.' + (all[i].className || '') + ' ' + [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(',')); }
        d.outside = out;
        var cs = getComputedStyle(document.documentElement); d.htmlCss = { w: cs.width, h: cs.height, zoom: cs.zoom }; var cb = getComputedStyle(document.body); d.bodyCss = { w: cb.width, h: cb.height, zoom: cb.zoom, m: cb.margin };
        var ca = getComputedStyle(document.getElementById('app')); d.appCss = { w: ca.width, h: ca.height, tr: ca.transform, l: ca.left, t: ca.top };
      } catch (e) { d.scanErr = String(e && e.message); }
      try { d.vv = window.visualViewport ? { w: visualViewport.width, h: visualViewport.height, scale: visualViewport.scale } : null; } catch (e) {}
      try { d.prodRes = webapis.productinfo.getResolution(); d.udPanel = webapis.productinfo.isUdPanelSupported(); } catch (e) { d.prodErr = String(e && e.message); }
      try { tizen.systeminfo.getPropertyValue('DISPLAY', function (r) { d.display = { w: r.resolutionWidth, h: r.resolutionHeight, dpiX: r.dotsPerInchWidth, pw: r.physicalWidth }; send(); }, function () { send(); }); } catch (e) { send(); }
      function send() { var x = new XMLHttpRequest(); x.open('POST', 'http://192.168.100.80:8099/diag', true); x.send(JSON.stringify(d)); }
      return;
      var x = new XMLHttpRequest(); x.open('POST', 'http://192.168.100.80:8099/diag', true); x.send(JSON.stringify(d));
    } catch (e) {}
  }
  window.DIAG = diag;
  // Android "route through home": the home API address is published next to the web copy
  function loadHomeBase() {
    if (!window.IS_ANDROID && !window.PREVIEW) { window.HOME_BASE = CONFIG.viaHome && CONFIG.relay ? CONFIG.relay.replace(/\/+$/, '') : null; return Promise.resolve(); }   // TV: the laptop on the home network, only when switched on
    if (!window.IS_ANDROID && !CONFIG.viaHome) { window.HOME_BASE = null; return Promise.resolve(); }
    return fetch(CONFIG.homeBaseUrl + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (t) { window.HOME_BASE = t.trim(); }).catch(function () { window.HOME_BASE = null; });
  }
  window.loadHomeBase = loadHomeBase;
  window.addEventListener('load', function () {
    if (window.PREVIEW || window.IS_ANDROID) document.body.classList.add('touchmode');
    if (window.IS_ANDROID) document.body.classList.add('phone');
    if (window.IS_ANDROID) document.addEventListener('visibilitychange', function () { if (!document.hidden) loadHomeBase(); });   // back in the app: fetch the current home address
    // phone default: stream through the home laptop (Bulgarian address, never competes with the TV); applied once, the switch is on the home screen
    if (!window.IS_ANDROID && !window.PREVIEW) { var tv0 = null; try { tv0 = localStorage.getItem('doortv.routeDefaultTV'); } catch (e) {} if (!tv0) { CONFIG.viaHome = false; saveConfig(CONFIG); try { localStorage.setItem('doortv.routeDefaultTV', 'direct'); } catch (e) {} } }   // TV default: direct
    if (window.IS_ANDROID) { var rv = null; try { rv = localStorage.getItem('doortv.routeDefault'); } catch (e) {} if (!rv) { CONFIG.viaHome = true; saveConfig(CONFIG); try { localStorage.setItem('doortv.routeDefault', 'home'); } catch (e) {} } }
    fit(); registerKeys(); PLAYER.init(); UI.init();
    BG.apply();
    loadHomeBase().then(function () { return STORE.sync(); }).then(function (ok) { BG.sync(); return ok; }).then(function (ok) { if (ok && UI.current() && UI.current().render) UI.current().render(); }); clock(); setInterval(clock, 30000); status();
    // TV only: stop when the app is sent to the background. The web keeps playing in another tab; the phone stops natively (onStop).
    if (!window.PREVIEW && !window.IS_ANDROID) document.addEventListener('visibilitychange', function () { if (document.hidden && PLAYER.isActive()) PLAYER.stop(); });
    if (!window.PREVIEW && !window.IS_ANDROID) window.addEventListener('pagehide', function () { if (PLAYER.isActive()) PLAYER.stop(); });   // app closed: never leave the provider's one connection open
  });
})();
