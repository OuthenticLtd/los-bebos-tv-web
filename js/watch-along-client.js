(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.WATCH_ALONG_CLIENT = factory(); }(this, function () {
  function create(o) {
    var fetcher = o.fetch, later = o.setTimeout || setTimeout, clear = o.clearTimeout || clearTimeout, clock = o.now || Date.now;
    function error(message, code) { var e = new Error(message); e.code = code; return e; }
    function json(url, init) {
      init = init || {}; var opts = {}, k; for (k in init) opts[k] = init[k];
      var controller = o.AbortController ? new o.AbortController() : null; if (controller) opts.signal = controller.signal;
      return new Promise(function (resolve, reject) {
        var done = false, timer = later(function () { if (done) return; done = true; if (controller) controller.abort(); reject(error('The home relay did not answer in time.', 'TIMEOUT')); }, o.requestTimeoutMs || 6000);
        function finish(fn, value) { if (done) return; done = true; clear(timer); fn(value); }
        Promise.resolve().then(function () { return fetcher(url, opts); }).then(function (r) { if (!r.ok) throw error('The home relay returned HTTP ' + r.status + '.', 'HTTP'); return r.json(); }).then(function (j) { finish(resolve, j); }, function (e) { finish(reject, e); });
      });
    }
    function ready(url, current) {
      var end = clock() + (o.shareTimeoutMs || 25000);
      function check(j) {
        if (!current()) throw error('Watch along cancelled.', 'CANCELLED');
        if (!j || !j.item) throw error('The TV is not playing anything right now.', 'IDLE');
        if (j.sharedReady === true) return j;
        if (clock() >= end) throw error('The TV has not confirmed shared playback. Please try Watch along again.', 'NOT_READY');
        return new Promise(function (resolve) { later(resolve, o.pollIntervalMs || 1000); }).then(function () {
          if (!current()) throw error('Watch along cancelled.', 'CANCELLED');
          return json(url, { cache: 'no-store' });
        }).then(check);
      }
      return json(url, { method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' } }).then(check);
    }
    return { json: json, ready: ready };
  }
  return { create: create };
}));
