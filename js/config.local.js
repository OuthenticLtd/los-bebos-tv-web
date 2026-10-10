// Web copy: no provider login here. First visit asks for a user name + password once; the browser then keeps an access token.
(function () {
  var API_BASE = 'https://trying-wal-pharmaceutical-thousands.trycloudflare.com';
  // the home address can change (laptop restart / network drop): read the current one, it is republished within ~30 s
  try { var x = new XMLHttpRequest(); x.open('GET', 'api-base.txt?t=' + Date.now(), false); x.send(); if (x.status === 200 && /^https:\/\//.test(x.responseText.trim())) API_BASE = x.responseText.trim(); } catch (e) {}
  window.REFRESH_HOME = function () { try { var y = new XMLHttpRequest(); y.open('GET', 'api-base.txt?t=' + Date.now(), false); y.send(); var b = y.responseText.trim(); if (y.status === 200 && /^https:\/\//.test(b) && b !== API_BASE) { API_BASE = b; window.LOCAL_CONFIG.server = b + '/api'; if (window.CONFIG) CONFIG.server = b + '/api'; return true; } } catch (e) {} return false; };
  var token = ''; try { token = localStorage.getItem('losbebos.token') || ''; } catch (e) {}
  window.LOCAL_CONFIG = { server: API_BASE + '/api', username: 'pages', password: token, posFactor: '1', liveFormat: 'm3u8' };
  window.PREVIEW = true;
  function showLogin(msg) {
    var old = document.getElementById('lb-login'); if (old) old.parentNode.removeChild(old);
    var d = document.createElement('div'); d.id = 'lb-login';
    d.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;background:#0b0e13;z-index:9999;display:flex;align-items:center;justify-content:center;font-family:sans-serif;color:#eee;';
    d.innerHTML = '<form style="width:min(420px,90vw);background:#161b22;border:1px solid #2a3340;border-radius:16px;padding:32px;display:flex;flex-direction:column;gap:14px;">' +
      '<div style="font-size:28px;font-weight:700;margin-bottom:6px;">Los Bebos TV</div>' +
      '<input name="u" placeholder="User name" autocomplete="username" autocapitalize="none" style="font-size:18px;padding:12px;border-radius:10px;border:1px solid #2a3340;background:#0b0e13;color:#fff;">' +
      '<input name="p" type="password" placeholder="Password" autocomplete="current-password" style="font-size:18px;padding:12px;border-radius:10px;border:1px solid #2a3340;background:#0b0e13;color:#fff;">' +
      '<button style="font-size:18px;padding:12px;border-radius:10px;border:0;background:#6fb3ff;color:#000;font-weight:600;cursor:pointer;">Enter</button>' +
      '<div id="lb-login-msg" style="color:#ff8a80;min-height:20px;font-size:14px;">' + (msg || '') + '</div></form>';
    (document.body || document.documentElement).appendChild(d);
    var f = d.querySelector('form'); f.addEventListener('submit', function (e) {
      e.preventDefault(); var u = f.u.value.trim(), p = f.p.value; if (!u || !p) return;
      f.querySelector('button').textContent = 'Checking...';
      fetch(API_BASE + '/api/login?u=' + encodeURIComponent(u) + '&p=' + encodeURIComponent(p), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j.token) throw new Error(j.error || 'wrong username or password');
        try { localStorage.setItem('losbebos.token', j.token); localStorage.setItem('losbebos.user', j.user); } catch (e2) {}
        location.reload();
      }).catch(function (e3) { f.querySelector('button').textContent = 'Enter'; document.getElementById('lb-login-msg').textContent = e3.message === 'Failed to fetch' ? 'Cannot reach the home laptop right now' : e3.message; });
    });
    setTimeout(function () { f.u.focus(); }, 50);
  }
  window.LOSBEBOS_LOGIN = function (msg) { try { localStorage.removeItem('losbebos.token'); } catch (e) {} showLogin(msg); };
  if (!token) document.addEventListener('DOMContentLoaded', function () { showLogin(''); });
})();
