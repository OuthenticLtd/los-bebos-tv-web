// AVPlay wrapper with real aspect-ratio control.
var PLAYER = (function () {
  function DW() { return window.DESIGN_W || 1920; } function DH() { return window.DESIGN_H || 1080; }   // design canvas (phone upright: 1080x1920)
  var MODES = ['original', 'fill', 'zoom235', 'zoom'];
  var MODE_LABEL = { original: 'Original', fill: 'Fill (stretch)', zoom235: 'Cinema 2.35 zoom', zoom: 'Manual zoom' };
  var st = { active: false, preview: null, fromPreview: false, item: null, playlist: null, index: -1, mode: 'original', scale: 1.15, offsetY: 0, duration: 0, time: 0, posTimer: 0, uiTimer: 0, zoomOk: true };
  var el = {};
  function $(id) { return document.getElementById(id); }
  function av() { return window.webapis && webapis.avplay; }
  function fmt(ms) { var s = Math.max(0, Math.floor(ms / 1000)); var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x; }

  function init() { var nu = $('next-up'); if (nu) nu.addEventListener('click', function (ev) { ev.stopPropagation(); if (nextUpOn) playIndex(st.index + 1); }); el.sub = $('subtitles'); el.ui = $('player-ui'); el.title = $('player-title'); el.aspect = $('player-aspect'); el.epg = $('player-epg'); el.fill = $('progress-fill'); el.cur = $('time-cur'); el.dur = $('time-dur'); el.msg = $('player-msg'); }
  function msg(t) { if (!t) { el.msg.classList.add('hidden'); return; } el.msg.textContent = t; el.msg.classList.remove('hidden'); }
  function showUi(ms) { el.ui.classList.remove('hidden'); renderCtl(); clearTimeout(st.uiTimer); if (ms) st.uiTimer = setTimeout(function () { if (st.active) { el.ui.classList.add('hidden'); renderCenter(); } }, ms); }
  function aspectKey() { return st.item ? st.item.kind + ':' + (st.item.aspectKey || st.item.id) : null; }
  function posKey() { return st.item ? st.item.kind + ':' + st.item.id : null; }

  // Design px (1920x1080) -> values for setDisplayRect. Size scales with the canvas; the position additionally
  // gets divided by the position factor: this TV showed the video at exactly double the x/y it was given.
  function toScreen(x, y, w, h) {
    if (window.PREVIEW || window.IS_ANDROID) return { x: x, y: y, w: w, h: h };   // web and phone place the video inside the scaled page themselves
    var sc = window.APP_SCALE || 1, sw = window.innerWidth || 1920, sh = window.innerHeight || 1080;
    var ox = Math.round((sw - 1920 * sc) / 2), oy = Math.round((sh - 1080 * sc) / 2);
    var pf = CONFIG.posFactor === 'auto' || !CONFIG.posFactor ? (window.devicePixelRatio || 1) : Number(CONFIG.posFactor);
    return { x: Math.round((ox + x * sc) / pf), y: Math.round((oy + y * sc) / pf), w: Math.round(w * sc), h: Math.round(h * sc) };
  }
  function applyAspect(silent) {
    var a = av(); if (!a) return;
    var scale = 1, oy = 0, method = 'PLAYER_DISPLAY_MODE_LETTER_BOX';
    if (st.mode === 'fill') method = 'PLAYER_DISPLAY_MODE_FULL_SCREEN';
    else if (st.mode === 'zoom235') { scale = 2.35 / (16 / 9); oy = st.offsetY; }
    else if (st.mode === 'zoom') { scale = st.scale; oy = st.offsetY; }
    if (st.preview) { // preview box: plain letterbox inside the box, zoom applies only in full screen
      var pr = toScreen(st.preview.x, st.preview.y, st.preview.w, st.preview.h);
      if (window.DIAG) window.DIAG('rect', { mode: 'preview', design: st.preview, sent: pr });
      try { a.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); a.setDisplayRect(pr.x, pr.y, pr.w, pr.h); } catch (e) {}
      return;
    }
    var W = DW(), H = DH(); var w = Math.round(W * scale), h = Math.round(H * scale), x = Math.round((W - w) / 2), y = Math.round((H - h) / 2 + oy);
    var r = toScreen(x, y, w, h);
    if (window.DIAG) window.DIAG('rect', { mode: st.mode, design: [x, y, w, h], sent: r });
    try {
      a.setDisplayMethod(method);
      a.setDisplayRect(r.x, r.y, r.w, r.h);
      st.zoomOk = true;
    } catch (e) {
      st.zoomOk = false;
      var f = toScreen(0, 0, DW(), DH());
      try { a.setDisplayRect(f.x, f.y, f.w, f.h); a.setDisplayMethod(method); } catch (e2) {}
      if (!silent) UI.toast('Zoom not accepted by the TV player');
    }
    var label = MODE_LABEL[st.mode];
    if (st.mode === 'zoom') label += ' ' + Math.round(st.scale * 100) + '%';
    if ((st.mode === 'zoom' || st.mode === 'zoom235') && st.offsetY) label += ' (' + (st.offsetY > 0 ? '+' : '') + st.offsetY + 'px)';
    el.aspect.textContent = label;
    var k = aspectKey(); if (k) STORE.setAspectFor(k, { mode: st.mode, scale: st.scale, offsetY: st.offsetY });
  }
  function cycleMode() { st.mode = MODES[(MODES.indexOf(st.mode) + 1) % MODES.length]; if (st.mode === 'zoom235' || st.mode === 'zoom') { /* keep offsets */ } else st.offsetY = 0; applyAspect(); showUi(4000); }
  function setMode(m) { if (MODES.indexOf(m) >= 0) st.mode = m; applyAspect(true); }
  function zoom(delta) { if (st.mode !== 'zoom') { st.mode = 'zoom'; } st.scale = Math.min(3, Math.max(0.5, Math.round((st.scale + delta) * 100) / 100)); applyAspect(); showUi(4000); }
  function shift(dy) { if (st.mode !== 'zoom' && st.mode !== 'zoom235') return false; st.offsetY = Math.max(-600, Math.min(600, st.offsetY + dy)); applyAspect(); showUi(4000); return true; }

  // ---------- audio / subtitle tracks ----------
  var tracks = { audio: [], text: [], audioIdx: -1, textIdx: -1, tries: 0 };
  function trackInfo(t, i, type) {
    var x = {}; try { x = typeof t.extra_info === 'string' ? JSON.parse(t.extra_info) : (t.extra_info || {}); } catch (e) { x = { raw: String(t.extra_info) }; }
    var lang = String(x.language || x.track_lang || x.lang || x.Language || '').toLowerCase().replace(/[^a-z-]/g, '');
    var name = String(x.track_name || x.name || x.title || '');
    var forced = false;
    // the TV reports no languages for subtitles: take them from the file header (same order, TV lists the first 30)
    var ft = st.fileTracks && type ? st.fileTracks[type === 'AUDIO' ? 'audio' : 'text'] : null;
    if (ft && typeof i === 'number' && ft[i] && (type === 'AUDIO' ? tracks.audio.length === ft.length || tracks.audio.length <= ft.length : tracks.text.length <= ft.length)) { if (!lang || lang === 'und') lang = ft[i].lang; if (!name) name = ft[i].name; forced = ft[i].forced; }
    if (/forced/i.test(name)) forced = true;
    return { lang: lang === 'und' ? '' : lang, name: name, codec: String(x.fourCC || x.codec || ''), forced: forced, raw: x };
  }
  var LANG_NAMES = { en: 'English', eng: 'English', bg: 'Bulgarian', bul: 'Bulgarian', es: 'Spanish', spa: 'Spanish', de: 'German', ger: 'German', deu: 'German', fr: 'French', fre: 'French', fra: 'French', it: 'Italian', ita: 'Italian', pt: 'Portuguese', por: 'Portuguese', ru: 'Russian', rus: 'Russian', tr: 'Turkish', tur: 'Turkish', ar: 'Arabic', ara: 'Arabic', nl: 'Dutch', dut: 'Dutch', nld: 'Dutch', pl: 'Polish', pol: 'Polish', ro: 'Romanian', rum: 'Romanian', ron: 'Romanian', el: 'Greek', gre: 'Greek', ell: 'Greek', sv: 'Swedish', swe: 'Swedish', da: 'Danish', dan: 'Danish', no: 'Norwegian', nor: 'Norwegian', fi: 'Finnish', fin: 'Finnish', cs: 'Czech', cze: 'Czech', ces: 'Czech', hu: 'Hungarian', hun: 'Hungarian', sr: 'Serbian', srp: 'Serbian', hr: 'Croatian', hrv: 'Croatian', ja: 'Japanese', jpn: 'Japanese', ko: 'Korean', kor: 'Korean', zh: 'Chinese', chi: 'Chinese', zho: 'Chinese', hi: 'Hindi', hin: 'Hindi', und: 'Unknown', '': 'Unknown' };
  function langLabel(l) { var k = l.split('-')[0]; return LANG_NAMES[k] || LANG_NAMES[l] || l.toUpperCase(); }
  function isEnglish(l, name) { return /^(en|eng|english)\b|^en-/.test(l || '') || /\benglish\b/i.test(name || ''); }
  function trackLabel(t, i, type) { var inf = trackInfo(t, i, type); var lab = inf.name ? inf.name : langLabel(inf.lang); if (inf.name && inf.lang && inf.name.toLowerCase().indexOf(langLabel(inf.lang).toLowerCase()) < 0) lab = langLabel(inf.lang) + ' - ' + inf.name; return (i + 1) + '. ' + lab; }
  function readTracks() {
    var a = av(); var all = []; try { all = a.getTotalTrackInfo() || []; } catch (e) { return false; }
    tracks.audio = []; tracks.text = [];
    all.forEach(function (t) { if (t.type === 'AUDIO') tracks.audio.push(t); else if (t.type === 'TEXT') tracks.text.push(t); });
    if (window.DIAG) window.DIAG('tracks', { try: tracks.tries, all: all.map(function (t) { return { i: t.index, type: t.type, x: t.extra_info }; }) });
    return all.length > 0;
  }
  function selectTracks() {
    var a = av(); if (!st.active || st.preview) return;
    tracks.tries++;
    var ok = readTracks();
    if ((!ok || (!tracks.audio.length && !tracks.text.length)) && tracks.tries < 4) { setTimeout(selectTracks, 1500); return; }
    var pref = STORE.trackPref(prefKey()) || {};
    var ea = -1, et = -1;
    function pick(list, type, want) { var idx = -1; list.forEach(function (t, i) { if (idx < 0 && want(trackInfo(t, i, type), i)) idx = i; }); return idx; }
    // audio: remembered language -> English -> first
    if (pref.audioLang) ea = pick(tracks.audio, 'AUDIO', function (inf) { return inf.lang === pref.audioLang; });
    if (ea < 0) ea = pick(tracks.audio, 'AUDIO', function (inf) { return isEnglish(inf.lang, inf.name); });
    // subtitles: remembered (off or language+name) -> English not forced/SDH -> English any (not forced) -> none
    if (pref.textOff) et = -1;
    else {
      if (pref.textName) et = pick(tracks.text, 'TEXT', function (inf) { return inf.name === pref.textName; });
      if (et < 0 && pref.textLang) et = pick(tracks.text, 'TEXT', function (inf) { return inf.lang === pref.textLang && !inf.forced; });
      if (et < 0) et = pick(tracks.text, 'TEXT', function (inf) { return isEnglish(inf.lang, inf.name) && !inf.forced && !/sdh|hearing/i.test(inf.name); });
      if (et < 0) et = pick(tracks.text, 'TEXT', function (inf) { return isEnglish(inf.lang, inf.name) && !inf.forced; });
      if (et < 0) et = pick(tracks.text, 'TEXT', function (inf) { return isEnglish(inf.lang, inf.name); });
      if (et < 0 && tracks.text.length && !st.fileTracks) et = pick(tracks.text, 'TEXT', function (inf) { return !inf.lang && !inf.forced; });   // nothing labelled at all: unlabelled = English by convention
    }
    if (window.DIAG) window.DIAG('trackPick', { ea: ea, et: et, pref: pref, file: st.fileTracks ? { a: st.fileTracks.audio.length, t: st.fileTracks.text.length } : null, tvA: tracks.audio.length, tvT: tracks.text.length });
    if (ea >= 0) { try { a.setSelectTrack('AUDIO', tracks.audio[ea].index); tracks.audioIdx = ea; } catch (e) { if (window.DIAG) window.DIAG('setAudioErr', String(e && e.message)); } } else tracks.audioIdx = tracks.audio.length ? 0 : -1;
    if (et >= 0) { try { a.setSelectTrack('TEXT', tracks.text[et].index); tracks.textIdx = et; } catch (e) { if (window.DIAG) window.DIAG('setTextErr', String(e && e.message)); } try { a.setSilentSubtitle(false); } catch (e) {} }
    else { tracks.textIdx = -1; try { a.setSilentSubtitle(true); } catch (e) {} }
    var info = [];
    info.push('Audio: ' + (ea >= 0 ? trackLabel(tracks.audio[ea], ea, 'AUDIO').replace(/^\d+\. /, '') : (tracks.audio.length ? trackLabel(tracks.audio[0], 0, 'AUDIO').replace(/^\d+\. /, '') : 'default')));
    info.push('Subtitles: ' + (et >= 0 ? trackLabel(tracks.text[et], et, 'TEXT').replace(/^\d+\. /, '') : (tracks.text.length ? 'off (' + tracks.text.length + ' available)' : 'none in file')));
    if (st.fileTracks && st.fileTracks.text.length > tracks.text.length) info.push('TV offers ' + tracks.text.length + ' of ' + st.fileTracks.text.length + ' subtitle tracks');
    if (!st.tracksToasted) { st.tracksToasted = true; UI.toast(info.join('   |   '), 3000); }   // once per video, never repeated
  }
  function prefKey() { return st.item ? (st.item.seriesId ? 'series-' + st.item.seriesId : st.item.kind + ':' + st.item.id) : null; }
  function setAudio(i) { var a = av(); if (i < 0 || i >= tracks.audio.length) return; try { a.setSelectTrack('AUDIO', tracks.audio[i].index); tracks.audioIdx = i; var pr = STORE.trackPref(prefKey()) || {}; pr.audioLang = trackInfo(tracks.audio[i], i, 'AUDIO').lang; STORE.setTrackPref(prefKey(), pr); } catch (e) { UI.toast('Cannot switch audio: ' + (e && e.message)); } }
  function setText(i) { subCount = 0; var a = av(); var pr = STORE.trackPref(prefKey()) || {}; if (i < 0) { tracks.textIdx = -1; try { a.setSilentSubtitle(true); } catch (e) {} el.sub.textContent = ''; pr.textOff = true; STORE.setTrackPref(prefKey(), pr); return; } if (i >= tracks.text.length) return; try { a.setSelectTrack('TEXT', tracks.text[i].index); a.setSilentSubtitle(false); tracks.textIdx = i; var inf = trackInfo(tracks.text[i], i, 'TEXT'); pr.textOff = false; pr.textLang = inf.lang; pr.textName = inf.name; STORE.setTrackPref(prefKey(), pr); } catch (e) { UI.toast('Cannot switch subtitles: ' + (e && e.message)); } }

  // track menu overlay: Left/Right column, Up/Down item, OK select, Back/Blue close
  var menu = { open: false, col: 0, row: 0, only: -1 };
  // on-screen controls: row 0 = seek bar, row 1 = buttons (the Samsung remote has no colour keys)
  var ctl = { row: 0, idx: 0 };
  function buttons() {
    var b = [];
    var paused = false; try { paused = av().getState() === 'PAUSED'; } catch (e) {}
    if (!touchUi()) b.push({ id: 'pause', label: paused ? '\u25b6 Play' : '\u2016 Pause', run: togglePause });
    if (st.duration > 0 && !touchUi()) { b.push({ id: 'back60', label: '\u25c0 60 s', run: function () { seekAcc.last = 0; seek(-60000); } }); b.push({ id: 'fwd60', label: '60 s \u25b6', run: function () { seekAcc.last = 0; seek(60000); } }); }
    else if (st.playlist && st.item && st.item.kind === 'live') { b.push({ id: 'prev', label: '\u25c0 Channel', run: function () { playIndex(st.index - 1); } }); b.push({ id: 'next', label: 'Channel \u25b6', run: function () { playIndex(st.index + 1); } }); }
    if (touchUi() && st.item && st.item.kind === 'live' && window.STORE && window.UI && UI.favToggle) { var isF = STORE.isFav('live', st.item.id); b.push({ id: 'fav', label: isF ? '\u2605 My channels' : '\u2606 My channels', run: function () { UI.favToggle(st.item); renderCtl(); } }); }   // phone / web: a channel plays full screen at once, so the favourite toggle lives here
    if (st.item && st.item.kind === 'series' && st.playlist && st.index >= 0) {   // episodes: previous / next (also CH- / CH+ on the remote)
      if (st.index > 0) b.push({ id: 'prevep', label: '|\u25c0 Previous', run: function () { playIndex(st.index - 1); } });
      if (st.index + 1 < st.playlist.length) b.push({ id: 'nextep', label: 'Next \u25b6|', run: function () { playIndex(st.index + 1); } });
    }
    b.push({ id: 'audio', label: 'Audio', run: function () { openMenu(0); } });
    b.push({ id: 'subs', label: 'Subtitles', run: function () { openMenu(1); } });
    b.push({ id: 'aspect', label: 'Aspect: ' + MODE_LABEL[st.mode].replace(' (stretch)', ''), run: function () { cycleMode(); } });
    b.push({ id: 'zoomout', label: 'Zoom \u2212', run: function () { zoom(-0.02); } });
    b.push({ id: 'zoomin', label: 'Zoom +', run: function () { zoom(0.02); } });
    if (window.IS_ANDROID) b.push({ id: 'rotate', label: '\u27f3 Rotate', run: rotate });
    if (window.IS_ANDROID && window.CAST && st.item) b.push({ id: 'gcast', label: window.CAST.active ? '\u2b1a Casting: ' + window.CAST.active.name : '\u2b1a Cast', run: gcastMenu });   // any Chromecast / Google TV on this Wi-Fi
    if ((window.IS_ANDROID || window.PREVIEW) && st.item && !st.item.along) b.push({ id: 'cast', label: '\u25a3 Play on the TV', run: castMenu });   // watching along: the TV already plays it
    if (st.mode === 'zoom' || st.mode === 'zoom235') { b.push({ id: 'up', label: 'Picture \u2191', run: function () { shift(-20); } }); b.push({ id: 'down', label: 'Picture \u2193', run: function () { shift(20); } }); }
    return b;
  }
  // ---- cast picker (Android): list of TVs found on the Wi-Fi ----
  var castUi = { open: false, row: 0, list: [] };
  function castMenu() {   // hand the video to Los Bebos TV on the TV (it streams it itself), the phone becomes the remote
    if (!st.item || !UI.castRemote) return;
    var it = st.item, pos = st.time || 0, pl = st.playlist, ix = st.index;
    var slim = function (x) { return { kind: x.kind, id: x.id, name: x.name, ext: x.ext || null, icon: x.icon || '', seriesId: x.seriesId || null, seriesName: x.seriesName || null, aspectKey: x.aspectKey || null }; };
    var sent = slim(it), loc = it.localUrl ? { url: it.localUrl, tracks: it.localTracks || null } : (it.kind !== 'live' && window.DL ? DL.local(it) : null);
    if (loc && window.CAST && window.CAST.serve && /^file:/.test(loc.url)) {   // a copy on this phone: the TV plays it from the phone, the provider is not involved
      var su = window.CAST.serve(loc.url, /\.mkv/i.test(loc.url) ? 'video/x-matroska' : /\.mp4/i.test(loc.url) ? 'video/mp4' : 'video/mp2t');
      if (su) { sent.localUrl = su; sent.localTracks = loc.tracks || null; sent.fromPhone = true; }
    }
    stop();   // free the account's one stream for the TV
    UI.castRemote({ cmd: 'play', item: sent, pos: it.kind === 'live' ? 0 : pos, playlist: pl && pl.length <= 400 ? pl.map(slim) : null, index: pl ? ix : -1 });
  }
  function gcastMenu() {
    if (!window.CAST) return;
    if (window.CAST.active) {   // press again = stop casting and carry on here from where the TV was
      var at = window.CAST.status && window.CAST.status.pos || st.time || 0, it = st.item, pl = st.playlist, ix = st.index;
      window.CAST.stop(); st.casting = false; UI.toast('Stopped casting', 2000); msg(null);
      if (it) { if (at > 0 && it.kind !== 'live') STORE.setPosition(it.kind + ':' + it.id, at); play(it, pl, ix, { dlOk: true }); }
      return;
    }
    castUi.open = true; castUi.row = 0; castUi.list = []; renderCast('Looking for TVs on this Wi-Fi...');
    window.CAST.discover(function (list) { castUi.list = (list || []).concat([{ id: '__mirror', name: '\u2b1a Mirror the screen (Smart View) - for Samsung and other TVs without Google Cast' }]); renderCast(list.length ? null : 'No Google Cast TV on this Wi-Fi (Chromecast, Google TV, LG, Sony, Philips, TCL have it; Samsung does not).'); });
  }
  function renderCast(msgText) {
    var m = $('track-menu'); if (!castUi.open) { if (!menu.open) m.classList.add('hidden'); return; }
    var html = '<div class="tm-col active"><div class="tm-title">Cast</div>';
    if (msgText) html += '<div class="tm-item dim">' + esc(msgText) + '</div>';
    castUi.list.forEach(function (d, i) { html += '<div class="tm-item' + (i === castUi.row ? ' focused' : '') + '">' + esc(d.name) + '</div>'; });
    html += '</div>'; m.innerHTML = html; m.classList.remove('hidden'); showUi(60000);
  }
  function castKey(k) {
    if (k === 10009) { castUi.open = false; renderCast(); return true; }
    if (k === 38) { castUi.row = Math.max(0, castUi.row - 1); renderCast(); return true; }
    if (k === 40) { castUi.row = Math.min(castUi.list.length - 1, castUi.row + 1); renderCast(); return true; }
    if (k === 13 && castUi.list.length && castUi.list[castUi.row].id === '__mirror') { castUi.open = false; renderCast(); if (!window.CAST.mirror()) UI.toast('Open Smart View from the phone\'s quick settings', 4000); return true; }
    if (k === 13 && castUi.list.length) { var d = castUi.list[castUi.row], it = st.item, at = st.time || 0;
      var loc = it.localUrl ? { url: it.localUrl } : (it.kind !== 'live' && window.DL ? DL.local(it) : null);
      var url = loc ? loc.url : (it.shareUrl || API.streamUrl(it.kind, it.id, it.ext, it.name));
      window.CAST.play(d.id, url, (it.seriesName ? it.seriesName + ' - ' : '') + it.name, it.kind === 'live' ? 0 : at); castUi.open = false; renderCast();
      st.casting = true; try { av().stop(); } catch (e) {} msg('Sending to ' + d.name + '...'); return true; }
    return true;
  }
  // ---- touch helpers (phone / mouse) ----
  function tapButton(i) { var b = buttons(); if (i < 0 || i >= b.length) return; ctl.row = 1; ctl.idx = i; b[i].run(); renderCtl(); showUi(6000); }
  function tapMenu(el) {
    var col = el.parentElement, cols = Array.prototype.slice.call(col.parentElement.children), c = cols.indexOf(col);
    var items = Array.prototype.filter.call(col.children, function (x) { return x.classList.contains('tm-item') && !x.classList.contains('dim'); });
    var r = items.indexOf(el); if (r < 0) return;
    if (castUi.open) { castUi.row = r; castKey(13); return; }
    if (dvUi.open) { dvUi.row = r; dvKey(13); return; }
    if (menu.only >= 0) c = menu.only; else c = c;
    var mi = menuItems(c); var off = 0; var first = col.querySelector('.tm-item.dim'); if (first && first === col.children[1] && /more/.test(first.textContent)) { off = parseInt(first.textContent) || 0; }
    menu.col = c; menu.row = r + off; menuKey(13);
  }
  function tapMenuColumn(colEl) { if (!menu.open) return; var cols = Array.prototype.slice.call(colEl.parentElement.children), c = cols.indexOf(colEl); if (menu.only >= 0) c = menu.only; if (c !== menu.col) { menu.col = c; menu.row = 0; var items = menuItems(c); items.forEach(function (it, r) { if (it.on) menu.row = r; }); renderMenu(); } }
  function nudge(ms) { if (st.duration <= 0) return; var base = seekAcc.target >= 0 ? seekAcc.target : st.time; seekAcc.target = Math.max(0, Math.min(st.duration - 1000, base + ms)); clearTimeout(seekAcc.timer); seekAcc.timer = setTimeout(commitSeek, 600); }
  function dragSeek(frac) { if (st.duration <= 0) return; seekAcc.target = Math.round(st.duration * frac); var mk = $('seek-marker'); mk.classList.remove('hidden'); mk.style.left = (frac * 100) + '%'; $('seek-time').textContent = fmt(seekAcc.target); var th = $('seek-thumb'); if (th) { var u = window.SEEK_THUMB ? window.SEEK_THUMB(seekAcc.target) : null; if (u) { if (th.getAttribute('src') !== u) th.src = u; th.classList.remove('hidden'); } else th.classList.add('hidden'); } clearTimeout(seekAcc.timer); showUi(6000); }
  function endDragSeek() { if (seekAcc.target >= 0) { clearTimeout(seekAcc.timer); commitSeek(); } }
  function tapSeek(frac) { if (st.duration <= 0) return; seekAcc.target = Math.round(st.duration * frac); seekAcc.last = 0; clearTimeout(seekAcc.timer); commitSeek(); }
  function tapScreen() { if (el.ui.classList.contains('hidden')) showUi(5000); else { el.ui.classList.add('hidden'); clearTimeout(st.uiTimer); } renderCenter(); }
  function touchUi() { return !!(window.PREVIEW || window.IS_ANDROID); }
  function renderCenter() {
    var c = $('center-ctl'); if (!c) return;
    var show = touchUi() && st.active && !st.preview && !el.ui.classList.contains('hidden') && !menu.open;
    c.classList.toggle('hidden', !show); if (!show) return;
    var paused = false; try { paused = av().getState() === 'PAUSED'; } catch (e) {}
    c.querySelector('.cc-play').classList.toggle('paused', paused);
    c.querySelector('.cc-back').style.visibility = c.querySelector('.cc-fwd').style.visibility = st.duration > 0 ? 'visible' : 'hidden';
  }
  function centerAction(a) { if (a === 'play') togglePause(); else if (a === 'back') nudge(-10000); else if (a === 'fwd') nudge(10000); showUi(4000); setTimeout(renderCenter, 150); }
  function renderCtl() {
    var b = buttons(); if (ctl.idx >= b.length) ctl.idx = b.length - 1;
    renderCenter();
    $('ctl-row').innerHTML = b.map(function (x, i) { return '<div class="cbtn' + (ctl.row === 1 && i === ctl.idx ? ' focused' : '') + '">' + x.label + '</div>'; }).join('');
    document.querySelector('#player-ui .progress').classList.toggle('focused', ctl.row === 0 && st.duration > 0);
  }
  function menuItems(col) { return col === 0 ? tracks.audio.map(function (t, i) { return { label: trackLabel(t, i, 'AUDIO'), on: i === tracks.audioIdx, i: i }; }) : [{ label: 'Off', on: tracks.textIdx < 0, i: -1 }].concat(tracks.text.map(function (t, i) { return { label: trackLabel(t, i, 'TEXT'), on: i === tracks.textIdx, i: i }; })); }
  function renderMenu() {
    var m = $('track-menu'); if (!menu.open) { m.classList.add('hidden'); return; }
    if (!tracks.audio.length && !tracks.text.length) readTracks();
    var html = '';
    (menu.only >= 0 ? [menu.only] : [0, 1]).forEach(function (c) {
      var items = menuItems(c);
      html += '<div class="tm-col' + (menu.col === c ? ' active' : '') + '"><div class="tm-title">' + (c === 0 ? 'Audio' : 'Subtitles') + '</div>';
      if (!items.length) html += '<div class="tm-item dim">No tracks reported</div>';
      var VISM = (window.PREVIEW || window.IS_ANDROID) ? 999 : 12, start = 0, on = -1; items.forEach(function (it, r) { if (it.on) on = r; });
      var focusRow = menu.col === c ? menu.row : on;
      if (focusRow >= VISM - 1) start = Math.min(focusRow - VISM + 2, Math.max(0, items.length - VISM));
      if (start > 0) html += '<div class="tm-item dim">\u2191 ' + start + ' more above</div>';
      items.slice(start, start + VISM).forEach(function (it, r0) { var r = r0 + start; html += '<div class="tm-item' + (it.on ? ' on' : '') + (menu.col === c && menu.row === r ? ' focused' : '') + '">' + (it.on ? '\u25cf ' : '\u25cb ') + esc(it.label) + '</div>'; });
      if (start + VISM < items.length) html += '<div class="tm-item dim">\u2193 ' + (items.length - start - VISM) + ' more below</div>';
      html += '</div>';
    });
    m.innerHTML = html; m.classList.remove('hidden');
    var fc = m.querySelector('.tm-item.focused'); if (fc && fc.scrollIntoView && (window.PREVIEW || window.IS_ANDROID)) fc.scrollIntoView({ block: 'nearest' });
  }
  function openMenu(col) { if (st.preview) return; readTracks(); if (window.DIAG) window.DIAG('menuOpen', { a: tracks.audio.length, t: tracks.text.length }); menu.open = true; menu.only = typeof col === 'number' ? col : -1; menu.col = typeof col === 'number' ? col : (tracks.text.length ? 1 : 0); menu.row = 0; var items = menuItems(menu.col); items.forEach(function (it, r) { if (it.on) menu.row = r; }); renderMenu(); showUi(60000); }
  function closeMenu() { menu.open = false; renderMenu(); showUi(2500); }
  function menuKey(k) {
    if (k === 10009 || k === 406 || k === 457) { closeMenu(); return true; }
    var items = menuItems(menu.col);
    if ((k === 37 || k === 39) && menu.only < 0) { menu.col = menu.col === 0 ? 1 : 0; menu.row = 0; renderMenu(); return true; }
    if (k === 38) { menu.row = Math.max(0, menu.row - 1); renderMenu(); return true; }
    if (k === 40) { menu.row = Math.min(items.length - 1, menu.row + 1); renderMenu(); return true; }
    if (k === 13 && items.length) { var it = items[menu.row]; if (menu.col === 0) setAudio(it.i); else setText(it.i); if (window.DIAG) window.DIAG('menuSelect', { col: menu.col, i: it.i, label: it.label }); closeMenu(); UI.toast((menu.col === 0 ? 'Audio: ' : 'Subtitles: ') + it.label.replace(/^\d+\. /, ''), 2000); return true; }
    return true;
  }
  var subTimer = 0, subCount = 0;
  function showSubtitle(duration, text) {
    if (subCount++ < 2 && window.DIAG) window.DIAG('subtitle', { sel: tracks.textIdx, d: duration, t: String(text).slice(0, 80) });
    if (st.preview) return;
    var clean = String(text || '').replace(/\u0000/g, '').replace(/\r/g, '')
      .replace(/<br\s*\/?>/gi, '\n').replace(/\\[Nn]/g, '\n')                 // line breaks sent as tags: keep them (they glued words together)
      .replace(/\{\\[^}]*\}/g, '').replace(/<[^>]+>/g, '')                    // styling tags
      .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')        // invisible direction marks (shown as odd symbols, flipped the '?')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
      .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
    el.sub.innerHTML = clean ? '<span>' + esc(clean).replace(/\n/g, '<br>') + '</span>' : '';
    clearTimeout(subTimer); subTimer = setTimeout(function () { el.sub.textContent = ''; }, Math.max(1000, Math.min(12000, Number(duration) || 4000)));
  }
  function esc(x) { return x.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  function listener() {
    return {
      onbufferingstart: function () { msg('Buffering...'); },
      onbufferingprogress: function (p) { msg('Buffering ' + p + '%'); },
      onbufferingcomplete: function () { msg(null); },
      oncurrentplaytime: function (t) { nextUp(t); if (t > st.time && el.msg && /^Buffering/.test(el.msg.textContent)) msg(null); st.time = t; if (st.duration > 0) { el.fill.style.width = Math.min(100, t / st.duration * 100) + '%'; el.cur.textContent = fmt(t); } else { el.cur.textContent = 'LIVE'; } },
      onstreamcompleted: function () {
        if (st.item && st.item.kind === 'live') {   // a live channel never 'finishes': the provider ended this connection, so open the channel again (spaced like the other reconnects)
          var itL = st.item, plL = st.playlist, ixL = st.index; itL.netRetries = (itL.netRetries || 0) + 1;
          if (itL.netRetries <= NET_TRIES) { msg(netMsg(itL.netRetries)); try { av().stop(); av().close(); } catch (x) {} setTimeout(function () { if (st.item === itL) play(itL, plL, ixL, { dlOk: true, keepMsg: true }); }, netDelay(itL.netRetries)); return; }
        }
        if (st.item && st.item.kind !== 'live') {
          var k = posKey(); if (k) STORE.setPosition(k, 0);
          var done = st.item, pl = st.playlist, ix = st.index, hasNext = pl && ix + 1 < pl.length;
          if (window.DL && DL.state(done) && DL.state(done).state === 'done') { stop(true); askDelete(done, function () { if (hasNext) play(pl[ix + 1], pl, ix + 1); else UI.showCurrent(); }); return; }
          if (hasNext) { playIndex(ix + 1); return; }
        }
        stop(); UI.toast('Playback finished'); },
      onerror: function (e) {
        // TV + phone: a dropped/refused connection at the provider's video server is retried (resuming at the same spot) before giving up
        if (!st.local && window.DL && st.item && st.item.kind !== 'live' && DL.local(st.item) && /IO_|NETWORK|TIMEOUT|BAD_HTTP|Source error|CONNECTION/i.test(String(e))) { var itL = st.item, plL = st.playlist, ixL = st.index; if (st.time > 0) STORE.setPosition(itL.kind + ':' + itL.id, st.time); msg('Internet dropped, continuing from the downloaded copy...'); setTimeout(function () { if (st.item === itL) play(itL, plL, ixL); }, 400); return; }
        if (st.item && st.item.shareUrl && !window.IS_ANDROID && !window.PREVIEW) { var itS = Object.assign({}, st.item), plS = st.playlist, ixS = st.index; if (st.time > 0 && itS.kind !== 'live') STORE.setPosition(itS.kind + ':' + itS.id, st.time); delete itS.shareUrl; msg('The home laptop stopped sharing, playing directly...'); setTimeout(function () { play(itS, plS, ixS, { dlOk: true }); }, 500); return; }
        if (st.item && /\b460\b/.test(String(e)) && (st.item.busyTries || 0) < 30) { var itB = st.item, plB = st.playlist, ixB = st.index, atB = st.time; itB.busyTries = (itB.busyTries || 0) + 1; if (atB > 0 && itB.kind !== 'live') STORE.setPosition(itB.kind + ':' + itB.id, atB);
          msg('Another device is using the stream (the account allows one). Trying again in 20 s... (' + itB.busyTries + ')'); setTimeout(function () { if (st.item === itB && st.active) play(itB, plB, ixB, { dlOk: true }); }, 20000); return; }
        if (!window.PREVIEW && st.item && (st.item.netRetries || 0) < NET_TRIES && /IO_|NETWORK|TIMEOUT|BAD_HTTP|Source error|CONNECTION/i.test(String(e))) { var itR = st.item, plR = st.playlist, ixR = st.index, atR = st.time; itR.netRetries = (itR.netRetries || 0) + 1; msg(netMsg(itR.netRetries)); try { av().stop(); av().close(); } catch (x) {} if (atR > 0 && itR.kind !== 'live') STORE.setPosition(itR.kind + ':' + itR.id, atR); setTimeout(function () { if (st.item === itR) play(itR, plR, ixR); }, netDelay(itR.netRetries)); return; }
        if ((window.PREVIEW || (window.IS_ANDROID && API.viaHome())) && st.item && !st.item.homeRetried && API.refreshHome) { var it0 = st.item, pl1 = st.playlist, ix1 = st.index; it0.homeRetried = true; API.refreshHome().then(function (ch) { if (ch) { UI.toast('Home address changed, reconnecting...', 2500); play(it0, pl1, ix1); } else msg('Playback error: ' + e); }); return; }
        // browser cannot decode this live channel (4K HEVC): switch to the HD version of the same channel
        if ((window.PREVIEW || window.IS_ANDROID) && st.item && st.item.kind === 'live' && /codec/i.test(String(e)) && !st.item.altTried && API.alt) {
          var orig = st.item, pl0 = st.playlist, ix0 = st.index; msg('4K version not supported here, looking for the HD version...');
          API.alt(orig.rawName || orig.name).then(function (list) {
            if (!list.length) { msg(String(e)); return; }
            var pick = list.filter(function (x) { return /ᴴᴰ|HD\b/.test(x.name) && !/SD\b/.test(x.name); })[0] || list.filter(function (x) { return !/\bSD\b/.test(x.name); })[0] || list[0];
            var alt = { kind: 'live', id: pick.id, name: UI.niceName ? UI.niceName(pick.name) : pick.name, icon: orig.icon, altTried: true };
            UI.toast('Playing the HD version instead: ' + alt.name, 4000); play(alt, pl0, ix0);
          }).catch(function () { msg(String(e)); });
          return;
        }
        if (st.relayUrl && !st.retriedDirect && st.item) { window.RELAY_OK = false; var it = st.item, pl = st.playlist, ix = st.index; UI.toast('Laptop relay failed, playing directly', 2500); return play(it, pl, ix, { retriedDirect: true }); } msg('Playback error: ' + e); if (window.DIAG) window.DIAG('avplayError', String(e)); },
      onevent: function () {}, onsubtitlechange: function (duration, text) { showSubtitle(duration, text); }, ondrmevent: function () {}
    };
  }


  // ---- Dolby Vision profile 5 (the purple/green picture): detected from the file header the app already reads for subtitles.
  // Nothing extra runs unless such a file is opened; then one question, and only on "yes" one category list is loaded (not kept).
  function dvCapable() {
    // Dolby Vision profile 5 is single-layer: without a true DV display path it shows purple/green or black.
    // Only real DV TVs/streamers (and Safari on some Apple gear) handle it. Android phones in a WebView + ExoPlayer do NOT
    // reliably show it (Samsung never does), so we always offer the regular copy there - the user can still choose "Keep 4K".
    if (window.IS_ANDROID) return false;
    if (window.PREVIEW) { try { return !!(window.MediaSource && MediaSource.isTypeSupported('video/mp4; codecs="dvh1.05.06"')); } catch (e) { return false; } }
    return false;   // this Samsung TV has no Dolby Vision
  }
  var SUP = /[²³¹ʰ-˿ᴀ-ᶿ⁰-₟ⱼⱽꚜꚝꝰ]/g;
  function catBase(n) { return String(n || '').replace(SUP, '').replace(/\s+/g, ' ').trim().toUpperCase(); }
  function titleKey(n) { return String(n || '').replace(/^\S{1,15}\s+-\s+/, '').toLowerCase().replace(/\b(4k|uhd|hdr10\+?|hdr|dv|dolby vision|2160p)\b/g, '').replace(/[^a-z0-9À-ɏЀ-ӿ]+/g, ' ').trim(); }
  function noYear(k) { return k.replace(/\s(19|20)\d\d(\s|$).*$/, '').trim(); }
  function findRegular(item) {
    var kind = item.kind === 'vod' ? 'vod' : 'series', src;
    var info = kind === 'series' ? API.seriesInfo(item.seriesId).then(function (d) { var i = d.info || {}; return { cat: i.category_id, tmdb: i.tmdb || i.tmdb_id, name: i.name || item.seriesName }; })
      : (item.raw && item.raw.category_id ? Promise.resolve({ cat: item.raw.category_id, tmdb: item.raw.tmdb, name: item.raw.name }) : API.vodInfo(item.id).then(function (d) { var i = d.info || {}, m = d.movie_data || {}; return { cat: m.category_id, tmdb: i.tmdb_id || i.tmdb, name: m.name || item.name }; }));
    return info.then(function (x) { src = x; return API.categories(kind); }).then(function (cats) {
      var from = null, to = null; cats.forEach(function (c) { if (String(c.category_id) === String(src.cat)) from = c; });
      if (!from) return null; var want = catBase(from.category_name);
      cats.forEach(function (c) { if (!to && c !== from && !/⁴ᴷ/.test(c.category_name) && catBase(c.category_name) === want) to = c; });
      if (!to) return null;
      return API.itemsOnce(kind, to.category_id).then(function (list) {
        var k = titleKey(src.name), m = null, t = String(src.tmdb || ''); list = list || [];
        if (t && t !== '0') list.forEach(function (x) { if (!m && String(x.tmdb || '') === t) m = x; });
        if (!m) list.forEach(function (x) { if (!m && titleKey(x.name) === k) m = x; });
        if (!m) list.forEach(function (x) { if (!m && noYear(titleKey(x.name)) === noYear(k)) m = x; });
        if (!m) return null;
        if (kind === 'vod') return { item: { kind: 'vod', id: m.stream_id, name: UI.niceName ? UI.niceName(m.name) : m.name, icon: m.stream_icon || item.icon || '', ext: m.container_extension || 'mp4', raw: m }, playlist: null, index: -1 };
        var se = /S(\d+)E(\d+)/i.exec(item.name || ''); if (!se) return null;
        return API.seriesInfo(m.series_id).then(function (d) {
          var eps = [], hit = -1, seasons = d.episodes || {};
          Object.keys(seasons).sort(function (a, b) { return Number(a) - Number(b); }).forEach(function (sn) { (seasons[sn] || []).forEach(function (e) {
            var tt = e.title || ''; var mm = /S\d+E\d+.*$/i.exec(tt); var short = mm ? mm[0] : ('S' + sn + 'E' + e.episode_num + ' ' + tt);
            if (Number(sn) === Number(se[1]) && Number(e.episode_num) === Number(se[2])) hit = eps.length;
            eps.push({ kind: 'series', id: e.id, name: short, ext: e.container_extension || 'mp4', icon: item.icon, aspectKey: 'series-' + m.series_id, seriesId: m.series_id, seriesName: m.name }); }); });
          return hit < 0 ? null : { item: eps[hit], playlist: eps, index: hit };
        });
      });
    });
  }
  var dvUi = { open: false, row: 0, item: null, go: null };
  function renderDv(text) {
    var m = $('track-menu'); if (!dvUi.open) { if (!menu.open && !castUi.open) m.classList.add('hidden'); return; }
    var rows = ['Play the regular version', 'Keep 4K (wrong colours)'];
    var html = '<div class="tm-col active dv-col"><div class="tm-title">Colours will look wrong</div><div class="tm-item dim dv-note">' + esc(text || 'This 4K copy is Dolby Vision, which this screen cannot show.') + '</div>';
    rows.forEach(function (r, i) { html += '<div class="tm-item' + (i === dvUi.row ? ' focused' : '') + '">' + esc(r) + '</div>'; });
    m.innerHTML = html + '</div>'; m.classList.remove('hidden'); showUi(600000);
  }
  function askDv(item, openIt) {
    msg(null); setPreviewText(null, ''); if (st.preview) fullscreen();
    dvUi.open = true; dvUi.row = 0; dvUi.item = item; dvUi.go = openIt; renderDv();
  }
  function dvKey(k) {
    if (k === 38 || k === 40) { dvUi.row = dvUi.row ? 0 : 1; renderDv(); return true; }
    if (k === 10009) { dvUi.open = false; renderDv(); stop(); return true; }
    if (k !== 13) return true;
    var item = dvUi.item, go = dvUi.go;
    if (dvUi.row === 1) { dvUi.open = false; renderDv(); msg('Connecting...'); go(); return true; }
    renderDv('Looking for the regular version...');
    findRegular(item).then(function (r) {
      if (!dvUi.open || dvUi.item !== item) return; dvUi.open = false; renderDv();
      if (!r) { UI.toast('No regular version found, playing 4K', 3500); msg('Connecting...'); go(); return; }
      var oldPos = STORE.position(posKey()), newKey = r.item.kind + ':' + r.item.id;
      if (oldPos > 0 && !STORE.position(newKey)) STORE.setPosition(newKey, oldPos);
      UI.toast('Playing the regular version', 2500); play(r.item, r.playlist, r.index);
    }).catch(function () { if (!dvUi.open || dvUi.item !== item) return; dvUi.open = false; renderDv(); UI.toast('Could not look it up, playing 4K', 3500); msg('Connecting...'); go(); });
    return true;
  }

  function play(item, playlist, index, opts) {
    var a = av(); if (!a) { UI.toast('AVPlay not available'); return; }
    setTimeout(function () { if (st.item === item) { watchStall(item); watchStallTv(item); } }, 1000);
    opts = opts || {};
    // a running download has priority over streaming (the account allows one stream); copies on the stick / phone play as normal
    if ((window.IS_ANDROID || window.PREVIEW) && window.DL && DL.refreshBusy && !opts.dlOk && !opts.checked && !item.localUrl && !item.shareUrl && !(item.kind !== 'live' && DL.local(item))) {
      var o2 = Object.assign({}, opts, { checked: true }); DL.refreshBusy(function () { play(item, playlist, index, o2); }); return;
    }
    var pri = window.DL && DL.priority && !opts.dlOk && !item.localUrl && !(item.kind !== 'live' && DL.local(item)) ? DL.priority() : null;
    if (pri && pri.here) {
      UI.ask(pri.title + ' is downloading (' + pri.info + '). ' + (pri.tv ? 'Watching now stops that download; it starts again from the beginning when you stop watching (the TV cannot pause it without blocking the stream).' : 'Downloads have priority. Watching now pauses it until you stop watching.'), ['Watch now', 'Keep downloading'], function (i) {
        if (i === 0) play(item, playlist, index, Object.assign({}, opts, { dlOk: true })); else UI.showCurrent();
      });
      return;
    }
    if (pri && pri.playing) { UI.ask('The TV is playing ' + pri.title + '. The TV has the stream, but you can watch along: you see what the TV shows, and pausing or skipping here does it on the TV too.', ['Watch along', 'Cancel'], function (i) { if (i === 0) startAlong(); else UI.showCurrent(); }); return; }
    if (pri) { UI.ask('The ' + pri.who + ' is downloading ' + pri.title + ' (' + pri.info + '). Downloads have priority, so streaming waits until it is finished. Downloaded videos play as normal.', ['OK'], function () { UI.showCurrent(); }); return; }
    stop(true);
    opts = opts || {};
    st.preview = opts.preview || null; st.fromPreview = !!opts.preview;
    st.tracksToasted = false;
    try { document.body.classList.toggle('playing', !opts.preview); } catch (e) {}
    nextUp(0); st.item = item; st.playlist = playlist || null; st.index = typeof index === 'number' ? index : -1; st.active = true; st.duration = 0; st.time = 0; ctl.row = item.kind === 'live' ? 1 : 0; ctl.idx = 0;
    var saved = STORE.aspectFor(aspectKey());
    if (saved) { st.mode = saved.mode; st.scale = saved.scale || 1.15; st.offsetY = saved.offsetY || 0; } else { st.mode = CONFIG.defaultAspect || 'original'; st.scale = 1.15; st.offsetY = 0; }
    if (!st.preview) UI.hideScreens();
    el.title.textContent = item.name; el.epg.textContent = ''; el.fill.style.width = '0%'; el.cur.textContent = ''; el.dur.textContent = '';
    setPreviewText(item.name, 'Connecting...');
    if (!st.preview) { showUi(5000); msg('Connecting...'); }
    var loc = item.shareUrl ? null : item.localUrl ? { url: item.localUrl, tracks: item.localTracks || null, where: item.fromPhone || window.IS_ANDROID ? 'phone' : 'USB stick' } : item.kind !== 'live' && window.DL ? DL.local(item) : null;   // downloaded copy / any video file from the browser: works without internet
    var url = loc ? loc.url : item.shareUrl ? item.shareUrl : API.streamUrl(item.kind, item.id, item.ext, item.name);   // shareUrl: watching along through the home laptop
    st.local = !!loc;
    holdStream(true, (item.seriesName ? item.seriesName + '  ' : '') + item.name, item);   // TV: tell the laptop at once (the phone's card, priority, watch along)
    st.relayUrl = false; st.retriedDirect = true;
    st.fileTracks = null; window.__fileTracks = null;
    var isMkv = item.kind !== 'live' && /mkv$/i.test(String(item.ext || ''));
    if (loc) {
      if (!item.localUrl) DL.touch(item); UI.toast('Playing from the ' + loc.where, 2500);
      if (loc.tracks) { st.fileTracks = loc.tracks; window.__fileTracks = loc.tracks; }
      if (loc.tracks && loc.tracks.dv && loc.tracks.dv.profile === 5 && !dvCapable()) askDv(item, openStream); else openStream();
    } else if (isMkv && window.MKV) {
      var done = false, timer = setTimeout(function () { if (!done) { done = true; openStream(); } }, 5000);
      MKV.readTracks(url).then(function (r) { if (done) return; done = true; clearTimeout(timer); st.fileTracks = r; window.__fileTracks = r; if (window.DIAG) window.DIAG('mkvTracks', { a: r.audio, t: r.text.map(function (x) { return x.number + ':' + x.lang + '/' + x.name + (x.forced ? '/F' : '') + (x.def ? '/D' : ''); }), dv: r.dv }); if (r.dv && r.dv.profile === 5 && !dvCapable()) return askDv(item, openStream); openStream(); })
        .catch(function (e) { if (done) return; done = true; clearTimeout(timer); if (window.DIAG) window.DIAG('mkvErr', String(e && e.message)); openStream(); });
    } else openStream();
    function openStream() {
    if (!st.active || st.item !== item) return;
    try {
      a.open(url);
      try { a.setStreamingProperty('USER_AGENT', 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) DoorTV'); } catch (e) {}
      a.setListener(listener());
      applyAspect(true);
      a.prepareAsync(function () {
        try { st.duration = a.getDuration() || 0; } catch (e) { st.duration = 0; }
        el.dur.textContent = st.duration > 0 ? fmt(st.duration) : 'LIVE'; renderCtl();
        var resume = st.duration > 0 ? STORE.position(posKey()) : 0; if (resume > 0 && resume >= st.duration * 0.9) resume = 0;   // 90 % seen = finished: start over, do not land on the credits
        a.play(); if (opts.keepPaused) { try { a.pause(); } catch (e) {} } msg(null); setPreviewText(null, ''); if (item.netRetries) setTimeout(function () { if (st.item === item && st.time > 0) item.netRetries = 0; }, 30000);
        applyAspect(true);
        tracks.tries = 0; tracks.audioIdx = -1; tracks.textIdx = -1; if (item.kind !== 'live') setTimeout(selectTracks, 800);
        if (item.seriesId) STORE.setLastEpisode(item.seriesId, { id: item.id, name: item.name, ext: item.ext });
        if (resume > 60000 && resume < st.duration - 60000) { try { a.seekTo(resume); UI.toast('Resumed at ' + fmt(resume)); } catch (e) {} }
        STORE.addRecent({ kind: item.kind, id: item.id, name: item.name, ext: item.ext, icon: item.icon || '', aspectKey: item.aspectKey || null, seriesId: item.seriesId || null, seriesName: item.seriesName || null });
        clearInterval(st.posTimer);
        st.posTimer = setInterval(function () { if (st.duration > 0 && st.time > 0) STORE.setPosition(posKey(), st.time, st.duration); }, 5000);
        if (item.kind === 'live') { loadEpg(item.id); reportPlaying(item, st.relayUrl); pollWatchAlong(); }
        if (window.DL) DL.playing(item);
        alongFollow(item);
        watchTv();
      }, function (e) { if (!window.PREVIEW && st.item === item && (item.netRetries || 0) < NET_TRIES && /CONNECTION|NETWORK|TIMEOUT|IO_|Source error/i.test(String(e))) { item.netRetries = (item.netRetries || 0) + 1; msg(netMsg(item.netRetries)); try { av().stop(); av().close(); } catch (x) {} setTimeout(function () { if (st.item === item) play(item, playlist, index, opts); }, netDelay(item.netRetries)); return; } if (st.relayUrl && !st.retriedDirect) { window.RELAY_OK = false; UI.toast('Laptop relay not answering, playing directly', 2500); return play(item, playlist, index, Object.assign({}, opts, { retriedDirect: true })); } msg('Cannot open stream: ' + e); setPreviewText(null, 'Cannot open stream: ' + e); if (window.DIAG) window.DIAG('prepareError', String(e)); });
    } catch (e) { msg('Cannot open stream: ' + (e && e.message ? e.message : e)); }
    }
  }
  function setPreviewText(title, status) {
    var t = document.getElementById('preview-title'), st2 = document.getElementById('preview-status');
    if (t && title !== null) t.textContent = title;
    if (st2 && status !== undefined) st2.textContent = status;
  }
  function fullscreen() {
    if (!st.active) return;
    st.preview = null; UI.hideScreens(); el.ui.classList.remove('hidden'); showUi(4000); applyAspect(true);
  }
  function toPreview(rect) {
    if (!st.active) return;
    releaseOrient(); el.ui.classList.add('hidden'); clearTimeout(st.uiTimer); msg(null); st.preview = rect; UI.showCurrent(); st.preview = UI.previewRect() || rect; applyAspect(true);
  }
  function previewOf(item) { return st.active && st.preview && st.item && st.item.kind === item.kind && String(st.item.id) === String(item.id); }
  // ---- watch-along with the laptop (TV only). Never required: every call has a short timeout and failures are ignored. ----
  var wa = { timer: 0 };
  function relayBase() { return (CONFIG.relay || '').replace(/\/+$/, ''); }
  function quickFetch(url, ms) { return new Promise(function (resolve, reject) { var done = false; var t = setTimeout(function () { if (!done) { done = true; reject(new Error('timeout')); } }, ms || 1500); fetch(url, { cache: 'no-store' }).then(function (r) { if (done) return; done = true; clearTimeout(t); resolve(r); }).catch(function (e) { if (done) return; done = true; clearTimeout(t); reject(e); }); }); }
  function reportPlaying(item, viaRelay) {
    if (window.PREVIEW || window.IS_ANDROID || !CONFIG.relay || !item || item.kind !== 'live') return;
    quickFetch(relayBase() + '/relay/report?id=' + encodeURIComponent(item.id) + '&name=' + encodeURIComponent(item.name || '') + '&relayed=' + (viaRelay ? 1 : 0), 1500).catch(function () {});
  }
  function pollWatchAlong() { /* sharing not needed: the provider serves several streams to the home address */ }
  function loadEpg(id) {
    API.shortEpg(id).then(function (d) {
      if (!st.item || st.item.id !== id) return;
      var l = d && d.epg_listings ? d.epg_listings : [];
      if (!l.length) { el.epg.textContent = ''; return; }
      function dec(s) { try { return decodeURIComponent(escape(atob(s))); } catch (e) { return s; } }
      var now = l[0], next = l[1];
      var txt = 'Now: ' + dec(now.title) + (next ? '   |   Next: ' + dec(next.title) : '');
      el.epg.textContent = txt; var pe = document.getElementById('preview-epg'); if (pe) pe.textContent = txt;
    }).catch(function () {});
  }
  // TV only: tell the home laptop the TV is playing, so the phone / web give the stream up (the TV has priority)
  var holdT = 0, holdStopT = 0;
  // phone / web: the TV has priority, always. The moment it plays from the provider, this device gives its stream up (live and everything else)
  function tvTakeover(tv) {
    if (!(window.IS_ANDROID || window.PREVIEW) || !tv || tv.local || !st.active || st.local || st.casting || !st.item || st.item.along || st.item.shareUrl) return;
    var it = st.item, at = st.time; if (at > 0 && it.kind !== 'live') STORE.setPosition(it.kind + ':' + it.id, at);
    stop(); UI.ask('The TV took over the stream (the TV has priority): ' + (tv.title || '') + '. Watch along with the TV?', ['Watch along', 'OK'], function (i) { if (i === 0) startAlong(); else UI.showCurrent(); });
  }
  function holdStream(on, title, item) {
    if (window.IS_ANDROID || window.PREVIEW || !CONFIG.relay) return;
    clearInterval(holdT); clearTimeout(holdStopT);
    if (!on) { if (document.hidden) { sendHold(false); return; } holdStopT = setTimeout(function () { if (!st.active) sendHold(false); }, 3000); return; }   // standby / app hidden: release at once, before the network sleeps
    var send = function () { sendHold(true, title, item); };
    send(); holdT = setInterval(send, 60000);
  }
  function sendHold(on, title, item) { try { var x = new XMLHttpRequest(); x.open('POST', CONFIG.relay.replace(/\/+$/, '') + '/relay/hold', true); x.send(JSON.stringify({ state: on ? 'play' : 'stop', title: title || '', local: !!st.local, item: item ? { kind: item.kind, id: item.id, name: item.name, ext: item.ext || null, icon: item.icon || '', seriesId: item.seriesId || null, seriesName: item.seriesName || null, aspectKey: item.aspectKey || null } : null })); } catch (e) {} }
  // 'Next episode' offered on screen during the last 60 s (all devices): OK on the remote / a tap plays it; it goes away with the episode
  var nextUpOn = false;
  function nextUp(t) {
    var nx = st.item && st.item.kind !== 'live' && !st.casting && st.playlist && st.index + 1 < st.playlist.length && st.duration > 0 && t > 0 && st.duration - t <= 60000 ? st.playlist[st.index + 1] : null;
    var n = $('next-up'); if (!n) return;
    if (nx && !nextUpOn) { nextUpOn = true; n.innerHTML = '<span class="nu-lab">Next</span>' + esc(nx.name) + ' <span class="nu-key">\u25b6|</span>'; n.classList.remove('hidden'); }
    else if (!nx && nextUpOn) { nextUpOn = false; n.classList.add('hidden'); }
  }
  function esc(x) { return String(x || '').replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  var stallT = 0;
  function watchStallTv(item) {   // TV: no picture 20 s after the stream opened = the provider is not sending (its one slot is still taken); retry every 30 s for 10 min
    clearInterval(stallT); if (window.IS_ANDROID || window.PREVIEW || st.local) return;
    var t0 = Date.now(), lastT = -1, lastN = '', since = Date.now();
    stallT = setInterval(function () {
      if (!st.active || st.item !== item) { clearInterval(stallT); return; }
      var paused = false; try { paused = av().getState() === 'PAUSED'; } catch (e) {}
      if (paused) { lastT = st.time; since = Date.now(); return; }   // paused on purpose: time stands still, that is not a stall (it used to restart playback after 25 s)
      if (st.time > 0 && st.time !== lastT) { lastT = st.time; since = Date.now(); if (item.stallNote) { item.stallNote = false; msg(null); } return; }
      var nt = note(); if (/Buffering \d+%/.test(nt) && nt !== lastN) { lastN = nt; since = Date.now(); return; }   // a slow provider still sends: buffering climbs, leave it alone
      if (Date.now() - since < 25000) return;
      item.stalls = (item.stalls || 0) + 1; since = Date.now();
      var dl = window.DL && DL.list ? DL.list().filter(function (e) { return e.state === 'downloading'; })[0] : null;
      if (item.stalls > 20) { clearInterval(stallT); msg('The provider is not sending this video. ' + (dl ? 'Cancel the download in Downloads to free the connection, or try later.' : 'Try again later.')); return; }
      item.stallNote = true;
      msg((dl ? 'The paused download (' + (dl.title || '') + ') still holds the provider\'s only connection for a few minutes. ' : 'The provider is not sending video yet. ') + 'Trying again... (' + item.stalls + ')');
      var pl = st.playlist, ix = st.index, at = st.time; if (at > 0 && item.kind !== 'live') STORE.setPosition(item.kind + ':' + item.id, at); try { av().stop(); } catch (e) {}
      setTimeout(function () { if (st.item === item && st.active) play(item, pl, ix, { dlOk: true, keepMsg: true }); }, 1500);
    }, 3000);
  }
  function watchStall(item) {
    clearInterval(stallT); if (!(window.IS_ANDROID || window.PREVIEW) || st.local) return;
    var lastT = -1, since = Date.now();
    stallT = setInterval(function () {
      if (!st.active || st.item !== item || st.casting) { clearInterval(stallT); return; }
      var paused = false; try { paused = av().getState() === 'PAUSED'; } catch (e) {}
      if (paused || st.time !== lastT) { lastT = st.time; since = Date.now(); return; }
      if (Date.now() - since < 15000) return;
      clearInterval(stallT); item.stalls = (item.stalls || 0) + 1; if (item.stalls > 20) { msg('The provider sends no video right now. Try again later.'); return; }
      var pl = st.playlist, ix = st.index, at = st.time; if (at > 0 && item.kind !== 'live') STORE.setPosition(item.kind + ':' + item.id, at);
      try { av().stop(); } catch (e) {}   // close the connection: a stalled stream would still count as the account's one stream
      msg('No video coming from the provider. Freed the connection, trying again in 20 s... (' + item.stalls + ')');
      setTimeout(function () { if (st.item === item && st.active) play(item, pl, ix, { dlOk: true }); }, 20000);
    }, 3000);
  }
  // ---- watch along (phone / web): show what the TV shows, in step; pause / skip here does it on the TV ----
  var alongT = 0, alongQuiet = 0;
  function alongSend(c) {
    if (!st.item || !st.item.along) return; alongQuiet = Date.now() + 3000;
    var u = API.homeApi ? API.homeApi('cast') : null; if (u) fetch(u, { method: 'POST', body: JSON.stringify(c), headers: { 'Content-Type': 'text/plain' } }).catch(function () {});
  }
  function alongSend2(c) { var u = API.homeApi ? API.homeApi('cast') : null; if (u) fetch(u, { method: 'POST', body: JSON.stringify(c), headers: { 'Content-Type': 'text/plain' } }).catch(function () {}); }
  function alongFollow(item) {
    clearInterval(alongT); if (!item.along) return;
    var u = API.homeApi ? API.homeApi('along') : null; if (!u) return;
    alongT = setInterval(function () {
      if (!st.active || st.item !== item) { clearInterval(alongT); return; }
      fetch(u, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
        if (!st.active || st.item !== item) return;
        var tv = j.tv || {};
        if (!j.item || tv.state === 'idle') { item.idleSince = item.idleSince || Date.now(); if (document.hidden || Date.now() - item.idleSince < 25000 || (j.item && tv.state !== 'idle') || (!j.item && tv.state && tv.state !== 'idle')) return;   // only when the TV itself says it stopped, for 25 s, and never while this tab is in the background
          clearInterval(alongT); var itX = Object.assign({}, item), atX = st.time; delete itX.shareUrl; delete itX.along; stop();
          UI.ask('The TV stopped playing.', ['Start it again on the TV', 'Keep watching here', 'OK'], function (i) {
            if (i === 0) { alongSend2({ cmd: 'play', item: itX, pos: atX }); UI.toast('Starting it on the TV...', 3000); setTimeout(function () { startAlong(); }, 9000); }
            else if (i === 1) { if (atX > 60000) STORE.setPosition(itX.kind + ':' + itX.id, atX); play(itX, null, -1, { dlOk: true }); }
            else UI.showCurrent();
          }); return; }
        item.idleSince = 0;
        if (j.item.kind + ':' + j.item.id !== item.kind + ':' + item.id) { clearInterval(alongT); startAlong(j); return; }   // the TV went on (next episode): follow
        if (Date.now() < alongQuiet || item.kind === 'live') return;
        var paused = false; try { paused = av().getState() === 'PAUSED'; } catch (e) {}
        if ((tv.state === 'paused') !== paused) { togglePause(true); return; }
        var est = (tv.pos || 0) + (tv.state === 'playing' ? Math.max(0, (j.now || 0) - (tv.at || j.now || 0)) : 0);
        var moving = st.time !== item.lastSyncTime; item.lastSyncTime = st.time; item.stillFor = moving ? 0 : (item.stillFor || 0) + 1;
        if (!paused && item.stillFor >= 2) return;   // still buffering here (3 s without progress): a seek now would only start the wait again
        if (st.duration > 0 && Math.abs(est - st.time) > 2500) { seekAcc.fromSync = true; seekAcc.target = Math.max(0, Math.min(st.duration - 1000, est)); clearTimeout(seekAcc.timer); commitSeek(); alongQuiet = Date.now() + 2500; item.stillFor = 0; }
      }).catch(function () {});
    }, 1500);
  }
  function startAlong(j0) {
    var go = function (j) {
      if (!j || !j.item) { UI.toast('The TV is not playing anything right now', 3500); return; }
      var it = Object.assign({}, j.item), url = API.shareUrl ? API.shareUrl(it) : null; if (!url) { UI.toast('The home laptop is not reachable', 3500); return; }
      var tv = j.tv || {}, est = (tv.pos || 0) + (tv.state === 'playing' ? Math.max(0, (j.now || 0) - (tv.at || j.now || 0)) : 0);
      if (it.kind !== 'live') STORE.setPosition(it.kind + ':' + it.id, est > 1500 ? est + 2000 : 0);
      it.shareUrl = url; it.along = true;
      play(it, null, -1, { dlOk: true, keepPaused: tv.state === 'paused' });
      UI.toast('Watching along with the TV. Pause or skip here and the TV follows.', 4000);
    };
    if (j0) return go(j0);
    var u = API.homeApi ? API.homeApi('along') : null; if (!u) { UI.toast('The home laptop is not reachable', 3500); return; }
    fetch(u, { method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' } }).then(function (r) { return r.json(); }).then(go).catch(function () { UI.toast('The home laptop is not reachable', 3500); });
  }
  // phone / web: while playing, give way as soon as the TV plays (checked every 5 s, one tiny request)
  var yieldT = 0;
  function watchTv() {
    clearInterval(yieldT); if (!(window.IS_ANDROID || window.PREVIEW) || st.local || (st.item && st.item.along)) return;
    var u = API.homeApi ? API.homeApi('dlbusy') : null; if (!u) return; u += '&me=' + (window.IS_ANDROID ? 'phone' : 'web');
    yieldT = setInterval(function () {
      if (!st.active) { clearInterval(yieldT); return; }
      fetch(u, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
        if (j && j.busy && j.busy.playing && st.active && !st.local) { clearInterval(yieldT); stop(); UI.ask('The TV took over the stream (' + j.busy.title + '). The TV always has priority. You can watch along with it.', ['Watch along', 'OK'], function (i) { if (i === 0) startAlong(); else UI.showCurrent(); }); }
      }).catch(function () {});
    }, 5000);
  }
  function playIndex(i) { if (!st.playlist || i < 0 || i >= st.playlist.length) return; play(st.playlist[i], st.playlist, i); }
  // phone: Rotate forces the other orientation while watching (like YouTube's full-screen button); leaving the player
  // hands rotation back to the phone's own setting
  var forcedOrient = false;
  function setOrient(m) { try { if (window.AndroidBridge && AndroidBridge.setOrientation) AndroidBridge.setOrientation(m); } catch (e) {} }
  function rotate() { setOrient(window.innerHeight > window.innerWidth ? 'landscape' : 'portrait'); forcedOrient = true; showUi(4000); }
  function releaseOrient() { if (forcedOrient) { forcedOrient = false; setOrient('auto'); } }
  // after the phone turns: the canvas changed size, so place the video again (preview box or full screen)
  function relayout() { if (!st.active) return; if (st.preview) { var r = UI.previewRect && UI.previewRect(); if (r) st.preview = r; } applyAspect(true); renderCtl(); }
  // connection drops at the provider: retry for about a minute (3+6+9+12+12+12 s) before showing an error
  var NET_TRIES = 7; function netDelay(n) { return [3000, 8000, 30000, 45000, 60000, 60000, 60000][Math.max(0, n - 1)] || 60000; }   // the provider keeps counting a dropped stream for ~45-60 s (one connection per account): quick retries only keep the slot busy
  function netMsg(n) { var d = netDelay(n); return d >= 30000 ? 'The provider still counts the previous stream, trying again in ' + Math.round(d / 1000) + ' s... (' + n + '/' + NET_TRIES + ')' : 'Connection hiccup, reconnecting... (' + n + '/' + NET_TRIES + ')'; }
  function stop(keepUiHidden) { nextUp(0);
    if (st.casting && window.CAST && window.CAST.active) { window.CAST.stop(); } st.casting = false;
    if (!keepUiHidden) releaseOrient();
    if (dvUi.open) { dvUi.open = false; renderDv(); }
    clearInterval(st.posTimer); clearTimeout(st.uiTimer); clearInterval(wa.timer);
    var a = av();
    var askAfter = !keepUiHidden && window.DL && st.item && st.item.kind !== 'live' && st.duration > 0 && st.time > st.duration - 120000 && DL.state(st.item) && DL.state(st.item).state === 'done' ? st.item : null;   // stopped during the end credits = finished
    if (a) { try { if (st.duration > 0 && st.time > 0) STORE.setPosition(posKey(), st.time, st.duration); } catch (e) {} try { a.stop(); } catch (e) {} try { a.close(); } catch (e) {} }
    menu.open = false; try { $('track-menu').classList.add('hidden'); } catch (e) {}
    clearTimeout(seekAcc.timer); seekAcc.target = -1; try { $('seek-marker').classList.add('hidden'); } catch (e) {}
    if (st.active) holdStream(false);
    if (window.DL && st.active) DL.stopped();   // resumes paused downloads 3 s later if nothing else started playing
    st.active = false; st.item = null; st.preview = null; msg(null); setPreviewText('', ''); if (el.sub) el.sub.textContent = '';
    var pe = document.getElementById('preview-epg'); if (pe) pe.textContent = '';
    el.ui.classList.add('hidden'); try { document.body.classList.remove('playing'); } catch (e) {}
    if (!keepUiHidden) UI.showCurrent();
    if (askAfter) askDelete(askAfter, function () {});
  }
  // finished watching a downloaded film/episode: offer to delete the copy (20 s without an answer = keep)
  function askDelete(it, then) {
    UI.ask('Finished: ' + it.name + '. Delete the download?', ['Delete', 'Keep'], function (i) { if (i === 0) { DL.remove(it); UI.toast('Download deleted'); } then(); }, 20000);
  }
  function togglePause(fromSync) { if (st.casting && window.CAST && window.CAST.active) { var cs = window.CAST.status || {}; window.CAST.control(cs.state === 'playing' ? 'pause' : 'play'); return; }
    var a = av(), nowPaused = false; var wasPaused = false; try { wasPaused = a.getState() === 'PAUSED'; } catch (e) {} if (!fromSync) alongSend({ cmd: wasPaused ? 'resume' : 'pause' }); setTimeout(function () { if (window.TV_STATE_CHANGED) window.TV_STATE_CHANGED(); }, 300); try { if (a.getState() === 'PAUSED') { a.play(); if (!touchUi()) UI.toast('Play'); } else { a.pause(); nowPaused = true; if (!touchUi()) UI.toast('Paused'); } } catch (e) {} showUi(nowPaused && touchUi() ? 0 : 3000); }
  // Seeking: Left/Right move a yellow marker on the timeline; the jump happens 700 ms after the last press.
  var seekAcc = { last: 0, mult: 1, dir: 0, target: -1, timer: 0 };
  function seek(deltaMs) {
    var a = av(); if (st.duration <= 0) return;
    var now = Date.now(), dir = deltaMs > 0 ? 1 : -1;
    seekAcc.mult = 1;
    seekAcc.last = now; seekAcc.dir = dir;
    var from = seekAcc.target >= 0 ? seekAcc.target : st.time;
    var t = Math.max(0, Math.min(st.duration - 1000, from + Math.round(deltaMs * seekAcc.mult)));
    seekAcc.target = t;
    var mk = $('seek-marker'); mk.classList.remove('hidden'); mk.style.left = (t / st.duration * 100) + '%';
    $('seek-time').textContent = fmt(t) + '  (' + (t >= st.time ? '+' : '-') + fmt(Math.abs(t - st.time)) + ')';
    var th = $('seek-thumb'); if (th) { var u = window.SEEK_THUMB ? window.SEEK_THUMB(t) : null; if (u) { th.src = u; th.classList.remove('hidden'); } else th.classList.add('hidden'); }
    showUi(4000);
    clearTimeout(seekAcc.timer);
    seekAcc.timer = setTimeout(function () { commitSeek(); }, 700);
  }
  function commitSeek() {
    var a = av(); if (seekAcc.target < 0) return;
    var t = seekAcc.target; seekAcc.target = -1; seekAcc.mult = 1;
    st.time = t; if (st.casting && window.CAST && window.CAST.active) { window.CAST.control('seek', t); renderCtl(); return; } try { a.seekTo(t); } catch (e) {}
    if (!seekAcc.fromSync) alongSend({ cmd: 'seekTo', pos: t }); seekAcc.fromSync = false; setTimeout(function () { if (window.TV_STATE_CHANGED) window.TV_STATE_CHANGED(); }, 300);
    el.cur.textContent = fmt(t); el.fill.style.width = Math.min(100, t / st.duration * 100) + '%';
    $('seek-marker').classList.add('hidden'); var th2 = $('seek-thumb'); if (th2) th2.classList.add('hidden'); showUi(2500);
  }
  function seekPercent(p) { if (st.duration <= 0) return; seekAcc.target = Math.round(st.duration * p / 10); seekAcc.last = 0; var mk = $('seek-marker'); mk.classList.remove('hidden'); mk.style.left = (p * 10) + '%'; $('seek-time').textContent = fmt(seekAcc.target); showUi(4000); clearTimeout(seekAcc.timer); seekAcc.timer = setTimeout(commitSeek, 500); }

  function onKey(e) {
    var k = e.keyCode;
    if (menu.open) return menuKey(k);
    if (castUi.open) return castKey(k);
    if (dvUi.open) return dvKey(k);
    var visible = !el.ui.classList.contains('hidden');
    if (k === 10009) { if (st.fromPreview && UI.previewRect()) { toPreview(UI.previewRect()); return true; } if (visible) { el.ui.classList.add('hidden'); clearTimeout(st.uiTimer); return true; } stop(); return true; }   // Back: to preview / hide bar / stop
    if (k === 413) { stop(); return true; }                                     // Stop key
    if (k === 10252 || k === 415 || k === 19) { togglePause(); return true; }   // play/pause keys
    if (k === 427 || k === 428) { if (st.playlist) playIndex(st.index + (k === 427 ? -1 : 1)); return true; }
    if (k === 412) { seek(-60000); return true; } if (k === 417) { seek(60000); return true; }
    if (k >= 48 && k <= 57 && st.duration > 0) { seekPercent(k - 48); return true; }
    if (k === 403) { cycleMode(); return true; } if (k === 404) { zoom(0.02); return true; } if (k === 405) { zoom(-0.02); return true; } if (k === 406 || k === 457) { openMenu(); return true; }   // colour keys still work if the remote has them
    if (!visible && nextUpOn && k === 13) { playIndex(st.index + 1); return true; }   // the 'Next episode' offer takes OK while the bar is hidden
    if (!visible) { showUi(5000); if (k === 13) return true; }                   // first press only shows the bar
    if (k === 38) { if (ctl.row === 0 && st.duration <= 0 && st.item && st.item.kind === 'live' && st.playlist) { playIndex(st.index - 1); return true; } ctl.row = ctl.row === 0 ? 1 : 0; renderCtl(); showUi(6000); return true; }
    if (k === 40) { if (ctl.row === 1) { ctl.row = 0; renderCtl(); showUi(6000); return true; } if (st.item && st.item.kind === 'live' && st.playlist) { playIndex(st.index + 1); return true; } ctl.row = 1; renderCtl(); showUi(6000); return true; }
    if (ctl.row === 1) {
      var b = buttons();
      if (k === 37) { ctl.idx = Math.max(0, ctl.idx - 1); renderCtl(); showUi(6000); return true; }
      if (k === 39) { ctl.idx = Math.min(b.length - 1, ctl.idx + 1); renderCtl(); showUi(6000); return true; }
      if (k === 13) { b[ctl.idx].run(); renderCtl(); showUi(6000); return true; }
      return true;
    }
    if (k === 37) { if (st.duration > 0) seek(-15000); return true; }
    if (k === 39) { if (st.duration > 0) seek(15000); return true; }
    if (k === 13) { if (seekAcc.target >= 0) { clearTimeout(seekAcc.timer); commitSeek(); return true; } togglePause(); renderCtl(); return true; }
    showUi(5000); return true;
  }
  function note() { try { return el.msg && !el.msg.classList.contains('hidden') ? el.msg.textContent : ''; } catch (e) { return ''; } }
  return { tvTakeover: tvTakeover, note: note, castStatus: function (cs) { if (!st.casting || !st.active) return; if (cs.dur > 0) { st.duration = cs.dur; el.dur.textContent = fmt(cs.dur); } st.time = cs.pos || 0; el.cur.textContent = fmt(st.time); if (st.duration > 0) el.fill.style.width = Math.min(100, st.time / st.duration * 100) + '%';
      msg(cs.state === 'buffering' ? 'Loading on the TV...' : cs.state === 'playing' ? null : cs.state === 'paused' ? 'Paused on the TV' : null);
      if (cs.state === 'idle' && cs.idleReason === 1 && st.duration > 0 && st.time > st.duration - 15000 && st.playlist && st.index + 1 < st.playlist.length) { var nx = st.playlist[st.index + 1], dv = window.CAST.active; st.index++; st.item = nx; st.time = 0; window.CAST.play(dv.id, nx.localUrl || (window.DL && DL.local(nx) ? DL.local(nx).url : API.streamUrl(nx.kind, nx.id, nx.ext, nx.name)), (nx.seriesName ? nx.seriesName + ' - ' : '') + nx.name, 0); el.title.textContent = nx.name; }   // finished: next episode on the TV
      renderCtl(); },
    castEnded: function () { if (st.casting) { st.casting = false; msg('Casting ended'); renderCtl(); } },
    watchAlong: function () { startAlong(); }, seekTo: function (ms) { if (st.active && st.duration > 0) { seekAcc.target = Math.max(0, Math.min(st.duration - 1000, ms)); seekAcc.last = 0; clearTimeout(seekAcc.timer); commitSeek(); } }, playlistNow: function () { return st.playlist; }, indexNow: function () { return st.index; }, item: function () { return st.item; }, status: function () { var p = false; try { p = av().getState() === 'PAUSED'; } catch (e) {} return { active: !!st.active, title: st.item ? (st.item.seriesName ? st.item.seriesName + '  ' : '') + st.item.name : '', time: st.time || 0, duration: st.duration || 0, paused: p }; }, togglePause: function () { if (st.active) togglePause(); }, castTo: function () { castMenu(); }, init: init, currentKey: function () { return st.active && st.item ? st.item.kind + ':' + st.item.id : null; }, relayout: relayout, play: play, stop: stop, onKey: onKey, isLocal: function () { return !!(st.active && st.local); }, isActive: function () { return st.active; }, isPreview: function () { return st.active && !!st.preview; }, previewOf: previewOf, tapButton: tapButton, tapMenu: tapMenu, tapMenuColumn: tapMenuColumn, dragSeek: dragSeek, endDragSeek: endDragSeek, nudge: nudge, centerAction: centerAction, tapSeek: tapSeek, tapScreen: tapScreen, fullscreen: fullscreen, toPreview: toPreview, setMode: setMode, MODES: MODES, MODE_LABEL: MODE_LABEL };
})();
