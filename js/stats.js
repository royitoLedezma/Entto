// Cálculos de la pantalla Progreso (sin dependencias: se prueba en Node).
import { groupItems, assignIds } from './model.js';
import { planCount, throwsByKg } from './parser.js';

const num = (v) => (v == null || v === '' ? null : Number(String(v).replace(',', '.')));
const z = (n) => String(n).padStart(2, '0');
export const ymdOf = (d) => d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
export const dateOf = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addD = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monday = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DSHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export const METRICS = [
  { key: 'ton', name: 'Toneladas de gym', unit: 't' },
  { key: 'thr', name: 'Tiros', unit: '' },
  { key: 'con', name: 'Contactos de salto', unit: '' },
  { key: 'met', name: 'Metros de carrera', unit: 'm' }
];

const empty = () => ({ ton: 0, thr: 0, con: 0, met: 0, thrByKg: {} });

// ---------- un día ----------
export function dayStats(dayIn, log) {
  const day = assignIds(JSON.parse(JSON.stringify(dayIn)));
  const plan = empty(), done = empty();
  let items = 0, doneItems = 0;
  const mods = [], marks = [];
  const L = (log && log.items) || {};
  (day.blocks || []).forEach((b) => groupItems(b.items).forEach((g) => {
    const list = g.kind === 'circuit' ? g.items : [g.item];
    const gl = L[g.id];
    list.forEach((it) => {
      if (it.type === 'note') return;
      items++;
      const e = g.kind === 'circuit' ? (gl && gl.ex ? gl.ex[it.id] : null) : L[it.id];
      const st = g.kind === 'circuit' ? (gl ? gl.status : null) : (e ? e.status : null);
      const ok = st === 'hecho' || st === 'mod';
      if (ok) doneItems++;
      const count = it.sets && it.reps ? it.sets * it.reps : (it.qty || it.sets || 0);
      // plan
      if (it.type === 'gym' && it.kg) plan.ton += count * it.kg / 1000;
      if (it.type === 'throw') { plan.thr += planCount(it); Object.entries(throwsByKg(it)).forEach(([k, v]) => { plan.thrByKg[k] = (plan.thrByKg[k] || 0) + v; }); }
      if (it.type === 'jump') plan.con += planCount(it);
      if (it.type === 'run' && it.run) plan.met += it.run.series * it.run.reps * it.run.meters;
      if (!ok) return;
      // hecho
      const isMod = st === 'mod' && e;
      if (it.type === 'gym') {
        if (isMod && e.sets) {
          done.ton += e.sets.reduce((a, s) => a + (num(s.kg) || 0) * (num(s.reps) || 0), 0) / 1000;
          // sube / baja
          const pk = it.kg || 0, pr = it.reps || 0, pn = it.sets || 0;
          const up = e.sets.length > pn || e.sets.some((s) => (num(s.kg) || 0) > pk || (num(s.reps) || 0) > pr);
          const down = e.sets.length < pn || e.sets.some((s) => (num(s.kg) || 0) < pk || (num(s.reps) || 0) < pr);
          if (up && !down) mods.push({ name: it.name, dir: 'up' });
          else if (down && !up) mods.push({ name: it.name, dir: 'down' });
          else if (up && down) mods.push({ name: it.name, dir: 'mix' });
        } else if (it.kg) done.ton += count * it.kg / 1000;
      }
      if (it.type === 'throw') {
        if (isMod && (e.qty || e.impl)) {
          const q = e.qty ? num(e.qty) : planCount(it);
          const kgv = e.impl ? num(String(e.impl).replace(/[^0-9.,]/g, '')) : it.kg;
          done.thr += q; const k = kgv != null ? String(kgv) : 's/p'; done.thrByKg[k] = (done.thrByKg[k] || 0) + q;
          if (q !== planCount(it)) mods.push({ name: it.name, dir: q > planCount(it) ? 'up' : 'down' });
        } else { done.thr += planCount(it); Object.entries(throwsByKg(it)).forEach(([k, v]) => { done.thrByKg[k] = (done.thrByKg[k] || 0) + v; }); }
      }
      if (it.type === 'jump') { done.con += isMod && e.qty ? num(e.qty) : planCount(it); }
      if (it.type === 'run' && it.run) done.met += it.run.series * it.run.reps * it.run.meters;
      if (e && e.mark && num(String(e.mark).replace(/[^0-9.,]/g, '')) != null) marks.push({ name: it.name, value: num(String(e.mark).replace(/[^0-9.,]/g, '')) });
    });
  }));
  const w = log && log.wellness && log.wellness.sleep ? { sleep: log.wellness.sleep, hours: log.wellness.hours, feel: log.wellness.feel } : null;
  return { plan, done, items, doneItems, mods, marks, wellness: w, logged: !!(log && (log.finished || Object.values(L).some((x) => x && x.status))) };
}

