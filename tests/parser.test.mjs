import { parsePlan, parseTime, clock, evenSplits } from '../js/parser.js';
import assert from 'node:assert/strict';

let ok = 0;
const t = (name, fn) => { fn(); ok++; console.log('✓', name); };

const roy = `Jhon
🔵 Activación
Inclinación → 3x8 @7 kg
Rebotes → 3x20
🟣 Potencia

* Arranque → 3x6 @18 kg
🟠 Fuerza
A HBDL → 4x12 @50 kg
A Press de hombro → 4x10 @14 kg
B Búlgara → 4x8 @15 kg
B Remo en anillas → 3x8
💡 Prioridad: mantener buena calidad técnica y control en el trabajo de fuerza, buscando coordinación y velocidad en el arranque.

Magalí
Activación
* Pallof con balón → 3x3 @6”
🟠 Fuerza
HBDL → 3x12
Press banca → 3x16 @8 kg
Cuádriceps → 2x12 @5 kg
Jalón al pecho → 3x16 @10 kg
💡 Prioridad: control postural y calidad de ejecución, buscando un trabajo continuo y estable.


 Alejandro
🔵 Activación
Cuádriceps 45” → 3x1 @20 kg
Pallof con liga → 3x3 @6”
Face pulls en polea → 3x12 @20 kg
🟣 Potencia
* Arranque → 4x3 @8,5 kg
🟠 Fuerza
Goblet → 4x12 @21 kg
Remo en anillas → 4x10
Búlgara → 4x12
Press de hombro → 4x12 @14 kg
💡 Prioridad: máxima intención en el arranque y control técnico en el trabajo de fuerza, manteniendo estabilidad y calidad en cada repetición.

Jhamil
🔵 Activación
Pallof → 3x3 @6”
Pandillero 30” → 3x1
🟣 Potencia
* Arranque → 3x3 @6 kg
🟠 Fuerza
Goblet → 3x8 @10 kg
Remo desde rodillas → 3x8
RDL → 3x8 @12 kg
Press de hombro → 3x8 @12 kg
💡 Prioridad: aprender y consolidar los patrones de movimiento, priorizando coordinación, estabilidad y buena técnica.`;

const r = parsePlan(roy, { athletes: ['Jhon', 'Magalí', 'Alejandro', 'Jhamil'] });

t('separa 4 atletas', () => {
  assert.deepEqual(r.athletes.map((a) => a.name), ['Jhon', 'Magalí', 'Alejandro', 'Jhamil']);
});

t('Jhon: bloques Calentamiento y Principal', () => {
  const d = r.athletes[0].days[0];
  assert.deepEqual(d.blocks.map((b) => b.name), ['Calentamiento', 'Principal']);
  assert.equal(d.blocks[0].items.length, 2);
  assert.equal(d.blocks[1].items.length, 5);
  assert.match(d.prio, /^mantener buena calidad/);
});

t('Jhon: arranque 3x6 @18 kg', () => {
  const a = r.athletes[0].days[0].blocks[1].items[0];
  assert.equal(a.name, 'Arranque'); assert.equal(a.sets, 3); assert.equal(a.reps, 6); assert.equal(a.kg, 18); assert.equal(a.type, 'gym');
});

t('Jhon: circuitos A y B con sus series', () => {
  const it = r.athletes[0].days[0].blocks[1].items;
  assert.deepEqual(it.slice(1).map((x) => [x.circuit, x.name, x.sets, x.reps, x.kg]), [
    ['A', 'HBDL', 4, 12, 50], ['A', 'Press de hombro', 4, 10, 14], ['B', 'Búlgara', 4, 8, 15], ['B', 'Remo en anillas', 3, 8, null]
  ]);
});

t('Rebotes → salto, 60 contactos', () => {
  const x = r.athletes[0].days[0].blocks[0].items[1];
  assert.equal(x.type, 'jump'); assert.equal(x.metrics.contacts, 60); assert.equal(x.plan, '3 × 20');
});

t('Tonelaje HBDL 4x12 @50 = 2,4 t', () => {
  const x = r.athletes[0].days[0].blocks[1].items[1];
  assert.equal(x.metrics.tonnage, 2.4);
});

t('Pallof 3x3 @6” → isométrico 6 s', () => {
  const x = r.athletes[1].days[0].blocks[0].items[0];
  assert.equal(x.type, 'iso'); assert.equal(x.holdSec, 6); assert.equal(x.sets, 3); assert.equal(x.reps, 3);
});

t('Cuádriceps 45” → 3x1 @20 kg', () => {
  const x = r.athletes[2].days[0].blocks[0].items[0];
  assert.equal(x.name, 'Cuádriceps'); assert.equal(x.holdSec, 45); assert.equal(x.kg, 20); assert.equal(x.type, 'iso');
});

t('Coma decimal @8,5 kg', () => {
  const x = r.athletes[2].days[0].blocks[1].items[0];
  assert.equal(x.kg, 8.5);
});

t('Sin @ = peso corporal', () => {
  const x = r.athletes[1].days[0].blocks[1].items[0];
  assert.equal(x.name, 'HBDL'); assert.equal(x.kg, null);
});

t('Ningún aviso de "no se entendió"', () => {
  assert.equal(r.warnings.filter((w) => !w.kind).length, 0, JSON.stringify(r.warnings));
});

// ---------- pista ----------
const pista = `Camila
LUNES
Calentamiento
Trote suave → 1x10'
Principal
4x2x200 ritmo 35'' r30'' R1'
3x1000 a 4min/km r2'
3x1000 a 19km/h
6x30
600 a 1:30 [2 a 28.5 · 4 a 59]
Bala → 6 tiros @4 kg marca
Triple desde parado → 6 saltos marca
MARTES
Principal
2x400 ritmo 1'05''/400
Vuelta a la calma
Movilidad → 1x5'`;

