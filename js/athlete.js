// App del atleta: entra por su enlace, ve su sesión y anota.
import { html, render, nothing } from './vendor/lit-html/lit-html.js';
import { live } from './vendor/lit-html/directives/live.js';
import { auth, A, P, F, getDoc, getDocs, setDoc, getMany, mondayOf, weekDates, addDays, ymd, parseYmd, DAY_LONG, DAY_SHORT, niceDate } from './db.js';
import { assignIds, groupItems, fmtTyped, secsOf, plannedSets, modSummary, intensityText, totalReps, testKey } from './model.js';
import { clock } from './parser.js';

const LABELS = ['Muy mal', 'Mal', 'Normal', 'Bien', 'Muy bien'];
const TAGS = { gym: 'GYM', run: 'CARRERA', iso: 'ISOMÉTRICO', throw: 'LANZAMIENTO', jump: 'SALTO', note: 'NOTA' };

const S = {
  root: null, token: null, cid: null, aid: null, name: '',
  monday: mondayOf(new Date()), dates: [], days: [], logs: {}, tests: {},
  view: 'hoy', dayIdx: (new Date().getDay() + 6) % 7, open: {}, error: '', loading: true, online: navigator.onLine, saving: false
};
const timers = {};

function draw() { render(view(), S.root); }

// ---------- carga ----------
export async function startAthlete(root, token) {
  S.root = root; S.token = token; draw();
  window.addEventListener('online', () => { S.online = true; draw(); });
  window.addEventListener('offline', () => { S.online = false; draw(); });
  try {
    if (!auth.currentUser) await A.signInAnonymously(auth);
    const uid = auth.currentUser.uid;
    let link = null;
    try { const ls = await getDoc(P.link(uid)); if (ls.exists()) link = ls.data(); } catch (e) { /* sin vínculo aún */ }
    if (!link || link.token !== token) {
      const acc = await getDoc(P.access(token));
      if (!acc.exists()) { S.error = 'Este enlace ya no funciona. Pídele uno nuevo a tu entrenador.'; S.loading = false; return draw(); }
      link = { token, coachId: acc.data().coachId, athleteId: acc.data().athleteId };
      await setDoc(P.link(uid), Object.assign({ at: F.serverTimestamp() }, link));
    }
    S.cid = link.coachId; S.aid = link.athleteId;
    const as = await getDoc(P.athlete(S.cid, S.aid));
    if (!as.exists()) { S.error = 'No encontramos tu ficha. Pídele un enlace nuevo a tu entrenador.'; S.loading = false; return draw(); }
    S.name = as.data().name || '';
    try { const ts = await getDocs(P.tests(S.cid, S.aid)); ts.forEach((d) => { S.tests[d.id] = d.data(); }); } catch (e) { /* sin tests */ }
    await loadWeek();
  } catch (e) {
    console.error(e);
    S.error = navigator.onLine ? 'No pudimos abrir tu enlace. Revisa que esté completo o pide uno nuevo.' : 'Para la primera vez necesitas internet. Después funciona sin conexión.';
  }
  S.loading = false; draw();
}

async function loadWeek() {
  S.dates = weekDates(S.monday);
  const days = await getMany(S.dates.map((d) => P.day(S.cid, S.aid, d)));
  const logs = await getMany(S.dates.map((d) => P.log(S.cid, S.aid, d)));
  S.days = days.map((d) => (d ? assignIds(d) : null));
  S.logs = {};
  S.dates.forEach((d, i) => { S.logs[d] = logs[i] || { items: {} }; if (!S.logs[d].items) S.logs[d].items = {}; });
}

async function goWeek(delta) {
  S.monday = addDays(S.monday, 7 * delta); S.loading = true; draw();
  await loadWeek(); S.loading = false; draw();
}

// ---------- guardar ----------
function save(date) {
  const log = S.logs[date];
  log.updatedAt = Date.now(); log.by = 'athlete';
  S.saving = true;
  clearTimeout(timers[date]);
  timers[date] = setTimeout(async () => {
    try { await setDoc(P.log(S.cid, S.aid, date), JSON.parse(JSON.stringify(log))); } catch (e) { console.error(e); }
    S.saving = false; draw();
  }, 500);
  draw();
}

const curDate = () => S.dates[S.dayIdx];
const curLog = () => S.logs[curDate()];
const entry = (id) => curLog().items[id];
function setEntry(id, patch) { const l = curLog(); l.items[id] = Object.assign({}, l.items[id] || {}, patch); save(curDate()); }

