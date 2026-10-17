// TV only: plays a Matroska (.mkv) file through the web player by reading it ourselves (one connection, like Samsung's
// player) and handing picture and sound to the web player as MP4 fragments (Media Source Extensions). Why: the web player
// is the one whose volume reaches the optical output, but it shows none of the file's subtitles (2026-10-12, Suits: the
// tracks are listed with 0 cues). Reading the file ourselves gives us the subtitle lines on the way, from the provider's file.
// Anything this cannot handle (codec, odd file) reports failure and h5play.js plays the file directly instead.
window.MKVMSE = (function () {
  var ID = { EBML: 0x1A45DFA3, Segment: 0x18538067, SeekHead: 0x114D9B74, Seek: 0x4DBB, SeekID: 0x53AB, SeekPosition: 0x53AC,
    Info: 0x1549A966, TimecodeScale: 0x2AD7B1, Duration: 0x4489, Tracks: 0x1654AE6B, TrackEntry: 0xAE, TrackNumber: 0xD7, TrackType: 0x83,
    Language: 0x22B59C, LanguageIETF: 0x22B59D, Name: 0x536E, CodecID: 0x86, CodecPrivate: 0x63A2, FlagDefault: 0x88, FlagForced: 0x55AA, DefaultDuration: 0x23E383,
    Video: 0xE0, PixelWidth: 0xB0, PixelHeight: 0xBA, Audio: 0xE1, SamplingFrequency: 0xB5, Channels: 0x9F,
    ContentEncodings: 0x6D80, ContentEncoding: 0x6240, ContentCompression: 0x5034, ContentCompAlgo: 0x4254, ContentCompSettings: 0x4255,
    Cluster: 0x1F43B675, Timecode: 0xE7, SimpleBlock: 0xA3, BlockGroup: 0xA0, Block: 0xA1, BlockDuration: 0x9B, ReferenceBlock: 0xFB,
    Cues: 0x1C53BB6B, CuePoint: 0xBB, CueTime: 0xB3, CueTrackPositions: 0xB7, CueTrack: 0xF7, CueClusterPosition: 0xF1 };
  var TOP = {}; [ID.SeekHead, ID.Info, ID.Tracks, ID.Cluster, ID.Cues, 0x1254C367, 0x1941A469, 0x1043A770].forEach(function (k) { TOP[k] = 1; });

  // ---- EBML reading ----
  function vint(b, p, keep) {
    var f = b[p]; if (f === undefined) return null;
    var len = 1, m = 0x80; while (len <= 8 && !(f & m)) { m >>= 1; len++; }
    if (len > 8 || p + len > b.length) return null;
    var v = keep ? f : (f & (m - 1)), allOnes = (f & (m - 1)) === m - 1;
    for (var i = 1; i < len; i++) { v = v * 256 + b[p + i]; if (b[p + i] !== 255) allOnes = false; }
    return { v: v, n: len, unknown: !keep && allOnes };
  }
  function head(b, p) { var id = vint(b, p, true); if (!id) return null; var sz = vint(b, p + id.n); if (!sz) return null; return { id: id.v, size: sz.unknown ? -1 : sz.v, hl: id.n + sz.n }; }
  function uint(b, p, n) { var v = 0; for (var i = 0; i < n; i++) v = v * 256 + b[p + i]; return v; }
  function flt(b, p, n) { var dv = new DataView(b.buffer, b.byteOffset + p, n); return n === 4 ? dv.getFloat32(0) : dv.getFloat64(0); }
  function utf8(b, p, n) { var s = ''; for (var i = 0; i < n; i++) s += String.fromCharCode(b[p + i]); try { return decodeURIComponent(escape(s)); } catch (e) { return s; } }
  function kids(b, p, end, fn) { while (p < end) { var h = head(b, p); if (!h) return; var d = p + h.hl, e = h.size < 0 ? end : Math.min(end, d + h.size); fn(h.id, d, e - d); p = e; } }

  // ---- MP4 writing ----
  function u8(a) { return new Uint8Array(a); }
  function cat(list) { var n = 0, i; for (i = 0; i < list.length; i++) n += list[i].length; var o = new Uint8Array(n), p = 0; for (i = 0; i < list.length; i++) { o.set(list[i], p); p += list[i].length; } return o; }
  function be32(x) { return [(x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255]; }
  function be16(x) { return [(x >> 8) & 255, x & 255]; }
  function be64(x) { var hi = Math.floor(x / 4294967296), lo = x >>> 0; return be32(hi).concat(be32(lo)); }
  function box(type) {
    var parts = []; for (var i = 1; i < arguments.length; i++) { var a = arguments[i]; parts.push(a instanceof Uint8Array ? a : u8(a)); }
    var body = cat(parts), t = [type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)];
    return cat([u8(be32(body.length + 8).concat(t)), body]);
  }
  var MATRIX = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 64, 0, 0, 0];
  function initSeg(t) {
    var video = t.kind === 'video';
    var mvhd = box('mvhd', [0, 0, 0, 0].concat(be32(0), be32(0), be32(1000), be32(0), [0, 1, 0, 0], [1, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], MATRIX, new Array(24).fill(0), be32(2)));
    var tkhd = box('tkhd', [0, 0, 0, 3].concat(be32(0), be32(0), be32(1), be32(0), be32(0), new Array(8).fill(0), [0, 0, 0, 0], video ? [0, 0] : [1, 0], [0, 0], MATRIX, be32((t.w || 0) * 65536), be32((t.h || 0) * 65536)));
    var mdhd = box('mdhd', [0, 0, 0, 0].concat(be32(0), be32(0), be32(t.scale), be32(0), [0x55, 0xc4, 0, 0]));
    var hdlr = box('hdlr', [0, 0, 0, 0, 0, 0, 0, 0].concat(video ? [118, 105, 100, 101] : [115, 111, 117, 110], new Array(12).fill(0), [76, 66, 0]));
    var entry;
    if (video && t.rawEntry) entry = t.rawEntry;
    else if (video) {
      var vse = [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0].concat(new Array(12).fill(0), be16(t.w || 1920), be16(t.h || 1080), [0, 0x48, 0, 0, 0, 0x48, 0, 0], [0, 0, 0, 0], [0, 1], new Array(32).fill(0), [0, 0x18, 0xff, 0xff]);
      entry = box(t.mp4type, u8(vse), box(/^avc/.test(t.mp4type) ? 'avcC' : 'hvcC', t.priv));
    } else {
      var ase = [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0].concat(be16(t.channels || 2), [0, 16, 0, 0, 0, 0], be16(Math.min(65535, t.rate)), [0, 0]);
      entry = box(t.mp4type, u8(ase), t.cfgBox);
    }
    var stbl = box('stbl', box('stsd', [0, 0, 0, 0, 0, 0, 0, 1], entry), box('stts', new Array(8).fill(0)), box('stsc', new Array(8).fill(0)), box('stsz', new Array(12).fill(0)), box('stco', new Array(8).fill(0)));
    var minf = box('minf', video ? box('vmhd', [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]) : box('smhd', [0, 0, 0, 0, 0, 0, 0, 0]), box('dinf', box('dref', [0, 0, 0, 0, 0, 0, 0, 1], box('url ', [0, 0, 0, 1]))), stbl);
    var moov = box('moov', mvhd, box('trak', tkhd, box('mdia', mdhd, hdlr, minf)), box('mvex', box('trex', [0, 0, 0, 0].concat(be32(1), be32(1), be32(0), be32(0), be32(0)))));
    return cat([box('ftyp', [105, 115, 111, 53, 0, 0, 0, 1, 105, 115, 111, 53, 105, 115, 111, 54, 109, 112, 52, 49]), moov]);
  }
  var seqNo = 1, lastAbort = 0, RANGE = 16 * 1048576;   // the provider allows one connection: a new request waits until the previous one is surely closed
  function fragment(samples, baseDts) {   // samples: { data, dur, cts, key }
    var n = samples.length, trunHead = 12 + 4 + 4, per = 16, i;
    var trunLen = 8 + trunHead - 8 + n * per;
    var tfhd = box('tfhd', [0, 2, 0, 0].concat(be32(1)));
    var tfdt = box('tfdt', [1, 0, 0, 0].concat(be64(baseDts)));
    var trunSize = 8 + 4 + 4 + 4 + n * per, moofSize = 8 + 16 + 8 + tfhd.length + tfdt.length + trunSize;
    var tr = new Uint8Array(trunSize), dv = new DataView(tr.buffer);
    dv.setUint32(0, trunSize); tr.set([116, 114, 117, 110], 4); dv.setUint32(8, 0x01000F01); dv.setUint32(12, n); dv.setUint32(16, moofSize + 8);
    var total = 0;
    for (i = 0; i < n; i++) { var s = samples[i], o = 20 + i * per; dv.setUint32(o, Math.max(0, s.dur)); dv.setUint32(o + 4, s.data.length); dv.setUint32(o + 8, s.key ? 0x02000000 : 0x01010000); dv.setInt32(o + 12, s.cts || 0); total += s.data.length; }
    var moof = box('moof', box('mfhd', [0, 0, 0, 0].concat(be32(seqNo++))), box('traf', tfhd, tfdt, tr));
    var mdat = new Uint8Array(8 + total), p = 8; new DataView(mdat.buffer).setUint32(0, 8 + total); mdat.set([109, 100, 97, 116], 4);
    for (i = 0; i < n; i++) { mdat.set(samples[i].data, p); p += samples[i].data.length; }
    return cat([moof, mdat]);
  }

  // ---- codec setup ----
  function hex2(x) { return (x < 16 ? '0' : '') + x.toString(16); }
  function hevcCodec(c) {
    if (!c || c.length < 13) return 'hvc1.1.6.L120.90';
    var space = c[1] >> 6, tier = (c[1] >> 5) & 1, prof = c[1] & 31, compat = uint(c, 2, 4), rev = 0;
    for (var i = 0; i < 32; i++) { rev = (rev * 2) + (compat & 1); compat = Math.floor(compat / 2); }
    var cons = []; for (var j = 6; j < 12; j++) cons.push(c[j]); while (cons.length && cons[cons.length - 1] === 0) cons.pop();
    return 'hvc1.' + ['', 'A', 'B', 'C'][space] + prof + '.' + (rev >>> 0).toString(16) + '.' + (tier ? 'H' : 'L') + c[12] + (cons.length ? '.' + cons.map(function (x) { return x.toString(16); }).join('.') : '');
  }
  function ac3Box(f) {   // dac3 from the first AC-3 frame
    if (!f || f.length < 8 || f[0] !== 0x0B || f[1] !== 0x77) return null;
    var fscod = f[4] >> 6, frmsizecod = f[4] & 63, bsid = f[5] >> 3, bsmod = f[5] & 7, bits = (f[6] << 8) | f[7], acmod = bits >> 13, p = 3;
    if ((acmod & 1) && acmod !== 1) p += 2; if (acmod & 4) p += 2; if (acmod === 2) p += 2;
    var lfeon = (bits >> (15 - p)) & 1, brc = frmsizecod >> 1;
    var v = (fscod << 22) | (bsid << 17) | (bsmod << 14) | (acmod << 11) | (lfeon << 10) | (brc << 5);
    return box('dac3', [(v >> 16) & 255, (v >> 8) & 255, v & 255]);
  }
  function eac3Info(f, p) {
    if (f[p] !== 0x0B || f[p + 1] !== 0x77) return null;
    var strm = f[p + 2] >> 6, frmsiz = ((f[p + 2] & 7) << 8) | f[p + 3], fscod = f[p + 4] >> 6, nb = (f[p + 4] >> 4) & 3, blocks = fscod === 3 ? 6 : [1, 2, 3, 6][nb];
    var acmod = (f[p + 4] >> 1) & 7, lfeon = f[p + 4] & 1, bsid = f[p + 5] >> 3, rate = fscod === 3 ? [24000, 22050, 16000][nb] : [48000, 44100, 32000][fscod];
    return { strm: strm, size: (frmsiz + 1) * 2, fscod: fscod === 3 ? 0 : fscod, blocks: blocks, acmod: acmod, lfeon: lfeon, bsid: bsid, rate: rate };
  }
  function eac3Box(f) {
    var i0 = eac3Info(f, 0); if (!i0) return null;
    var dep = 0, p = i0.size, q; while (p + 6 < f.length && (q = eac3Info(f, p))) { if (q.strm === 1) dep++; if (q.size <= 0) break; p += q.size; }
    var rate = Math.round(i0.size * 8 * i0.rate / (i0.blocks * 256) / 1000);
    var b = [(rate >> 5) & 255, (rate & 31) << 3, (i0.fscod << 6) | (i0.bsid << 1), (i0.acmod << 1) | i0.lfeon];
    if (dep) { var loc = 0x10; b.push((1 << 1) | (loc >> 8), loc & 255); } else b.push(0);   // a dependent substream (7.1): the rear surround pair
    return box('dec3', b);
  }
  function aacBox(asc) {
    var dsi = [5, asc.length].concat(Array.prototype.slice.call(asc)), dcd = [4, 13 + dsi.length, 0x40, 0x15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0].concat(dsi), es = [3, 3 + dcd.length + 3, 0, 1, 0].concat(dcd, [6, 1, 2]);
    return box('esds', [0, 0, 0, 0].concat(es));
  }

  function start(v, url, cb) {
    var gen = 0, dead = false, ctl = null, ms = null, sbV = null, sbA = null, qV = [], qA = [];
    var T = { scale: 1000000, dur: 0, segStart: 0, firstCluster: -1, cuesPos: -1, size: 0, tracks: [], cues: null };
    var vt = null, at = null, texts = [], audios = [], subs = {}, started = false, ended = false, waitT = null, lastDts = -1;
    var bp = null, canBoost = false, rawA = [], gainT = null;   // the volume boost (boost.js): the sound goes through it when the volume is above 100 %
    function fail(why) { if (dead) return; dead = true; stopNet(); cb.fail && cb.fail(String(why)); }
    function stopNet() { gen++; if (ctl) { try { ctl.abort(); } catch (e) {} ctl = null; lastAbort = Date.now(); } clearTimeout(waitT); }
    var isFile = /^file:/i.test(url), filePath = url.replace(/^file:\/\//i, '');
    function fileGet(from, to) {   // a copy on the USB stick: read it with the TV's file API (fetch cannot open file:// here)
      return new Promise(function (ok, ko) {
        var fh; try { fh = tizen.filesystem.openFile(filePath, 'r'); } catch (e) { try { fh = tizen.filesystem.openFile(decodeURI(filePath), 'r'); } catch (e2) { return ko(e2); } }
        // big files (> ~2-4 GB): one long jump fails ("seek failed"), so jump in 1 GB steps from the start
        var STEP = 1073741824;
        function seekFar(pos) { fh.seek(0, 'BEGIN'); var left0 = pos; while (left0 > 0) { var st0 = Math.min(STEP, left0); fh.seek(st0, 'CURRENT'); left0 -= st0; } }
        try {
          if (!T.size) { try { T.size = fh.seek(0, 'END'); } catch (e) { if (!knownSize) throw e; T.size = knownSize; } }
          if (from < STEP) fh.seek(from, 'BEGIN'); else { seekFar(from); if (window.DIAG && !window.__farSeekOk) { window.__farSeekOk = 1; window.DIAG('bigfile', 'stepped seek ok to ' + from); } }
        } catch (e) { try { fh.close(); } catch (x) {} return ko(e); }
        var left = to >= 0 ? to - from + 1 : T.size - from, closed = false;
        function close() { if (!closed) { closed = true; try { fh.close(); } catch (e) {} } }
        ctl = { abort: close };
        function read() {
          return new Promise(function (ok2, ko2) {
            if (closed || left <= 0) { close(); return ok2({ done: true }); }
            // read method + size are tunable for the USB-speed tests (cast 'silent' night tests): blob is fastest on this TV
            var mode = window.__readMode || 'blob', n = Math.min(window.__readChunk || 4 * 1024 * 1024, left);
            var t0 = Date.now();
            var got = function (d) { if (closed) return ok2({ done: true }); if (!d || !d.length) { close(); return ok2({ done: true }); } left -= d.length; var r = window.__fileRate = window.__fileRate || { bytes: 0, ms: 0 }; r.bytes += d.length; r.ms += Date.now() - t0; r.mbps = Math.round(r.bytes / Math.max(1, r.ms) / 10.48576) / 100; ok2({ done: false, value: d }); };
            var gotBlob = function (b) { if (!b || !b.size) return got(null); var fin = function (ab) { got(new Uint8Array(ab)); }; if (b.arrayBuffer) b.arrayBuffer().then(fin, function (e) { ko2(e); }); else { var fr = new FileReader(); fr.onload = function () { fin(fr.result); }; fr.onerror = function () { ko2(fr.error); }; fr.readAsArrayBuffer(b); } };
            try {
              if (mode === 'blob' && fh.readBlobNonBlocking) fh.readBlobNonBlocking(gotBlob, function (e) { ko2(e); }, n);
              else if (mode === 'sync') got(fh.readData(n));
              else if (fh.readDataNonBlocking) fh.readDataNonBlocking(got, function (e) { ko2(e); }, n); else got(fh.readData(n));
            } catch (e) { ko2(e); }
          });
        }
        ok({ reader: function () { return { read: read, cancel: close }; }, all: function () { var parts = []; function loop() { return read().then(function (r) { if (r.done) return cat(parts); parts.push(r.value); return loop(); }); } return loop(); } });
      });
    }
    // Files over ~4 GB: the FileHandle API above cannot seek that far ("seek failed, fileHandle may be
    // corrupted", seen 2026-10-16 with an 8.6 GB episode). The older File/FileStream API has a 64-bit
    // 'position', so big copies are read through it instead.
    var bigFile = false, knownSize = 0;   // knownSize: the file's size from the older API, when the new one cannot tell
    function sizeOf() { return new Promise(function (ok) { try { tizen.filesystem.resolve(decodeURI(filePath).replace(/^\/+/, '/'), function (f) { ok(f.fileSize || 0); }, function () { ok(0); }, 'r'); } catch (e) { ok(0); } }); }
    function legacyGet(from, to) {
      return new Promise(function (ok, ko) {
        var p = decodeURI(filePath).replace(/^\/+/, '/');
        var onFile = function (f) {
          T.size = f.fileSize || T.size;
          f.openStream('r', function (fs) {
            try { fs.position = from; } catch (e) { try { fs.close(); } catch (x) {} return ko(e); }
            var left = to >= 0 ? to - from + 1 : T.size - from, closed = false;
            function close() { if (!closed) { closed = true; try { fs.close(); } catch (e) {} } }
            ctl = { abort: close };
            function read() {
              return new Promise(function (ok2, ko2) {
                if (closed || left <= 0) { close(); return ok2({ done: true }); }
                try {
                  var b64 = fs.readBase64(Math.min(512 * 1024, left));
                  if (!b64) { close(); return ok2({ done: true }); }
                  var bin = atob(b64), d = new Uint8Array(bin.length);
                  for (var i = 0; i < bin.length; i++) d[i] = bin.charCodeAt(i);
                  if (!d.length) { close(); return ok2({ done: true }); }
                  left -= d.length; setTimeout(function () { ok2({ done: false, value: d }); }, 0);
                } catch (e) { ko2(e); }
              });
            }
            ok({ reader: function () { return { read: read, cancel: close }; }, all: function () { var parts = []; function loop() { return read().then(function (r) { if (r.done) return cat(parts); parts.push(r.value); return loop(); }); } return loop(); } });
          }, ko, 'UTF-8');
        };
        try { tizen.filesystem.resolve(p, onFile, function () { try { tizen.filesystem.resolve(filePath, onFile, ko, 'r'); } catch (e) { ko(e); } }, 'r'); } catch (e) { ko(e); }
      });
    }
    function get(from, to) {
      if (isFile) {
        if (bigFile) return legacyGet(from, to);
        return fileGet(from, to).catch(function (e) {
          if (!/seek/i.test(String(e && (e.message || e.name) || e))) throw e;
          if (!knownSize) return sizeOf().then(function (n) { knownSize = n; if (!n) throw e; return fileGet(from, to); })
            .catch(function () { bigFile = true; return legacyGet(from, to); });
          bigFile = true; if (window.DIAG) window.DIAG('bigfile', 'FileHandle cannot seek, using FileStream');
          return legacyGet(from, to);
        });
      }
      var c = window.AbortController ? new AbortController() : null; ctl = c;
      var h = { Range: 'bytes=' + from + '-' + (to >= 0 ? to : '') }, wait = Math.max(0, lastAbort + 400 - Date.now());
      return new Promise(function (ok) { setTimeout(ok, wait); }).then(function () { if (c && c.signal.aborted) throw new Error('aborted'); return fetch(url, { headers: h, cache: 'no-store', signal: c ? c.signal : undefined }).then(function (r) {
        if (r.status === 416) return { reader: function () { return { read: function () { return Promise.resolve({ done: true }); }, cancel: function () {} }; }, all: function () { return Promise.resolve(new Uint8Array(0)); } };   // asked past the end: the file is complete
        if (!(r.status === 206 || r.status === 200)) throw new Error('HTTP ' + r.status);
        var cr = r.headers.get('Content-Range'); if (cr && /\/(\d+)/.test(cr)) T.size = Number(RegExp.$1);
        if (r.status === 200 && from > 0) throw new Error('no ranges');
        return { reader: function () { return r.body.getReader(); }, all: function () { return r.arrayBuffer().then(function (ab) { return new Uint8Array(ab); }); } };
      }); });
    }
    function bytes(from, len) { return get(from, from + len - 1).then(function (r) { return r.all(); }).then(function (b) { ctl = null; return b; }); }

    // header: Segment, SeekHead, Info, Tracks
    function readHeader() {
      return bytes(0, 1024 * 1024).then(function (b) {
        if (/^(ftyp|moov|mdat|free|wide|skip|styp)$/.test(str4(b, 4))) return readMp4(b);
        var h = head(b, 0); if (!h || h.id !== ID.EBML) throw new Error('not matroska');
        var p = h.hl + h.size; h = head(b, p); if (!h || h.id !== ID.Segment) throw new Error('no segment');
        T.segStart = p + h.hl; p = T.segStart;
        var tracksAt = -1, infoAt = -1;
        while (p < b.length) {
          h = head(b, p); if (!h) break; var d = p + h.hl;
          if (h.id === ID.Cluster) { T.firstCluster = p; break; }
          if (d + h.size > b.length && h.id !== ID.Cluster) { if (h.id === ID.Tracks) tracksAt = p; else if (h.id === ID.Info) infoAt = p; break; }
          if (h.id === ID.SeekHead) kids(b, d, d + h.size, function (id, sd, sl) { if (id !== ID.Seek) return; var sid = 0, spos = -1; kids(b, sd, sd + sl, function (i2, d2, l2) { if (i2 === ID.SeekID) sid = uint(b, d2, l2); else if (i2 === ID.SeekPosition) spos = uint(b, d2, l2); }); if (sid === ID.Cues) T.cuesPos = T.segStart + spos; if (sid === ID.Tracks && tracksAt < 0) tracksAt = -2 - (T.segStart + spos); if (sid === ID.Cluster && T.firstCluster < 0) T.firstCluster = T.segStart + spos; });
          else if (h.id === ID.Info) parseInfo(b, d, h.size);
          else if (h.id === ID.Tracks) { parseTracks(b, d, h.size); tracksAt = -1; }
          p = d + h.size;
        }
        if (!T.tracks.length) throw new Error('tracks not in the first MB');
        if (T.firstCluster < 0) T.firstCluster = p;
      });
    }
    function parseInfo(b, d, n) { var dur = 0; kids(b, d, d + n, function (id, p, l) { if (id === ID.TimecodeScale) T.scale = uint(b, p, l); else if (id === ID.Duration) dur = flt(b, p, l); }); T.dur = dur * T.scale / 1e9; }
    function parseTracks(b, d, n) {
      kids(b, d, d + n, function (id, p, l) {
        if (id !== ID.TrackEntry) return;
        var t = { num: 0, type: 0, lang: 'eng', ietf: '', name: '', codec: '', priv: null, def: 1, forced: 0, w: 0, h: 0, rate: 48000, channels: 2, strip: null, comp: -1, dflDur: 0 };
        kids(b, p, p + l, function (i2, q, m) {
          if (i2 === ID.TrackNumber) t.num = uint(b, q, m); else if (i2 === ID.TrackType) t.type = uint(b, q, m);
          else if (i2 === ID.Language) t.lang = utf8(b, q, m).replace(/\0.*$/, ''); else if (i2 === ID.LanguageIETF) t.ietf = utf8(b, q, m);
          else if (i2 === ID.Name) t.name = utf8(b, q, m); else if (i2 === ID.CodecID) t.codec = utf8(b, q, m).replace(/\0.*$/, '');
          else if (i2 === ID.CodecPrivate) t.priv = b.slice(q, q + m); else if (i2 === ID.FlagDefault) t.def = uint(b, q, m); else if (i2 === ID.FlagForced) t.forced = uint(b, q, m);
          else if (i2 === ID.DefaultDuration) t.dflDur = uint(b, q, m) / 1e9;
          else if (i2 === ID.Video) kids(b, q, q + m, function (i3, r, k) { if (i3 === ID.PixelWidth) t.w = uint(b, r, k); else if (i3 === ID.PixelHeight) t.h = uint(b, r, k); });
          else if (i2 === ID.Audio) kids(b, q, q + m, function (i3, r, k) { if (i3 === ID.SamplingFrequency) t.rate = Math.round(flt(b, r, k)); else if (i3 === ID.Channels) t.channels = uint(b, r, k); });
          else if (i2 === ID.ContentEncodings) kids(b, q, q + m, function (i3, r, k) { if (i3 === ID.ContentEncoding) kids(b, r, r + k, function (i4, s, j) { if (i4 === ID.ContentCompression) { t.comp = 0; kids(b, s, s + j, function (i5, x, y) { if (i5 === ID.ContentCompAlgo) t.comp = uint(b, x, y); else if (i5 === ID.ContentCompSettings) t.strip = b.slice(x, x + y); }); } }); });
        });
        T.tracks.push(t);
      });
    }
    function setupTracks() {
      var MS = window.MediaSource;
      T.tracks.forEach(function (t) {
        if (t.comp >= 0 && t.comp !== 3 && !(t.type === 17 && t.comp === 0)) { t.bad = 'compressed'; }
        if (t.type === 1 && !vt && !t.bad) {
          if (t.codec === 'V_MPEG4/ISO/AVC' && t.priv) { t.mp4type = 'avc1'; t.mime = 'video/mp4; codecs="avc1.' + hex2(t.priv[1]) + hex2(t.priv[2]) + hex2(t.priv[3]) + '"'; }
          else if (t.codec === 'V_MPEGH/ISO/HEVC' && t.priv) { t.mp4type = 'hvc1'; t.mime = 'video/mp4; codecs="' + hevcCodec(t.priv) + '"'; }
          if (t.mime && MS.isTypeSupported(t.mime)) { t.kind = 'video'; t.scale = 90000; vt = t; }
        } else if (t.type === 2) {
          t.kind = 'audio'; t.scale = t.rate;
          if (t.codec === 'A_AC3') { t.mp4type = 'ac-3'; t.mime = 'audio/mp4; codecs="ac-3"'; }
          else if (t.codec === 'A_EAC3') { t.mp4type = 'ec-3'; t.mime = 'audio/mp4; codecs="ec-3"'; }
          else if (/^A_AAC/.test(t.codec) && t.priv) { t.mp4type = 'mp4a'; t.mime = 'audio/mp4; codecs="mp4a.40.2"'; t.cfgBox = aacBox(t.priv); }
          t.ok = !t.bad && !!t.mime && MS.isTypeSupported(t.mime);
          audios.push(t);
        } else if (t.type === 17) {
          t.textKind = t.bad ? '' : /^S_TEXT\/(UTF8|ASCII)/.test(t.codec) ? 'srt' : /^S_TEXT\/(ASS|SSA)|^S_(ASS|SSA)/.test(t.codec) ? 'ass' : /WEBVTT/.test(t.codec) ? 'vtt' : (t.codec === 'S_HDMV/PGS' && window.SUBIMG) ? 'pgs' : (t.codec === 'S_VOBSUB' && window.SUBIMG && t.priv) ? 'vobsub' : '';
          if (t.textKind === 'pgs') t.dec = SUBIMG.PGS(); else if (t.textKind === 'vobsub') t.dec = SUBIMG.VobSub(t.priv);
          texts.push(t); subs[t.num] = [];
        }
      });
      if (!vt) throw new Error('video codec not supported');
    }
    function pickAudio() {
      var pick = cb.audio >= 0 && audios[cb.audio] && audios[cb.audio].ok ? audios[cb.audio] : null;
      if (!pick) audios.forEach(function (t) { if (!pick && t.ok && /^(en|eng)$/i.test(t.ietf || t.lang)) pick = t; });
      if (!pick) audios.forEach(function (t) { if (!pick && t.ok && t.def) pick = t; });
      if (!pick) audios.forEach(function (t) { if (!pick && t.ok) pick = t; });
      at = pick;
      if (audios.length && !at) throw new Error('no audio track the web player can take');   // e.g. DTS only: play the file directly instead of silently
      canBoost = !!(window.ABOOST && ABOOST.can(at));
      if (canBoost && cb.boost && cb.boost() > 1) { bp = ABOOST.make(at); bp.setGain(cb.boost()); at.mime = bp.mime; at.mp4type = bp.mp4type; at.cfgBox = bp.cfgBox; at.channels = bp.channels; }
      if (cb.needText && !bp && !texts.some(function (t) { return t.textKind; })) throw new Error('no subtitles in the file');   // nothing to gain: the web player plays it directly
    }


    // ================= MP4 / M4V =================
    // The sample tables in 'moov' say where every frame and subtitle sits; we read the file in order and cut it into fragments.
    function str4(b, p) { return b.length >= p + 4 ? String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]) : ''; }
    function mbox(b, p, end, fn) { while (p + 8 <= end) { var sz = uint(b, p, 4), ty = str4(b, p + 4), hl = 8; if (sz === 1) { sz = uint(b, p + 8, 8); hl = 16; } else if (sz === 0) sz = end - p; if (sz < hl) break; fn(ty, p + hl, Math.min(end, p + sz), p); p += sz; } }
    function readMp4(first) {
      T.mp4 = true;
      function at(pos) {   // the box header at a file position, from the first MB when it is there
        if (pos + 16 <= first.length) return Promise.resolve(first.subarray(pos, pos + 16));
        return bytes(pos, 16);
      }
      function walk(pos, guard) {
        if (guard > 40 || (T.size && pos >= T.size)) return Promise.reject(new Error('no moov'));
        return at(pos).then(function (h) {
          var sz = uint(h, 0, 4), ty = str4(h, 4), hl = 8; if (sz === 1) { sz = uint(h, 8, 8); hl = 16; } else if (sz === 0) sz = (T.size || 0) - pos;
          if (sz < 8) throw new Error('bad mp4 box');
          if (ty === 'moov') {
            if (sz > 64 * 1024 * 1024) throw new Error('moov too large');
            var whole = pos + sz <= first.length ? Promise.resolve(first.subarray(pos + hl, pos + sz)) : bytes(pos + hl, sz - hl);
            return whole.then(parseMoov);
          }
          if (ty === 'moof') throw new Error('fragmented mp4');
          return walk(pos + sz, guard + 1);
        });
      }
      return walk(0, 0);
    }
    function parseMoov(b) {
      var mvScale = 1000, list = [];
      mbox(b, 0, b.length, function (ty, d, e) {
        if (ty === 'mvhd') { var ver = b[d]; mvScale = ver ? uint(b, d + 20, 4) : uint(b, d + 12, 4); var du = ver ? uint(b, d + 24, 8) : uint(b, d + 16, 4); if (mvScale) T.dur = du / mvScale; }
        else if (ty === 'trak') {
          var t = { mt: 0, empty: 0, lang: 'und', name: '', tkFlags: 0 };
          (function walk(d0, e0) {
            mbox(b, d0, e0, function (ty2, cd, ce) {
              if (ty2 === 'edts' || ty2 === 'mdia' || ty2 === 'minf' || ty2 === 'stbl') walk(cd, ce);
              else if (ty2 === 'tkhd') { t.tkFlags = b[cd + 3]; t.id = b[cd] ? uint(b, cd + 20, 4) : uint(b, cd + 12, 4); }
              else if (ty2 === 'elst') {
                var v1 = b[cd] === 1, n = uint(b, cd + 4, 4), q = cd + 8, empty = 0;
                for (var i = 0; i < n && q < ce; i++) { var sd = v1 ? uint(b, q, 8) : uint(b, q, 4), mt = v1 ? uint(b, q + 8, 8) : uint(b, q + 4, 4); q += v1 ? 20 : 12; if ((v1 && mt >= 18446744073709550000) || (!v1 && mt === 0xFFFFFFFF)) empty += sd; else { t.mt = mt; break; } }
                t.emptyMv = empty;
              }
              else if (ty2 === 'mdhd') { var vv = b[cd]; t.scale = vv ? uint(b, cd + 20, 4) : uint(b, cd + 12, 4); var L = uint(b, vv ? cd + 32 : cd + 20, 2); if (L && L !== 0x7FFF) t.lang = String.fromCharCode(((L >> 10) & 31) + 96, ((L >> 5) & 31) + 96, (L & 31) + 96); }
              else if (ty2 === 'hdlr') { t.handler = str4(b, cd + 8); }
              else if (ty2 === 'stsd') { var es = uint(b, cd + 8, 4); t.entry = b.subarray(cd + 8, cd + 8 + es); t.fmt = str4(b, cd + 12); }
              else if (/^(stts|ctts|stss|stsz|stsc|stco|co64)$/.test(ty2)) t[ty2] = b.subarray(cd, ce);
            });
          })(d, e);
          list.push(t);
        }
      });
      list.forEach(function (t) { t.empty = (t.emptyMv || 0) / mvScale; t.num = t.id; T.tracks.push(t); });
      if (!T.tracks.length) throw new Error('mp4 without tracks');
    }
    function esdsCodec(box) {   // 'mp4a.40.2' style name from an esds box
      var p = 12, ot = 0x40, aot = 2;
      function len() { var n = 0, k = 0, x; do { x = box[p++]; n = (n << 7) | (x & 0x7F); } while ((x & 0x80) && ++k < 4); return n; }
      while (p < box.length) {
        var tag = box[p++], l = len();
        if (tag === 3) { p += 2; var fl = box[p++]; if (fl & 0x80) p += 2; if (fl & 0x40) p += 1 + box[p]; if (fl & 0x20) p += 2; continue; }
        if (tag === 4) { ot = box[p]; p += 13; continue; }
        if (tag === 5) { aot = box[p] >> 3; if (aot === 31) aot = 32 + (((box[p] & 7) << 3) | (box[p + 1] >> 5)); break; }
        p += l;
      }
      if (ot === 0x40 || ot === 0x66 || ot === 0x67 || ot === 0x68) return 'mp4a.40.' + (aot || 2);
      if (ot === 0x69 || ot === 0x6B) return 'mp4a.6B';
      return 'mp4a.40.2';
    }
    function setupMp4() {
      var MS = window.MediaSource;
      T.tracks.forEach(function (t) {
        var en = t.entry; if (!en) return;
        if (t.handler === 'vide' && !vt) {
          T.vfmt = (T.vfmt ? T.vfmt + ',' : '') + t.fmt;
          if (!/^(avc1|avc3|hvc1|hev1|vp09|av01)$/.test(t.fmt)) return;
          mbox(en, 86, en.length, function (ty, cd, ce, bp) { if (ty === 'avcC' || ty === 'hvcC') t.priv = en.slice(cd, ce); else if (ty === 'vpcC' || ty === 'av1C') { t.priv = en.slice(cd, ce); t.rawEntry = en; } });
          if (!t.priv) return;
          t.w = uint(en, 32, 2); t.h = uint(en, 34, 2); t.mp4type = t.fmt; t.kind = 'video';
          var cs;
          if (/^avc/.test(t.fmt)) cs = t.fmt + '.' + hex2(t.priv[1]) + hex2(t.priv[2]) + hex2(t.priv[3]);
          else if (/^(hvc1|hev1)$/.test(t.fmt)) cs = hevcCodec(t.priv).replace(/^hvc1/, t.fmt);
          else if (t.fmt === 'vp09') { var pv = t.priv; cs = 'vp09.' + ('0' + pv[4]).slice(-2) + '.' + ('0' + pv[5]).slice(-2) + '.' + ('0' + (pv[6] >> 4)).slice(-2); }
          else { var a1 = t.priv, prof = a1[1] >> 5, lvl = a1[1] & 31, tier = a1[2] >> 7, hbd = (a1[2] >> 6) & 1, twelve = (a1[2] >> 5) & 1; cs = 'av01.' + prof + '.' + ('0' + lvl).slice(-2) + (tier ? 'H' : 'M') + '.' + (hbd ? (twelve ? '12' : '10') : '08'); }
          t.mime = 'video/mp4; codecs="' + cs + '"';
          if (MS.isTypeSupported(t.mime)) vt = t; else T.vfmt += '(' + cs + ' not supported)';
        } else if (t.handler === 'soun') {
          var ver = uint(en, 16, 2), cs = 36 + (ver === 1 ? 16 : ver === 2 ? 36 : 0);
          t.kind = 'audio'; t.channels = uint(en, 24, 2) || 2; t.rate = ver === 2 ? t.scale : (uint(en, 32, 2) || t.scale); t.mp4type = t.fmt;
          mbox(en, cs, en.length, function (ty, cd, ce, bp) { if (ty === 'esds' || ty === 'dac3' || ty === 'dec3' || ty === 'dOps') t.cfgBox = en.slice(bp, ce); });
          if (t.fmt === 'mp4a' && t.cfgBox) t.mime = 'audio/mp4; codecs="' + esdsCodec(t.cfgBox) + '"';
          else if (t.fmt === 'ac-3' && t.cfgBox) t.mime = 'audio/mp4; codecs="ac-3"';
          else if (t.fmt === 'ec-3' && t.cfgBox) t.mime = 'audio/mp4; codecs="ec-3"';
          else if (t.fmt === 'Opus' && t.cfgBox) t.mime = 'audio/mp4; codecs="opus"';
          t.ok = !!t.mime && MS.isTypeSupported(t.mime); t.def = t.tkFlags & 1;
          audios.push(t);
        } else if (/^(sbtl|text|subt)$/.test(t.handler)) {
          t.textKind = /^(tx3g|text)$/.test(t.fmt) ? 'tx3g' : t.fmt === 'wvtt' ? 'wvtt' : '';
          texts.push(t); subs[t.num] = [];
        }
      });
      if (!vt) throw new Error('video codec not supported: ' + (T.vfmt || 'none'));
      [vt].concat(audios, texts).forEach(function (t) { if (t === vt || t.textKind || t.ok) expand(t); });
    }
    function expand(t) {   // sample tables -> per-sample offset, size, decode time, duration, composition offset, keyframe
      if (t.tb) return t.tb;
      var sz = t.stsz, n = sz ? uint(sz, 8, 4) : 0, fixed = sz ? uint(sz, 4, 4) : 0, i, j;
      var tb = { n: n, sizes: new Uint32Array(n), offsets: new Float64Array(n), dts: new Float64Array(n), durs: new Uint32Array(n), cts: null, sync: null, chunks: [] };
      for (i = 0; i < n; i++) tb.sizes[i] = fixed || uint(sz, 12 + i * 4, 4);
      var co = t.stco || t.co64, big = !t.stco, nch = co ? uint(co, 4, 4) : 0, sc = t.stsc, nsc = sc ? uint(sc, 4, 4) : 0, e = 0, smp = 0;
      for (var c = 0; c < nch && smp < n; c++) {
        while (e + 1 < nsc && uint(sc, 8 + (e + 1) * 12, 4) <= c + 1) e++;
        var spc = nsc ? uint(sc, 8 + e * 12 + 4, 4) : 1, off = big ? uint(co, 8 + c * 8, 8) : uint(co, 8 + c * 4, 4), first = smp;
        for (j = 0; j < spc && smp < n; j++) { tb.offsets[smp] = off; off += tb.sizes[smp]; smp++; }
        tb.chunks.push({ off: tb.offsets[first], first: first, count: smp - first, t: t });
      }
      var st = t.stts, ne = st ? uint(st, 4, 4) : 0, d = 0, k = 0, last = 0;
      for (i = 0; i < ne; i++) { var cnt = uint(st, 8 + i * 8, 4), dl = uint(st, 12 + i * 8, 4); for (j = 0; j < cnt && k < n; j++) { tb.dts[k] = d; tb.durs[k] = dl; d += dl; k++; } last = dl; }
      for (; k < n; k++) { tb.dts[k] = d; tb.durs[k] = last; d += last; }
      if (t.ctts) { tb.cts = new Int32Array(n); var nc = uint(t.ctts, 4, 4); k = 0; for (i = 0; i < nc; i++) { var cc = uint(t.ctts, 8 + i * 8, 4), ov = uint(t.ctts, 12 + i * 8, 4) | 0; for (j = 0; j < cc && k < n; j++) tb.cts[k++] = ov; } }
      if (t.stss) { tb.sync = new Uint8Array(n); var ns = uint(t.stss, 4, 4); for (i = 0; i < ns; i++) { var sn = uint(t.stss, 8 + i * 4, 4) - 1; if (sn >= 0 && sn < n) tb.sync[sn] = 1; } }
      t.tsOff = (t.empty || 0) - (t.mt || 0) / t.scale;
      t.tb = tb; return tb;
    }
    var M = null, cur = null, accV = [], accA = [];
    function buildMerged() {
      var all = []; [vt, at].concat(texts.filter(function (t) { return t.textKind && t.tb; })).forEach(function (t) { if (t && t.tb) all = all.concat(t.tb.chunks); });
      all.sort(function (x, y) { return x.off - y.off; }); M = all;
    }
    function firstAtOrAfter(tb, d0) { var lo = 0, hi = tb.n - 1, r = tb.n; while (lo <= hi) { var mid = (lo + hi) >> 1; if (tb.dts[mid] >= d0) { r = mid; hi = mid - 1; } else lo = mid + 1; } return r; }
    function mp4Cursor(tsec) {   // where to start reading for a given time: the keyframe at or before it
      if (!M) buildMerged();
      var V = vt.tb, target = (tsec - vt.tsOff) * vt.scale, k = Math.max(0, Math.min(V.n - 1, firstAtOrAfter(V, target + 1) - 1));
      if (V.sync) while (k > 0 && !V.sync[k]) k--;
      var vsec = V.dts[k] / vt.scale + vt.tsOff, starts = {}, pos = V.offsets[k];
      starts[vt.num] = k;
      if (at && at.tb) { var ak = firstAtOrAfter(at.tb, (vsec - at.tsOff) * at.scale); starts[at.num] = ak; if (ak < at.tb.n) { if (Math.abs(at.tb.offsets[ak] - pos) > 96 * 1024 * 1024) throw new Error('sound and picture far apart in the file'); pos = Math.min(pos, at.tb.offsets[ak]); } }
      texts.forEach(function (t) { if (t.tb) starts[t.num] = firstAtOrAfter(t.tb, (vsec - 10 - t.tsOff) * t.scale); });
      var lo = 0, hi = M.length - 1, mi = 0; while (lo <= hi) { var mid = (lo + hi) >> 1; if (M[mid].off <= pos) { mi = mid; lo = mid + 1; } else hi = mid - 1; }
      return { pos: pos, mi: mi, k: 0, starts: starts, done: false };
    }
    function mp4Emit(t, i, data) {
      var tb = t.tb;
      if (t === vt || t === at) {
        var acc = t === vt ? accV : accA;
        acc.push({ data: data, dts: tb.dts[i], dur: tb.durs[i], cts: tb.cts ? tb.cts[i] : 0, key: tb.sync ? !!tb.sync[i] : true });
        if (tb.dts[i] + tb.durs[i] - acc[0].dts >= t.scale) mp4Flush(t);
        return;
      }
      if (!t.textKind) return;
      var s0 = (tb.dts[i] + (tb.cts ? tb.cts[i] : 0)) / t.scale + t.tsOff, e0 = s0 + tb.durs[i] / t.scale, txt = '';
      if (t.textKind === 'tx3g') { var L = data.length >= 2 ? (data[0] << 8) | data[1] : 0; txt = L ? utf8(data, 2, Math.min(L, data.length - 2)) : ''; }
      else mbox(data, 0, data.length, function (ty, cd, ce) { if (ty === 'vttc') mbox(data, cd, ce, function (ty2, pd, pe) { if (ty2 === 'payl') txt += (txt ? '\n' : '') + utf8(data, pd, pe - pd); }); });
      if (!txt) return;
      var list = subs[t.num];
      if (!list.length || list[list.length - 1].s < s0) list.push({ s: s0, e: e0, t: txt });
      else if (!list.some(function (c) { return Math.abs(c.s - s0) < 0.01; })) { list.push({ s: s0, e: e0, t: txt }); list.sort(function (x, y) { return x.s - y.s; }); }
    }
    function mp4Flush(t) {
      var acc = t === vt ? accV : accA; if (!acc.length) return;
      var frag = t === at && bp ? null : fragment(acc.map(function (x) { return { data: x.data, dur: x.dur, cts: x.cts, key: x.key }; }), acc[0].dts), acc0 = acc.slice();
      acc.length = 0;
      if (t === vt) { qV.push({ data: frag }); pump(sbV, qV); } else if (sbA) { if (bp) audioOut(acc0.map(function (x) { return { data: x.data, dur: x.dur, st: x.dts, key: true, cts: 0 }; })); else { qA.push({ data: frag }); pump(sbA, qA); } }
    }

    // ---- Media Source plumbing ----
    function pump(sb, q) {
      if (!sb || sb.updating || !q.length || dead) return;
      var op = q[0];
      try {
        if (op.rm) { q.shift(); var s = Math.max(0, op.rm[0]), e = op.rm[1]; if (e > s) sb.remove(s, e); else pump(sb, q); }
        else { sb.appendBuffer(op.data); q.shift(); }
      } catch (e) {
        if (e && e.name === 'QuotaExceededError') { trimBehind(2); setTimeout(function () { pump(sb, q); }, 700); }
        else fail('append: ' + (e && e.message));
      }
    }
    function addSb(t) {
      var sb = ms.addSourceBuffer(t.mime), q = t === vt ? qV : qA;
      if (t.tsOff) { try { sb.timestampOffset = t.tsOff; } catch (e) {} }   // MP4 edit list (e.g. the B-frame delay)
      sb.addEventListener('updateend', function () { pump(sb, q); maybeEnd(); });
      sb.addEventListener('error', function () { fail('source buffer error'); });
      return sb;
    }
    function trimBehind(keep) { var c = v.currentTime - (keep || 15), b0 = -1; try { if (sbV.buffered.length) b0 = sbV.buffered.start(0); } catch (e) {} if (c > 1 && b0 >= 0 && b0 < c - 2) { qV.push({ rm: [0, c] }); if (sbA) qA.push({ rm: [0, c] }); pump(sbV, qV); pump(sbA, qA); } }
    function aheadSec() { try { var b = sbV.buffered, t = v.currentTime; for (var i = 0; i < b.length; i++) if (b.start(i) <= t + 0.5 && b.end(i) > t) return b.end(i) - t; } catch (e) {} return 0; }
    function inBuf(t) { function has(sb) { if (!sb) return true; try { var b = sb.buffered; for (var i = 0; i < b.length; i++) if (b.start(i) <= t + 0.3 && b.end(i) > t + 0.5) return true; } catch (e) {} return false; } return has(sbV) && has(sbA); }
    function maybeEnd() { if (ended && !qV.length && !qA.length && !(bp && bp.pending()) && !(sbV && sbV.updating) && !(sbA && sbA.updating) && ms.readyState === 'open') { try { ms.endOfStream(); } catch (e) {} } }

    function audioIndex() { return audios.indexOf(at); }
    // boost: frames go through boost.js and come back as FLAC, in order; the last ~30 s of raw frames are kept for a volume change
    function audioOut(frames) {
      if (!bp) { qA.push({ data: fragment(frames, frames[0].st) }); pump(sbA, qA); return; }
      rawA = rawA.concat(frames); var keep = (v.currentTime - 2) * at.scale - (at.tsOff || 0) * at.scale; while (rawA.length > 64 && rawA[0].st < keep) rawA.shift();
      var g = gen; bp.run(frames, function (out) { if (g !== gen || dead) return; qA.push({ data: fragment(out, out[0].st) }); pump(sbA, qA); maybeEnd(); });
    }
    function regain(gn) {   // a new boost level: from 1.5 s ahead, the sound is made again from the kept frames at the new level
      if (!bp || dead || Math.abs(gn - bp.gain()) < 0.001) return;
      var cut = (v.currentTime + 1.5 - (at.tsOff || 0)) * at.scale, fp = bp.firstPending(); if (fp >= 0 && fp < cut) cut = fp;
      var k = 0; while (k < rawA.length && rawA[k].st < cut) k++;
      bp.setGain(gn); var redo = rawA.slice(k), before = rawA.slice(Math.max(0, k - 2), k); rawA = rawA.slice(0, k);
      bp.reset(before); if (!redo.length) return;
      qA.push({ rm: [redo[0].st / at.scale + (at.tsOff || 0), Infinity] }); pump(sbA, qA);
      for (var i = 0; i < redo.length; i += 48) audioOut(redo.slice(i, i + 48));
    }
    // ---- cluster parsing -> fragments + subtitle lines ----
    var cl = null;   // current cluster: { tc, v: [], a: [] }
    function laces(b, p, end, flags) {
      var lt = flags & 6; if (!lt) return [b.subarray(p, end)];
      var n = b[p] + 1, sizes = [], q = p + 1, i;
      if (lt === 2) { for (i = 0; i < n - 1; i++) { var s = 0, x; do { x = b[q++]; s += x; } while (x === 255); sizes.push(s); } }
      else if (lt === 6) { var f = vint(b, q); sizes.push(f.v); q += f.n; for (i = 1; i < n - 1; i++) { var d = vint(b, q); var bias = Math.pow(2, 7 * d.n - 1) - 1; sizes.push(sizes[i - 1] + d.v - bias); q += d.n; } }
      else { var each = Math.floor((end - q) / n); for (i = 0; i < n - 1; i++) sizes.push(each); }
      var out = []; for (i = 0; i < n - 1; i++) { out.push(b.subarray(q, q + sizes[i])); q += sizes[i]; } out.push(b.subarray(q, end)); return out;
    }
    function block(b, p, end, simple, dur, hasRef) {
      var tn = vint(b, p); if (!tn) return; var q = p + tn.n, rel = (b[q] << 8) | b[q + 1]; if (rel & 0x8000) rel -= 0x10000;
      var flags = b[q + 2], t = T.tracks.filter(function (x) { return x.num === tn.v; })[0]; if (!t) return;
      var ts = (cl.tc + rel) * T.scale / 1e9, key = simple ? !!(flags & 0x80) : !hasRef;
      if (t === vt || t === at) {
        laces(b, q + 3, end, flags).forEach(function (fr) {
          var data = t.strip ? cat([t.strip, fr]) : fr;
          (t === vt ? cl.v : cl.a).push({ ts: ts, data: data, key: key });
        });
      } else if (t.type === 17 && t.textKind) {
        var raw = b.subarray(q + 3, end);
        if (t.comp === 0) { try { raw = SUBIMG.inflate(raw); } catch (x) { return; } }
        if (t.strip) raw = cat([t.strip, raw]);
        if (t.textKind === 'pgs') { var pe = null; try { pe = t.dec(raw); } catch (x) {} if (pe) addImg(t.num, ts, pe.clear ? null : pe.img, dur > 0 ? ts + dur * T.scale / 1e9 : undefined); return; }
        if (t.textKind === 'vobsub') { var ve = null; try { ve = t.dec(raw); } catch (x) {} if (ve) addImg(t.num, ts + ve.start, ve.img, ve.stop >= 0 ? ts + ve.stop : dur > 0 ? ts + dur * T.scale / 1e9 : ts + 5); return; }
        var txt = utf8(raw, 0, raw.length);
        if (t.textKind === 'ass') txt = txt.split(',').slice(8).join(',').replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n');
        var e = dur > 0 ? ts + dur * T.scale / 1e9 : ts + 4, list = subs[t.num];
        if (!list.length || list[list.length - 1].s < ts) list.push({ s: ts, e: e, t: txt });
        else { var dup = list.some(function (c) { return Math.abs(c.s - ts) < 0.01; }); if (!dup) { list.push({ s: ts, e: e, t: txt }); list.sort(function (x, y) { return x.s - y.s; }); } }
      }
    }
    function flushCluster() {
      if (!cl) return; var c = cl; cl = null;
      if (c.v.length) {
        var vs = c.v, pts = vs.map(function (s) { return Math.round(s.ts * 90000); }), sorted = pts.slice().sort(function (a, b) { return a - b; });
        var dflt = vt.dflDur ? Math.round(vt.dflDur * 90000) : 3754, dts = sorted.slice();
        if (lastDts >= 0 && dts[0] <= lastDts) { var sh = lastDts + 1 - dts[0]; dts = dts.map(function (x) { return x + sh; }); }
        for (var i = 1; i < dts.length; i++) if (dts[i] <= dts[i - 1]) dts[i] = dts[i - 1] + 1;
        var smp = vs.map(function (s, i) { return { data: s.data, key: s.key, dur: i + 1 < dts.length ? dts[i + 1] - dts[i] : dflt, cts: pts[i] - dts[i] }; });
        lastDts = dts[dts.length - 1];
        qV.push({ data: fragment(smp, dts[0]) }); pump(sbV, qV);
      }
      if (c.a.length && at) {
        var sr = at.rate, as = [], base = Math.round(c.a[0].ts * sr), prevEnd = -1;
        c.a.forEach(function (s) {
          var n = 1536;
          if (at.mp4type === 'mp4a') n = 1024;
          else if (at.mp4type === 'ec-3') { n = 0; var p = 0, inf; while (p + 6 <= s.data.length && (inf = eac3Info(s.data, p))) { if (inf.strm !== 1) n += inf.blocks * 256; p += inf.size; if (inf.size <= 0) break; } if (!n) n = 1536; }
          var st0 = Math.round(s.ts * sr); if (prevEnd >= 0 && Math.abs(st0 - prevEnd) < n / 2) st0 = prevEnd;
          if (as.length) as[as.length - 1].dur = Math.max(1, st0 - as[as.length - 1].st);
          as.push({ data: s.data, key: true, dur: n, st: st0, cts: 0 }); prevEnd = st0 + n;
        });
        audioOut(as);
      }
    }

    // ---- network loop ----
    function stream(fromPos, g, resync) {
      var buf = new Uint8Array(0), off = 0, chunks = [], have = 0, abs = fromPos, clusterEnd = -1, clusterStart = -1, skip = 0, done = false, reader = null, netPos = fromPos, rangeEnd = -1;
      cl = null;
      // the file comes in 16 MB requests, one after the other (one open-ended request let the TV's network layer race ~100 MB ahead)
      function openRange(pos) {
        rangeEnd = isFile ? -1 : pos + RANGE - 1;
        get(pos, rangeEnd).then(function (r) {
          if (g !== gen) { try { ctl.abort(); } catch (e) {} return; }
          reader = r.reader(); next();
        }).catch(netErr);
      }
      openRange(fromPos);
      function avail() { return buf.length - off + have; }
      // only as many network chunks as the next element needs are joined (joining everything each time kept ~100 MB alive on the TV and froze it)
      function need(n) {
        if (off >= buf.length && chunks.length) { buf = chunks.shift(); have -= buf.length; off = 0; }
        if (buf.length - off >= n) return true; if (avail() < n) return false;
        var parts = [buf.subarray(off)], got = buf.length - off;
        while (got < n && chunks.length) { var c = chunks.shift(); have -= c.length; parts.push(c); got += c.length; }
        buf = cat(parts); off = 0; return true;
      }
      function next() {
        if (g !== gen || dead || (T.mp4 && cur && cur.done)) { try { reader && reader.cancel(); } catch (e) {} return; }
        if (started && (aheadSec() > 25 || qV.length > 4 || qA.length + (bp ? bp.pending() : 0) > 8 || have > 4 * 1048576)) { trimBehind(10); waitT = setTimeout(next, 400); return; }   // keep ~25 s ahead and little in memory: the TV has not much to spare
        reader.read().then(function (res) {
          if (g !== gen) { try { reader.cancel(); } catch (e) {} return; }
          // this 16 MB part is in: ask for the next one; the file ends only when a part comes back short (the provider does not always say the file size)
          if (res.done && rangeEnd >= 0 && (T.size ? netPos < T.size : netPos > rangeEnd)) { reader = null; ctl = null; return openRange(netPos); }
          if (res.done) { done = true; parse(); if (T.mp4) { mp4Flush(vt); if (at) mp4Flush(at); } else flushCluster(); ended = true; maybeEnd(); return; }
          chunks.push(res.value); have += res.value.length; netPos += res.value.length; parse(); next();
        }).catch(netErr);
      }
      function netErr(e) {
        if (g !== gen || dead) return;
        if (!(v.readyState >= 1)) return fail('network: ' + (e && e.message));
        var at0 = clusterStart >= 0 ? clusterStart : abs; gen++; var g2 = gen; cl = null;
        if (T.mp4 && cur) { var cm = M[cur.mi]; at0 = cm && cur.k < cm.count ? Math.min(abs, cm.t.tb.offsets[cm.first + cur.k]) : abs; }
        if (cb.buffering) cb.buffering();
        setTimeout(function () { if (g2 === gen && !dead) stream(at0, g2, false); }, 2500);
      }
      function eat(n) {   // drop n bytes we do not need, from the buffer and then from waiting chunks
        var k = Math.min(n, buf.length - off); off += k; abs += k; n -= k;
        while (n > 0 && chunks.length) { var c0 = chunks[0]; if (c0.length <= n) { chunks.shift(); have -= c0.length; abs += c0.length; n -= c0.length; } else { chunks[0] = c0.subarray(n); have -= n; abs += n; n = 0; } }
        return n;
      }
      function parseMp4() {
        for (;;) {
          if (g !== gen || dead) return;
          if (skip > 0) { skip = eat(skip); if (skip > 0) return; }
          if (cur.mi >= M.length) { if (!cur.done) { cur.done = true; mp4Flush(vt); if (at) mp4Flush(at); ended = true; maybeEnd(); } return; }
          var ch = M[cur.mi];
          if (cur.k >= ch.count) { cur.mi++; cur.k = 0; continue; }
          var tr = ch.t, si = ch.first + cur.k;
          if (si < (cur.starts[tr.num] || 0)) { cur.k++; continue; }
          var o = tr.tb.offsets[si], n = tr.tb.sizes[si];
          if (o < abs) { cur.k++; continue; }
          if (o > abs) { skip = o - abs; continue; }
          if (!need(n)) return;
          var data = buf.subarray(off, off + n); off += n; abs += n; cur.k++;
          mp4Emit(tr, si, data);
        }
      }
      function parse() {
        if (T.mp4) return parseMp4();
        for (;;) {
          if (g !== gen || dead) return;
          if (skip > 0) { skip = eat(skip); if (skip > 0) return; }
          if (resync) {   // started at a guessed byte position: look for the next cluster
            if (!need(Math.min(avail(), 1 << 20))) return; var bb = buf, found = -1;
            for (var i = off; i + 4 <= bb.length; i++) if (bb[i] === 0x1F && bb[i + 1] === 0x43 && bb[i + 2] === 0xB6 && bb[i + 3] === 0x75) { found = i; break; }
            if (found < 0) { var drop = Math.max(0, bb.length - 3 - off); off += drop; abs += drop; if (done) return; return; }
            abs += found - off; off = found; resync = false;
          }
          if (clusterEnd >= 0 && abs >= clusterEnd) { flushCluster(); clusterEnd = -1; }
          if (avail() < 2) return;
          need(Math.min(12, avail()));
          var h = head(buf, off); if (!h) return;
          if (h.id === ID.Cluster) { if (cl) flushCluster(); clusterStart = abs; cl = { tc: 0, v: [], a: [] }; clusterEnd = h.size >= 0 ? abs + h.hl + h.size : -1; off += h.hl; abs += h.hl; continue; }
          if (h.id === ID.Segment) { off += h.hl; abs += h.hl; continue; }
          if (cl && TOP[h.id]) { flushCluster(); clusterEnd = -1; }
          if (!cl || TOP[h.id]) {   // a level 1 element we do not use (Cues, Tags...): skip it
            if (h.size < 0) return fail('unknown-size element');
            off += h.hl; abs += h.hl; skip = h.size; continue;
          }
          if (h.size < 0 || h.size > 64 * 1024 * 1024) return fail('bad block size');
          if (!need(h.hl + h.size)) return;
          var b = buf, d = off + h.hl, e = d + h.size;
          if (h.id === ID.Timecode) cl.tc = uint(b, d, h.size);
          else if (h.id === ID.SimpleBlock) block(b, d, e, true, 0, false);
          else if (h.id === ID.BlockGroup) { var bp = -1, be = -1, du = 0, ref = false; kids(b, d, e, function (id, p, l) { if (id === ID.Block) { bp = p; be = p + l; } else if (id === ID.BlockDuration) du = uint(b, p, l); else if (id === ID.ReferenceBlock) ref = true; }); if (bp >= 0) block(b, bp, be, false, du, ref); }
          off = e; abs += h.hl + h.size;
        }
      }
    }
    function loadCues() {
      if (T.cues || T.cuesPos < 0) return Promise.resolve();
      return bytes(T.cuesPos, 12).then(function (h0) {
        var h = head(h0, 0); if (!h || h.id !== ID.Cues || h.size < 0) throw new Error('no cues');
        return bytes(T.cuesPos + h.hl, Math.min(h.size, 8 * 1024 * 1024));
      }).then(function (b) {
        var list = [];
        kids(b, 0, b.length, function (id, p, l) { if (id !== ID.CuePoint) return; var t = -1, pos = -1, tr = 0; kids(b, p, p + l, function (i2, q, m) { if (i2 === ID.CueTime) t = uint(b, q, m); else if (i2 === ID.CueTrackPositions && pos < 0) kids(b, q, q + m, function (i3, r, k) { if (i3 === ID.CueClusterPosition) pos = uint(b, r, k); else if (i3 === ID.CueTrack) tr = uint(b, r, k); }); }); if (t >= 0 && pos >= 0 && (!vt || !tr || tr === vt.num)) list.push({ t: t * T.scale / 1e9, pos: T.segStart + pos }); });
        list.sort(function (a, b2) { return a.t - b2.t; }); T.cues = list;
      }).catch(function () { T.cues = []; });
    }
    function seekTo(t) {
      stopNet(); var g = gen; ended = false; lastDts = -1; cl = null; pend = [];
      qV.length = 0; qA.length = 0;
      function clear(sb, q) { if (!sb) return; try { if (sb.updating) sb.abort(); } catch (e) {} q.push({ rm: [0, Infinity] }); }
      clear(sbV, qV); clear(sbA, qA); pump(sbV, qV); pump(sbA, qA);
      accV.length = 0; accA.length = 0; rawA = []; if (bp) bp.reset();
      if (T.mp4) { try { cur = mp4Cursor(t); } catch (e) { return fail(e && e.message); } return stream(cur.pos, g, false); }
      loadCues().then(function () {
        if (g !== gen || dead) return;
        var cues = T.cues || [], pos = -1;
        for (var i = 0; i < cues.length; i++) { if (cues[i].t <= t + 0.05) pos = cues[i].pos; else break; }
        if (pos >= 0) return stream(pos, g, false);
        if (t < 1 || !T.size || !T.dur) return stream(T.firstCluster, g, false);
        stream(Math.max(T.firstCluster, Math.floor(T.firstCluster + (T.size - T.firstCluster) * Math.max(0, t - 5) / T.dur)), g, true);
      });
    }

    readHeader().then(function () {
      if (T.mp4) setupMp4(); else setupTracks();
      pickAudio();
      ms = new MediaSource();
      ms.addEventListener('sourceopen', function () {
        if (dead) return;
        try {
          if (T.dur > 0) ms.duration = T.dur;
          v.addEventListener('seeking', onSeeking);
          started = true;
          if (T.mp4) { if (!setupBuffers()) throw new Error('buffers'); cur = mp4Cursor(0); stream(cur.pos, gen, false); }
          else stream(T.firstCluster, gen, false);
        } catch (e) { fail('setup: ' + (e && e.message)); }
      });
      v.src = URL.createObjectURL(ms);
    }).catch(function (e) { fail(e && e.message); });

    // the buffers are created together, once the first audio frame is in (AC-3 / E-AC-3 need their config box from it; a buffer cannot be added after data went into another)
    var pend = [];
    function setupBuffers() {
      if (at && !at.cfgBox && (at.mp4type === 'ac-3' || at.mp4type === 'ec-3')) {
        var fr = null; pend.forEach(function (c) { if (!fr && c.a.length) fr = c.a[0].data; });
        if (!fr && pend.length < 6) return false;
        at.cfgBox = fr ? (at.mp4type === 'ac-3' ? ac3Box(fr) : eac3Box(fr)) : null;
        if (!at.cfgBox) at = null;
      }
      sbV = addSb(vt); qV.push({ data: initSeg(vt) });
      if (at) { sbA = addSb(at); qA.push({ data: initSeg(at) }); }
      return true;
    }
    var origFlush = flushCluster;
    flushCluster = function () {
      if (!cl) return;
      if (!sbV) { pend.push(cl); cl = null; try { if (!setupBuffers()) return; } catch (e) { return fail('buffers: ' + (e && e.message)); } var all = pend; pend = []; all.forEach(function (c) { cl = c; origFlush(); }); return; }
      origFlush();
    };
    function onSeeking() { if (dead) return; var t = v.currentTime; if (!inBuf(t)) seekTo(t); }

    function addImg(num, s0, img, e) {   // picture subtitles: each one lasts until the next (or its own end time)
      var l = subs[num]; if (!l) return;
      for (var i = 0; i < l.length; i++) if (Math.abs(l[i].s - s0) < 0.01) return;
      var ent = { s: s0, e: e, img: img }; l.push(ent); if (l.length > 1 && l[l.length - 2].s > s0) l.sort(function (x, y) { return x.s - y.s; });
      var k = l.indexOf(ent); if (k > 0 && l[k - 1].e === undefined) l[k - 1].e = s0;
    }
    function cueAt(num, t) {
      var l = subs[num]; if (!l || !l.length) return null;
      var lo = 0, hi = l.length - 1, k = -1; while (lo <= hi) { var mid = (lo + hi) >> 1; if (l[mid].s <= t) { k = mid; lo = mid + 1; } else hi = mid - 1; }
      if (k >= 0 && 'img' in l[k]) { var ie = l[k]; return ie.img && (ie.e === undefined || ie.e > t) && t - ie.s < 15 ? { img: ie.img, end: ie.e || t + 3 } : null; }
      var out = []; for (var i = Math.max(0, k - 3); i <= k; i++) if (i >= 0 && l[i].s <= t && l[i].e > t) out.push(l[i]);
      return out.length ? { text: out.map(function (c) { return c.t; }).join('\n'), end: out[out.length - 1].e } : null;
    }
    return {
      tracks: function () { return { audio: audios.map(function (t) { return { lang: (t.ietf || t.lang || '').toLowerCase(), name: t.name, ok: t.ok }; }), text: texts.map(function (t) { return { lang: (t.ietf || t.lang || '').toLowerCase(), name: t.name, ok: !!t.textKind, kind: t.textKind }; }), audioIdx: audioIndex(), mp4: !!T.mp4 }; },
      textAt: function (i, t) { var tr = texts[i]; return tr ? cueAt(tr.num, t) : null; },
      audioIdx: function () { return audioIndex(); },
      canBoost: function () { return canBoost; }, boosting: function () { return !!bp; },
      boostInfo: function () { return bp ? { gain: bp.gain(), pending: bp.pending(), stats: bp.stats() } : null; },
      setGain: function (g) { if (!bp || dead) return; clearTimeout(gainT); gainT = setTimeout(function () { regain(g); }, 500); },
      canAudio: function (i) { return !!(audios[i] && audios[i].ok); },
      active: function () { return !dead; },
      destroy: function () { dead = true; stopNet(); clearTimeout(gainT); if (bp) bp.reset(); try { v.removeEventListener('seeking', onSeeking); } catch (e) {} try { if (ms && ms.readyState === 'open') ms.endOfStream(); } catch (e) {} }
    };
  }
  return { start: start, supported: function () { return !!(window.MediaSource && window.fetch && window.ReadableStream); } };
})();
