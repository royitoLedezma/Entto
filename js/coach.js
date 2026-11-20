// App del entrenador: atletas, planificar (pegar texto), ejercicios, revisar, tests, Excel y entrenadores (admin).
import { html, render, nothing } from './vendor/lit-html/lit-html.js';
import { live } from './vendor/lit-html/directives/live.js';
import {
  auth, A, F, P, ADMIN, AppMod, firebaseConfig, getDoc, getDocs, setDoc, deleteDoc, writeBatch, fs,
  rangeDocs, mondayOf, weekDates, addDays, ymd, parseYmd, DAY_LONG, DAY_SHORT, niceDate, randomToken, norm
} from './db.js';
import { parsePlan, planText, metricsOf } from './parser.js';
import { assignIds, groupItems, modSummary, dayMetrics, detailRows, intensityText, testKey, TYPES, GROUPS } from './model.js';

const TAGS = { gym: 'Gym', run: 'Carrera', iso: 'Isom.', throw: 'Lanz.', jump: 'Salto', note: 'Nota' };
const ST = { hecho: '✓ Hecho', mod: '✎ Modificado', no: '✕ No lo hizo' };

const C = {
  root: null, user: null, profile: null, isAdmin: false, ready: false, loginErr: '', loginMode: 'login', busy: false,
  tab: 'atletas', athletes: [], exercises: {}, toast: '',
  // planificar
  pm: mondayOf(addDays(new Date(), [0, 6].includes(new Date().getDay()) ? 2 : 0)), text: '', targetDate: ymd(new Date()), parsed: null, mapping: {}, types: {},
  gridAid: null, grid: {}, editing: null, editText: '',
  // revisar
  ra: null, rm: mondayOf(new Date()), rDays: {}, rLogs: {}, rTests: {}, newTest: { name: '', unit: 'kg' }, newRes: {},
  // excel
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
  C.ra = aid; C.tab = 'revisar'; draw();
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
      <textarea class="big" placeholder=${'Jhon\nCalentamiento\nInclinación → 3x8 @7 kg\nPrincipal\nArranque → 3x6 @18 kg\nA HBDL → 4x12 @50 kg\nA Press de hombro → 4x10 @14 kg\n4x2x200 ritmo 35\'\' r30\'\' R1\'\n💡 Prioridad: técnica'} .value=${live(C.text)} @input=${(e) => { C.text = e.target.value; }}></textarea>
      <div class="row wrap-row">
        <label class="small">Día si no lo indica: <select class="inp" @change=${(e) => { C.targetDate = e.target.value; }}>${dates.map((d, i) => html`<option value=${d} ?selected=${C.targetDate === d}>${DAY_LONG[i]} ${niceDate(d)}</option>`)}</select></label>
        <button class="btn main" @click=${convert}>Convertir</button>
      </div>
    </div>
    ${C.parsed ? previewView(dates) : nothing}
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
  return html`
    <button class="link" @click=${() => { C.tab = 'atletas'; draw(); }}>‹ Atletas</button>
    <h2 class="big">${a.name} <span class="muted small">${a.group || ''}</span></h2>
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
    <p class="muted small">Pásale el correo y la contraseña. Puede cambiarla con “Olvidé mi contraseña”.</p>
  </div>
  <div class="card"><h2>Entrenadores</h2>
    <table class="tbl"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th></tr></thead><tbody>
      ${C.users.map((u) => html`<tr><td>${u.name}</td><td>${u.email}</td><td>${u.role === 'admin' ? 'Administrador' : 'Entrenador'}</td></tr>`)}
    </tbody></table></div>`;
}
