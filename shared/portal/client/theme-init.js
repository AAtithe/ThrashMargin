// Applies the stored light or dark choice before first paint, so a page never flashes the wrong
// palette. A file rather than an inline script because the site's Content-Security-Policy forbids
// inline scripts (vercel.json). Same rules as colorScheme.ts: the tm_theme key if set, otherwise
// the operating system's preference.
(function () {
  var t = null;
  try { t = localStorage.getItem('tm_theme'); } catch (e) {}
  if (t !== 'light' && t !== 'dark') {
    t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = t;
  document.documentElement.style.colorScheme = t;
})();
