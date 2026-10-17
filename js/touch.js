// Touch input for phones (and mouse in the PC preview): tapping an item focuses it and presses OK; swiping a list
// moves the focus; tapping the video area toggles the player bar; tapping the seek bar seeks.
(function () {
  function key(code) { var ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true }); Object.defineProperty(ev, 'keyCode', { get: function () { return code; } }); document.dispatchEvent(ev); }
  function indexIn(el, sel) { var items = Array.prototype.filter.call(el.parentElement.children, function (c) { return c.matches(sel); }); return items.indexOf(el); }
  function tapList(listId, item, target) {
    var onCtl = !!(target && target.closest && target.closest('.rdl, .rbtn'));
    var s = UI.current(); if (!s) return false;
    var i = item.getAttribute('data-i') !== null ? Number(item.getAttribute('data-i')) : indexIn(item, '.row, .card');
    if (listId === 'country-list') { s.pane = 'countries'; s.coi = i; s.render(); key(13); return true; }
    if (listId === 'cat-list') { s.pane = 'cats'; s.ci = i; s.render(); key(13); return true; }
    if (listId === 'item-list') { if (s.rows) { s.ii = i; if (s.pane !== undefined) s.pane = 'list'; s.render(); key(13); return true; } s.pane = 'items'; s.ii = i; s.render(); key(13); return true; }
    if (listId === 'detail-episodes') { s.pane = 'eps'; s.ei = i; s.ecol = onCtl ? 1 : 0; s.render(); key(13); if (onCtl && s.dlConfirm) { /* first tap asks, the second tap on the same control confirms */ } return true; }
    if (listId === 'detail-seasons') { if (s.pickSeason) { s.pane = 'eps'; s.pickSeason(i); } return true; }
    if (listId === 'cast-btns') { if (s.tap) s.tap(i); return true; }
    if (listId === 'sr-body') { if (s.tap) s.tap(i); return true; }
    if (listId === 'dl-body') { if (s.tap) s.tap(i, target && target.closest && target.closest('.dl-more') ? 'more' : 'play'); return true; }
    if (listId === 'detail-actions') { s.pane = 'actions'; s.ai = indexIn(item, '.btn'); s.render(); key(13); return true; }
    if (listId === 'preview-btns') { s.pane = 'pbtns'; s.pbi = indexIn(item, '.btn'); s.render(); key(13); return true; }
    if (listId === 'home-tiles') { s.idx = indexIn(item, '.tile:not(.hidden)'); s.render(); key(13); return true; }   // hidden tiles (web: Downloads) do not count
    if (listId === 'settings-body') { s.i = indexIn(item, '.row'); s.render(); key(13); return true; }
    if (listId === 'browse-tabs') { key(indexIn(item, 'span') === 0 ? 37 : 39); return true; }
    return false;
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (PLAYER.isActive() && !PLAYER.isPreview()) {
      var cc = t.closest('.cc-btn'); if (cc) { PLAYER.centerAction(cc.getAttribute('data-cc')); return; }
      var cb = t.closest('.cbtn'); if (cb) { PLAYER.tapButton(indexIn(cb, '.cbtn')); return; }
      var tm = t.closest('.tm-item'); if (tm) { if (tm.classList.contains('dim') && /more/.test(tm.textContent)) { var col = tm.closest('.tm-col'); if (PLAYER.tapMenuColumn) PLAYER.tapMenuColumn(col); for (var j = 0; j < 6; j++) key(/\u2191/.test(tm.textContent) ? 38 : 40); return; } PLAYER.tapMenu(tm); return; }
      var pr = t.closest('.progress'); if (pr) { var r = pr.getBoundingClientRect(); PLAYER.tapSeek((e.clientX - r.left) / r.width); return; }
      if (t.closest('#player-top') || t.closest('#player-bottom') || t.closest('#track-menu')) return;
      // YouTube-style: double tap left/right third = -/+10 s (taps add up), single tap = show/hide the controls
      var app = document.getElementById('app').getBoundingClientRect(), fx = (e.clientX - app.left) / app.width;
      var side = fx < 0.35 ? -1 : fx > 0.65 ? 1 : 0, now = Date.now();
      if (side && dbl.side === side && now - dbl.t < 350) { clearTimeout(dbl.timer); dbl.n++; dbl.t = now; PLAYER.nudge(side * 10000); showDbl(side, dbl.n * 10); dbl.timer = setTimeout(function () { dbl.n = 0; dbl.side = 0; }, 700); return; }
      if (dbl.n && side === dbl.side && now - dbl.t < 700) { dbl.n++; dbl.t = now; clearTimeout(dbl.timer); PLAYER.nudge(side * 10000); showDbl(side, dbl.n * 10); dbl.timer = setTimeout(function () { dbl.n = 0; dbl.side = 0; }, 700); return; }
      dbl.side = side; dbl.t = now; dbl.n = 0; clearTimeout(dbl.timer);
      dbl.timer = setTimeout(function () { dbl.side = 0; PLAYER.tapScreen(); }, side ? 300 : 0); return;
    }
    var plot = t.closest('#detail-plot'); if (plot) { plot.classList.toggle('open'); return; }   // the description: tap to read all of it
    var item = t.closest('.row, .card, .tile, .btn, .tm-item, .tabs span, .season'); if (!item) return;
    var list = item.closest('#country-list, #cat-list, #item-list, #detail-episodes, #detail-actions, #preview-btns, #home-tiles, #settings-body, #browse-tabs, #dl-body, #sr-body, #detail-seasons, #cast-btns'); if (!list) return;
    if (item.classList.contains('hdr')) return;
    tapList(list.id, item, t);
  });
  // ---- scrolling lists by touch / wheel: the list itself moves (like a phone), the focus follows ----
  var LISTS = {
    'country-list': { pane: 'countries', win: 'cowin', idx: 'coi', arr: 'countries', vis: 13 },
    'cat-list': { pane: 'cats', win: 'cwin', idx: 'ci', arr: 'cats', vis: 13 },
    'item-list': { pane: 'items', win: 'iwin', idx: 'ii', arr: 'items', vis: 13 },
    'detail-episodes': { pane: 'eps', win: 'ewin', idx: 'ei', arr: 'eps', vis: 5 },
    'settings-body': { pane: null, win: null, idx: 'i', arr: 'rows', vis: 99 }
  };
  function scrollList(id, rows) {
    var s = UI.current(); var L = LISTS[id]; if (!s || !L || !rows) return;
    var arr = s[L.arr] || (id === 'item-list' && s.rows) || []; if (id === 'item-list' && s.rows) arr = s.rows;
    if (!arr.length) return;
    var grid = id === 'item-list' && !!document.querySelector('#item-list .grid');
    var cols = grid ? 5 : 1, vis = grid ? 2 : (document.querySelectorAll('#' + id + ' .row, #' + id + ' .hdr').length || L.vis);
    if (L.pane && s.pane !== undefined && !(id === 'item-list' && s.rows)) s.pane = L.pane;
    if (s.rows && id === 'item-list' && s.pane !== undefined) s.pane = 'list';
    var win = L.win ? s[L.win] : null;
    if (win) {
      var totalRows = Math.ceil(arr.length / cols), maxOff = Math.max(0, totalRows - vis);
      var off = Math.max(0, Math.min(maxOff, win.offset + rows));
      var moved = off - win.offset; win.offset = off;
      var idx = s[L.idx] + moved * cols; var lo = off * cols, hi = Math.min(arr.length - 1, (off + vis) * cols - 1);
      if (moved === 0) idx = s[L.idx] + rows * cols;
      s[L.idx] = Math.max(lo, Math.min(hi, Math.max(0, Math.min(arr.length - 1, idx))));
    } else s[L.idx] = Math.max(0, Math.min(arr.length - 1, s[L.idx] + rows));
    if (s.rows && s.rows[s[L.idx]] && s.rows[s[L.idx]].header) s[L.idx] = Math.min(arr.length - 1, s[L.idx] + (rows > 0 ? 1 : -1 >= 0 ? 1 : 1));
    if (s.rows && s.rows[s[L.idx]] && s.rows[s[L.idx]].header && s[L.idx] > 0) s[L.idx]--;
    s.render();
  }
  function zoneOf(el) { return null; }   // lists scroll natively on touch devices (see ui.js renderAll)
  function menuScroll(colEl, rows) { if (PLAYER.tapMenuColumn && colEl) PLAYER.tapMenuColumn(colEl); for (var i = 0; i < Math.abs(rows); i++) key(rows > 0 ? 40 : 38); }
  document.addEventListener('wheel', function (e) {
    var z = zoneOf(e.target); if (!z) return;   // native e.preventDefault();
    var rows = (e.deltaY > 0 ? 1 : -1) * Math.max(1, Math.min(4, Math.round(Math.abs(e.deltaY) / 80)));
    if (z.id === 'track-menu') menuScroll(e.target.closest('.tm-col'), rows); else scrollList(z.id, rows);
  }, { passive: false });
  // touch: drag to scroll (with a short glide on a fast flick), tap to select
  var T = null;
  function designPx() { return 1080 / window.innerHeight * (window.innerHeight / 1080) * ((document.getElementById('app').getBoundingClientRect().height || 1080) / 1080); }
  // the touched row may be redrawn (removed) while scrolling; touch events keep going to that element, so listen on it directly
  document.addEventListener('touchstart', function (e) {
    var z = zoneOf(e.target); var t = e.touches[0];
    T = { z: z, y: t.clientY, x: t.clientX, acc: 0, moved: false, lastY: t.clientY, lastT: Date.now(), v: 0, col: e.target.closest && e.target.closest('.tm-col'), seek: e.target.closest && e.target.closest('.progress') };
    var el = e.target; el.addEventListener('touchmove', onMove, { passive: false }); el.addEventListener('touchend', function fin() { el.removeEventListener('touchmove', onMove); el.removeEventListener('touchend', fin); el.removeEventListener('touchcancel', fin); onEnd(); }); el.addEventListener('touchcancel', function fin2() { el.removeEventListener('touchmove', onMove); onEnd(); });
  }, { passive: true });
  function onMove(e) {
    if (!T) return; var t = e.touches[0];
    if (T.seek && PLAYER.isActive()) { var r = T.seek.getBoundingClientRect(); PLAYER.tapSeek && PLAYER.dragSeek && PLAYER.dragSeek(Math.max(0, Math.min(1, (t.clientX - r.left) / r.width))); T.moved = true; e.preventDefault(); return; }
    if (!T.z) return;
    e.preventDefault();
    var dy = T.lastY - t.clientY, now = Date.now(); T.v = dy / Math.max(1, now - T.lastT); T.lastY = t.clientY; T.lastT = now;
    if (Math.abs(t.clientY - T.y) > 8) T.moved = true;
    var rowPx = 64 * designPx(); T.acc += dy;
    var rows = 0; while (T.acc >= rowPx) { T.acc -= rowPx; rows++; } while (T.acc <= -rowPx) { T.acc += rowPx; rows--; }
    if (rows) { if (T.z.id === 'track-menu') menuScroll(T.col, rows); else scrollList(T.z.id, rows); }
  }
  function onEnd() {
    if (!T) return; var z = T.z, v = T.v, col = T.col, seekDrag = T.seek && T.moved; T.endedMoving = T.moved; var wasMoving = T.moved; T = null;
    if (seekDrag && PLAYER.endDragSeek) { PLAYER.endDragSeek(); }
    if (z && wasMoving && Math.abs(v) > 0.6) {   // glide
      var extra = Math.min(12, Math.round(Math.abs(v) * 6)), dir = v > 0 ? 1 : -1, n = 0;
      (function step() { if (n++ >= extra) return; if (z.id === 'track-menu') menuScroll(col, dir); else scrollList(z.id, dir); setTimeout(step, 30 + n * 12); })();
    }
    if (wasMoving) { suppressClick = Date.now(); }
  }
  var suppressClick = 0;
  var dbl = { side: 0, t: 0, n: 0, timer: 0 }, dblEl = null, dblHide = 0;
  function showDbl(side, secs) {
    if (!dblEl) { dblEl = document.createElement('div'); document.getElementById('app').appendChild(dblEl); }
    dblEl.className = 'dbl-ind ' + (side < 0 ? 'left' : 'right'); dblEl.textContent = (side < 0 ? '\u00ab ' : '') + secs + ' s' + (side > 0 ? ' \u00bb' : ''); dblEl.style.display = 'flex';
    clearTimeout(dblHide); dblHide = setTimeout(function () { dblEl.style.display = 'none'; }, 700);
  }
  document.addEventListener('click', function (e) { if (Date.now() - suppressClick < 400) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  // on-screen back button for the web only (the phone has Android's own Back button)
  if (window.PREVIEW && !window.IS_ANDROID) {
    var back = document.createElement('div'); back.id = 'touch-back'; back.textContent = '←'; back.title = 'Back';
    var big = !!window.IS_ANDROID || document.documentElement.classList.contains('web-phone'), sz = big ? 104 : 64;   // the web copy on a phone gets the phone-sized button too
    back.style.cssText = 'position:absolute;right:36px;bottom:30px;width:' + sz + 'px;height:' + sz + 'px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(29,35,43,.85);color:#fff;font-size:' + (big ? 54 : 34) + 'px;line-height:1;z-index:50;cursor:pointer;';
    back.innerHTML = '<svg viewBox="0 0 24 24" width="55%" height="55%"><path d="M15.5 4.5 8 12l7.5 7.5" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    back.addEventListener('click', function (e) { e.stopPropagation(); key(10009); });
    window.addEventListener('load', function () { document.getElementById('app').appendChild(back); });
  }
})();
