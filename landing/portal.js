// The welcome page's scripts. External rather than inline so the site's Content-Security-Policy
// can forbid inline scripts everywhere (vercel.json): an injected inline script is then refused.
//
// Loaded twice: in <head> (session check, before anything renders) and at the end of <body>
// (the account bar), told apart by data-part on the script tag.
(function () {
  var part = document.currentScript && document.currentScript.getAttribute('data-part');
  if (part === 'session') {
    // Sign-in is required for the whole portal. This runs before anything renders: no valid
    // session, straight to the sign-in page, which returns here afterwards. The same rules as the
    // games' session helper (shared/portal/client/session.ts): 12 hours from sign-in, 60 minutes
    // idle, and a session from before those limits counts as expired.
    (function () {
      var TOKEN = 'tm_token', USER = 'tm_user', ACTIVE = 'tm_last_active';
      function expired() {
        try {
          var token = localStorage.getItem(TOKEN);
          if (!token) return true;
          var payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
          if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) return true;
          var last = Number(localStorage.getItem(ACTIVE));
          if (!last || Date.now() - last > 60 * 60 * 1000) return true;
          var u = JSON.parse(localStorage.getItem(USER) || 'null');
          return !u || typeof u.isAdmin !== 'boolean';
        } catch (e) {
          return true;
        }
      }
      if (expired()) {
        try { [TOKEN, USER, ACTIVE].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
        window.location.replace('/thrash-margin/login?next=/');
        return;
      }
      try { localStorage.setItem(ACTIVE, String(Date.now())); } catch (e) {}
      window.__portalUser = JSON.parse(localStorage.getItem(USER));
    })();
  } else if (part === 'account') {
    (function () {
      var u = window.__portalUser;
      if (!u) return;
      document.getElementById('signed-in-as').textContent = 'Signed in as ' + u.username;
      // Shown to admins only, as a courtesy: the admin endpoints check users.role on every request.
      var adminLink = document.getElementById('admin-link');
      adminLink.hidden = u.isAdmin !== true;
      // Re-asked of the server on every visit, so a role granted or removed since sign-in shows
      // here without signing out and back in.
      fetch('/api/profile', { headers: { Authorization: 'Bearer ' + localStorage.getItem('tm_token') } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (p) {
          if (!p || typeof p.isAdmin !== 'boolean') return;
          adminLink.hidden = !p.isAdmin;
          if (p.isAdmin !== u.isAdmin) {
            u.isAdmin = p.isAdmin;
            localStorage.setItem('tm_user', JSON.stringify(u));
          }
        })
        .catch(function () {});
      document.getElementById('sign-out').addEventListener('click', function () {
        ['tm_token', 'tm_user', 'tm_last_active'].forEach(function (k) { localStorage.removeItem(k); });
        window.location.replace('/thrash-margin/login?next=/');
      });
    })();
  }
})();
