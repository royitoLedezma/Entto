// App del entrenador: atletas, planificar (pegar texto), ejercicios, revisar, tests, Excel y entrenadores (admin).
import { html, render, nothing } from './vendor/lit-html/lit-html.js';
import { live } from './vendor/lit-html/directives/live.js';
import {
  auth, A, F, P, ADMIN, AppMod, firebaseConfig, getDoc, getDocs, setDoc, deleteDoc, writeBatch, fs,
  rangeDocs, mondayOf, weekDates, addDays, ymd, parseYmd, DAY_LONG, DAY_SHORT, niceDate, randomToken, norm
} from './db.js';
import { parsePlan, planText, metricsOf } from './parser.js';
import { assignIds, groupItems, modSummary, dayMetrics, detailRows, intensityText, testKey, TYPES, GROUPS } from './model.js';
import { dayStats, buildSeries, wellnessAlert, modsSummary, bestMarks, testSeries, METRICS } from './stats.js';
import { barChart, stackChart, lineChart, legend, BLUE, GHOST, SEQ } from './charts.js';

const TAGS = { gym: 'Gym', run: 'Carrera', iso: 'Isom.', throw: 'Lanz.', jump: 'Salto', note: 'Nota' };
const ST = { hecho: '✓ Hecho', mod: '✎ Modificado', no: '✕ No lo hizo' };


const EXAMPLE = [
  'Nombre del atleta',
  'Calentamiento',
  'Movilidad → 1x10\'',
  'Rebotes → 3x20',
  'Principal',
  'Arranque → 3x3 @35-37,5-40 kg',
  'Sentadilla → 4x6 @60 kg',
  'A Press banca → 3x8 @40 kg',
  'A Remo en anillas → 3x8',
  'Pallof → 3x3 @6”',
  'Subida cajón → 3x4e @20 kg',
  'Bala → 6 tiros @4 kg marca',
  'Triple desde parado → 6 saltos marca',
  '6x30 a full',
  '4x2x200 ritmo 35\'\' r30\'\' R1\'',
  '3x1000 a 4min/km r2\'',
  '600 a 1:30 [2 a 28.5 · 4 a 59]',
  'Vuelta a la calma',
  'Trote suave → 1x10\'',
  '💡 Prioridad: objetivo de la sesión'
].join('\n');
const GUIDE = [
  ['Atleta (y día, si quieres)', 'Nombre del atleta · LUNES'],
  ['Levantamiento olímpico con progresión', 'Arranque → 3x3 @35-37,5-40 kg'],
  ['Sentadilla / gym', 'Sentadilla → 4x6 @60 kg'],
  ['Peso corporal', 'Remo en anillas → 3x8'],
  ['Circuito (misma letra)', 'A Press banca → 3x8 @40 kg'],
  ['Por lado', 'Subida cajón → 3x4e @20 kg'],
  ['Isométrico', 'Pallof → 3x3 @6”  ·  Cuádriceps 45” → 3x1 @20 kg'],
  ['Saltos', 'Rebotes → 3x20'],
  ['Lanzamiento con marca', 'Bala → 6 tiros @4 kg marca'],
  ['Velocidad a full', '6x30 a full'],
  ['Pista con series', "4x2x200 ritmo 35'' r30'' R1'"],
  ['Carrera larga', "3x1000 a 4min/km r2'  ·  3x1000 a 19km/h"],
  ['Parciales propios', '600 a 1:30 [2 a 28.5 · 4 a 59]'],
  ['Por tiempo', "Trote suave → 1x10'"],
  ['Objetivo del día', '💡 Prioridad: …']
];

const C = {
  root: null, user: null, profile: null, isAdmin: false, ready: false, loginErr: '', loginMode: 'login', busy: false,
  tab: 'atletas', athletes: [], exercises: {}, toast: '',
  // planificar
  pm: mondayOf(addDays(new Date(), [0, 6].includes(new Date().getDay()) ? 2 : 0)), text: '', targetDate: ymd(new Date()), parsed: null, mapping: {}, types: {},
  gridAid: null, grid: {}, editing: null, editText: '',
  // revisar
  ra: null, rm: mondayOf(new Date()), rDays: {}, rLogs: {}, rTests: {}, newTest: { name: '', unit: 'kg' }, newRes: {},
  rtab: 'revisar', prog: null, pv: 'semana', pmode: 'rel', poff: 0, psel: {}, ploading: false,
  // excel
  microMode: 'todo', printDone: false,
  exFrom: ymd(addDays(mondayOf(new Date()), -49)), exTo: ymd(addDays(mondayOf(new Date()), 6)),
  // admin
  users: [], nu: { name: '', email: '', pass: '' }
};

function draw() { render(view(), C.root); }
function toast(msg) { C.toast = msg; draw(); clearTimeout(toast.t); toast.t = setTimeout(() => { C.toast = ''; draw(); }, 3200); }
const uid = () => C.user.uid;

// ---------- sesión ----------
export function startCoach(root) {
  C.root = root; draw();
  A.onAuthStateChanged(auth, async (u) => {
    if (u && u.isAnonymous) { await A.signOut(auth); return; }
    C.user = u; C.profile = null; C.ready = true;
    if (u) {
      C.isAdmin = (u.email || '').toLowerCase() === ADMIN;
      try {
        let s = await getDoc(P.user(u.uid));
        if (!s.exists() && C.isAdmin) { await setDoc(P.user(u.uid), { role: 'admin', name: 'Administrador', email: u.email, createdAt: Date.now() }); s = await getDoc(P.user(u.uid)); }
        C.profile = s.exists() ? s.data() : null;
        if (C.profile) await loadBase();
      } catch (e) { console.error(e); }
    }
    draw();
  });
}

async function login(email, pass) {
  C.busy = true; C.loginErr = ''; draw();
  try {
    if (C.loginMode === 'create') await A.createUserWithEmailAndPassword(auth, email, pass);
    else await A.signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    C.loginErr = e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password' || e.code === 'auth/user-not-found' ? 'Correo o contraseña incorrectos.'
      : e.code === 'auth/email-already-in-use' ? 'Ese correo ya tiene cuenta: usa Entrar.'
      : e.code === 'auth/weak-password' ? 'La contraseña debe tener al menos 6 caracteres.'
      : e.code === 'auth/operation-not-allowed' ? 'Falta activar en Firebase: Authentication → Método de acceso → Correo electrónico/contraseña.'
      : 'No se pudo entrar (' + e.code + ').';
  }
  C.busy = false; draw();
}

async function loadBase() {
  const [as, ex] = await Promise.all([getDocs(P.athletes(uid())), getDocs(P.exercises(uid()))]);
  C.athletes = []; as.forEach((d) => C.athletes.push(Object.assign({ id: d.id }, d.data())));
  C.athletes.sort((a, b) => a.name.localeCompare(b.name));
  C.exercises = {}; ex.forEach((d) => { C.exercises[d.id] = d.data(); });
  if (!C.gridAid && C.athletes.length) C.gridAid = C.athletes.find((a) => !a.paused)?.id || C.athletes[0].id;
  if (C.gridAid) await loadGrid();
}

const library = () => Object.fromEntries(Object.values(C.exercises).map((e) => [e.name, e.type]));
const linkOf = (a) => location.origin + location.pathname + '#a=' + a.token;

// ---------- atletas ----------
async function addAthlete(name, group) {
  name = name.trim(); if (!name) return;
  const ref = F.doc(P.athletes(uid()));
  const token = randomToken();
  const b = writeBatch(fs);
  b.set(ref, { name, group, paused: false, token, createdAt: Date.now() });
  b.set(P.access(token), { coachId: uid(), athleteId: ref.id, active: true, createdAt: Date.now() });
  await b.commit();
  await loadBase(); toast(name + ' agregado. Copia su enlace y mándaselo por WhatsApp.');
  return ref.id;
}
async function newLink(a) {
  if (!confirm('¿Crear un enlace nuevo para ' + a.name + '? El anterior dejará de funcionar.')) return;
  const token = randomToken();
  const b = writeBatch(fs);
  if (a.token) b.delete(P.access(a.token));
  b.set(P.access(token), { coachId: uid(), athleteId: a.id, active: true, createdAt: Date.now() });
  b.update(P.athlete(uid(), a.id), { token });
  await b.commit(); await loadBase(); toast('Enlace nuevo creado. El anterior ya no funciona.');
}
async function copyLink(a) {
  try { await navigator.clipboard.writeText(linkOf(a)); toast('Enlace de ' + a.name + ' copiado. Pégalo en WhatsApp.'); }
  catch (e) { prompt('Copia este enlace:', linkOf(a)); }
}
function whatsapp(a) { window.open('https://wa.me/?text=' + encodeURIComponent('Hola ' + a.name + ', este es tu enlace de Entto para ver y anotar tus entrenamientos: ' + linkOf(a)), '_blank'); }
async function togglePause(a) { await F.updateDoc(P.athlete(uid(), a.id), { paused: !a.paused }); await loadBase(); toast(a.paused ? a.name + ' activo otra vez.' : a.name + ' en pausa. Su historial se conserva.'); }

