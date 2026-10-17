// TV only: playback through the TV's standard web video player instead of Samsung's AVPlay, because this player
// has a volume of its own that also reaches the optical output (the TV keeps optical at a fixed level and ignores its
// own volume there). Same functions as webapis.avplay, as far as player.js uses them; anything it cannot play falls back to AVPlay.
window.H5 = (function () {
  var v = null, lis = null, state = 'NONE', rect = { x: 0, y: 0, w: 1920, h: 1080 };
  var MAXVOL = 400, VOLKEY = 'doortv.h5vol', vol = (function () { try { var n = Number(localStorage.getItem(VOLKEY)); return isFinite(n) && n >= 0 && n <= MAXVOL && localStorage.getItem(VOLKEY) !== null ? n : 70; } catch (e) { return 70; } })(), muted = false;
  function el() {   // subtitle tracks run in 'showing' mode so the TV loads them; the app draws the text itself, the browser's copy is transparent
    if (v) return v;
    v = document.createElement('video'); v.id = 'h5-video'; v.setAttribute('playsinline', ''); if (!document.getElementById('h5-cue-css')) { var cs = document.createElement('style'); cs.id = 'h5-cue-css'; cs.textContent = '#h5-video::cue{color:transparent;background:transparent;}'; document.head.appendChild(cs); } v.preload = 'auto';
    v.style.cssText = 'position:absolute;left:0;top:0;width:1920px;height:1080px;background:#000;object-fit:contain;z-index:0;display:none;';
    var app = document.getElementById('app'); app.insertBefore(v, app.firstChild);
    v.addEventListener('loadedmetadata', function () { recovering = false; });
    v.addEventListener('timeupdate', function () { if (lis && lis.oncurrentplaytime) lis.oncurrentplaytime(Math.round(v.currentTime * 1000)); pollText(); });
    v.addEventListener('waiting', function () { if (lis && lis.onbufferingstart) lis.onbufferingstart(); });
    v.addEventListener('playing', function () { if (state !== 'PAUSED') state = 'PLAYING'; if (lis && lis.onbufferingcomplete) lis.onbufferingcomplete(); });
    v.addEventListener('ended', function () { var d = isFinite(v.duration) ? v.duration : 0; if (eng && d > 0 && v.currentTime < d - 30) { hl('ignored a false end at ' + Math.round(v.currentTime) + ' s of ' + Math.round(d)); return; } if (lis && lis.onstreamcompleted) lis.onstreamcompleted(); });   // our reader: the end counts only near the real end
    v.addEventListener('error', function () { var c = v.error ? v.error.code : 0; if (!v.getAttribute('src')) return; hl('video error ' + c + (v.error && v.error.message ? ' ' + v.error.message : '')); if (!eng && skipped && !retried && window.MKVMSE) { retried = true; skipped = false; recovering = true; hl('web player cannot decode it directly: through the reader after all'); var pl0 = state === 'PLAYING'; mseNeedText = false; try { engStart(srcUrl, -1, 0, pl0); if (pl0) { var pp = v.play(); if (pp && pp.catch) pp.catch(function () {}); } return; } catch (x) { eng = null; } } if (eng) { try { eng.destroy(); } catch (e) {} return engFail('media error ' + c); } if (lis && lis.onerror) lis.onerror(c === 4 ? 'PLAYER_ERROR_NOT_SUPPORTED_FILE' : 'PLAYER_ERROR_CONNECTION_FAILED'); });
    applyVol();
    return v;
  }
  var repT = null, autoRep = null, hlog = [];
  function hl(x) { hlog.push(new Date().toISOString().slice(11, 19) + ' ' + x); if (hlog.length > 30) hlog.shift(); }
  // Matroska files go through mse.js when asked (player.js): we read the file ourselves, so the subtitles come out too
  var eng = null, mseNext = false, mseNeedText = false, mseAllowed = false, mseCan = false, boostTried = false, boostT = null, skipped = false, retried = false, recovering = false, srcUrl = '', subTick = null, subCv = null, lastImg = null;
  function placeImg() {   // picture subtitles are drawn in the film's own pixel grid, stretched over the picture
    if (!subCv || !lastImg) return;
    var fill = v.style.objectFit === 'fill', vw = v.videoWidth || lastImg.vw || 1920, vh = v.videoHeight || lastImg.vh || 1080, x = rect.x, y = rect.y, w = rect.w, h = rect.h;
    if (!fill) { var sc = Math.min(rect.w / vw, rect.h / vh); w = vw * sc; h = vh * sc; x = rect.x + (rect.w - w) / 2; y = rect.y + (rect.h - h) / 2; }
    subCv.style.left = x + 'px'; subCv.style.top = y + 'px'; subCv.style.width = w + 'px'; subCv.style.height = h + 'px';
  }
  function showImg(img) {
    if (img === lastImg) return; lastImg = img;
    if (!subCv) { if (!img) return; subCv = document.createElement('canvas'); subCv.id = 'h5-subimg'; subCv.style.cssText = 'position:absolute;z-index:0;pointer-events:none;display:none;'; if (v.nextSibling) v.parentNode.insertBefore(subCv, v.nextSibling); else v.parentNode.appendChild(subCv); }
    if (!img) { subCv.style.display = 'none'; return; }
    subCv.width = img.vw || 1920; subCv.height = img.vh || 1080;
    var ctx = subCv.getContext('2d'); ctx.clearRect(0, 0, subCv.width, subCv.height);
    try { img.draw(ctx); } catch (e) {}
    placeImg(); subCv.style.display = 'block';
  }
  function engStart(url, audio, at, resume) {
    eng = MKVMSE.start(v, url, { audio: audio, needText: mseNeedText, boost: boostGain, fail: function (why) { engFail(why); }, buffering: function () { if (lis && lis.onbufferingstart) lis.onbufferingstart(); } });
    if (at > 0) { var once = function () { v.removeEventListener('loadedmetadata', once); try { v.currentTime = at; } catch (e) {} if (resume) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } }; v.addEventListener('loadedmetadata', once); }
  }
  function engFail(why) {   // our reader cannot play this file: the web player plays it directly (no subtitles, the volume still works)
    var at = v ? v.currentTime : 0, playing = state === 'PLAYING';
    window.MSE_LAST_FAIL = String(why); boostTried = true; hl('reader gave up: ' + why); skipped = /no subtitles/.test(String(why)); if (window.DIAG) window.DIAG('mseFail', String(why));
    eng = null; recovering = true; clearInterval(subTick); subTick = null; showImg(null); if (!v || !srcUrl) return;
    v.src = srcUrl;
    if (at > 1 || playing) { var once = function () { v.removeEventListener('loadedmetadata', once); if (at > 1) { try { v.currentTime = at; } catch (e) {} } if (playing) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } }; v.addEventListener('loadedmetadata', once); }
    try { v.load(); } catch (e) {}
  }
  function engTick() {
    clearInterval(subTick); subTick = null;
    if (eng && textOn && textIdx >= 0) subTick = setInterval(function () {
      if (!eng || !textOn) { clearInterval(subTick); subTick = null; return; }
      var c = eng.textAt(textIdx, v.currentTime), s2 = c && !c.img ? c.text : '';
      showImg(c && c.img ? c.img : null);
      if (s2 !== lastTxt) { lastTxt = s2; if (lis && lis.onsubtitlechange) lis.onsubtitlechange(c ? Math.max(300, (c.end - v.currentTime) * 1000) : 0, s2); }
    }, 100);
  }
  var textIdx = -1, textOn = false, lastTxt = '', subSince = -1, subSeen = false, noSubs = null;
  // some subtitle tracks (seen on Suits, 2026-10-12) are listed by the web player but never deliver any text:
  // poll the active cues on every time update as well, and report a track that stays empty so player.js can switch to Samsung's player
  function pollText() {
    if (eng) return;
    var tt = v && v.textTracks; if (!textOn || !tt || textIdx < 0 || !tt[textIdx]) { subSince = -1; return; }
    var tr = tt[textIdx], c = tr.activeCues, txt = [];
    for (var k = 0; c && k < c.length; k++) { var ct = cueText(c[k]); if (ct) txt.push(ct); }
    var s = txt.join('\n'); if (s) subSeen = true;   // only real text counts: the TV can hold cues that carry nothing readable
    if (s !== lastTxt) { lastTxt = s; var dur = c && c.length ? Math.max(0, (c[0].endTime - v.currentTime) * 1000) : 0; if (lis && lis.onsubtitlechange) lis.onsubtitlechange(dur, s); }
    if (subSeen || v.paused) return;
    if (subSince < 0) subSince = v.currentTime;
    // the TV's web player loads no subtitle lines at all from MKV files (Suits, 2026-10-12): switch within seconds; lines but no text: after a minute
    else if (v.currentTime - subSince > ((tr.cues && tr.cues.length) ? 60 : 6) && noSubs) { var f = noSubs; noSubs = null; f(subDiag()); }
  }
  function cueText(q) {   // the TV's cues are not always plain VTTCue: try every way the text can come out
    if (!q) return '';
    if (typeof q.text === 'string' && q.text) return q.text.replace(/<[^>]+>/g, '');
    try { if (q.getCueAsHTML) { var f = q.getCueAsHTML(); if (f && f.textContent) return f.textContent; } } catch (e) {}
    try { if (q.data) { var u = new Uint8Array(q.data.buffer || q.data); var str = ''; for (var i = 0; i < u.length; i++) str += String.fromCharCode(u[i]); try { str = decodeURIComponent(escape(str)); } catch (e) {} return str.replace(/<[^>]+>/g, ''); } } catch (e) {}
    try { if (typeof q.value === 'string') return q.value; if (q.value && q.value.data) return String(q.value.data); } catch (e) {}
    return '';
  }
  function cueInfo(q) { var o = { ctor: q && q.constructor ? q.constructor.name : typeof q, s: q && q.startTime, e: q && q.endTime, txt: cueText(q).slice(0, 60), keys: [] }; try { for (var k in q) if (typeof q[k] !== 'function') o.keys.push(k); } catch (e) {} o.keys = o.keys.slice(0, 25); return o; }
  function subDiag() {
    var tt = v && v.textTracks, out = [];
    for (var i = 0; tt && i < tt.length; i++) out.push({ kind: tt[i].kind, lang: tt[i].language, label: tt[i].label, mode: tt[i].mode, cues: tt[i].cues ? tt[i].cues.length : null, active: tt[i].activeCues ? tt[i].activeCues.length : null });
    var sel = tt && tt[textIdx], cues = [];
    try { for (var j = 0; sel && sel.cues && j < sel.cues.length && j < 3; j++) cues.push(cueInfo(sel.cues[j])); } catch (e) { cues.push(String(e)); }
    try { if (sel && sel.activeCues && sel.activeCues[0]) cues.push({ active: cueInfo(sel.activeCues[0]) }); } catch (e) {}
    var mi = null; try { if (eng) { var tk = eng.tracks(); mi = { audio: tk.audio, audioIdx: tk.audioIdx, nText: tk.text.length, now: eng.textAt(textIdx, v.currentTime), buf: v.buffered.length ? [Math.round(v.buffered.start(0)), Math.round(v.buffered.end(v.buffered.length - 1))] : [] }; } } catch (e) { mi = String(e); }
    var mem = null; try { if (performance.memory) mem = { usedMB: Math.round(performance.memory.usedJSHeapSize / 1048576), totalMB: Math.round(performance.memory.totalJSHeapSize / 1048576), limitMB: Math.round(performance.memory.jsHeapSizeLimit / 1048576) }; } catch (e) {}
    var q = null; try { q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null; } catch (e) {}
    var bi = null; try { bi = eng && eng.boostInfo ? eng.boostInfo() : null; } catch (e) {}
    return { vol: vol, boost: bi, aBytes: v ? v.webkitAudioDecodedByteCount : null, mem: mem, dropped: q ? q.droppedVideoFrames : (v ? v.webkitDroppedFrameCount : null), frames: q ? q.totalVideoFrames : (v ? v.webkitDecodedFrameCount : null), mse: !!eng, mseInfo: mi, mseFail: window.MSE_LAST_FAIL || null, cues: cues, paused: v && v.paused, rs: v && v.readyState, src: v && String(v.currentSrc || '').replace(/\/\/[^/]*\/.*\/([^/]+)$/, '//host/.../$1'), t: v ? Math.round(v.currentTime) : 0, textIdx: textIdx, textOn: textOn, seen: subSeen, tracks: out };
  }
  function showText() {   // the chosen subtitle track feeds the app's own subtitle line, like Samsung's player does (hidden mode: the browser draws nothing itself)
    if (eng) { lastTxt = ''; showImg(null); if (lis && lis.onsubtitlechange && !textOn) lis.onsubtitlechange(0, ''); engTick(); return; }
    var tt = v && v.textTracks; if (!tt) return;
    for (var i = 0; i < tt.length; i++) {
      var t = tt[i], want = textOn && i === textIdx; t.mode = want ? 'showing' : 'disabled'; t.oncuechange = null;
      if (want) t.oncuechange = pollText;
    }
    subSince = -1; subSeen = false; lastTxt = ''; clearTimeout(repT); if (textOn && textIdx >= 0 && autoRep) repT = setTimeout(function () { autoRep(subDiag()); }, 40000);
  }
  function tvMode() { try { return localStorage.getItem('doortv.volmode') === 'tv'; } catch (e) { return false; } }
  // setting "TV": the TV's own volume rules, the app's stays at 100 % and unmuted (the level for "In the app" is kept for when it is switched back)
  // above 100 %: the reader sends the sound through boost.js (gain + limiter). Turning it on restarts the reader at the
  // same spot once (a second of buffering); after that every change is applied 1.5 s ahead without a break.
  function boostGain() { return tvMode() ? 1 : Math.max(1, vol / 100); }
  function boostOk() { if (tvMode()) return false; if (!(window.PLAYER && PLAYER.isActive && PLAYER.isActive())) return true; if (eng) return eng.canBoost() || !eng.tracks().audio.length; return mseCan && !boostTried; }
  function reboost() {
    if (!v || !srcUrl || boostGain() <= 1) return; if (eng && (eng.boosting() || !eng.canBoost())) return; if (!eng && (!mseCan || boostTried)) return;
    var t0 = v.currentTime, pl = state === 'PLAYING', ai = eng ? eng.audioIdx() : -1; boostTried = true;
    if (eng) { try { eng.destroy(); } catch (e) {} eng = null; }
    hl('boost on: reader restarted at ' + Math.round(t0) + ' s'); engStart(srcUrl, ai, t0 || 0.01, pl); if (textOn) engTick();
  }
  function applyVol() {
    if (!v) return; var tv = tvMode(); v.volume = tv ? 1 : Math.max(0, Math.min(1, vol / 100)); v.muted = tv ? false : muted;
    var g = boostGain();
    if (eng && eng.boosting()) eng.setGain(g);
    else if (g > 1 && srcUrl) { clearTimeout(boostT); boostT = setTimeout(reboost, 700); }
  }
  function place() { if (!v) return; v.style.left = rect.x + 'px'; v.style.top = rect.y + 'px'; v.style.width = rect.w + 'px'; v.style.height = rect.h + 'px'; placeImg(); }
  return {
    open: function (url) { el(); window.MSE_LAST_FAIL = null; skipped = false; retried = false; recovering = false; textIdx = -1; textOn = false; noSubs = null; state = 'IDLE'; v.style.display = 'block'; place(); srcUrl = url; if (eng) { try { eng.destroy(); } catch (e) {} eng = null; } var m = mseNext || (mseAllowed && boostGain() > 1); mseNext = false; mseAllowed = false; hl('open ' + String(url).replace(/\/\/[^/]*\/.*\/([^/]+)$/, '//host/.../$1').slice(-80) + (m ? ' (reader)' : '')); if (m && window.MKVMSE && MKVMSE.supported()) { try { engStart(url, -1, 0, false); return; } catch (e) { eng = null; hl('reader start error ' + (e && e.message)); } } v.src = url; },
    log: function () { return hlog.slice(); }, note: function (x) { hl(String(x)); },
    useMse: function (on, needText, allowed) { mseNext = !!on; mseNeedText = !!needText; mseAllowed = mseCan = !!(on || allowed); boostTried = false; }, mseOn: function () { return !!eng; },
    setListener: function (l) { lis = l; },
    setStreamingProperty: function () {}, setExternalSubtitlePath: function () {},
    setDisplayMethod: function (m) { el().style.objectFit = /FULL_SCREEN/.test(m) ? 'fill' : 'contain'; },
    setDisplayRect: function (x, y, w, h) { rect = { x: x, y: y, w: w, h: h }; place(); },
    prepareAsync: function (ok, fail) {
      el(); var done = false;
      var fin = function (good, why) { if (done) return; done = true; clearTimeout(t); v.removeEventListener('loadedmetadata', onOk); v.removeEventListener('error', onErr); if (good) { state = 'READY'; ok && ok(); } else fail && fail(why); };
      var onOk = function () { fin(true); }, onErr = function () { setTimeout(function () { if (!recovering) fin(false, 'PLAYER_ERROR_CONNECTION_FAILED'); }, 0); };   // the source was just switched (reader <-> direct): keep waiting
      var t = setTimeout(function () { fin(false, 'PLAYER_ERROR_CONNECTION_FAILED timeout'); }, 25000);
      if (v.readyState >= 1) return fin(true);
      v.addEventListener('loadedmetadata', onOk); v.addEventListener('error', onErr); if (!eng) { try { v.load(); } catch (e) {} }   // load() would detach our own reader's source
    },
    prepare: function () {},
    play: function () { el(); state = 'PLAYING'; var p = v.play(); if (p && p.catch) p.catch(function () {}); },
    pause: function () { if (v) { v.pause(); state = 'PAUSED'; } },
    stop: function () { try { hl('stop by ' + String(new Error().stack || '').split('\n').slice(2, 5).map(function (x) { return x.trim().replace(/\(?file:.*\/js\//, '').replace(/\)$/, ''); }).join(' < ')); } catch (e) {} clearInterval(subTick); subTick = null; showImg(null); if (eng) { try { eng.destroy(); } catch (e) {} eng = null; } srcUrl = ''; if (v) { try { v.pause(); } catch (e) {} v.removeAttribute('src'); try { v.load(); } catch (e) {} } state = 'IDLE'; },
    close: function () { this.stop(); if (v) v.style.display = 'none'; state = 'NONE'; },
    getState: function () { return state; },
    getDuration: function () { return v && isFinite(v.duration) && v.duration > 0 && v.duration < 86400 ? Math.round(v.duration * 1000) : 0; },
    getCurrentTime: function () { return v ? Math.round(v.currentTime * 1000) : 0; },
    seekTo: function (ms, ok) { if (v) { try { v.currentTime = ms / 1000; } catch (e) {} } ok && ok(); },
    jumpForward: function (ms) { if (v) v.currentTime += ms / 1000; }, jumpBackward: function (ms) { if (v) v.currentTime = Math.max(0, v.currentTime - ms / 1000); },
    getTotalTrackInfo: function () {
      var out = [];
      if (eng) { var tk = eng.tracks(); tk.audio.forEach(function (a, i) { out.push({ type: 'AUDIO', index: i, extra_info: JSON.stringify({ language: a.lang, track_name: a.name }) }); }); tk.text.forEach(function (t, j) { out.push({ type: 'TEXT', index: j, extra_info: JSON.stringify({ track_lang: t.lang, track_name: t.name }) }); }); return out; }
      try { var at = v && v.audioTracks; if (at) for (var i = 0; i < at.length; i++) out.push({ type: 'AUDIO', index: i, extra_info: JSON.stringify({ language: at[i].language || '', track_name: at[i].label || '' }) }); } catch (e) {}
      try { var tt = v && v.textTracks; if (tt) for (var j = 0; j < tt.length; j++) out.push({ type: 'TEXT', index: j, extra_info: JSON.stringify({ track_lang: tt[j].language || '', track_name: tt[j].label || '' }) }); } catch (e) {}
      return out;
    },
    setSelectTrack: function (type, index) {
      try {
        if (type === 'AUDIO' && eng) { var ai = Number(index); if (ai !== eng.audioIdx() && eng.canAudio(ai)) { var t0 = v.currentTime, pl = state === 'PLAYING'; eng.destroy(); engStart(srcUrl, ai, t0 || 0.01, pl); } }
        else if (type === 'AUDIO') { var at = v && v.audioTracks; if (at) for (var i = 0; i < at.length; i++) at[i].enabled = (i === Number(index)); }
        else if (type === 'TEXT') { textIdx = Number(index); showText(); }
      } catch (e) {}
    },
    setSilentSubtitle: function (silent) { textOn = !silent; showText(); },
    onNoSubs: function (f) { noSubs = f; }, onSubReport: function (f) { autoRep = f; clearTimeout(repT); if (textOn && textIdx >= 0) repT = setTimeout(function () { autoRep(subDiag()); }, 40000); }, subDiag: subDiag,
    // volume: the remote's volume keys change this while a live channel plays
    volume: function () { return muted ? 0 : vol; },
    isMuted: function () { return muted; },
    volumeStep: function (d) { muted = false; if (d > 0 && vol >= 100 && !boostOk()) return vol; vol = vol > 100 || (vol === 100 && d > 0) ? vol + (d > 0 ? 10 : -10) : vol + d; vol = Math.max(0, Math.min(MAXVOL, vol)); try { localStorage.setItem(VOLKEY, String(vol)); } catch (e) {} applyVol(); return vol; },
    refreshVol: function () { applyVol(); }, boostOk: boostOk, boosting: function () { return !!(eng && eng.boosting()); },
    toggleMute: function () { muted = !muted; applyVol(); return muted; }
  };
})();
