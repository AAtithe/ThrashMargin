"""Regenerate packages/steady-eddie/src/content/worldChart.json.

Steady Eddie's map is a *stylised board chart*, not a survey — the same choice The Tea Race made,
just at country scale instead of world scale. The outlines here are real Natural Earth 110m land,
simplified (Douglas-Peucker) and cropped to a GB bounding box, so depots sit on their real coasts
automatically: sim/geography.ts projects both the rings and the depots through the same function.

Adapted from The Tea Race's build_chart.py. The one real change beyond the bounding box: that
script only clipped latitude (a world chart never needs to clip longitude, since it spans the full
-180..180). A single-country map needs both axes cropped, and needs a much finer simplification
tolerance and a much smaller minimum-ring-area — Britain rendered at world-chart settings would
lose the Isle of Wight and Anglesey outright and reduce the mainland coastline to a blob.

    python3 packages/steady-eddie/scripts/build_chart.py

Natural Earth input (~200KB) is cached in scripts/.cache/ and is gitignored.
Requires only the Python standard library.
"""
import json
import math
import os
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
CACHE = os.path.join(HERE, '.cache')
OUT_PATH = os.path.join(PKG, 'src', 'content', 'worldChart.json')

NE_BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'
NE_FILES = {
    'land': 'ne_110m_land.geojson',
    'graticule': 'ne_110m_graticules_30.geojson',
}

# Must match sim/geography.ts's LON_MIN/LON_MAX/LAT_MAX/LAT_MIN exactly — a GB bounding box with a
# little margin, Land's End to just past Glasgow, coast to coast.
LON_MIN = -6.5
LON_MAX = 2.2
LAT_MAX = 59.0
LAT_MIN = 49.8

# Douglas-Peucker tolerance in degrees. The Tea Race used 0.55 for a world chart; at country scale
# that would flatten the whole coastline into a blob, so this is more than 10x finer.
SIMPLIFY_TOLERANCE = 0.04

# A ring smaller than this (in square degrees, shoelace) is dropped. The Tea Race's 4.0 was sized to
# keep Ireland/Sri Lanka-sized islands at world scale; at this scale that threshold would drop the
# Isle of Wight and Anglesey, so it is three orders of magnitude smaller.
MIN_RING_AREA = 0.002


def fetch(name: str) -> dict:
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, NE_FILES[name])
    if not os.path.exists(path):
        url = NE_BASE + NE_FILES[name]
        print(f'  downloading {NE_FILES[name]}')
        urllib.request.urlretrieve(url, path)
    with open(path) as fh:
        return json.load(fh)


def perpendicular_distance(pt, start, end):
    (x, y), (x1, y1), (x2, y2) = pt, start, end
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    return abs(dy * x - dx * y + x2 * y1 - y2 * x1) / math.hypot(dx, dy)


def douglas_peucker(points, tolerance):
    if len(points) < 3:
        return list(points)
    worst_index, worst = 0, 0.0
    for i in range(1, len(points) - 1):
        d = perpendicular_distance(points[i], points[0], points[-1])
        if d > worst:
            worst_index, worst = i, d
    if worst <= tolerance:
        return [points[0], points[-1]]
    left = douglas_peucker(points[: worst_index + 1], tolerance)
    right = douglas_peucker(points[worst_index:], tolerance)
    return left[:-1] + right


def ring_area(ring):
    """Unsigned shoelace area in square degrees."""
    total = 0.0
    for i in range(len(ring)):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % len(ring)]
        total += x1 * y2 - x2 * y1
    return abs(total) / 2.0


def _clip_edge(ring, inside, intersect):
    """One pass of Sutherland-Hodgman against a single half-plane."""
    if not ring:
        return ring
    out = []
    prev = ring[-1]
    prev_in = inside(prev)
    for pt in ring:
        pt_in = inside(pt)
        if pt_in:
            if not prev_in:
                out.append(intersect(prev, pt))
            out.append(pt)
        elif prev_in:
            out.append(intersect(prev, pt))
        prev, prev_in = pt, pt_in
    return out


