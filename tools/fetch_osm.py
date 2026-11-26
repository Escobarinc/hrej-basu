"""Stáhne z Overpass všechno potřebné pro Hrej Basu.

Použití: python3 -I tools/fetch_osm.py tools/_osm
  - prisons_geom.json     hranice areálů věznic
  - p_<id>.json           budovy, zdi, ploty, cesty, hřiště kolem každé věznice
  - cz_*.json             hranice ČR, kraje, řeky, města, hlavní silnice
Data © přispěvatelé OpenStreetMap (ODbL).
"""
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from prisons import PRISONS  # noqa: E402

SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter',
           'https://maps.mail.ru/osm/tools/overpass/api/interpreter']


ROT = int(os.environ.get('ROT', '0'))
SERVERS = SERVERS[ROT:] + SERVERS[:ROT]


def overpass(q, out, tries=8):
    if os.path.exists(out) and os.path.getsize(out) > 100:
        return json.load(open(out))
    wait = 5
    for i in range(tries):
        url = SERVERS[i % len(SERVERS)]
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({'data': q}).encode(), headers={'User-Agent': 'hrej-basu-data/1.0'})
            raw = urllib.request.urlopen(req, timeout=400).read()
            if raw[:1] == b'{':
                d = json.loads(raw)
                if 'remark' in d and not d.get('elements'):
                    raise RuntimeError(d['remark'][:120])
                open(out, 'wb').write(raw)
                print('ok', os.path.basename(out), len(raw) // 1024, 'kB', flush=True)
                return d
            raise RuntimeError(raw[:80])
        except Exception as e:  # noqa: BLE001
            print('retry', os.path.basename(out), url.split('/')[2], str(e)[:100], flush=True)
            time.sleep(wait)
            wait = min(wait * 2, 60)
    raise SystemExit('Overpass selhal: ' + out)


def main(d):
    os.makedirs(d, exist_ok=True)
    ids = [p['osm'] for p in PRISONS] + [x for p in PRISONS for x in p.get('extra', [])]
    sel = ''.join(f"{'way' if i[0] == 'w' else 'relation'}({i[1:]});" for i in ids)
    g = overpass(f'[out:json][timeout:300];({sel});out geom;', os.path.join(d, 'prisons_geom.json'))
    byid = {f"{e['type'][0]}{e['id']}": e for e in g['elements']}
    for p in (PRISONS[::-1] if ROT else PRISONS):
        def geo(oid):
            e = byid[oid]
            r = list(e.get('geometry', []) or [])
            for m in e.get('members', []):
                r += m.get('geometry', []) or []
            return [q for q in r if q]
        pts = geo(p['osm'])
        c0 = (sum(q['lat'] for q in pts) / len(pts), sum(q['lon'] for q in pts) / len(pts))
        for oid in p.get('extra', []):  # sousední objekt stejného areálu (do 600 m) patří do výřezu
            ex = geo(oid)
            c1 = (sum(q['lat'] for q in ex) / len(ex), sum(q['lon'] for q in ex) / len(ex))
            if math.hypot((c1[0] - c0[0]) * 111320, (c1[1] - c0[1]) * 71000) < 600:
                pts += ex
        la = [q['lat'] for q in pts]
        lo = [q['lon'] for q in pts]
        pad_la = 140 / 111320
        pad_lo = 140 / (111320 * math.cos(math.radians(sum(la) / len(la))))
        bb = f'{min(la) - pad_la},{min(lo) - pad_lo},{max(la) + pad_la},{max(lo) + pad_lo}'
        q = (f'[out:json][timeout:200][bbox:{bb}];(way["building"];relation["building"];way["barrier"];way["highway"];'
             f'way["leisure"];way["landuse"];way["natural"];way["waterway"];way["amenity"="parking"];node["man_made"];way["man_made"];);out tags geom;')
        overpass(q, os.path.join(d, f"p_{p['id']}.json"))
        time.sleep(2)
    area = 'area["ISO3166-1"="CZ"][admin_level=2]->.cz;'
    overpass('[out:json][timeout:300];relation["ISO3166-1"="CZ"][admin_level=2];out geom;', os.path.join(d, 'cz_border.json'))
    overpass(f'[out:json][timeout:300];{area}relation["boundary"="administrative"]["admin_level"="6"](area.cz);out tags geom;', os.path.join(d, 'cz_kraje.json'))
    overpass(f'[out:json][timeout:300];{area}node["place"~"^(city|town)$"](area.cz);out;', os.path.join(d, 'cz_places.json'))
    overpass(f'[out:json][timeout:300];{area}way["waterway"="river"](area.cz);out tags geom;', os.path.join(d, 'cz_rivers.json'))
    overpass(f'[out:json][timeout:600][maxsize:1073741824];{area}way["highway"~"^(motorway|trunk|primary|motorway_link|trunk_link)$"](area.cz);out tags geom;',
             os.path.join(d, 'cz_roads.json'))


if __name__ == '__main__':
    main(sys.argv[1])
