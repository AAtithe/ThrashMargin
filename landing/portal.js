// The welcome page's scripts. External rather than inline so the site's Content-Security-Policy
// can forbid inline scripts everywhere (vercel.json): an injected inline script is then refused.
//
// Loaded twice: in <head> (session check, before anything renders) and at the end of <body>
// (the account bar), told apart by data-part on the script tag.
(function () {
  // slug: the saves endpoint, /api/play/<slug> (api/play/[kind].ts). path: the game's client.
  // direct: its router opens a save at <path>game/<id>; The Founder's Ledger has one ledger per
  // account and no router, so it opens at its own address.
  var RESUME_GAMES = {
    thrash_margin: { slug: 'thrash-margin', path: '/thrash-margin/', img: 'thrash-margin', direct: true },
    niccolo: { slug: 'niccolo', path: '/niccolo/', img: 'niccolo', direct: true },
    niccolo_rising: { slug: 'niccolo-rising', path: '/rising/', img: 'niccolo-rising', direct: true },
    tea_race: { slug: 'tea-race', path: '/tea-race/', img: 'tea-race', direct: true },
    steady_eddie: { slug: 'steady-eddie', path: '/steady-eddie/', img: 'steady-eddie', direct: true },
    fireline: { slug: 'fireline', path: '/fireline/', img: 'fireline', direct: true },
    founders_ledger: { slug: 'founders-ledger', path: '/founders-ledger/', img: 'founders-ledger', direct: false },
  };
  var RESUME_KEY = 'tm_portal_resume';
  var REQUEST_TIMEOUT = 10000;

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
      // Only the games this account has access to are shown (set per account on the Admin page).
      // A courtesy again: /api/play refuses any game the account does not have. A session from
      // before game access existed has no list, and shows every game until the profile answers.
      function showGames(games) {
        if (!Array.isArray(games)) return;
        var cards = document.querySelectorAll('a.card[data-game]');
        var shown = 0;
        for (var i = 0; i < cards.length; i++) {
          var on = games.indexOf(cards[i].getAttribute('data-game')) !== -1;
          cards[i].hidden = !on;
          if (on) shown++;
        }
        document.getElementById('no-games').hidden = shown > 0;
      }
      showGames(u.games);
      var resume = continueCard(u);
      // A session from before game access existed has no list: wait for the profile's answer
      // rather than ask for saves of games the account may not have.
      if (Array.isArray(u.games)) resume.update(u.games, true);
      fetch('/api/profile', { headers: { Authorization: 'Bearer ' + localStorage.getItem('tm_token') } })
        .then(function (r) {
          // Refused: the session has ended (suspended by an admin, password changed elsewhere, account
          // deleted). Sign out here too, rather than show a portal every game will refuse.
          if (r.status === 401) {
            signOut();
            return null;
          }
          return r.ok ? r.json() : null;
        })
        .then(function (p) {
          if (!p || typeof p.isAdmin !== 'boolean') {
            // No answer: go by the cards as shown, which is what the account can see.
            resume.update(visibleGames(), false);
            return;
          }
          adminLink.hidden = !p.isAdmin;
          showGames(p.games);
          resume.update(visibleGames(), false);
          // Stored, so the lobbies (session.ts, hasGameAccess) see the same list.
          if (p.isAdmin !== u.isAdmin || JSON.stringify(p.games) !== JSON.stringify(u.games)) {
            u.isAdmin = p.isAdmin;
            if (Array.isArray(p.games)) u.games = p.games;
            localStorage.setItem('tm_user', JSON.stringify(u));
          }
        })
        .catch(function () {
          resume.update(visibleGames(), false);
        });
      // Light or dark, shared with every game through the same tm_theme key (theme-init.js).
      var toggle = document.getElementById('theme-toggle');
      function label() {
        var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        toggle.textContent = next === 'light' ? 'Light mode' : 'Dark mode';
        toggle.title = 'Switch to ' + next + ' mode';
        return next;
      }
      label();
      toggle.addEventListener('click', function () {
        var next = label();
        try { localStorage.setItem('tm_theme', next); } catch (e) {}
        document.documentElement.dataset.theme = next;
        document.documentElement.style.colorScheme = next;
        label();
      });
      function signOut() {
        try {
          ['tm_token', 'tm_user', 'tm_last_active', RESUME_KEY].forEach(function (k) { localStorage.removeItem(k); });
        } catch (e) {}
        window.location.replace('/thrash-margin/login?next=/');
      }
      document.getElementById('sign-out').addEventListener('click', signOut);
    })();
  }

  // ---- Continue where you left off ----------------------------------------------------------
  //
  // Asks each game the account can play for its saves list (the same GET /api/play/<slug> and the
  // same Bearer token the games' own lobbies send) and names the most recently played unfinished
  // save. In parallel, never blocking the page: nothing shows until there is something to show,
  // and nothing at all when there are no saves or every request fails. The last answer is kept in
  // this browser so a returning visitor's card is there on first paint instead of pushing the
  // cards down a moment later; the live answer then replaces it.

  function visibleGames() {
    var out = [];
    var cards = document.querySelectorAll('a.card[data-game]');
    for (var i = 0; i < cards.length; i++) if (!cards[i].hidden) out.push(cards[i].getAttribute('data-game'));
    return out;
  }

  function ago(ms) {
    var s = (Date.now() - ms) / 1000;
    if (!(s >= 60)) return 'just now';
    var m = Math.floor(s / 60);
    if (m < 60) return m === 1 ? 'a minute ago' : m + ' minutes ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h === 1 ? 'an hour ago' : h + ' hours ago';
    var d = Math.floor(h / 24);
    if (d === 1) return 'yesterday';
    if (d < 7) return d + ' days ago';
    if (d < 28) return Math.floor(d / 7) === 1 ? 'a week ago' : Math.floor(d / 7) + ' weeks ago';
    var when = new Date(ms);
    var opts = { day: 'numeric', month: 'long' };
    if (when.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    try { return 'on ' + when.toLocaleDateString('en-GB', opts); } catch (e) { return 'on ' + when.toDateString(); }
  }

  function continueCard(user) {
    var section = document.getElementById('continue');
    var link = document.getElementById('continue-link');
    var token = null;
    try { token = localStorage.getItem('tm_token'); } catch (e) {}
    var allowed = [];
    var requested = {};
    var results = {}; // game key -> saves array, or null when its request failed
    var pending = 0;

    function cardFor(key) {
      return document.querySelector('a.card[data-game="' + key + '"]');
    }

    function show(pick, fresh) {
      var g = RESUME_GAMES[pick.game];
      var card = cardFor(pick.game);
      var label = card ? card.querySelector('h2').textContent : pick.game;
      var name = typeof pick.name === 'string' && pick.name.trim() ? pick.name.trim() : label;
      var played = ago(pick.savedAt);
      link.className = 'card resume ' + (card ? card.className.replace(/\bcard\b/, '').trim() : '');
      link.href = g.direct ? g.path + 'game/' + encodeURIComponent(pick.id) : g.path;
      document.getElementById('continue-light').src = '/img/' + g.img + '-light.webp';
      document.getElementById('continue-dark').src = '/img/' + g.img + '-dark.webp';
      document.getElementById('continue-name').textContent = name;
      var detail = (name === label ? 'Played ' : label + ', played ') + played;
      document.getElementById('continue-detail').textContent = detail;
      link.setAttribute('aria-label', 'Continue ' + (name === label ? label : name + ' in ' + label) + ', played ' + played);
      if (section.hidden && fresh) section.classList.add('fresh');
      section.hidden = false;
    }

    function hide() {
      section.hidden = true;
    }

    function remember(pick) {
      try {
        if (pick) {
          localStorage.setItem(RESUME_KEY, JSON.stringify({
            userId: user.userId, game: pick.game, id: pick.id, name: pick.name, savedAt: pick.savedAt,
          }));
        } else {
          localStorage.removeItem(RESUME_KEY);
        }
      } catch (e) {}
    }

    function valid(save) {
      return save && typeof save.id === 'string' && save.id &&
        typeof save.savedAt === 'number' && isFinite(save.savedAt) &&
        // Unfinished games only: a won or lost one is not somewhere to carry on from.
        (save.status === undefined || save.status === 'active');
    }

    function render() {
      var best = null;
      for (var i = 0; i < allowed.length; i++) {
        var key = allowed[i];
        var saves = results[key];
        if (!Array.isArray(saves) || !RESUME_GAMES[key]) continue;
        for (var j = 0; j < saves.length; j++) {
          var s = saves[j];
          if (!valid(s)) continue;
          if (!best || s.savedAt > best.savedAt) {
            best = { game: key, id: s.id, name: s.name, savedAt: s.savedAt };
          }
        }
      }
      if (best) show(best, true);
      else hide();
      remember(best);
    }

    function request(key) {
      var g = RESUME_GAMES[key];
      requested[key] = true;
      pending++;
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, REQUEST_TIMEOUT);
      fetch('/api/play/' + g.slug, {
        headers: { Authorization: 'Bearer ' + token },
        signal: ctrl ? ctrl.signal : undefined,
      })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { results[key] = d && Array.isArray(d.saves) ? d.saves : null; })
        .catch(function () { results[key] = null; })
        .then(function () {
          clearTimeout(timer);
          pending--;
          // Chosen once every game has answered, so the card does not change its mind mid-load.
          if (pending === 0) render();
        });
    }

    // A previous visit's answer, shown at once while the live one loads; only for this account,
    // and only for a game it can still see.
    function fromCache(games) {
      var c = null;
      try { c = JSON.parse(localStorage.getItem(RESUME_KEY) || 'null'); } catch (e) {}
      if (!c || c.userId !== user.userId || !RESUME_GAMES[c.game] || games.indexOf(c.game) === -1) return;
      if (typeof c.id !== 'string' || typeof c.savedAt !== 'number') return;
      show(c, false);
    }

    return {
      // games: the keys the account can see right now. first: the stored list, before the profile.
      update: function (games, first) {
        if (!token || !Array.isArray(games)) return;
        allowed = games.filter(function (k) { return RESUME_GAMES[k]; });
        if (first) fromCache(allowed);
        var started = false;
        for (var i = 0; i < allowed.length; i++) {
          if (!requested[allowed[i]]) { request(allowed[i]); started = true; }
        }
        // Nothing new to ask: re-choose now, in case a game was taken away.
        if (!started && pending === 0) {
          if (allowed.length) render();
          else { hide(); }
        }
      },
    };
  }
})();
