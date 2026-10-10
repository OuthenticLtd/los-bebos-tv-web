// Reads track languages/names from a Matroska (.mkv) file header via HTTP Range, because the TV's player
// reports no languages for text tracks. Returns { audio: [{lang,name,default,forced}], text: [...] } in file order.
var MKV = (function () {
  var ID = { EBML: 0x1A45DFA3, Segment: 0x18538067, SeekHead: 0x114D9B74, Info: 0x1549A966, Tracks: 0x1654AE6B, Cluster: 0x1F43B675, Cues: 0x1C53BB6B, Void: 0xEC, Tags: 0x1254C367, Attachments: 0x1941A469, Chapters: 0x1043A770,
    TrackEntry: 0xAE, TrackNumber: 0xD7, TrackType: 0x83, Language: 0x22B59C, LanguageIETF: 0x22B59D, Name: 0x536E, CodecID: 0x86, FlagDefault: 0x88, FlagForced: 0x55AA,
    BlockAdditionMapping: 0x41E4, BlockAddIDType: 0x41E7, BlockAddIDExtraData: 0x41ED };
  function readVint(buf, pos, keepMarker) {
    var first = buf[pos]; if (first === undefined) return null;
    var len = 1, mask = 0x80; while (len <= 8 && !(first & mask)) { mask >>= 1; len++; }
    if (len > 8) return null;
    var val = keepMarker ? first : (first & (mask - 1));
    for (var i = 1; i < len; i++) { if (buf[pos + i] === undefined) return null; val = val * 256 + buf[pos + i]; }
    var unknown = !keepMarker && val === Math.pow(2, 7 * len) - 1;
    return { value: val, length: len, unknown: unknown };
  }
  function utf8(buf, pos, len) { var s = ''; for (var i = 0; i < len; i++) s += String.fromCharCode(buf[pos + i]); try { return decodeURIComponent(escape(s)); } catch (e) { return s; } }
  function uint(buf, pos, len) { var v = 0; for (var i = 0; i < len; i++) v = v * 256 + buf[pos + i]; return v; }
  function parseTracks(buf, pos, end) {
    var out = { audio: [], text: [], video: 0, dv: null };
    while (pos < end) {
      var id = readVint(buf, pos, true); if (!id) break; var sz = readVint(buf, pos + id.length); if (!sz) break;
      var dataPos = pos + id.length + sz.length, dataEnd = dataPos + sz.value;
      if (id.value === ID.TrackEntry) {
        var t = { number: 0, type: 0, lang: 'eng', langIETF: '', name: '', codec: '', def: 1, forced: 0 }, p = dataPos;   // Matroska: a track without a Language element IS English ('eng' is the spec default)
        while (p < dataEnd) {
          var cid = readVint(buf, p, true); if (!cid) break; var csz = readVint(buf, p + cid.length); if (!csz) break;
          var cp = p + cid.length + csz.length;
          if (cid.value === ID.TrackNumber) t.number = uint(buf, cp, csz.value);
          else if (cid.value === ID.TrackType) t.type = uint(buf, cp, csz.value);
          else if (cid.value === ID.Language) t.lang = utf8(buf, cp, csz.value).replace(/\0.*$/, '');
          else if (cid.value === ID.LanguageIETF) t.langIETF = utf8(buf, cp, csz.value);
          else if (cid.value === ID.Name) t.name = utf8(buf, cp, csz.value);
          else if (cid.value === ID.CodecID) t.codec = utf8(buf, cp, csz.value);
          else if (cid.value === ID.FlagDefault) t.def = uint(buf, cp, csz.value);
          else if (cid.value === ID.FlagForced) t.forced = uint(buf, cp, csz.value);
          else if (cid.value === ID.BlockAdditionMapping) {   // Dolby Vision: BlockAddIDType 'dvcC'/'dvvC' + DOVIDecoderConfigurationRecord
            var bp = cp, bend = cp + csz.value, typ = 0, extra = -1;
            while (bp < bend) { var bid = readVint(buf, bp, true); if (!bid) break; var bsz = readVint(buf, bp + bid.length); if (!bsz) break; var bdp = bp + bid.length + bsz.length;
              if (bid.value === ID.BlockAddIDType) typ = uint(buf, bdp, bsz.value); else if (bid.value === ID.BlockAddIDExtraData) extra = bdp; bp = bdp + bsz.value; }
            if ((typ === 0x64766343 || typ === 0x64767643) && extra >= 0 && buf[extra + 4] !== undefined) t.dv = { profile: buf[extra + 2] >> 1, compat: buf[extra + 4] >> 4 };
          }
          p = cp + csz.value;
        }
        var lang = (t.langIETF || t.lang || 'und').toLowerCase();
        var entry = { lang: lang, name: t.name, codec: t.codec, def: !!t.def, forced: !!t.forced, number: t.number };
        if (t.type === 2) out.audio.push(entry); else if (t.type === 17) out.text.push(entry); else if (t.type === 1) { out.video++; if (t.dv && !out.dv) out.dv = t.dv; }
      }
      pos = dataEnd;
    }
    return out;
  }
  // Walk the top level: EBML header, then Segment children until Tracks (or a Cluster = give up).
  function parse(buf) {
    var pos = 0, len = buf.length;
    var id = readVint(buf, pos, true); if (!id || id.value !== ID.EBML) return { error: 'not matroska' };
    var sz = readVint(buf, pos + id.length); pos = pos + id.length + sz.length + sz.value;
    id = readVint(buf, pos, true); if (!id || id.value !== ID.Segment) return { error: 'no segment' };
    sz = readVint(buf, pos + id.length); pos = pos + id.length + sz.length;
    while (pos < len) {
      id = readVint(buf, pos, true); if (!id) return { more: true }; sz = readVint(buf, pos + id.length); if (!sz) return { more: true };
      var dataPos = pos + id.length + sz.length;
      if (id.value === ID.Tracks) { if (dataPos + sz.value > len) return { more: true, need: dataPos + sz.value }; return parseTracks(buf, dataPos, dataPos + sz.value); }
      if (id.value === ID.Cluster) return { error: 'no tracks before first cluster' };
      pos = dataPos + sz.value;
    }
    return { more: true };
  }
  function fetchRange(url, from, to) {
    return fetch(url, { headers: { Range: 'bytes=' + from + '-' + to }, cache: 'no-store' }).then(function (r) {
      if (!(r.status === 206 || r.status === 200)) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(function (ab) { return new Uint8Array(ab); });
  }
  function readTracks(url) {
    var sizes = [512 * 1024, 2 * 1024 * 1024, 6 * 1024 * 1024];
    function attempt(i) {
      return fetchRange(url, 0, sizes[i] - 1).then(function (buf) {
        var r = parse(buf);
        if (r.more && i + 1 < sizes.length) return attempt(i + 1);
        if (r.more) throw new Error('header too large');
        if (r.error) throw new Error(r.error);
        return r;
      });
    }
    return attempt(0);
  }
  return { readTracks: readTracks };
})();
