// Lógica compartida entre la app del entrenador y la del atleta.
import { clock, planCount } from './parser.js';

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Da un id estable a cada ejercicio según su texto. Si el entrenador cambia la línea,
// cambia el id y lo anotado antes ya no se aplica (queda vacío, como en Chronos).
export function assignIds(day) {
  const seen = {};
  (day.blocks || []).forEach((b) => {
    (b.items || []).forEach((it) => {
      const base = 'i' + hash((b.name || '') + '|' + (it.raw || it.text || it.name || ''));
      seen[base] = (seen[base] || 0) + 1;
      it.id = base + (seen[base] > 1 ? '_' + seen[base] : '');
    });
  });
  return day;
}

// Agrupa ejercicios seguidos con la misma letra como un circuito.
export function groupItems(items) {
  const out = [];
  (items || []).forEach((it) => {
    const last = out[out.length - 1];
    if (it.circuit && last && last.kind === 'circuit' && last.letter === it.circuit) { last.items.push(it); return; }
    if (it.circuit) { out.push({ kind: 'circuit', letter: it.circuit, id: 'g' + it.id, items: [it] }); return; }
    out.push({ kind: 'single', item: it, id: it.id });
  });
  return out;
}

// Autoformato de tiempos al escribir solo números, de derecha a izquierda: 12335 → 1:23.35
export function fmtTyped(raw) {
  const d = String(raw).replace(/\D/g, '').replace(/^0+/, '').slice(0, 7);
  if (!d) return '';
  const p = d.padStart(3, '0');
  const cs = p.slice(-2);
  const rest = p.slice(0, -2);
  if (rest.length <= 2) return String(Number(rest)) + '.' + cs;
  return String(Number(rest.slice(0, -2))) + ':' + rest.slice(-2) + '.' + cs;
}

export function secsOf(t) {
  if (t == null || t === '') return null;
  const p = String(t).split(':');
  return p.length === 2 ? Number(p[0]) * 60 + parseFloat(p[1]) : parseFloat(p[0]);
}

export function totalReps(it) {
  if (it.type === 'run' && it.run) return it.run.series * it.run.reps;
  return it.sets || 1;
}

// Series planificadas de un ejercicio de gym (para precargar Modificar).
export function plannedSets(it) {
  const n = it.sets || 1;
  return Array.from({ length: n }, (_, i) => {
    const kg = it.kgList ? it.kgList[Math.min(i, it.kgList.length - 1)] : it.kg;
    return { kg: kg != null ? String(kg).replace('.', ',') : '', reps: it.reps != null ? String(it.reps) : '' };
  });
}

const num = (v) => (v == null || v === '' ? null : Number(String(v).replace(',', '.')));

// Resumen corto de lo modificado.
export function modSummary(it, e) {
  if (!e) return '';
  if (it.type === 'run') { const t = (e.times || []).filter(Boolean); return t.length ? t.join(' · ') : 'sin tiempos'; }
  if (it.type === 'throw') return (e.qty || planCount(it)) + ' tiros' + (e.impl ? ' · ' + e.impl : '');
  if (it.type === 'jump') return (e.qty || planCount(it)) + ' saltos';
  if (e.sets && e.sets.length) {
    const reps = e.sets.map((s) => s.reps);
    const same = reps.every((r) => r === reps[0]);
    return same ? e.sets.map((s) => s.kg || 'PC').join(' · ') + (e.sets[0].kg ? ' kg' : '') + ' × ' + reps[0]
      : e.sets.map((s) => (s.kg ? s.kg + '×' : '') + s.reps).join(' · ');
  }
  if (e.sets && !e.sets.length) return 'sin series';
  return '';
}

