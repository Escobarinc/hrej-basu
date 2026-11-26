/*
 * Mapa ČR: hranice, kraje, řeky, hlavní silnice (OSM), věznice a eskortní autobusy Vězeňské služby,
 * které jezdí mezi věznicemi po skutečném silničním grafu (dálnice, silnice pro motorová vozidla, silnice I. třídy).
 * Souřadnice mapy: km, x = východ, y = jih, střed 15,4° v. d., 49,8° s. š.
 */
const LON0 = 15.4, LAT0 = 49.8, KX = 111.32 * Math.cos(LAT0 * Math.PI / 180), KY = 111.32;
export const proj = (lon, lat) => [(lon - LON0) * KX, -(lat - LAT0) * KY];
const SPEED = [88, 78, 62]; // km/h autobusu podle třídy silnice (dálnice, I/xx čtyřpruh, I. třída)
const LAST_MILE = 35;
const COLORS = { v: '#e0563b', vv: '#e9b13b', z: '#b77be0' };

export function prisonColor(p) {
  if (/žen/i.test(p.who) && !/muži/i.test(p.who)) return COLORS.z;
  return p.typ.startsWith('vazební') ? COLORS.vv : COLORS.v;
}

// ---------- silniční graf ----------
class Heap {
  constructor() { this.a = []; }
  push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}

export class RoadGraph {
  constructor(roads) {
    this.nodes = roads.n.map(([lon, lat]) => proj(lon, lat));
    this.refs = roads.refs;
    this.edges = roads.e.map(([a, b, c, len, mid, ref]) => {
      const pts = [this.nodes[a]];
      for (let i = 0; i < mid.length; i += 2) pts.push(proj(mid[i], mid[i + 1]));
      pts.push(this.nodes[b]);
      return { a, b, c, len: len / 1000, pts, ref: ref === undefined ? null : roads.refs[ref] };
    });
    this.adj = this.nodes.map(() => []);
    this.edges.forEach((e, i) => { this.adj[e.a].push(i); this.adj[e.b].push(i); });
    this.cache = new Map();
  }
  nearest([x, y]) {
    let best = -1, bd = Infinity;
    this.nodes.forEach(([nx, ny], i) => { const d = (nx - x) ** 2 + (ny - y) ** 2; if (d < bd && this.adj[i].length) { bd = d; best = i; } });
    return best;
  }
  /** A* podle času jízdy; vrací pole hran s orientací. */
  route(s, t) {
    const key = s + '>' + t;
    if (this.cache.has(key)) return this.cache.get(key);
    const N = this.nodes, g = new Float64Array(N.length).fill(Infinity), via = new Int32Array(N.length).fill(-1);
    const h = (i) => Math.hypot(N[i][0] - N[t][0], N[i][1] - N[t][1]) / SPEED[0];
    const heap = new Heap();
    g[s] = 0; heap.push(h(s), s);
    while (heap.size) {
      const [, u] = heap.pop();
      if (u === t) break;
      for (const ei of this.adj[u]) {
        const e = this.edges[ei], v = e.a === u ? e.b : e.a, ng = g[u] + e.len / SPEED[e.c];
        if (ng < g[v]) { g[v] = ng; via[v] = ei; heap.push(ng + h(v), v); }
      }
    }
    const path = [];
    for (let v = t; v !== s && via[v] >= 0;) { const e = this.edges[via[v]]; const from = e.a === v ? e.b : e.a; path.push({ e, fwd: e.a === from }); v = from; }
    path.reverse();
    this.cache.set(key, path);
    return path;
  }
}

