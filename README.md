# Hrej Basu

Všechny věznice Vězeňské služby ČR na jedné mapě Česka. Mezi věznicemi jezdí eskortní autobusy po skutečných
silnicích (dálnice, silnice I. třídy z OSM) a do každé věznice se dá podívat ve 3D, podobně jako ve hře Hrej Vinařice.

## Spuštění

```bash
python3 tools/serve.py 8644
```

Pak otevři <http://localhost:8644>.

## Co ve hře je

- mapa ČR: hranice, kraje, řeky, města, dálnice a silnice I. třídy
- 37 věznic: 27 věznic (včetně Drahonic a Velkých Přílep) a 10 vazebních věznic, barevně podle typu, se seznamem a vyhledáváním
- eskortní autobusy: vyjíždějí z věznic, jedou nejrychlejší cestou po silničním grafu (A*), předávají odsouzené, čekají a jedou dál;
  z vazby jezdí častěji do výkonu trestu. Klikni na autobus = trasa, ujeté km, příjezd, dá se sledovat
- herní čas s rychlostí 1× až 15×
- 3D pohled do každé věznice: budovy podle OSM půdorysů, povrch a střechy z ortofota ČÚZK, vězeňská zeď s ostnatým drátem
  (když ji OSM nemá, postaví se po hranici areálu), ploty, strážní věže, posuvná brána, eskortní autobus, který přijede
  po skutečných cestách k bráně a zajede dovnitř, vystupující odsouzení, vězni na vycházce a dozorci, noc se světlomety,
  procházka po areálu, klik na budovu ukáže odhad jejího účelu
- u Vinařic odkaz na plnou hru Hrej Vinařice (běží na portu 8643)

## Data (`tools/`)

1. `python3 -I tools/fetch_osm.py tools/_osm` – Overpass: areály věznic, okolí každé věznice (budovy, zdi, ploty, cesty, zeleň),
   hranice ČR, kraje, města, řeky, hlavní silnice. Při přetížení serveru jde spustit podruhé s `ROT=1` (jiný server, opačné pořadí).
2. `python3 -I tools/build_data.py tools/_osm data` – `data/cz.json` (mapa + silniční graf + seznam věznic) a `data/prisons/<id>.json`.
3. `python3 -I tools/fetch_ortho.py data/prisons data/ortho` – dlaždice ortofota ČÚZK z18 (u velkých areálů z17), skládají se až v prohlížeči.

Seznam věznic s popisem je v `tools/prisons.py` (zdroj: Wikipedie „Seznam věznic v Česku“, vscr.cz, OSM). Popisy oddělení
a stupně zabezpečení se mění, ber je jako orientační. Účel budov ve 3D je odhad podle velikosti a typu budovy, ne skutečný plán.

Data © přispěvatelé OpenStreetMap (ODbL), ortofoto © ČÚZK. Three.js (MIT).

## Věznice Vinařice (plná verze)

`vinarice/` je kopie hry Hrej Vinařice (js, css, data, assets/cars, assets/chars) s Three.js z CDN (jsdelivr, three@0.170.0).
Na mapě ČR tlačítko „Vstoupit do věznice“ u Vinařic otevře `vinarice/?veznice`: hra se sama spustí uvnitř věznice
(obědy, večeře, eskortní autobusy, hasiči, policie, koně, restart, klávesy) a nahoře je odkaz zpět na mapu.
Kopie se od originálu liší jen v `index.html` (importmap, odkaz zpět) a `js/main.js` (blok `FROM_BASU`).
Po změnách v HREJ VINARICE je potřeba kopii obnovit a tyto dvě úpravy znovu doplnit.