// ---------- tests ----------
export function testKey(name) { return String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

// Texto de intensidad contra los tests: "80 % del actual · 90 % del inicial"
export function intensityText(it, tests) {
  if (!tests || it.kg == null) return '';
  const t = tests[testKey(it.name)];
  if (!t || !t.current || !t.current.value) return '';
  const cur = Math.round(it.kg / t.current.value * 100);
  const ini = t.initial && t.initial.value ? Math.round(it.kg / t.initial.value * 100) : null;
  return cur + ' % del actual' + (ini != null && t.initial.value !== t.current.value ? ' · ' + ini + ' % del inicial' : '');
}

// ---------- métricas de un día ----------
export function dayMetrics(day, log, which = 'plan') {
  const m = { tonnage: 0, throws: 0, contacts: 0, meters: 0, items: 0, done: 0 };
  (day && day.blocks || []).forEach((b) => groupItems(b.items).forEach((g) => {
    const list = g.kind === 'circuit' ? g.items : [g.item];
    const gl = log && log.items ? log.items[g.id] : null;
    list.forEach((it) => {
      if (it.type === 'note') return;
      m.items++;
      const e = log && log.items ? (g.kind === 'circuit' ? (gl && gl.ex ? gl.ex[it.id] : null) : log.items[it.id]) : null;
      const st = g.kind === 'circuit' ? (gl ? gl.status : null) : (e ? e.status : null);
      if (st === 'hecho' || st === 'mod') m.done++;
      if (which === 'done' && st !== 'hecho' && st !== 'mod') return;
      const useMod = which === 'done' && st === 'mod' && e;
      const mt = it.metrics || {};
      if (it.type === 'gym' && useMod && e.sets) m.tonnage += e.sets.reduce((a, s) => a + (num(s.kg) || 0) * (num(s.reps) || 0), 0) / 1000;
      else m.tonnage += mt.tonnage || 0;
      if (it.type === 'throw') m.throws += useMod && e.qty ? num(e.qty) : (mt.throws || 0);
      if (it.type === 'jump') m.contacts += useMod && e.qty ? num(e.qty) : (mt.contacts || 0);
      if (it.type === 'run') m.meters += mt.meters || 0;
    });
  }));
  return m;
}

// ---------- filas para Excel ----------
const TYPE_NAME = { gym: 'Gym', run: 'Carrera', iso: 'Isométrico', throw: 'Lanzamiento', jump: 'Salto', note: 'Nota' };
const STATUS_NAME = { hecho: 'Hecho', mod: 'Modificado', no: 'No lo hizo' };

export function detailRows(athlete, date, day, log) {
  const rows = [];
  const w = log && log.wellness ? log.wellness : {};
  (day.blocks || []).forEach((b) => groupItems(b.items).forEach((g) => {
    const list = g.kind === 'circuit' ? g.items : [g.item];
    const gl = log && log.items ? log.items[g.id] : null;
    list.forEach((it) => {
      if (it.type === 'note') return;
      const e = log && log.items ? (g.kind === 'circuit' ? (gl && gl.ex ? gl.ex[it.id] : null) : log.items[it.id]) : null;
      const st = g.kind === 'circuit' ? (gl ? gl.status : '') : (e ? e.status : '');
      const baseRow = {
        Fecha: date, Atleta: athlete, Bloque: b.name, Circuito: it.circuit || '', Ejercicio: it.name, Tipo: TYPE_NAME[it.type] || it.type,
        Plan: it.plan || '', Estado: STATUS_NAME[st] || 'Sin registro'
      };
      if (it.type === 'gym' || it.type === 'iso') {
        const planned = plannedSets(it);
        const done = st === 'mod' && e && e.sets ? e.sets : (st === 'hecho' ? planned : []);
        const n = Math.max(planned.length, done.length);
        for (let k = 0; k < n; k++) {
          const p = planned[k] || {}, d = done[k] || {};
          const pk = num(p.kg), pr = num(p.reps), dk = num(d.kg), dr = num(d.reps);
          let cambio = '';
          if (st === 'mod') {
            if (!done[k]) cambio = 'serie quitada';
            else if (!planned[k]) cambio = 'serie agregada';
            else {
              const parts = [];
              if (dk != null && pk != null && dk !== pk) parts.push((dk > pk ? '+' : '') + String(Math.round((dk - pk) * 10) / 10).replace('.', ',') + ' kg');
              if (dr != null && pr != null && dr !== pr) parts.push((dr > pr ? '+' : '') + (dr - pr) + ' reps');
              cambio = parts.join(' ');
            }
          }
          rows.push(Object.assign({}, baseRow, { Serie: k + 1, 'Kg plan': pk, 'Reps plan': pr, 'Kg hecho': st === 'no' ? null : dk, 'Reps hecho': st === 'no' ? null : dr, Tiempo: '', Cantidad: null, Marca: '', Cambio: cambio, 'Sueño (1-5)': w.sleep || null, 'Horas sueño': w.hours || null, 'Se siente (1-5)': w.feel || null, Comentario: log && log.comment ? log.comment : '' }));
        }
        return;
      }
      if (it.type === 'run') {
        const times = e && e.times ? e.times : [];
        const n = totalReps(it);
        for (let k = 0; k < n; k++) {
          const t = times[k] || '';
          const ts = secsOf(t);
          const cambio = ts != null && it.run.targetSec ? ((ts - it.run.targetSec > 0 ? '+' : '') + (Math.round((ts - it.run.targetSec) * 100) / 100).toFixed(2) + ' s') : '';
          rows.push(Object.assign({}, baseRow, { Serie: k + 1, 'Kg plan': null, 'Reps plan': null, 'Kg hecho': null, 'Reps hecho': null, Tiempo: t, 'Tiempo objetivo': it.run.targetSec ? clock(it.run.targetSec, 2) : '', Cantidad: null, Marca: '', Cambio: cambio, 'Sueño (1-5)': w.sleep || null, 'Horas sueño': w.hours || null, 'Se siente (1-5)': w.feel || null, Comentario: log && log.comment ? log.comment : '' }));
        }
        return;
      }
      const qPlan = planCount(it);
      const q = st === 'mod' && e && e.qty ? num(e.qty) : (st === 'hecho' ? qPlan : null);
      rows.push(Object.assign({}, baseRow, { Serie: 1, 'Kg plan': it.kg, 'Reps plan': null, 'Kg hecho': st === 'mod' && e && e.impl ? num(e.impl) : (st === 'hecho' ? it.kg : null), 'Reps hecho': null, Tiempo: '', Cantidad: q, Marca: e && e.mark ? e.mark : '', Cambio: q != null && qPlan && q !== qPlan ? ((q > qPlan ? '+' : '') + (q - qPlan)) : '', 'Sueño (1-5)': w.sleep || null, 'Horas sueño': w.hours || null, 'Se siente (1-5)': w.feel || null, Comentario: log && log.comment ? log.comment : '' }));
    });
  }));
  return rows;
}

export const TYPES = [['gym', 'Gym'], ['iso', 'Isométrico / tiempo'], ['jump', 'Salto'], ['throw', 'Lanzamiento'], ['run', 'Carrera']];
export const GROUPS = ['Reactivos', 'Lanzamientos', 'Endurance', 'Situacionales'];
