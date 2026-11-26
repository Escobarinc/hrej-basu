"""Z dat ve tools/_osm postaví herní data.

Použití: python3 -I tools/build_data.py tools/_osm data
  data/cz.json               mapa ČR: hranice, kraje, řeky, města, silniční graf pro eskorty, seznam věznic
  data/prisons/<id>.json     areál věznice v metrech (x = východ, z = jih) kolem středu areálu
Data © přispěvatelé OpenStreetMap (ODbL).
"""
import json
import math
import os
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from prisons import PRISONS  # noqa: E402

M = 111320.0


# ---------- geometrie ----------
def dp(pts, tol):
    """Douglas–Peucker (pts = [(a, b)], tol ve stejných jednotkách)."""
    if len(pts) < 3:
        return list(pts)
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        ax, ay = pts[i]
        bx, by = pts[j]
        dx, dy = bx - ax, by - ay
        l2 = dx * dx + dy * dy
        best, bi = -1, -1
        for k in range(i + 1, j):
            px, py = pts[k]
            if l2 == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
                d = math.hypot(px - ax - t * dx, py - ay - t * dy)
            if d > best:
                best, bi = d, k
        if best > tol:
            keep[bi] = True
            stack += [(i, bi), (bi, j)]
    return [p for p, k in zip(pts, keep) if k]


def stitch(lines):
    """Spojí úseky (seznamy bodů) do prstenců / delších linií podle shodných koncových bodů."""
    lines = [list(l) for l in lines if len(l) >= 2]
    out = []
    while lines:
        cur = lines.pop()
        changed = True
        while changed and cur[0] != cur[-1]:
            changed = False
            for i, l in enumerate(lines):
                if l[0] == cur[-1]:
                    cur += l[1:]
                elif l[-1] == cur[-1]:
                    cur += l[::-1][1:]
                elif l[-1] == cur[0]:
                    cur = l[:-1] + cur
                elif l[0] == cur[0]:
                    cur = l[::-1][:-1] + cur
                else:
                    continue
                lines.pop(i)
                changed = True
                break
        out.append(cur)
    return out


def ll(g):
    return [(q['lat'], q['lon']) for q in g if q]


def rel_rings(e, role='outer'):
    segs = [ll(m['geometry']) for m in e.get('members', []) if m.get('type') == 'way' and m.get('geometry') and m.get('role', 'outer') in (role, '')]
    return [r for r in stitch(segs) if len(r) >= 4 and r[0] == r[-1]]


def area_of(poly):
    a = 0
    for i in range(len(poly) - 1):
        a += poly[i][0] * poly[i + 1][1] - poly[i + 1][0] * poly[i][1]
    return a / 2


def inside(pt, poly):
    x, y = pt
    c = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            c = not c
        j = i
    return c


def num(v):
    if v is None:
        return None
    m = re.match(r'\s*([0-9]+(?:[.,][0-9]+)?)', str(v))
    return float(m.group(1).replace(',', '.')) if m else None


