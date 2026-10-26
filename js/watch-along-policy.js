// Pure ES5 policy shared by the TV, Android shim and browser. No network or device side effects.
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.WATCH_ALONG = factory(); }(this, function () {
  function finite(n) { return typeof n === 'number' && isFinite(n); }
  function range(raw) {
    var parts = String(raw || '').split('|'); if (parts.length !== 2) return null;
    var sa = parts[0].replace(/^START=/i, '').trim(), sb = parts[1].replace(/^END=/i, '').trim();
    if (!/^\d+(?:\.\d+)?$/.test(sa) || !/^\d+(?:\.\d+)?$/.test(sb)) return null;
    var a = Number(sa), b = Number(sb);
    return finite(a) && finite(b) && a >= 0 && b > a ? { start: a, end: b } : null;
  }
  function liveInfo(raw, position) { var r = range(raw); return r && finite(position) && position >= r.start && position <= r.end ? { start: r.start, end: r.end, position: position, latency: r.end - position } : null; }
  function decision(o) {
    var tv = o.tv || {}, now = o.now;
    var age = (finite(o.serverNow) ? o.serverNow : now) - tv.at;
    if (!finite(tv.at) || age < 0 || age > 6000 || now < (o.quietUntil || 0)) return { action: 'none' };
    if (tv.state !== 'paused' && tv.state !== 'playing') return { action: 'none' };
    if ((tv.state === 'paused') !== !!o.paused) return { action: tv.state === 'paused' ? 'pause' : 'resume' };
    if (o.paused || o.buffering || !o.moving || now - (o.lastSeek || 0) < 15000) return { action: 'none' };
    if (o.live) {
      // Independent live player clocks cannot be compared. Use validated distance from each DVR edge only.
      if (o.converted || !o.localLive || !tv.live || !finite(o.localLive.latency) || !finite(o.localLive.start) || !finite(o.localLive.end) || !finite(tv.live.latency) || tv.live.latency < 0) return { action: 'none' };
      var target = o.localLive.end - tv.live.latency;
      if (target < o.localLive.start + 1000 || target > o.localLive.end - 2000 || Math.abs(o.localLive.latency - tv.live.latency) < 10000) return { action: 'none' };
      return { action: 'seek', position: target };
    }
    var estimated = (tv.pos || 0) + (tv.state === 'playing' ? Math.min(6000, Math.max(0, age)) : 0);
    if (o.duration > 0 && Math.abs(estimated - o.position) > 5000) return { action: 'seek', position: Math.max(0, Math.min(o.duration - 1000, estimated)) };
    return { action: 'none' };
  }
  return { range: range, liveInfo: liveInfo, decision: decision };
}));
