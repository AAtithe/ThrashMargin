"""Regenerate packages/niccolo/src/content/worldChart.json.

Real WGS84 geography, in plain lon/lat. No projection is baked in here and no warp is applied:
sim/geography.ts projects these at load with the same plate carree `project()` the cities go
through, which is what makes a city sit on its own coast without anyone placing it by hand.

This replaced a Ptolemaic chart (a Donis trapezoidal projection of coordinates warped onto Ptolemy's
own positions). That was authentic but visibly skewed, and it could not support round-the-world
scrolling because Ptolemy's world is a bounded rectangle rather than a globe. The chart now spans
the full -180..180, so panning east or west runs forever.

    python3 packages/niccolo/scripts/build_chart.py

Natural Earth inputs are cached in scripts/.cache/ (gitignored). Standard library only.
"""
import json, math, os, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
CACHE = os.path.join(HERE, '.cache')
OUT = os.path.join(PKG, 'src', 'content', 'worldChart.json')

NE_BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'
NE_FILES = {'land': 'ne_50m_land.geojson', 'rivers': 'ne_50m_rivers_lake_centerlines.geojson'}

# Latitude window, matching tea-race's own chart so the two games' charts read alike. Longitude is
# deliberately the whole world: that is what round-the-world scrolling needs.
LAT_MAX = 72.0
LAT_MIN = -60.0
LON_MIN, LON_MAX = -180.0, 180.0

MIN_AREA = 0.6      # square degrees; drops specks that are sub-pixel at any usable zoom
MIN_HOLE_AREA = 8.0
SIMPLIFY = 0.06     # degrees; keeps coastlines readable without shipping 100k points


def ne(kind):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, NE_FILES[kind])
    if not os.path.exists(path):
        print('downloading %s ...' % NE_FILES[kind])
        urllib.request.urlretrieve(NE_BASE + NE_FILES[kind], path)
    return json.load(open(path))


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
    for i in range(len(ring)):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % len(ring)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def simplify(pts, tol):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        x1, y1 = pts[a]
        x2, y2 = pts[b]
        dx, dy = x2 - x1, y2 - y1
        den = math.hypot(dx, dy)
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            d = (abs(dy * px - dx * py + x2 * y1 - y2 * x1) / den) if den > 1e-12 else math.hypot(px - x1, py - y1)
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return [p for p, k in zip(pts, keep) if k]


def r3(pts):
    return [[round(x, 3), round(y, 3)] for x, y in pts]


BBOX = (LON_MIN, LAT_MIN, LON_MAX, LAT_MAX)

# ---------------- land ----------------
land_rings, holes = [], []
for feat in ne('land')['features']:
    g = feat['geometry']
    polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
    for poly in polys:
        for ri, ring in enumerate(poly):
            c = clip_ring(ring, BBOX)
            if len(c) < 3:
                continue
            c = simplify(c, SIMPLIFY)
            if len(c) < 3:
                continue
            a = area(c)
            if ri == 0:
                if a >= MIN_AREA:
                    land_rings.append((a, c))
            elif a >= MIN_HOLE_AREA:
                holes.append((a, c))

land_rings.sort(key=lambda t: -t[0])
holes.sort(key=lambda t: -t[0])
print('land rings: %d (%d pts)   inland seas: %d'
      % (len(land_rings), sum(len(r) for _, r in land_rings), len(holes)))

# ---------------- rivers ----------------
RIVER_NAMES = {'Nile', 'Danube', 'Rhine', 'Niger', 'Euphrates', 'Tigris', 'Po', 'Rhone', 'Rhône',
               'Loire', 'Seine', 'Elbe', 'Vistula', 'Oder', 'Don', 'Dnieper', 'Dniester', 'Volga',
               'Ebro', 'Tagus', 'Douro', 'Guadalquivir', 'Garonne', 'Weser', 'Senegal',
               'Indus', 'Ganges', 'Amazonas', 'Mississippi', 'Yangtze', 'Congo', 'Zambezi'}
rivers = []
for feat in ne('rivers')['features']:
    nm = (feat['properties'].get('name') or '').strip()
    if nm not in RIVER_NAMES:
        continue
    g = feat['geometry']
    lines = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates']
    for line in lines:
        run = [(x, y) for x, y in line if LAT_MIN <= y <= LAT_MAX]
        if len(run) > 2:
            rivers.append({'name': nm, 'line': r3(simplify(run, 0.08))})
print('rivers: %d segments, %d named' % (len(rivers), len({r['name'] for r in rivers})))

