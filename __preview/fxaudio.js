// In-page sound for browsers that cannot decode a live channel's audio (Firefox: AC3 / E-AC3).
// hls.js keeps playing the picture; this reads the same TS pieces, decodes their sound with FFmpeg (WebAssembly, loaded
// once and cached by the browser) and plays it through Web Audio, placed on the video's own clock (PTS mapping from
// hls.js), so pause / seek / volume follow the video. Nothing runs on the laptop.
window.FXA = (function () {
  var CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/';
  var ff = null, ffReady = null, base = (function () { try { var s = document.currentScript && document.currentScript.src; return s ? s.replace(/[^/]*$/, '') : '__preview/'; } catch (e) { return '__preview/'; } })();
  var S = null;   // the attached stream: { hls, video, on, initPTS, ts, chunks, queue, busy, ctx, gain, anchorCtx, anchorVid }
  function blobUrl(u, type) { return fetch(u, { cache: 'force-cache' }).then(function (r) { if (!r.ok) throw new Error(u + ' ' + r.status); return r.arrayBuffer(); }).then(function (b) { return URL.createObjectURL(new Blob([b], { type: type })); }); }
  function loadScript(u) { return new Promise(function (ok, bad) { if (window.FFmpegWASM) return ok(); var s = document.createElement('script'); s.src = u; s.onload = ok; s.onerror = function () { bad(new Error('load ' + u)); }; document.head.appendChild(s); }); }
  function ensureFF() {   // FFmpeg core: fetched once, then from the browser cache
    if (ffReady) return ffReady;
    ffReady = loadScript(base + 'ffmpeg/ffmpeg.js').then(function () { return Promise.all([blobUrl(CORE + 'ffmpeg-core.js', 'text/javascript'), blobUrl(CORE + 'ffmpeg-core.wasm', 'application/wasm')]); })
      .then(function (u) { ff = new FFmpegWASM.FFmpeg(); return ff.load({ coreURL: u[0], wasmURL: u[1] }); }).then(function () { return ff; })
      .catch(function (e) { ffReady = null; throw e; });
    return ffReady;
  }
  // --- MPEG-TS: audio stream type + first audio PTS of a piece ---
  function parseTs(u8) {
    var pmt = -1, apid = -1, atype = 0, pts = null, n = u8.length - (u8.length % 188);
    for (var o = 0; o + 188 <= n; o += 188) {
      if (u8[o] !== 0x47) continue;
      var pid = ((u8[o + 1] & 0x1f) << 8) | u8[o + 2], pusi = u8[o + 1] & 0x40, afc = (u8[o + 3] >> 4) & 3, p = o + 4;
      if (afc & 2) p += 1 + u8[o + 4]; if (!(afc & 1) || p >= o + 188) continue;
      if (pid === 0 && pusi && pmt < 0) { p += 1 + u8[p]; var secLen = ((u8[p + 1] & 0x0f) << 8) | u8[p + 2]; for (var i = p + 8; i < p + 3 + secLen - 4; i += 4) { var prog = (u8[i] << 8) | u8[i + 1]; if (prog) { pmt = ((u8[i + 2] & 0x1f) << 8) | u8[i + 3]; break; } } continue; }
      if (pid === pmt && pusi && apid < 0) {
        p += 1 + u8[p]; var sl = ((u8[p + 1] & 0x0f) << 8) | u8[p + 2], end = p + 3 + sl - 4, pil = ((u8[p + 10] & 0x0f) << 8) | u8[p + 11], j = p + 12 + pil;
        while (j + 5 <= end) {
          var st = u8[j], epid = ((u8[j + 1] & 0x1f) << 8) | u8[j + 2], esl = ((u8[j + 3] & 0x0f) << 8) | u8[j + 4], kind = 0;
          if (st === 0x81 || st === 0x87 || st === 0x03 || st === 0x04 || st === 0x0f || st === 0x11) kind = st;
          else if (st === 0x06) { for (var d = j + 5; d < j + 5 + esl; d += 2 + u8[d + 1]) { if (u8[d] === 0x6a) kind = 0x81; if (u8[d] === 0x7a) kind = 0x87; } }
          if (kind) { apid = epid; atype = kind; break; }
          j += 5 + esl;
        }
        continue;
      }
      if (pid === apid && pusi && pts === null && u8[p] === 0 && u8[p + 1] === 0 && u8[p + 2] === 1 && (u8[p + 7] & 0x80)) {
        pts = ((u8[p + 9] >> 1) & 7) * 1073741824 + u8[p + 10] * 4194304 + (u8[p + 11] >> 1) * 32768 + u8[p + 12] * 128 + (u8[p + 13] >> 1);
      }
      if (apid >= 0 && pts !== null) break;
    }
    return { type: atype, pts: pts };
  }
  function needsHelp(type) {   // only what this browser cannot decode itself
    var codec = type === 0x81 ? 'ac-3' : type === 0x87 ? 'ec-3' : null; if (!codec) return false;
    try { return !(window.MediaSource && MediaSource.isTypeSupported('audio/mp4; codecs="' + codec + '"')); } catch (e) { return true; }
  }
  // --- playback on the video clock ---
  function ctxOf() {
    if (!S.ctx) { var C = window.AudioContext || window.webkitAudioContext; S.ctx = new C({ sampleRate: 48000, latencyHint: 'playback' }); S.gain = S.ctx.createGain(); S.gain.connect(S.ctx.destination); }
    return S.ctx;
  }
  function vol() { if (S && S.gain) S.gain.gain.value = S.video.muted ? 0 : S.video.volume; }
  function stopAll() { (S.chunks || []).forEach(function (c) { if (c.src) { try { c.src.stop(); } catch (e) {} c.src = null; } }); }
  function resync() {
    if (!S || !S.ctx) return; stopAll(); if (S.video.paused) return;
    S.anchorCtx = S.ctx.currentTime + 0.05; S.anchorVid = S.video.currentTime + 0.05; schedule();
  }
  function schedule() {
    if (!S || !S.ctx || S.video.paused || S.anchorCtx == null) return;
    var now = S.ctx.currentTime, vt = S.video.currentTime;
    S.chunks = S.chunks.filter(function (c) { return c.t + c.buf.duration > vt - 30; });
    S.chunks.forEach(function (c) {
      if (c.src || c.t + c.buf.duration < vt) return;
      var when = S.anchorCtx + (c.t - S.anchorVid), off = 0; if (when < now) { off = now - when; when = now; } if (off >= c.buf.duration) return;
      var src = S.ctx.createBufferSource(); src.buffer = c.buf; src.connect(S.gain); src.start(when, off); c.src = src;
    });
  }
  function decode(job) {
    S.busy = true;
    ensureFF().then(function (f) {
      return f.writeFile('in.ts', job.u8).then(function () { return f.exec(['-hide_banner', '-loglevel', 'error', '-i', 'in.ts', '-vn', '-map', '0:a:0', '-ac', '2', '-ar', '48000', '-f', 'f32le', 'out.raw']); })
        .then(function () { return f.readFile('out.raw'); });
    }).then(function (raw) {
      if (!S || job.gen !== S.gen) return;
      var f32 = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4)), frames = Math.floor(f32.length / 2); if (!frames) return;
      var ctx = ctxOf(), buf = ctx.createBuffer(2, frames, 48000), l = buf.getChannelData(0), r = buf.getChannelData(1);
      for (var i = 0, k = 0; i < frames; i++) { l[i] = f32[k++]; r[i] = f32[k++]; }
      var ts = job.ts || 90000, d = job.pts - job.ip; if (d < -4294967296) d += 8589934592;
      var t = d / ts; if (Math.abs(t - S.video.currentTime) > 40 && job.frag && isFinite(job.frag.start)) t = job.frag.start;   // a mapping that does not fit (stream re-opened, clock jump): use hls.js's own place for this piece
      S.chunks.push({ t: t, buf: buf, src: null }); S.chunks.sort(function (a, b) { return a.t - b.t; });
      vol(); if (S.anchorCtx == null) resync(); else schedule();
      if (S.held) { S.held = false; S.video.play().catch(function () {}); }
    }).catch(function (e) { if (window.console) console.warn('FXA decode', e && e.message); })
      .then(function () { if (!S) return; S.busy = false; if (S.queue.length) decode(S.queue.shift()); });
  }
  function onPiece(u8, cc, frag) {
    if (!S) return;
    var info = parseTs(u8);
    if (!S.on) { if (!info.type || !needsHelp(info.type)) return; S.on = true; if (window.console) console.log('FXA: this browser cannot decode the channel sound (' + (info.type === 0x87 ? 'E-AC3' : 'AC3') + '), decoding it in the page');
      if (!S.video.paused) { S.held = true; S.video.pause(); } else S.held = true;   // the picture waits for its first sound (at most 4 s), so both start together
      setTimeout(function () { if (S && S.held) { S.held = false; S.video.play().catch(function () {}); } }, 4000); }
    var m = S.init[cc]; if (info.pts === null || !m) { S.pending.push([u8, cc, frag]); return; }
    S.queue.push({ u8: u8, pts: info.pts, ip: m.ip, ts: m.ts, frag: frag, gen: S.gen }); if (!S.busy) decode(S.queue.shift());
  }
  function loaderClass() {   // keeps a copy of every downloaded piece before hls.js hands it to its demuxer
    var Base = Hls.DefaultConfig.loader;
    function L(cfg) { this.inner = new Base(cfg); }
    L.prototype.load = function (context, config, callbacks) {
      var ok = callbacks.onSuccess;
      var cb = Object.assign({}, callbacks, { onSuccess: function (resp, stats, ctx2, nd) { try { if (S && ctx2 && ctx2.frag && ctx2.frag.type === 'main' && resp && resp.data instanceof ArrayBuffer) onPiece(new Uint8Array(resp.data.slice(0)), ctx2.frag.cc || 0, ctx2.frag); } catch (e) {} return ok(resp, stats, ctx2, nd); } });
      return this.inner.load(context, config, cb);
    };
    L.prototype.abort = function () { return this.inner.abort(); }; L.prototype.destroy = function () { return this.inner.destroy(); };
    Object.defineProperty(L.prototype, 'stats', { get: function () { return this.inner.stats; } }); Object.defineProperty(L.prototype, 'context', { get: function () { return this.inner.context; } });
    return L;
  }
  function onVideo(e) {
    if (!S || !S.on) return;
    if (e.type === 'pause' || e.type === 'waiting') { stopAll(); S.anchorCtx = null; }
    else if (e.type === 'playing' || e.type === 'seeked') { if (S.ctx && S.ctx.state === 'suspended') S.ctx.resume(); resync(); }
    else if (e.type === 'volumechange') vol();
  }
  var drift = setInterval(function () {   // keep the sound on the picture
    if (!S || !S.on || !S.ctx || S.video.paused) return; if (S.anchorCtx == null) { if (S.chunks.length) resync(); return; }
    var exp = S.anchorVid + (S.ctx.currentTime - S.anchorCtx); if (Math.abs(exp - S.video.currentTime) > 0.12) resync(); else schedule();
    var vt = S.video.currentTime, covered = S.chunks.some(function (c) { return c.src && c.t <= vt + 0.3 && c.t + c.buf.duration >= vt; });
    if (covered || !S.chunks.length) S.silentSince = 0; else if (!S.silentSince) S.silentSince = Date.now(); else if (Date.now() - S.silentSince > 3000) { S.silentSince = 0; if (window.console) console.log('FXA: no sound under the picture, re-syncing'); var near = S.chunks.filter(function (c) { return c.t + c.buf.duration > vt - 1; }); if (near.length && Math.abs(near[0].t - vt) > 20) { var shift = vt - near[0].t; S.chunks.forEach(function (c) { c.t += shift; }); } resync(); }
  }, 1000);
  function resumeOnGesture() { if (S && S.ctx && S.ctx.state === 'suspended') S.ctx.resume(); }
  document.addEventListener('click', resumeOnGesture, true); document.addEventListener('keydown', resumeOnGesture, true);
  return {
    loader: function () { return window.Hls ? loaderClass() : undefined; },
    preload: function () { ensureFF().catch(function () {}); },
    attach: function (hls, video) {
      this.detach();
      S = { hls: hls, video: video, on: false, initPTS: null, init: {}, timescale: 90000, chunks: [], queue: [], pending: [], busy: false, gen: Date.now(), held: false };
      hls.on(Hls.Events.INIT_PTS_FOUND, function (ev, d) { if (!S) return; var ip = d.initPTS, ts = d.timescale || 90000, cc = d.frag ? d.frag.cc || 0 : 0; if (ip && typeof ip === 'object') { ts = ip.timescale || ts; ip = ip.baseTime; } S.init[cc] = { ip: ip, ts: ts }; S.initPTS = ip; var p = S.pending; S.pending = []; p.forEach(function (x) { onPiece(x[0], x[1], x[2]); }); });   // one mapping per stream section: after a jump (the channel re-opened) the sound follows the new section
      ['pause', 'waiting', 'playing', 'seeked', 'volumechange'].forEach(function (t) { video.addEventListener(t, onVideo); });
      S.listeners = true;
    },
    detach: function () { if (!S) return; var v = S.video; ['pause', 'waiting', 'playing', 'seeked', 'volumechange'].forEach(function (t) { v.removeEventListener(t, onVideo); }); stopAll(); if (S.ctx) { try { S.ctx.close(); } catch (e) {} } S = null; },
    active: function () { return !!(S && S.on); },
    chunksInfo: function () { return S ? S.chunks.map(function (c) { return [Math.round(c.t * 10) / 10, Math.round(c.buf.duration * 10) / 10, !!c.src]; }) : null; },
    debug: function () { return S ? { on: S.on, ctx: S.ctx && S.ctx.state, chunks: S.chunks.length, playing: S.chunks.filter(function (c) { return c.src; }).length, queue: S.queue.length, initPTS: S.initPTS, ff: !!ff, peak: (function () { var c = S.chunks[S.chunks.length - 1]; if (!c) return 0; var d = c.buf.getChannelData(0), m = 0; for (var i = 0; i < d.length; i += 64) m = Math.max(m, Math.abs(d[i])); return Math.round(m * 1000) / 1000; })(), lead: (function () { var c = S.chunks[S.chunks.length - 1]; return c ? Math.round((c.t + c.buf.duration - S.video.currentTime) * 10) / 10 : 0; })() } : null; }
  };
})();
