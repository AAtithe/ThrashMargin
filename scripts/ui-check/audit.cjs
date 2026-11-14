// The in-page half of scripts/ui-check.cjs: measures one rendered screen and returns plain data.
//
// `audit` is handed to page.evaluate, which sends its source text to the browser, so it must be
// self-contained: no closures over this module, no require. Everything it needs is defined inside.
//
// What it measures, and what it deliberately leaves out (each exclusion is a false positive that
// was confirmed by looking at the screen, not a way to make a real failure go away):
//
//   Sideways scroll   documentElement.scrollWidth against innerWidth. Content that scrolls inside
//                     its own overflow-x: auto/scroll box never reaches documentElement.scrollWidth,
//                     so it is allowed without any special case. When the page does scroll, the
//                     elements poking past the right edge (and not clipped by an ancestor) are named.
//
//   Text contrast     Every visible text node, plus the value or placeholder of text fields and
//                     selects, against the colour actually underneath it: the ancestor chain's
//                     backgrounds composited (alpha and opacity both) down to the first opaque one.
//                     Excluded:
//                       - text inside <svg> or <canvas>: map art and diagrams. Its "background" is
//                         drawn shapes, which the ancestor chain cannot see, so any figure would be
//                         invented. (The brief names canvas and SVG map art.)
//                       - text under aria-hidden="true": decorative by the author's own declaration.
//                       - disabled controls (:disabled, inside a disabled fieldset, aria-disabled):
//                         WCAG 1.4.3 exempts inactive components.
//                       - visually hidden text (a 1px box, clip, or visibility/opacity hiding it):
//                         screen-reader-only labels are never painted.
//                       - text over a background image (url()) in its chain, or laid over a <canvas>,
//                         <img> or <video>: the pixels under it are unknown. Counted and reported as
//                         "unmeasured", never silently passed. (Fireline's "Radar offline", light
//                         text over the radar's dark static, read 1.1:1 against the panel behind.)
//                     Gradients are measured against every colour stop and the worst one counts.
//
//   Tap targets       (phone width only) buttons, [role=button|tab|switch|checkbox|radio|menuitem],
//                     links, inputs, selects, textareas and <summary>: the box, or the hit area,
//                     must be at least 40px tall. The hit area also counts a wrapping or for= <label>
//                     (clicking it operates the control) and an absolutely positioned ::before or
//                     ::after (the usual way to enlarge a small control's hit area without moving it).
//                     Excluded:
//                       - links and buttons inline in running text (WCAG 2.5.8's inline exception):
//                         an element whose display is inline (or a button inside a <p>) whose block
//                         container holds other words besides it.
//                       - disabled controls, invisible ones, and ones entirely above or left of the
//                         page (skip links parked off screen until focused).
//                       - input[type=hidden] and inputs with opacity 0 that sit inside a <label>
//                         (themed checkboxes: the label is what is painted and tapped, and it is
//                         measured as the hit area of the input instead).
'use strict';

