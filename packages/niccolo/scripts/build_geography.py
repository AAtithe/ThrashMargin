"""Regenerate packages/niccolo/src/content/geography.json.

Real Natural Earth land/river geometry pushed through ONE global thin-plate-spline warp fitted on
the 30 places in scripts/gazetteer.json, each of which carries both a modern (modernLon/modernLat)
and a Ptolemaic (lon/lat) coordinate. That one warp is what makes the result a Ptolemaic map: every
gazetteer city lands on its own historical position (worst error < 0.11 deg) and Ptolemy's
characteristic distortions fall out of the anchor set rather than being drawn by hand.

This replaced an earlier approach that fitted ~15 regions independently and hand-spliced them into
one ring. That needed a reconciled seam at every regional boundary, and every new region could (and
repeatedly did) break a distant one. There are no seams here because there are no joins.

To improve a region, ADD AN ANCHOR to scripts/gazetteer.json and re-run — do not hand-edit the
generated rings, and do not go back to splicing regions in one at a time.

    python3 packages/niccolo/scripts/build_geography.py

Natural Earth inputs (~2.5MB) are downloaded to scripts/.cache/ on first run and are gitignored.
Requires only the Python standard library.
"""
import json, math, os, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
CACHE = os.path.join(HERE, '.cache')
GEO_PATH = os.path.join(PKG, 'src', 'content', 'geography.json')
GAZ_PATH = os.path.join(HERE, 'gazetteer.json')

NE_BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'
NE_FILES = {'land': 'ne_50m_land.geojson', 'rivers': 'ne_50m_rivers_lake_centerlines.geojson'}