# ---------- věznice ----------
def build_prison(p, geom, osm_dir, out_dir):
    fn = os.path.join(osm_dir, f"p_{p['id']}.json")
    raw = json.load(open(fn)) if os.path.exists(fn) else {'elements': []}
    if not raw['elements']:
        print('  (chybí data okolí)', p['id'])
    main = geom[p['osm']]
    rings = rel_rings(main) if main['type'] == 'relation' else [ll(main['geometry'])]
    rings = [r for r in rings if len(r) >= 4]
    allp = [q for r in rings for q in r]
    lat0 = sum(q[0] for q in allp) / len(allp)
    lon0 = sum(q[1] for q in allp) / len(allp)
    k = M * math.cos(math.radians(lat0))

    def loc(pts):
        return [(round((b - lon0) * k, 1), round(-(a - lat0) * M, 1)) for a, b in pts]

    areas = [loc(r) for r in rings]
    for oid in p.get('extra', []):
        e = geom.get(oid)
        if not e:
            continue
        for r in (rel_rings(e) if e['type'] == 'relation' else [ll(e['geometry'])]):
            lr = loc(r)
            if all(abs(x) < 1500 and abs(z) < 1500 for x, z in lr):
                areas.append(lr)
    # další prison polygony z výřezu (např. sousední objekty)
    for e in raw['elements']:
        t = e.get('tags', {})
        if (t.get('amenity') == 'prison' or t.get('landuse') == 'prison') and e['type'] == 'way' and f"w{e['id']}" not in [p['osm']] + p.get('extra', []):
            lr = loc(ll(e['geometry']))
            if len(lr) >= 4 and lr[0] == lr[-1] and abs(area_of(lr)) > 400:
                areas.append(lr)

    def in_prison(pt):
        return any(inside(pt, a) for a in areas)

    def cen(poly):
        return (sum(x for x, _ in poly[:-1]) / max(1, len(poly) - 1), sum(z for _, z in poly[:-1]) / max(1, len(poly) - 1))

    bld, bars, roads, flats, pois, water = [], [], [], [], [], []
    for e in raw['elements']:
        t = e.get('tags', {})
        if e['type'] == 'node':
            mm = t.get('man_made')
            if mm in ('tower', 'chimney', 'mast', 'water_tower', 'flagpole'):
                x, z = loc([(e['lat'], e['lon'])])[0]
                pois.append({'k': mm, 'x': x, 'z': z, 'h': num(t.get('height')), 't': t.get('tower:type')})
            continue
        polys = []
        if e['type'] == 'way' and e.get('geometry'):
            polys = [loc(ll(e['geometry']))]
        elif e['type'] == 'relation':
            polys = [loc(r) for r in rel_rings(e)]
        for pl in polys:
            closed = len(pl) >= 4 and pl[0] == pl[-1]
            if 'building' in t and closed:
                a = abs(area_of(pl))
                if a < 6:
                    continue
                c = cen(pl)
                ins = in_prison(c)
                h = num(t.get('height'))
                lv = num(t.get('building:levels'))
                kind = t.get('building')
                if h is None:
                    if lv is not None:
                        h = lv * 3.0 + 1.0
                    elif kind in ('garage', 'garages', 'shed', 'carport', 'hut', 'kiosk', 'roof'):
                        h = 3.2
                    elif kind in ('church', 'chapel', 'cathedral'):
                        h = 16
                    elif ins:
                        h = 10.0 if a > 500 else 7.0 if a > 150 else 4.0
                    else:
                        h = 8.0 if a > 200 else 5.0
                b = {'p': pl[:-1], 'h': round(min(h, 80), 1), 'k': kind}
                if ins:
                    b['in'] = 1
                if t.get('name'):
                    b['n'] = t['name']
                if t.get('roof:shape') and t['roof:shape'] not in ('flat',):
                    b['r'] = t['roof:shape']
                if t.get('building:min_level') or t.get('min_height'):
                    b['mh'] = num(t.get('min_height')) or (num(t.get('building:min_level')) or 0) * 3
                bld.append(b)
                continue
            if 'barrier' in t:
                kb = t['barrier']
                if kb in ('wall', 'fence', 'city_wall', 'retaining_wall', 'hedge', 'gate', 'jersey_barrier'):
                    bars.append({'p': pl, 'k': kb, 'h': num(t.get('height')), 'm': t.get('fence_type') or t.get('wall')})
                continue
            if 'highway' in t and not closed or ('highway' in t and t.get('area') != 'yes'):
                hk = t['highway']
                w = {'motorway': 14, 'trunk': 12, 'primary': 10, 'secondary': 9, 'tertiary': 8, 'residential': 7, 'unclassified': 6,
                     'service': 5, 'track': 3.5, 'living_street': 6}.get(hk, 2.2 if hk in ('footway', 'path', 'pedestrian', 'steps', 'cycleway') else 0)
                if w:
                    roads.append({'p': pl, 'k': hk, 'w': w})
                continue
            if t.get('waterway') in ('river', 'stream', 'canal', 'ditch'):
                water.append({'p': pl, 'w': 12 if t['waterway'] == 'river' else 3})
                continue
            if closed:
                kind = t.get('leisure') or t.get('landuse') or t.get('natural') or t.get('amenity') or t.get('man_made')
                if kind in ('pitch', 'track', 'park', 'garden', 'playground', 'grass', 'meadow', 'forest', 'wood', 'scrub', 'water', 'parking',
                            'farmland', 'orchard', 'allotments', 'residential', 'industrial', 'cemetery', 'recreation_ground', 'sports_centre',
                            'basin', 'reservoir', 'wetland', 'heath', 'garages', 'village_green', 'commercial', 'retail', 'military'):
                    flats.append({'p': pl[:-1], 'k': kind, 's': t.get('sport'), 'sf': t.get('surface')})
                elif t.get('man_made') in ('tower', 'chimney', 'water_tower'):
                    x, z = cen(pl)
                    pois.append({'k': t['man_made'], 'x': round(x, 1), 'z': round(z, 1), 'h': num(t.get('height')), 't': t.get('tower:type')})

    # výřez pro ortofoto: areál + 140 m
    xs = [x for a in areas for x, _ in a]
    zs = [z for a in areas for _, z in a]
    pad = 140
    bbox = [lat0 - (max(zs) + pad) / M, lon0 + (min(xs) - pad) / k, lat0 - (min(zs) - pad) / M, lon0 + (max(xs) + pad) / k]
    data = {'id': p['id'], 'name': p['name'], 'lat': round(lat0, 6), 'lon': round(lon0, 6), 'k': round(k, 3), 'bbox': [round(v, 6) for v in bbox],
            'areas': areas, 'b': bld, 'bar': bars, 'roads': roads, 'flat': flats, 'poi': pois, 'water': water}
    json.dump(data, open(os.path.join(out_dir, f"{p['id']}.json"), 'w'), ensure_ascii=False, separators=(',', ':'))
    ai = sum(abs(area_of(a)) for a in areas[:len(rings)])
    nin = sum(1 for b in bld if b.get('in'))
    print(f"{p['id']:14s} areál {ai / 10000:5.1f} ha, budov {len(bld):4d} (uvnitř {nin}), zdí/plotů {len(bars)}, cest {len(roads)}")
    return lat0, lon0, ai, nin


