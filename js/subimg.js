// Picture subtitles (Blu-ray PGS and DVD VobSub) for mse.js: decodes the provider's subtitle bitmaps and draws them on a
// canvas over the picture. Also a small zlib inflate, because MKV files often store these tracks compressed.
window.SUBIMG = (function () {
  // ---- zlib / deflate (RFC 1950/1951), small and slow is fine: subtitle packets are a few KB ----
  var LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  var LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  var DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  var DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  var ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  function huff(lens, n) {
    var count = new Array(16).fill(0), sym = [], offs = [0, 0], i;
    for (i = 0; i < n; i++) count[lens[i]]++;
    count[0] = 0; for (i = 1; i < 16; i++) offs[i + 1] = offs[i] + count[i];
    for (i = 0; i < n; i++) if (lens[i]) sym[offs[lens[i]]++] = i;
    return { count: count, sym: sym };
  }
  function inflate(src) {
    var p = 0, bit = 0, bits = 0, out = new Uint8Array(Math.max(1024, src.length * 4)), o = 0;
    if ((src[0] & 15) === 8 && ((src[0] << 8) | src[1]) % 31 === 0) p = 2;   // zlib header
    function need(n) { while (bits < n) { if (p >= src.length) throw new Error('inflate: end'); bit |= src[p++] << bits; bits += 8; } }
    function get(n) { need(n); var v = bit & ((1 << n) - 1); bit >>>= n; bits -= n; return v; }
    function put(x) { if (o >= out.length) { var nb = new Uint8Array(out.length * 2); nb.set(out); out = nb; } out[o++] = x; }
    function dec(h) { var code = 0, first = 0, index = 0; for (var len = 1; len < 16; len++) { code |= get(1); var c = h.count[len]; if (code - c < first) return h.sym[index + (code - first)]; index += c; first += c; first <<= 1; code <<= 1; } throw new Error('inflate: bad code'); }
    var fixL = null, fixD = null, last = 0;
    do {
      last = get(1); var type = get(2);
      if (type === 0) {
        bit = 0; bits = 0; var len = src[p] | (src[p + 1] << 8); p += 4;
        for (var k = 0; k < len; k++) put(src[p++]);
        continue;
      }
      var lh, dh;
      if (type === 1) {
        if (!fixL) { var l = []; for (var a = 0; a < 288; a++) l[a] = a < 144 ? 8 : a < 256 ? 9 : a < 280 ? 7 : 8; fixL = huff(l, 288); var d = []; for (a = 0; a < 30; a++) d[a] = 5; fixD = huff(d, 30); }
        lh = fixL; dh = fixD;
      } else if (type === 2) {
        var nl = get(5) + 257, nd = get(5) + 1, nc = get(4) + 4, cl = new Array(19).fill(0), i;
        for (i = 0; i < nc; i++) cl[ORDER[i]] = get(3);
        var ch = huff(cl, 19), lens = [];
        while (lens.length < nl + nd) {
          var s = dec(ch);
          if (s < 16) lens.push(s);
          else if (s === 16) { var prev = lens[lens.length - 1], r = 3 + get(2); while (r--) lens.push(prev); }
          else if (s === 17) { r = 3 + get(3); while (r--) lens.push(0); }
          else { r = 11 + get(7); while (r--) lens.push(0); }
        }
        lh = huff(lens.slice(0, nl), nl); dh = huff(lens.slice(nl), nd);
      } else throw new Error('inflate: bad block');
      for (;;) {
        var sy = dec(lh);
        if (sy < 256) put(sy);
        else if (sy === 256) break;
        else { sy -= 257; var ln = LBASE[sy] + get(LEXT[sy]), ds = dec(dh), dist = DBASE[ds] + get(DEXT[ds]); for (var j = 0; j < ln; j++) put(out[o - dist]); }
      }
    } while (!last);
    return out.subarray(0, o);
  }

  // ---- colours ----
  function ycc(y, cr, cb, a, hd) {
    var r, g, b;
    if (hd) { r = y + 1.5748 * (cr - 128); g = y - 0.1873 * (cb - 128) - 0.4681 * (cr - 128); b = y + 1.8556 * (cb - 128); }
    else { r = y + 1.402 * (cr - 128); g = y - 0.344136 * (cb - 128) - 0.714136 * (cr - 128); b = y + 1.772 * (cb - 128); }
    function c(x) { return x < 0 ? 0 : x > 255 ? 255 : Math.round(x); }
    return [c(r), c(g), c(b), a];
  }

  // ---- Blu-ray PGS: a display set (palette, objects, composition, END) per subtitle change ----
  function PGS() {
    var pal = {}, objs = {}, pcs = null;
    function u16(b, p) { return (b[p] << 8) | b[p + 1]; }
    return function feed(d) {   // returns an event { img } / { clear } when a display set completes, else null
      var p = 0, ev = null;
      while (p + 3 <= d.length) {
        var type = d[p], size = u16(d, p + 1), s = d.subarray(p + 3, p + 3 + size); p += 3 + size;
        if (type === 0x14) { for (var i = 2; i + 5 <= s.length; i += 5) pal[s[i]] = [s[i + 1], s[i + 2], s[i + 3], s[i + 4]]; }
        else if (type === 0x15) {
          var id = u16(s, 0), fl = s[3];
          if (fl & 0x80) objs[id] = { w: u16(s, 7), h: u16(s, 9), parts: [s.slice(11)] };
          else if (objs[id]) objs[id].parts.push(s.slice(4));
        } else if (type === 0x16) {
          pcs = { vw: u16(s, 0), vh: u16(s, 2), list: [] };
          var n = s[10], q = 11;
          for (var k = 0; k < n && q + 8 <= s.length; k++) { var f = s[q + 3]; pcs.list.push({ id: u16(s, q), x: u16(s, q + 4), y: u16(s, q + 6) }); q += (f & 0x80) ? 16 : 8; }
        } else if (type === 0x80 && pcs) {
          if (!pcs.list.length) ev = { clear: true };
          else {
            var hd = pcs.vh >= 600, cols = {}; for (var key in pal) cols[key] = ycc(pal[key][0], pal[key][1], pal[key][2], pal[key][3], hd);
            var items = []; pcs.list.forEach(function (c) { var o = objs[c.id]; if (o) items.push({ x: c.x, y: c.y, w: o.w, h: o.h, rle: o.parts.length === 1 ? o.parts[0] : (function () { var n2 = 0; o.parts.forEach(function (x) { n2 += x.length; }); var a = new Uint8Array(n2), at = 0; o.parts.forEach(function (x) { a.set(x, at); at += x.length; }); return a; })() }); });
            ev = items.length ? { img: { vw: pcs.vw, vh: pcs.vh, draw: function (ctx) { items.forEach(function (it) { drawPgs(ctx, it, cols); }); } } } : { clear: true };
          }
        }
      }
      return ev;
    };
  }
  function drawPgs(ctx, it, cols) {
    if (!it.w || !it.h) return;
    var img = ctx.createImageData(it.w, it.h), px = img.data, d = it.rle, i = 0, x = 0, y = 0, n = d.length;
    function put(c, len) { var col = cols[c]; if (!col || !col[3]) { x += len; return; } var at = (y * it.w + x) * 4; for (var k = 0; k < len && x < it.w; k++, x++, at += 4) { px[at] = col[0]; px[at + 1] = col[1]; px[at + 2] = col[2]; px[at + 3] = col[3]; } }
    while (y < it.h && i < n) {
      var b = d[i++];
      if (b) { put(b, 1); continue; }
      b = d[i++];
      if (b === 0) { x = 0; y++; continue; }
      var len = (b & 0x40) ? (((b & 0x3F) << 8) | d[i++]) : (b & 0x3F);
      put((b & 0x80) ? d[i++] : 0, len);
    }
    ctx.putImageData(img, it.x, it.y);
  }

  // ---- DVD VobSub: palette + size come from the track header (the .idx text), each packet is one subtitle ----
  function VobSub(priv) {
    var txt = ''; try { for (var i = 0; i < priv.length; i++) txt += String.fromCharCode(priv[i]); } catch (e) {}
    var size = /size:\s*(\d+)x(\d+)/.exec(txt), vw = size ? Number(size[1]) : 720, vh = size ? Number(size[2]) : 576;
    var pm = /palette:\s*([0-9a-fA-F, ]+)/.exec(txt), pal = [];
    if (pm) pm[1].split(',').forEach(function (h) { h = h.trim(); if (h) pal.push([parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]); });
    while (pal.length < 16) pal.push([255, 255, 255]);
    return function feed(d) {   // returns { img, start, stop } (seconds after the packet time)
      if (d.length < 4) return null;
      var ctl = (d[2] << 8) | d[3], pos = ctl, start = 0, stop = -1, idx = [0, 1, 2, 3], alpha = [0, 15, 15, 15], x1 = 0, x2 = 0, y1 = 0, y2 = 0, f1 = 0, f2 = 0, guard = 0;
      while (pos + 4 <= d.length && guard++ < 32) {
        var delay = ((d[pos] << 8) | d[pos + 1]) * 1024 / 90000, next = (d[pos + 2] << 8) | d[pos + 3], p = pos + 4;
        while (p < d.length) {
          var cmd = d[p++];
          if (cmd === 0xFF) break;
          if (cmd === 0x00 || cmd === 0x01) start = delay;
          else if (cmd === 0x02) stop = delay;
          else if (cmd === 0x03) { idx = [d[p + 1] & 15, d[p + 1] >> 4, d[p] & 15, d[p] >> 4]; p += 2; }
          else if (cmd === 0x04) { alpha = [d[p + 1] & 15, d[p + 1] >> 4, d[p] & 15, d[p] >> 4]; p += 2; }
          else if (cmd === 0x05) { x1 = (d[p] << 4) | (d[p + 1] >> 4); x2 = ((d[p + 1] & 15) << 8) | d[p + 2]; y1 = (d[p + 3] << 4) | (d[p + 4] >> 4); y2 = ((d[p + 4] & 15) << 8) | d[p + 5]; p += 6; }
          else if (cmd === 0x06) { f1 = (d[p] << 8) | d[p + 1]; f2 = (d[p + 2] << 8) | d[p + 3]; p += 4; }
          else break;
        }
        if (next === pos) break; pos = next;
      }
      var w = x2 - x1 + 1, h = y2 - y1 + 1; if (w <= 0 || h <= 0 || !f1) return null;
      var cols = idx.map(function (c, k) { var rgb = pal[c] || [255, 255, 255]; return [rgb[0], rgb[1], rgb[2], alpha[k] * 17]; });
      return { start: start, stop: stop, img: { vw: vw, vh: vh, draw: function (ctx) {
        var img = ctx.createImageData(w, h), px = img.data, ptr = [f1 * 2, f2 * 2];
        function nib(fi) { var b = d[ptr[fi] >> 1]; var v = (ptr[fi] & 1) ? (b & 15) : (b >> 4); ptr[fi]++; return v; }
        for (var y = 0; y < h; y++) {
          var fi = y & 1, x = 0;
          while (x < w && (ptr[fi] >> 1) < ctl) {
            var v = nib(fi); if (v < 4) { v = (v << 4) | nib(fi); if (v < 0x10) { v = (v << 4) | nib(fi); if (v < 0x40) v = (v << 4) | nib(fi); } }
            var run = v >> 2, col = cols[v & 3]; if (!run) run = w - x;
            for (var k = 0; k < run && x < w; k++, x++) { if (col[3]) { var at = (y * w + x) * 4; px[at] = col[0]; px[at + 1] = col[1]; px[at + 2] = col[2]; px[at + 3] = col[3]; } }
          }
          if (ptr[fi] & 1) ptr[fi]++;
        }
        ctx.putImageData(img, x1, y1);
      } } };
    };
  }
  return { inflate: inflate, PGS: PGS, VobSub: VobSub };
})();