def ne(kind):
    """Fetch a Natural Earth layer, caching it under scripts/.cache/."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, NE_FILES[kind])
    if not os.path.exists(path):
        print('downloading %s ...' % NE_FILES[kind])
        urllib.request.urlretrieve(NE_BASE + NE_FILES[kind], path)
    return json.load(open(path))


# Modern-space window fed to the warp. A thin-plate spline extrapolates badly far outside its
# control hull, and the 30 anchors span roughly lon -22..46 / lat 13..64, so this is deliberately
# only a little wider than they are.
BBOX = (-32.0, -8.0, 75.0, 75.0)
LAM = 0.5          # mild TPS smoothing; tames the far field, moves any anchor by < 0.11 deg
MIN_AREA = 0.35    # Ptolemaic deg^2 — drops specks too small to read at any in-game zoom
MIN_HOLE_AREA = 2.0


# ---------------- linear algebra (numpy is not installed) ----------------
def solve(A, b):
    n = len(A)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(M[r][col]))
        if abs(M[piv][col]) < 1e-12:
            raise ValueError('singular matrix at column %d' % col)
        M[col], M[piv] = M[piv], M[col]
        pv = M[col][col]
        for r in range(n):
            if r == col:
                continue
            f = M[r][col] / pv
            if f:
                for c in range(col, n + 1):
                    M[r][c] -= f * M[col][c]
    return [M[i][n] / M[i][i] for i in range(n)]


def U(r2):
    return 0.0 if r2 <= 1e-12 else r2 * math.log(r2)


class TPS:
    def __init__(self, pts, vals, lam=0.0):
        n = len(pts)
        A = [[0.0] * (n + 3) for _ in range(n + 3)]
        b = [0.0] * (n + 3)
        for i in range(n):
            for j in range(n):
                dx, dy = pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]
                A[i][j] = U(dx * dx + dy * dy)
            A[i][i] += lam
            A[i][n], A[i][n + 1], A[i][n + 2] = 1.0, pts[i][0], pts[i][1]
            b[i] = vals[i]
        for j in range(n):
            A[n][j], A[n + 1][j], A[n + 2][j] = 1.0, pts[j][0], pts[j][1]
        sol = solve(A, b)
        self.pts, self.w, self.a = pts, sol[:n], sol[n:]

    def __call__(self, x, y):
        v = self.a[0] + self.a[1] * x + self.a[2] * y
        for (px, py), w in zip(self.pts, self.w):
            dx, dy = x - px, y - py
            v += w * U(dx * dx + dy * dy)
        return v


# ---------------- geometry helpers ----------------
def clip_ring(ring, bbox):
    """Sutherland-Hodgman against an axis-aligned rectangle."""
    xmin, ymin, xmax, ymax = bbox
    def clip(pts, inside, cut):
        if not pts:
            return []
        out = []
        for i in range(len(pts)):
            cur, prv = pts[i], pts[i - 1]
            ci, pi = inside(cur), inside(prv)
            if ci:
                if not pi:
                    out.append(cut(prv, cur))
                out.append(cur)
            elif pi:
                out.append(cut(prv, cur))
        return out
    def ix(p, q, x):
        t = (x - p[0]) / (q[0] - p[0])
        return (x, p[1] + t * (q[1] - p[1]))
    def iy(p, q, y):
        t = (y - p[1]) / (q[1] - p[1])
        return (p[0] + t * (q[0] - p[0]), y)
    r = [(float(p[0]), float(p[1])) for p in ring]
    r = clip(r, lambda p: p[0] >= xmin, lambda p, q: ix(p, q, xmin))
    r = clip(r, lambda p: p[0] <= xmax, lambda p, q: ix(p, q, xmax))
    r = clip(r, lambda p: p[1] >= ymin, lambda p, q: iy(p, q, ymin))
    r = clip(r, lambda p: p[1] <= ymax, lambda p, q: iy(p, q, ymax))
    return r


def area(ring):
    s = 0.0
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def simplify(ring, tol):
    """Ramer-Douglas-Peucker, iterative."""
    if len(ring) < 3:
        return ring
    keep = [False] * len(ring)
    keep[0] = keep[-1] = True
    stack = [(0, len(ring) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        x1, y1 = ring[a]
        x2, y2 = ring[b]
        dx, dy = x2 - x1, y2 - y1
        den = math.hypot(dx, dy)
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = ring[i]
            d = abs(dy * px - dx * py + x2 * y1 - y2 * x1) / den if den > 1e-12 else math.hypot(px - x1, py - y1)
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return [p for p, k in zip(ring, keep) if k]


def in_domain(ring, dom, pad=1.0):
    return any(dom['lonMin'] - pad <= x <= dom['lonMax'] + pad and
               dom['latMin'] - pad <= y <= dom['latMax'] + pad for x, y in ring)


# ---------------- fit the warp ----------------
gaz = json.load(open(GAZ_PATH))
places = gaz['places']
src = [(p['modernLon'], p['modernLat']) for p in places]
f_lon = TPS(src, [p['lon'] for p in places], lam=LAM)
f_lat = TPS(src, [p['lat'] for p in places], lam=LAM)

worst, worst_id = 0.0, ''
for p in places:
    d = math.hypot(f_lon(p['modernLon'], p['modernLat']) - p['lon'],
                   f_lat(p['modernLon'], p['modernLat']) - p['lat'])
    if d > worst:
        worst, worst_id = d, p['id']
print('anchors: %d   worst drift: %.3f deg (%s)' % (len(places), worst, worst_id))

warp = lambda x, y: (round(f_lon(x, y), 3), round(f_lat(x, y), 3))

geo = json.load(open(GEO_PATH))
DOM = geo['domain']

# ---------------- land polygons ----------------
def centroid(ring):
    return (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))


def pt_in(pt, ring):
    x, y = pt
    c, n = False, len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if ((y1 > y) != (y2 > y)) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


# Anchors in MODERN space, used both to keep small-but-inhabited islands and to name islands.
anchor_modern = [(p['id'], p['modernLon'], p['modernLat']) for p in places]

land = ne('land')
exteriors, holes = [], []
for feat in land['features']:
    g = feat['geometry']
    polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
    for poly in polys:
        for ri, ring in enumerate(poly):
            clipped = clip_ring(ring, BBOX)
            if len(clipped) < 3:
                continue
            w = [warp(x, y) for x, y in clipped]
            if not in_domain(w, DOM):
                continue
            w = simplify(w, 0.02)
            if len(w) < 3:
                continue
            a = area(w)
            if ri == 0:
                # Keep a polygon if it is big enough to read OR if a game city genuinely stands on
                # it — Madeira is a live Chapter 4 port whose island is far below any sane size
                # floor. Must be strictly inside: a proximity test kept Scheldt/Bay-of-Naples/Rhodian
                # islets merely *near* Antwerp, Naples and Rhodes, whose cities are on other land.
                hosts = [aid for aid, ax, ay in anchor_modern if pt_in((ax, ay), clipped)]
                if a >= MIN_AREA or hosts:
                    exteriors.append((a, w, centroid(clipped), hosts))
            elif a >= MIN_HOLE_AREA:
                holes.append((a, w))

exteriors.sort(key=lambda t: -t[0])
holes.sort(key=lambda t: -t[0])
print('land polygons: %d (largest %.0f deg^2, next %.0f)   holes kept: %d'
      % (len(exteriors), exteriors[0][0], exteriors[1][0] if len(exteriors) > 1 else 0, len(holes)))

# Name islands by their MODERN centroid, not their warped one. Matching after the warp is
# unreliable — it named Sardinia "corsica" and vice versa, since the two land within ~1.5 deg
# of each other in Ptolemaic space and my guessed reference points were closer to the wrong one.
KNOWN_MODERN = [('britain', -2.0, 54.0), ('hibernia', -8.0, 53.4), ('thule', -19.0, 64.9),
                ('scandia', 11.6, 55.5), ('sicilia', 14.1, 37.6), ('sardinia', 9.1, 40.1),
                ('corsica', 9.1, 42.2), ('creta', 24.8, 35.2), ('cyprus', 33.2, 35.1),
                ('rhodos', 28.0, 36.2), ('baleares', 3.0, 39.6), ('euboea', 23.8, 38.5),
                ('lesbos', 26.3, 39.2), ('fortunatae', -16.6, 28.3), ('madeira', -16.9, 32.7)]

islands, used = [], set()
for idx, (a, ring, mc, hosts) in enumerate(exteriors[1:], start=1):
    best, bd = None, 9e9
    for name, kx, ky in KNOWN_MODERN:
        if name in used:
            continue
        d = math.hypot(mc[0] - kx, mc[1] - ky)
        if d < bd:
            best, bd = name, d
    if best and bd < 2.5:
        ident = best
        used.add(best)
    elif hosts:
        ident = hosts[0]
    else:
        ident = 'isle_%02d' % idx
    islands.append({'id': ident, 'name': ident.replace('_', ' ').title(), 'ring': ring})
missing = [n for n, _, _ in KNOWN_MODERN if n not in used]
if missing:
    print('  NOTE: no polygon matched for: %s' % ', '.join(missing))

# ---------------- rivers ----------------
RIVER_NAMES = {'Nile', 'Danube', 'Rhine', 'Niger', 'Euphrates', 'Tigris', 'Po', 'Rhone', 'Rhône',
               'Loire', 'Seine', 'Elbe', 'Vistula', 'Oder', 'Don', 'Dnieper', 'Dniester', 'Volga',
               'Ebro', 'Tagus', 'Douro', 'Guadalquivir', 'Garonne', 'Weser', 'Senegal'}
rivers = []
riv = ne('rivers')
if True:
    for feat in riv['features']:
        nm = (feat['properties'].get('name') or '').strip()
        if nm not in RIVER_NAMES:
            continue
        g = feat['geometry']
        lines = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates']
        for line in lines:
            run = []
            for x, y in line:
                if BBOX[0] <= x <= BBOX[2] and BBOX[1] <= y <= BBOX[3]:
                    run.append(warp(x, y))
                else:
                    if len(run) > 2 and in_domain(run, DOM):
                        rivers.append({'id': nm.lower().replace(' ', '_') + '_%d' % len(rivers),
                                       'name': nm, 'line': simplify(run, 0.05)})
                    run = []
            if len(run) > 2 and in_domain(run, DOM):
                rivers.append({'id': nm.lower().replace(' ', '_') + '_%d' % len(rivers),
                               'name': nm, 'line': simplify(run, 0.05)})
print('rivers: %d segments, %d named' % (len(rivers), len({r['name'] for r in rivers})))

# ---------------- labels and mountain ridges ----------------
# Re-place these through the same warp instead of leaving them where they were hand-dropped against
# the old crude shapes — three (Hibernia, Arabia Felix, Sinus Persicus) had ended up in open water
# or on the wrong side of a coast. Anything absent here (Ptolemy's mythical Terra Incognita and
# Montes Lunae) is deliberately left exactly as authored.
LABEL_MODERN = {
    'Hibernia': (-8.0, 53.4), 'Scandia': (14.0, 58.5), 'Sarmatia': (33.0, 52.0),
    'Scythia': (62.0, 47.0), 'Germania': (10.5, 51.5), 'Gallia': (2.5, 47.0),
    'Hispania': (-4.0, 40.0), 'Mauretania': (-5.5, 32.0), 'Libya interior': (15.0, 24.0),
    'Aethiopia': (32.0, 11.0), 'Aegyptus': (30.5, 26.5), 'Syria': (38.0, 34.5),
    'Media': (48.0, 36.0), 'Persis': (53.0, 30.0), 'Arabia Felix': (46.0, 17.0),
    'Italia': (12.5, 43.0),
    'OCEANVS OCCIDENTALIS': (-13.0, 45.0), 'MARE INTERNVM': (17.0, 35.0),
    'PONTVS EVXINVS': (34.0, 43.0), 'MARE HYRCANVM': (51.0, 41.5),
    'Sinvs Arabicvs': (38.0, 20.0), 'Sinvs Persicvs': (51.5, 27.0),
}
moved = 0
for lb in geo['labels']:
    m = LABEL_MODERN.get(lb['text'])
    if m:
        lb['at'] = list(warp(*m))
        moved += 1
print('labels re-placed through the warp: %d of %d' % (moved, len(geo['labels'])))

RIDGES_MODERN = {
    'alpes': [(6.5, 45.8), (9.0, 46.4), (11.5, 46.8), (13.8, 46.9)],
    'pyren': [(-1.6, 43.1), (0.4, 42.7), (2.4, 42.4)],
    'atlas': [(-8.0, 31.3), (-4.5, 32.6), (0.5, 34.5), (5.0, 36.0), (8.5, 36.4)],
    'taurus': [(29.5, 37.0), (33.0, 37.2), (36.5, 37.8), (40.0, 38.4)],
    'cauc': [(40.0, 43.4), (43.5, 42.9), (46.0, 42.2)],
}
for m in geo['mountains']:
    pts = RIDGES_MODERN.get(m['id'])
    if pts:
        m['line'] = [list(warp(x, y)) for x, y in pts]

# ---------------- assemble ----------------
geo['landmass'] = exteriors[0][1]
geo['islands'] = islands
geo['seas'] = [{'id': 'inland_%02d' % i, 'name': 'Inland sea', 'ring': r}
               for i, (a, r) in enumerate(holes)]
if rivers:
    geo['rivers'] = rivers
geo['$comment'] = (
    "Geometry is real Natural Earth land/river data pushed through ONE global thin-plate-spline "
    "warp fitted on packages/niccolo/scripts/gazetteer.json's 30 places, each of which carries both a "
    "modern (modernLon/modernLat) and a Ptolemaic (lon/lat) coordinate. That single warp is what "
    "makes this a Ptolemaic map: every gazetteer city lands on its own historical position (worst "
    "error under 0.11 deg) and Ptolemy's characteristic distortions - Scotland bent northeast, the "
    "Mediterranean stretched - fall out of the anchor set rather than being drawn in by hand. "
    "Regenerate with packages/niccolo/scripts/build_geography.py; do NOT hand-edit rings here, and "
    "do not go back "
    "to splicing regions in one at a time (that earlier approach needed a hand-reconciled seam at "
    "every regional boundary and each one could break a distant region). To improve a region, add "
    "an anchor to the gazetteer and re-run. Every ring is [lon, lat] in Ptolemaic degrees; "
    "'seas' are interior rings (enclosed water) drawn over the land by MapView. Deliberately ONE "
    "FLAT FILE, not chaptered like content/cities/chapterN.json - the physical world doesn't grow "
    "per chapter (see sim/content.ts's comment on the parallel convention)."
)

json.dump(geo, open(GEO_PATH, 'w'), indent=2)
tot = len(geo['landmass']) + sum(len(i['ring']) for i in islands)
print('WROTE %s\n  landmass %d pts, %d islands (%d pts), %d seas, %d rivers'
      % (GEO_PATH, len(geo['landmass']), len(islands), tot - len(geo['landmass']),
         len(geo['seas']), len(geo['rivers'])))