# ---------------- graticule ----------------
graticule = []
for lat in range(-60, 73, 15):
    graticule.append([[LON_MIN, float(lat)], [LON_MAX, float(lat)]])
for lon in range(-180, 181, 15):
    graticule.append([[float(lon), LAT_MIN], [float(lon), LAT_MAX]])

# ---------------- named places on the chart ----------------
# Real positions, so they land where they belong under the same projection as everything else.
LABELS = [
    ('Hibernia', -8.0, 53.4, 'region'), ('Britannia', -1.8, 53.0, 'region'),
    ('Gallia', 2.5, 47.0, 'region'), ('Hispania', -4.0, 40.0, 'region'),
    ('Germania', 10.5, 51.5, 'region'), ('Italia', 12.5, 43.0, 'region'),
    ('Scandia', 15.0, 61.0, 'region'), ('Sarmatia', 33.0, 52.0, 'region'),
    ('Graecia', 22.5, 39.5, 'region'), ('Anatolia', 33.0, 39.0, 'region'),
    ('Syria', 38.0, 34.5, 'region'), ('Aegyptus', 30.0, 26.0, 'region'),
    ('Mauretania', -5.5, 32.0, 'region'), ('Libya interior', 15.0, 24.0, 'region'),
    ('Aethiopia', 32.0, 11.0, 'region'), ('Guinea', 0.0, 8.0, 'region'),
    ('Persis', 53.0, 30.0, 'region'), ('Arabia Felix', 46.0, 17.0, 'region'),
    ('OCEANVS OCCIDENTALIS', -30.0, 42.0, 'sea'), ('MARE INTERNVM', 17.0, 35.0, 'sea'),
    ('PONTVS EVXINVS', 34.0, 43.0, 'sea'), ('MARE HYRCANVM', 51.0, 41.5, 'sea'),
    ('Sinvs Arabicvs', 38.0, 20.0, 'sea'), ('Sinvs Persicvs', 51.5, 27.0, 'sea'),
    ('MARE BALTICVM', 19.0, 57.5, 'sea'),
]
RIDGES = {
    'alpes': [(6.5, 45.8), (9.0, 46.4), (11.5, 46.8), (13.8, 46.9)],
    'pyren': [(-1.6, 43.1), (0.4, 42.7), (2.4, 42.4)],
    'atlas': [(-8.0, 31.3), (-4.5, 32.6), (0.5, 34.5), (5.0, 36.0), (8.5, 36.4)],
    'taurus': [(29.5, 37.0), (33.0, 37.2), (36.5, 37.8), (40.0, 38.4)],
    'cauc': [(40.0, 43.4), (43.5, 42.9), (46.0, 42.2)],
    'apenn': [(9.5, 44.4), (12.0, 43.3), (14.5, 41.6), (16.2, 40.3)],
    'carpath': [(19.0, 49.4), (22.5, 48.2), (25.5, 45.6)],
}

chart = {
    '$comment': (
        "Real WGS84 geography in plain [lon, lat] degrees. NOTHING here is projected or in pixels: "
        "sim/geography.ts runs these through the same plate carree project() the cities go through, "
        "which is why a city sits on its own coast without anyone placing it by hand. Longitude "
        "deliberately spans the whole -180..180 world, because that is what round-the-world "
        "scrolling needs (see WORLD_COPIES/wrapPanX in sim/geography.ts). Replaced an earlier "
        "Ptolemaic chart, which was authentic but visibly skewed and, being a bounded rectangle "
        "rather than a globe, could not wrap. Regenerate with packages/niccolo/scripts/"
        "build_chart.py; do NOT hand-edit these rings. 'seas' are interior rings (enclosed water) "
        "drawn over the land."
    ),
    'latMax': LAT_MAX,
    'latMin': LAT_MIN,
    'land': [r3(r) for _, r in land_rings],
    'seas': [r3(r) for _, r in holes],
    'graticule': graticule,
    'rivers': rivers,
    'mountains': [{'id': k, 'line': [[x, y] for x, y in v]} for k, v in RIDGES.items()],
    'labels': [{'text': t, 'at': [lo, la], 'kind': k} for t, lo, la, k in LABELS],
}

json.dump(chart, open(OUT, 'w'), indent=1)
print('WROTE %s' % OUT)
print('  %d land rings, %d seas, %d rivers, %d graticule lines, %d labels'
      % (len(chart['land']), len(chart['seas']), len(rivers), len(graticule), len(LABELS)))
