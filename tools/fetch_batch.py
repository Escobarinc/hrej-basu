"""Stáhne okolí zbývajících věznic hromadně (několik výřezů v jednom dotazu) a rozdělí do p_<id>.json.

Použití: python3 -I tools/fetch_batch.py tools/_osm data/prisons [velikost_skupiny]
Výřezy bere z data/prisons/<id>.json (bbox), takže nejdřív build_data.py.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_osm import overpass  # noqa: E402
from prisons import PRISONS  # noqa: E402

KEYS = ['way["building"]', 'relation["building"]', 'way["barrier"]', 'way["highway"]', 'way["leisure"]', 'way["landuse"]',
        'way["natural"]', 'way["waterway"]', 'way["amenity"="parking"]', 'node["man_made"]', 'way["man_made"]']


def main(osm, pdir, n=6):
    todo = [p for p in PRISONS if not os.path.exists(os.path.join(osm, f"p_{p['id']}.json"))]
    for g in range(0, len(todo), n):
        grp = todo[g:g + n]
        bbs = {p['id']: json.load(open(os.path.join(pdir, f"{p['id']}.json")))['bbox'] for p in grp}
        body = ''.join(f'{k}({s},{w},{nn},{e});' for s, w, nn, e in bbs.values() for k in KEYS)
        fn = os.path.join(osm, f'batch_{grp[0]["id"]}.json')
        d = overpass(f'[out:json][timeout:600];({body});out tags geom;', fn, tries=12)
        for pid, (s, w, nn, e) in bbs.items():
            def hit(el):
                if el['type'] == 'node':
                    return s <= el['lat'] <= nn and w <= el['lon'] <= e
                b = el.get('bounds')
                return b and not (b['maxlat'] < s or b['minlat'] > nn or b['maxlon'] < w or b['minlon'] > e)
            els = [el for el in d['elements'] if hit(el)]
            json.dump({'elements': els}, open(os.path.join(osm, f'p_{pid}.json'), 'w'))
            print(pid, len(els), flush=True)
        os.remove(fn)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 6)