// ---------- agrupar por período ----------
function periodsFor(view, today, offset = 0) {
  const out = [];
  if (view === 'dia') {
    const m = addD(monday(today), 7 * offset);
    for (let i = 0; i < 7; i++) { const d = addD(m, i); out.push({ key: ymdOf(d), label: DSHORT[i] + ' ' + d.getDate(), from: ymdOf(d), to: ymdOf(d) }); }
  } else if (view === 'semana') {
    const m = addD(monday(today), 7 * offset);
    for (let i = 11; i >= 0; i--) { const s = addD(m, -7 * i); out.push({ key: ymdOf(s), label: s.getDate() + '/' + (s.getMonth() + 1), from: ymdOf(s), to: ymdOf(addD(s, 6)) }); }
  } else if (view === 'mes') {
    for (let i = 11; i >= 0; i--) { const s = new Date(today.getFullYear(), today.getMonth() - i + offset * 12, 1); const e = new Date(s.getFullYear(), s.getMonth() + 1, 0); out.push({ key: ymdOf(s), label: MONTHS[s.getMonth()] + (s.getMonth() === 0 || i === 11 ? ' ' + String(s.getFullYear()).slice(2) : ''), from: ymdOf(s), to: ymdOf(e) }); }
  } else {
    for (let i = 4; i >= 0; i--) { const y = today.getFullYear() - i; out.push({ key: String(y), label: String(y), from: y + '-01-01', to: y + '-12-31' }); }
  }
  return out;
}

function sumInto(acc, st) {
  ['ton', 'thr', 'con', 'met'].forEach((k) => { acc.plan[k] += st.plan[k]; acc.done[k] += st.done[k]; });
  Object.entries(st.done.thrByKg).forEach(([k, v]) => { acc.done.thrByKg[k] = (acc.done.thrByKg[k] || 0) + v; });
  Object.entries(st.plan.thrByKg).forEach(([k, v]) => { acc.plan.thrByKg[k] = (acc.plan.thrByKg[k] || 0) + v; });
  acc.items += st.items; acc.doneItems += st.doneItems; acc.sessions++;
  if (st.logged) acc.logged++;
  if (st.wellness) { acc.sleep.push(st.wellness.sleep); acc.hours.push(st.wellness.hours); acc.feel.push(st.wellness.feel); }
  st.mods.forEach((m) => acc.mods.push(m));
}
const blank = (p) => Object.assign({}, p, { plan: empty(), done: empty(), items: 0, doneItems: 0, sessions: 0, logged: 0, sleep: [], hours: [], feel: [], mods: [] });
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

// Referencia ("típico") de cada período, desde lo HECHO antes de ese período.
function typicalFor(view, p, daily, periods, idx) {
  const vals = { ton: [], thr: [], con: [], met: [] };
  const push = (acc) => ['ton', 'thr', 'con', 'met'].forEach((k) => vals[k].push(acc[k]));
  if (view === 'dia') {
    const d0 = dateOf(p.from);
    for (let i = 1; i <= 28; i++) { const st = daily[ymdOf(addD(d0, -i))]; if (st && (st.done.ton || st.done.thr || st.done.con || st.done.met)) push(st.done); }
    if (vals.ton.length < 3) return null;
  } else if (view === 'semana' || view === 'mes') {
    const n = view === 'semana' ? 4 : 3;
    const prev = [];
    for (let j = idx - 1; j >= 0 && prev.length < n; j--) prev.push(periods[j]);
    if (prev.length < n) {
      // completa con períodos anteriores a la ventana visible
      const extra = n - prev.length;
      const f = dateOf(periods[0].from);
      for (let i = 1; i <= extra; i++) {
        let pp;
        if (view === 'semana') { const s = addD(f, -7 * i); pp = { from: ymdOf(s), to: ymdOf(addD(s, 6)) }; }
        else { const s = new Date(f.getFullYear(), f.getMonth() - i, 1); pp = { from: ymdOf(s), to: ymdOf(new Date(s.getFullYear(), s.getMonth() + 1, 0)) }; }
        prev.push(aggregate(daily, pp));
      }
    }
    const used = prev.filter((q) => q.sessions > 0);
    if (used.length < n) return null;
    used.forEach((q) => push(q.done));
  } else {
    const first = periods.find((q) => q.sessions > 0);
    if (!first || first === p) return null;
    push(first.done);
  }
  const t = {}; Object.keys(vals).forEach((k) => { t[k] = avg(vals[k]) || 0; }); return t;
}

