// Screens, focus handling, windowed lists.
var UI = (function () {
  function $(id) { return document.getElementById(id); }
  var stack = [];           // screen states
  var toastTimer = 0;
  function toast(t, ms) { var el = $('toast'); el.textContent = t; el.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.add('hidden'); }, ms || 2500); }
  function loading(on) { $('loader').classList.toggle('hidden', !on); }
  function hideScreens() { Array.prototype.forEach.call(document.querySelectorAll('.screen'), function (s) { s.classList.add('hidden'); }); }
  function current() { return stack[stack.length - 1]; }
  function showCurrent() { if (window.PLAYER && PLAYER.isActive && PLAYER.isActive() && !(PLAYER.isPreview && PLAYER.isPreview())) { hideScreens(); return; }   // never a screen over a full-screen video
    hideScreens(); var s = current(); if (s) { $(s.dom).classList.remove('hidden'); if (s.render) s.render(); if (s.dom === 'screen-home') { if (window.BG) BG.maybeSync(); if (window.STORE && STORE.maybeSync) STORE.maybeSync(); } } }
  function push(s) { stack.push(s); showCurrent(); }
  function pop() { if (stack.length > 1) { var s = stack.pop(); if (s.leave) s.leave(); showCurrent(); return true; } return false; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function clean(name) { return String(name || '').replace(/[\u00aa\u00b2\u00b3\u00b9\u00ba\u02b0-\u02ff\u1d00-\u1dff\u2070-\u209f\u2c60-\u2c7f\u25a0-\u25ff\u2600-\u27bf\u2b00-\u2bff\ua700-\ua71f]+/g, '').replace(/\s*[\/|]+\s*$/, '').replace(/\s{2,}/g, ' ').trim(); }
  function niceName(name) { return clean(name).replace(/^[A-Z0-9+]{1,6}(-[A-Z0-9+]{1,6}){0,2}\s+-\s+/, '').replace(/^[A-Z]{2,3}:\s*/, '').trim(); }

  // ---------- windowed rows (DOM reused while the window does not move) ----------
  function touchMode() { return !!(window.PREVIEW || window.IS_ANDROID); }
  function keepVisible(container) { var f = container.querySelector('.focused'); if (f && f.scrollIntoView) { var c = container.getBoundingClientRect(), r = f.getBoundingClientRect(); if (r.top < c.top || r.bottom > c.bottom) f.scrollIntoView({ block: 'nearest' }); } }
  // touch devices (web / phone): render the whole list into a natively scrollable box; the TV keeps the light windowed list
  // thin scroll bar for the TV's windowed lists (only the visible rows exist, so the browser cannot draw one)
  function sbar(container, offset, visible, total) {
    var b = container.__sb;
    if (!(total > visible)) { if (b && b.parentNode) b.parentNode.removeChild(b); return; }
    if (!b) { b = document.createElement('div'); b.className = 'sbar'; b.innerHTML = '<i></i>'; container.__sb = b; }
    if (b.parentNode !== container) container.appendChild(b);
    var h = Math.max(6, 100 * visible / total), t = (100 - h) * Math.min(1, offset / Math.max(1, total - visible));
    b.firstChild.style.height = h + '%'; b.firstChild.style.top = t + '%';
  }
  function sbarScroll(el) { if (touchMode() || !el) return; var lh = el.clientHeight || 1; sbar(el, el.scrollTop, lh, el.scrollHeight); var b = el.__sb; if (b && b.parentNode) { b.style.top = (el.scrollTop + 6) + 'px'; b.style.bottom = 'auto'; b.style.height = (lh - 12) + 'px'; } }   // this list really scrolls: keep the bar in view   // lists that really scroll (Downloads)
  function renderAll(container, html, sig, win, focusIdx, focused, isGrid) {
    if (win.sig === sig && container.firstChild) {
      var kids = isGrid ? container.firstChild.children : container.children;
      Array.prototype.forEach.call(kids, function (ch) { var i = Number(ch.getAttribute('data-i')); ch.classList.toggle('focused', focused && i === focusIdx); });
      if (focused) keepVisible(container); return;
    }
    var sameList = win.arrRef === arguments[7] && arguments[7]; var keep = container.scrollTop;
    win.sig = sig; win.arrRef = arguments[7]; container.innerHTML = html(); container.scrollTop = sameList ? keep : 0; if (focused && !sameList) keepVisible(container);
  }
  function renderRows(container, arr, focusIdx, win, visible, rowHtml, focused) {
    if (touchMode()) { return renderAll(container, function () { if (!arr.length) return '<div class="empty">Nothing here</div>'; var h = ''; for (var i = 0; i < arr.length; i++) { var x = rowHtml(arr[i], i, i === focusIdx && focused); h += x.indexOf('data-i=') > 0 ? x : x.replace(/^<div /, '<div data-i="' + i + '" '); } return h; }, 'T' + arr.length + ':' + (win.rev || 0) + ':' + (win.mark === undefined ? '' : win.mark), win, focusIdx, focused, false, arr); }
    if (focusIdx < win.offset) win.offset = focusIdx;
    if (focusIdx >= win.offset + visible) win.offset = focusIdx - visible + 1;
    if (win.offset < 0) win.offset = 0;
    var sig = arr.length + ':' + win.offset + ':' + visible + ':' + (win.rev || 0) + ':' + (win.mark === undefined ? '' : win.mark);   // mark = the row shown as active (chosen category); a change rebuilds the rows
    if (win.sig === sig && container.children.length) {
      Array.prototype.forEach.call(container.children, function (ch, j) { var i = win.offset + j; if (!arr[i] || ch === container.__sb) return; var m = /class="([^"]*)"/.exec(rowHtml(arr[i], i, focused && i === focusIdx)); if (m && ch.className !== m[1]) ch.className = m[1]; });   // same rows: refresh their classes (focused AND active) without rebuilding
      sbar(container, win.offset, visible, arr.length); return;
    }
    win.sig = sig;
    var html = '';
    if (!arr.length) html = '<div class="empty">Nothing here</div>';
    for (var i = win.offset; i < Math.min(arr.length, win.offset + visible); i++) html += rowHtml(arr[i], i, i === focusIdx && focused);
    container.innerHTML = html; sbar(container, win.offset, visible, arr.length);
  }
  function renderGrid(container, arr, focusIdx, win, cols, rowsVisible, cardHtml, focused) {
    if (touchMode()) { return renderAll(container, function () { if (!arr.length) return '<div class="empty">Nothing here</div>'; var h = ''; for (var i = 0; i < arr.length; i++) h += cardHtml(arr[i], i, i === focusIdx && focused).replace(/^<div /, '<div data-i="' + i + '" '); return '<div class="grid">' + h + '</div>'; }, 'G' + arr.length + ':' + (win.rev || 0), win, focusIdx, focused, true, arr); }
    var row = Math.floor(focusIdx / cols);
    if (row < win.offset) win.offset = row;
    if (row >= win.offset + rowsVisible) win.offset = row - rowsVisible + 1;
    if (win.offset < 0) win.offset = 0;
    var start = win.offset * cols, end = Math.min(arr.length, start + cols * rowsVisible);
    var sig = arr.length + ':' + win.offset + ':' + (win.rev || 0);
    if (win.sig === sig && container.firstChild && container.firstChild.children.length) {
      Array.prototype.forEach.call(container.firstChild.children, function (ch, j) { ch.classList.toggle('focused', focused && start + j === focusIdx); }); sbar(container, win.offset, rowsVisible, Math.ceil(arr.length / cols));
      return;
    }
    win.sig = sig;
    var html = '';
    if (!arr.length) html = '<div class="empty">Nothing here</div>';
    for (var i = start; i < end; i++) html += cardHtml(arr[i], i, i === focusIdx && focused);
    container.innerHTML = '<div class="grid">' + html + '</div>'; sbar(container, win.offset, rowsVisible, Math.ceil(arr.length / cols));
  }
  function bump(win) { win.rev = (win.rev || 0) + 1; }

  // ---------- item helpers ----------
  function itemOf(kind, raw) {
    if (kind === 'live') return { kind: 'live', id: raw.stream_id, name: niceName(raw.name), rawName: raw.name, icon: raw.stream_icon || '', raw: raw };
    if (kind === 'vod') return { kind: 'vod', id: raw.stream_id, name: niceName(raw.name), icon: raw.stream_icon || '', ext: raw.container_extension || 'mp4', raw: raw };
    return { kind: 'series', id: raw.series_id, name: niceName(raw.name), icon: raw.cover || '', raw: raw };
  }
  function favEntry(it, group, provider) { return { kind: it.kind, id: it.id, name: it.name, icon: it.icon, ext: it.ext || null, group: group || it.group || null, type: it.type || null, provider: provider || null }; }
  function rowHtml(it, i, f) {
    var fav = STORE.isFav(it.kind, it.id) ? '<span class="fav">&#9733;</span>' : '';
    var img = it.icon ? '<img referrerpolicy="no-referrer" loading="lazy" src="' + esc(it.icon) + '" onerror="this.style.visibility=\'hidden\';UI.badCover(\'' + it.kind + '\',\'' + esc(String(it.id)) + '\')">' : '<img style="visibility:hidden">';
    return '<div class="row' + (f ? ' focused' : '') + '" data-i="' + i + '">' + img + '<span class="label">' + esc(it.name) + '</span>' + fav + '</div>';
  }
  var coverLookups = {};
  function badCover(kind, id) {
    var c = current(); if (!c) return; var list = (c.items || []).concat(c.rows || []);
    var hit = null; list.forEach(function (it) { if (it && it.kind === kind && String(it.id) === String(id)) { it.icon = ''; hit = it; } });
    var favs = STORE.favs(), ch = false; favs.forEach(function (f) { if (f.kind === kind && String(f.id) === String(id) && f.icon) { f.icon = ''; ch = true; } }); if (ch) STORE.saveFavs(favs);
    if (hit && (kind === 'series' || kind === 'vod')) fixCover(hit, function () { if (c.iwin) bump(c.iwin); c.render(); });
  }
  function fixCover(it, done) {
    if (it.icon || coverLookups[it.kind + it.id]) return; coverLookups[it.kind + it.id] = true;
    var p = it.kind === 'series' ? API.seriesInfo(it.id).then(function (d) { return (d.info && (d.info.cover || d.info.backdrop_path && d.info.backdrop_path[0])) || ''; }) : API.vodInfo(it.id).then(function (d) { return (d.info && (d.info.cover_big || d.info.movie_image)) || ''; });
    p.then(function (url) { if (url) { it.icon = url; var favs = STORE.favs(); var hit = false; favs.forEach(function (f) { if (f.kind === it.kind && String(f.id) === String(it.id) && !f.icon) { f.icon = url; hit = true; } }); if (hit) STORE.saveFavs(favs); if (done) done(); } }).catch(function () {});
  }
  function cardHtml(it, i, f) {
    if (!it.icon && (it.kind === 'series' || it.kind === 'vod')) fixCover(it, function () { var c = current(); if (c && c.render) { if (c.iwin) bump(c.iwin); c.render(); } });
    var fav = STORE.isFav(it.kind, it.id) ? '<span class="fav">&#9733;</span>' : '';
    var img = it.icon ? '<img referrerpolicy="no-referrer" loading="lazy" src="' + esc(it.icon) + '" onerror="this.style.visibility=\'hidden\';UI.badCover(\'' + it.kind + '\',\'' + esc(String(it.id)) + '\')">' : '<img style="visibility:hidden">';
    return '<div class="card' + (f ? ' focused' : '') + '">' + img + '<div class="label">' + esc(it.name) + '</div>' + fav + '</div>';
  }
  function openItem(it, list, idx) {
    if (it.kind === 'live') PLAYER.play(it, list, idx);
    else if (it.kind === 'vod') showVodDetail(it);
    else showSeriesDetail(it);
  }

  // ---------- home ----------
  function home() {
    var tiles = Array.prototype.slice.call(document.querySelectorAll('#home-tiles .tile')).filter(function (t) { return !t.classList.contains('hidden'); });
    var s = { dom: 'screen-home', idx: 0, dlLive: true,
      render: function () { var ac = $('along-card'), tp = (window.IS_ANDROID || window.PREVIEW) && window.DL && DL.tvPlaying ? DL.tvPlaying() : null;   // big card on the right, only while the TV plays
        if (window.IS_ANDROID || window.PREVIEW) { tvLine(); tvPoll(); if (!tvPollT) tvPollT = setInterval(function () { var c = current(); if (c && c.dom === 'screen-home') tvPoll(); }, 20000); }
        if (ac) { ac.classList.toggle('hidden', !tp); if (!tp) s.card = false; if (tp) { var ti = tp.item || {}; $('ac-title').textContent = niceName(ti.seriesName || ti.name || tp.title); $('ac-sub').textContent = ti.seriesName ? niceName(ti.name || '') : ''; } ac.classList.toggle('focused', !!s.card); $('ac-btn').classList.toggle('focused', !!s.card);
          if (!ac.__wired) { ac.__wired = true; ac.addEventListener('click', function (ev) { ev.stopPropagation(); PLAYER.watchAlong(); }); } }
        tiles = Array.prototype.slice.call(document.querySelectorAll('#home-tiles .tile')).filter(function (t) { return !t.classList.contains('hidden'); }); tiles.forEach(function (t, i) { t.classList.toggle('focused', i === s.idx); }); renderRoute(); var rc = $('route-chip'); if (rc) rc.classList.toggle('focused', s.idx === -1); var ds = $('dl-sum'); if (ds && window.DL) ds.textContent = DL.summary(); },
      key: function (k) {
        if (k === 38) { if (s.idx === 0 && !window.PREVIEW) { s.idx = -1; } else if (s.idx === -1) { return true; } else s.idx = (s.idx + tiles.length - 1) % tiles.length; s.render(); return true; }   // TV: Up from the first tile = route switch
        if (k === 40) { s.idx = s.idx === -1 ? 0 : (s.idx + 1) % tiles.length; s.render(); return true; }
        if (k === 39 && $('along-card') && !$('along-card').classList.contains('hidden')) { s.card = true; s.render(); return true; }   // Right: the 'watch along' card
        if (s.card) { if (k === 37 || k === 10009) { s.card = false; s.render(); return true; } if (k === 13) { PLAYER.watchAlong(); return true; } return true; }
        if (k === 13 && s.idx === -1) { toggleRoute(); return true; }
        if (k === 13) { var a = tiles[s.idx].getAttribute('data-action'); if (a === 'route') { toggleRoute(); return true; } if (a === 'settings') settings(); else if (a === 'search') searchScreen(); else if (a === 'downloads') downloads(); else if (a === 'favs') favourites(); else if (a === 'withtv') watchWithTv(); else browse(a); return true; }
        return false;
      } };
    return s;
  }

  // ---------- where the streams come from (shown on the home screen; switchable on the phone) ----------
  function routeText() {
    if (window.IS_ANDROID || !window.PREVIEW) return CONFIG.viaHome ? { chip: 'Via home laptop (Bulgaria)', home: true, toggle: true } : { chip: 'Direct from this network', home: false, toggle: true };
    if (window.PREVIEW) return { chip: 'Route: home laptop (Bulgaria)', home: true };
    return { chip: 'Route: direct (home network)', home: true };
  }
  function renderRoute() {
    var r = routeText(), chip = $('route-chip'); if (!chip) return; $('route-label').textContent = r.chip; chip.classList.toggle('home', !!r.home);
    chip.querySelector('.rt-switch').classList.toggle('hidden', !r.toggle);
    if (r.toggle && !chip.__wired) { chip.__wired = true; chip.addEventListener('click', function (e) { e.stopPropagation(); toggleRoute(); }); }
  }
  function toggleRoute() {
    if (window.PREVIEW && !window.IS_ANDROID) return;   // the web always goes through the laptop
    if (PLAYER.isActive()) PLAYER.stop(true);
    CONFIG.viaHome = !CONFIG.viaHome; saveConfig(CONFIG); API.clearCache();
    window.loadHomeBase().then(function () {
      if (CONFIG.viaHome && !window.HOME_BASE) { CONFIG.viaHome = false; saveConfig(CONFIG); toast('Home laptop not reachable, staying direct', 4000); }
      else toast(CONFIG.viaHome ? 'Now streaming through the home laptop (Bulgarian address)' : 'Now streaming directly from this network', 3500);
      renderRoute();
    });
  }
  window.renderRoute = renderRoute;
  // ---------- Watch what the TV is watching (web / phone through the home laptop) ----------
  function watchWithTv() {
    loading(true);
    API.now().then(function (d) {
      loading(false);
      if (!d.tv) { toast('The TV is not watching live TV right now', 4000); return; }
      PLAYER.play({ kind: 'live', id: d.tv.id, name: d.tv.name || ('Channel ' + d.tv.id), icon: '' });
      toast('Same channel as the TV: ' + (d.tv.name || d.tv.id), 3500);
    }).catch(function (e) { loading(false); toast('Cannot ask the laptop: ' + e.message, 4000); });
  }
  // ---------- browse: live = countries > providers > channels; vod/series = categories > items ----------
  var TITLE = { live: 'Live TV', vod: 'Movies', series: 'Series' };
  // Preview video box in 1920x1080 app coordinates: must match .preview-video position (screen padding 80, list 600 + gap 30, header ~ 50+60+20).
  // Preview video box in 1920x1080 design px: screen padding 80 + list 600 + gap 30 = 710; header 50 + 60 + 30 = 140. Must match .preview-video.
  var PREVIEW_FALLBACK = { x: 710, y: 140, w: 1130, h: 636 };
  // the video follows the real position of the preview box (design px), so layout changes can never misplace it
  function boxRect() {
    var b = document.querySelector('.preview-video'), app = document.getElementById('app'); if (!b || !app) return PREVIEW_FALLBACK;
    var r = b.getBoundingClientRect(), a = app.getBoundingClientRect(); var sc = a.width / (window.DESIGN_W || 1920) || 1;
    if (r.width < 10 || r.height < 10) return PREVIEW_FALLBACK;
    return { x: Math.round((r.left - a.left) / sc), y: Math.round((r.top - a.top) / sc), w: Math.round(r.width / sc), h: Math.round(r.height / sc) };
  }
  function previewRect() { var c = current(); return c && c.kind === 'live' && c.previewing ? boxRect() : null; }
  function previewButtons(s, item, group, provider, removeOnly) {
    var fav = STORE.isFav('live', item.id);
    return [{ label: 'Full screen', run: function () { PLAYER.fullscreen(); } },
            { label: fav ? '\u2605 Remove from My channels' : '\u2606 Add to My channels', run: function () { var on = STORE.toggleFav(favEntry(item, group, provider)); toast(on ? 'Added to My channels' : 'Removed from My channels'); if (removeOnly) removeOnly(); else { bump(s.iwin); s.render(); } } }];
  }
  function renderPreviewButtons(btns, focusIdx, focused) {
    $('preview-btns').innerHTML = btns.map(function (b, i) { return '<div class="btn' + (focused && i === focusIdx ? ' focused' : '') + '">' + esc(b.label) + '</div>'; }).join('');
  }
  function countryOf(name) { var m = /^\s*([A-Z0-9]{2,4})\s*\|/.exec(name); return m ? m[1] : 'OTHER'; }
  function providerName(name) { return clean(name).replace(/^\s*[A-Z0-9]{2,4}\s*\|\s*/, ''); }
  function browse(kind) {
    var live = kind === 'live', grid = !live, COLS = 5, ROWS = 2, VIS = 11;
    var s = { dom: 'screen-browse', kind: kind, allCats: [], countries: [], cats: [], items: [], pane: live ? 'countries' : 'cats', coi: 0, ci: 0, ii: 0, cowin: { offset: 0 }, cwin: { offset: 0 }, iwin: { offset: 0 }, loadedCat: null, timer: 0, showAll: false };
    function buildCountries() {
      var seen = {}, list = [];
      s.allCats.forEach(function (c) { var code = countryOf(c.category_name); if (!seen[code]) { seen[code] = true; list.push(code); } });
      var pref = PREFERRED_COUNTRIES.filter(function (c) { return seen[c]; });
      var rest = list.filter(function (c) { return PREFERRED_COUNTRIES.indexOf(c) < 0; }).sort(function (a, b) { return (COUNTRY_NAMES[a] || a).localeCompare(COUNTRY_NAMES[b] || b); });
      s.countries = ['__search', '__recent'].concat(s.showAll ? pref.concat(rest) : pref).concat([s.showAll ? '__less' : '__more']);
      bump(s.cowin);
    }
    function selectCountry() {
      var code = s.countries[s.coi]; if (!code) return;
      s.catsFor = code;
      if (code === '__more' || code === '__less' || code === '__search') { s.cats = []; s.items = []; s.loadedCat = null; bump(s.cwin); bump(s.iwin); return; }
      if (code === '__recent') { s.cats = [{ category_id: '__recent', category_name: 'Recently watched' }]; }
      else s.cats = s.allCats.filter(function (c) { return countryOf(c.category_name) === code; });
      s.ci = 0; s.cwin.offset = 0; bump(s.cwin); s.items = []; s.loadedCat = null; bump(s.iwin);
      if (code === '__recent') s.loadItems();
    }
    s.render = function () {
      $('browse-title').textContent = TITLE[kind] + (live && s.countries[s.coi] ? '  >  ' + (s.countries[s.coi] === '__recent' ? 'Recent' : /^__/.test(s.countries[s.coi]) ? '' : (COUNTRY_NAMES[s.countries[s.coi]] || s.countries[s.coi])) : '');
      $('browse-tabs').classList.add('hidden');
      $('browse-count').textContent = s.items.length ? s.items.length + (s.items.length === 1 ? ' item' : ' items') : '';
      $('browse-hint').textContent = live ? 'Left/Right: columns   OK: preview, OK again: full screen   Back: up' : 'Left/Right: columns   OK: open   Back: up';
      var pv = !!(live && s.previewing);
      $('screen-browse').classList.toggle('previewing', pv);
      $('preview-panel').classList.toggle('hidden', !pv);
      $('col-countries').classList.toggle('hidden', !live || pv);
      $('col-cats').classList.toggle('hidden', pv);
      $('col-items').classList.remove('hidden');
      $('col-cats').classList.toggle('compact', live); $('col-items').classList.toggle('compact', live);
      $('col-countries').classList.toggle('active', s.pane === 'countries'); $('col-cats').classList.toggle('active', s.pane === 'cats'); $('col-items').classList.toggle('active', s.pane === 'items');
      $('item-title').classList.remove('hidden'); $('cat-title').textContent = live ? 'Provider' : 'Category'; var curCat = !live && s.cats[s.ci] && s.loadedCat === s.cats[s.ci].category_id && !/^__/.test(String(s.loadedCat)) ? clean(s.cats[s.ci].category_name) : '';
      $('item-title').textContent = live ? 'Channels' : (curCat ? curCat + '  \u00b7  ' : '') + (kind === 'vod' ? 'Movies' : 'Series');   // the chosen category stays named above the list (the phone hides the left column)
      s.cowin.mark = s.pane !== 'countries' ? s.coi : -1; s.cwin.mark = s.pane === 'items' ? s.ci : -1;
      if (live) renderRows($('country-list'), s.countries, s.coi, s.cowin, 13, function (c, i, f) { return '<div class="row' + (f ? ' focused' : '') + (i === s.coi && s.pane !== 'countries' ? ' active' : '') + '"><span class="label">' + esc(c === '__search' ? '\ud83d\udd0d Search channels' : c === '__recent' ? '\u21bb Recent' : c === '__more' ? '+ More countries' : c === '__less' ? '\u2212 Fewer countries' : (COUNTRY_NAMES[c] || c)) + '</span></div>'; }, s.pane === 'countries');
      renderRows($('cat-list'), s.cats, s.ci, s.cwin, live ? 13 : VIS, function (c, i, f) { return '<div class="row' + (f ? ' focused' : '') + (i === s.ci && s.pane === 'items' ? ' active' : '') + '"><span class="label">' + esc(live ? providerName(c.category_name) : clean(c.category_name)) + '</span></div>'; }, s.pane === 'cats');
      if (live && s.previewing && PLAYER.isPreview()) { var pit = s.items[s.pi >= 0 ? s.pi : s.ii]; if (pit) renderPreviewButtons(previewButtons(s, pit, COUNTRY_NAMES[s.countries[s.coi]] || s.countries[s.coi], s.cats[s.ci] ? s.cats[s.ci].category_name : null), s.pbi || 0, s.pane === 'pbtns'); }
      if (live && s.pane === 'countries' && !s.items.length) { $('item-list').innerHTML = '<div class="empty">Choose a country, then a provider</div>'; s.iwin.sig = null; }
      else if (grid) renderGrid($('item-list'), s.items, s.ii, s.iwin, COLS, ROWS, cardHtml, s.pane === 'items');
      else renderRows($('item-list'), s.items, s.ii, s.iwin, 13, rowHtml, s.pane === 'items');
    };
    s.loadItems = function (cb) {
      var c = s.cats[s.ci]; if (!c) return; if (s.loadedCat === c.category_id) { if (cb) cb(); return; }
      var id = c.category_id;
      if (id === '__continue') { s.items = s.contItems || []; s.loadedCat = id; s.ii = 0; s.iwin.offset = 0; bump(s.iwin); s.render(); if (cb) cb(); return; }
      if (id === '__recent') { s.items = STORE.recents().filter(function (r) { return r.kind === 'live'; }).map(function (r) { return { kind: 'live', id: r.id, name: r.name, icon: r.icon || '' }; }); s.loadedCat = id; s.ii = 0; s.iwin.offset = 0; bump(s.iwin); s.render(); if (cb) cb(); return; }
      if (id === '__favs') { s.items = STORE.favs().filter(function (f) { return f.kind === kind; }).map(function (f) { return { kind: kind, id: f.id, name: f.name, icon: f.icon || '', ext: f.ext || 'mp4', raw: {} }; }); s.loadedCat = id; s.ii = 0; s.iwin.offset = 0; bump(s.iwin); s.render(); if (cb) cb(); return; }
      loading(true);
      API.items(kind, id).then(function (arr) {
        if (!s.cats[s.ci] || s.cats[s.ci].category_id !== id) return;
        s.items = arr.map(function (r) { return itemOf(kind, r); }); s.loadedCat = id; s.ii = 0; s.iwin.offset = 0; bump(s.iwin); loading(false); s.render(); if (cb) cb();
      }).catch(function (e) { loading(false); toast('Could not load: ' + e.message); });
    };
    function move(field, n, d) { s[field] = Math.max(0, Math.min(n - 1, s[field] + d)); }
    s.key = function (k) {
      if (k === 406 && live) { s.showAll = !s.showAll; buildCountries(); s.coi = 0; selectCountry(); s.render(); return true; }
      if (s.pane === 'countries') {
        if (k === 38 || k === 40 || k === 427 || k === 428) { move('coi', s.countries.length, k === 38 ? -1 : k === 40 ? 1 : k === 427 ? -13 : 13); selectCountry(); s.render(); return true; }
        if (k === 13 && s.countries[s.coi] === '__search') { searchScreen('live'); return true; }
        if (k === 13 || k === 39) { var cc = s.countries[s.coi]; if (s.catsFor !== cc && cc !== '__more' && cc !== '__less') selectCountry();   /* a tap jumps straight to a country: load its providers first */
          if (cc === '__more' || cc === '__less') { s.showAll = !s.showAll; buildCountries(); s.coi = s.showAll ? s.coi : 1; if (s.coi >= s.countries.length) s.coi = s.countries.length - 1; selectCountry(); s.render(); return true; } if (s.cats.length) { s.pane = 'cats'; s.render(); s.loadItems(); } return true; }
        if (k === 10009) { pop(); return true; }
        return false;
      }
      if (s.pane === 'cats') {
        if (k === 38 || k === 40 || k === 427 || k === 428) { move('ci', s.cats.length, k === 38 ? -1 : k === 40 ? 1 : k === 427 ? -VIS : VIS); s.render(); clearTimeout(s.timer); if (s.cats[s.ci] && s.cats[s.ci].category_id === '__search') return true; s.timer = setTimeout(function () { s.loadItems(); }, 300); return true; }
        if (k === 13 && s.cats[s.ci] && s.cats[s.ci].category_id === '__search') { searchScreen(kind); return true; }
        if (k === 13 || k === 39) { clearTimeout(s.timer); s.loadItems(function () { if (s.items.length) { s.pane = 'items'; s.render(); } }); return true; }
        if (k === 37 && live) { s.pane = 'countries'; s.render(); return true; }
        if (k === 10009) { if (live) { s.pane = 'countries'; s.render(); } else pop(); return true; }
        return false;
      }
      var n = s.items.length;
      if (s.pane === 'pbtns') {
        var pb = previewButtons(s, s.items[s.pi], COUNTRY_NAMES[s.countries[s.coi]] || s.countries[s.coi], s.cats[s.ci] ? s.cats[s.ci].category_name : null);
        if (k === 37) { s.pane = 'items'; s.render(); return true; }
        if (k === 38) { s.pbi = Math.max(0, (s.pbi || 0) - 1); s.render(); return true; }
        if (k === 40) { s.pbi = Math.min(pb.length - 1, (s.pbi || 0) + 1); s.render(); return true; }
        if (k === 13) { pb[s.pbi || 0].run(); return true; }
        if (k === 10009) { s.pane = 'items'; s.render(); return true; }
        return true;
      }
      if (k === 39 && live && s.previewing && PLAYER.isPreview()) { s.pane = 'pbtns'; s.pbi = 0; s.render(); return true; }
      if (grid) {
        if (k === 37) { if (s.ii % COLS === 0) s.pane = 'cats'; else s.ii--; s.render(); return true; }
        if (k === 39) { if (s.ii + 1 < n) s.ii++; s.render(); return true; }
        if (k === 38) { if (s.ii - COLS >= 0) s.ii -= COLS; s.render(); return true; }
        if (k === 40) { if (s.ii + COLS < n) s.ii += COLS; else s.ii = n - 1; s.render(); return true; }
        if (k === 427 || k === 428) { move('ii', n, k === 427 ? -COLS * ROWS : COLS * ROWS); s.render(); return true; }
      } else {
        if (k === 37) { if (s.previewing) return true; s.pane = 'cats'; s.render(); return true; }
        if (k === 38 || k === 40 || k === 427 || k === 428) { move('ii', n, k === 38 ? -1 : k === 40 ? 1 : k === 427 ? -13 : 13); s.render(); return true; }
      }
      if (k === 13 && n && live) {
        var ch = s.items[s.ii];
        if (PLAYER.previewOf(ch)) { PLAYER.fullscreen(); return true; }
        s.previewing = true; s.pi = s.ii; s.pbi = 0; s.render(); PLAYER.play(ch, s.items, s.ii, { preview: boxRect() }); s.render(); return true;
      }
      if (k === 13 && n) { openItem(s.items[s.ii], s.items, s.ii); return true; }
      if (k === 405 && n) { var it = s.items[s.ii]; var on = STORE.toggleFav(favEntry(it, live ? (COUNTRY_NAMES[s.countries[s.coi]] || s.countries[s.coi]) : (kind === 'vod' ? 'Movies' : 'Series'), live && s.cats[s.ci] ? s.cats[s.ci].category_name : null)); toast(on ? 'Added to favourites' : 'Removed from favourites'); bump(s.iwin); s.render(); return true; }
      if (k === 10009) { if (s.previewing) { PLAYER.stop(true); s.previewing = false; s.render(); return true; } s.pane = 'cats'; s.render(); return true; }
      return false;
    };
    s.leave = function () { if (s.previewing) { PLAYER.stop(true); s.previewing = false; } };
    loading(true);
    API.categories(kind).then(function (cats) {
      s.allCats = cats || []; loading(false);
      if (live) { buildCountries(); s.coi = 1; selectCountry(); s.render(); }
      else {
        var cont = STORE.recents().filter(function (r) { return r.kind === kind || (kind === 'series' && r.kind === 'series'); });
        var seen = {}, contItems = [];
        cont.forEach(function (r) { var key = kind === 'series' && r.seriesId ? 'S' + r.seriesId : String(r.id); if (seen[key]) return; seen[key] = true;
          if (kind === 'series' && r.seriesId) contItems.push({ kind: 'series', id: r.seriesId, name: r.seriesName || r.name, icon: r.icon || '', raw: {} });
          else contItems.push({ kind: kind, id: r.id, name: r.name, icon: r.icon || '', ext: r.ext || 'mp4', raw: {} }); });
        var favCount = STORE.favs().filter(function (f) { return f.kind === kind; }).length;
        s.cats = [{ category_id: '__search', category_name: '\ud83d\udd0d Search ' + (kind === 'vod' ? 'movies' : 'series') }].concat(contItems.length ? [{ category_id: '__continue', category_name: 'Continue watching (' + contItems.length + ')' }] : []).concat(favCount ? [{ category_id: '__favs', category_name: 'Favourites (' + favCount + ')' }] : []).concat(s.allCats);
        s.contItems = contItems; s.ci = 1; s.render();
        if (contItems.length) { s.loadItems(function () { s.pane = 'items'; s.ii = 0; s.render(); }); } else s.loadItems();
      }
    }).catch(function (e) { loading(false); toast('Could not load categories: ' + e.message); });
    push(s);
  }

  // ---------- flat list with group headers (favourites / recent) ----------
  function flat(title, entries, grouped) {
    var rows = [], lastGroup = null;
    entries.forEach(function (e) {
      var g = e.group || (e.kind === 'live' ? 'Channels' : e.kind === 'vod' ? 'Movies' : 'Series');
      if (grouped && g !== lastGroup) { rows.push({ header: g }); lastGroup = g; }
      rows.push({ kind: e.kind, id: e.id, name: e.name, icon: e.icon || '', ext: e.ext || 'mp4', aspectKey: e.aspectKey || null, group: g });
    });
    var first = 0; while (first < rows.length && rows[first].header) first++;
    var s = { dom: 'screen-browse', kind: 'live', ii: first, iwin: { offset: 0 }, VIS: 13, previewing: false };
    var live = rows.filter(function (r) { return !r.header && r.kind === 'live'; });
    s.render = function () {
      $('browse-title').textContent = title; $('browse-count').textContent = ' ' + live.length + ' channels'; $('browse-hint').textContent = 'Yellow: remove   Back: home';
      $('col-countries').classList.add('hidden'); $('col-cats').classList.add('hidden'); $('col-items').classList.add('compact'); $('col-items').classList.add('active'); $('item-title').textContent = ''; $('item-title').classList.add('hidden');
      $('screen-browse').classList.toggle('previewing', !!s.previewing); $('preview-panel').classList.toggle('hidden', !s.previewing);
      renderRows($('item-list'), rows, s.ii, s.iwin, s.VIS, function (r, i, f) { if (r.header) return '<div class="hdr">' + esc(r.header) + '</div>'; return rowHtml(r, i, f); }, true);
    };
    function step(d) { var i = s.ii, n = rows.length; do { i += d; } while (i >= 0 && i < n && rows[i].header); if (i < 0 || i >= n) return; s.ii = i; }
    s.key = function (k) {
      if (k === 38 || k === 40) { step(k === 38 ? -1 : 1); s.render(); return true; }
      if (k === 427 || k === 428) { for (var j = 0; j < 10; j++) step(k === 427 ? -1 : 1); s.render(); return true; }
      if (k === 13 && rows.length) { var r = rows[s.ii]; if (r.header) return true; if (r.kind === 'live') { if (PLAYER.previewOf(r)) { PLAYER.fullscreen(); return true; } s.previewing = true; s.render(); PLAYER.play(r, live, live.indexOf(r), { preview: boxRect() }); return true; } openItem(r, live, live.indexOf(r)); return true; }
      if (k === 405 && rows.length && !rows[s.ii].header) { STORE.toggleFav(favEntry(rows[s.ii], rows[s.ii].group)); toast('Removed from favourites'); pop(); flat(title, STORE.favs(), true); return true; }
      if (k === 10009) { if (s.previewing) { PLAYER.stop(true); s.previewing = false; s.render(); return true; } pop(); return true; }
      return false;
    };
    s.leave = function () { if (s.previewing) { PLAYER.stop(true); s.previewing = false; } };
    push(s);
  }

  // ---------- My channels: Sport | TV tabs, grouped by country, preview on the right ----------
  function favourites() {
    var s = { dom: 'screen-browse', kind: 'live', tab: 'sport', rows: [], live: [], ii: 0, iwin: { offset: 0 }, VIS: 13, previewing: false, pane: 'list', prow: null, pbi: 0 };
    function build() {
      var favs = STORE.favs().filter(function (f) { return f.kind === 'live' && (f.type || 'tv') === s.tab; });
      var byGroup = {}, order = [];
      favs.forEach(function (f) { var g = f.group || 'Channels'; if (!byGroup[g]) { byGroup[g] = []; order.push(g); } byGroup[g].push(f); });
      s.rows = []; s.live = [];
      order.forEach(function (g) { s.rows.push({ header: g }); byGroup[g].forEach(function (f) { var r = { kind: 'live', id: f.id, name: f.name, icon: f.icon || '', group: g, type: f.type }; s.rows.push(r); s.live.push(r); }); });
      s.ii = 0; while (s.ii < s.rows.length && s.rows[s.ii].header) s.ii++;
      s.iwin.offset = 0; bump(s.iwin);
    }
    s.render = function () {
      $('browse-title').textContent = 'My channels';
      $('browse-tabs').classList.remove('hidden'); $('browse-tabs').innerHTML = '<span class="' + (s.tab === 'sport' ? 'on' : '') + '">Sport</span><span class="' + (s.tab === 'tv' ? 'on' : '') + '">TV</span>';
      $('browse-count').textContent = s.live.length + ' channels'; $('browse-hint').textContent = 'Left/Right: Sport / TV   OK: preview   Back: home';
      $('col-countries').classList.add('hidden'); $('col-cats').classList.add('hidden'); $('col-items').classList.add('compact'); $('col-items').classList.add('active'); $('item-title').textContent = ''; $('item-title').classList.add('hidden');
      $('screen-browse').classList.toggle('previewing', !!s.previewing); $('preview-panel').classList.toggle('hidden', !s.previewing);
      renderRows($('item-list'), s.rows, s.ii, s.iwin, s.VIS, function (r, i, f) { if (r.header) return '<div class="hdr">' + esc(r.header) + '</div>'; return rowHtml(r, i, f); }, s.pane !== 'pbtns');
      if (s.previewing && PLAYER.isPreview() && s.prow) renderPreviewButtons(previewButtons(s, s.prow, s.prow.group, null, function () { build(); s.render(); }), s.pbi || 0, s.pane === 'pbtns');
    };
    function step(d) { var i = s.ii, n = s.rows.length; do { i += d; } while (i >= 0 && i < n && s.rows[i].header); if (i < 0 || i >= n) return; s.ii = i; }
    s.key = function (k) {
      if (s.pane === 'pbtns') {
        var pb = previewButtons(s, s.prow, s.prow.group, null, function () { build(); s.render(); });
        if (k === 37 || k === 10009) { s.pane = 'list'; s.render(); return true; }
        if (k === 38) { s.pbi = Math.max(0, (s.pbi || 0) - 1); s.render(); return true; }
        if (k === 40) { s.pbi = Math.min(pb.length - 1, (s.pbi || 0) + 1); s.render(); return true; }
        if (k === 13) { pb[s.pbi || 0].run(); return true; }
        return true;
      }
      if (k === 39 && s.previewing && PLAYER.isPreview()) { s.pane = 'pbtns'; s.pbi = 0; s.render(); return true; }
      if (k === 37 || k === 39) { if (s.previewing) { PLAYER.stop(true); s.previewing = false; } s.tab = s.tab === 'sport' ? 'tv' : 'sport'; build(); s.render(); return true; }
      if (k === 38 || k === 40) { step(k === 38 ? -1 : 1); s.render(); return true; }
      if (k === 427 || k === 428) { for (var j = 0; j < 10; j++) step(k === 427 ? -1 : 1); s.render(); return true; }
      if (k === 13 && s.rows.length) { var r = s.rows[s.ii]; if (r.header) return true; if (PLAYER.previewOf(r)) { PLAYER.fullscreen(); return true; } s.previewing = true; s.prow = r; s.pbi = 0; s.render(); PLAYER.play(r, s.live, s.live.indexOf(r), { preview: boxRect() }); s.render(); return true; }
      if (k === 405 && s.rows.length && !s.rows[s.ii].header) { STORE.toggleFav(favEntry(s.rows[s.ii])); toast('Removed from My channels'); var keep = s.ii; build(); s.ii = Math.min(keep, s.rows.length - 1); while (s.ii > 0 && s.rows[s.ii] && s.rows[s.ii].header) s.ii--; s.render(); return true; }
      if (k === 10009) { if (s.previewing) { PLAYER.stop(true); s.previewing = false; s.render(); return true; } pop(); return true; }
      return false;
    };
    s.leave = function () { if (s.previewing) { PLAYER.stop(true); s.previewing = false; } };
    build(); push(s);
    // fetch the shared favourites now (added from another device a moment ago) and redraw if they changed
    if (STORE.sync) STORE.sync().then(function () { if (current() === s) { var n0 = s.rows.length; build(); if (s.rows.length !== n0) s.render(); } }).catch(function () {});
  }

  // ---------- details ----------
  function detailBase(it) {
    var s = { dom: 'screen-detail', it: it, actions: [], ai: 0, eps: [], ei: 0, ewin: { offset: 0 }, pane: 'actions', ecol: 0, dlConfirm: null, dlLive: true };
    s.render = function () {
      $('detail-cover').src = it.icon || ''; $('detail-title').textContent = it.name;
      $('detail-actions').innerHTML = s.actions.map(function (a, i) { return '<div class="btn' + (i === s.ai && s.pane === 'actions' ? ' focused' : '') + '">' + esc(a.label()) + '</div>'; }).join('');
      var showDl = !!(window.DL && DL.available());
      var sea = $('detail-seasons'), multi = !!(s.seasons && s.seasons.length > 1);
      $('screen-detail').classList.toggle('series-mode', !!s.seasons);
      sea.classList.toggle('hidden', !multi);
      if (multi) sea.innerHTML = s.seasons.map(function (sn, i) { return '<span class="season' + (i === s.si ? ' on' : '') + (i === s.si && s.pane === 'seasons' ? ' focused' : '') + '" data-i="' + i + '">Season ' + esc(sn) + '</span>'; }).join('');
      if (multi && !touchMode()) { var sf = sea.querySelector('.on'); if (sf && sf.scrollIntoView) sf.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
      var pe = s.seasons ? s.eps[s.ei] : null, pv = $('ep-preview');
      pv.classList.toggle('hidden', !pe);
      if (pe) { var im = $('ep-img'); if (im.getAttribute('src') !== (pe.still || it.icon || '')) { im.style.visibility = ''; im.onerror = function () { this.style.visibility = 'hidden'; }; im.src = pe.still || it.icon || ''; }
        $('ep-title').textContent = pe.name; $('ep-meta').textContent = [pe.duration, pe.air].filter(Boolean).join('  ·  '); $('ep-plot').textContent = pe.plot || ''; }
      renderRows($('detail-episodes'), s.eps, s.ei, s.ewin, s.seasons ? (touchMode() ? 30 : 8) : 5, function (e, i, f) {
        var d = window.DL ? DL.state(e) : null, ctl = (showDl || d) ? '<span class="rdl' + (f && s.ecol === 1 ? ' focused' : '') + (d && d.state === 'done' ? ' on' : '') + '">' + esc(epDlText(e, s)) + '</span>' : '';
        return '<div class="row' + (f && s.ecol !== 1 ? ' focused' : '') + (f && s.ecol === 1 ? ' active' : '') + '"><span class="label">' + esc(e.label || e.name) + '</span>' + ctl + '</div>'; }, s.pane === 'eps');
      $('detail-episodes').classList.toggle('hidden', !s.eps.length);
      bump(s.ewin);
    };
    s.key = function (k) {
      if (k === 10009) { pop(); return true; }
      if (s.pane === 'actions') {
        if (k === 37) { s.ai = Math.max(0, s.ai - 1); s.dlConfirm = null; s.render(); return true; }
        if (k === 39) { s.ai = Math.min(s.actions.length - 1, s.ai + 1); s.dlConfirm = null; s.render(); return true; }
        if (k === 40 && s.seasons && s.seasons.length > 1) { s.pane = 'seasons'; s.dlConfirm = null; s.render(); return true; }
        if (k === 40 && s.eps.length) { s.pane = 'eps'; s.dlConfirm = null; s.render(); return true; }
        if (k === 13) { s.actions[s.ai].run(); return true; }
        return false;
      }
      if (s.pane === 'seasons') {
        if (k === 37 || k === 39) { s.pickSeason(Math.max(0, Math.min(s.seasons.length - 1, s.si + (k === 37 ? -1 : 1)))); return true; }
        if (k === 38) { s.pane = 'actions'; s.render(); return true; }
        if (k === 40 || k === 13) { if (s.eps.length) { s.pane = 'eps'; s.render(); } return true; }
        return true;
      }
      if (k === 38) { s.dlConfirm = null; if (s.ei === 0) { s.pane = s.seasons && s.seasons.length > 1 ? 'seasons' : 'actions'; s.ecol = 0; } else s.ei--; s.render(); return true; }
      if (k === 40) { s.dlConfirm = null; s.ei = Math.min(s.eps.length - 1, s.ei + 1); s.render(); return true; }
      if (k === 39 && window.DL && (DL.available() || DL.state(s.eps[s.ei]))) { s.ecol = 1; s.render(); return true; }
      if (k === 37 && s.ecol === 1) { s.ecol = 0; s.dlConfirm = null; s.render(); return true; }
      if (k === 13 && s.ecol === 1) { dlToggle(s.eps[s.ei], s); s.render(); return true; }
      if (k === 427 || k === 428) { s.ei = Math.max(0, Math.min(s.eps.length - 1, s.ei + (k === 427 ? -5 : 5))); s.render(); return true; }
      if (k === 13) { var all = s.all || s.eps, ep = s.eps[s.ei]; PLAYER.play(ep, all, all.indexOf(ep)); return true; }   // the whole series is the playlist: Next works across seasons
      return false;
    };
    s.pickSeason = function (i) { if (!s.seasons) return; s.si = i; var sn = s.seasons[i]; s.eps = s.all.filter(function (e) { return e.season === sn; }); s.ei = 0; s.ewin.offset = 0; s.dlConfirm = null; s.render(); };
    return s;
  }
  // ---------- downloads (Download button, episode control, Downloads screen) ----------
  function dlKey(it) { return it.kind + ':' + it.id; }
  function dlLabel(it, s) {
    var d = window.DL ? DL.state(it) : null;
    if (s.dlConfirm === dlKey(it)) return d && d.state === 'done' ? 'Delete the download?' : 'Cancel the download?';
    if (!d) return '\u2b07 Download';
    if (d.state === 'done') return DL.isWeb ? '\u2713 Downloaded' : '\u2713 Downloaded';
    if (d.state === 'queued') return 'Waiting to download';
    if (!d.total) return 'Preparing download...';
    return 'Downloading ' + d.info + '   (' + (window.IS_ANDROID ? 'tap' : window.PREVIEW ? 'click' : 'OK') + ' to cancel)';
  }
  function epDlText(e, s) {
    var d = window.DL ? DL.state(e) : null;
    if (s.dlConfirm === dlKey(e)) return d && d.state === 'done' ? 'Delete?' : 'Cancel?';
    if (!d) return '\u2b07';
    if (d.state === 'done') return '\u2713';
    if (d.state === 'queued') return '...';
    return d.pct + '%';
  }
  function dlToggle(it, s) {
    var d = DL.state(it);
    if (!d || (DL.isWeb && d.state === 'done')) { s.dlConfirm = null;
      if (it.kind === 'series' && tvOk()) {   // phone / web, an episode: here, or onto the TV's stick
        UI.ask('Download ' + (it.name || 'this episode') + ' to:', [DL.isWeb ? 'This computer' : 'This phone', 'The TV (USB stick)', 'Cancel'], function (i) { if (i === 0) { var m0 = DL.add(it); if (m0) toast(m0, 3500); } else if (i === 1) tvDl([it]); if (s.ecol !== undefined) s.ecol = 0; UI.showCurrent(); if (s.render) s.render(); });   // focus goes back to the episode itself
        return;
      }
      var m = DL.add(it); if (m) toast(m, 3500); return; }
    if (s.dlConfirm === dlKey(it)) { DL.remove(it); s.dlConfirm = null; toast(d.state === 'done' ? 'Download deleted' : 'Download cancelled'); }
    else s.dlConfirm = dlKey(it);
  }
  function dlAction(it, s) { return { label: function () { return dlLabel(it, s); }, run: function () { dlToggle(it, s); s.render(); } }; }
  // phone / web: ask the TV (through the home laptop) to download onto its USB stick; it starts when Los Bebos is open on the TV
  function tvOk() { return (window.IS_ANDROID || window.PREVIEW) && API.homeApi && !!API.homeApi('cast'); }
  // a request the home laptop did not take (no network, relay restarting) is kept on this device and sent again by itself
  function tvQueue() { try { return JSON.parse(localStorage.getItem('doortv.tvreq') || '[]'); } catch (e) { return []; } }
  function tvQueueSet(q) { try { if (q.length) localStorage.setItem('doortv.tvreq', JSON.stringify(q.slice(0, 50))); else localStorage.removeItem('doortv.tvreq'); } catch (e) {} }
  var tvSending = false;
  function tvDl(items, done) {
    var u = API.homeApi ? API.homeApi('cast') : null; if (!u) { toast('The home laptop is not reachable, cannot reach the TV', 4000); return; }
    var slim = function (x) { return { kind: x.kind, id: x.id, name: x.name, ext: x.ext || null, icon: x.icon || '', seriesId: x.seriesId || null, seriesName: x.seriesName || null }; };
    tvWatchArm();   // the phone's background check starts now, whatever the relay answers
    var batch = items.map(slim), q = tvQueue().concat(batch); tvQueueSet(q);   // kept until the relay has it
    tvSending = true;
    fetch(u, { method: 'POST', body: JSON.stringify({ cmd: 'download', items: q }), headers: { 'Content-Type': 'text/plain' } }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) { tvSending = false; tvQueueSet([]); toast((items.length === 1 ? 'Sent to the TV' : items.length + ' episodes sent to the TV') + (j.tvOpen ? ': downloading onto the stick' : ': switching the TV on, it downloads onto the stick and switches off again'), 5000); tvPoll(true); if (done) done(true); })
      .catch(function () { tvSending = false; toast('The home laptop did not answer; the request is kept and sent again by itself', 4500); });
  }
  function tvRetry() {   // every poll: anything still waiting on this device goes out again
    var q = tvQueue(); if (!q.length || tvSending) return; var u = API.homeApi ? API.homeApi('cast') : null; if (!u) return;
    tvSending = true;
    fetch(u, { method: 'POST', body: JSON.stringify({ cmd: 'download', items: q }), headers: { 'Content-Type': 'text/plain' } }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function () { tvSending = false; tvQueueSet([]); toast((q.length === 1 ? 'Sent to the TV: ' + (q[0].name || '') : q.length + ' downloads sent to the TV'), 4000); tvPoll(true); })
      .catch(function () { tvSending = false; });
  }
  // phone / web home screen: what the TV is fetching onto its stick, and what just finished ('Ready on the TV'), one small request every 20 s
  var tvInfo = { list: [], events: [], at: 0 }, tvPollT = 0, tvArmedAt = 0, tvToastedAt = 0;
  function tvWatchArm() { if (!window.IS_ANDROID || Date.now() - tvArmedAt < 600000) return; tvArmedAt = Date.now(); try { if (AndroidBridge.tvWatch) AndroidBridge.tvWatch(API.homeApi('tvdl')); } catch (e) {} }   // Android: a look at the TV every ~15 min, notification when something is ready
  function tvPoll(now) {
    if (!(window.IS_ANDROID || window.PREVIEW) || !API.homeApi) return; var u = API.homeApi('tvdl'); if (!u) return;
    if (!now && Date.now() - tvInfo.at < 19000) return;
    tvRetry();
    fetch(u, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      var pend = (j && j.pending ? j.pending : []).map(function (x) { return { key: x.kind + ':' + x.id, title: (x.seriesName ? x.seriesName + '  ' : '') + (x.name || ''), state: 'pending', got: 0, total: 0 }; });   // asked, the TV has not taken it yet (switching on)
      tvInfo = { list: pend.concat(j && j.list ? j.list : []), events: j && j.events ? j.events : [], at: Date.now(), shown: tvInfo.shown || 0 };
      if (tvInfo.list.some(function (e) { return e.state !== 'done' && e.state !== 'failed'; })) tvWatchArm();   // something is downloading on the TV (asked from anywhere): tell me when it is ready
      var seen = Number(localStorage.getItem('doortv.tvseen') || 0), fresh = tvInfo.events.filter(function (e) { return e.at > seen; });
      var newest = fresh.length ? fresh[fresh.length - 1].at : 0;
      if (newest && newest !== tvToastedAt) { tvToastedAt = newest; var e = fresh[fresh.length - 1]; toast((e.failed ? 'The TV could not download ' : 'Ready on the TV: ') + niceName(e.title), 6000); try { localStorage.setItem('doortv.tvseen', String(newest)); } catch (x) {} tvInfo.shown = newest; }   // said once; afterwards it is simply in Downloads > On the TV
      var c = current(); if (c && c.dom === 'screen-home' && c.render) c.render();
    }).catch(function () {});
  }
  function tvLine() {   // the line under the home menu; tapping / OK on it clears a 'ready' note
    if (window.PREVIEW && !window.IS_ANDROID) { var el0 = $('tv-line'); if (el0) el0.classList.add('hidden'); return false; }   // the web has the Downloads on the TV tile instead of this line
    var el = $('tv-line'); if (!el) { el = document.createElement('div'); el.id = 'tv-line'; el.className = 'tv-line hidden'; $('screen-home').appendChild(el); el.addEventListener('click', function (ev) { ev.stopPropagation(); tvLineDismiss(); }); }
    var fresh = tvInfo.shown ? tvInfo.events.filter(function (e) { return e.at === tvInfo.shown; }) : [];   // the one just announced stays on the home line until the app is closed or it is tapped
    var act = tvInfo.list.filter(function (e) { return e.state !== 'done' && e.state !== 'failed'; });
    var txt = '';
    if (fresh.length) { var e = fresh[fresh.length - 1]; txt = (e.failed ? '\u26a0 The TV could not download ' : '\u2713 Ready on the TV: ') + niceName(e.title) + (fresh.length > 1 ? ' (+' + (fresh.length - 1) + ' more)' : ''); }
    else if (act.length) { var d = act.filter(function (e) { return e.state !== 'pending'; })[0] || act[0], p = d.total ? Math.round(100 * d.got / d.total) : 0; txt = '\ud83d\udcfa ' + (d.state === 'pending' ? 'Waiting for the TV to switch on: ' : d.state === 'queued' ? 'Queued on the TV: ' : 'Downloading on the TV: ') + niceName(d.title) + (d.state === 'queued' || d.state === 'pending' ? '' : '  \u00b7  ' + p + '%') + (act.length > 1 ? '  (+' + (act.length - 1) + ' more)' : ''); }
    el.textContent = txt; el.classList.toggle('hidden', !txt); el.classList.toggle('ready', !!fresh.length); return !!txt;
  }
  function tvLineDismiss() { var last = tvInfo.events.length ? tvInfo.events[tvInfo.events.length - 1].at : 0; if (last) localStorage.setItem('doortv.tvseen', String(last)); tvInfo.shown = 0; var c = current(); if (c && c.render) c.render(); }
  function tvDlAction(it) { return { label: function () { return '\ud83d\udcfa Download on the TV'; }, run: function () { tvDl([it]); } }; }
  function downloads() {
    // a small file browser: TV = the whole USB stick, phone = Downloads/Los Bebos TV. Running downloads on top.
    // OK/tap: open a folder / play a video. "..." = Play, Move to folder, Delete. Back = one folder up.
    var s = { dom: 'screen-downloads', i: 0, col: 0, dlLive: true, rows: [], items: [], path: '', listedAt: 0, sheet: null, mi: 0, opts: [] };
    function sizeTxt(b) { return b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : Math.round(b / 1048576) + ' MB'; }
    function names(e) {
      if (e && e.seriesName) { var n = String(e.name || ''), ep = n.split(' - ')[0], t = n.indexOf(' - ') > 0 ? n.split(' - ').slice(1).join(' - ') : ''; return { title: niceName(e.seriesName), sub: ep + (t ? '  ·  ' + t : '') }; }
      return { title: e ? niceName(e.name || e.title) : '', sub: '' };
    }
    function relist() { var g = DL.fsGen ? DL.fsGen() : 0; DL.fs.list(s.path, function (items) { s.items = items; s.listedAt = Date.now(); s.gen = g; paint(); }); }
    function build() {
      var rows = [], act = s.path ? [] : DL.list().filter(function (e) { return e.state !== 'done'; });
      if (act.length) { rows.push({ header: 'Downloading' }); act.forEach(function (e) { rows.push({ act: e }); }); }
      if (!s.path && s.tv && s.tv.length) { rows.push({ header: 'On the TV' }); s.tv.forEach(function (e) { rows.push({ tv: e }); }); }   // phone / web: the TV's stick, live
      if (s.path) rows.push({ up: true });
      var dirs = s.items.filter(function (f) { return f.dir; }), files = s.items.filter(function (f) { return !f.dir; });
      if (dirs.length || files.length) rows.push({ header: s.path ? s.path.split('/').pop() : (DL.isTV ? 'On the USB stick' : 'On this phone') });
      dirs.forEach(function (f) { rows.push({ f: f }); }); files.forEach(function (f) { rows.push({ f: f }); });
      return rows;
    }
    function step(d) { var i = s.i; do { i += d; } while (i >= 0 && i < s.rows.length && s.rows[i].header); if (i >= 0 && i < s.rows.length) s.i = i; }
    function card(r, i) {
      var f = i === s.i, cls = 'row dlcard' + (f && s.col === 0 ? ' focused' : '') + (f && s.col === 1 ? ' active' : '');
      var more = '<div class="dl-more' + (f && s.col === 1 ? ' focused' : '') + '">⋯</div>';
      if (r.up) return '<div class="' + cls + '" data-i="' + i + '"><div class="dl-folder">⬆</div><div class="dl-main"><div class="dl-title">Back</div><div class="dl-sub">' + esc(s.path.indexOf('/') > 0 ? s.path.slice(0, s.path.lastIndexOf('/')) : (DL.isTV ? 'USB stick' : 'Downloads')) + '</div></div></div>';
      if (r.act) { var e = r.act, n = names(e), st = DL.state(e) || {}, p = DL.pct(e);
        return '<div class="' + cls + '" data-i="' + i + '"><img class="dl-poster" src="' + esc(e.icon || '') + '" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility=\'hidden\'"><div class="dl-main"><div class="dl-title">' + esc(n.title) + '</div>' + (n.sub ? '<div class="dl-sub">' + esc(n.sub) + '</div>' : '') +
          '<div class="dl-line">' + esc(st.info || 'Starting...') + '</div><div class="dlbar"><i style="width:' + p + '%"></i></div></div><div class="dl-ring" style="--p:' + p + '"><span>' + (e.state === 'queued' ? '…' : p + '%') + '</span></div>' + more + '</div>'; }
      if (r.tv) { var t = r.tv, tp = t.total ? Math.round(100 * t.got / t.total) : 0, tl = t.state === 'done' ? 'On the TV stick' : t.state === 'pending' ? 'Waiting for the TV to switch on' : t.state === 'queued' ? 'Queued on the TV' : t.paused ? 'Paused on the TV  ·  ' + tp + '%' : 'Downloading on the TV  ·  ' + tp + '%';
        return '<div class="' + cls + '" data-i="' + i + '"><div class="dl-folder">\ud83d\udcfa</div><div class="dl-main"><div class="dl-title">' + esc(t.title) + '</div><div class="dl-line' + (t.state === 'done' ? ' ok' : '') + '">' + esc(tl) + '</div>' + (t.state === 'downloading' ? '<div class="dlbar"><i style="width:' + tp + '%"></i></div>' : '') + '</div></div>'; }
      var x = r.f;
      if (x.dir) return '<div class="' + cls + '" data-i="' + i + '"><div class="dl-folder">📁</div><div class="dl-main"><div class="dl-title">' + esc(x.title) + '</div><div class="dl-sub">Folder</div></div>' + more + '</div>';
      var en = x.entry, nm = en ? names(en) : { title: x.title, sub: '' };
      return '<div class="' + cls + '" data-i="' + i + '">' + (x.icon ? '<img class="dl-poster" src="' + esc(x.icon) + '" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility=\'hidden\'">' : '<div class="dl-folder">🎬</div>') +
        '<div class="dl-main"><div class="dl-title">' + esc(nm.title) + '</div>' + (nm.sub ? '<div class="dl-sub">' + esc(nm.sub) + '</div>' : '') + '<div class="dl-line ok">' + sizeTxt(x.size || 0) + '</div></div><div class="dl-play">▶</div>' + more + '</div>';
    }
    function paint() {
      var b = $('dl-body'), keep = b.scrollTop;
      if (s.sheet) {
        $('dl-info').textContent = s.sheet.title;
        b.innerHTML = s.opts.map(function (o, i) { return '<div class="row opt' + (i === s.mi ? ' focused' : '') + '" data-i="' + i + '"><span class="label">' + esc(o.label) + '</span></div>'; }).join(''); return;
      }
      s.rows = build(); if (s.i >= s.rows.length) s.i = s.rows.length - 1; if (s.i < 0) s.i = 0; if (s.rows[s.i] && s.rows[s.i].header) step(1); if (s.rows[s.i] && s.rows[s.i].header) step(-1);
      var webOnly = !!window.PREVIEW && !window.IS_ANDROID;   // web: nothing is stored here, this screen is the TV's stick
      $('dl-info').textContent = webOnly ? 'On the TV (its USB stick)      \u00b7      live from the TV' : (DL.isTV ? 'USB stick' : 'Downloads / Los Bebos TV') + (s.path ? '  /  ' + s.path.split('/').join('  /  ') : '') + '      ·      ' + DL.where();
      if (!webOnly && !DL.fs.ready()) { b.innerHTML = '<div class="empty dl-empty">' + esc(DL.reason() || 'Storage not available') + '</div>'; return; }
      if (!s.rows.length) { b.innerHTML = '<div class="empty dl-empty">' + esc(webOnly ? 'Nothing on the TV yet.\nOpen a film or a series and choose \ud83d\udcfa Download on the TV.' : s.path ? 'This folder is empty.' : 'Nothing here yet.\nOpen a film or a series and choose ⬇ Download to watch it offline.') + '</div>'; return; }
      b.innerHTML = s.rows.map(function (r, i) { return r.header ? '<div class="hdr">' + esc(r.header) + '</div>' : card(r, i); }).join('');
      b.scrollTop = keep; if (!touchMode()) { var fo = b.querySelector('.focused, .active'); if (fo && fo.scrollIntoView) fo.scrollIntoView({ block: 'nearest' }); sbarScroll(b); }
    }
    s.render = function () { if (Date.now() - s.listedAt > 10000 || (DL.fsGen && s.gen !== DL.fsGen())) relist(); else paint(); };   // a deleted / finished file: read the stick again instead of showing the old list
    function go(path) { s.path = path; s.i = 0; s.col = 0; s.items = []; relist(); }
    function playFile(x) {
      var e = x.entry;
      if (e && e.state === 'done') { PLAYER.play({ kind: e.kind, id: e.id, name: e.name, ext: e.ext, icon: e.icon, seriesId: e.seriesId, seriesName: e.seriesName, aspectKey: e.aspectKey }); return; }
      PLAYER.play({ kind: 'vod', id: 'file:' + x.rel, name: x.title, ext: (x.name.split('.').pop() || 'mkv'), icon: '', localUrl: DL.fs.url(x.rel) });
    }
    function openSheet(r) {
      var o = [];
      if (r.act) { o.push({ label: '✕  Cancel download', act: 'cancel' }); s.sheet = { r: r, title: names(r.act).title }; }
      else if (r.f.dir) { o.push({ label: '📂  Open', act: 'open' }); o.push({ label: '🗑  Delete folder', act: 'delete' }); s.sheet = { r: r, title: r.f.title }; }
      else { o.push({ label: '▶  Play', act: 'play' }); o.push({ label: '📁  Move to folder', act: 'move' }); o.push({ label: '🗑  Delete', act: 'delete' }); s.sheet = { r: r, title: r.f.entry ? names(r.f.entry).title : r.f.title }; }
      o.push({ label: 'Close', act: 'close' }); s.opts = o; s.mi = 0; paint();
    }
    function moveSheet(r) {
      DL.fs.list('', function (top) {
        var here = r.f.rel.indexOf('/') > 0 ? r.f.rel.slice(0, r.f.rel.lastIndexOf('/')) : '', o = [];
        if (here !== '') o.push({ label: '⬆  ' + (DL.isTV ? 'Top of the USB stick' : 'Main folder'), dest: '' });
        top.filter(function (f) { return f.dir && f.rel !== here; }).forEach(function (f) { o.push({ label: '📁  ' + f.title, dest: f.rel }); });
        o.push({ label: '+  New folder...', create: true }); o.push({ label: 'Close', act: 'close' });
        s.sheet = { r: r, title: 'Move "' + (r.f.entry ? names(r.f.entry).title : r.f.title) + '" to:', moving: true }; s.opts = o; s.mi = 0; paint();
      });
    }
    function choose(o) {
      var sh = s.sheet; if (!sh || !o || o.act === 'close') { s.sheet = null; s.col = 0; paint(); return; }
      var r = sh.r;
      if (sh.moving) {
        var finish = function (dest) { DL.fs.move(r.f.rel, dest, function (ok) { toast(ok ? 'Moved' : 'Could not move it', 3000); s.sheet = null; s.col = 0; relist(); }); };
        if (o.create) { var nm = prompt('New folder name', ''); if (!nm || !nm.trim()) return; nm = nm.trim().replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 40); DL.fs.mkdir(nm, function (ok) { if (!ok) { toast('Could not create the folder', 3000); return; } finish(nm); }); return; }
        finish(o.dest); return;
      }
      s.sheet = null; s.col = 0;
      if (o.act === 'play') { paint(); playFile(r.f); return; }
      if (o.act === 'open') { go(r.f.rel); return; }
      if (o.act === 'move') { moveSheet(r); return; }
      if (o.act === 'cancel') { paint(); UI.ask('Cancel the download of ' + names(r.act).title + '?', ['Cancel download', 'Keep'], function (i) { if (i === 0) { DL.removeKey(r.act.key); toast('Download cancelled'); } paint(); }); return; }
      if (o.act === 'delete') { paint(); var what = r.f.dir ? 'the folder "' + r.f.title + '" and everything in it' : '"' + (r.f.entry ? names(r.f.entry).title + (names(r.f.entry).sub ? ' ' + names(r.f.entry).sub.split('  ')[0] : '') : r.f.title) + '"';
        UI.ask('Delete ' + what + '?', ['Delete', 'Keep'], function (i) { if (i !== 0) { paint(); return; } DL.fs.remove(r.f.rel, r.f.dir, function (ok) { toast(ok ? 'Deleted' : 'Could not delete it', 3000); relist(); }); }); }
    }
    function activate(r) {
      if (r.tv) { var t = r.tv, doneT = t.state === 'done';   // the TV's item: cancel it, or delete the copy from its stick
        UI.ask((doneT ? 'Delete ' : 'Cancel ') + niceName(t.title) + (doneT ? ' from the TV stick?' : ' on the TV?'), [doneT ? 'Delete from the TV' : 'Cancel on the TV', 'Keep'], function (i) { if (i !== 0) { paint(); return; }
          var u = API.homeApi ? API.homeApi('cast') : null; if (!u) { toast('The home laptop is not reachable', 3000); return; }
          fetch(u, { method: 'POST', body: JSON.stringify({ cmd: 'dlcancel', key: t.key }), headers: { 'Content-Type': 'text/plain' } }).then(function (r2) { return r2.json(); }).then(function (j) { toast((doneT ? 'Deleting on the TV' : 'Cancelling on the TV') + (j.tvOpen ? '' : ' (when Los Bebos is next open on it)'), 3500); s.tv = (s.tv || []).filter(function (x) { return x.key !== t.key; }); paint(); }).catch(function () { toast('Could not reach the home laptop', 3000); }); });
        return; }
      if (!r || r.header) return;
      if (r.up) { go(s.path.indexOf('/') > 0 ? s.path.slice(0, s.path.lastIndexOf('/')) : ''); return; }
      if (r.act) { toast('Still downloading (' + DL.pct(r.act) + '%). It plays without internet once it is finished.', 3500); return; }
      if (r.f.dir) { go(r.f.rel); return; }
      playFile(r.f);
    }
    s.key = function (k) {
      if (s.sheet) {
        if (k === 10009) { choose(null); return true; }
        if (k === 38) { s.mi = Math.max(0, s.mi - 1); paint(); return true; }
        if (k === 40) { s.mi = Math.min(s.opts.length - 1, s.mi + 1); paint(); return true; }
        if (k === 13) { choose(s.opts[s.mi]); return true; }
        return true;
      }
      if (k === 10009) { if (s.path) { go(s.path.indexOf('/') > 0 ? s.path.slice(0, s.path.lastIndexOf('/')) : ''); return true; } pop(); return true; }
      if (!s.rows.length) return true;
      if (k === 38) { step(-1); paint(); return true; }
      if (k === 40) { step(1); paint(); return true; }
      if (k === 39) { if (!s.rows[s.i].up) { s.col = 1; paint(); } return true; }
      if (k === 37) { s.col = 0; paint(); return true; }
      if (k === 13) { var r = s.rows[s.i]; if (s.col === 1 && !r.up) openSheet(r); else activate(r); return true; }
      return false;
    };
    s.tap = function (i, part) {
      if (s.sheet) { s.mi = i; choose(s.opts[i]); return; }
      var r = s.rows[i]; if (!r || r.header) return; s.i = i;
      if (part === 'more' && !r.up) { s.col = 1; openSheet(r); } else { s.col = 0; paint(); activate(r); }
    };
    function fetchTv() {   // phone / web only: one small request every 10 s while this screen is open
      if (DL.isTV || !API.homeApi) return; var u = API.homeApi('tvdl'); if (!u) return;
      fetch(u, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) { if (current() !== s) return; var order = { downloading: 0, queued: 1, done: 2 };
        var pend = (j && j.pending ? j.pending : []).map(function (x) { return { key: x.kind + ':' + x.id, title: (x.seriesName ? x.seriesName + '  ' : '') + (x.name || ''), state: 'pending', got: 0, total: 0 }; });
        s.tv = pend.concat((j && j.list ? j.list : []).slice().sort(function (a, b) { return (order[a.state] === undefined ? 3 : order[a.state]) - (order[b.state] === undefined ? 3 : order[b.state]); })); paint(); }).catch(function () {});
    }
    var h1 = document.querySelector('#screen-downloads h1'); if (h1) h1.textContent = (window.PREVIEW && !window.IS_ANDROID) ? 'Downloads on the TV' : 'Downloads';
    push(s); relist(); fetchTv(); s.tvT = setInterval(function () { if (current() !== s) { clearInterval(s.tvT); return; } fetchTv(); }, 10000);
  }
  // ---------- search: channels, movies, series (the laptop does the heavy part, the TV only shows a few rows) ----------
  // TV: its own on-screen keyboard (the Samsung one has shortcuts on Up/Down and closes the screen); phone / web: normal text box
  var KB_KEYS = 'abcdefghijklmnopqrstuvwxyz1234567890'.split(''), KB_COLS = 6, KB_ROWS = 7;   // row 7: Space, Delete, Clear
  function searchScreen(only) {
    var inp = $('sr-input'), kbMode = !touchMode();
    var s = { dom: 'screen-search', i: 0, rows: [], q: '', text: '', focus: kbMode ? 'kb' : 'input', kr: 0, kc: 0, timer: 0, state: '', win: { offset: 0 } };
    var KIND = { live: 'Channel', vod: 'Movie', series: 'Series' }, HDR = { live: 'Channels', vod: 'Movies', series: 'Series' };
    inp.value = ''; $('sr-title').textContent = only === 'live' ? 'Search channels' : only === 'vod' ? 'Search movies' : only === 'series' ? 'Search series' : 'Search';
    inp.placeholder = only === 'live' ? 'Channel name' : only === 'vod' ? 'Movie title' : only === 'series' ? 'Series title' : 'Channel, movie or series';
    $('screen-search').classList.toggle('kbmode', kbMode);
    function tag(n) { var m = /^\s*([A-Z0-9+]{1,6}(?:-[A-Z0-9+]{1,6})?)\s*[:|-]\s/.exec(String(n || '')); return m ? m[1] : ''; }
    function build(r) {
      var rows = [];
      ['live', 'vod', 'series'].forEach(function (k) {
        var arr = (r && r[k]) || []; if (!arr.length) return; if (!only) rows.push({ header: HDR[k] + '  ' + arr.length });
        arr.forEach(function (x) { var o = { kind: k, id: x.id, name: niceName(x.name), rawName: x.name, icon: '', lang: tag(x.name) }; if (k === 'vod') o.ext = x.ext || 'mp4'; rows.push(o); });
      });
      return rows;
    }
    function key(r, c) { if (r < KB_ROWS - 1) return KB_KEYS[r * KB_COLS + c]; return ['space', 'del', 'clear'][Math.floor(c / 2)]; }
    function paintKb() {
      if (!kbMode) return;
      var h = '';
      for (var r = 0; r < KB_ROWS; r++) for (var c = 0; c < KB_COLS; c++) {
        var k = key(r, c); if (r === KB_ROWS - 1 && c % 2) continue;
        var f = s.focus === 'kb' && r === s.kr && (r === KB_ROWS - 1 ? Math.floor(s.kc / 2) === Math.floor(c / 2) : c === s.kc);
        h += '<div class="kb-key' + (r === KB_ROWS - 1 ? ' wide' : '') + (f ? ' focused' : '') + '">' + (k === 'space' ? 'Space' : k === 'del' ? 'Delete' : k === 'clear' ? 'Clear' : esc(k.toUpperCase())) + '</div>';
      }
      $('sr-kb').innerHTML = h;
      $('sr-box').innerHTML = s.text ? esc(s.text) + '<span class="caret"></span>' : '<span class="ph">' + esc(inp.placeholder) + '</span>';
    }
    function rowHtml(r, i, f) {
      if (r.header) return '<div class="hdr" data-i="' + i + '">' + esc(r.header) + '</div>';
      return '<div class="row srrow' + (f ? ' focused' : '') + '" data-i="' + i + '">' + (only ? '' : '<span class="srk">' + KIND[r.kind] + '</span>') + '<span class="label">' + esc(r.name) + '</span>' + (r.lang ? '<span class="srl">' + esc(r.lang) + '</span>' : '') + '</div>';
    }
    function paint() {
      paintKb();
      $('sr-info').textContent = s.state;
      var b = $('sr-body');
      if (!s.rows.length) { s.win.sig = null; b.innerHTML = s.q.length >= 2 && !/^Searching/.test(s.state) ? '<div class="empty">Nothing found for "' + esc(s.q) + '"</div>' : ''; return; }
      renderRows(b, s.rows, s.i, s.win, 12, rowHtml, s.focus === 'list');
    }
    function run() {
      var q = (kbMode ? s.text : inp.value).trim(); if (q === s.q) return; s.q = q;
      if (q.length < 2) { s.rows = []; s.state = q.length ? 'Type one more letter' : ''; paint(); return; }
      s.state = 'Searching...'; paint();
      SEARCH.find(q, only, function (err, r) {
        if (err) { s.rows = []; s.state = /prepar|rebuild/.test(err.message) ? err.message : (DL.isTV ? 'Search is not ready yet: ' + err.message : 'Search needs the home laptop, it is not answering right now.'); if (/missing/.test(err.message) && SEARCH.rebuild) SEARCH.rebuild(); paint(); return; }
        s.rows = build(r); var n = s.rows.filter(function (x) { return !x.header; }).length;
        s.state = n ? n + (n === 1 ? ' result' : ' results') : ''; s.i = 0; while (s.rows[s.i] && s.rows[s.i].header) s.i++; s.win.offset = 0; bump(s.win); paint();
      });
    }
    function soon() { clearTimeout(s.timer); s.timer = setTimeout(run, 400); }
    function press(k) {
      if (k === 'space') { if (s.text && !/ $/.test(s.text)) s.text += ' '; }
      else if (k === 'del') s.text = s.text.slice(0, -1);
      else if (k === 'clear') s.text = '';
      else if (s.text.length < 40) s.text += k;
      paintKb(); soon();
    }
    function step(d) { var i = s.i; do { i += d; } while (i >= 0 && i < s.rows.length && s.rows[i].header); if (i >= 0 && i < s.rows.length) s.i = i; paint(); }
    function open(r) { if (!r || r.header) return; var live = s.rows.filter(function (x) { return x.kind === 'live'; }); openItem(r, r.kind === 'live' ? live : null, r.kind === 'live' ? live.indexOf(r) : -1); }
    if (!inp.__wired) {   // phone / web text box
      inp.__wired = true;
      inp.addEventListener('input', function () { var c = current(); if (c && c.onType) c.onType(); });
      inp.addEventListener('keydown', function (ev) { var c = current(); if (!c || !c.inputKey) return; if (c.inputKey(ev.keyCode)) { ev.preventDefault(); ev.stopPropagation(); } });
    }
    s.onType = soon;
    s.inputKey = function (k) {
      if (k === 13) { clearTimeout(s.timer); run(); try { inp.blur(); } catch (e) {} return true; }
      if (k === 10009) { try { inp.blur(); } catch (e) {} pop(); return true; }
      return false;
    };
    s.render = function () { paint(); };
    s.key = function (k) {
      if (k === 10009) { pop(); return true; }
      if (s.focus === 'kb') {
        if (k >= 48 && k <= 57) { press(String(k - 48)); return true; }   // number keys on the remote type straight away
        if (k === 37) { if (s.kr === KB_ROWS - 1) s.kc = Math.max(0, (Math.floor(s.kc / 2) - 1) * 2); else s.kc = Math.max(0, s.kc - 1); paintKb(); return true; }
        if (k === 39) { var last = s.kr === KB_ROWS - 1 ? Math.floor(s.kc / 2) === 2 : s.kc === KB_COLS - 1; if (last) { if (s.rows.length) { s.focus = 'list'; paint(); } return true; } s.kc = s.kr === KB_ROWS - 1 ? (Math.floor(s.kc / 2) + 1) * 2 : s.kc + 1; paintKb(); return true; }
        if (k === 38) { if (s.kr > 0) s.kr--; paintKb(); return true; }
        if (k === 40) { if (s.kr < KB_ROWS - 1) s.kr++; paintKb(); return true; }
        if (k === 13) { press(key(s.kr, s.kc)); return true; }
        return true;
      }
      if (s.focus === 'list') {
        if (k === 37) { s.focus = 'kb'; paint(); return true; }
        if (k === 38) { step(-1); return true; }
        if (k === 40) { step(1); return true; }
        if (k === 427 || k === 428) { for (var j = 0; j < 10; j++) step(k === 427 ? -1 : 1); return true; }
        if (k === 13) { open(s.rows[s.i]); return true; }
        return true;
      }
      return false;
    };
    s.tap = function (i) { var r = s.rows[i]; if (!r || r.header) return; s.i = i; s.focus = kbMode ? 'list' : s.focus; paint(); open(r); };
    s.leave = function () { clearTimeout(s.timer); try { inp.blur(); } catch (e) {} if (SEARCH.release) SEARCH.release(); };   // free the names again
    push(s); paint();
    if (SEARCH.watch) SEARCH.watch(function () { if (current() !== s) return; s.state = 'Updated with the newest titles'; var q = s.q; s.q = ''; if (q) run(); else paint(); });
    if (SEARCH.updating && SEARCH.updating()) { s.state = 'Checking for new titles...'; paint(); }
    if (SEARCH.freshen && SEARCH.freshen(only, function () { if (current() !== s) return; s.state = 'Updated with the newest titles'; var q = s.q; s.q = ''; if (q) run(); else paint(); })) { s.state = 'Checking for new titles...'; paint(); }
    if (!kbMode) setTimeout(function () { try { inp.focus(); } catch (e) {} }, 150);
  }
  // ---------- "Play on the TV": this screen is the remote; the TV app plays the video itself ----------
  function castRemote(cmd) {
    var u = API.homeApi ? API.homeApi('cast') : null; if (!u) { toast('The home laptop is not reachable, cannot reach the TV', 4000); return; }
    var s = { dom: 'screen-cast', i: 0, mySeq: 0, sentAt: Date.now(), st: null, timer: 0, item: cmd.item, gone: false };
    function post(c, cb) { fetch(u, { method: 'POST', body: JSON.stringify(c), headers: { 'Content-Type': 'text/plain' } }).then(function (r) { return r.json(); }).then(function (j) { if (cb) cb(j); }).catch(function () { toast('Could not reach the TV', 3000); }); }
    function unserve() { if (cmd.item && cmd.item.fromPhone && window.CAST && window.CAST.serveStop) setTimeout(function () { window.CAST.serveStop(); }, 1500); }   // the TV no longer needs the phone's copy
    function fmtT(ms) { ms = Math.max(0, Math.floor((ms || 0) / 1000)); var h = Math.floor(ms / 3600), m = Math.floor(ms / 60) % 60, x = ms % 60; return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x; }
    function btns() {
      var playing = s.st && s.st.state === 'playing', b = [];
      if (s.st && s.st.state !== 'idle') { b.push({ l: playing ? '‖ Pause' : '▶ Play', run: function () { post({ cmd: playing ? 'pause' : 'resume' }); s.st.state = playing ? 'paused' : 'playing'; paint(); } });
        if (s.item.kind !== 'live') { b.push({ l: '◀ 30 s', run: function () { post({ cmd: 'seek', delta: -30000 }); } }); b.push({ l: '30 s ▶', run: function () { post({ cmd: 'seek', delta: 30000 }); } }); } }
      if (s.st && s.st.state !== 'idle' && s.item.kind !== 'live') b.push({ l: '▶ Watch along here', run: function () { s.gone = true; pop(); PLAYER.watchAlong(); } });
      b.push({ l: '■ Stop on the TV', run: function () { post({ cmd: 'stop' }); s.gone = true; pop(); unserve(); } });
      b.push({ l: '← Watch on this phone', run: function () { var p0 = s.st && s.st.pos || cmd.pos || 0; post({ cmd: 'stop' }); s.gone = true; pop(); unserve(); if (p0 > 60000 && s.item.kind !== 'live') STORE.setPosition(s.item.kind + ':' + s.item.id, p0); setTimeout(function () { PLAYER.play(s.item, cmd.playlist, cmd.index, { dlOk: true }); }, 3000); } });
      return b;
    }
    function paint() {
      $('cast-title').textContent = (s.item.seriesName ? niceName(s.item.seriesName) + '  ' : '') + s.item.name;
      var st = s.st, waited = (Date.now() - s.sentAt) / 1000, txt;
      if (st && st.state === 'idle' && (st.seq || 0) >= s.mySeq && s.mySeq) unserve();   // the TV stopped (end of the video / its remote): the phone's copy is not needed
      if (!st || (st.seq || 0) < s.mySeq) txt = waited < 6 ? 'Sending to the TV...' : waited < 125 ? 'Waking the TV and opening Los Bebos TV... a TV that was off needs up to 2 minutes (' + Math.round(waited) + ' s)' : 'The TV is not answering. Is it plugged in and on the home network?';
      else txt = st.state === 'idle' ? 'Stopped on the TV' : (st.state === 'paused' ? 'Paused' : 'Playing') + (st.dur > 0 ? '   ' + fmtT(st.pos) + ' / ' + fmtT(st.dur) : '') + (st.note ? '\nTV: ' + st.note : '');
      $('cast-status').textContent = txt;
      $('cast-fill').style.width = st && st.dur > 0 ? Math.min(100, 100 * st.pos / st.dur) + '%' : '0%';
      var b = btns(); if (s.i >= b.length) s.i = b.length - 1; s.b = b;
      $('cast-btns').innerHTML = b.map(function (x, i) { return '<div class="btn' + (i === s.i ? ' focused' : '') + '" data-i="' + i + '">' + esc(x.l) + '</div>'; }).join('');
    }
    function tick() {
      if (current() !== s) return;
      fetch(u, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) { if (j && j.status && (j.status.seq || 0) >= s.mySeq) s.st = j.status; paint(); }).catch(function () {}).then(function () { s.timer = setTimeout(tick, 2000); });
    }
    s.render = paint;
    s.key = function (k) {
      if (k === 10009) { pop(); return true; }
      if (k === 37) { s.i = Math.max(0, s.i - 1); paint(); return true; }
      if (k === 39) { s.i = Math.min((s.b || []).length - 1, s.i + 1); paint(); return true; }
      if (k === 13 && s.b && s.b[s.i]) { s.b[s.i].run(); return true; }
      return true;
    };
    s.tap = function (i) { s.i = i; if (s.b && s.b[i]) s.b[i].run(); };
    s.leave = function () { clearTimeout(s.timer); };
    push(s); paint();
    post(cmd, function (j) { s.mySeq = j && j.seq || 0; s.sentAt = Date.now(); paint(); tick(); });
  }
  // ---------- small question dialog (remote: Left/Right + OK, Back = last choice; touch: tap) ----------
  var askSt = null;
  function ask(text, buttons, cb, timeoutMs) {
    var el = $('ask'); if (!el) { el = document.createElement('div'); el.id = 'ask'; el.className = 'ask hidden'; $('app').appendChild(el); el.addEventListener('click', function (ev) { var b = ev.target.closest('.btn'); if (b && askSt) { ev.stopPropagation(); askDone(Number(b.getAttribute('data-i'))); } }); }
    if (askSt) clearTimeout(askSt.timer);
    askSt = { text: text, b: buttons, i: buttons.length - 1, cb: cb, timer: timeoutMs ? setTimeout(function () { askDone(buttons.length - 1); }, timeoutMs) : 0 };
    askRender(); el.classList.remove('hidden');
  }
  function askRender() { var el = $('ask'); if (!el || !askSt) return; el.innerHTML = '<div class="ask-text">' + esc(askSt.text) + '</div><div class="ask-btns">' + askSt.b.map(function (b, i) { return '<div class="btn' + (i === askSt.i ? ' focused' : '') + '" data-i="' + i + '">' + esc(b) + '</div>'; }).join('') + '</div>'; }
  function askDone(i) { var a = askSt; if (!a) return; askSt = null; clearTimeout(a.timer); $('ask').classList.add('hidden'); try { a.cb(i); } catch (e) {} }
  function askKey(k) {
    if (!askSt) return false;
    if (k === 37) { askSt.i = Math.max(0, askSt.i - 1); askRender(); } else if (k === 39) { askSt.i = Math.min(askSt.b.length - 1, askSt.i + 1); askRender(); }
    else if (k === 13) askDone(askSt.i); else if (k === 10009) askDone(askSt.b.length - 1);
    return true;
  }
  function favAction(it) { return { label: function () { return STORE.isFav(it.kind, it.id) ? '★ Remove favourite' : '☆ Add favourite'; }, run: function () { STORE.toggleFav(favEntry(it)); current().render(); } }; }
  function showVodDetail(it) {
    var s = detailBase(it);
    s.actions = [{ label: function () { var p = STORE.position('vod:' + it.id); return p > 60000 ? 'Resume from ' + Math.floor(p / 60000) + ' min' : 'Play'; }, run: function () { PLAYER.play(it); } },
                 { label: function () { return 'Play from start'; }, run: function () { STORE.setPosition('vod:' + it.id, 0); PLAYER.play(it); } }, favAction(it)];
    if (window.DL && (DL.available() || DL.state(it))) s.actions.splice(2, 0, dlAction(it, s));
    if (tvOk()) s.actions.splice(s.actions.length - 1, 0, tvDlAction(it));
    $('detail-meta').textContent = ''; $('detail-plot').textContent = ''; $('detail-plot').classList.remove('open');
    push(s);
    API.vodInfo(it.id).then(function (d) { var info = d && d.info ? d.info : {}; if (current() !== s) return;
      if (window.PREPARE_PREVIEWS) { var secs = 0; var dm = /^(\d+):(\d+):(\d+)/.exec(info.duration || ''); if (dm) secs = (+dm[1]) * 3600 + (+dm[2]) * 60 + (+dm[3]); if (!secs && info.duration_secs) secs = +info.duration_secs; window.PREPARE_PREVIEWS(API.streamUrl('vod', it.id, it.ext), secs); }
      $('detail-meta').textContent = [info.releasedate || info.releaseDate, info.genre, info.duration, info.rating ? 'Rating ' + info.rating : ''].filter(Boolean).join('  |  ');
      $('detail-plot').textContent = info.plot || info.description || ''; if (info.movie_image && !it.icon) { it.icon = info.movie_image; s.render(); } }).catch(function () {});
  }
  function showSeriesDetail(it) {
    var s = detailBase(it); s.actions = [favAction(it)];
    $('detail-meta').textContent = ''; $('detail-plot').textContent = it.raw && it.raw.plot ? it.raw.plot : ''; $('detail-plot').classList.remove('open');
    push(s); loading(true);
    API.seriesInfo(it.id).then(function (d) { loading(false); if (current() !== s) return;
      var info = d.info || {}; if (!it.icon && (info.cover || (info.backdrop_path && info.backdrop_path[0]))) { it.icon = info.cover || info.backdrop_path[0]; $('detail-cover').src = it.icon; }   // opened from Continue watching without a picture
      $('detail-meta').textContent = [info.releaseDate, info.genre, info.rating ? 'Rating ' + info.rating : ''].filter(Boolean).join('  |  ');
      if (info.plot) $('detail-plot').textContent = info.plot;
      var eps = [], seasons = d.episodes || {}, snames = Object.keys(seasons).sort(function (a, b) { return Number(a) - Number(b); });
      snames.forEach(function (sn) {
        (seasons[sn] || []).forEach(function (e) {
          var t = e.title || ''; var m = /S\d+E\d+.*$/i.exec(t); var short = m ? m[0] : ('S' + sn + 'E' + e.episode_num + ' ' + t);
          var ei = e.info || {}, rest = short.replace(/^S\d+E(\d+)\s*-?\s*/i, ''), epn = (/^S\d+E(\d+)/i.exec(short) || [])[1] || e.episode_num;
          eps.push({ kind: 'series', id: e.id, name: short, label: 'E' + epn + (rest ? '  ' + rest : ''), season: sn, ext: e.container_extension || 'mp4', icon: it.icon, aspectKey: 'series-' + it.id, seriesId: it.id, seriesName: it.name,
            still: ei.movie_image || ei.cover_big || '', plot: ei.plot || '', duration: ei.duration ? String(ei.duration).replace(/^00:/, '').replace(/^0/, '') : '', air: ei.releasedate || ei.air_date || '' });
        });
      });
      s.all = eps; s.seasons = snames.filter(function (sn) { return (seasons[sn] || []).length; }); s.si = 0;
      s.eps = eps.filter(function (e) { return e.season === s.seasons[0]; });
      var last = STORE.lastEpisode(it.id); var li = -1;
      if (window.PREPARE_PREVIEWS && eps.length) { var pe = eps[0]; if (last) eps.forEach(function (e, i) { if (String(e.id) === String(last.id)) pe = eps[STORE.position('series:' + e.id) > 60000 ? i : Math.min(i + 1, eps.length - 1)]; }); window.PREPARE_PREVIEWS(API.streamUrl('series', pe.id, pe.ext), Number((info.episode_run_time || 0)) * 60); }
      if (last) eps.forEach(function (e, i) { if (String(e.id) === String(last.id)) li = i; });
      if (li >= 0) { var lsi = s.seasons.indexOf(eps[li].season); if (lsi >= 0) { s.si = lsi; s.eps = eps.filter(function (e) { return e.season === s.seasons[lsi]; }); } }
      if (li >= 0) {
        var pos = STORE.position('series:' + eps[li].id), dur = STORE.duration ? STORE.duration('series:' + eps[li].id) : 0, over = dur > 0 && pos >= dur * 0.9;   // 90 % seen = finished: the next episode comes first
        var nextAct = li + 1 < eps.length ? { label: function () { return 'Next: ' + eps[li + 1].name.split(' - ')[0]; }, run: function () { PLAYER.play(eps[li + 1], eps, li + 1); } } : null;
        var contAct = { label: function () { return (pos > 60000 && !over ? 'Continue ' : 'Replay ') + eps[li].name.split(' - ')[0] + (pos > 60000 && !over ? ' from ' + Math.floor(pos / 60000) + ' min' : ''); }, run: function () { if (over) STORE.setPosition('series:' + eps[li].id, 0); PLAYER.play(eps[li], eps, li); } };
        if (over && nextAct) { s.actions.unshift(contAct); s.actions.unshift(nextAct); } else { if (nextAct) s.actions.unshift(nextAct); s.actions.unshift(contAct); }
        s.ei = Math.max(0, s.eps.indexOf(eps[li])); s.pane = 'actions'; s.ai = 0;
      } else if (eps.length) { s.pane = 'eps'; }
      s.render();
    }).catch(function (e) { loading(false); toast('Could not load series: ' + e.message); });
  }

  // ---------- settings ----------
  function settings() {
    var s = { dom: 'screen-settings', i: 0, rows: [], acct: null };
    function rows() {
      var acct = s.acct, u = acct && acct.user_info ? acct.user_info : null;
      var exp = u && u.exp_date ? (function (d) { return d.getDate() + ' ' + ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()] + ' ' + d.getFullYear(); })(new Date(Number(u.exp_date) * 1000)) : '?';   // day month year, never the ambiguous 1/5/2028
      return [
        { label: 'Account', val: u ? (u.status + ', expires ' + exp + ', ' + u.max_connections + ' connection(s)') : 'checking...', run: function () {} },
        { label: 'Server', val: CONFIG.server, run: function () { editField('server'); } },
        { label: 'Username', val: CONFIG.username, run: function () { editField('username'); } },
        { label: 'Password', val: CONFIG.password.replace(/./g, '*'), run: function () { editField('password'); } },
        { label: 'Live stream format', val: CONFIG.liveFormat, run: function () { CONFIG.liveFormat = CONFIG.liveFormat === 'ts' ? 'm3u8' : 'ts'; saveConfig(CONFIG); s.render(); } },
        { label: 'Default aspect for new streams', val: PLAYER.MODE_LABEL[CONFIG.defaultAspect], run: function () { var m = PLAYER.MODES; CONFIG.defaultAspect = m[(m.indexOf(CONFIG.defaultAspect) + 1) % m.length]; saveConfig(CONFIG); s.render(); } },
        { label: 'Screen (for support)', val: (window.innerWidth + 'x' + window.innerHeight + ', pixel ratio ' + (window.devicePixelRatio || 1) + ', scale ' + (Math.round((window.APP_SCALE || 1) * 100) / 100)), run: function () {} },
        { label: 'Connection', val: (window.IS_ANDROID || !window.PREVIEW) ? (CONFIG.viaHome ? 'via home laptop (Bulgarian connection) - tap to go direct' : 'direct to provider - tap to route through home') : (window.PREVIEW ? 'via home laptop (Bulgarian connection)' : 'direct to provider'), run: function () {
            if (window.PREVIEW && !window.IS_ANDROID) { toast('The web version always goes through the home laptop'); return; }
            toggleRoute(); setTimeout(function () { s.render(); }, 1500); } },
        { label: 'Downloads', val: window.DL ? DL.where() : '', run: function () { if (window.DL && !DL.isWeb) downloads(); else toast('On the web, downloads go to your browser\'s download folder', 3500); } },
        { label: 'Background picture', val: (window.PREVIEW || window.IS_ANDROID) ? 'choose a photo' : 'change it from the web version', run: function () { if (window.PREVIEW || window.IS_ANDROID) BG.choose(function (m) { toast(m, 4000); }); else toast('Change it on the web page (Settings > Background picture); the TV picks it up at its next start', 5000); } },
        { label: 'Reset background', val: 'dark gradient', run: function () { BG.reset(function (m) { toast(m, 3000); }); } },
        { label: 'Send diagnostics to the laptop', val: CONFIG.debug ? 'on' : 'off', run: function () { CONFIG.debug = !CONFIG.debug; saveConfig(CONFIG); s.render(); } },
        { label: 'Video position correction', val: String(CONFIG.posFactor || 'auto'), run: function () { var o = ['auto', '1', '1.5', '2']; CONFIG.posFactor = o[(o.indexOf(String(CONFIG.posFactor || 'auto')) + 1) % o.length]; saveConfig(CONFIG); s.render(); toast('Video position correction: ' + CONFIG.posFactor + ' (test with a channel preview)'); } },
        { label: 'Reset remembered aspect ratios', val: '', run: function () { try { localStorage.removeItem('doortv.aspect'); } catch (e) {} toast('Aspect memory cleared'); } },
        { label: 'Clear cache and reload lists', val: '', run: function () { API.clearCache(); toast('Cache cleared'); } },
        { label: 'Los Bebos TV version', val: '1.9.23', run: function () {} }
      ];
    }
    function editField(field) {
      var val = prompt('Enter ' + field, CONFIG[field]);
      if (val !== null && val !== '') { CONFIG[field] = val.trim(); saveConfig(CONFIG); API.clearCache(); s.acct = null; s.render(); load(); }
    }
    function load() { API.account().then(function (a) { s.acct = a; s.render(); }).catch(function (e) { s.acct = { user_info: { status: 'ERROR ' + e.message, exp_date: 0, max_connections: '?' } }; s.render(); }); }
    s.render = function () { s.rows = rows(); var sb = $('settings-body'), keep = sb.scrollTop; sb.innerHTML = s.rows.map(function (r, i) { return '<div class="row' + (i === s.i ? ' focused' : '') + '"><span class="label">' + esc(r.label) + '</span><span class="val">' + esc(r.val) + '</span></div>'; }).join('');  sb.scrollTop = keep; };
    s.key = function (k) {
      if (k === 38) { s.i = Math.max(0, s.i - 1); s.render(); return true; }
      if (k === 40) { s.i = Math.min(s.rows.length - 1, s.i + 1); s.render(); return true; }
      if (k === 13) { s.rows[s.i].run(); return true; }
      if (k === 10009) { pop(); return true; }
      return false;
    };
    push(s); load();
  }

  function init() {
    var dt = document.querySelector('#home-tiles .tile[data-action=downloads]'); if (dt && window.PREVIEW && !window.IS_ANDROID) { dt.classList.remove('hidden'); var tt = dt.querySelector('.tile-title'); if (tt && !/on the TV/.test(tt.textContent)) { tt.innerHTML = 'Downloads on the TV<small id="dl-sum"></small>'; } }   // web: the TV's downloads, same screen as on the phone
    stack = [home()]; showCurrent();
    if (window.DL) { DL.init(); DL.onChange(function () { var c = current(); if (!c || !c.dlLive) return; if (window.PLAYER && PLAYER.isActive() && !PLAYER.isPreview()) return; if (c.render) c.render(); }); }
  }
  return { castRemote: castRemote, init: init, ask: ask, askKey: askKey, downloads: function () { downloads(); }, tvPoll: function () { tvPoll(true); }, favToggle: function (it) { var on = STORE.toggleFav(favEntry(it, it.group || (it.kind === 'live' ? 'Live' : null))); toast(on ? (it.kind === 'live' ? 'Added to My channels' : 'Added to favourites') : (it.kind === 'live' ? 'Removed from My channels' : 'Removed from favourites')); return on; }, search: function () { searchScreen(); }, openItem: function (it) { openItem(it); }, previewRect: previewRect, niceName: niceName, badCover: badCover, toast: toast, loading: loading, hideScreens: hideScreens, showCurrent: showCurrent, current: current, pop: pop, browse: browse, settings: settings };
})();