// ---------- acciones ----------
function markDone(id) { const e = entry(id); setEntry(id, { status: e && e.status === 'hecho' ? null : 'hecho' }); S.open[id] = false; }
function markNo(id) { const e = entry(id); setEntry(id, { status: e && e.status === 'no' ? null : 'no' }); S.open[id] = false; }
function markMod(it, id) {
  const e = entry(id) || {};
  if (e.status === 'mod') { S.open[id] = !S.open[id]; draw(); return; }
  const patch = { status: 'mod' };
  if (it.kind === 'circuit') {
    const ex = Object.assign({}, e.ex || {});
    it.items.forEach((x) => { if (!ex[x.id]) ex[x.id] = { sets: plannedSets(x) }; });
    patch.ex = ex;
  } else if (it.type === 'gym' || it.type === 'iso') { if (!e.sets) patch.sets = plannedSets(it); }
  else if (it.type === 'run') { if (!e.times) patch.times = Array.from({ length: totalReps(it) }, () => ''); }
  else if (it.type === 'throw') { if (e.qty == null) patch.qty = String(it.qty || (it.sets && it.reps ? it.sets * it.reps : it.sets || '')); if (e.impl == null) patch.impl = it.kg != null ? String(it.kg).replace('.', ',') + ' kg' : ''; }
  else if (it.type === 'jump') { if (e.qty == null) patch.qty = String(it.qty || (it.sets && it.reps ? it.sets * it.reps : it.sets || '')); }
  S.open[id] = true;
  setEntry(id, patch);
}
function allDone(block) {
  const groups = groupItems(block.items).filter((g) => !(g.kind === 'single' && g.item.type === 'note'));
  const all = groups.every((g) => (entry(g.id) || {}).status === 'hecho');
  groups.forEach((g) => {
    const e = entry(g.id) || {};
    if (all) { if (e.status === 'hecho') curLog().items[g.id] = Object.assign({}, e, { status: null }); }
    else if (!e.status) curLog().items[g.id] = Object.assign({}, e, { status: 'hecho' });
  });
  save(curDate());
}
function setWell(patch) { const l = curLog(); l.wellness = Object.assign({ sleep: null, hours: 7, feel: null, done: false }, l.wellness || {}, patch); save(curDate()); }

// ---------- vistas ----------
function view() {
  if (S.error) return html`<div class="app athlete"><div class="hd"><h1>Entto</h1></div><div class="scroll"><div class="card"><p>${S.error}</p></div></div></div>`;
  if (S.loading && !S.dates.length) return html`<div class="app athlete"><div class="hd"><h1>Entto</h1></div><div class="scroll"><p class="muted center">Cargando tu entrenamiento…</p></div></div>`;
  const week = S.view === 'semana';
  const day = S.days[S.dayIdx];
  const isToday = curDate() === ymd(new Date());
  return html`<div class="app athlete">
    <div class="hd">
      <div class="hd-top"><span class="sub">Hola, ${S.name}</span>${!S.online ? html`<span class="chip chip-off">Sin conexión · se guarda en tu celular</span>` : nothing}</div>
      <h1>${week ? 'Tu semana' : (isToday ? 'Hoy' : DAY_LONG[S.dayIdx]) + (day && day.title ? ' · ' + day.title : '')}</h1>
      <div class="seg">
        <button class=${week ? '' : 'on'} @click=${() => { S.view = 'hoy'; draw(); }}>Día</button>
        <button class=${week ? 'on' : ''} @click=${() => { S.view = 'semana'; draw(); }}>Ver semana</button>
      </div>
    </div>
    <div class="scroll">${week ? weekView() : dayView(day)}</div>
  </div>`;
}

function weekView() {
  const today = ymd(new Date());
  return html`
    <div class="dayhd">
      <button class="icon" aria-label="Semana anterior" @click=${() => goWeek(-1)}>‹</button>
      <h2>Semana del ${niceDate(S.dates[0])}</h2>
      <button class="icon" aria-label="Semana siguiente" @click=${() => goWeek(1)}>›</button>
    </div>
    ${S.dates.map((d, i) => {
      const day = S.days[i];
      const n = day ? countItems(day) : 0;
      const c = day ? countMarked(day, S.logs[d]) : 0;
      let st = 'Descanso', cls = 'chip';
      if (n) { if (c === n) { st = 'Hecho'; cls = 'chip chip-done'; } else if (d === today) { st = c ? 'Hoy · ' + c + ' de ' + n : 'Hoy'; cls = 'chip chip-today'; } else if (c) { st = c + ' de ' + n; cls = 'chip chip-part'; } else st = 'Pendiente'; }
      return html`<button class="wk ${d === today ? 'wk-today' : ''} ${!n ? 'wk-rest' : ''}" @click=${() => { S.dayIdx = i; S.view = 'hoy'; draw(); }}>
        <span class="col"><span class="wk-d">${DAY_LONG[i]} ${parseYmd(d).getDate()}</span><span class="wk-t">${n ? n + ' ejercicios' : 'Sin entrenamiento'}</span></span>
        <span class=${cls}>${st}</span></button>`;
    })}`;
}

