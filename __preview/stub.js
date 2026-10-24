// Stand-in for the Samsung TV APIs when the app runs in a PC browser (preview). Video is a placeholder box.
window.tizen = { tvinputdevice: { registerKey: function () {} }, application: { getCurrentApplication: function () { return { exit: function () { alert('On the TV this exits the app'); } }; } }, systeminfo: { getPropertyValue: function (k, ok) { ok({ resolutionWidth: 1920, resolutionHeight: 1080 }); } } };
(function () {
  // Real HTML5 playback for the web copy: HLS via hls.js (live), progressive <video> for files. Positioned like the TV video plane.
  var state = 'NONE', listener = null, video = null, hls = null, curUrl = '', label = null, lastT = 0, vod = null; // vod = { base, offset, duration, sub, audio, sid, track, cues, timer }
  function ensureVideo() {
    if (video) return video;
    video = document.createElement('video'); video.id = 'web-video'; video.playsInline = true; video.autoplay = false; video.controls = false; video.crossOrigin = 'anonymous';
    video.style.cssText = 'position:absolute;left:0;top:0;width:1920px;height:1080px;background:#000;object-fit:contain;z-index:0;display:none;';
    var app = document.getElementById('app'); app.insertBefore(video, app.firstChild);
    video.addEventListener('timeupdate', function () {
      lastT = (vod ? vod.offset : 0) + video.currentTime * 1000; if (listener && listener.oncurrentplaytime) listener.oncurrentplaytime(lastT);
      if (vod && vod.cueList && !vod.silent) { var t = video.currentTime, list = vod.cueList; for (var i = 0; i < list.length; i++) { var c = list[i]; if (t >= c.s && t <= c.e) { if (vod.lastCue !== i) { vod.lastCue = i; if (listener && listener.onsubtitlechange) listener.onsubtitlechange(Math.round((c.e - t) * 1000), c.t); } return; } } }
    });
    video.addEventListener('waiting', function () { video.__buffering = true; if (listener && listener.onbufferingstart) listener.onbufferingstart(); });
    // a playhead that stops while data is buffered ahead (seen after the tab was in the background) is nudged back into motion; a "Buffering" note goes away as soon as time moves again
    (function () { var lastT = -1, still = 0;
      function nudge() { try { var b = video.buffered, t = video.currentTime; for (var i = 0; i < b.length; i++) { if (b.end(i) > t + 1) { video.currentTime = Math.max(t, b.start(i)) + 0.05; break; } } video.play().catch(function () {}); } catch (e) {} }
      setInterval(function () { if (!video.src || video.paused || state !== 'PLAYING') { lastT = -1; still = 0; return; } var t = video.currentTime;
        if (t !== lastT) { lastT = t; still = 0; if (video.__buffering) { video.__buffering = false; if (listener && listener.onbufferingcomplete) listener.onbufferingcomplete(); } return; }
        if (++still >= 3) { still = 0; nudge(); } }, 2000);
      document.addEventListener('visibilitychange', function () { if (!document.hidden && video.src && state === 'PLAYING') setTimeout(function () { if (video.paused || video.currentTime === lastT) nudge(); }, 600); });
    })();
    video.addEventListener('playing', function () { state = 'PLAYING'; showLabel(''); if (vod) vod.retries = 0; if (listener && listener.onbufferingcomplete) listener.onbufferingcomplete(); });
    video.addEventListener('pause', function () { if (state === 'PLAYING') state = 'PAUSED'; });
    video.addEventListener('ended', function () { if (listener && listener.onstreamcompleted) listener.onstreamcompleted(); });
    video.addEventListener('error', function () { var e = video.error;
      if (vod && e && (e.code !== 4 || /h264|avc/i.test(vod.video || '')) && (vod.retries || 0) < 6) { vod.retries = (vod.retries || 0) + 1; showLabel('Connection hiccup, reconnecting (' + vod.retries + '/6)...'); var at = vod.offset + Math.round((video.currentTime || 0) * 1000); return setTimeout(function () { if (vod) startVod(at); }, Math.min(3000 * vod.retries, 12000)); } var why = e && e.code === 4 ? (vod && /hevc|h265/i.test(vod.video || '') ? 'This film is HEVC and this device/browser has no HEVC decoder. Try Edge or Chrome on a PC with hardware HEVC, the phone app, or the TV.' : 'This browser cannot play this file format. It plays on the TV and in the phone app.') : 'Playback error ' + (e && e.code); if (listener && listener.onerror) listener.onerror(why); });
    return video;
  }
  function showLabel(txt) { if (!label) { label = document.createElement('div'); label.style.cssText = 'position:absolute;color:#cfd6df;font:600 26px sans-serif;text-align:center;pointer-events:none;z-index:1;transform:translate(-50%,-50%);'; document.getElementById('app').appendChild(label); } label.textContent = txt || ''; label.style.display = txt ? 'block' : 'none'; if (video) { label.style.left = (parseFloat(video.style.left) + parseFloat(video.style.width) / 2) + 'px'; label.style.top = (parseFloat(video.style.top) + parseFloat(video.style.height) / 2) + 'px'; } }
  function startVod(ms) {
    if (!vod || !video) return;
    clearInterval(vod.timer); vod.offset = ms; vod.sid = Math.random().toString(36).slice(2, 14); vod.cues = 0;
    var url = vod.base + '?remux=1&t=' + Math.floor(ms / 1000) + '&audio=' + vod.audio + '&sid=' + vod.sid + (vod.sub >= 0 ? '&sub=' + vod.sub : '');
    video.src = url; video.load(); if (state === 'PLAYING') video.play().catch(function () {});
    vod.cueList = []; vod.lastCue = -1;
    if (vod.sub >= 0) {
      var poll = function () {
        if (!vod || !vod.sid) return;
        fetch(vod.base + '?subs=1&sid=' + vod.sid, { cache: 'no-store' }).then(function (r) { return r.status === 200 ? r.text() : ''; }).then(function (txt) { vod.cueList = parseVtt(txt); }).catch(function () {});
      };
      vod.timer = setInterval(poll, 4000); setTimeout(poll, 1500);
    }
  }
  function parseVtt(txt) {
    var out = [], lines = txt.split(/\r?\n/), i = 0;
    function ts(x) { var p = x.trim().split(':'); var sec = parseFloat(p.pop().replace(',', '.')); var m = p.length ? parseInt(p.pop()) : 0; var h = p.length ? parseInt(p.pop()) : 0; return h * 3600 + m * 60 + sec; }
    while (i < lines.length) {
      var l = lines[i];
      if (l.indexOf('-->') > 0) { var parts = l.split('-->'); var st = ts(parts[0]), en = ts(parts[1].split(' ')[1] || parts[1]); var text = []; i++; while (i < lines.length && lines[i].trim() !== '') { text.push(lines[i]); i++; } out.push({ s: st, e: en, t: text.join('\n').replace(/<[^>]+>/g, '') }); }
      i++;
    }
    return out;
  }
  // seek-bar preview pictures were removed on purpose: they opened extra provider connections and made playback answer "busy"
  function destroyHls() { if (window.FXA) FXA.detach(); if (hls) { try { hls.destroy(); } catch (e) {} hls = null; } }
  window.webapis = { avplay: {
    open: function (url) { var v = ensureVideo(); destroyHls(); curUrl = url; state = 'IDLE'; v.style.display = 'block'; showLabel(''); window.__tcTried = null; },
    close: function () { if (vod) { clearInterval(vod.timer); vod = null; } destroyHls(); if (video) { try { video.pause(); } catch (e) {} video.removeAttribute('src'); video.load(); video.style.display = 'none'; } state = 'NONE'; showLabel(''); },
    stop: function () { destroyHls(); if (video) { try { video.pause(); } catch (e) {} video.removeAttribute('src'); video.load(); } state = 'IDLE'; },
    setDisplayRect: function (x, y, w, h) { var v = ensureVideo(); v.style.left = x + 'px'; v.style.top = y + 'px'; v.style.width = w + 'px'; v.style.height = h + 'px'; if (label && label.style.display !== 'none') showLabel(label.textContent); },
    setDisplayMethod: function (m) { if (video) video.style.objectFit = m === 'PLAYER_DISPLAY_MODE_FULL_SCREEN' ? 'fill' : m === 'PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO' ? 'cover' : 'contain'; },
    setListener: function (l) { listener = l; }, setStreamingProperty: function () {},
    prepareAsync: function (ok, fail) {
      var v = ensureVideo(); var done = false;
      function ready() { if (done) return; done = true; state = 'READY'; ok(); }
      v.addEventListener('loadedmetadata', ready, { once: true });
      if (!/\.m3u8(\?|$)/i.test(curUrl) && /\/api\/(movie|series)\//.test(curUrl)) {
        // film / episode: ask the laptop for duration + codecs, then play the repackaged stream
        fetch(curUrl + '?probe=1', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (info) {
          if (info.error) throw new Error(info.error);
          var ft = window.__fileTracks || { audio: [], text: [] };
          function isEn(l, n) { return /^(en|eng|english)\b|^en-/i.test(l || '') || /\benglish\b/i.test(n || ''); }
          var sub = -1; ft.text.forEach(function (t, i) { if (sub < 0 && isEn(t.lang, t.name) && !t.forced && !/sdh|hearing/i.test(t.name || '')) sub = i; });
          if (sub < 0) ft.text.forEach(function (t, i) { if (sub < 0 && isEn(t.lang, t.name) && !t.forced) sub = i; });
          if (sub < 0) ft.text.forEach(function (t, i) { if (sub < 0 && isEn(t.lang, t.name)) sub = i; });
          var aud = 0; if (!isEn((ft.audio[0] || {}).lang, (ft.audio[0] || {}).name)) ft.audio.forEach(function (t, i) { if (aud === 0 && isEn(t.lang, t.name)) aud = i; });
          vod = { base: curUrl, offset: 0, duration: Math.round((info.duration || 0) * 1000), video: info.video, sub: sub, audio: aud, tracks: ft, sid: '', track: null, cues: 0, timer: 0, silent: false };
          if (info.video && !/h264|avc|hevc|h265/i.test(info.video)) showLabel('Video codec ' + info.video + ' is not playable in a browser');
          startVod(0);
        }).catch(function (e) { if (listener && listener.onerror) listener.onerror('Could not prepare the film: ' + e.message); if (fail && !done) { done = true; fail(e.message); } });
        setTimeout(function () { if (!done && fail) { done = true; fail('timeout'); } }, 45000);
        return;
      }
      vod = null;
      // a picture this browser cannot decode (4K HEVC): the laptop converts the channel to h264
      function startTc(liveId, mode) {
        window.__tcTried = liveId + ':' + mode; showLabel('Converting this channel for your browser, about 15 seconds...');
        var apiBase = curUrl.slice(0, curUrl.indexOf('/api/live/')) + '/api/tc/start?id=' + liveId + '&username=pages&password=' + encodeURIComponent((window.LOCAL_CONFIG || {}).password || '');
        destroyHls();
        fetch(apiBase, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
          if (!j.sid) throw new Error('no converter');
          var plUrl = curUrl.slice(0, curUrl.indexOf('/api/live/')) + '/api/tc/' + j.sid + '/index.m3u8';
          hls = new Hls({ enableWorker: true, manifestLoadingMaxRetry: 20, manifestLoadingRetryDelay: 1500, levelLoadingMaxRetry: 20, fragLoadingMaxRetry: 6 });   // start on the first converted piece
          hls.on(Hls.Events.MANIFEST_PARSED, function () { showLabel(''); v.play().catch(function () {}); if (!done) { done = true; if (ok) ok(); } });
          hls.on(Hls.Events.ERROR, function (ev2, d2) { if (!d2.fatal || /manifestLoad/i.test(d2.details)) return; if (listener && listener.onerror) listener.onerror('Converted stream failed: ' + d2.details); });
          hls.loadSource(plUrl); hls.attachMedia(v);
        }).catch(function (e2) { if (listener && listener.onerror) listener.onerror('This channel uses a codec this browser cannot decode and the laptop could not convert it (' + e2.message + ').'); });
      }
      function canPlayAudio(codec) { try { return !!(window.MediaSource && MediaSource.isTypeSupported('audio/mp4; codecs="' + codec + '"')); } catch (e) { return false; } }
      if (/\.m3u8(\?|$)/i.test(curUrl) && window.Hls && Hls.isSupported()) {
        hls = new Hls({ fLoader: window.FXA ? FXA.loader() : undefined, enableWorker: true, lowLatencyMode: false, backBufferLength: 30, manifestLoadingMaxRetry: 8, manifestLoadingRetryDelay: 2000, manifestLoadingMaxRetryTimeout: 10000, levelLoadingMaxRetry: 8, fragLoadingMaxRetry: 8 });
        if (window.FXA) FXA.attach(hls, v);   // a channel sound this browser cannot decode (Firefox: AC3 / E-AC3) is decoded in the page
        hls.on(Hls.Events.ERROR, function (ev, data) {
          if (!data.fatal) return;
          var why = data.details || data.type;
          var codecProblem = /bufferAppendError|bufferAddCodecError|fragParsingError|manifestIncompatibleCodecs|bufferIncompatibleCodecsError/i.test(why);
          var liveId = (/\/api\/live\/pages\/[^/]+\/(\d+)\.m3u8/.exec(curUrl) || [])[1];
          if (codecProblem && liveId && window.__tcTried !== liveId + ':video') { startTc(liveId, 'video'); return; }
          if (codecProblem) why = 'This channel uses a codec browsers cannot decode (usually 4K HEVC or Dolby audio). Try the HD version of the channel; the TV and the phone app play it.';
          else if (/manifestLoadError|levelLoadError|fragLoadError/i.test(why)) why = 'The provider did not deliver this channel. Usually another screen (TV, phone or a film here) is still using the single stream of the subscription; wait a few seconds and try again.';
          if (listener && listener.onerror) listener.onerror(why); if (fail && !done) { done = true; fail(why); }
        });
        hls.loadSource(curUrl); hls.attachMedia(v);
      } else { v.src = curUrl; v.load(); }
      var waited = 0; (function tick() { setTimeout(function () { if (done) return; waited += 5; var limit = window.__tcTried ? 120 : 30; if (waited >= limit) { done = true; if (fail) fail(window.__tcTried ? 'conversion did not start in time' : 'timeout'); } else tick(); }, 5000); })();
    },
    getDuration: function () { if (vod) return vod.duration; var d = video ? video.duration : 0; return isFinite(d) && d > 0 ? Math.round(d * 1000) : 0; },
    getState: function () { return state; },
    play: function () { if (video) { var p = video.play(); state = 'PLAYING'; if (p && p.catch) p.catch(function (e) { if (e && e.name === 'NotAllowedError') showLabel('Click or tap once to start the sound'); }); } },
    pause: function () { if (video) { video.pause(); state = 'PAUSED'; } },
    seekTo: function (ms) { if (!video) return; if (vod) { startVod(ms); return; } video.currentTime = ms / 1000; },
    getTotalTrackInfo: function () {
      var out = [];
      if (vod) {
        (vod.tracks.audio || []).forEach(function (t, i) { out.push({ index: 'a' + i, type: 'AUDIO', extra_info: JSON.stringify({ language: t.lang || '', track_name: t.name || '', selected: i === vod.audio }) }); });
        (vod.tracks.text || []).forEach(function (t, i) { out.push({ index: 's' + i, type: 'TEXT', extra_info: JSON.stringify({ language: t.lang || '', track_name: t.name || '', forced: !!t.forced, selected: i === vod.sub }) }); });
        return out;
      }
      if (!hls) return out;
      (hls.audioTracks || []).forEach(function (t, i) { out.push({ index: 'a' + i, type: 'AUDIO', extra_info: JSON.stringify({ language: t.lang || '', track_name: t.name || '' }) }); });
      (hls.subtitleTracks || []).forEach(function (t, i) { out.push({ index: 's' + i, type: 'TEXT', extra_info: JSON.stringify({ language: t.lang || '', track_name: t.name || '' }) }); });
      return out;
    },
    setSelectTrack: function (type, index) { var n = parseInt(String(index).slice(1)); if (vod) { if ((type === 'AUDIO' && n === vod.audio) || (type === 'TEXT' && n === vod.sub && !vod.silent)) return; if (type === 'AUDIO') vod.audio = n; else { vod.sub = n; vod.silent = false; } startVod(vod.offset + Math.round((video.currentTime || 0) * 1000)); return; } if (!hls) return; if (type === 'AUDIO') hls.audioTrack = n; else hls.subtitleTrack = n; },
    setSilentSubtitle: function (s) { if (vod) { vod.silent = !!s; return; } if (hls) hls.subtitleDisplay = !s; }
  } };
  document.addEventListener('click', function () { if (video && state === 'PLAYING' && video.paused) { video.play().catch(function () {}); showLabel(''); } }, true);
  // PC keyboard -> TV remote: Esc/Backspace = Back, r g y b = colour keys, i = Info, PageUp/Down = channel up/down
  var MAP = { Escape: 10009, Backspace: 10009, r: 403, g: 404, y: 405, b: 406, i: 457, PageUp: 427, PageDown: 428, ' ': 10252 };
  function inField(e) { var t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); }
  document.addEventListener('keydown', function (e) { if (inField(e)) return; var code = MAP[e.key]; if (!code) return; e.stopImmediatePropagation(); e.preventDefault(); var ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true }); Object.defineProperty(ev, 'keyCode', { get: function () { return code; } }); document.dispatchEvent(ev); }, true);
  // fit 1920x1080 into the browser window
  // on a phone the web copy takes the phone app's layout: upright = a 1080-wide canvas as tall as the screen (.portrait), sideways = 1080 high and as wide as the screen; same classes, same styles
  var PHONE = (function () { try { return window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900; } catch (e) { return false; } })();
  if (PHONE) { document.documentElement.classList.add('web-phone'); var st0 = document.createElement('style'); st0.textContent = 'html.web-phone #touch-back { bottom: 150px !important; }'; (document.head || document.documentElement).appendChild(st0); }   // above the footer line
  function fitPhone(app) {
    var aw = Math.max(200, window.innerWidth), ah = Math.max(200, window.innerHeight), por = ah > aw, wasPor = document.body.classList.contains('portrait');
    var W = por ? 1080 : Math.max(1920, Math.round(1080 * aw / ah)), H = por ? Math.max(1920, Math.round(1080 * ah / aw)) : 1080;
    app.style.width = W + 'px'; app.style.height = H + 'px'; window.DESIGN_W = W; window.DESIGN_H = H;
    document.body.classList.add('phone'); document.body.classList.toggle('portrait', por); document.body.classList.toggle('wide', !por && W > 1920);
    var s = Math.min(aw / W, ah / H); document.body.style.overflow = 'hidden'; document.body.style.background = '#000'; app.style.transformOrigin = '0 0'; app.style.transform = 'scale(' + s + ')';
    app.style.left = Math.round((aw - W * s) / 2) + 'px'; app.style.top = Math.round((ah - H * s) / 2) + 'px'; var o = document.getElementById('av-player'); if (o) o.style.display = 'none';
    if (wasPor !== por && window.PLAYER && PLAYER.relayout) { setTimeout(PLAYER.relayout, 50); setTimeout(PLAYER.relayout, 400); }
  }
  function fitWin() { var app = document.getElementById('app'); if (!app) return; if (PHONE) return fitPhone(app); var W = Math.max(1920, Math.round(1080 * window.innerWidth / window.innerHeight)); var wasW = window.DESIGN_W;   // wide windows: the canvas is as wide as the window (no black side bars)
    app.style.width = W + 'px'; window.DESIGN_W = W; window.DESIGN_H = 1080; document.body.classList.toggle('wide', W > 1920); if (wasW && wasW !== W && window.PLAYER && PLAYER.relayout) setTimeout(PLAYER.relayout, 50);
    var s = Math.min(window.innerWidth / W, window.innerHeight / 1080); document.body.style.overflow = 'hidden'; document.body.style.background = '#000'; app.style.transformOrigin = '0 0'; app.style.transform = 'scale(' + s + ')'; app.style.left = Math.round((window.innerWidth - W * s) / 2) + 'px'; app.style.top = Math.round((window.innerHeight - 1080 * s) / 2) + 'px'; var o = document.getElementById('av-player'); if (o) o.style.display = 'none'; }
  // full screen: button next to the back arrow, the F key, or double-click anywhere
  function toggleFull() { var d = document; if (d.fullscreenElement) { d.exitFullscreen(); } else { (d.documentElement.requestFullscreen || d.documentElement.webkitRequestFullscreen).call(d.documentElement); } setTimeout(fitWin, 300); }
  document.addEventListener('keydown', function (e) { if (inField(e)) return; if (e.key === 'f' || e.key === 'F') { toggleFull(); } }, true);
  var lastPointer = 'mouse'; document.addEventListener('pointerdown', function (e) { lastPointer = e.pointerType; }, true);
  document.addEventListener('dblclick', function () { if (lastPointer === 'mouse') toggleFull(); });
  document.addEventListener('fullscreenchange', function () { setTimeout(fitWin, 200); });
  window.addEventListener('load', function () { var fb = document.createElement('div'); fb.textContent = '\u26f6'; fb.title = 'Full screen (F)'; var fsz = PHONE ? 104 : 64; fb.style.cssText = 'position:absolute;right:' + (PHONE ? 170 : 120) + 'px;bottom:' + (PHONE ? 150 : 30) + 'px;width:' + fsz + 'px;height:' + fsz + 'px;line-height:' + fsz + 'px;text-align:center;border-radius:50%;background:rgba(29,35,43,.85);color:#fff;font-size:' + (PHONE ? 50 : 32) + 'px;z-index:50;cursor:pointer;'; fb.addEventListener('click', function (e) { e.stopPropagation(); toggleFull(); }); document.getElementById('app').appendChild(fb); });
  window.addEventListener('load', function () { setTimeout(fitWin, 50); if (PHONE) { window.addEventListener('orientationchange', function () { setTimeout(fitWin, 200); setTimeout(fitWin, 700); }); return; } var tag = document.createElement('div'); tag.textContent = 'WEB PREVIEW - Esc = Back, arrows + Enter = remote, F or double-click = full screen'; tag.style.cssText = 'position:fixed;left:8px;bottom:6px;color:#8d99a7;font:14px sans-serif;z-index:99;transition:opacity 1s;'; document.body.appendChild(tag); setTimeout(function () { tag.style.opacity = '0'; setTimeout(function () { tag.remove(); }, 1200); }, 10000); });
  window.addEventListener('resize', fitWin);
  (function () { var me = document.currentScript && document.currentScript.src, s = document.createElement('script'); s.src = (me ? me.replace(/[^/]*$/, '') : '__preview/') + 'fxaudio.js'; s.onload = function () { if (/firefox/i.test(navigator.userAgent)) setTimeout(function () { FXA.preload(); }, 3000); }; document.head.appendChild(s); })();   // the codec, like a browser's own: fetched once, then cached
  var tst = document.createElement('style'); tst.textContent = 'html,body{touch-action:none;overscroll-behavior:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;} input,textarea{touch-action:manipulation;-webkit-user-select:text;user-select:text;} .row,.card,.tile,.btn,.cbtn,.tm-item,.tabs span{cursor:pointer;}'; document.head.appendChild(tst);
  // the app's own fit() must not fight this
  window.APP_SCALE = 1;
})();
