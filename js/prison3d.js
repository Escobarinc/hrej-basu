/*
 * 3D pohled do areálu věznice.
 * Budovy, zdi, ploty a cesty z OSM (data/prisons/<id>.json), povrch a střechy z ortofota ČÚZK (data/ortho/<id>/).
 * Eskortní autobus přijede po skutečných cestách k bráně, ta se otevře, autobus zajede dovnitř, vystoupí odsouzení
 * a autobus zase odjede. Na dvorech chodí vězni na vycházce, po areálu dozorci.
 * Souřadnice: x = východ, z = jih (metry od středu areálu), y = nahoru.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const M = 111320;
const UNIFORM = '#4a5a70', UNIFORM2 = '#3c4a5c', GUARD = '#1b2433', SKIN = ['#e0b896', '#d2a27f', '#c18c6a', '#ebc7a8'];
const TOUCH = matchMedia('(pointer: coarse)').matches;
const DRIVE = new Set(['service', 'residential', 'unclassified', 'tertiary', 'secondary', 'primary', 'trunk', 'living_street', 'track']);

// ---------- geometrie ----------
function pip([x, z], poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-9) + xi) c = !c;
  }
  return c;
}
function segDist(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return [Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t), [a[0] + dx * t, a[1] + dz * t], t];
}
function segX(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + r[0] * t, a[1] + r[1] * t, t] : null;
}
const polyArea = (p) => { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1]; return a / 2; };
const centroid = (p) => { let x = 0, z = 0; for (const q of p) { x += q[0]; z += q[1]; } return [x / p.length, z / p.length]; };
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function splitGroups(geo) {
  return geo.groups.map((g) => {
    const out = new THREE.BufferGeometry();
    for (const name of Object.keys(geo.attributes)) {
      const at = geo.attributes[name];
      out.setAttribute(name, new THREE.BufferAttribute(at.array.slice(g.start * at.itemSize, (g.start + g.count) * at.itemSize), at.itemSize));
    }
    return out;
  });
}
function colorize(geo, col) {
  const n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

// ---------- textury ----------
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
function facade(barred, lit) {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = lit ? '#000' : '#fff'; g.fillRect(0, 0, w, h);
    if (!lit) { g.fillStyle = 'rgba(0,0,0,.05)'; g.fillRect(0, h - 10, w, 10); g.fillStyle = 'rgba(0,0,0,.07)'; g.fillRect(0, 0, w, 4); }
    const x0 = 34, y0 = 30, ww = 60, wh = 62;
    if (lit) {
      g.fillStyle = Math.random() < 0.5 ? '#ffd890' : '#f3c46e'; g.fillRect(x0, y0, ww, wh);
    } else {
      g.fillStyle = '#9a9c9c'; g.fillRect(x0 - 4, y0 + wh, ww + 8, 6);
      const gr = g.createLinearGradient(0, y0, 0, y0 + wh); gr.addColorStop(0, '#3a4652'); gr.addColorStop(1, '#1c232b');
      g.fillStyle = gr; g.fillRect(x0, y0, ww, wh);
      g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x0, y0, ww, 6);
      g.strokeStyle = '#cfd2d2'; g.lineWidth = 3; g.strokeRect(x0, y0, ww, wh);
    }
    if (barred) { g.fillStyle = lit ? '#000' : '#2a2a2a'; for (let i = 1; i < 6; i++) g.fillRect(x0 + (ww / 6) * i - 1.5, y0, 3, wh); g.fillRect(x0, y0 + wh / 2 - 1.5, ww, 3); }
  });
}
function chainLink() {
  return canvasTex(64, 64, (g) => {
    g.clearRect(0, 0, 64, 64); g.strokeStyle = 'rgba(190,196,200,.9)'; g.lineWidth = 2;
    g.beginPath(); for (let i = -64; i < 128; i += 16) { g.moveTo(i, 0); g.lineTo(i + 64, 64); g.moveTo(i + 64, 0); g.lineTo(i, 64); } g.stroke();
  });
}
function busSide(flip) {
  const t = canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = '#f3f3ef'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1f4fb4'; g.fillRect(0, 150, w, 34);
    g.fillStyle = '#e8b13b'; g.fillRect(0, 186, w, 8);
    g.fillStyle = '#222a33';
    for (let i = 0; i < 8; i++) { const x = 140 + i * 102; g.fillRect(x, 50, 66, 46); g.fillStyle = '#8c949c'; for (let k = 1; k < 5; k++) g.fillRect(x + k * 13, 50, 2.5, 46); g.fillStyle = '#222a33'; }
    g.fillRect(24, 40, 92, 80);
    g.fillStyle = '#fff'; g.font = '800 30px sans-serif'; g.textBaseline = 'middle'; g.fillText('VĚZEŇSKÁ SLUŽBA ČESKÉ REPUBLIKY', 140, 168);
  }, false);
  if (flip) { t.wrapS = THREE.RepeatWrapping; t.repeat.x = -1; }
  return t;
}

// ---------- modely ----------
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o });
function makeBus() {
  const g = new THREE.Group(), L = 11.6, W = 2.5, H = 3.1;
  const side = std('#ffffff', { map: busSide(false), roughness: 0.4 }), side2 = std('#ffffff', { map: busSide(true), roughness: 0.4 });
  const white = std('#f2f2ee', { roughness: 0.4 }), glass = std('#1b232c', { roughness: 0.15, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H - 0.4, L), [side2, side, white, white, glass, white]);
  body.position.y = 0.4 + (H - 0.4) / 2; body.castShadow = true; g.add(body);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(W * 0.6, 0.25, 3), white); roof.position.set(0, H + 0.1, -1.5); g.add(roof);
  const lightbar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.14, 0.3), std('#2a62ff', { emissive: '#2a62ff', emissiveIntensity: 0.6 }));
  lightbar.position.set(0, H + 0.08, L / 2 - 0.6); g.add(lightbar); g.userData.beacon = lightbar;
  const wg = new THREE.CylinderGeometry(0.5, 0.5, 0.32, 18); wg.rotateZ(Math.PI / 2);
  const wm = std('#1a1a1a');
  g.userData.wheels = [];
  for (const [x, z] of [[-1, L / 2 - 2.4], [1, L / 2 - 2.4], [-1, -L / 2 + 2.8], [1, -L / 2 + 2.8]]) {
    const w = new THREE.Mesh(wg, wm); w.position.set(x * (W / 2 - 0.1), 0.5, z); g.add(w); g.userData.wheels.push(w);
  }
  for (const s of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.05), std('#fff', { emissive: '#fff8d0', emissiveIntensity: 0.4 }));
    hl.position.set(s * 0.85, 0.8, L / 2 + 0.01); g.add(hl);
  }
  return g;
}
const HUM = {
  torso: new THREE.BoxGeometry(0.46, 0.62, 0.26).translate(0, 1.18, 0),
  head: new THREE.SphereGeometry(0.13, 10, 8).translate(0, 1.66, 0),
  leg: new THREE.BoxGeometry(0.17, 0.86, 0.2).translate(0, -0.43, 0),
  arm: new THREE.BoxGeometry(0.12, 0.62, 0.13).translate(0, -0.3, 0),
  cap: new THREE.CylinderGeometry(0.15, 0.15, 0.08, 10).translate(0, 1.79, 0),
};
const matCache = new Map();
const mc = (c) => { if (!matCache.has(c)) matCache.set(c, std(c)); return matCache.get(c); };
function makeHuman(guard) {
  const g = new THREE.Group(), cloth = guard ? GUARD : Math.random() < 0.7 ? UNIFORM : UNIFORM2;
  const t = new THREE.Mesh(HUM.torso, mc(cloth)); t.castShadow = true; g.add(t);
  g.add(new THREE.Mesh(HUM.head, mc(pick(SKIN))));
  if (guard) g.add(new THREE.Mesh(HUM.cap, mc('#11161f')));
  const legs = [], arms = [];
  for (const s of [-1, 1]) {
    const l = new THREE.Mesh(HUM.leg, mc(guard ? '#121822' : cloth)); l.position.set(s * 0.12, 0.86, 0); g.add(l); legs.push(l);
    const a = new THREE.Mesh(HUM.arm, mc(cloth)); a.position.set(s * 0.3, 1.46, 0); g.add(a); arms.push(a);
  }
  g.userData = { legs, arms, ph: Math.random() * 6 };
  return g;
}
function animHuman(h, speed, dt) {
  const u = h.userData; u.ph += dt * speed * 4.2;
  const s = Math.sin(u.ph) * Math.min(1, speed) * 0.6;
  u.legs[0].rotation.x = s; u.legs[1].rotation.x = -s; u.arms[0].rotation.x = -s * 0.8; u.arms[1].rotation.x = s * 0.8;
}
function makeTower() {
  const g = new THREE.Group(), conc = std('#bdbab2'), dark = std('#20262c', { roughness: 0.2, metalness: 0.4 });
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(2.2, 8, 2.2), conc); shaft.position.y = 4; shaft.castShadow = true; g.add(shaft);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.4, 3.6), [dark, dark, conc, conc, dark, dark]); cab.position.y = 9.2; cab.castShadow = true; g.add(cab);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.3, 4.4), conc); slab.position.y = 8; g.add(slab);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.35, 4.6), std('#5b5f62')); roof.position.y = 10.6; roof.castShadow = true; g.add(roof);
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.4, 10), std('#ddd', { emissive: '#fff3c0', emissiveIntensity: 0 }));
  lamp.rotation.x = Math.PI / 2; lamp.position.set(0, 11, 0); g.add(lamp); g.userData.lamp = lamp;
  return g;
}
function makeTree(n) {
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), std('#4d6b38', { flatShading: true }), n);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.22, 1, 6).translate(0, 0.5, 0), std('#5a4230'), n);
  crown.castShadow = true;
  return { crown, trunk };
}

// ---------- road graph v areálu ----------
class LocalRoads {
  constructor(roads) {
    this.nodes = []; this.adj = []; const idx = new Map();
    const node = (p) => { const k = `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`; if (!idx.has(k)) { idx.set(k, this.nodes.length); this.nodes.push(p); this.adj.push([]); } return idx.get(k); };
    this.segs = [];
    for (const r of roads) {
      if (!DRIVE.has(r.k)) continue;
      for (let i = 0; i + 1 < r.p.length; i++) {
        const a = node(r.p[i]), b = node(r.p[i + 1]), d = Math.hypot(r.p[i][0] - r.p[i + 1][0], r.p[i][1] - r.p[i + 1][1]);
        const w = r.k === 'track' ? 3 : r.k === 'service' ? 1.4 : 1; // tracky nerad
        this.adj[a].push([b, d * w]); this.adj[b].push([a, d * w]); this.segs.push([a, b, r.k]);
      }
    }
  }
  dijkstra(s) {
    const N = this.nodes.length, d = new Float64Array(N).fill(Infinity), via = new Int32Array(N).fill(-1), done = new Uint8Array(N);
    d[s] = 0;
    for (;;) { // malé grafy – stačí O(n²)
      let u = -1, best = Infinity;
      for (let i = 0; i < N; i++) if (!done[i] && d[i] < best) { best = d[i]; u = i; }
      if (u < 0) break; done[u] = 1;
      for (const [v, w] of this.adj[u]) if (d[u] + w < d[v]) { d[v] = d[u] + w; via[v] = u; }
    }
    return { d, via };
  }
  path(via, t) { const out = []; for (let v = t; v >= 0; v = via[v]) out.push(this.nodes[v]); return out.reverse(); }
}

// ---------- pohled ----------
export class PrisonView {
  constructor(canvas) {
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    r.setPixelRatio(Math.min(devicePixelRatio, TOUCH ? 1.5 : 2));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 9000);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, maxPolarAngle: Math.PI * 0.47, minDistance: 8, screenSpacePanning: false });
    this.hemi = new THREE.HemisphereLight('#dfe9f5', '#5a5648', 1.1); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff3df', 2.4); this.sun.castShadow = true; this.sun.shadow.mapSize.set(TOUCH ? 2048 : 4096, TOUCH ? 2048 : 4096);
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.4; this.scene.add(this.sun, this.sun.target);
    this.ray = new THREE.Raycaster();
    this.keys = new Set();
    addEventListener('resize', () => this.resize());
    addEventListener('keydown', (e) => { if (this.active) this.keys.add(e.code); });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    let down = null;
    canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; if (this.walk) { this.look = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); } });
    canvas.addEventListener('pointermove', (e) => {
      if (this.walk && this.look) { this.yaw -= (e.clientX - this.look[0]) * 0.004; this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch - (e.clientY - this.look[1]) * 0.004)); this.look = [e.clientX, e.clientY]; }
    });
    canvas.addEventListener('pointerup', (e) => { this.look = null; if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < (TOUCH ? 12 : 5)) this.click(e); down = null; });
    // dotykový joystick pro procházku
    const joy = document.getElementById('v3-joy'), knob = joy.firstElementChild;
    this.joy = { x: 0, y: 0 };
    const jmove = (e) => {
      const r = joy.getBoundingClientRect(), R = r.width / 2;
      let dx = e.clientX - r.left - R, dy = e.clientY - r.top - R; const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      this.joy = { x: dx / R, y: dy / R }; knob.style.transform = `translate(${dx}px,${dy}px)`;
    };
    joy.addEventListener('pointerdown', (e) => { e.stopPropagation(); joy.setPointerCapture(e.pointerId); jmove(e); });
    joy.addEventListener('pointermove', (e) => { if (joy.hasPointerCapture(e.pointerId)) jmove(e); });
    const jend = () => { this.joy = { x: 0, y: 0 }; knob.style.transform = ''; };
    joy.addEventListener('pointerup', jend); joy.addEventListener('pointercancel', jend);
    document.getElementById('v3-bus').onclick = () => this.setMode(this.mode === 'bus' ? 'orbit' : 'bus');
    document.getElementById('v3-walk').onclick = () => this.setMode(this.mode === 'walk' ? 'orbit' : 'walk');
    document.getElementById('v3-night').onclick = () => this.setNight(!this.night);
    this.mats = {
      wallIn: std('#ffffff', { map: facade(true), vertexColors: true }),
      wallOut: std('#ffffff', { map: facade(false), vertexColors: true }),
      litIn: facade(true, true), litOut: facade(false, true),
    };
    for (const k of ['wallIn', 'wallOut']) for (const t of [this.mats[k].map]) t.repeat.set(1 / 3.6, 1 / 3.1);
    for (const t of [this.mats.litIn, this.mats.litOut]) t.repeat.set(1 / 3.6, 1 / 3.1);
  }
  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w) return;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  progress(f, t) { document.getElementById('v3-bar').style.width = `${Math.round(f * 100)}%`; document.getElementById('v3-lt').textContent = t; }
  logMsg(t) { const el = document.getElementById('v3-log'), d = document.createElement('div'); d.textContent = t; el.prepend(d); while (el.children.length > 4) el.lastChild.remove(); }

  close() { this.active = false; this.keys.clear(); }
  dispose() {
    if (!this.root) return;
    this.scene.remove(this.root);
    this.root.traverse((o) => { if (o.geometry && !Object.values(HUM).includes(o.geometry)) o.geometry.dispose(); });
    this.orthoTex?.dispose();
    this.root = null;
  }

  async open(p, sim) {
    this.dispose();
    this.ready = false;
    this.active = true; this.p = p; this.sim = sim;
    document.getElementById('v3-load').hidden = false; document.getElementById('v3-pick').hidden = true; document.getElementById('v3-log').innerHTML = '';
    this.resize();
    this.progress(0.05, 'Načítám budovy z OSM…');
    const [d, tiles] = await Promise.all([fetch(`data/prisons/${p.id}.json`).then((r) => r.json()), fetch(`data/ortho/${p.id}/tiles.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)]);
    this.d = d;
    this.root = new THREE.Group(); this.scene.add(this.root);
    // ortofoto
    let ext = null;
    if (tiles) {
      const nx = tiles.tx1 - tiles.tx0 + 1, ny = tiles.ty1 - tiles.ty0 + 1, cv = document.createElement('canvas');
      cv.width = nx * 256; cv.height = ny * 256; const g = cv.getContext('2d'); g.fillStyle = '#6d7560'; g.fillRect(0, 0, cv.width, cv.height);
      let done = 0;
      await Promise.all([...Array(nx * ny).keys()].map((i) => new Promise((res) => {
        const tx = tiles.tx0 + (i % nx), ty = tiles.ty0 + Math.floor(i / nx), im = new Image();
        im.onload = () => { g.drawImage(im, (tx - tiles.tx0) * 256, (ty - tiles.ty0) * 256); res(); this.progress(0.1 + 0.6 * (++done / (nx * ny)), `Ortofoto ČÚZK ${done}/${nx * ny}`); };
        im.onerror = res; im.src = `data/ortho/${p.id}/${tx}_${ty}.jpg`;
      })));
      const n = 2 ** tiles.z, lonOf = (x) => (x / n) * 360 - 180, latOf = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
      const X = (lon) => (lon - d.lon) * d.k, Z = (lat) => -(lat - d.lat) * M;
      ext = { x0: X(lonOf(tiles.tx0)), x1: X(lonOf(tiles.tx1 + 1)), z0: Z(latOf(tiles.ty0)), z1: Z(latOf(tiles.ty1 + 1)), cv, g };
      const t = this.orthoTex = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      // průměrná barva okraje = okolní terén
      const px = g.getImageData(0, 0, cv.width, 4).data; let r = 0, gg = 0, b = 0; for (let i = 0; i < px.length; i += 4) { r += px[i]; gg += px[i + 1]; b += px[i + 2]; }
      const k = px.length / 4; this.edgeCol = new THREE.Color(`rgb(${Math.round(r / k)},${Math.round(gg / k)},${Math.round(b / k)})`);
    }
    this.ext = ext;
    this.progress(0.75, 'Stavím areál…');
    await new Promise((r) => setTimeout(r, 20));
    this.build();
    this.ready = true;
    this.progress(1, 'Hotovo');
    document.getElementById('v3-load').hidden = true;
    this.setMode('orbit', true);
    this.setNight(false);
    this.logMsg(`${p.name}: ${d.b.filter((b) => b.in).length} budov v areálu, ${this.towers.length} strážních věží`);
    this.seenLog = sim.logs[0];
  }

  build() {
    const d = this.d, ext = this.ext, root = this.root;
    const areas = d.areas.filter((a) => a.length >= 4);
    this.areas = areas;
    const inArea = (pt) => areas.some((a) => pip(pt, a));
    this.inArea = inArea;
    // terén
    const big = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), std(this.edgeCol || '#6d7560', { roughness: 1 }));
    big.position.y = -0.06; big.receiveShadow = true; root.add(big);
    let size = 400;
    if (ext) {
      const w = ext.x1 - ext.x0, h = ext.z1 - ext.z0;
      const gm = new THREE.Mesh(new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: this.orthoTex, roughness: 1 }));
      gm.position.set((ext.x0 + ext.x1) / 2, 0, (ext.z0 + ext.z1) / 2); gm.receiveShadow = true; root.add(gm);
      size = Math.max(w, h);
    }
    this.size = size;
    const sh = this.sun.shadow.camera, half = size / 2 + 40;
    Object.assign(sh, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 3000 }); sh.updateProjectionMatrix();
    this.sun.position.set(-size * 0.55, size * 0.9, size * 0.45); this.sun.target.position.set(0, 0, 0);
    this.scene.fog = new THREE.Fog('#b9c8d6', size * 1.6, size * 4.5);

    // budovy
    const uv = ext ? { // střechy = ortofoto
      generateTopUV: (g, v, a, b, c) => [a, b, c].map((i) => new THREE.Vector2((v[i * 3] - ext.x0) / (ext.x1 - ext.x0), 1 - (-v[i * 3 + 1] - ext.z0) / (ext.z1 - ext.z0))),
      generateSideWallUV: (g, v, a, b, c, dd) => {
        const P = [a, b, c, dd].map((i) => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]]);
        const useX = Math.abs(P[0][1] - P[1][1]) < Math.abs(P[0][0] - P[1][0]);
        return P.map((q) => new THREE.Vector2(useX ? q[0] : q[1], q[2]));
      },
    } : undefined;
    const roofs = [], wallsIn = [], wallsOut = [];
    this.bInfo = []; this.ranges = { roof: [], in: [], out: [] };
    const counts = { roof: 0, in: 0, out: 0 };
    const palIn = ['#e9e4d6', '#d9d6cc', '#eadfc0', '#cfd8d0', '#e4e4e0', '#d8cbb2', '#c9cdd2'], palOut = ['#e8e2d4', '#d9c9a8', '#cdbfa8', '#e3d7c7', '#bfc4c6', '#e7e0cf', '#c9b79a'];
    d.b.forEach((b, bi) => {
      if (b.p.length < 3) return;
      const pts = b.p.map(([x, z]) => new THREE.Vector2(x, -z));
      let geo;
      try { geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: Math.max(1.5, b.h - (b.mh || 0)), bevelEnabled: false, UVGenerator: uv }); } catch { return; }
      if (!geo.attributes.position.count) return;
      geo.rotateX(-Math.PI / 2); if (b.mh) geo.translate(0, b.mh, 0);
      const [cap, side] = splitGroups(geo); geo.dispose();
      const tint = new THREE.Color(pick(b.in ? palIn : palOut));
      const kind = b.in ? 'in' : 'out';
      this.ranges.roof.push([counts.roof, bi]); counts.roof += cap.attributes.position.count; roofs.push(cap);
      this.ranges[kind].push([counts[kind], bi]); counts[kind] += side.attributes.position.count; (b.in ? wallsIn : wallsOut).push(colorize(side, tint));
      this.bInfo[bi] = { ...b, c: centroid(b.p), area: Math.abs(polyArea(b.p)) };
    });
    const mk = (list, mat, name) => {
      if (!list.length) return null;
      const m = new THREE.Mesh(mergeGeometries(list), mat); m.castShadow = m.receiveShadow = true; m.name = name; root.add(m); list.forEach((g) => g.dispose()); return m;
    };
    this.roofMat = ext ? new THREE.MeshStandardMaterial({ map: this.orthoTex, roughness: 0.9 }) : std('#8a8580');
    this.mRoof = mk(roofs, this.roofMat, 'roof');
    this.mIn = mk(wallsIn, this.mats.wallIn, 'in');
    this.mOut = mk(wallsOut, this.mats.wallOut, 'out');
    this.classify();

    // zdi a ploty
    const perim = []; for (const a of areas) for (let i = 0; i + 1 < a.length; i++) perim.push([a[i], a[i + 1]]);
    const nearPerim = (p) => perim.some(([a, b]) => segDist(p, a, b)[0] < 18);
    const wallBoxes = [], fencePanels = [], posts = [], wires = [];
    this.colliders = [];
    let covered = 0, perimLen = perim.reduce((s, [a, b]) => s + Math.hypot(b[0] - a[0], b[1] - a[1]), 0);
    const addWall = (a, b, h, t, wire) => {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.3) return;
      const g = new THREE.BoxGeometry(L, h, t); g.rotateY(-Math.atan2(b[1] - a[1], b[0] - a[0])); g.translate((a[0] + b[0]) / 2, h / 2, (a[1] + b[1]) / 2);
      wallBoxes.push(g); this.colliders.push([a, b]);
      if (wire) for (let s = 0.4; s < L; s += 0.9) { const k = s / L; wires.push([a[0] + (b[0] - a[0]) * k, h + 0.35, a[1] + (b[1] - a[1]) * k, Math.atan2(b[1] - a[1], b[0] - a[0])]); }
    };
    const addFence = (a, b, h, wire) => {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.3) return;
      const g = new THREE.PlaneGeometry(L, h); g.attributes.uv.array.forEach((v, i, arr) => { arr[i] = i % 2 ? v * h / 2 : v * L / 2; });
      g.rotateY(-Math.atan2(b[1] - a[1], b[0] - a[0])); g.translate((a[0] + b[0]) / 2, h / 2, (a[1] + b[1]) / 2); fencePanels.push(g); this.colliders.push([a, b]);
      for (let s = 0; s <= L; s += 3) { const k = s / L; posts.push([a[0] + (b[0] - a[0]) * k, h, a[1] + (b[1] - a[1]) * k]); }
      if (wire) for (let s = 0.4; s < L; s += 0.9) { const k = s / L; wires.push([a[0] + (b[0] - a[0]) * k, h + 0.3, a[1] + (b[1] - a[1]) * k, Math.atan2(b[1] - a[1], b[0] - a[0])]); }
    };
    for (const bar of d.bar) {
      const p = bar.p; if (p.length < 2) continue;
      const mid = p[Math.floor(p.length / 2)], prison = nearPerim(mid) || inArea(mid);
      for (let i = 0; i + 1 < p.length; i++) {
        const a = p[i], b = p[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (prison && nearPerim(a) && nearPerim(b)) covered += L;
        if (bar.k === 'wall' || bar.k === 'city_wall') addWall(a, b, bar.h || (prison ? 5 : 2), prison ? 0.45 : 0.3, prison);
        else if (bar.k === 'fence') addFence(a, b, bar.h || (prison ? 3.8 : 1.8), prison);
        else if (bar.k === 'retaining_wall' || bar.k === 'jersey_barrier') addWall(a, b, bar.h || 1, 0.4, false);
      }
    }
    if (covered < perimLen * 0.35) { // OSM zeď nemá – postavíme vězeňskou zeď po hranici areálu
      for (const [a, b] of perim) addWall(a, b, 5, 0.45, true);
    }
    const conc = std('#c9c6bd');
    if (wallBoxes.length) { const m = new THREE.Mesh(mergeGeometries(wallBoxes), conc); m.castShadow = m.receiveShadow = true; root.add(m); }
    if (fencePanels.length) { const m = new THREE.Mesh(mergeGeometries(fencePanels), new THREE.MeshStandardMaterial({ map: chainLink(), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6 })); m.castShadow = true; root.add(m); }
    if (posts.length) {
      const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 6).translate(0, 0.5, 0), std('#8d9396', { metalness: 0.6 }), posts.length), o = new THREE.Object3D();
      posts.forEach(([x, h, z], i) => { o.position.set(x, 0, z); o.scale.set(1, h + 0.4, 1); o.updateMatrix(); im.setMatrixAt(i, o.matrix); }); root.add(im);
    }
    if (wires.length) {
      const im = new THREE.InstancedMesh(new THREE.TorusGeometry(0.32, 0.025, 4, 12), std('#b9bec2', { metalness: 0.8, roughness: 0.3 }), wires.length), o = new THREE.Object3D();
      wires.forEach(([x, y, z, r], i) => { o.position.set(x, y, z); o.rotation.set(0, -r + Math.PI / 2, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix); }); root.add(im);
    }

    // strážní věže
    this.towers = [];
    const tpos = [];
    for (const q of d.poi) if (q.k === 'tower' && inArea([q.x, q.z])) tpos.push([q.x, q.z]);
    if (tpos.length < 2 && areas[0] && Math.abs(polyArea(areas[0])) > 6000) {
      const a = areas[0].slice(0, -1), n = a.length, cand = [];
      for (let i = 0; i < n; i++) {
        const p0 = a[(i - 1 + n) % n], p1 = a[i], p2 = a[(i + 1) % n];
        const a1 = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]), a2 = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
        let t = Math.abs(a2 - a1); if (t > Math.PI) t = 2 * Math.PI - t;
        if (t > 0.6) cand.push([t, p1]);
      }
      cand.sort((x, y) => y[0] - x[0]);
      const c = centroid(a);
      for (const [, p1] of cand) {
        if (tpos.length >= 8) break;
        if (tpos.some((q) => Math.hypot(q[0] - p1[0], q[1] - p1[1]) < 70)) continue;
        const dx = c[0] - p1[0], dz = c[1] - p1[1], l = Math.hypot(dx, dz) || 1;
        tpos.push([p1[0] + (dx / l) * 3.5, p1[1] + (dz / l) * 3.5]);
      }
    }
    const tproto = makeTower();
    for (const [x, z] of tpos) {
      const t = tproto.clone(); t.position.set(x, 0, z); t.rotation.y = Math.random() * 6; root.add(t);
      t.userData.lamp = t.children[t.children.length - 1];
      this.towers.push(t);
    }
    // stromy
    const tp = [];
    for (const f of d.flat) {
      if (!['forest', 'wood', 'park', 'scrub', 'orchard', 'cemetery', 'garden'].includes(f.k) || f.p.length < 3) continue;
      const A = Math.abs(polyArea(f.p)), dens = f.k === 'forest' || f.k === 'wood' ? 70 : 220;
      let xs = Infinity, xe = -Infinity, zs = Infinity, ze = -Infinity; for (const [x, z] of f.p) { xs = Math.min(xs, x); xe = Math.max(xe, x); zs = Math.min(zs, z); ze = Math.max(ze, z); }
      for (let k = 0; k < Math.min(500, A / dens); k++) {
        const q = [rnd(xs, xe), rnd(zs, ze)];
        if (pip(q, f.p) && !inArea(q) && (!ext || (q[0] > ext.x0 - 300 && q[0] < ext.x1 + 300))) tp.push(q);
      }
    }
    if (tp.length) {
      const n = Math.min(tp.length, 2500), { crown, trunk } = makeTree(n), o = new THREE.Object3D();
      for (let i = 0; i < n; i++) {
        const [x, z] = tp[i], h = rnd(7, 15), r = rnd(2, 3.6);
        o.position.set(x, h * 0.62, z); o.scale.set(r, h * 0.42, r); o.rotation.y = Math.random() * 6; o.updateMatrix(); crown.setMatrixAt(i, o.matrix);
        o.position.set(x, 0, z); o.scale.set(1, h * 0.5, 1); o.updateMatrix(); trunk.setMatrixAt(i, o.matrix);
      }
      root.add(crown, trunk);
    }

    this.setupBus();
    this.setupPeople();
  }

  /** Odhad účelu budov ve věznici (z OSM názvu, typu, velikosti a polohy). */
  classify() {
    const ins = this.bInfo.filter((b) => b && b.in).sort((a, b) => b.area * b.h - a.area * a.h);
    ins.forEach((b, i) => {
      if (b.n) { b.role = b.n; return; }
      const k = b.k;
      if (['garage', 'garages', 'carport'].includes(k)) b.role = 'garáže / autopark';
      else if (['industrial', 'warehouse', 'manufacture'].includes(k)) b.role = b.area > 800 ? 'dílny – pracoviště odsouzených' : 'sklad';
      else if (k === 'church' || k === 'chapel') b.role = 'kaple';
      else if (b.area < 40) b.role = 'vrátnice / technické zázemí';
      else if (i < Math.max(1, Math.ceil(ins.length * 0.25)) && b.h >= 9) b.role = 'ubytovna – oddíly odsouzených';
      else if (b.area > 350) b.role = b.h >= 9 ? 'ubytovna / oddíly' : 'jídelna, kulturní nebo zdravotní středisko';
      else b.role = 'správní nebo provozní budova';
    });
  }

  setupBus() {
    const d = this.d, R = new LocalRoads(d.roads);
    this.R = R;
    this.bus = makeBus(); this.root.add(this.bus);
    this.busRoute = null; this.gate = null;
    const ins = R.nodes.map((p) => this.inArea(p));
    // brána = místo, kde silnice protíná hranici areálu
    const cross = [];
    for (const [a, b] of R.segs) {
      if (ins[a] === ins[b]) continue;
      for (const area of this.areas) for (let i = 0; i + 1 < area.length; i++) {
        const x = segX(R.nodes[a], R.nodes[b], area[i], area[i + 1]);
        if (x) cross.push({ inN: ins[a] ? a : b, outN: ins[a] ? b : a, pt: [x[0], x[1]], dir: Math.atan2(area[i + 1][1] - area[i][1], area[i + 1][0] - area[i][0]) });
      }
    }
    if (!cross.length && this.areas[0] && R.nodes.length) {
      // OSM nemá cestu do areálu: brána na hranici co nejblíž silnici, dovnitř kus rovně ke středu
      const area = this.areas[0], c = centroid(area.slice(0, -1));
      let bestN = -1, bd = Infinity, gpt = null, gdir = 0;
      R.segs.forEach(([a, b, k]) => {
        if (k === 'track') return;
        for (const n of [a, b]) {
          if (ins[n]) continue;
          for (let i = 0; i + 1 < area.length; i++) {
            const [dd, q] = segDist(R.nodes[n], area[i], area[i + 1]);
            if (dd < bd) { bd = dd; bestN = n; gpt = q; gdir = Math.atan2(area[i + 1][1] - area[i][1], area[i + 1][0] - area[i][0]); }
          }
        }
      });
      if (bestN >= 0 && bd < 150) {
        const dx = c[0] - gpt[0], dz = c[1] - gpt[1], l = Math.hypot(dx, dz) || 1;
        let inPt = [gpt[0] + (dx / l) * Math.min(40, l * 0.7), gpt[1] + (dz / l) * Math.min(40, l * 0.7)];
        if (this.bInfo.some((b) => b && pip(inPt, b.p))) inPt = [gpt[0] + (dx / l) * 8, gpt[1] + (dz / l) * 8];
        const ni = R.nodes.length; R.nodes.push(inPt); R.adj.push([]); ins.push(true);
        cross.push({ inN: ni, outN: bestN, pt: gpt, dir: gdir });
      }
    }
    if (!cross.length) { this.bus.visible = false; return; }
    // nejlepší brána: venku navazuje na veřejnou silnici
    const pub = new Set(); R.segs.forEach(([a, b, k]) => { if (k !== 'service' && k !== 'track') { pub.add(a); pub.add(b); } });
    let best = null;
    for (const c of cross) {
      const { d: dist, via } = R.dijkstra(c.outN);
      let bestPub = -1, bd = Infinity;
      for (let i = 0; i < R.nodes.length; i++) if (pub.has(i) && !ins[i] && dist[i] < bd) { bd = dist[i]; bestPub = i; }
      const score = bd + (bestPub < 0 ? 1e6 : 0);
      if (!best || score < best.score) best = { ...c, score, via, dist, pubN: bestPub };
    }
    // start: na veřejné silnici 120–260 m před bránou
    const { d: dist } = R.dijkstra(best.outN);
    let start = best.pubN >= 0 ? best.pubN : best.outN, sd = 0;
    for (let i = 0; i < R.nodes.length; i++) if (!ins[i] && dist[i] > 120 && dist[i] < 320 && dist[i] > sd && (pub.has(i) || best.pubN < 0)) { sd = dist[i]; start = i; }
    // cíl: vnitřní uzel nejdál od brány (do 300 m) – parkoviště u největších budov
    const dIn = R.dijkstra(best.inN);
    let end = best.inN, ed = 0;
    const core = this.bInfo.filter((b) => b && b.in).sort((a, b) => b.area - a.area)[0];
    for (let i = 0; i < R.nodes.length; i++) {
      if (!ins[i] || !isFinite(dIn.d[i]) || dIn.d[i] > 320) continue;
      const near = core ? -Math.hypot(R.nodes[i][0] - core.c[0], R.nodes[i][1] - core.c[1]) * 0.6 : 0;
      const sc = Math.min(dIn.d[i], 180) + near;
      if (sc > ed) { ed = sc; end = i; }
    }
    const a = R.dijkstra(start), toGate = R.path(a.via, best.outN), inside = R.path(dIn.via, end);
    const path = [...toGate, best.pt, ...inside];
    if (path.length < 3) { this.bus.visible = false; return; }
    this.busRoute = this.resample(path);
    // posuvná brána
    const gw = 7.5, gate = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.BoxGeometry(gw, 4.2, 0.2), std('#6f777c', { metalness: 0.6, roughness: 0.45 }));
    panel.position.y = 2.1; panel.castShadow = true; gate.add(panel);
    for (const s of [-1, 1]) { const pil = new THREE.Mesh(new THREE.BoxGeometry(0.9, 5.4, 0.9), std('#b9b6ae')); pil.position.set(s * (gw / 2 + 0.45), 2.7, 0); gate.add(pil); }
    const kiosk = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3, 3.4), std('#dcd8ce')); kiosk.position.set(gw / 2 + 3.2, 1.5, 2.6); kiosk.castShadow = true; gate.add(kiosk);
    gate.position.set(best.pt[0], 0, best.pt[1]); gate.rotation.y = -best.dir; this.root.add(gate);
    this.gate = { g: gate, panel, open: 0, w: gw };
    this.busT = 0; this.busPhase = 'in'; this.busWait = 0; this.busSpeed = 0;
    this.gateS = this.busRoute.cum[toGate.length] || this.busRoute.total * 0.5;
  }
  resample(pts) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, cum, total: cum[cum.length - 1] };
  }
  at(route, s) {
    const { pts, cum } = route; s = Math.max(0, Math.min(route.total - 0.001, s));
    let i = 0; while (i < cum.length - 2 && cum[i + 1] < s) i++;
    const t = (s - cum[i]) / ((cum[i + 1] - cum[i]) || 1), a = pts[i], b = pts[i + 1];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  setupPeople() {
    this.people = [];
    const d = this.d, ins = this.bInfo.filter((b) => b && b.in);
    const yards = d.flat.filter((f) => f.p.length >= 3 && ['pitch', 'grass', 'playground', 'recreation_ground', 'sports_centre', 'track', 'park', 'village_green'].includes(f.k) && this.inArea(centroid(f.p)));
    const area = this.areas[0];
    if (!area) return;
    const inBuilding = (q) => ins.some((b) => pip(q, b.p));
    this.freeSpot = (poly) => {
      let xs = Infinity, xe = -Infinity, zs = Infinity, ze = -Infinity; for (const [x, z] of poly) { xs = Math.min(xs, x); xe = Math.max(xe, x); zs = Math.min(zs, z); ze = Math.max(ze, z); }
      for (let k = 0; k < 40; k++) { const q = [rnd(xs, xe), rnd(zs, ze)]; if (pip(q, poly) && !inBuilding(q)) return q; }
      return null;
    };
    const A = Math.abs(polyArea(area)), nPr = Math.round(Math.min(90, Math.max(24, A / 1500)));
    const groups = yards.length ? yards.slice(0, 6).map((y) => y.p) : [area];
    for (let i = 0; i < nPr; i++) {
      const poly = groups[i % groups.length], q = this.freeSpot(poly); if (!q) continue;
      const h = makeHuman(false); h.position.set(q[0], 0, q[1]); this.root.add(h);
      this.people.push({ h, poly, target: null, wait: rnd(0, 6), speed: rnd(0.9, 1.4) });
    }
    for (let i = 0; i < Math.max(4, nPr / 9); i++) {
      const q = this.freeSpot(area); if (!q) continue;
      const h = makeHuman(true); h.position.set(q[0], 0, q[1]); this.root.add(h);
      this.people.push({ h, poly: area, target: null, wait: rnd(0, 6), speed: rnd(1, 1.3), guard: true });
    }
    this.arrivals = [];
  }

  setMode(m, reset) {
    this.mode = m; this.walk = m === 'walk';
    document.getElementById('v3-bus').classList.toggle('on', m === 'bus');
    document.getElementById('v3-walk').classList.toggle('on', m === 'walk');
    this.controls.enabled = m === 'orbit';
    document.getElementById('v3-joy').hidden = !(m === 'walk' && TOUCH);
    document.getElementById('v3-hint').textContent = TOUCH
      ? (m === 'walk' ? 'Joystick = chůze · táhni prstem = rozhlížení' : m === 'bus' ? 'Kamera sleduje eskortní autobus' : 'Prst: otáčení · dva prsty: zoom a posun · ťukni na budovu')
      : (m === 'walk' ? 'W A S D chůze · Shift běh · táhni myší = rozhlížení' : m === 'bus' ? 'Kamera sleduje eskortní autobus' : 'Myš: otáčení · pravé tlačítko: posun · kolečko: zoom · klikni na budovu');
    if (m === 'orbit' && reset) {
      const s = Math.min(this.size, 900);
      if (this.camera.aspect < 0.8) this.camera.position.set(s * 0.18, s * 0.95, s * 0.55); // telefon na výšku: víc shora
      else this.camera.position.set(s * 0.38, s * 0.42, s * 0.62); this.controls.target.set(0, 0, 0); this.controls.maxDistance = this.size * 2.5;
    }
    if (m === 'orbit' && !reset) { this.controls.target.set(this.camera.position.x + Math.sin(this.yaw || 0) * -20, 0, this.camera.position.z - Math.cos(this.yaw || 0) * 20); }
    if (m === 'walk') {
      const g = this.gate ? this.gate.g.position : new THREE.Vector3();
      const c = this.areas[0] ? centroid(this.areas[0]) : [0, 0];
      let q = this.freeSpot ? this.freeSpot(this.areas[0] || [[-50, -50], [50, -50], [50, 50], [-50, 50]]) : [0, 0];
      // start kousek za bránou: první místo, odkud se dá vykročit všemi směry (ne v budově, ne u zdi)
      const free = (p) => p && [[2, 0], [-2, 0], [0, 2], [0, -2]].filter(([dx, dz]) => !this.blocked(p, [p[0] + dx, p[1] + dz])).length >= 3;
      if (this.gate) {
        const L = Math.hypot(c[0] - g.x, c[1] - g.z) || 1, ux = (c[0] - g.x) / L, uz = (c[1] - g.z) / L;
        for (let d = 6; d < L; d += 2) { const p = [g.x + ux * d, g.z + uz * d]; if (free(p)) { q = p; break; } }
      }
      for (let k = 0; k < 30 && !free(q); k++) q = this.freeSpot(this.areas[0]) || q;
      this.me = new THREE.Vector3(q[0], 1.7, q[1]); this.yaw = Math.atan2(-(c[0] - q[0]), -(c[1] - q[1])); this.pitch = 0;
    }
  }
  setNight(n) {
    this.night = n;
    document.getElementById('v3-night').classList.toggle('on', n);
    document.getElementById('v3-night').textContent = n ? 'Den' : 'Noc';
    this.sun.intensity = n ? 0.12 : 2.4; this.sun.color.set(n ? '#9fb4ff' : '#fff3df');
    this.hemi.intensity = n ? 0.18 : 1.1;
    const sky = n ? '#0b1020' : '#a9c2da'; this.scene.background = new THREE.Color(sky); this.scene.fog?.color.set(n ? '#0b1020' : '#b9c8d6');
    for (const k of ['wallIn', 'wallOut']) { const m = this.mats[k]; m.emissiveMap = n ? this.mats[k === 'wallIn' ? 'litIn' : 'litOut'] : null; m.emissive.set(n ? '#ffffff' : '#000000'); m.emissiveIntensity = n ? 0.9 : 0; m.needsUpdate = true; }
    if (!this.spots) {
      this.spots = [];
      for (const t of (this.towers || []).slice(0, 6)) {
        const sp = new THREE.SpotLight('#fff2c8', 0, 220, 0.22, 0.4, 1.2); sp.position.set(t.position.x, 11, t.position.z);
        this.root.add(sp, sp.target); this.spots.push({ sp, t, ph: Math.random() * 6 });
      }
    }
    for (const s of this.spots) { s.sp.intensity = n ? 9000 : 0; s.t.userData.lamp.material = s.t.userData.lamp.material.clone(); s.t.userData.lamp.material.emissiveIntensity = n ? 3 : 0; }
  }

  click(e) {
    if (this.walk) return;
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hits = this.ray.intersectObjects([this.mRoof, this.mIn, this.mOut].filter(Boolean), false);
    const el = document.getElementById('v3-pick');
    this.hl && this.root.remove(this.hl);
    if (!hits.length) { el.hidden = true; return; }
    const h = hits[0], key = h.object.name, vi = h.face.a, rg = this.ranges[key];
    let bi = rg[0][1]; for (const [s, b] of rg) { if (s <= vi) bi = b; else break; }
    const b = this.bInfo[bi]; if (!b) return;
    const pts = b.p.map(([x, z]) => new THREE.Vector2(x, -z));
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: b.h + 0.3, bevelEnabled: false }); g.rotateX(-Math.PI / 2);
    this.hl = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: '#ffd23a' })); this.root.add(this.hl);
    el.hidden = false;
    el.innerHTML = `<h3>${b.in ? b.role || 'budova v areálu' : b.n || 'budova mimo areál'}</h3>
      <p>${b.in ? 'uvnitř areálu věznice' : 'mimo areál'}${b.k && b.k !== 'yes' ? ` · OSM: ${b.k}` : ''}</p>
      <p>půdorys ${Math.round(b.area)} m² · výška ~${Math.round(b.h)} m (${Math.max(1, Math.round((b.h - 1) / 3))} podl.)</p>
      ${b.in && !b.n ? '<p style="color:#9a9c9f;font-size:12.5px">Účel je odhad podle velikosti a typu budovy.</p>' : ''}`;
  }

  frame(dt, sim, timeScale) {
    if (!this.active || !this.ready) return;
    // zprávy z mapy, které se týkají této věznice
    if (sim.logs[0] !== this.seenLog) {
      for (const l of sim.logs) { if (l === this.seenLog) break; if (l.t.includes(this.p.short)) { this.logMsg(l.t); if (l.t.includes('dorazil') && this.busPhase === 'idle') this.busPhase = 'in'; } }
      this.seenLog = sim.logs[0];
    }
    this.updateBus(dt);
    this.updatePeople(dt);
    if (this.spots) for (const s of this.spots) { s.ph += dt * 0.35; const r = 60; s.sp.target.position.set(s.t.position.x + Math.cos(s.ph) * r, 0, s.t.position.z + Math.sin(s.ph) * r); }
    if (this.bus.userData.beacon) this.bus.userData.beacon.material.emissiveIntensity = (Math.sin(performance.now() / 120) > 0 ? 2.2 : 0.1);
    // kamera
    if (this.mode === 'orbit') this.controls.update();
    else if (this.mode === 'bus' && this.busRoute) {
      const b = this.bus.position, yaw = this.bus.rotation.y;
      const want = new THREE.Vector3(b.x - Math.sin(yaw) * 22, 11, b.z - Math.cos(yaw) * 22);
      this.camera.position.lerp(want, 1 - Math.exp(-dt * 2.5)); this.camera.lookAt(b.x, 2, b.z);
    } else if (this.mode === 'walk') {
      const k = this.keys, sp = (k.has('ShiftLeft') || k.has('ShiftRight') ? 6 : 2.6) * dt;
      let f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      let s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      if (this.joy.x || this.joy.y) { f = -this.joy.y; s = this.joy.x; }
      if (k.has('KeyQ')) this.yaw += dt * 1.8; if (k.has('KeyE')) this.yaw -= dt * 1.8;
      const dx = (-Math.sin(this.yaw) * f + Math.cos(this.yaw) * s) * sp, dz = (-Math.cos(this.yaw) * f - Math.sin(this.yaw) * s) * sp;
      const nx = this.me.x + dx, nz = this.me.z + dz;
      if (!this.blocked([this.me.x, this.me.z], [nx, nz])) { this.me.x = nx; this.me.z = nz; }
      else if (!this.blocked([this.me.x, this.me.z], [nx, this.me.z])) this.me.x = nx;
      else if (!this.blocked([this.me.x, this.me.z], [this.me.x, nz])) this.me.z = nz;
      this.camera.position.copy(this.me);
      this.camera.lookAt(this.me.x - Math.sin(this.yaw) * Math.cos(this.pitch), this.me.y + Math.sin(this.pitch), this.me.z - Math.cos(this.yaw) * Math.cos(this.pitch));
    }
    this.renderer.render(this.scene, this.camera);
  }
  blocked(a, b) {
    for (const bi of this.bInfo) if (bi && Math.abs(bi.c[0] - b[0]) < 120 && Math.abs(bi.c[1] - b[1]) < 120 && pip(b, bi.p)) return true;
    for (const [p, q] of this.colliders) if (segX(a, b, p, q) || segDist(b, p, q)[0] < 0.3) {
      if (this.gate && this.gate.open > 0.8 && Math.hypot(b[0] - this.gate.g.position.x, b[1] - this.gate.g.position.z) < 4.5) continue;
      return true;
    }
    return false;
  }

  updateBus(dt) {
    const R = this.busRoute; if (!R) return;
    const g = this.gate;
    let s = this.busT;
    const nearGate = Math.abs(s - this.gateS) < 26;
    const wantOpen = nearGate && this.busPhase !== 'park' && this.busPhase !== 'idle';
    g.open += (wantOpen ? 1 : -1) * dt * 0.35; g.open = Math.max(0, Math.min(1, g.open));
    g.panel.position.x = -g.open * (g.w - 0.6);
    let target = this.busPhase === 'park' || this.busPhase === 'idle' ? 0 : 7;
    const ahead = this.busPhase === 'in' ? this.gateS - s : this.busPhase === 'out' ? s - this.gateS : 99;
    if (ahead > 0 && ahead < 14 && g.open < 0.95) target = 0; // čeká na bránu
    else if (Math.abs(ahead) < 30) target = 3.2;
    if (this.busPhase === 'in' && R.total - s < 20) target = Math.min(target, 1 + (R.total - s) * 0.2);
    if (this.busPhase === 'out' && s < 15) target = Math.min(target, 1 + s * 0.3);
    this.busSpeed += (target - this.busSpeed) * Math.min(1, dt * 1.4);
    if (this.busPhase === 'in') {
      s += this.busSpeed * dt;
      if (s >= R.total - 0.2) { s = R.total - 0.2; this.busPhase = 'park'; this.busWait = 14; this.unload(); }
    } else if (this.busPhase === 'park') {
      this.busWait -= dt; if (this.busWait <= 0) this.busPhase = 'out';
    } else if (this.busPhase === 'out') {
      s -= this.busSpeed * dt;
      if (s <= 0.5) { this.busPhase = 'idle'; this.busWait = 18; }
    } else if (this.busPhase === 'idle') {
      this.busWait -= dt; if (this.busWait <= 0) this.busPhase = 'in';
    }
    this.busT = s;
    const p = this.at(R, s), q = this.at(R, s + (this.busPhase === 'out' ? -3 : 3));
    const back = this.busPhase === 'out';
    this.bus.position.set(p[0], 0, p[1]);
    const yaw = Math.atan2(q[0] - p[0], q[1] - p[1]) + (back ? Math.PI : 0);
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.2) {
      let dy = yaw - this.bus.rotation.y; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      this.bus.rotation.y += dy * Math.min(1, dt * 5);
    }
    for (const w of this.bus.userData.wheels) w.rotation.x += this.busSpeed * dt * 2 * (back ? 1 : -1) * -1;
    this.bus.visible = !(this.busPhase === 'idle');
  }
  unload() {
    const rides = this.sim.busesAt(this.p)[0];
    const n = rides ? Math.min(14, rides.load) : 4 + Math.floor(Math.random() * 8);
    this.logMsg(`${rides ? rides.id : 'Eskorta'} v areálu: vystupuje ${n} odsouzených`);
    const target = this.bInfo.filter((b) => b && b.in).sort((a, b) => Math.hypot(a.c[0] - this.bus.position.x, a.c[1] - this.bus.position.z) - Math.hypot(b.c[0] - this.bus.position.x, b.c[1] - this.bus.position.z))[0];
    for (let i = 0; i < n; i++) {
      const h = makeHuman(i % 7 === 0); h.position.set(this.bus.position.x + rnd(-1, 1), 0, this.bus.position.z + rnd(-1, 1)); this.root.add(h);
      this.arrivals.push({ h, delay: i * 0.7, to: target ? target.c : [0, 0], speed: 1.1 });
    }
  }
  updatePeople(dt) {
    for (const p of this.people) {
      if (p.wait > 0) { p.wait -= dt; animHuman(p.h, 0, dt); continue; }
      if (!p.target) { p.target = this.freeSpot(p.poly); if (!p.target) { p.wait = 3; continue; } }
      const dx = p.target[0] - p.h.position.x, dz = p.target[1] - p.h.position.z, L = Math.hypot(dx, dz);
      if (L < 0.4) { p.target = null; p.wait = rnd(2, 12); continue; }
      const st = Math.min(L, p.speed * dt), nx = p.h.position.x + (dx / L) * st, nz = p.h.position.z + (dz / L) * st;
      if (this.bInfo.some((b) => b && b.in && Math.abs(b.c[0] - nx) < 80 && Math.abs(b.c[1] - nz) < 80 && pip([nx, nz], b.p))) { p.target = null; continue; }
      p.h.position.x = nx; p.h.position.z = nz; p.h.rotation.y = Math.atan2(dx, dz);
      animHuman(p.h, p.speed, dt);
    }
    for (let i = this.arrivals.length - 1; i >= 0; i--) {
      const a = this.arrivals[i];
      if (a.delay > 0) { a.delay -= dt; a.h.visible = a.delay < 0.3; continue; }
      const dx = a.to[0] - a.h.position.x, dz = a.to[1] - a.h.position.z, L = Math.hypot(dx, dz);
      if (L < 3 || a.t > 60) { this.root.remove(a.h); this.arrivals.splice(i, 1); continue; }
      a.t = (a.t || 0) + dt;
      const st = a.speed * dt; a.h.position.x += (dx / L) * st; a.h.position.z += (dz / L) * st; a.h.rotation.y = Math.atan2(dx, dz); animHuman(a.h, a.speed, dt);
    }
  }
}
