import { parsePlan } from '../js/parser.js';
import { assignIds } from '../js/model.js';
import { dayStats, buildSeries, wellnessAlert, modsSummary, testSeries, ymdOf } from '../js/stats.js';
import assert from 'node:assert/strict';
let ok = 0; const t = (n, f) => { f(); ok++; console.log('✓', n); };

const txt = `Jhon
Principal
Sentadilla → 4x8 @50 kg
Bala → 20 tiros @4 kg
Rebotes → 3x20
4x200 ritmo 30''`;
const day = assignIds(parsePlan(txt, { athletes: ['Jhon'] }).athletes[0].days[0]);
const ids = day.blocks[0].items.map((i) => i.id);

t('día planificado sin registro', () => {
  const s = dayStats(day, null);
  assert.equal(s.plan.ton, 1.6); assert.equal(s.plan.thr, 20); assert.equal(s.plan.con, 60); assert.equal(s.plan.met, 800);
  assert.equal(s.done.ton, 0); assert.equal(s.items, 4); assert.equal(s.doneItems, 0);
});

t('día con modificaciones', () => {
  const log = { items: {
    [ids[0]]: { status: 'mod', sets: [{ kg: '55', reps: '8' }, { kg: '55', reps: '8' }, { kg: '55', reps: '8' }, { kg: '55', reps: '8' }] },
    [ids[1]]: { status: 'mod', qty: '15', impl: '5 kg' },
    [ids[2]]: { status: 'hecho' },
    [ids[3]]: { status: 'no' } }, wellness: { sleep: 4, hours: 7, feel: 4 } };
  const s = dayStats(day, log);
  assert.equal(s.done.ton, 1.76); assert.equal(s.done.thr, 15); assert.deepEqual(s.done.thrByKg, { 5: 15 }); assert.equal(s.done.con, 60); assert.equal(s.done.met, 0);
  assert.equal(s.doneItems, 3);
  assert.deepEqual(s.mods, [{ name: 'Sentadilla', dir: 'up' }, { name: 'Bala', dir: 'down' }]);
});

// 10 semanas de entrenamiento: lun/mié/vie, todo hecho
const daily = {};
const today = new Date(2026, 10, 20); // vie 20 nov 2026
for (let w = 0; w < 10; w++) for (const off of [0, 2, 4]) {
  const d = new Date(2026, 10, 16 - 7 * w + off);
  if (d > today) continue;
  const log = { items: Object.fromEntries(ids.map((id) => [id, { status: 'hecho' }])), wellness: { sleep: 4, hours: 7.5, feel: 4 } };
  daily[ymdOf(d)] = dayStats(day, log);
}

t('semanas: típico y relativo ≈ 100 %', () => {
  const s = buildSeries(daily, 'semana', today);
  assert.equal(s.length, 12);
  const last = s[s.length - 2]; // semana anterior completa
  assert.ok(Math.abs(last.relDone - 100) < 0.01, last.relDone);
  assert.equal(last.pct, 100);
});

t('días: referencia de día típico', () => {
  const s = buildSeries(daily, 'dia', today);
  assert.equal(s.length, 7);
  assert.ok(Math.abs(s[0].relDone - 100) < 0.01); // lunes = día típico
  assert.equal(s[1].relDone, 0); // martes sin entrenamiento
});

t('meses y años sin errores', () => {
  const m = buildSeries(daily, 'mes', today); assert.equal(m.length, 12);
  const y = buildSeries(daily, 'anio', today); assert.equal(y.length, 5); assert.equal(y[4].relDone, null);
});

t('alerta de bienestar por desvío', () => {
  const d2 = JSON.parse(JSON.stringify(daily));
  d2['2026-11-18'].wellness = { sleep: 2, hours: 5, feel: 2 };
  d2['2026-11-20'].wellness = { sleep: 2, hours: 5.5, feel: 3 };
  const a = wellnessAlert(d2, today);
  assert.ok(a && /sueño 2 y 2/.test(a.text), JSON.stringify(a));
  assert.equal(wellnessAlert(daily, today), null);
});

t('qué modifica', () => {
  const d3 = { a: dayStats(day, { items: { [ids[0]]: { status: 'mod', sets: [{ kg: '60', reps: '8' }, { kg: '60', reps: '8' }, { kg: '60', reps: '8' }, { kg: '60', reps: '8' }] } } }) };
  const m = modsSummary({ '2026-11-10': d3.a }, '2026-11-01', '2026-11-30');
  assert.deepEqual(m.up, [['Sentadilla', 1]]);
});

t('serie de un test', () => {
  const s = testSeries({ initial: { value: 24, date: '2026-09-01' }, history: [{ value: 26, date: '2026-10-01' }], current: { value: 30, date: '2026-11-01' } });
  assert.deepEqual(s.map((x) => x.value), [24, 26, 30]);
});

console.log(`\n${ok} pruebas pasaron`);