const p = parsePlan(pista, { athletes: ['Camila'] });

t('pista: 2 días', () => {
  assert.equal(p.athletes[0].days.length, 2);
  assert.equal(p.athletes[0].days[0].dayIndex, 0);
  assert.equal(p.athletes[0].days[1].dayIndex, 1);
});

const L = p.athletes[0].days[0].blocks.find((b) => b.name === 'Principal').items;

t('4x2x200 ritmo 35 r30 R1', () => {
  const x = L[0];
  assert.equal(x.type, 'run');
  assert.deepEqual([x.run.series, x.run.reps, x.run.meters, x.run.targetSec, x.run.restRep, x.run.restSet], [4, 2, 200, 35, 30, 60]);
});

t('3x1000 a 4min/km → 4:00 por rep, parciales 2/4/8', () => {
  const x = L[1];
  assert.equal(x.run.targetSec, 240);
  assert.deepEqual(x.run.splits.map((s) => s.label), ['2 a 48.0', '4 a 1:36.0', '8 a 3:12.0']);
  assert.equal(x.run.restRep, 120);
});

t('3x1000 a 19 km/h → 3:09.5', () => {
  const x = L[2];
  assert.equal(clock(x.run.targetSec), '3:09.5');
  assert.deepEqual(x.run.splits.map((s) => s.label), ['2 a 37.9', '4 a 1:15.8', '8 a 2:31.6']);
});

t('6x30 → sin tiempo (a tope)', () => {
  const x = L[3];
  assert.equal(x.type, 'run'); assert.equal(x.run.meters, 30); assert.equal(x.run.targetSec, null); assert.equal(x.run.splits.length, 0);
});

t('600 a 1:30 con parciales propios', () => {
  const x = L[4];
  assert.equal(x.run.targetSec, 90); assert.equal(x.run.customSplits, true);
  assert.deepEqual(x.run.splits.map((s) => s.label), ['2 a 28.5', '4 a 59.0']);
});

t('Bala 6 tiros @4 kg marca', () => {
  const x = L[5];
  assert.equal(x.type, 'throw'); assert.equal(x.qty, 6); assert.equal(x.kg, 4); assert.equal(x.marca, true); assert.equal(x.metrics.throws, 6);
});

t('Triple 6 saltos marca', () => {
  const x = L[6];
  assert.equal(x.type, 'jump'); assert.equal(x.marca, true); assert.equal(x.metrics.contacts, 6);
});

t('2x400 ritmo 1:05/400 → 65 s', () => {
  const x = p.athletes[0].days[1].blocks[0].items[0];
  assert.equal(x.run.targetSec, 65);
});

t('Vuelta a la calma reconocida', () => {
  assert.deepEqual(p.athletes[0].days[1].blocks.map((b) => b.name), ['Principal', 'Vuelta a la calma']);
});

t('utilidades de tiempo', () => {
  assert.equal(parseTime("1'30''"), 90); assert.equal(parseTime('1:05.3'), 65.3); assert.equal(parseTime('35”'), 35);
  assert.equal(clock(65.33), '1:05.3'); assert.equal(evenSplits(600, 98)[1].label, '4 a 1:05.3');
});

t('línea rara → nota con aviso', () => {
  const q = parsePlan('Jhon\nPrincipal\nTrabajo técnico con Roy al final', { athletes: ['Jhon'] });
  const it = q.athletes[0].days[0].blocks[0].items[0];
  assert.equal(it.type, 'note'); assert.equal(q.warnings.length, 1);
});

t('lista de ejercicios manda sobre la adivinanza', () => {
  const q = parsePlan('Jhon\nCaja → 3x5', { athletes: ['Jhon'], library: { caja: 'gym' } });
  assert.equal(q.athletes[0].days[0].blocks[0].items[0].type, 'gym');
});

t("Trote suave → 1x10' = 10 min", () => {
  const x = p.athletes[0].days[0].blocks[0].items[0];
  assert.equal(x.durationSec, 600); assert.equal(x.type, 'iso'); assert.equal(x.plan, '10 min');
});

t('calentamiento sin números = tarea para marcar', () => {
  const q = parsePlan('Camila\nCalentamiento\nCalentar\nABC de carrera\nPrincipal\nSubida cajón → 4x4 @25 kg\nEficiencia aeróbica 15-30-45 → 1x1', { athletes: ['Camila'] });
  const [cal, pri] = q.athletes[0].days[0].blocks;
  assert.deepEqual(cal.items.map((i) => [i.type, i.name]), [['iso', 'Calentar'], ['iso', 'ABC de carrera']]);
  assert.equal(pri.items[0].type, 'gym');
  assert.equal(pri.items[1].type, 'iso');
  assert.equal(q.warnings.filter((w) => !w.kind).length, 0);
});

t('progresión por serie y reps por lado', () => {
  const q = parsePlan('Luis\nArranque → 3x3 @35-37,5-40 kg\nSubida cajón → 2x3e @52,5 kg', { athletes: ['Luis'] });
  const [a, b] = q.athletes[0].days[0].blocks[0].items;
  assert.deepEqual(a.kgList, [35, 37.5, 40]); assert.equal(a.plan, '3 × 3 · 35-37,5-40 kg');
  assert.equal(a.metrics.tonnage, 0.3375);
  assert.equal(b.perSide, true); assert.equal(b.plan, '2 × 3e · 52,5 kg');
});

console.log(`\n${ok} pruebas pasaron`);