function countItems(day) { let n = 0; day.blocks.forEach((b) => groupItems(b.items).forEach((g) => { if (!(g.kind === 'single' && g.item.type === 'note')) n++; })); return n; }
function countMarked(day, log) { let n = 0; day.blocks.forEach((b) => groupItems(b.items).forEach((g) => { const e = log && log.items[g.id]; if (e && e.status) n++; })); return n; }

function dayView(day) {
  const d = curDate();
  const head = html`<div class="dayhd">
    <button class="icon" aria-label="Día anterior" @click=${() => { if (S.dayIdx > 0) { S.dayIdx--; draw(); } else { S.dayIdx = 6; goWeek(-1); } }}>‹</button>
    <div class="col center"><h2>${DAY_LONG[S.dayIdx]} ${niceDate(d)}</h2>${day ? html`<span class="muted small">${countMarked(day, S.logs[d])} de ${countItems(day)} anotados</span>` : nothing}</div>
    <button class="icon" aria-label="Día siguiente" @click=${() => { if (S.dayIdx < 6) { S.dayIdx++; draw(); } else { S.dayIdx = 0; goWeek(1); } }}>›</button>
  </div>`;
  if (!day) return html`${head}<div class="rest">${S.loading ? 'Cargando…' : 'Sin entrenamiento publicado para este día.'}</div>`;
  const log = S.logs[d];
  const w = log.wellness || { sleep: null, hours: 7, feel: null, done: false };
  const canStart = w.sleep && w.feel;
  return html`${head}
    ${!w.done ? html`<div class="card">
      <span class="tag">ANTES DE EMPEZAR</span>
      <p class="q">¿Cómo dormiste?</p>
      <div class="scale">${LABELS.map((l, k) => html`<button class="sc ${w.sleep === k + 1 ? 'sc-on' : ''}" @click=${() => setWell({ sleep: k + 1 })}><b>${k + 1}</b><span>${l}</span></button>`)}</div>
      <div class="row"><span class="lbl">Horas</span>
        <button class="stp" aria-label="Media hora menos" @click=${() => setWell({ hours: Math.max(0, (w.hours || 7) - 0.5) })}>−</button>
        <b class="hours">${String(w.hours || 7).replace('.', ',')} h</b>
        <button class="stp" aria-label="Media hora más" @click=${() => setWell({ hours: Math.min(14, (w.hours || 7) + 0.5) })}>+</button></div>
      <p class="q">¿Cómo te sientes hoy?</p>
      <div class="scale">${LABELS.map((l, k) => html`<button class="sc ${w.feel === k + 1 ? 'sc-on' : ''}" @click=${() => setWell({ feel: k + 1 })}><b>${k + 1}</b><span>${l}</span></button>`)}</div>
      <button class=${canStart ? 'btn-start' : 'btn-start off'} @click=${() => canStart && setWell({ done: true })}>${canStart ? 'Listo, a entrenar' : 'Responde las dos preguntas'}</button>
    </div>` : html`<div class="wbsum"><span>Dormiste ${LABELS[w.sleep - 1].toLowerCase()} (${String(w.hours).replace('.', ',')} h) · Te sientes ${LABELS[w.feel - 1].toLowerCase()}</span><button class="link" @click=${() => setWell({ done: false })}>Cambiar</button></div>`}
    ${day.prio ? html`<div class="prio"><b>Prioridad:</b> ${day.prio}</div>` : nothing}
    ${day.blocks.map((b) => blockView(b))}
    <div class="card">
      <label class="q" for="coment">Comentario para tu entrenador (opcional)</label>
      <textarea id="coment" placeholder="Ej.: dormí mal, me molestó la rodilla…" .value=${live(log.comment || '')} @input=${(e) => { log.comment = e.target.value; save(d); }}></textarea>
    </div>
    ${log.finished ? html`<div class="banner">Sesión terminada. ${S.online ? 'Ya le llegó a tu entrenador.' : 'Se enviará apenas tengas internet.'} Puedes seguir corrigiendo.</div>`
      : html`<button class="btn-main" @click=${() => { log.finished = true; log.finishedAt = Date.now(); save(d); }}>Terminar sesión</button>`}
    <p class="muted small center">${S.saving ? 'Guardando…' : 'Todo guardado'}</p>`;
}

