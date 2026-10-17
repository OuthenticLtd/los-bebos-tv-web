// Volume above 100 % for films and series read by mse.js. The TV's web player sends its sound straight to the output,
// so the app cannot turn it up there. Instead the reader hands the show's AAC sound here first: the TV decodes it
// (decodeAudioData, about 10x real time), we apply the extra gain with a look-ahead limiter (peaks never pass -1 dBFS,
// so nothing clips), and give it back to the same video element as lossless FLAC. Same element = lip sync unchanged.
window.ABOOST = (function () {
  var CEIL = Math.pow(10, -1 / 20), RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  var MIME = 'audio/mp4; codecs="flac"';

  // AudioSpecificConfig: plain AAC-LC, mono, stereo or 5.1 (mixed down to stereo here), at a standard rate
  function asc(t) {
    var a = t.priv;
    if (!a && t.cfgBox) { var b = t.cfgBox, p = 12; while (p + 2 < b.length) { var tag = b[p++], l = 0, k = 0, x; do { x = b[p++]; l = (l << 7) | (x & 0x7F); } while ((x & 0x80) && ++k < 4); if (tag === 3) { p += 2; var fl = b[p++]; if (fl & 0x80) p += 2; if (fl & 0x40) p += 1 + b[p]; if (fl & 0x20) p += 2; continue; } if (tag === 4) { p += 13; continue; } if (tag === 5) { a = b.subarray(p, p + l); break; } p += l; } }
    if (!a || a.length < 2) return null;
    var aot = a[0] >> 3, fi = ((a[0] & 7) << 1) | (a[1] >> 7), ch = (a[1] >> 3) & 15;
    if (aot !== 2 || fi > 12 || !(ch === 1 || ch === 2 || ch === 6)) return null;
    return { fi: fi, rate: RATES[fi], ch: ch };
  }
  function can(t) { try { var c = t && t.mp4type === 'mp4a' && asc(t); return !!(c && c.rate === t.rate && window.OfflineAudioContext && window.MediaSource && MediaSource.isTypeSupported(MIME)); } catch (e) { return false; } }

  // ---- FLAC (verbatim subframes: plain 16-bit samples, nothing to compute) ----
  var C8 = [], C16 = [];
  (function () { for (var i = 0; i < 256; i++) { var c = i, d = i << 8; for (var k = 0; k < 8; k++) { c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xFF : (c << 1) & 0xFF; d = d & 0x8000 ? ((d << 1) ^ 0x8005) & 0xFFFF : (d << 1) & 0xFFFF; } C8[i] = c; C16[i] = d; } })();
  function utf8num(n) {
    if (n < 0x80) return [n];
    var len = n < 0x800 ? 2 : n < 0x10000 ? 3 : n < 0x200000 ? 4 : n < 0x4000000 ? 5 : 6, out = [];
    for (var i = len - 1; i > 0; i--) { out[i] = 0x80 | (n & 0x3F); n = Math.floor(n / 64); }
    out[0] = ((0xFF00 >> len) & 0xFF) | n; return out;
  }
  function flacFrame(chs, from, n, num) {
    var nc = chs.length, bs = n === 1024 ? [0xA, null] : n <= 256 ? [6, n - 1] : [7, n - 1];
    var h = [0xFF, 0xF8, (bs[0] << 4) | 0, ((nc - 1) << 4) | (4 << 1)].concat(utf8num(num));
    if (bs[1] !== null) { if (bs[0] === 6) h.push(bs[1]); else h.push(bs[1] >> 8, bs[1] & 255); }
    var c8 = 0, i; for (i = 0; i < h.length; i++) c8 = C8[c8 ^ h[i]]; h.push(c8);
    var size = h.length + nc * (1 + 2 * n) + 2, f = new Uint8Array(size), p = 0;
    for (i = 0; i < h.length; i++) f[p++] = h[i];
    for (var c = 0; c < nc; c++) { var s = chs[c]; f[p++] = 0x02; for (i = 0; i < n; i++) { var x = s[from + i]; f[p++] = (x >> 8) & 255; f[p++] = x & 255; } }
    var c16 = 0; for (i = 0; i < p; i++) c16 = ((c16 << 8) & 0xFFFF) ^ C16[(c16 >> 8) ^ f[i]];
    f[p++] = c16 >> 8; f[p++] = c16 & 255; return f;
  }
  function dfLa(rate, ch) {   // the sample entry's config: a STREAMINFO block (1024-sample frames, 16 bit)
    var si = [0x04, 0x00, 0x04, 0x00, 0, 0, 0, 0, 0, 0, (rate >> 12) & 255, (rate >> 4) & 255, ((rate & 15) << 4) | ((ch - 1) << 1) | 0, (15 << 4) | 0, 0, 0, 0, 0].concat(new Array(16).fill(0));
    var body = [0, 0, 0, 0, 0x80, 0, 0, 34].concat(si), n = body.length + 8;
    return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, 100, 102, 76, 97].concat(body));
  }

  function make(t) {
    var cfg = asc(t), inCh = cfg.ch, nch = inCh === 6 ? 2 : inCh, rate = cfg.rate, L = Math.max(16, Math.round(rate * 0.005)), REL = 1 / (rate * 0.25);
    var gain = 1, epoch = 0, jobs = [], busy = false, tail = [], carry = null, mCarry = null, gPrev = 1, ctx = null, firstPending = -1;
    var stats = { jobs: 0, ms: 0, limited: 0, maxRed: 0 };
    function adts(d) { var n = d.length + 7; return [0xFF, 0xF1, (1 << 6) | (cfg.fi << 2) | (inCh >> 2), ((inCh & 3) << 6) | ((n >> 11) & 3), (n >> 3) & 255, ((n & 7) << 5) | 0x1F, 0xFC]; }
    function reset(keep) { epoch++; jobs = []; busy = false; tail = keep ? keep.slice(-2) : []; carry = null; mCarry = null; gPrev = 1; firstPending = -1; }
    // limiter: a delay of L samples gives a look-ahead; the gain is the smoothed minimum needed over the next L samples
    function limit(X, N) {
      var M = N + L, req = new Float32Array(M), i, c, any = false, G = gain;
      for (i = 0; i < M; i++) { var pk = 0; for (c = 0; c < nch; c++) { var a = X[c][i]; if (a < 0) a = -a; if (a > pk) pk = a; } pk *= G; if (pk > CEIL) { req[i] = CEIL / pk; any = true; } else req[i] = 1; }
      var out = []; for (c = 0; c < nch; c++) out.push(new Int16Array(N));
      if (!any && gPrev >= 1 && !(mCarry && mCarry.some(function (x) { return x < 1; }))) {
        for (c = 0; c < nch; c++) { var o = out[c], s = X[c]; for (i = 0; i < N; i++) { var y = s[i] * G * 32768; o[i] = y > 32767 ? 32767 : y < -32768 ? -32768 : y; } }
        mCarry = null; return out;
      }
      var m = new Float32Array(N), dq = new Int32Array(M), h = 0, tl = 0;   // sliding minimum of req over [j, j+L]
      for (i = 0; i < M; i++) { while (tl > h && req[dq[tl - 1]] >= req[i]) tl--; dq[tl++] = i; var j = i - L; if (j >= 0) { while (dq[h] < j) h++; m[j] = req[dq[h]]; } }
      var prev = mCarry || new Float32Array(L - 1).fill(1), sum = 0, k; for (k = 0; k < prev.length; k++) sum += prev[k];
      var g = gPrev, red = 1;
      for (i = 0; i < N; i++) {
        sum += m[i]; var avg = sum / L; var old = i - (L - 1); sum -= old >= 0 ? m[old] : prev[old + prev.length];
        g = Math.min(avg, g + REL); if (g < red) red = g;
        for (c = 0; c < nch; c++) { var y2 = X[c][i] * G * g * 32768; out[c][i] = y2 > 32767 ? 32767 : y2 < -32768 ? -32768 : y2; }
      }
      gPrev = g; mCarry = m.slice(N - (L - 1)); if (red < 1) { stats.limited++; var db = -20 * Math.log(red) / Math.LN10; if (db > stats.maxRed) stats.maxRed = Math.round(db * 10) / 10; }
      return out;
    }
    function step() {
      if (busy || !jobs.length) return; busy = true;
      var job = jobs[0], ep = epoch, warm = tail, all = warm.concat(job.frames), size = 0, i;
      all.forEach(function (f) { size += f.data.length + 7; });
      var ab = new Uint8Array(size), p = 0;
      all.forEach(function (f) { ab.set(adts(f.data), p); p += 7; ab.set(f.data, p); p += f.data.length; });
      var t0 = Date.now(), done = function (buf) {
        if (ep !== epoch) return;
        jobs.shift(); busy = false; tail = all.slice(-2); firstPending = jobs.length ? jobs[0].frames[0].st : -1;
        var n = job.frames.length, N = n * 1024, skip = warm.length * 1024, X = [], c;
        var srcs = [];
        if (buf && buf.numberOfChannels === 6 && nch === 2) {   // 5.1 (L R C LFE SL SR) to stereo, the usual way: centre and surrounds at -3 dB, LFE left out; the limiter catches any overs
          var ch6 = [0, 1, 2, 4, 5].map(function (k) { return buf.getChannelData(k); }), len = ch6[0].length, lo = new Float32Array(len), ro = new Float32Array(len), K = Math.SQRT1_2;
          for (i = 0; i < len; i++) { var cc = K * ch6[2][i]; lo[i] = ch6[0][i] + cc + K * ch6[3][i]; ro[i] = ch6[1][i] + cc + K * ch6[4][i]; }
          srcs = [lo, ro];
        } else for (c = 0; c < nch; c++) srcs.push(buf ? buf.getChannelData(Math.min(c, buf.numberOfChannels - 1)) : new Float32Array(0));
        for (c = 0; c < nch; c++) {
          var src = srcs[c], x = new Float32Array(N + L);
          var pre = carry ? carry[c] : (skip >= L ? src.subarray(skip - L, skip) : null);
          if (pre) x.set(pre, 0);
          var part = src.subarray(skip, Math.min(src.length, skip + N)); x.set(part, L); X.push(x);
        }
        carry = X.map(function (x) { return x.slice(N, N + L); });
        var pcm = limit(X, N), out = [];
        for (i = 0; i < n; i++) { var f = job.frames[i]; out.push({ data: flacFrame(pcm, i * 1024, 1024, Math.floor(f.st / 1024) % 0x7FFFFFFF), dur: f.dur, st: f.st, key: true, cts: 0 }); }
        stats.jobs++; stats.ms += Date.now() - t0;
        job.cb(out); step();
      };
      try {
        ctx = ctx || new OfflineAudioContext(inCh, 1, rate);
        ctx.decodeAudioData(ab.buffer, done, function () { done(null); });
      } catch (e) { done(null); }
    }
    return {
      mime: MIME, mp4type: 'fLaC', cfgBox: dfLa(rate, nch), channels: nch, rate: rate,
      run: function (frames, cb) { if (!frames.length) return; if (firstPending < 0) firstPending = frames[0].st; jobs.push({ frames: frames, cb: cb }); step(); },
      pending: function () { return jobs.length; }, firstPending: function () { return firstPending; },
      reset: reset, setGain: function (g) { gain = g; }, gain: function () { return gain; }, stats: function () { return stats; }
    };
  }
  return { can: can, make: make };
})();
