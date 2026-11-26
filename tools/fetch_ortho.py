"""Stáhne dlaždice ortofota ČÚZK (Web Mercator) kolem každé věznice do data/ortho/<id>/<x>_<y>.jpg.

Použití: python3 -I tools/fetch_ortho.py data/prisons data/ortho
Bere výřez `bbox` z data/prisons/<id>.json (vytvoří build_data.py). Zoom 18, u velkých areálů 17 (max ~80 dlaždic).
Ortofoto © ČÚZK, otevřená data.
"""
import json
import math
import os
import sys
import time
import urllib.request

URL = 'https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/{z}/{y}/{x}'


def tile(lat, lon, z):
    n = 2 ** z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


def main(src, out):
    for fn in sorted(os.listdir(src)):
        if not fn.endswith('.json'):
            continue
        p = json.load(open(os.path.join(src, fn)))
        s, w, n, e = p['bbox']
        for z in (18, 17, 16):
            x0, y0 = tile(n, w, z)
            x1, y1 = tile(s, e, z)
            tx0, ty0, tx1, ty1 = int(x0), int(y0), int(x1), int(y1)
            if (tx1 - tx0 + 1) * (ty1 - ty0 + 1) <= 80:
                break
        d = os.path.join(out, p['id'])
        os.makedirs(d, exist_ok=True)
        cnt = 0
        for ty in range(ty0, ty1 + 1):
            for tx in range(tx0, tx1 + 1):
                f = os.path.join(d, f'{tx}_{ty}.jpg')
                if os.path.exists(f) and os.path.getsize(f) > 500:
                    continue
                for attempt in range(4):
                    try:
                        req = urllib.request.Request(URL.format(z=z, x=tx, y=ty), headers={'User-Agent': 'hrej-basu-ortho/1.0'})
                        open(f, 'wb').write(urllib.request.urlopen(req, timeout=30).read())
                        cnt += 1
                        break
                    except Exception as ex:  # noqa: BLE001
                        print('retry', p['id'], tx, ty, ex, flush=True)
                        time.sleep(2 * (attempt + 1))
                time.sleep(0.03)
        json.dump({'z': z, 'tx0': tx0, 'ty0': ty0, 'tx1': tx1, 'ty1': ty1}, open(os.path.join(d, 'tiles.json'), 'w'))
        print(p['id'], 'z', z, (tx1 - tx0 + 1) * (ty1 - ty0 + 1), 'dlaždic, nových', cnt, flush=True)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