function blockView(b) {
  const groups = groupItems(b.items);
  const quick = b.name === 'Calentamiento' || b.name === 'Vuelta a la calma';
  const counted = groups.filter((g) => !(g.kind === 'single' && g.item.type === 'note'));
  const all = counted.length && counted.every((g) => (entry(g.id) || {}).status === 'hecho');
  return html`<div class="bhd"><span class="bname">${b.name}</span>
      ${quick && counted.length ? html`<button class="ball ${all ? 'on' : ''}" @click=${() => allDone(b)}>${all ? '✓ Todo hecho' : 'Todo hecho'}</button>` : nothing}</div>
    ${groups.map((g) => (g.kind === 'circuit' ? circuitCard(g) : itemCard(g.item)))}`;
}

function actions(it, id, canMod = true) {
  const e = entry(id) || {};
  return html`<div class="acts ${canMod ? '' : 'acts2'}">
    <button class="btn ${e.status === 'hecho' ? 'done-on' : 'done'}" @click=${() => markDone(id)}>${e.status === 'hecho' ? '✓ Hecho' : 'Hecho'}</button>
    ${canMod ? html`<button class="btn ${e.status === 'mod' ? 'mod-on' : 'mod'}" @click=${() => markMod(it, id)}>${e.status === 'mod' ? '✓ Modificado' : 'Modificar'}</button>` : nothing}
    <button class="btn ${e.status === 'no' ? 'no-on' : 'ghost'}" @click=${() => markNo(id)}>No lo hice</button>
  </div>`;
}

function cardCls(e) { return 'card' + (e && e.status === 'hecho' ? ' card-done' : e && e.status === 'mod' ? ' card-mod' : e && e.status === 'no' ? ' card-no' : ''); }

function itemCard(it) {
  if (it.type === 'note') return html`<div class="card note"><span class="tag">NOTA</span><p>${it.text}</p></div>`;
  const id = it.id;
  const e = entry(id);
  const isMod = e && e.status === 'mod';
  const open = isMod && S.open[id];
  const inten = intensityText(it, S.tests);
  const runAlways = it.type === 'run' && it.marca && !it.run.targetSec;
  const canMod = it.type !== 'iso' && !runAlways;
  return html`<div class=${cardCls(e)}>
    <div class="col">
      <span class="tag">${TAGS[it.type]}</span>
      <p class="exname">${it.name}</p>
      <span class="plan">${it.plan}${it.run && it.run.restRep == null && it.rest ? ' · desc. ' + it.rest : ''}</span>
      ${inten ? html`<span class="inten">${inten}</span>` : nothing}
      ${it.type === 'run' && it.run.splits && it.run.splits.length ? html`<div class="splits">${it.run.splits.map((s) => html`<span class="sp">${s.label}</span>`)}</div>` : nothing}
      ${isMod && !open ? html`<span class="modtxt">Modificado: ${modSummary(it, e)}</span>` : nothing}
      ${e && e.status === 'no' ? html`<span class="notxt">No lo hizo</span>` : nothing}
    </div>
    ${it.marca && it.type !== 'run' && !(e && e.status === 'no') ? html`<div class="row"><span class="lbl">Marca</span>
      <input class="num wide" type="text" inputmode="decimal" placeholder=${it.type === 'throw' ? 'metros' : 'm o cm'} aria-label="Marca" .value=${live((e && e.mark) || '')} @input=${(ev) => setEntry(id, { mark: ev.target.value })}></div>` : nothing}
    ${runAlways ? runGrid(it, id) : nothing}
    ${actions(it, id, canMod)}
    ${open ? html`<div class="detail">${detail(it, id)}<button class="link" @click=${() => { S.open[id] = false; draw(); }}>Listo</button></div>` : nothing}
  </div>`;
}

function setsEditor(sets, onChange) {
  return html`${sets.map((s, k) => html`<div class="row">
      <span class="lbl">Serie ${k + 1}</span>
      <input class="num" type="text" inputmode="decimal" aria-label="Kilos" placeholder="kg" .value=${live(s.kg)} @input=${(ev) => { const n = sets.slice(); n[k] = Object.assign({}, s, { kg: ev.target.value.replace(/[^0-9.,]/g, '') }); onChange(n); }}>
      <span class="unit">kg ×</span>
      <input class="num sm" type="text" inputmode="numeric" aria-label="Repeticiones" .value=${live(s.reps)} @input=${(ev) => { const n = sets.slice(); n[k] = Object.assign({}, s, { reps: ev.target.value.replace(/\D/g, '') }); onChange(n); }}>
      <button class="icon x" aria-label="Quitar serie" @click=${() => onChange(sets.filter((_, j) => j !== k))}>✕</button>
    </div>`)}
    <button class="link" @click=${() => { const last = sets[sets.length - 1] || { kg: '', reps: '' }; onChange(sets.concat([Object.assign({}, last)])); }}>+ Añadir serie</button>`;
}