function aggregate(daily, p) {
  const acc = blank(p);
  Object.keys(daily).forEach((d) => { if (d >= p.from && d <= p.to) sumInto(acc, daily[d]); });
  return acc;
}

export function relIndex(vals, typ) {
  if (!typ) return null;
  const r = [];
  ['ton', 'thr', 'con', 'met'].forEach((k) => { if (typ[k] > 0) r.push(vals[k] / typ[k] * 100); });
  return r.length ? r.reduce((s, v) => s + v, 0) / r.length : null;
}

/**
 * @param {Object} daily  { 'AAAA-MM-DD': dayStats(...) }
 * @param {'dia'|'semana'|'mes'|'anio'} view
 */
export function buildSeries(daily, view, today = new Date(), offset = 0) {
  const ps = periodsFor(view, today, offset).map((p) => aggregate(daily, p));
  ps.forEach((p, i) => {
    p.typ = typicalFor(view, p, daily, ps, i);
    p.relPlan = relIndex(p.plan, p.typ);
    p.relDone = relIndex(p.done, p.typ);
    p.pct = p.items ? Math.round(p.doneItems / p.items * 100) : null;
    p.sleepAvg = avg(p.sleep); p.hoursAvg = avg(p.hours); p.feelAvg = avg(p.feel);
  });
  return ps;
}

// ---------- bienestar ----------
export function wellnessAlert(daily, today = new Date()) {
  const t = ymdOf(today);
  const rows = Object.keys(daily).filter((d) => d <= t && daily[d].wellness).sort();
  if (rows.length < 5) return null;
  const last = rows.slice(-2);
  const base = rows.slice(-30, -2).filter((d) => d >= ymdOf(addD(today, -30)));
  if (base.length < 3) return null;
  const a = (k) => avg(base.map((d) => daily[d].wellness[k]));
  const s = a('sleep'), f = a('feel'), h = a('hours');
  const low = (d) => { const w = daily[d].wellness; return w.sleep <= s - 1.5 || w.feel <= f - 1.5 || w.hours <= h - 1.5; };
  if (last.length === 2 && low(last[0]) && low(last[1])) {
    const w = last.map((d) => daily[d].wellness);
    return { days: last, text: 'Últimos 2 días: sueño ' + w.map((x) => x.sleep).join(' y ') + ', horas ' + w.map((x) => String(x.hours).replace('.', ',')).join(' y ') + ', se siente ' + w.map((x) => x.feel).join(' y ') + '. Su normal: sueño ' + s.toFixed(1).replace('.', ',') + ', ' + h.toFixed(1).replace('.', ',') + ' h, se siente ' + f.toFixed(1).replace('.', ',') + '.' };
  }
  return null;
}

// ---------- mejoras y modificaciones ----------
export function modsSummary(daily, from, to) {
  const up = {}, down = {};
  Object.keys(daily).forEach((d) => { if (d < from || d > to) return; daily[d].mods.forEach((m) => { if (m.dir === 'up') up[m.name] = (up[m.name] || 0) + 1; if (m.dir === 'down') down[m.name] = (down[m.name] || 0) + 1; }); });
  const sort = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return { up: sort(up), down: sort(down) };
}

export function bestMarks(daily, from, to) {
  const best = {};
  Object.keys(daily).sort().forEach((d) => { daily[d].marks.forEach((m) => { if (!best[m.name] || m.value > best[m.name].value) best[m.name] = { value: m.value, date: d, first: best[m.name] ? best[m.name].first : m.value }; if (!best[m.name].first) best[m.name].first = m.value; }); });
  return Object.entries(best).map(([name, b]) => ({ name, value: b.value, date: b.date, delta: b.value - b.first }));
}

export function testSeries(t) {
  const pts = [];
  if (t.initial) pts.push(t.initial);
  (t.history || []).forEach((h) => { if (!t.initial || h.date !== t.initial.date || h.value !== t.initial.value) pts.push(h); });
  if (t.current && (!t.initial || t.current.date !== t.initial.date || t.current.value !== t.initial.value)) pts.push(t.current);
  return pts.sort((a, b) => (a.date < b.date ? -1 : 1));
}