# ---------- Česko ----------
MAJOR_RIVERS = {'Vltava', 'Labe', 'Morava', 'Odra', 'Ohře', 'Sázava', 'Berounka', 'Dyje', 'Jihlava', 'Svratka', 'Otava', 'Lužnice', 'Jizera',
                'Orlice', 'Úpa', 'Metuje', 'Opava', 'Ostravice', 'Bečva', 'Svitava', 'Chrudimka', 'Mže', 'Radbuza', 'Úhlava', 'Malše',
                'Doubrava', 'Cidlina', 'Ploučnice', 'Nisa', 'Lužická Nisa', 'Olše', 'Oslava', 'Moravská Dyje', 'Divoká Orlice', 'Tichá Orlice',
                'Svitavy', 'Bílina', 'Rokytná', 'Želivka', 'Blanice', 'Střela', 'Litavka', 'Kamenice', 'Moravice', 'Haná', 'Dřevnice'}


def build_cz(osm_dir, out_dir, prisons_meta):
    j = lambda n: json.load(open(os.path.join(osm_dir, n)))  # noqa: E731
    tol = 0.0015
    r6 = lambda pts: [[round(b, 4), round(a, 4)] for a, b in pts]  # noqa: E731  -> [lon, lat]
    cz = j('cz_border.json')['elements'][0]
    border = [r6(dp(r, tol)) for r in rel_rings(cz)]
    border.sort(key=lambda r: -len(r))
    kraje = []
    for e in j('cz_kraje.json')['elements']:
        rings = rel_rings(e)
        if rings:
            kraje.append({'n': e['tags'].get('name', '').replace(' kraj', '').replace('Hlavní město ', ''), 'r': [r6(dp(r, tol * 1.5)) for r in rings]})
    places = []
    have = lambda n: os.path.exists(os.path.join(osm_dir, n))  # noqa: E731
    for e in (j('cz_places.json')['elements'] if have('cz_places.json') else []):
        t = e['tags']
        pop = int(num(t.get('population')) or 0)
        if t.get('place') == 'city' or pop >= 9000:
            places.append({'n': t.get('name'), 'p': pop, 'c': t['place'] == 'city', 'x': round(e['lon'], 4), 'y': round(e['lat'], 4)})
    places.sort(key=lambda q: -q['p'])
    byname = defaultdict(list)
    for e in (j('cz_rivers.json')['elements'] if have('cz_rivers.json') else []):
        n = e.get('tags', {}).get('name')
        if n in MAJOR_RIVERS and e.get('geometry'):
            byname[n].append(ll(e['geometry']))
    rivers = []
    for n, segs in byname.items():
        for l in stitch(segs):
            if len(l) > 3:
                rivers.append({'n': n, 'p': r6(dp(l, tol))})

    # silniční graf
    cls_of = {'motorway': 0, 'motorway_link': 0, 'trunk': 1, 'trunk_link': 1, 'primary': 2}
    ways = []
    cnt = defaultdict(int)
    road_el = j('cz_roads.json')['elements'] if have('cz_roads.json') else [
        {'tags': {'highway': 'primary'}, 'geometry': [{'lat': a['lat'], 'lon': a['lon']}, {'lat': b['lat'], 'lon': b['lon']}]}
        for a in prisons_meta for b in prisons_meta if a['id'] < b['id']]  # dočasně: přímé spojnice
    for e in road_el:
        g = e.get('geometry')
        if not g:
            continue
        pts = [(round(q['lat'], 6), round(q['lon'], 6)) for q in g if q]
        c = cls_of.get(e['tags'].get('highway'), 2)
        ways.append((pts, c, e['tags'].get('ref', '')))
        for i, q in enumerate(pts):
            cnt[q] += 2 if i in (0, len(pts) - 1) else 1
    vid = {}
    verts = []

    def V(q):
        if q not in vid:
            vid[q] = len(verts)
            verts.append(q)
        return vid[q]
    edges = []
    for pts, c, ref in ways:
        start = 0
        for i in range(1, len(pts)):
            if cnt[pts[i]] >= 2 or i == len(pts) - 1:
                seg = pts[start:i + 1]
                if len(seg) >= 2 and seg[0] != seg[-1]:
                    L = sum(math.hypot((seg[s + 1][0] - seg[s][0]) * M, (seg[s + 1][1] - seg[s][1]) * M * 0.64) for s in range(len(seg) - 1))
                    edges.append([V(seg[0]), V(seg[-1]), c, round(L), dp(seg, 0.0004)[1:-1], ref])
                start = i
    # jen největší souvislá komponenta
    adj = defaultdict(list)
    for ei, ed in enumerate(edges):
        adj[ed[0]].append(ed[1])
        adj[ed[1]].append(ed[0])
    comp = [-1] * len(verts)
    sizes = []
    for s in range(len(verts)):
        if comp[s] >= 0:
            continue
        cid = len(sizes)
        st = [s]
        comp[s] = cid
        n = 0
        while st:
            u = st.pop()
            n += 1
            for v in adj[u]:
                if comp[v] < 0:
                    comp[v] = cid
                    st.append(v)
        sizes.append(n)
    big = max(range(len(sizes)), key=lambda i: sizes[i])
    keep = [i for i in range(len(verts)) if comp[i] == big]
    remap = {o: n for n, o in enumerate(keep)}
    nodes = [[round(verts[i][1], 5), round(verts[i][0], 5)] for i in keep]
    E = []
    refs = {}
    for a, b, c, L, mid, ref in edges:
        if comp[a] == big:
            row = [remap[a], remap[b], c, L, [v for q in mid for v in (round(q[1], 5), round(q[0], 5))]]
            if ref:
                refs.setdefault(ref, len(refs))
                row.append(refs[ref])
            E.append(row)
    print('silnice: uzlů', len(nodes), 'hran', len(E), 'z', len(verts))
    data = {'border': border, 'kraje': kraje, 'places': places, 'rivers': rivers, 'roads': {'n': nodes, 'e': E, 'refs': list(refs)}, 'prisons': prisons_meta}
    json.dump(data, open(os.path.join(out_dir, 'cz.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    print('cz.json', os.path.getsize(os.path.join(out_dir, 'cz.json')) // 1024, 'kB')


def main(osm_dir, out):
    os.makedirs(os.path.join(out, 'prisons'), exist_ok=True)
    g = json.load(open(os.path.join(osm_dir, 'prisons_geom.json')))
    geom = {f"{e['type'][0]}{e['id']}": e for e in g['elements']}
    meta = []
    for p in PRISONS:
        lat, lon, a, nin = build_prison(p, geom, osm_dir, os.path.join(out, 'prisons'))
        m = {k: v for k, v in p.items() if k not in ('osm', 'extra')}
        m.update(lat=round(lat, 5), lon=round(lon, 5), ha=round(a / 10000, 1), nb=nin)
        meta.append(m)
    if os.path.exists(os.path.join(osm_dir, 'cz_border.json')):
        build_cz(osm_dir, out, meta)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
