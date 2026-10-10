// TV side of "Play on the TV": while the app is open it asks the home laptop for commands from the phone / web every
// 2 s (one tiny request on the home network) and plays the video itself, straight from the provider.
(function () {
  if (window.IS_ANDROID || window.PREVIEW) return;
  var R = function () { return CONFIG.relay ? CONFIG.relay.replace(/\/+$/, '') : null; };
  var last = 0; try { last = Number(localStorage.getItem('doortv.castSeq') || 0); } catch (e) {}
  var first = true, lastReport = 0, along = false;
  window.TV_STATE_CHANGED = function () { if (along) { lastReport = Date.now(); report(last); } };   // pause / seek: tell the followers at once
  function report(seq) {
    try { var s = PLAYER.status(), x = new XMLHttpRequest(); x.open('POST', R() + '/relay/cast', true);
      x.send(JSON.stringify({ seq: seq, state: s.active ? (s.paused ? 'paused' : 'playing') : 'idle', title: s.title, key: PLAYER.currentKey ? PLAYER.currentKey() : null, pos: s.time, dur: s.duration, note: PLAYER.note ? PLAYER.note() : '', at: Date.now() })); } catch (e) {}
  }
  function handle(c) {
    if (c.cmd === 'play' && c.item) {
      if (c.item.kind !== 'live') STORE.setPosition(c.item.kind + ':' + c.item.id, Number(c.pos) || 0);   // exactly where the phone was (0 = from the start)
      if (PLAYER.isActive()) PLAYER.stop(true);
      PLAYER.play(c.item, c.playlist || null, typeof c.index === 'number' ? c.index : -1, { dlOk: true });
      UI.toast('From the phone: ' + c.item.name, 3000);
    } else if (c.cmd === 'pause' || c.cmd === 'resume') { var s = PLAYER.status(); if (s.active && (c.cmd === 'pause') !== s.paused) PLAYER.togglePause(); }
    else if (c.cmd === 'seek' && PLAYER.nudge) PLAYER.nudge(Number(c.delta) || 0);
    else if (c.cmd === 'seekTo' && PLAYER.seekTo) PLAYER.seekTo(Number(c.pos) || 0);
    else if (c.cmd === 'share' && c.item && c.path) {   // a phone watches along: move onto the laptop's shared copy at the same spot (the provider sees one stream)
      var s0 = PLAYER.status(), cur = PLAYER.currentKey ? PLAYER.currentKey() : null;
      if (s0.active && cur === c.item.kind + ':' + c.item.id && !(PLAYER.isLocal && PLAYER.isLocal())) {   // a copy from the stick stays as it is (it holds no stream)
        if (s0.time > 0 && c.item.kind !== 'live') STORE.setPosition(cur, s0.time);
        PLAYER.play(Object.assign({}, c.item, { shareUrl: R() + c.path }), PLAYER.playlistNow ? PLAYER.playlistNow() : null, PLAYER.indexNow ? PLAYER.indexNow() : -1, { dlOk: true, keepPaused: s0.paused });
        UI.toast('Watching along with the phone', 3000);
      }
    }
    else if (c.cmd === 'stop') { if (PLAYER.isActive()) PLAYER.stop(); }
    else if (c.cmd === 'dlcancel' && c.key && window.DL) { var e0 = DL.list().filter(function (e) { return e.key === c.key; })[0]; if (e0) { DL.removeKey(c.key); UI.toast((e0.state === 'done' ? 'Deleted from the phone: ' : 'Cancelled from the phone: ') + (e0.title || e0.name || ''), 3500); } }
    else if (c.cmd === 'download' && window.DL) { var its = (c.items || [c.item]).filter(Boolean); its.forEach(function (x) { try { DL.add(x); } catch (e) {} }); if (its.length) UI.toast('Download from the phone: ' + (its.length === 1 ? its[0].name : its.length + ' episodes'), 3500); }
  }
  function poll() {
    if (!R()) return;
    if (document.hidden) return setTimeout(poll, 4000);
    var x = new XMLHttpRequest(); x.open('GET', R() + '/relay/cast', true); x.timeout = 4000;
    x.onload = function () {
      var c = null; try { c = JSON.parse(x.responseText); } catch (e) {}
      if (c && c.seq > last) {
        var fresh = c.cmd === 'download' || c.cmd === 'dlcancel' || Date.now() - (c.t || 0) < (first ? 180000 : 30000);   // just opened for this command: it is still wanted; a download request keeps until the app next opens (queuing it is harmless)
        last = c.seq; try { localStorage.setItem('doortv.castSeq', String(last)); } catch (e) {}
        if (fresh) { try { handle(c); } catch (e) {} setTimeout(function () { report(last); }, 1500); }
      } else if (c && c.seq < last) { last = c.seq; }   // the laptop restarted: count from its number again
      first = false;
      along = !!(c && c.along);
      if (Date.now() - lastReport > (along ? 1500 : 5000) && PLAYER.isActive()) { lastReport = Date.now(); report(last); }
      setTimeout(poll, along ? 1500 : 3000);   // someone watches along: report often so they stay in step
    };
    x.onerror = x.ontimeout = function () { setTimeout(poll, 5000); };
    x.send();
  }
  setTimeout(poll, 2500);
})();
