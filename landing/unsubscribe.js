// The unsubscribe page's one job: send the token from the link to the API, and say what happened.
// External rather than inline because the site's Content-Security-Policy forbids inline scripts.
// No sign-in needed: the token can only turn this account's news emails off (api/news/[action].ts).
(function () {
  var status = document.getElementById('status');
  function show(text, cls) { status.textContent = text; status.className = cls || ''; }
  var token = new URLSearchParams(window.location.search).get('token') || '';
  if (!/^[0-9a-f]{48}$/.test(token)) return show('This unsubscribe link is not complete. Copy the whole link from the email, or turn emails off on your Profile page.', 'bad');
  fetch('/api/news/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token }) })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
    .then(function (x) {
      if (x.ok) show('Done. You will not receive any more news emails.', 'ok');
      else show(x.d.message || 'That did not work. Turn emails off on your Profile page instead.', 'bad');
    })
    .catch(function () { show('Could not reach the portal. Try again in a moment, or turn emails off on your Profile page.', 'bad'); });
})();