function audit(opts) {
  const MIN_TARGET = opts.minTarget;
  // A scoped screen (the tour card) measures only inside that element; sideways scroll stays global.
  const scope = (opts.scope && document.querySelector(opts.scope)) || document.body;
  const W = window.innerWidth;

  // --- selectors -------------------------------------------------------------------------------
  function part(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) return `${s}#${el.id}`;
    const tid = el.getAttribute('data-testid');
    if (tid) return `${s}[data-testid=${tid}]`;
    const cls = [...el.classList].filter(c => !/^(css|sc|jsx)-/.test(c)).slice(0, 2);
    if (cls.length) s += '.' + cls.join('.');
    return s;
  }
  function sel(el) {
    const parts = [];
    let e = el;
    for (let i = 0; e && e.nodeType === 1 && i < 4; i++, e = e.parentElement) {
      const p = part(e);
      parts.unshift(p);
      if (p.includes('#') || p.includes('[data-testid')) break;
      if (e.tagName === 'BODY') break;
    }
    return parts.join(' > ');
  }
  const short = t => (t || '').replace(/\s+/g, ' ').trim().slice(0, 50);

  // --- colour ----------------------------------------------------------------------------------
  const cache = new Map();
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  function parse(str) {
    if (cache.has(str)) return cache.get(str);
    let c = null;
    let m = str.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
    if (m) c = [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]];
    if (!c) {
      m = str.match(/^color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/);
      if (m) c = [m[1] * 255, m[2] * 255, m[3] * 255, m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]];
    }
    if (!c) {
      // Any other colour space (oklch, color-mix, lab): let the browser convert it. The alpha
      // read back from a canvas is 8-bit, which is plenty for a pass/fail at 4.5:1.
      cx.clearRect(0, 0, 1, 1);
      cx.fillStyle = '#000';
      cx.fillStyle = str;
      cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data;
      c = [d[0], d[1], d[2], d[3] / 255];
    }
    cache.set(str, c);
    return c;
  }
  const over = (top, under) => {
    const a = top[3];
    return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
  };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 1];
  const lum = c => {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hex = c => '#' + c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const gradStops = img => (img.match(/(rgba?\([^)]*\)|color\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\))/g) || []).map(parse);

  /**
   * The chain from the text's element up to the first fully opaque, fully opaque-opacity background.
   * Returns null when a background image is in the way (unmeasurable).
   */
  function chain(el) {
    const out = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const bg = parse(cs.backgroundColor);
      const img = cs.backgroundImage;
      let grads = null;
      if (img && img !== 'none') {
        if (/url\(/.test(img)) return null;
        grads = gradStops(img);
        if (!grads.length) grads = null;
      }
      const op = parseFloat(cs.opacity);
      out.push({ el: e, bg, grads, op });
      const gradOpaque = grads && grads.every(g => g[3] >= 1);
      if ((bg[3] >= 1 || gradOpaque) && op >= 1) return out;
    }
    // Nothing opaque: the canvas behind the page is white.
    out.push({ el: document.documentElement, bg: [255, 255, 255, 1], grads: null, op: 1 });
    return out;
  }

  /** [textPixel, backgroundPixel] pairs (one per gradient stop combination). */
  function pixels(ch, text) {
    const n = ch.length - 1;
    const choices = [];
    // One pass per gradient stop, on the nearest gradient only (more than one stacked gradient
    // under text does not occur here; the rest fall back to their first stop).
    const gi = ch.findIndex(l => l.grads);
    const stops = gi >= 0 ? ch[gi].grads : [null];
    for (const stop of stops) {
      const layerColour = (i, below) => {
        let c = over(ch[i].bg, below);
        const g = ch[i].grads;
        if (g) c = over(i === gi ? stop : g[0], c);
        return c;
      };
      const paint = (i, below, withText) => {
        let c = layerColour(i, below);
        c = i === 0 ? (withText ? over(text, c) : c) : paint(i - 1, c, withText);
        return mix(below, c, ch[i].op);
      };
      let base = layerColour(n, [255, 255, 255, 1]);
      if (n === 0) choices.push([over(text, base), base]);
      else choices.push([paint(n - 1, base, true), paint(n - 1, base, false)]);
    }
    return choices;
  }

  // Canvases, images and videos are painted pixels the ancestor chain cannot see. Text laid over
  // one (Fireline's "Radar offline" over the radar's static, a caption over the battlefield) sits
  // on whatever the media draws there, so it is counted as unmeasured rather than compared with
  // the panel colour behind the media, which is what the chain would find (confirmed on screen:
  // light-on-dark text read as 1.1:1). SVG is deliberately not in this list: the games' chart SVGs
  // fill with the same sea colour as their container, and the zoom buttons over them measure true.
  const media = [...document.querySelectorAll('canvas, img, video')]
    .map(m => ({ m, r: m.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 4 && r.height > 4);
  // Only media inside the opaque element the chain stopped at can be painted between that
  // background and the text; a tour card with its own opaque fill over the battlefield canvas is
  // measured normally.
  function overMedia(el, base) {
    if (!media.length) return false;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    return media.some(({ m, r: mr }) => base.contains(m) && !m.contains(el) && !el.contains(m) &&
      x >= mr.left && x <= mr.right && y >= mr.top && y <= mr.bottom);
  }

  const SKIP_ANCESTOR = 'svg, canvas, [aria-hidden="true"], script, style, noscript, template, option, datalist';
  const disabled = el => !!el.closest(':disabled, [aria-disabled="true"]');
  const shown = el => el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true;

  // Finish every finite animation so nothing is measured half-faded in.
  for (const a of document.getAnimations()) { try { a.finish(); } catch { /* infinite: leave it */ } }

  // --- 1. sideways scroll ---------------------------------------------------------------------
  const de = document.documentElement;
  const scroll = { scrollWidth: de.scrollWidth, innerWidth: W, offenders: [] };
  if (de.scrollWidth > W) {
    const clipped = el => {
      for (let e = el.parentElement; e && e !== document.body && e !== de; e = e.parentElement) {
        const ox = getComputedStyle(e).overflowX;
        if (ox !== 'visible') return true;
      }
      return false;
    };
    const past = [];
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= W + 0.5 || !shown(el) || clipped(el)) continue;
      past.push({ el, right: r.right, width: r.width });
    }
    // Name the outermost culprits only: a child of an offender is usually the same problem.
    const set = new Set(past.map(o => o.el));
    scroll.offenders = past
      .filter(o => !o.el.parentElement || !set.has(o.el.parentElement))
      .sort((a, b) => b.right - a.right)
      .slice(0, 8)
      .map(o => { o.el.setAttribute('data-ui-offender', 'scroll'); return { selector: sel(o.el), text: short(o.el.textContent), right: Math.round(o.right), width: Math.round(o.width) }; });
  }

  // --- 2. text contrast -----------------------------------------------------------------------
  const contrast = [];
  let unmeasured = 0;
  const unmeasuredItems = [];
  let measured = 0;
  function check(el, text, colourStr) {
    const cs = getComputedStyle(el);
    const fg = parse(colourStr || cs.color);
    if (fg[3] === 0) return; // transparent text: background-clip text or deliberately invisible
    const ch = chain(el);
    if (!ch || overMedia(el, ch[ch.length - 1].el)) {
      unmeasured++;
      unmeasuredItems.push({ selector: sel(el), text: short(text), why: ch ? 'over canvas/img/video' : 'background image' });
      return;
    }
    measured++;
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    let worst = Infinity;
    let pair = null;
    for (const [t, b] of pixels(ch, fg)) {
      const r = ratio(t, b);
      if (r < worst) { worst = r; pair = [t, b]; }
    }
    if (worst + 1e-6 < need) {
      el.setAttribute('data-ui-offender', 'contrast');
      contrast.push({
        selector: sel(el), text: short(text), ratio: Math.round(worst * 100) / 100, need,
        fg: hex(pair[0]), bg: hex(pair[1]), fontSize: size, fontWeight: weight,
      });
    }
  }
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const p = n.parentElement;
      if (!p || p.closest(SKIP_ANCESTOR) || p.closest('[data-ui-ignore]')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const byEl = new Map();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement;
    if (disabled(p) || !shown(p)) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter(r => r.width > 1 && r.height > 1);
    if (!rects.length) continue;
    // A 1px clip box is screen-reader-only text.
    const pr = p.getBoundingClientRect();
    if (pr.width <= 1 || pr.height <= 1) continue;
    byEl.set(p, (byEl.get(p) || '') + n.nodeValue);
  }
  for (const [el, text] of byEl) check(el, text);
  for (const el of scope.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]), select, textarea')) {
    if (el.closest(SKIP_ANCESTOR) || disabled(el) || !shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) continue;
    if (el.tagName === 'SELECT') { check(el, el.selectedOptions[0] ? el.selectedOptions[0].textContent : ''); continue; }
    if (el.value) check(el, el.value);
    else if (el.placeholder) check(el, `placeholder: ${el.placeholder}`, getComputedStyle(el, '::placeholder').color);
  }

  // --- 3. tap targets -------------------------------------------------------------------------
  const targets = [];
  let targetCount = 0;
  if (opts.targets) {
    const Q = 'button, a[href], [role=button], [role=tab], [role=switch], [role=checkbox], [role=radio], [role=menuitem], input:not([type=hidden]), select, textarea, summary';
    const blockOf = el => {
      for (let e = el.parentElement; e; e = e.parentElement) {
        if (!getComputedStyle(e).display.startsWith('inline')) return e;
      }
      return document.body;
    };
    const words = el => (el.textContent || '').replace(/\s+/g, '').length;
    const inSentence = el => {
      const d = getComputedStyle(el).display;
      const prose = d === 'inline' || (el.tagName === 'BUTTON' && el.closest('p'));
      if (!prose) return false;
      return words(blockOf(el)) > words(el) + 1;
    };
    const pseudoHeight = (el, h) => {
      let best = 0;
      for (const which of ['::before', '::after']) {
        const ps = getComputedStyle(el, which);
        if (ps.content === 'none' || ps.content === 'normal' || ps.position !== 'absolute') continue;
        const top = parseFloat(ps.top), bottom = parseFloat(ps.bottom), ph = parseFloat(ps.height);
        if (Number.isFinite(ph) && ph > 0) best = Math.max(best, ph);
        else if (Number.isFinite(top) && Number.isFinite(bottom)) best = Math.max(best, h - top - bottom);
      }
      return best;
    };
    for (const el of scope.querySelectorAll(Q)) {
      if (el.closest('svg') || disabled(el) || el.closest('[aria-hidden="true"]')) continue;
      const label = el.closest('label') || (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
      const r = el.getBoundingClientRect();
      const visible = shown(el) && r.width > 0 && r.height > 0;
      // An invisible input inside a label is a themed checkbox: the label is the target.
      if (!visible && !(label && el.tagName === 'INPUT')) continue;
      if (r.bottom < 0 && r.top < 0 && visible) continue; // parked above the page
      if (r.right < 0) continue;
      if (el.tagName === 'A' || el.tagName === 'BUTTON') { if (inSentence(el)) continue; }
      targetCount++;
      let hit = visible ? r.height : 0;
      if (label) { const lr = label.getBoundingClientRect(); hit = Math.max(hit, lr.height); }
      hit = Math.max(hit, pseudoHeight(el, r.height));
      if (hit + 0.5 < MIN_TARGET) {
        el.setAttribute('data-ui-offender', 'target');
        targets.push({
          selector: sel(el),
          text: short(el.getAttribute('aria-label') || el.textContent || el.value || el.getAttribute('title') || el.getAttribute('placeholder') || el.type),
          height: Math.round(r.height * 10) / 10, hit: Math.round(hit * 10) / 10, width: Math.round(r.width),
        });
      }
    }
  }

  return { scroll, contrast, targets, unmeasured, unmeasuredItems, measured, targetCount };
}

module.exports = { audit };