// ---------- eskorta ----------
let busSeq = 1;
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export class Bus {
  constructor(sim, at) {
    this.id = 'E-' + String(busSeq++).padStart(2, '0');
    this.sim = sim;
    this.at = at;
    this.state = 'stop';
    this.wait = Math.random() * 90; // min
    this.pos = [...at.xy];
    this.dir = 0;
    this.load = 0;
    this.guards = 2 + Math.floor(Math.random() * 2);
  }
  dispatch() {
    const sim = this.sim, from = this.at;
    // vazba -> výkon trestu, výkon trestu -> jiná věznice; bližší cíle častěji
    const cands = sim.prisons.filter((p) => p !== from);
    const w = cands.map((p) => {
      const d = Math.hypot(p.xy[0] - from.xy[0], p.xy[1] - from.xy[1]);
      let k = 1 / (1 + d / 120);
      if (from.typ.startsWith('vazební') && !p.typ.startsWith('vazební')) k *= 2.2;
      if (sim.busesTo(p).length > 1) k *= 0.3;
      return k;
    });
    let r = Math.random() * w.reduce((a, b) => a + b, 0), to = cands[0];
    for (let i = 0; i < cands.length; i++) { r -= w[i]; if (r <= 0) { to = cands[i]; break; } }
    const path = sim.graph.route(from.node, to.node);
    const pts = [from.xy], spd = [], refs = new Set();
    const add = (p, s) => { const l = pts[pts.length - 1]; if (Math.hypot(p[0] - l[0], p[1] - l[1]) > 1e-4) { pts.push(p); spd.push(s); } };
    add(sim.graph.nodes[from.node], LAST_MILE);
    for (const { e, fwd } of path) {
      const ep = fwd ? e.pts : [...e.pts].reverse();
      for (let i = 1; i < ep.length; i++) add(ep[i], SPEED[e.c]);
      if (e.ref && e.c < 2) refs.add(e.ref.split(';')[0]);
    }
    add(to.xy, LAST_MILE);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    let mins = 0;
    for (let i = 0; i < spd.length; i++) mins += (cum[i + 1] - cum[i]) / spd[i] * 60;
    Object.assign(this, { from, to, pts, spd, cum, s: 0, seg: 0, total: cum[cum.length - 1], dur: mins, t0: sim.time, state: 'drive', refs: [...refs].slice(0, 4) });
    this.load = 4 + Math.floor(Math.random() * 22);
    sim.log(`${this.id} vyjíždí: ${from.short} → ${to.short} (${Math.round(this.total)} km, ${this.load} odsouzených)`);
  }
  get eta() { return this.t0 + this.dur; }
  get progress() { return this.state === 'drive' ? this.s / this.total : 0; }
  update(dtMin) {
    if (this.state === 'stop') {
      this.wait -= dtMin;
      if (this.wait <= 0) this.dispatch();
      return;
    }
    let left = dtMin;
    while (left > 0 && this.state === 'drive') {
      const i = this.seg, segEnd = this.cum[i + 1], v = this.spd[i] / 60; // km/min
      const need = (segEnd - this.s) / v;
      if (need > left) { this.s += v * left; left = 0; } else { this.s = segEnd; left -= need; this.seg++; }
      if (this.seg >= this.spd.length) { this.arrive(); break; }
    }
    if (this.state === 'drive') {
      const i = this.seg, a = this.pts[i], b = this.pts[i + 1], t = (this.s - this.cum[i]) / ((this.cum[i + 1] - this.cum[i]) || 1);
      this.pos = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      this.dir = Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
  }
  arrive() {
    this.state = 'stop';
    this.at = this.to;
    this.pos = [...this.to.xy];
    this.wait = 25 + Math.random() * 70;
    this.sim.moved += this.load;
    this.sim.log(`${this.id} dorazil do ${this.to.short}: předáno ${this.load} odsouzených`);
    this.to.arrivals = (this.to.arrivals || 0) + this.load;
  }
}

export class Sim {
  constructor(data, nBuses = 18) {
    this.graph = new RoadGraph(data.roads);
    this.prisons = data.prisons.map((p) => {
      const xy = proj(p.lon, p.lat);
      return { ...p, xy, short: p.name.replace(/^(Vazební věznice a ÚVZD|Vazební věznice|Věznice a ÚVZD|Věznice)\s+/, '') };
    });
    for (const p of this.prisons) p.node = this.graph.nearest(p.xy);
    this.time = 6 * 60; // minuty od půlnoci 1. dne
    this.moved = 0;
    this.logs = [];
    // autobusy startují rovnoměrně: velké vazební věznice a věznice mají vlastní
    const hubs = ['pankrac', 'ruzyne', 'brno', 'ostrava', 'litomerice', 'bory', 'valdice', 'karvina', 'olomouc', 'budejovice', 'mirov', 'jirice', 'kurim', 'pardubice', 'hradec', 'liberec', 'teplice', 'opava'];
    this.buses = [];
    for (let i = 0; i < nBuses; i++) {
      const at = this.prisons.find((p) => p.id === hubs[i % hubs.length]) || pick(this.prisons);
      this.buses.push(new Bus(this, at));
    }
  }
  busesTo(p) { return this.buses.filter((b) => b.state === 'drive' && b.to === p); }
  busesFrom(p) { return this.buses.filter((b) => b.state === 'drive' && b.from === p); }
  busesAt(p) { return this.buses.filter((b) => b.state === 'stop' && b.at === p); }
  log(t) { this.logs.unshift({ t, time: this.time }); this.logs.length = Math.min(this.logs.length, 40); }
  update(dtMin) {
    const steps = Math.ceil(dtMin / 5);
    for (let k = 0; k < steps; k++) { const d = dtMin / steps; this.time += d; for (const b of this.buses) b.update(d); }
  }
}

export const fmtTime = (m) => { const mm = Math.floor(m) % 1440; return `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`; };

// ---------- vykreslení ----------
export class MapView {
  constructor(canvas, data, sim) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.sim = sim;
    this.data = data;
    this.cx = 0; this.cy = 0; this.scale = 2; // px / km
    this.hover = null; this.sel = null; this.follow = null;
    this.buildPaths();
    this.resize();
    addEventListener('resize', () => this.resize());
  }
  buildPaths() {
    const ring = (path, r) => { r.forEach(([lon, lat], i) => { const [x, y] = proj(lon, lat); i ? path.lineTo(x, y) : path.moveTo(x, y); }); };
    this.pBorder = new Path2D();
    for (const r of this.data.border) { ring(this.pBorder, r); this.pBorder.closePath(); }
    this.pKraje = new Path2D();
    this.krajLabels = [];
    for (const k of this.data.kraje) {
      for (const r of k.r) { ring(this.pKraje, r); this.pKraje.closePath(); }
      const big = k.r.reduce((a, b) => (b.length > a.length ? b : a));
      let sx = 0, sy = 0; for (const [lon, lat] of big) { const [x, y] = proj(lon, lat); sx += x; sy += y; }
      this.krajLabels.push({ n: k.n, x: sx / big.length, y: sy / big.length });
    }
    this.pRivers = new Path2D();
    for (const r of this.data.rivers) ring(this.pRivers, r.p);
    this.pRoads = [new Path2D(), new Path2D(), new Path2D()];
    for (const e of this.sim.graph.edges) { const p = this.pRoads[e.c]; e.pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); }
    this.places = this.data.places.map((p) => ({ ...p, xy: proj(p.x, p.y) }));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [lon, lat] of this.data.border[0]) { const [x, y] = proj(lon, lat); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    this.bb = [x0, y0, x1, y1];
  }
  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = this.c.clientWidth; this.h = this.c.clientHeight; this.dpr = dpr;
    this.c.width = this.w * dpr; this.c.height = this.h * dpr;
    if (this.w > 50 && this.h > 50 && !this.touched) this.fit();
  }
  fit() {
    const [x0, y0, x1, y1] = this.bb, narrow = this.w < 820;
    const padL = narrow ? 10 : 360, padR = narrow ? 10 : 30, padT = 90, padB = narrow ? this.h * 0.45 : 40;
    this.scale = Math.min((this.w - padL - padR) / (x1 - x0), (this.h - padT - padB) / (y1 - y0));
    this.cx = (x0 + x1) / 2 - ((padL - padR) / 2) / this.scale;
    this.cy = (y0 + y1) / 2 - ((padT - padB) / 2) / this.scale;
    this.home = { cx: this.cx, cy: this.cy, scale: this.scale };
    this.fitted = true;
  }
  toScreen([x, y]) { return [(x - this.cx) * this.scale + this.w / 2, (y - this.cy) * this.scale + this.h / 2]; }
  toWorld(sx, sy) { return [(sx - this.w / 2) / this.scale + this.cx, (sy - this.h / 2) / this.scale + this.cy]; }
  zoomAt(sx, sy, f) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.scale = Math.max(this.home.scale * 0.7, Math.min(this.home.scale * 60, this.scale * f));
    this.cx = wx - (sx - this.w / 2) / this.scale; this.cy = wy - (sy - this.h / 2) / this.scale;
    this.anim = null; this.touched = true;
  }
  flyTo(xy, scale) { this.touched = true; this.anim = { from: { cx: this.cx, cy: this.cy, scale: this.scale }, to: { cx: xy[0], cy: xy[1], scale: scale || Math.max(this.scale, this.home.scale * 5) }, t: 0 }; }
  hit(sx, sy) {
    for (const b of this.sim.buses) { if (b.state !== 'drive') continue; const [x, y] = this.toScreen(b.pos); if (Math.hypot(x - sx, y - sy) < 11) return { kind: 'bus', o: b }; }
    let best = null, bd = 15;
    for (const p of this.sim.prisons) { const [x, y] = this.toScreen(p.xy); const d = Math.hypot(x - sx, y - sy); if (d < bd) { bd = d; best = { kind: 'prison', o: p }; } }
    return best;
  }
  draw(now) {
    if (this.c.clientWidth !== this.w || this.c.clientHeight !== this.h) this.resize();
    const { ctx, dpr, w, h } = this;
    if (this.anim) {
      const a = this.anim; a.t = Math.min(1, a.t + 0.045); const e = a.t < 0.5 ? 2 * a.t * a.t : 1 - (-2 * a.t + 2) ** 2 / 2;
      this.cx = a.from.cx + (a.to.cx - a.from.cx) * e; this.cy = a.from.cy + (a.to.cy - a.from.cy) * e;
      this.scale = a.from.scale * (a.to.scale / a.from.scale) ** e;
      if (a.t >= 1) this.anim = null;
    } else if (this.follow && this.follow.state === 'drive') {
      this.cx += (this.follow.pos[0] - this.cx) * 0.15; this.cy += (this.follow.pos[1] - this.cy) * 0.15;
    }
    const s = this.scale, z = s / this.home.scale;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0e1013'; ctx.fillRect(0, 0, w, h);
    // jemná mřížka (poledníky / rovnoběžky po 1°)
    ctx.save();
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (w / 2 - this.cx * s), dpr * (h / 2 - this.cy * s));
    const px = 1 / s;
    ctx.strokeStyle = 'rgba(255,255,255,.035)'; ctx.lineWidth = px;
    ctx.beginPath();
    for (let lon = 11; lon <= 20; lon++) { const [x1, y1] = proj(lon, 47.5), [x2, y2] = proj(lon, 51.8); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
    for (let lat = 48; lat <= 51.5; lat += 0.5) { const [x1, y1] = proj(10.5, lat), [x2, y2] = proj(20.5, lat); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
    ctx.stroke();
    // Česko
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 30;
    ctx.fillStyle = '#1b1f26'; ctx.fill(this.pBorder);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1.2 * px; ctx.setLineDash([4 * px, 3 * px]); ctx.stroke(this.pKraje); ctx.setLineDash([]);
    ctx.strokeStyle = '#2a5677'; ctx.lineWidth = Math.min(2.2, 0.9 + z * 0.12) * px; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(this.pRivers);
    ctx.strokeStyle = '#33363d'; ctx.lineWidth = (z > 3 ? 1.3 : 0.8) * px; ctx.stroke(this.pRoads[2]);
    ctx.strokeStyle = '#5b5345'; ctx.lineWidth = (z > 3 ? 2 : 1.2) * px; ctx.stroke(this.pRoads[1]);
    ctx.strokeStyle = '#a3864c'; ctx.lineWidth = (z > 3 ? 3 : 1.9) * px; ctx.stroke(this.pRoads[0]);
    ctx.strokeStyle = '#c9ccd2'; ctx.lineWidth = 1.6 * px; ctx.stroke(this.pBorder);
    // trasa vybraného autobusu
    const selBus = this.sel && this.sel.kind === 'bus' ? this.sel.o : null;
    const routes = selBus ? [selBus] : this.sel && this.sel.kind === 'prison' ? [...this.sim.busesTo(this.sel.o), ...this.sim.busesFrom(this.sel.o)] : [];
    for (const b of routes) {
      if (b.state !== 'drive') continue;
      ctx.strokeStyle = 'rgba(58,111,216,.35)'; ctx.lineWidth = 6 * px; ctx.beginPath();
      b.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      ctx.strokeStyle = '#6f9bff'; ctx.lineWidth = 2.4 * px; ctx.beginPath();
      ctx.moveTo(b.pos[0], b.pos[1]); for (let i = b.seg + 1; i < b.pts.length; i++) ctx.lineTo(b.pts[i][0], b.pts[i][1]); ctx.stroke();
    }
    ctx.restore();

    // kraje – popisky
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (z < 2.6) {
      ctx.font = `600 ${Math.round(10 + z * 1.5)}px 'Bricolage Grotesque', sans-serif`; ctx.fillStyle = 'rgba(255,255,255,.13)';
      for (const k of this.krajLabels) { const [x, y] = this.toScreen([k.x, k.y]); ctx.fillText(k.n.toUpperCase(), x, y + 18); }
    }
    // města
    const nPl = z < 1.5 ? 14 : z < 3 ? 40 : z < 6 ? 120 : 400;
    ctx.font = `500 12px 'Bricolage Grotesque', sans-serif`;
    for (const p of this.places.slice(0, nPl)) {
      const [x, y] = this.toScreen(p.xy); if (x < -50 || y < -20 || x > w + 50 || y > h + 20) continue;
      const big = p.p > 90000;
      ctx.fillStyle = big ? '#8e9198' : '#61646b';
      ctx.beginPath(); ctx.arc(x, y, big ? 2.6 : 1.7, 0, 7); ctx.fill();
      ctx.font = `${big ? 600 : 500} ${big ? 13 : 11.5}px 'Bricolage Grotesque', sans-serif`;
      ctx.fillStyle = big ? 'rgba(210,212,216,.75)' : 'rgba(170,172,178,.6)';
      ctx.textAlign = 'left'; ctx.fillText(p.n, x + 5, y - 6);
    }
    // věznice
    const tt = now / 1000;
    for (const p of this.sim.prisons) {
      const [x, y] = this.toScreen(p.xy); if (x < -40 || y < -40 || x > w + 40 || y > h + 40) continue;
      const sel = this.sel && this.sel.o === p, hov = this.hover && this.hover.o === p;
      const r = (sel ? 11 : hov ? 10 : 8) * Math.min(1.35, 0.85 + z * 0.06);
      const col = prisonColor(p);
      const atNow = this.sim.busesAt(p).length;
      if (sel) { ctx.strokeStyle = col; ctx.globalAlpha = 0.6 - (tt % 1.2) / 2; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 4 + (tt % 1.2) * 14, 0, 7); ctx.stroke(); ctx.globalAlpha = 1; }
      ctx.fillStyle = 'rgba(0,0,0,.45)'; rr(ctx, x - r + 1, y - r + 2, r * 2, r * 2, r * 0.35); ctx.fill();
      ctx.fillStyle = col; rr(ctx, x - r, y - r, r * 2, r * 2, r * 0.35); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1; ctx.stroke();
      // mříže
      ctx.strokeStyle = '#1a1208'; ctx.lineWidth = Math.max(1.2, r * 0.17);
      ctx.beginPath(); for (const k of [-0.42, 0, 0.42]) { ctx.moveTo(x + k * r, y - r * 0.6); ctx.lineTo(x + k * r, y + r * 0.6); } ctx.moveTo(x - r * 0.62, y - r * 0.6); ctx.lineTo(x + r * 0.62, y - r * 0.6); ctx.stroke();
      if (atNow) { ctx.fillStyle = '#3a6fd8'; ctx.beginPath(); ctx.arc(x + r, y - r, 5, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = '700 8px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(atNow, x + r, y - r + 0.5); }
      if (z > 2.2 || sel || hov) {
        ctx.font = `700 ${sel ? 14 : 12.5}px 'Bricolage Grotesque', sans-serif`; ctx.textAlign = 'left';
        ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(14,16,19,.9)'; ctx.strokeText(p.short, x + r + 5, y + 1); ctx.fillStyle = '#f2efe8'; ctx.fillText(p.short, x + r + 5, y + 1);
      }
    }
    // autobusy
    for (const b of this.sim.buses) {
      if (b.state !== 'drive') continue;
      const [x, y] = this.toScreen(b.pos);
      if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
      const sel = selBus === b || this.follow === b, hov = this.hover && this.hover.o === b;
      const L = (sel || hov ? 17 : 13) * Math.min(1.3, 0.9 + z * 0.05), W = L * 0.48;
      ctx.save(); ctx.translate(x, y); ctx.rotate(b.dir);
      ctx.fillStyle = 'rgba(0,0,0,.5)'; rr(ctx, -L / 2 + 1, -W / 2 + 2, L, W, 2.5); ctx.fill();
      ctx.fillStyle = '#f4f4f0'; rr(ctx, -L / 2, -W / 2, L, W, 2.5); ctx.fill();
      ctx.fillStyle = '#2d5fc7'; ctx.fillRect(-L / 2 + 1, -W * 0.12, L - 2, W * 0.24);
      ctx.fillStyle = '#16233d'; ctx.fillRect(L / 2 - L * 0.16, -W / 2 + 1.2, L * 0.12, W - 2.4);
      ctx.restore();
      if (sel || hov || z > 5) {
        ctx.font = '700 10.5px sans-serif'; ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(14,16,19,.9)'; ctx.strokeText(b.id, x, y - 12); ctx.fillStyle = '#9fbcff'; ctx.fillText(b.id, x, y - 12);
      }
    }
  }
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
