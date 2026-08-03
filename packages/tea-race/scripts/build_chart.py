"""Regenerate packages/tea-race/src/content/worldChart.json.

The Tea Race's map is a *stylised board chart*, not a survey: flat land fills, engraved edges, ports
as markers. But "stylised" is a rendering decision, not an excuse for a made-up coastline — the
outlines here are real Natural Earth 110m land, simplified hard (Douglas-Peucker) and clipped to the
latitudes clippers actually worked. That gives a recognisable world at a fraction of the hand-drawing,
and it keeps ports sitting on their real coasts automatically, since sim/geography.ts projects both
the rings and the ports through the same function.

This deliberately does NOT reuse Niccolo's build_geography.py: that script's whole purpose is a
thin-plate-spline warp onto Ptolemy's distorted framework. The Tea Race wants the opposite — an
undistorted 19th-century chart — so it shares the download-and-simplify approach and nothing else.

    python3 packages/tea-race/scripts/build_chart.py

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

# Clippers worked roughly between the Arctic convoy latitudes and the Southern Ocean. Cropping here
# rather than at the poles keeps the chart's aspect ratio usable and drops Antarctica entirely.
LAT_MAX = 72.0
LAT_MIN = -60.0

# Douglas-Peucker tolerance in degrees. 0.55 keeps continents recognisable (Italy still a boot, the
# Gulf of Mexico still a gulf) while collapsing fjord-level noise that would only alias on screen.
SIMPLIFY_TOLERANCE = 0.55

# A ring smaller than this (in square degrees, shoelace) is dropped: at chart scale it is one pixel
# of visual noise. Sized to keep Ireland, Sri Lanka, Taiwan, Hispaniola and Tasmania.
MIN_RING_AREA = 4.0


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


def clip_latitude(ring):
    """Clamp vertices into the chart's latitude band. Crude but adequate: the only landmass that
    actually crosses a boundary is northern Greenland/Siberia, which flattens against the top edge
    exactly as a printed chart's neatline would cut it."""
    return [(lon, max(LAT_MIN, min(LAT_MAX, lat))) for lon, lat in ring]


def collect_rings(geojson):
    rings = []
    for feature in geojson['features']:
        geom = feature['geometry']
        polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
        for poly in polys:
            # Exterior ring only — holes (the Caspian, Great Lakes) are not worth the ink here.
            exterior = [(float(x), float(y)) for x, y in poly[0]]
            if not exterior:
                continue
            # Skip anything entirely below the crop (Antarctica).
            if max(lat for _, lat in exterior) < LAT_MIN:
                continue
            clipped = clip_latitude(exterior)
            simplified = douglas_peucker(clipped, SIMPLIFY_TOLERANCE)
            if len(simplified) < 4 or ring_area(simplified) < MIN_RING_AREA:
                continue
            rings.append([[round(lon, 3), round(lat, 3)] for lon, lat in simplified])
    return rings


def collect_graticule(geojson):
    """Meridians and parallels are both dead straight under an equirectangular projection, so each
    graticule line is stored as its two endpoints. Natural Earth ships them at 1-degree resolution,
    which would be ~90KB of collinear points for geometry the renderer draws as a straight line."""
    lines = []
    for feature in geojson['features']:
        geom = feature['geometry']
        parts = geom['coordinates'] if geom['type'] == 'MultiLineString' else [geom['coordinates']]
        for part in parts:
            pts = [(float(x), float(y)) for x, y in part if LAT_MIN <= float(y) <= LAT_MAX]
            if len(pts) < 2:
                continue
            a, b = pts[0], pts[-1]
            lines.append([[round(a[0], 3), round(a[1], 3)], [round(b[0], 3), round(b[1], 3)]])
    return lines


def main():
    print('==> Building The Tea Race world chart')
    rings = collect_rings(fetch('land'))
    rings.sort(key=ring_area, reverse=True)
    graticule = collect_graticule(fetch('graticule'))

    payload = {
        '$comment': (
            'Generated by scripts/build_chart.py from Natural Earth 110m land — do not hand-edit. '
            'Coordinates are [lon, lat] in WGS84; sim/geography.ts projects them with the same '
            'function it uses for ports, which is what keeps ports on their coastlines. '
            f'Simplified at {SIMPLIFY_TOLERANCE} deg, clipped to lat [{LAT_MIN}, {LAT_MAX}].'
        ),
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