// ---------- planificar ----------
function convert() {
  const names = C.athletes.map((a) => a.name);
  const r = parsePlan(C.text, { athletes: names, library: library() });
  C.parsed = r; C.mapping = {}; C.types = {};
  r.athletes.forEach((pa, i) => {
    const m = C.athletes.find((a) => norm(a.name) === norm(pa.name));
    C.mapping[i] = m ? m.id : (pa.name ? '__new' : (C.gridAid || ''));
  });
  r.athletes.forEach((pa) => pa.days.forEach((d) => d.blocks.forEach((b) => b.items.forEach((it) => { if (it.typeGuessed && it.type !== 'note') C.types[norm(it.name)] = it.type; }))));
  draw();
}

function applyType(it, type) { it.type = type; it.typeGuessed = false; it.plan = planText(it); it.metrics = metricsOf(it); }

async function saveParsed(publish) {
  if (!C.parsed) return;
  C.busy = true; draw();
  try {
    const dates = weekDates(C.pm);
    // ejercicios nuevos a la lista
    const b0 = writeBatch(fs);
    Object.entries(C.types).forEach(([key, type]) => {
      let name = key;
      C.parsed.athletes.forEach((pa) => pa.days.forEach((d) => d.blocks.forEach((b) => b.items.forEach((it) => { if (norm(it.name) === key) name = it.name; }))));
      b0.set(P.exercise(uid(), key.replace(/\//g, '-')), { name, type });
    });
    await b0.commit();
    const b = writeBatch(fs);
    let n = 0;
    for (let i = 0; i < C.parsed.athletes.length; i++) {
      const pa = C.parsed.athletes[i];
      let aid = C.mapping[i];
      if (!aid) continue;
      if (aid === '__new') aid = await addAthlete(pa.name || 'Atleta', GROUPS[0]);
      pa.days.forEach((d) => {
        d.blocks.forEach((bl) => bl.items.forEach((it) => { const t = C.types[norm(it.name)]; if (t && it.type !== 'note') applyType(it, t); }));
        const date = d.dayIndex != null ? dates[d.dayIndex] : C.targetDate;
        const docData = JSON.parse(JSON.stringify({ date, published: publish, prio: d.prio || '', blocks: d.blocks, text: d.text || '', updatedAt: Date.now() }));
        b.set(P.day(uid(), aid, date), docData); n++;
      });
    }
    await b.commit();
    await loadBase();
    toast(n === 1 ? (publish ? '1 día publicado.' : '1 día guardado como borrador.') : n + (publish ? ' días publicados.' : ' días guardados como borrador.'));
    C.parsed = null; C.text = '';
  } catch (e) { console.error(e); toast('No se pudo guardar: ' + e.message); }
  C.busy = false; draw();
}

async function loadGrid() {
  const dates = weekDates(C.pm);
  C.grid = await rangeDocs(P.days(uid(), C.gridAid), dates[0], dates[6]);
}
async function setPm(delta) { C.pm = addDays(C.pm, 7 * delta); C.targetDate = weekDates(C.pm)[0]; if (C.gridAid) await loadGrid(); draw(); }

async function dayAction(date, act, extra) {
  const ref = P.day(uid(), C.gridAid, date);
  const d = C.grid[date];
  if (act === 'pub') await F.updateDoc(ref, { published: !d.published, updatedAt: Date.now() });
  if (act === 'del') { if (!confirm('¿Dejar este día en blanco?')) return; await deleteDoc(ref); }
  if (act === 'move') {
    const to = extra; const other = C.grid[to];
    const b = writeBatch(fs);
    b.set(P.day(uid(), C.gridAid, to), Object.assign({}, d, { date: to, updatedAt: Date.now() }));
    if (other) b.set(ref, Object.assign({}, other, { date, updatedAt: Date.now() })); else b.delete(ref);
    await b.commit();
  }
  await loadGrid(); draw();
}

async function saveEdit(date) {
  const a = C.athletes.find((x) => x.id === C.gridAid);
  const r = parsePlan(a.name + '\n' + C.editText, { athletes: [a.name], library: library() });
  const d = r.athletes[0] && r.athletes[0].days[0];
  if (!d) { toast('No encontré ejercicios en el texto.'); return; }
  const prev = C.grid[date] || {};
  await setDoc(P.day(uid(), C.gridAid, date), JSON.parse(JSON.stringify({ date, published: prev.published || false, prio: d.prio || '', blocks: d.blocks, text: d.text, updatedAt: Date.now() })));
  C.editing = null; await loadGrid(); draw(); toast('Día actualizado.');
}

async function copyPrevWeek() {
  const dates = weekDates(C.pm);
  const prevDates = weekDates(addDays(C.pm, -7));
  const prev = await rangeDocs(P.days(uid(), C.gridAid), prevDates[0], prevDates[6]);
  if (!Object.keys(prev).length) { toast('La semana anterior está vacía.'); return; }
  if (Object.keys(C.grid).length && !confirm('Esto reemplaza los días que ya tienes esta semana. ¿Seguir?')) return;
  const b = writeBatch(fs);
  prevDates.forEach((pd, i) => { if (prev[pd]) b.set(P.day(uid(), C.gridAid, dates[i]), Object.assign({}, prev[pd], { date: dates[i], published: false, updatedAt: Date.now() })); });
  await b.commit(); await loadGrid(); draw(); toast('Semana anterior copiada como borrador. Cambia lo que varía y publica.');
}

async function publishWeek() {
  const b = writeBatch(fs); let n = 0;
  Object.entries(C.grid).forEach(([d, x]) => { if (!x.published) { b.update(P.day(uid(), C.gridAid, d), { published: true, updatedAt: Date.now() }); n++; } });
  if (!n) { toast('Todo ya está publicado.'); return; }
  await b.commit(); await loadGrid(); draw(); toast(n + ' días publicados.');
}

// ---------- revisar ----------
async function openReview(aid) {
  C.ra = aid; C.tab = 'revisar'; C.rtab = 'revisar'; C.prog = null; draw();
  await loadReview(); draw();
}
async function loadReview() {
  const dates = weekDates(C.rm);
  const [days, logs, ts] = await Promise.all([
    rangeDocs(P.days(uid(), C.ra), dates[0], dates[6]),
    rangeDocs(P.logs(uid(), C.ra), dates[0], dates[6]),
    getDocs(P.tests(uid(), C.ra))
  ]);
  Object.values(days).forEach(assignIds);
  C.rDays = days; C.rLogs = logs; C.rTests = {}; ts.forEach((d) => { C.rTests[d.id] = d.data(); });
}
async function setRm(delta) { C.rm = addDays(C.rm, 7 * delta); await loadReview(); draw(); }

async function setStatus(date, gid, status) {
  const log = C.rLogs[date] || { items: {} };
  log.items = log.items || {};
  log.items[gid] = Object.assign({}, log.items[gid] || {}, { status: (log.items[gid] || {}).status === status ? null : status });
  log.by = 'coach'; log.updatedAt = Date.now();
  C.rLogs[date] = log;
  await setDoc(P.log(uid(), C.ra, date), JSON.parse(JSON.stringify(log))); draw();
}
async function markComplete(date) {
  const day = C.rDays[date]; const log = C.rLogs[date] || { items: {} }; log.items = log.items || {};
  day.blocks.forEach((b) => groupItems(b.items).forEach((g) => { if (g.kind === 'single' && g.item.type === 'note') return; if (!(log.items[g.id] || {}).status) log.items[g.id] = Object.assign({}, log.items[g.id] || {}, { status: 'hecho' }); }));
  log.finished = true; log.by = 'coach'; log.updatedAt = Date.now(); log.comment = log.comment || 'Marcado completo por el entrenador.';
  C.rLogs[date] = log; await setDoc(P.log(uid(), C.ra, date), JSON.parse(JSON.stringify(log))); draw(); toast('Día marcado como completo.');
}

async function addTest() {
  const name = C.newTest.name.trim(); if (!name) return;
  const key = testKey(name);
  await setDoc(P.test(uid(), C.ra, key), { name, unit: C.newTest.unit, initial: null, current: null, history: [] });
  C.newTest = { name: '', unit: 'kg' }; await loadReview(); draw();
}
async function addResult(key) {
  const raw = (C.newRes[key] || '').replace(',', '.'); const v = Number(raw);
  if (!raw || isNaN(v)) { toast('Escribe un número.'); return; }
  const t = C.rTests[key]; const today = ymd(new Date());
  const rec = { value: v, date: today };
  const upd = { current: rec, history: (t.history || []).concat(t.current ? [t.current] : []) };
  if (!t.initial) { upd.initial = rec; upd.history = []; }
  await F.updateDoc(P.test(uid(), C.ra, key), upd);
  C.newRes[key] = ''; await loadReview(); draw(); toast('Resultado guardado.');
}

// ---------- Excel ----------
async function exportExcel() {
  C.busy = true; draw();
  try {
    const detail = [], summary = [];
    for (const a of C.athletes) {
      const [days, logs] = await Promise.all([rangeDocs(P.days(uid(), a.id), C.exFrom, C.exTo), rangeDocs(P.logs(uid(), a.id), C.exFrom, C.exTo)]);
      const weeks = {};
      Object.keys(days).sort().forEach((date) => {
        const day = assignIds(days[date]); const log = logs[date];
        detailRows(a.name, date, day, log).forEach((r) => detail.push(r));
        const wk = ymd(mondayOf(parseYmd(date)));
        const w = weeks[wk] || (weeks[wk] = { sesiones: 0, conRegistro: 0, items: 0, hechos: 0, tPlan: 0, tHecho: 0, tiros: 0, contactos: 0, metros: 0, sl: [], hr: [], fe: [], coments: [] });
        const mp = dayMetrics(day, log, 'plan'), md = dayMetrics(day, log, 'done');
        w.sesiones++; if (log && (log.finished || Object.values(log.items || {}).some((x) => x && x.status))) w.conRegistro++;
        w.items += mp.items; w.hechos += mp.done; w.tPlan += mp.tonnage; w.tHecho += md.tonnage; w.tiros += md.throws; w.contactos += md.contacts; w.metros += md.meters;
        if (log && log.wellness && log.wellness.sleep) { w.sl.push(log.wellness.sleep); w.hr.push(log.wellness.hours); w.fe.push(log.wellness.feel); }
        if (log && log.comment) w.coments.push(niceDate(date) + ': ' + log.comment);
      });
      const avg = (x) => (x.length ? Math.round(x.reduce((s, v) => s + v, 0) / x.length * 10) / 10 : null);
      Object.keys(weeks).sort().forEach((wk) => {
        const w = weeks[wk];
        summary.push({ 'Semana (lunes)': wk, Atleta: a.name, Grupo: a.group || '', 'Sesiones planificadas': w.sesiones, 'Sesiones con registro': w.conRegistro, '% cumplido': w.items ? Math.round(w.hechos / w.items * 100) : null, 'Tonelaje plan (t)': Math.round(w.tPlan * 100) / 100, 'Tonelaje hecho (t)': Math.round(w.tHecho * 100) / 100, Tiros: w.tiros, Contactos: w.contactos, Metros: w.metros, 'Sueño prom. (1-5)': avg(w.sl), 'Horas sueño prom.': avg(w.hr), 'Se siente prom. (1-5)': avg(w.fe), Comentarios: w.coments.join(' | ') });
      });
    }
    detail.sort((x, y) => (x.Fecha + x.Atleta).localeCompare(y.Fecha + y.Atleta));
    let XLSX = null;
    try { XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs'); } catch (e) { XLSX = null; }
    const fname = 'Entto_' + C.exFrom + '_a_' + C.exTo;
    if (XLSX) {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), 'Detalle');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Resumen semanal');
      XLSX.writeFile(wb, fname + '.xlsx');
    } else {
      const csv = toCsv(detail); const blob = new Blob(['﻿' + csv], { type: 'text/csv' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname + '.csv'; a.click();
    }
    toast(detail.length + ' filas exportadas.');
  } catch (e) { console.error(e); toast('No se pudo exportar: ' + e.message); }
  C.busy = false; draw();
}
function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => (v == null ? '' : /[";\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
  return [cols.join(';')].concat(rows.map((r) => cols.map((c) => esc(r[c])).join(';'))).join('\n');
}

// ---------- admin ----------
async function loadUsers() { const s = await getDocs(P.users()); C.users = []; s.forEach((d) => C.users.push(Object.assign({ id: d.id }, d.data()))); draw(); }
async function createCoach() {
  const { name, email, pass } = C.nu;
  if (!name || !email || pass.length < 6) { toast('Completa nombre, correo y una contraseña de al menos 6 caracteres.'); return; }
  C.busy = true; draw();
  try {
    const sec = AppMod.initializeApp(firebaseConfig, 'sec' + Date.now());
    const secAuth = A.getAuth(sec);
    const cred = await A.createUserWithEmailAndPassword(secAuth, email.trim(), pass);
    await setDoc(P.user(cred.user.uid), { role: 'coach', name: name.trim(), email: email.trim().toLowerCase(), createdAt: Date.now() });
    await A.signOut(secAuth);
    C.nu = { name: '', email: '', pass: '' }; await loadUsers();
    toast('Cuenta creada. Pásale el correo y la contraseña a ' + name + '.');
  } catch (e) { toast(e.code === 'auth/email-already-in-use' ? 'Ese correo ya tiene cuenta.' : 'No se pudo crear: ' + e.code); }
  C.busy = false; draw();
}

// ---------- vistas ----------
function view() {
  if (!C.ready) return html`<div class="app coach"><p class="muted center pad">Cargando…</p></div>`;
  if (!C.user) return loginView();
  if (!C.profile) return html`<div class="app coach"><div class="hd"><h1>Entto</h1></div><div class="wrap"><div class="card"><p>Tu cuenta (${C.user.email}) todavía no está habilitada como entrenador. Pídele al administrador que la cree.</p><button class="btn ghost" @click=${() => A.signOut(auth)}>Salir</button></div></div></div>`;
  const tabs = [['atletas', 'Atletas'], ['plan', 'Planificar'], ['ejercicios', 'Ejercicios']].concat(C.isAdmin ? [['admin', 'Entrenadores']] : []);
  return html`<div class="app coach">
    <div class="hd">
      <div class="hd-top"><h1>Entto</h1><span class="sub">${C.profile.name || C.user.email} · <button class="link light" @click=${() => A.signOut(auth)}>Salir</button></span></div>
      <nav class="tabs">${tabs.map(([k, l]) => html`<button class=${C.tab === k || (k === 'atletas' && C.tab === 'revisar') ? 'on' : ''} @click=${() => { C.tab = k; if (k === 'admin') loadUsers(); draw(); }}>${l}</button>`)}</nav>
    </div>
    <div class="wrap">
      ${C.tab === 'atletas' ? athletesView() : C.tab === 'plan' ? planView() : C.tab === 'ejercicios' ? exercisesView() : C.tab === 'revisar' ? reviewView() : adminView()}
    </div>
    ${C.toast ? html`<div class="toast" role="status">${C.toast}</div>` : nothing}
  </div>`;
}

function loginView() {
  let email = '', pass = '';
  return html`<div class="app coach"><div class="hd"><h1>Entto</h1><span class="sub">Entrenadores</span></div>
    <div class="wrap narrow"><form class="card" @submit=${(e) => { e.preventDefault(); const f = new FormData(e.target); login(String(f.get('email')).trim(), String(f.get('pass'))); }}>
      <label class="q" for="em">Correo</label><input id="em" name="email" type="email" autocomplete="username" required class="inp">
      <label class="q" for="pw">Contraseña</label><input id="pw" name="pass" type="password" autocomplete="current-password" required class="inp">
      ${C.loginErr ? html`<p class="err">${C.loginErr}</p>` : nothing}
      <button class="btn-main" ?disabled=${C.busy}>${C.loginMode === 'create' ? 'Crear mi cuenta de administrador' : 'Entrar'}</button>
      <button type="button" class="link" @click=${() => { C.loginMode = C.loginMode === 'create' ? 'login' : 'create'; C.loginErr = ''; draw(); }}>${C.loginMode === 'create' ? 'Ya tengo cuenta' : 'Primera vez del administrador: crear cuenta'}</button>
      <button type="button" class="link" @click=${async () => { const em = document.getElementById('em').value.trim(); if (!em) { C.loginErr = 'Escribe tu correo arriba.'; draw(); return; } try { await A.sendPasswordResetEmail(auth, em); toast('Te enviamos un correo para cambiar la contraseña.'); } catch (e) { C.loginErr = 'No se pudo enviar el correo.'; draw(); } }}>Olvidé mi contraseña</button>
    </form></div>${C.toast ? html`<div class="toast">${C.toast}</div>` : nothing}</div>`;
}

function athletesView() {
  return html`
    <div class="card">
      <h2>Agregar atleta</h2>
      <form class="row wrap-row" @submit=${(e) => { e.preventDefault(); const f = new FormData(e.target); addAthlete(String(f.get('n')), String(f.get('g'))); e.target.reset(); }}>
        <input name="n" class="inp grow" placeholder="Nombre" aria-label="Nombre del atleta" required>
        <select name="g" class="inp" aria-label="Grupo">${GROUPS.map((g) => html`<option>${g}</option>`)}</select>
        <button class="btn main">Agregar</button>
      </form>
    </div>
    <div class="list">
      ${C.athletes.length ? C.athletes.map((a) => html`<div class="ath ${a.paused ? 'paused' : ''}">
        <button class="ath-main" @click=${() => openReview(a.id)}><span class="ath-name">${a.name}</span><span class="muted small">${a.group || ''}${a.paused ? ' · en pausa' : ''}</span></button>
        <div class="ath-acts">
          <button class="btn-sm" @click=${() => copyLink(a)}>Copiar enlace</button>
          <button class="btn-sm" @click=${() => whatsapp(a)}>WhatsApp</button>
          <button class="btn-sm" @click=${() => togglePause(a)}>${a.paused ? 'Reactivar' : 'Pausar'}</button>
          <button class="btn-sm" @click=${() => newLink(a)}>Enlace nuevo</button>
        </div></div>`) : html`<p class="muted">Todavía no hay atletas. Agrega el primero arriba.</p>`}
    </div>
    <div class="card">
      <h2>Exportar a Excel</h2>
      <div class="row wrap-row"><label class="small">Desde <input type="date" class="inp" .value=${live(C.exFrom)} @change=${(e) => { C.exFrom = e.target.value; }}></label>
        <label class="small">Hasta <input type="date" class="inp" .value=${live(C.exTo)} @change=${(e) => { C.exTo = e.target.value; }}></label>
        <button class="btn main" ?disabled=${C.busy} @click=${exportExcel}>${C.busy ? 'Preparando…' : 'Descargar'}</button></div>
      <p class="muted small">Dos hojas: el detalle por serie (plan, hecho y cambio) y el resumen semanal por atleta.</p>
    </div>`;
}

function itemLine(it, onType) {
  if (it.type === 'note') return html`<li class="it note">Nota: ${it.text}</li>`;
  return html`<li class="it"><span class="it-tag">${it.circuit ? it.circuit + ' · ' : ''}${TAGS[it.type]}</span><span class="it-name">${it.name}</span><span class="it-plan">${it.plan}${it.marca ? ' · marca' : ''}${it.run && it.run.splits.length ? ' · ' + it.run.splits.map((s) => s.label).join(' · ') : ''}</span>
    ${onType ? html`<select class="mini" aria-label="Tipo de ${it.name}" @change=${(e) => onType(e.target.value)}>${TYPES.map(([k, l]) => html`<option value=${k} ?selected=${(C.types[norm(it.name)] || it.type) === k}>${l}</option>`)}</select>` : nothing}</li>`;
}

function planView() {
  const dates = weekDates(C.pm);
  const ga = C.athletes.find((a) => a.id === C.gridAid);
  return html`
    <div class="weeknav"><button class="icon" aria-label="Semana anterior" @click=${() => setPm(-1)}>‹</button><h2>Semana del ${niceDate(dates[0])} al ${niceDate(dates[6])}</h2><button class="icon" aria-label="Semana siguiente" @click=${() => setPm(1)}>›</button></div>
    <div class="card">
      <h2>Pegar texto</h2>
      <p class="muted small">Pega tu mensaje como lo escribes en WhatsApp. Puede traer varios atletas (nombre en una línea) y días (LUNES, MARTES…). Si no trae días, va al día que elijas abajo.</p>
      <textarea class="big" placeholder=${EXAMPLE} .value=${live(C.text)} @input=${(e) => { C.text = e.target.value; }}></textarea>
      <details class="guide"><summary>Cómo escribir cada tipo de ejercicio</summary>
        <table class="tbl"><tbody>${GUIDE.map(([a, b]) => html`<tr><td>${a}</td><td><code>${b}</code></td></tr>`)}</tbody></table>
        <button class="btn-sm" @click=${() => { C.text = EXAMPLE; draw(); }}>Usar el ejemplo como base</button>
      </details>
      <div class="row wrap-row">
        <label class="small">Día si no lo indica: <select class="inp" @change=${(e) => { C.targetDate = e.target.value; }}>${dates.map((d, i) => html`<option value=${d} ?selected=${C.targetDate === d}>${DAY_LONG[i]} ${niceDate(d)}</option>`)}</select></label>
        <button class="btn main" @click=${convert}>Convertir</button>
      </div>
    </div>
    ${C.parsed ? previewView(dates) : nothing}
    <div class="card">
      <h2>Microciclo para tu Excel</h2>
      <p class="muted small">Semana del lunes ${niceDate(dates[0])}. Todos tus atletas, con los días uno al lado del otro: Ejercicio, S, R, KG, Progresiones y Realizado. “Copiar” lo deja listo para pegar en tu hoja con ese formato.</p>
      <div class="seg2">${[['todo', 'Semana completa'], ['gym', 'Solo gym'], ['pista', 'Solo pista']].map(([k, l]) => html`<button class=${C.microMode === k ? 'on' : ''} @click=${() => { C.microMode = k; draw(); }}>${l}</button>`)}</div>
      <div class="row wrap-row"><label class="chk"><input type="checkbox" .checked=${C.printDone} @change=${(e) => { C.printDone = e.target.checked; }}> Incluir lo realizado</label>
        <button class="btn main" ?disabled=${C.busy} @click=${() => microAction('copy')}>Copiar plan completo</button>
        <button class="btn ghost" ?disabled=${C.busy} @click=${() => microAction('print')}>Imprimir o PDF</button></div>
      <div class="sep"></div>
      <h2>Copiar solo lo realizado</h2>
      <p class="muted small">Misma forma que el plan completo, para pegarlo encima del que ya tienes en tu hoja sin borrar nada.</p>
      <div class="row wrap-row"><button class="btn main" ?disabled=${C.busy} @click=${() => microAction('done')}>Realizado de toda la semana</button>
        <span class="muted small">En Excel: clic en la misma celda de arriba a la izquierda → Pegado especial → marcar <b>Saltar blancos</b> → Aceptar.</span></div>
      <div class="row wrap-row"><span class="small">Realizado de un día:</span>${dates.map((d, i) => html`<button class="btn-sm" ?disabled=${C.busy} @click=${() => microAction('day', i)}>${DAY_SHORT[i]} ${parseYmd(d).getDate()}</button>`)}</div>
      <p class="muted small">Un día = una sola columna: clic en la primera celda de la columna Realizado de ese día (la fila del título “Microciclo”) y pegar normal. Sirve también en Google Sheets.</p>
    </div>
    <div class="card">
      <div class="row wrap-row between"><h2>Semana de cada atleta</h2>
        <select class="inp" aria-label="Atleta" @change=${async (e) => { C.gridAid = e.target.value; await loadGrid(); draw(); }}>${C.athletes.map((a) => html`<option value=${a.id} ?selected=${a.id === C.gridAid}>${a.name}${a.paused ? ' (pausa)' : ''}</option>`)}</select></div>
      ${ga ? html`<div class="row wrap-row"><button class="btn ghost" @click=${copyPrevWeek}>Copiar semana anterior</button><button class="btn main" @click=${publishWeek}>Publicar toda la semana</button></div>
      <div class="week">${dates.map((d, i) => dayCell(d, i, dates))}</div>` : html`<p class="muted">Agrega atletas para ver su semana.</p>`}
    </div>`;
}

function previewView(dates) {
  const r = C.parsed;
  const realWarn = r.warnings.filter((w) => w.kind !== 'type');
  return html`<div class="card preview">
    <h2>Vista previa</h2>
    ${realWarn.length ? html`<div class="warn">${realWarn.map((w) => html`<div>Línea ${w.line}: “${w.text}” — ${w.msg}</div>`)}</div>` : nothing}
    ${Object.keys(C.types).length ? html`<p class="muted small">Ejercicios nuevos: confirma su tipo una sola vez (queda guardado en tu lista).</p>` : nothing}
    ${r.athletes.map((pa, i) => html`<div class="pv-ath">
      <div class="row wrap-row"><b>${pa.name || 'Sin nombre'}</b>
        <select class="inp" aria-label="Atleta" @change=${(e) => { C.mapping[i] = e.target.value; draw(); }}>
          <option value="" ?selected=${!C.mapping[i]}>No guardar</option>
          ${pa.name && !C.athletes.some((a) => norm(a.name) === norm(pa.name)) ? html`<option value="__new" ?selected=${C.mapping[i] === '__new'}>Crear “${pa.name}”</option>` : nothing}
          ${C.athletes.map((a) => html`<option value=${a.id} ?selected=${C.mapping[i] === a.id}>${a.name}</option>`)}
        </select></div>
      ${pa.days.map((d) => html`<div class="pv-day"><span class="pv-date">${d.dayIndex != null ? DAY_LONG[d.dayIndex] + ' ' + niceDate(dates[d.dayIndex]) : DAY_LONG[weekDates(C.pm).indexOf(C.targetDate)] + ' ' + niceDate(C.targetDate)}</span>
        ${d.prio ? html`<div class="prio small">Prioridad: ${d.prio}</div>` : nothing}
        ${d.blocks.map((b) => html`<div class="pv-block"><span class="bname small">${b.name}</span><ul>${b.items.map((it) => itemLine(it, it.typeGuessed && it.type !== 'run' && it.type !== 'note' ? (t) => { C.types[norm(it.name)] = t; applyType(it, t); draw(); } : null))}</ul></div>`)}
      </div>`)}
    </div>`)}
    <div class="row wrap-row"><button class="btn ghost" ?disabled=${C.busy} @click=${() => saveParsed(false)}>Guardar borrador</button><button class="btn main" ?disabled=${C.busy} @click=${() => saveParsed(true)}>Publicar</button><button class="link" @click=${() => { C.parsed = null; draw(); }}>Descartar</button></div>
  </div>`;
}

function dayCell(d, i, dates) {
  const x = C.grid[d];
  if (C.editing === d) return html`<div class="dcell editing"><b>${DAY_SHORT[i]} ${parseYmd(d).getDate()}</b>
    <textarea class="mid" .value=${live(C.editText)} @input=${(e) => { C.editText = e.target.value; }}></textarea>
    <div class="row"><button class="btn-sm main" @click=${() => saveEdit(d)}>Guardar</button><button class="btn-sm" @click=${() => { C.editing = null; draw(); }}>Cancelar</button></div></div>`;
  return html`<div class="dcell ${x ? '' : 'empty'}">
    <div class="row between"><b>${DAY_SHORT[i]} ${parseYmd(d).getDate()}</b>${x ? html`<span class="chip ${x.published ? 'chip-done' : ''}">${x.published ? 'Publicado' : 'Borrador'}</span>` : nothing}</div>
    ${x ? html`${x.prio ? html`<div class="muted small">Prioridad: ${x.prio}</div>` : nothing}
      ${x.blocks.map((b) => html`<div class="bname small">${b.name}</div><ul>${b.items.map((it) => itemLine(it))}</ul>`)}
      <div class="row wrap-row">
        <button class="btn-sm" @click=${() => { C.editing = d; C.editText = x.text || ''; draw(); }}>Editar</button>
        <button class="btn-sm" @click=${() => dayAction(d, 'pub')}>${x.published ? 'Despublicar' : 'Publicar'}</button>
        <select class="mini" aria-label="Mover a otro día" @change=${(e) => { if (e.target.value) dayAction(d, 'move', e.target.value); }}><option value="">Mover a…</option>${dates.map((o, j) => (o !== d ? html`<option value=${o}>${DAY_SHORT[j]}</option>` : nothing))}</select>
        <button class="btn-sm" @click=${() => dayAction(d, 'del')}>En blanco</button>
      </div>` : html`<span class="muted small">Sin entrenamiento</span>
      <button class="btn-sm" @click=${() => { C.editing = d; C.editText = ''; draw(); }}>Escribir este día</button>`}
  </div>`;
}

function exercisesView() {
  const list = Object.entries(C.exercises).sort((a, b) => a[1].name.localeCompare(b[1].name));
  return html`<div class="card">
    <h2>Tu lista de ejercicios</h2>
    <p class="muted small">El tipo decide qué anota el atleta y qué cuenta la app (toneladas, tiros, contactos). Los nuevos se agregan solos al pegar texto.</p>
    <form class="row wrap-row" @submit=${async (e) => { e.preventDefault(); const f = new FormData(e.target); const n = String(f.get('n')).trim(); if (!n) return; await setDoc(P.exercise(uid(), norm(n).replace(/\//g, '-')), { name: n, type: String(f.get('t')) }); e.target.reset(); await loadBase(); draw(); }}>
      <input name="n" class="inp grow" placeholder="Nombre del ejercicio" aria-label="Nombre del ejercicio" required>
      <select name="t" class="inp" aria-label="Tipo">${TYPES.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>
      <button class="btn main">Agregar</button></form>
    <table class="tbl"><thead><tr><th>Ejercicio</th><th>Tipo</th><th></th></tr></thead><tbody>
      ${list.map(([k, e]) => html`<tr><td>${e.name}</td><td><select class="mini" aria-label="Tipo de ${e.name}" @change=${async (ev) => { await setDoc(P.exercise(uid(), k), { name: e.name, type: ev.target.value }); await loadBase(); draw(); }}>${TYPES.map(([t, l]) => html`<option value=${t} ?selected=${e.type === t}>${l}</option>`)}</select></td>
        <td><button class="btn-sm" @click=${async () => { await deleteDoc(P.exercise(uid(), k)); await loadBase(); draw(); }}>Quitar</button></td></tr>`)}
    </tbody></table></div>`;
}

function reviewView() {
  const a = C.athletes.find((x) => x.id === C.ra);
  if (!a) return html`<p>Elige un atleta.</p>`;
  const dates = weekDates(C.rm);
  const head = html`
    <button class="link" @click=${() => { C.tab = 'atletas'; draw(); }}>‹ Atletas</button>
    <h2 class="big">${a.name} <span class="muted small">${a.group || ''}</span></h2>
    <div class="seg2 narrowseg">${[['revisar', 'Revisar'], ['progreso', 'Progreso']].map(([k, l]) => html`<button class=${C.rtab === k ? 'on' : ''} @click=${() => { C.rtab = k; if (k === 'progreso' && !C.prog) loadProgress(); draw(); }}>${l}</button>`)}</div>`;
  if (C.rtab === 'progreso') return html`${head}${progressView()}`;
  return html`${head}
    <div class="weeknav"><button class="icon" aria-label="Semana anterior" @click=${() => setRm(-1)}>‹</button><h2>Semana del ${niceDate(dates[0])}</h2><button class="icon" aria-label="Semana siguiente" @click=${() => setRm(1)}>›</button></div>
    <div class="review">${dates.map((d, i) => {
      const day = C.rDays[d]; if (!day) return nothing;
      const log = C.rLogs[d] || { items: {} };
      const w = log.wellness;
      const m = dayMetrics(day, log, 'plan');
      const any = Object.values(log.items || {}).some((x) => x && x.status);
      return html`<div class="card">
        <div class="row between"><b>${DAY_LONG[i]} ${niceDate(d)}</b><span class="chip ${m.items && m.done === m.items ? 'chip-done' : any ? 'chip-part' : ''}">${m.done} de ${m.items}${day.published ? '' : ' · borrador'}</span></div>
        ${w && w.sleep ? html`<div class="wbl">Durmió ${w.sleep}/5 (${String(w.hours).replace('.', ',')} h) · Se sentía ${w.feel}/5</div>` : nothing}
        ${day.blocks.map((b) => html`<div class="bname small">${b.name}</div>${groupItems(b.items).map((g) => {
          if (g.kind === 'single' && g.item.type === 'note') return html`<div class="rv note">Nota: ${g.item.text}</div>`;
          const e = (log.items || {})[g.id] || {};
          const list = g.kind === 'circuit' ? g.items : [g.item];
          const txt = e.status === 'mod' ? (g.kind === 'circuit' ? list.map((x) => x.name + ' ' + modSummary(x, (e.ex || {})[x.id])).join(' / ') : modSummary(g.item, e)) + (e.mark ? ' · marca ' + e.mark : '') : (e.mark ? 'marca ' + e.mark : '');
          return html`<div class="rv">
            <div class="col grow"><span class="it-name">${g.kind === 'circuit' ? 'Circuito ' + g.letter + ': ' + list.map((x) => x.name).join(' + ') : g.item.name}</span>
              <span class="it-plan">Plan: ${list.map((x) => x.plan).join(' / ')}${g.kind === 'single' && intensityText(g.item, C.rTests) ? ' · ' + intensityText(g.item, C.rTests) : ''}</span>
              ${e.status ? html`<span class=${e.status === 'mod' ? 'rv-mod' : e.status === 'no' ? 'rv-no' : 'rv-ok'}>${ST[e.status]}${txt ? ': ' + txt : ''}</span>` : html`<span class="muted small">Sin registro${txt ? ' · ' + txt : ''}</span>`}</div>
            <div class="rv-acts"><button class="btn-xs ${e.status === 'hecho' ? 'on' : ''}" aria-label="Marcar hecho" @click=${() => setStatus(d, g.id, 'hecho')}>✓</button><button class="btn-xs ${e.status === 'no' ? 'on' : ''}" aria-label="Marcar no lo hizo" @click=${() => setStatus(d, g.id, 'no')}>✕</button></div>
          </div>`;
        })}`)}
        ${log.comment ? html`<div class="quote">“${log.comment}”</div>` : nothing}
        ${!log.finished ? html`<button class="btn-sm" @click=${() => markComplete(d)}>Marcar completo (olvidó el celular)</button>` : html`<span class="muted small">Sesión terminada${log.by === 'coach' ? ' (marcada por ti)' : ''}</span>`}
      </div>`;
    })}
    ${!Object.keys(C.rDays).length ? html`<p class="muted">No hay entrenamientos en esta semana.</p>` : nothing}</div>
    <div class="card">
      <h2>Tests</h2>
      <p class="muted small">El primer resultado queda como valor inicial y no cambia. Cada resultado nuevo pasa a ser el actual; los intermedios se guardan para ver el progreso. Usa el mismo nombre del ejercicio (ej. Sentadilla) para que el % aparezca en el plan.</p>
      <table class="tbl"><thead><tr><th>Test</th><th>Inicial</th><th>Actual</th><th>Intermedios</th><th>Nuevo resultado</th></tr></thead><tbody>
        ${Object.entries(C.rTests).map(([k, t]) => html`<tr><td>${t.name}</td>
          <td>${t.initial ? t.initial.value + ' ' + t.unit : '—'}<br><span class="muted small">${t.initial ? niceDate(t.initial.date) : ''}</span></td>
          <td>${t.current ? t.current.value + ' ' + t.unit : '—'}<br><span class="muted small">${t.current ? niceDate(t.current.date) : ''}</span></td>
          <td class="small">${(t.history || []).map((h) => h.value + ' (' + niceDate(h.date) + ')').join(' · ') || '—'}</td>
          <td><div class="row"><input class="num" inputmode="decimal" aria-label="Nuevo resultado de ${t.name}" .value=${live(C.newRes[k] || '')} @input=${(e) => { C.newRes[k] = e.target.value; }}><button class="btn-sm" @click=${() => addResult(k)}>Guardar</button></div></td></tr>`)}
      </tbody></table>
      <div class="row wrap-row"><input class="inp grow" placeholder="Nombre del test (ej. Sentadilla, 30 m, CMJ)" aria-label="Nombre del test" .value=${live(C.newTest.name)} @input=${(e) => { C.newTest.name = e.target.value; }}>
        <select class="inp" aria-label="Unidad" @change=${(e) => { C.newTest.unit = e.target.value; }}>${['kg', 's', 'm', 'cm'].map((u) => html`<option ?selected=${C.newTest.unit === u}>${u}</option>`)}</select>
        <button class="btn main" @click=${addTest}>Agregar test</button></div>
    </div>`;
}

function adminView() {
  return html`<div class="card">
    <h2>Crear entrenador</h2>
    <div class="row wrap-row">
      <input class="inp grow" placeholder="Nombre" aria-label="Nombre" .value=${live(C.nu.name)} @input=${(e) => { C.nu.name = e.target.value; }}>
      <input class="inp grow" type="email" placeholder="Correo" aria-label="Correo" .value=${live(C.nu.email)} @input=${(e) => { C.nu.email = e.target.value; }}>
      <input class="inp" type="text" placeholder="Contraseña inicial" aria-label="Contraseña inicial" .value=${live(C.nu.pass)} @input=${(e) => { C.nu.pass = e.target.value; }}>
      <button class="btn main" ?disabled=${C.busy} @click=${createCoach}>Crear</button></div>
    <p class="muted small">Pásale el correo y la contraseña. Puede cambiarla con “Olvidé mi contraseña”. Los nombres de abajo se pueden editar (el tuyo aparece en el microciclo).</p>
  </div>
  <div class="card"><h2>Entrenadores</h2>
    <table class="tbl"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th></tr></thead><tbody>
      ${C.users.map((u) => html`<tr><td><input class="inp" aria-label=${'Nombre de ' + u.email} .value=${live(u.name || '')} @change=${async (e) => { const name = e.target.value.trim(); if (!name) return; await F.updateDoc(P.user(u.id), { name }); if (u.id === uid()) C.profile.name = name; await loadUsers(); toast('Nombre guardado.'); }}></td><td>${u.email}</td><td>${u.role === 'admin' ? 'Administrador' : 'Entrenador'}</td></tr>`)}
    </tbody></table></div>`;
}


// ---------- progreso ----------
async function loadProgress(years = 1) {
  C.ploading = true; draw();
  const today = new Date();
  const from = years > 1 ? (today.getFullYear() - 4) + '-01-01' : ymd(addDays(today, -400));
  const to = ymd(addDays(today, 14));
  const [days, logs, ts] = await Promise.all([rangeDocs(P.days(uid(), C.ra), from, to), rangeDocs(P.logs(uid(), C.ra), from, to), getDocs(P.tests(uid(), C.ra))]);
  const daily = {};
  Object.keys(days).forEach((d) => { try { daily[d] = dayStats(days[d], logs[d]); } catch (e) { console.error(d, e); } });
  const tests = {}; ts.forEach((x) => { tests[x.id] = x.data(); });
  C.prog = { aid: C.ra, daily, tests, years, from };
  C.ploading = false; draw();
}

const f1 = (v) => (v == null ? '—' : (Math.round(v * 10) / 10).toString().replace('.', ','));
const f0 = (v) => (v == null ? '—' : Math.round(v).toLocaleString('es'));
const fpct = (v) => Math.round(v) + ' %';
const funit = (k) => (k === 'ton' ? (v) => f1(v) + ' t' : k === 'met' ? (v) => f0(v) + ' m' : (v) => f0(v));
const PV_LABEL = { dia: 'día típico', semana: 'semana típica', mes: 'mes típico', anio: 'temporada base' };
const PV_CAP = {
  dia: 'Día por día. 100 % = su día de entrenamiento típico (promedio de las últimas 4 semanas).',
  semana: 'Últimas 12 semanas. 100 % = su semana típica (promedio de las 4 anteriores).',
  mes: 'Últimos 12 meses. 100 % = su mes típico (promedio de los 3 anteriores).',
  anio: 'Año contra año. 100 % = su primer año registrado.'
};

function pick(key) { return (i) => { if (C.psel[key] !== i) { C.psel = Object.assign({}, C.psel, { [key]: i }); draw(); } }; }

function progressView() {
  if (!C.prog || C.ploading) return html`<p class="muted">Calculando el progreso…</p>`;
  const { daily, tests } = C.prog;
  const today = new Date();
  const ser = buildSeries(daily, C.pv, today, C.poff);
  const labels = ser.map((p) => p.label);
  const cur = C.pv === 'dia' ? ser.reduce((acc, p) => { ['ton', 'thr', 'con', 'met'].forEach((k) => { acc.done[k] += p.done[k]; }); acc.items += p.items; acc.doneItems += p.doneItems; acc.hours = acc.hours.concat(p.hours); acc.mods = acc.mods.concat(p.mods); return acc; }, { done: { ton: 0, thr: 0, con: 0, met: 0 }, items: 0, doneItems: 0, hours: [], mods: [] })
    : ser.slice().reverse().find((p) => p.sessions > 0) || ser[ser.length - 1];
  const has = (k) => ser.some((p) => p.plan[k] > 0 || p.done[k] > 0);
  const anyRel = ser.some((p) => p.relDone != null || p.relPlan != null);
  const up = cur.mods.filter((m) => m.dir === 'up').length, down = cur.mods.filter((m) => m.dir === 'down').length;
  const hAvg = cur.hours.length ? cur.hours.reduce((a, b) => a + b, 0) / cur.hours.length : null;
  const kpis = [['% cumplido', cur.items ? Math.round(cur.doneItems / cur.items * 100) + ' %' : '—']];
  if (has('ton')) kpis.push(['Toneladas', f1(cur.done.ton) + ' t']);
  if (has('thr')) kpis.push(['Tiros', f0(cur.done.thr)]);
  if (has('con')) kpis.push(['Contactos', f0(cur.done.con)]);
  if (has('met')) kpis.push(['Metros', f0(cur.done.met)]);
  kpis.push(['Horas de sueño', hAvg != null ? f1(hAvg) + ' h' : '—']);
  kpis.push(['Cambios', '↑ ' + up + '  ↓ ' + down]);
  const alert = wellnessAlert(daily, today);
  const s = (k) => C.psel[k];
  const detailRel = s('rel') != null ? (() => { const p = ser[s('rel')]; return p.label + ': planificado ' + (p.relPlan != null ? fpct(p.relPlan) : '—') + ' · hecho ' + (p.relDone != null ? fpct(p.relDone) : '—') + ' de su ' + PV_LABEL[C.pv] + (p.items ? ' · cumplido ' + p.pct + ' %' : ''); })() : 'Toca una barra para ver el detalle.';
  const kgKeys = [...new Set(ser.flatMap((p) => Object.keys(p.done.thrByKg)))].sort((a, b) => parseFloat(a) - parseFloat(b)).slice(0, 5);
  const win = { from: ser[0].from, to: ser[ser.length - 1].to };
  const mods = modsSummary(daily, win.from, win.to);
  const marks = bestMarks(daily, '0000', '9999');
  const testList = Object.values(tests).map((t) => ({ t, pts: testSeries(t) })).filter((x) => x.pts.length);
  const hoursAll = Object.values(daily).filter((d) => d.wellness).map((d) => d.wellness.hours);
  const hoursRef = hoursAll.length ? hoursAll.slice(-28).reduce((a, b) => a + b, 0) / Math.min(28, hoursAll.length) : null;

  return html`
    <div class="card">
      <div class="row wrap-row between">
        <div class="seg2">${[['dia', 'Día'], ['semana', 'Semana'], ['mes', 'Mes'], ['anio', 'Año']].map(([k, l]) => html`<button class=${C.pv === k ? 'on' : ''} @click=${async () => { C.pv = k; C.poff = 0; C.psel = {}; if (k === 'anio' && C.prog.years < 5) await loadProgress(5); draw(); }}>${l}</button>`)}</div>
        <div class="seg2">${[['rel', 'Relativo a su típico'], ['real', 'Unidades reales']].map(([k, l]) => html`<button class=${C.pmode === k ? 'on' : ''} @click=${() => { C.pmode = k; draw(); }}>${l}</button>`)}</div>
      </div>
      ${C.pv === 'dia' || C.pv === 'semana' ? html`<div class="weeknav"><button class="icon" aria-label="Anterior" @click=${() => { C.poff--; C.psel = {}; draw(); }}>‹</button><span class="muted small">${ser[0].label} → ${ser[ser.length - 1].label}</span><button class="icon" aria-label="Siguiente" @click=${() => { if (C.poff < 0) { C.poff++; C.psel = {}; draw(); } }}>›</button></div>` : nothing}
      <div class="kpis">${kpis.map(([l, v]) => html`<div class="kpi"><span class="kpi-l">${l}</span><span class="kpi-v">${v}</span></div>`)}</div>
      <p class="muted small">${C.pv === 'dia' ? 'Cifras de la semana mostrada.' : 'Cifras del último período con entrenamiento (' + cur.label + ').'}</p>
    </div>

    ${alert ? html`<div class="warn"><b>Bienestar bajo 2 días seguidos</b><span>${alert.text}</span></div>` : nothing}

    ${C.pmode === 'rel' ? html`<div class="card">
      <h2>Carga</h2><p class="muted small">${PV_CAP[C.pv]}</p>
      ${legend([[GHOST, 'Planificado'], [BLUE, 'Hecho'], ['', 'Referencia 100 %', true]])}
      ${anyRel ? barChart({ labels, ghost: ser.map((p) => p.relPlan), values: ser.map((p) => p.relDone), ref: 100, fmt: fpct, onPick: pick('rel'), sel: s('rel'), label: 'Carga relativa a su típico' })
        : html`<p class="muted">La referencia se arma con algunas semanas de datos. Mientras tanto, mira “Unidades reales”.</p>`}
      <div class="detail-line">${detailRel}</div>
    </div>` : html`<div class="grid2">${METRICS.filter((m) => has(m.key)).map((m) => html`<div class="card">
      <h2>${m.name}</h2>${legend([[GHOST, 'Planificado'], [BLUE, 'Hecho']])}
      ${barChart({ labels, ghost: ser.map((p) => p.plan[m.key]), values: ser.map((p) => p.done[m.key]), fmt: funit(m.key), onPick: pick(m.key), sel: s(m.key), label: m.name })}
      <div class="detail-line">${s(m.key) != null ? labels[s(m.key)] + ': planificado ' + funit(m.key)(ser[s(m.key)].plan[m.key]) + ' · hecho ' + funit(m.key)(ser[s(m.key)].done[m.key]) : 'Toca una barra.'}</div>
    </div>`)}${!['ton', 'thr', 'con', 'met'].some(has) ? html`<div class="card"><p class="muted">Todavía no hay entrenamientos en este período.</p></div>` : nothing}</div>`}

    ${has('thr') && kgKeys.length ? html`<div class="card">
      <h2>Tiros por peso de implemento</h2>
      ${legend(kgKeys.map((k, i) => [SEQ[i % SEQ.length], k === 's/p' ? 'sin peso' : k.replace('.', ',') + ' kg']))}
      ${stackChart({ labels, stacks: kgKeys.map((k) => ({ name: k, values: ser.map((p) => p.done.thrByKg[k] || 0) })), fmt: f0, onPick: pick('kg'), sel: s('kg'), label: 'Tiros por peso de implemento' })}
      <div class="detail-line">${s('kg') != null ? labels[s('kg')] + ': ' + kgKeys.map((k) => (k === 's/p' ? 'sin peso' : k.replace('.', ',') + ' kg') + ' ' + (ser[s('kg')].done.thrByKg[k] || 0)).join(' · ') : 'Toca una barra.'}</div>
    </div>` : nothing}

    <div class="grid2">
      <div class="card">
        <h2>Horas de sueño</h2>${legend([[BLUE, 'Horas (promedio del período)'], ['', 'Su normal' + (hoursRef ? ' (' + f1(hoursRef) + ' h)' : ''), true]])}
        ${ser.some((p) => p.hoursAvg != null) ? lineChart({ labels, values: ser.map((p) => p.hoursAvg), ref: hoursRef, min: 4, max: 10, fmt: (v) => f1(v) + ' h', onPick: pick('sl'), sel: s('sl'), label: 'Horas de sueño' }) : html`<p class="muted">Aún no hay respuestas de bienestar.</p>`}
        <div class="detail-line">${s('sl') != null && ser[s('sl')].hoursAvg != null ? labels[s('sl')] + ': ' + f1(ser[s('sl')].hoursAvg) + ' h · sueño ' + f1(ser[s('sl')].sleepAvg) + '/5 · se siente ' + f1(ser[s('sl')].feelAvg) + '/5' : 'Toca un punto.'}</div>
      </div>
      <div class="card">
        <h2>Qué modifica</h2>
        <p class="muted small">En el período visible. Si sube seguido, el plan quedó corto; si baja seguido, quedó largo.</p>
        <span class="tag">SUBE PESO, REPS O SERIES</span>
        ${mods.up.length ? html`<ul>${mods.up.map(([n, c]) => html`<li class="it"><span class="it-name grow">${n}</span><span class="rv-ok">${c} ${c === 1 ? 'vez' : 'veces'}</span></li>`)}</ul>` : html`<p class="muted small">Nada.</p>`}
        <span class="tag">BAJA O NO COMPLETA</span>
        ${mods.down.length ? html`<ul>${mods.down.map(([n, c]) => html`<li class="it"><span class="it-name grow">${n}</span><span class="rv-mod">${c} ${c === 1 ? 'vez' : 'veces'}</span></li>`)}</ul>` : html`<p class="muted small">Nada.</p>`}
      </div>
    </div>

    <div class="card">
      <h2>Tests y mejoras</h2>
      ${testList.length ? html`<div class="grid2">${testList.map(({ t, pts }) => html`<div>
        <div class="row between"><b>${t.name}</b><span class="small">${t.initial ? 'Inicial ' + f1(t.initial.value) + ' ' + t.unit : ''}${t.current ? ' → actual ' + f1(t.current.value) + ' ' + t.unit : ''}${t.initial && t.current && t.initial.value ? html` <b class=${(t.unit === 's' ? t.current.value <= t.initial.value : t.current.value >= t.initial.value) ? 'rv-ok' : 'rv-mod'}>(${(t.current.value - t.initial.value > 0 ? '+' : '') + f1(t.current.value - t.initial.value)} ${t.unit})</b>` : ''}</span></div>
        ${pts.length > 1 ? lineChart({ labels: pts.map((p) => niceDate(p.date)), values: pts.map((p) => p.value), fmt: (v) => f1(v), label: 'Progreso de ' + t.name }) : html`<p class="muted small">Un solo resultado por ahora.</p>`}
      </div>`)}</div>` : html`<p class="muted small">Sin tests cargados. Se cargan en Revisar → Tests.</p>`}
      ${marks.length ? html`<span class="tag">MEJORES MARCAS ANOTADAS</span><ul>${marks.map((m) => html`<li class="it"><span class="it-name grow">${m.name}</span><span>${f1(m.value)}</span><span class="muted small">${niceDate(m.date)}</span>${m.delta ? html`<span class="rv-ok">+${f1(m.delta)}</span>` : nothing}</li>`)}</ul>` : nothing}
    </div>`;
}


// ---------- microciclo para imprimir ----------
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const kgTxt = (v) => (v == null ? '' : String(v).replace('.', ','));

function printRow(it, g, log) {
  if (it.type === 'note') return { ej: it.text, s: '', r: '', kg: '', pr: '', re: '' };
  let ej = (it.circuit ? it.circuit + ' ' : '') + it.name + (it.holdSec != null && it.type === 'iso' ? ' ' + it.holdSec + '"' : '');
  let sv = it.sets || '', rv = it.reps != null ? it.reps + (it.perSide ? 'e' : '') : (it.qty || ''), kg = it.kgList ? '' : kgTxt(it.kg), pr = it.kgList ? it.kgList.map(kgTxt).join('-') : '';
  if (it.durationSec != null) { rv = Math.round(it.durationSec / 60) + "'"; }
  if (it.type === 'run' && it.run) { ej = it.name; sv = it.run.series > 1 ? it.run.series : ''; rv = it.run.reps; kg = ''; pr = it.plan; }
  if (it.marca) pr = (pr ? pr + ' · ' : '') + 'marca';
  let re = '';
  if (log && log.items) {
    const e = g.kind === 'circuit' ? log.items[g.id] : log.items[it.id];
    const sub = g.kind === 'circuit' && e && e.ex ? e.ex[it.id] : e;
    if (e && e.status === 'hecho') re = '✓' + (sub && sub.mark ? ' ' + sub.mark : '');
    else if (e && e.status === 'no') re = '✕';
    else if (e && e.status === 'mod') re = modSummary(it, sub) + (sub && sub.mark ? ' · marca ' + sub.mark : '');
    else if (sub && sub.mark) re = 'marca ' + sub.mark;
  }
  return { ej, s: sv, r: rv, kg, pr, re };
}

// Tipo de cada día según lo planificado para todos los atletas: gym o pista.
function dayKind(data, date) {
  let gym = 0, pista = 0;
  data.forEach(({ days }) => { const d = days[date]; if (!d) return; d.blocks.forEach((b) => b.items.forEach((it) => { if (it.type === 'gym' || it.type === 'iso') gym++; else if (it.type !== 'note') pista++; })); });
  if (!gym && !pista) return null;
  return gym >= pista ? 'gym' : 'pista';
}

async function buildMicro() {
  const dates = weekDates(C.pm);
  const list = C.athletes.filter((a) => !a.paused);
  const data = await Promise.all(list.map(async (a) => {
    const [days, logs] = await Promise.all([rangeDocs(P.days(uid(), a.id), dates[0], dates[6]), C.printDone ? rangeDocs(P.logs(uid(), a.id), dates[0], dates[6]) : Promise.resolve({})]);
    Object.values(days).forEach(assignIds);
    return { a, days, logs };
  }));
  const sel = [0, 1, 2, 3, 4, 5, 6].filter((i) => { const k = dayKind(data, dates[i]); return k && (C.microMode === 'todo' || C.microMode === k); });
  const blocks = data.map(({ a, days, logs }) => {
    const cols = sel.map((i) => {
      const day = days[dates[i]]; if (!day) return [];
      const rows = [];
      day.blocks.forEach((b) => groupItems(b.items).forEach((g) => (g.kind === 'circuit' ? g.items : [g.item]).forEach((it) => rows.push(printRow(it, g, logs[dates[i]])))));
      return rows;
    });
    return { a, cols, n: Math.max(1, ...cols.map((c) => c.length)), empty: cols.every((c) => !c.length) };
  }).filter((b) => !b.empty);
  const d0 = parseYmd(dates[0]);
  const monday = String(d0.getDate()).padStart(2, '0') + '/' + String(d0.getMonth() + 1).padStart(2, '0') + '/' + d0.getFullYear();
  return { dates, sel, blocks, monday };
}

function microTable(m, days, styled, opt = {}) {
  const od = !!opt.onlyDone;
  const T = (v) => (od ? '' : v);
  const b = styled ? 'border:1px solid #555;' : '';
  const th = (t, extra = '') => `<th style="${b}background:#E8E8E4;font-weight:bold;text-align:center;${extra}">${t}</th>`;
  const head1 = days.map((i) => `<th colspan="6" style="${b}background:#D8D8D2;font-weight:bold;text-align:center">${T(DAY_LONG[i] + ' ' + niceDate(m.dates[i]))}</th>`).join('');
  const head2 = days.map(() => th(T('Ejercicio'), 'text-align:left') + th(T('S')) + th(T('R')) + th(T('KG')) + th(T('Progresiones')) + th(T('Realizado'))).join('');
  let body = '';
  m.blocks.forEach(({ a, cols }) => {
    const pick = days.map((i) => cols[m.sel.indexOf(i)] || []);
    const n = Math.max(1, ...pick.map((c) => c.length));
    if (pick.every((c) => !c.length)) return;
    for (let r = 0; r < n; r++) {
      body += '<tr>' + (r === 0 ? `<td rowspan="${n}" style="${b}text-align:center;vertical-align:middle;font-weight:bold;background:#F4F4F1">${od ? '' : esc(a.name) + '<br><span style="font-weight:normal;font-size:8pt">' + esc(a.group || '') + '</span>'}</td>` : '');
      pick.forEach((c) => { const x = c[r] || {}; body += `<td style="${b}text-align:left">${esc(T(x.ej))}</td><td style="${b}text-align:center">${esc(T(x.s))}</td><td style="${b}text-align:center">${esc(T(x.r))}</td><td style="${b}text-align:center">${esc(T(x.kg))}</td><td style="${b}text-align:left">${esc(T(x.pr))}</td><td style="${b}text-align:left">${esc(x.re)}</td>`; });
      body += '</tr>';
    }
  });
  const span = 1 + days.length * 6;
  return `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:9pt"><thead>
    <tr><th colspan="${span}" style="font-size:12pt;text-align:left;padding:4px 0">${T('Microciclo · Semana ' + m.monday)}</th></tr>
    <tr>${th(T('Nombre'), 'vertical-align:middle')}${head1}</tr><tr>${th('')}${head2}</tr></thead><tbody>${body}</tbody></table>`;
}

function microTsv(m, opt = {}) {
  if (opt.onlyDay != null) {
    const k = m.sel.indexOf(opt.onlyDay);
    const rows = [[''], [''], ['']];
    m.blocks.forEach(({ cols, n }) => { for (let r = 0; r < n; r++) rows.push([(cols[k][r] || {}).re || '']); });
    return rows.map((r) => r.join('')).join('\n');
  }
  const od = !!opt.onlyDone;
  const T = (v) => (od ? '' : v);
  const rows = [[T('Microciclo · Semana ' + m.monday)], [T('Nombre')].concat(...m.sel.map((i) => [T(DAY_LONG[i] + ' ' + niceDate(m.dates[i])), '', '', '', '', ''])), [''].concat(...m.sel.map(() => od ? ['', '', '', '', '', ''] : ['Ejercicio', 'S', 'R', 'KG', 'Progresiones', 'Realizado']))];
  m.blocks.forEach(({ a, cols, n }) => {
    for (let r = 0; r < n; r++) rows.push([r === 0 ? T(a.name) : ''].concat(...cols.map((c) => { const x = c[r] || {}; return [T(x.ej || ''), T(x.s || ''), T(x.r || ''), T(x.kg || ''), T(x.pr || ''), x.re || '']; })));
  });
  return rows.map((r) => r.map((v) => String(v).replace(/[\t\n]/g, ' ')).join('\t')).join('\n');
}

async function microAction(kind, dayIdx) {
  C.busy = true; draw();
  try {
    const keepDone = C.printDone;
    if (kind === 'done' || kind === 'day') C.printDone = true;
    const m = await buildMicro();
    C.printDone = keepDone;
    if (kind === 'day' && !m.sel.includes(dayIdx)) { toast(DAY_LONG[dayIdx] + ' no está en el microciclo (' + (C.microMode === 'todo' ? 'sin entrenamiento' : 'no es día de ' + C.microMode) + ').'); C.busy = false; draw(); return; }
    if (!m.sel.length || !m.blocks.length) { toast(C.microMode === 'todo' ? 'No hay entrenamientos esta semana.' : 'No hay días de ' + C.microMode + ' esta semana.'); C.busy = false; draw(); return; }
    if (kind === 'copy' || kind === 'done' || kind === 'day') {
      const opt = kind === 'done' ? { onlyDone: true } : kind === 'day' ? { onlyDay: dayIdx } : {};
      const htmlStr = '<html><body>' + (kind === 'day' ? microDayTable(m, dayIdx) : microTable(m, m.sel, true, opt)) + '</body></html>';
      const tsv = microTsv(m, opt);
      let ok = false;
      try {
        if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
          await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([htmlStr], { type: 'text/html' }), 'text/plain': new Blob([tsv], { type: 'text/plain' }) })]);
          ok = true;
        }
      } catch (e) { ok = false; }
      if (!ok) { try { await navigator.clipboard.writeText(tsv); ok = true; } catch (e) { ok = false; } }
      const msg = kind === 'done' ? 'Realizado copiado. En Excel: Pegado especial → Saltar blancos, en la misma celda de arriba a la izquierda.' : kind === 'day' ? 'Realizado del ' + DAY_LONG[dayIdx].toLowerCase() + ' copiado. Pégalo en la primera celda de su columna Realizado.' : 'Copiado (' + m.sel.length + (m.sel.length === 1 ? ' día' : ' días') + '). Pégalo en tu Excel en la celda de arriba a la izquierda.';
      toast(ok ? msg : 'Tu navegador no dejó copiar. Usa “Imprimir o PDF”.');
    } else {
      const chunks = []; for (let i = 0; i < m.sel.length; i += 3) chunks.push(m.sel.slice(i, i + 3));
      const doc = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Microciclo ${m.monday}</title><style>@page{size:A4 landscape;margin:8mm}body{margin:0}table{width:100%;margin-bottom:6mm}tr{page-break-inside:avoid}.pb{page-break-after:always}.bar{padding:8px;font-family:Arial;background:#FFF1E8;border-bottom:1px solid #C2410C}@media print{.bar{display:none}}</style></head><body><div class="bar">Usa <b>Imprimir</b> y elige <b>Guardar como PDF</b> para tener el archivo. <button onclick="window.print()">Imprimir</button></div>${chunks.map((ch) => microTable(m, ch, true)).join('<div class="pb"></div>')}<script>setTimeout(function(){window.print()},400)<\/script></body></html>`;
      const w = window.open('', '_blank');
      if (!w) toast('Permite las ventanas emergentes para abrir el microciclo.');
      else { w.document.open(); w.document.write(doc); w.document.close(); }
    }
  } catch (e) { console.error(e); toast('No se pudo armar el microciclo: ' + e.message); }
  C.busy = false; draw();
}


// Una sola columna con lo realizado de un día, alineada con las filas del microciclo (3 filas de título + filas por atleta).
function microDayTable(m, dayIdx) {
  const k = m.sel.indexOf(dayIdx);
  let rows = '<tr><td></td></tr><tr><td></td></tr><tr><td></td></tr>';
  m.blocks.forEach(({ cols, n }) => { for (let r = 0; r < n; r++) rows += `<tr><td>${esc((cols[k][r] || {}).re || '')}</td></tr>`; });
  return `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:9pt">${rows}</table>`;
}
