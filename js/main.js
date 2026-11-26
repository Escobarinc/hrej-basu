import { Sim, MapView, prisonColor, fmtTime } from './map.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const data = await (await fetch('data/cz.json')).json();
const sim = new Sim(data, 18);
const view = new MapView($('#map'), data, sim);
let timeScale = 240; // herní minuty za reálnou… viz níže: 240× = 4 herní minuty za sekundu
let mode = 'map', v3 = null;

// ---------- seznam ----------
$('#st-prisons').textContent = sim.prisons.length;
function renderList(q = '') {
  const n = q.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const ok = sim.prisons.filter((p) => !n || norm(`${p.name} ${p.town} ${p.kraj} ${p.who}`).includes(n));
  const groups = [['Věznice', ok.filter((p) => !p.typ.startsWith('vazební'))], ['Vazební věznice', ok.filter((p) => p.typ.startsWith('vazební'))]];
  const ul = $('#plist');
  ul.innerHTML = '';
  for (const [g, arr] of groups) {
    if (!arr.length) continue;
    const li = document.createElement('li'); li.className = 'grp'; li.textContent = `${g} · ${arr.length}`; ul.append(li);
    arr.sort((a, b) => a.short.localeCompare(b.short, 'cs'));
    for (const p of arr) {
      const li2 = document.createElement('li'), b = document.createElement('button');
      const nb = sim.busesTo(p).length + sim.busesAt(p).length;
      b.innerHTML = `<i style="background:${prisonColor(p)}"></i><span><b>${esc(p.short)}</b><small>${esc(p.kraj)} · ${esc(p.zab)}</small></span>${nb ? `<em>🚌 ${nb}</em>` : ''}`;
      b.dataset.id = p.id;
      if (view.sel && view.sel.o === p) b.classList.add('sel');
      b.onclick = () => selectPrison(p, true);
      li2.append(b); ul.append(li2);
    }
  }
}
$('#q').addEventListener('input', (e) => renderList(e.target.value));
$('#btn-list').onclick = () => $('#list').classList.toggle('closed');
renderList();

// ---------- info panel ----------
function busLine(b) {
  return `<div>🚌 <b style="display:inline">${b.id}</b> ${esc(b.from.short)} → ${esc(b.to.short)} · příjezd ${fmtTime(b.eta)}</div>`;
}
function prisonInfo(p) {
  const to = sim.busesTo(p), from = sim.busesFrom(p), at = sim.busesAt(p);
  const col = prisonColor(p);
  const vin = p.id === 'vinarice';
  return `<button class="x" title="Zavřít">✕</button>
    <div class="kind" style="color:${col}">${esc(p.typ)}</div>
    <h2>${esc(p.name)}</h2>
    <p class="town">${esc(p.town)} · ${esc(p.kraj)} kraj</p>
    <dl>
      <dt>Zabezpečení</dt><dd>${esc(p.zab)}</dd>
      <dt>Kdo tu sedí</dt><dd>${esc(p.who)}</dd>
      <dt>Areál</dt><dd>${p.ha ? `${p.ha} ha` : '–'}${p.nb ? ` · ${p.nb} budov` : ''}</dd>
      <dt>Přivezeno dnes</dt><dd>${p.arrivals || 0} odsouzených</dd>
    </dl>
    <p class="note">${esc(p.note)}</p>
    <div class="buses"><b>Eskorty</b>${[...at.map((b) => `<div>🅿 <b style="display:inline">${b.id}</b> stojí v areálu, odjezd za ${Math.max(1, Math.round(b.wait))} min</div>`), ...to.map(busLine), ...from.map(busLine)].join('') || '<div>Teď sem nic nejede.</div>'}</div>
    <button class="btn wide" id="enter">Vstoupit do věznice</button>
    ${vin ? '<button class="btn ghost wide" id="enter-osm">Jen 3D náhled z mapových dat</button><p class="note" style="margin-top:10px">Vinařice se otevřou jako celá hra Hrej Vinařice přímo ve věznici: obědy, večeře, eskorty, hasiči, policie, koně.</p>' : ''}`;
}
function busInfo(b) {
  const pct = Math.round(b.progress * 100);
  return `<button class="x" title="Zavřít">✕</button>
    <div class="kind" style="color:#6f9bff">Eskortní autobus Vězeňské služby</div>
    <h2>${b.id}</h2>
    <p class="town">${esc(b.from.short)} → ${esc(b.to.short)}</p>
    <div class="busbar"><i style="width:${pct}%"></i></div>
    <dl>
      <dt>Ujeto</dt><dd>${Math.round(b.s)} / ${Math.round(b.total)} km</dd>
      <dt>Odjezd</dt><dd>${fmtTime(b.t0)}</dd>
      <dt>Příjezd</dt><dd>${fmtTime(b.eta)}</dd>
      <dt>Na palubě</dt><dd>${b.load} odsouzených, ${b.guards} příslušníci eskorty</dd>
      ${b.refs.length ? `<dt>Trasa</dt><dd>${b.refs.map(esc).join(' · ')}</dd>` : ''}
    </dl>
    <button class="btn wide" id="follow">${view.follow === b ? 'Přestat sledovat' : 'Sledovat autobus'}</button>
    <button class="btn ghost wide" id="goto">Cíl: ${esc(b.to.short)}</button>`;
}
let infoTimer = 0;
function renderInfo() {
  const el = $('#info');
  if (!view.sel) { el.hidden = true; return; }
  el.hidden = false;
  const { kind, o } = view.sel;
  el.innerHTML = kind === 'prison' ? prisonInfo(o) : busInfo(o);
  el.querySelector('.x').onclick = () => { view.sel = null; view.follow = null; renderInfo(); renderList($('#q').value); };
  if (kind === 'prison') {
    el.querySelector('#enter').onclick = () => (o.id === 'vinarice' ? (location.href = 'vinarice/?veznice') : enter(o));
    el.querySelector('#enter-osm')?.addEventListener('click', () => enter(o));
  }
  else {
    el.querySelector('#follow').onclick = () => { view.follow = view.follow === o ? null : o; if (view.follow) view.scale = Math.max(view.scale, view.home.scale * 4); renderInfo(); };
    el.querySelector('#goto').onclick = () => selectPrison(o.to, true);
    if (o.state !== 'drive') selectPrison(o.at, false);
  }
}
function selectPrison(p, fly) {
  view.sel = { kind: 'prison', o: p }; view.follow = null;
  if (fly) view.flyTo(p.xy, Math.max(view.scale, view.home.scale * 4.5));
  renderInfo(); renderList($('#q').value);
  if (innerWidth < 820) $('#list').classList.add('closed');
}