def clip_box(ring):
    """Proper polygon clipping (Sutherland-Hodgman) against the chart's lon/lat box.

    A world chart only ever needs to clamp vertices (The Tea Race's `clip_latitude`), because the
    one landmass that straddles its single clipped edge — Greenland/Siberia at the top — has nothing
    on the far side of that edge to distort. A country-sized box is different: France, Ireland,
    Scandinavia and more all have vertices on both sides of this box's edges, and clamping those
    vertices to the box (rather than properly clipping the polygon) drags each foreign landmass's
    far corners onto the box boundary, filling most of the box with a false landmass. Clip properly
    instead — this was caught by inspecting the first generated output, which had the entire box
    filled in as "land" from Europe's coastline being clamped rather than clipped.
    """

    def x_at(p1, p2, x):
        (x1, y1), (x2, y2) = p1, p2
        if x2 == x1:
            return (x, y1)
        t = (x - x1) / (x2 - x1)
        return (x, y1 + t * (y2 - y1))

    def y_at(p1, p2, y):
        (x1, y1), (x2, y2) = p1, p2
        if y2 == y1:
            return (x1, y)
        t = (y - y1) / (y2 - y1)
        return (x1 + t * (x2 - x1), y)

    r = ring
    r = _clip_edge(r, lambda p: p[0] >= LON_MIN, lambda a, b: x_at(a, b, LON_MIN))
    r = _clip_edge(r, lambda p: p[0] <= LON_MAX, lambda a, b: x_at(a, b, LON_MAX))
    r = _clip_edge(r, lambda p: p[1] >= LAT_MIN, lambda a, b: y_at(a, b, LAT_MIN))
    r = _clip_edge(r, lambda p: p[1] <= LAT_MAX, lambda a, b: y_at(a, b, LAT_MAX))
    return r


def collect_rings(geojson):
    rings = []
    for feature in geojson['features']:
        geom = feature['geometry']
        polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
        for poly in polys:
            # Exterior ring only — holes are not worth the ink here.
            exterior = [(float(x), float(y)) for x, y in poly[0]]
            if not exterior:
                continue
            # Skip anything entirely outside the box.
            lons = [lon for lon, _ in exterior]
            lats = [lat for _, lat in exterior]
            if max(lons) < LON_MIN or min(lons) > LON_MAX:
                continue
            if max(lats) < LAT_MIN or min(lats) > LAT_MAX:
                continue
            clipped = clip_box(exterior)
            simplified = douglas_peucker(clipped, SIMPLIFY_TOLERANCE)
            if len(simplified) < 4 or ring_area(simplified) < MIN_RING_AREA:
                continue
            rings.append([[round(lon, 3), round(lat, 3)] for lon, lat in simplified])
    return rings


def collect_graticule(geojson):
    """Meridians and parallels are both dead straight under an equirectangular projection, so each
    graticule line is stored as its two endpoints, clipped to the box."""
    lines = []
    for feature in geojson['features']:
        geom = feature['geometry']
        parts = geom['coordinates'] if geom['type'] == 'MultiLineString' else [geom['coordinates']]
        for part in parts:
            pts = [
                (float(x), float(y))
                for x, y in part
                if LAT_MIN <= float(y) <= LAT_MAX and LON_MIN <= float(x) <= LON_MAX
            ]
            if len(pts) < 2:
                continue
            a, b = pts[0], pts[-1]
            lines.append([[round(a[0], 3), round(a[1], 3)], [round(b[0], 3), round(b[1], 3)]])
    return lines


def main():
    print('==> Building the Steady Eddie GB chart')
    rings = collect_rings(fetch('land'))
    rings.sort(key=ring_area, reverse=True)
    graticule = collect_graticule(fetch('graticule'))

    payload = {
        '$comment': (
            'Generated by scripts/build_chart.py from Natural Earth 110m land — do not hand-edit. '
            'Coordinates are [lon, lat] in WGS84; sim/geography.ts projects them with the same '
            'function it uses for depots, which is what keeps depots on their coastlines. '
            f'Simplified at {SIMPLIFY_TOLERANCE} deg, cropped to lon [{LON_MIN}, {LON_MAX}], '
            f'lat [{LAT_MIN}, {LAT_MAX}].'
        ),
        'lonMin': LON_MIN,
        'lonMax': LON_MAX,
        'latMax': LAT_MAX,
        'latMin': LAT_MIN,
        'land': rings,
        'graticule': graticule,
    }
    with open(OUT_PATH, 'w') as fh:
        json.dump(payload, fh, separators=(',', ':'))
        fh.write('\n')

    vertices = sum(len(r) for r in rings)
    size = os.path.getsize(OUT_PATH) / 1024
    print(f'    {len(rings)} land rings, {vertices} vertices, {len(graticule)} graticule lines')
    print(f'    wrote {OUT_PATH} ({size:.0f} KB)')


if __name__ == '__main__':
    main()