function runGrid(it, id) {
  const e = entry(id) || {};
  const times = e.times || Array.from({ length: totalReps(it) }, () => '');
  const per = it.run.series > 1 ? it.run.reps : 1;
  const cols = Math.ceil(times.length / per);
  const target = it.run.targetSec;
  return html`<div class="tgrid tg${Math.min(6, cols)}">
    ${Array.from({ length: cols }, (_, c) => html`<div class="tcol">
      <span class="tcol-h">${it.run.series > 1 ? 'Serie ' + (c + 1) : 'Rep. ' + (c + 1)}</span>
      ${times.slice(c * per, c * per + per).map((t, r) => {
        const j = c * per + r;
        const v = secsOf(t);
        const d = v != null && target ? v - target : null;
        return html`<div class="tcell">
          <input class="num tin" type="text" inputmode="numeric" placeholder=${target ? clock(target, 2) : '0.00'} aria-label=${'Tiempo ' + (j + 1)} .value=${live(t)}
            @input=${(ev) => { const n = (entry(id) && entry(id).times ? entry(id).times : times).slice(); n[j] = fmtTyped(ev.target.value); setEntry(id, { times: n }); }}>
          ${d != null ? html`<span class="delta ${d <= 0 ? 'good' : 'bad'}">${(d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d).toFixed(2)}</span>` : nothing}
        </div>`;
      })}
    </div>`)}
  </div>`;
}

function detail(it, id) {
  const e = entry(id) || {};
  if (it.type === 'gym' || it.type === 'iso') return setsEditor(e.sets || [], (n) => setEntry(id, { sets: n }));
  if (it.type === 'run') return runGrid(it, id);
  if (it.type === 'throw') return html`<div class="row"><span class="lbl">Tiros</span>
      <input class="num sm" type="text" inputmode="numeric" aria-label="Cantidad de tiros" .value=${live(e.qty || '')} @input=${(ev) => setEntry(id, { qty: ev.target.value.replace(/\D/g, '') })}>
      <span class="lbl">Implemento</span>
      <input class="num" type="text" aria-label="Peso del implemento" .value=${live(e.impl || '')} @input=${(ev) => setEntry(id, { impl: ev.target.value })}></div>`;
  if (it.type === 'jump') return html`<div class="row"><span class="lbl">Saltos</span>
      <input class="num sm" type="text" inputmode="numeric" aria-label="Cantidad de saltos" .value=${live(e.qty || '')} @input=${(ev) => setEntry(id, { qty: ev.target.value.replace(/\D/g, '') })}></div>`;
  return nothing;
}

function circuitCard(g) {
  const id = g.id;
  const e = entry(id);
  const isMod = e && e.status === 'mod';
  const open = isMod && S.open[id];
  return html`<div class=${cardCls(e)}>
    <div class="col">
      <span class="tag">CIRCUITO ${g.letter}</span>
      <p class="exname">${g.items.length} ejercicios alternados</p>
      ${!open ? html`<div class="clist">${g.items.map((x, j) => html`<div class="crow"><span class="ccode">${g.letter}${j + 1}</span><span class="cname">${x.name}</span><span class="cplan">${x.plan}</span></div>`)}</div>` : nothing}
      ${isMod && !open ? html`<span class="modtxt">Modificado: ${g.items.map((x) => x.name + ' ' + modSummary(x, (e.ex || {})[x.id])).join(' / ')}</span>` : nothing}
      ${e && e.status === 'no' ? html`<span class="notxt">No lo hizo</span>` : nothing}
    </div>
    ${actions(g, id, true)}
    ${open ? html`<div class="detail">
      ${g.items.map((x, j) => html`<div class="ci"><span class="ci-name">${g.letter}${j + 1} · ${x.name}</span>
        ${setsEditor(((e.ex || {})[x.id] || { sets: [] }).sets, (n) => { const ex = Object.assign({}, entry(id).ex || {}); ex[x.id] = { sets: n }; setEntry(id, { ex }); })}</div>`)}
      <button class="link" @click=${() => { S.open[id] = false; draw(); }}>Listo</button></div>` : nothing}
  </div>`;
}