// ---------- ovládání mapy ----------
const cv = $('#map'), ptrs = new Map();
let drag = null, moved = 0, pinch = null;
cv.addEventListener('pointerdown', (e) => {
  cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
  if (ptrs.size === 1) { drag = { x: e.offsetX, y: e.offsetY }; moved = 0; cv.classList.add('drag'); }
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) }; }
});
cv.addEventListener('pointermove', (e) => {
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
  if (pinch && ptrs.size === 2) {
    const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    view.zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, d / pinch.d); pinch.d = d; moved = 99; return;
  }
  if (drag) {
    const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y; moved += Math.abs(dx) + Math.abs(dy);
    view.cx -= dx / view.scale; view.cy -= dy / view.scale; view.touched = true; drag = { x: e.offsetX, y: e.offsetY }; view.anim = null;
    if (moved > 6) view.follow = null;
    return;
  }
  const h = view.hit(e.offsetX, e.offsetY);
  view.hover = h;
  const tip = $('#tip');
  if (h) {
    tip.hidden = false; tip.style.left = e.offsetX + 'px'; tip.style.top = e.offsetY + 'px';
    tip.innerHTML = h.kind === 'prison' ? `<b>${esc(h.o.name)}</b><br><small>${esc(h.o.town)}</small>` : `<b>${h.o.id}</b> ${esc(h.o.from.short)} → ${esc(h.o.to.short)}<br><small>${Math.round(h.o.progress * 100)} % · příjezd ${fmtTime(h.o.eta)}</small>`;
    cv.style.cursor = 'pointer';
  } else { tip.hidden = true; cv.style.cursor = ''; }
});
const up = (e) => {
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinch = null;
  if (drag && ptrs.size === 0) {
    cv.classList.remove('drag');
    if (moved < 6) {
      const h = view.hit(e.offsetX, e.offsetY);
      if (h && h.kind === 'prison') selectPrison(h.o, false);
      else if (h) { view.sel = h; renderInfo(); }
      else if (view.sel) { view.sel = null; view.follow = null; renderInfo(); renderList($('#q').value); }
    }
    drag = null;
  }
};
cv.addEventListener('pointerup', up);
cv.addEventListener('pointercancel', up);
cv.addEventListener('wheel', (e) => { e.preventDefault(); view.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0016)); }, { passive: false });
cv.addEventListener('dblclick', (e) => view.zoomAt(e.offsetX, e.offsetY, 2));
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (mode === 'map' && e.key === 'Escape') { view.sel = null; view.follow = null; renderInfo(); }
  if (mode === 'map' && (e.key === 'h' || e.key === 'Home')) view.flyTo([view.home.cx, view.home.cy], view.home.scale);
});
for (const b of document.querySelectorAll('.speed button')) b.onclick = () => {
  timeScale = +b.dataset.s; document.querySelectorAll('.speed button').forEach((x) => x.classList.toggle('on', x === b));
};

// ---------- 3D věznice ----------
async function enter(p) {
  mode = '3d';
  $('#mapview').hidden = true; $('#view3d').hidden = false;
  const { PrisonView } = await import('./prison3d.js');
  if (!v3) v3 = new PrisonView($('#c3d'));
  window.__basu.v3 = v3;
  $('#v3-name').textContent = p.name; $('#v3-sub').textContent = `${p.town} · ${p.zab} stupeň zabezpečení`;
  await v3.open(p, sim);
}
$('#v3-back').onclick = () => { mode = 'map'; v3?.close(); $('#view3d').hidden = true; $('#mapview').hidden = false; view.resize(); renderInfo(); };

// ---------- smyčka ----------
let last = performance.now(), uiT = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  sim.update(dt * timeScale / 60);
  if (mode === 'map') {
    view.draw(now);
    uiT += dt;
    if (uiT > 0.5) {
      uiT = 0;
      $('#clock').textContent = fmtTime(sim.time); $('#day').textContent = `Den ${Math.floor(sim.time / 1440) + 1}`;
      $('#st-buses').textContent = sim.buses.filter((b) => b.state === 'drive').length; $('#st-moved').textContent = sim.moved;
      if (view.sel && !document.querySelector('#info:hover')) renderInfo();
      if (++infoTimer % 6 === 0 && !document.querySelector('#list:hover')) renderList($('#q').value);
    }
  } else v3?.frame(dt, sim, timeScale);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__basu = { sim, view };
// návrat z plné věznice Vinařice (vinarice/?veznice → ../#vinarice)
if (location.hash.length > 1) {
  const p = sim.prisons.find((x) => x.id === location.hash.slice(1));
  if (p) { history.replaceState(null, '', location.pathname); selectPrison(p, true); }
}
