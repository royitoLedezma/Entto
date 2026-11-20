// Lector del texto del entrenador.
// Convierte el formato de WhatsApp en sesiones estructuradas.
// Funciona igual en el navegador y en Node (sin dependencias).

const DAY_NAMES = {
  lunes: 0, martes: 1, miercoles: 2, 'miércoles': 2, jueves: 3, viernes: 4, sabado: 5, 'sábado': 5, domingo: 6
};

const BLOCK_MAP = [
  [/^(calentamiento|activaci[oó]n|entrada en calor)$/i, 'Calentamiento'],
  [/^(vuelta a la calma|enfriamiento|regenerativo|recuperaci[oó]n activa)$/i, 'Vuelta a la calma'],
  [/^(principal|potencia|fuerza|pista|velocidad|resistencia|lanzamientos?|saltos?|t[eé]cnica|core|metab[oó]lico|estructural|pliometr[ií]a|multisaltos|multilanzamientos)$/i, 'Principal']
];

const THROW_RE = /(bala|martillo|disco|jabalina|lanzamiento|bal[oó]n medicinal|multilanzamiento)/i;
const JUMP_RE = /(salto|rebote|caj[oó]n|valla|pliom|cmj|abalakov|triple|multisalto|skipping|pogo)/i;
const GYM_FIRST_RE = /(subida|step ?up|sentadilla|peso muerto|press|remo|jal[oó]n)/i;
const TIME_RE = /(aer[oó]bic|trote|movilidad|estiramiento|flexibilidad|abc|calentar|calentamiento|elongaci[oó]n|rodillo|foam)/i;

// ---------- utilidades de tiempo ----------

// Convierte textos como 35'' · 35" · 35” · 1:30 · 1'30'' · 4min · 4' · 1:05.3 a segundos.
export function parseTime(str) {
  if (str == null) return null;
  let s = String(str).trim().replace(/[“”″]/g, '"').replace(/’|′/g, "'").replace(/''/g, '"').replace(',', '.');
  let m;
  if ((m = s.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = s.match(/^(\d+)'\s*(\d+(?:\.\d+)?)"?$/))) return Number(m[1]) * 60 + Number(m[2]);
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:min|')$/i))) return Number(m[1]) * 60;
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:"|s|seg|segundos)?$/i))) return Number(m[1]);
  return null;
}

// Formatea segundos: 37.9 · 1:15.8 · 4:01.6
export function clock(sec, decimals = 1) {
  if (sec == null || isNaN(sec)) return '';
  const f = Math.pow(10, decimals);
  const t = Math.round(sec * f) / f;
  if (t < 60) return t.toFixed(decimals);
  const m = Math.floor(t / 60);
  const r = t - m * 60;
  const rs = r.toFixed(decimals).padStart(decimals ? decimals + 3 : 2, '0');
  return m + ':' + rs;
}

// Tiempo corto como lo escribe el entrenador: 35'' · 1' · 1'30''
export function short(sec) {
  if (sec == null) return '';
  if (sec < 60) return (Number.isInteger(sec) ? sec : sec.toFixed(1)) + "''";
  const m = Math.floor(sec / 60), r = Math.round((sec - m * 60) * 10) / 10;
  return m + "'" + (r ? (Number.isInteger(r) ? r : r.toFixed(1)) + "''" : '');
}

// Parciales a ritmo parejo: el 200 y luego cada 400 antes de la llegada.
export function evenSplits(meters, totalSec) {
  if (!meters || !totalSec || meters < 300) return [];
  const pts = [200];
  for (let d = 400; d < meters; d += 400) pts.push(d);
  return pts.filter((d) => d < meters).map((d) => ({ at: d, sec: totalSec * d / meters, label: (d / 100) + ' a ' + clock(totalSec * d / meters) }));
}

// "2 a 28.5 · 4 a 59" → parciales escritos por el entrenador
function parseCustomSplits(txt) {
  const out = [];
  txt.split(/[·,;|]/).forEach((part) => {
    const m = part.trim().match(/^(\d+(?:[.,]\d+)?)\s*a\s*(.+)$/i);
    if (!m) return;
    let at = Number(m[1].replace(',', '.'));
    if (at < 50) at = at * 100; // "2" = 200 m
    const sec = parseTime(m[2]);
    if (sec != null) out.push({ at, sec, label: (at / 100) + ' a ' + clock(sec) });
  });
  return out;
}

// ---------- limpieza de líneas ----------

function clean(line) {
  return line
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, '') // emoji
    .replace(/^\s*[*•\-–]\s+/, '') // viñetas
    .replace(/\s+/g, ' ')
    .trim();
}

function norm(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function blockOf(line) {
  const t = line.replace(/:$/, '').trim();
  for (const [re, name] of BLOCK_MAP) if (re.test(t)) return name;
  return null;
}

function dayOf(line) {
  const t = norm(line.replace(/:$/, ''));
  const first = t.split(/\s+/)[0];
  if (first in DAY_NAMES && t.split(/\s+/).length <= 3) return DAY_NAMES[first];
  return null;
}

// ---------- carreras ----------

// Detecta y lee una carrera: "4x2x200 ritmo 35'' r30'' R1'", "3x1000 a 4min/km", "6x30", "600 a 1:30 [2 a 28.5]", "200 m → 4 @28.00"
function parseRun(text) {
  let s = text.replace(/[“”″]/g, '"').replace(/''/g, '"').replace(/’|′/g, "'");
  let series = 1, reps = 1, meters = null, m;

  // forma con flecha: "200 m → 4 @28.00"
  if ((m = s.match(/^(\d{2,5})\s*m?\s*(?:→|->)\s*(\d+)(?:\s*[x×]\s*(\d+))?\s*(.*)$/i))) {
    meters = Number(m[1]);
    if (m[3]) { series = Number(m[2]); reps = Number(m[3]); } else reps = Number(m[2]);
    s = m[4] || '';
  } else if ((m = s.match(/^(\d+)\s*[x×]\s*(\d+)\s*[x×]\s*(\d{2,5})\s*m?\b(.*)$/i))) {
    series = Number(m[1]); reps = Number(m[2]); meters = Number(m[3]); s = m[4];
  } else if ((m = s.match(/^(\d+)\s*[x×]\s*(\d{2,5})\s*m?\b(.*)$/i)) && Number(m[2]) >= 20) {
    reps = Number(m[1]); meters = Number(m[2]); s = m[3];
  } else if ((m = s.match(/^(\d{2,5})\s*m?\s+(?=a\s|ritmo\s|en\s)(.*)$/i)) && Number(m[1]) >= 20) {
    meters = Number(m[1]); s = m[2];
  } else {
    return null;
  }

  const run = { series, reps, meters, targetSec: null, paceText: '', splits: [], customSplits: false, restRep: null, restSet: null };

  // parciales escritos
  const br = s.match(/\[([^\]]+)\]/);
  if (br) { run.splits = parseCustomSplits(br[1]); run.customSplits = run.splits.length > 0; s = s.replace(br[0], ' '); }

  // pausas: r30" (entre reps) y R1' (entre series)
  const rr = s.match(/(?:^|\s)r\s*(\d+(?:[.,]\d+)?\s*(?:"|'|s|min)?)/);
  if (rr) { run.restRep = parseTime(rr[1]); s = s.replace(rr[0], ' '); }
  const rs = s.match(/(?:^|\s)R\s*(\d+(?:[.,]\d+)?\s*(?:"|'|s|min)?)/);
  if (rs) { run.restSet = parseTime(rs[1]); s = s.replace(rs[0], ' '); }

  // ritmo
  let pm;
  if ((pm = s.match(/(\d+(?:[.,]\d+)?)\s*km\/h/i))) {
    const v = Number(pm[1].replace(',', '.'));
    run.targetSec = 3600 / v * meters / 1000;
    run.paceText = 'a ' + pm[1] + ' km/h';
  } else if ((pm = s.match(/(?:ritmo|a|en)\s+([\d:'".,]+\s*(?:min)?)\s*\/\s*(km|\d{2,4})/i))) {
    const per = pm[2].toLowerCase() === 'km' ? 1000 : Number(pm[2]);
    const t = parseTime(pm[1]);
    if (t != null) { run.targetSec = t * meters / per; run.paceText = 'a ' + pm[1].trim() + '/' + pm[2]; }
  } else if ((pm = s.match(/(?:ritmo|a|en|@)\s*([\d:'".,]+)/i))) {
    const t = parseTime(pm[1]);
    if (t != null) { run.targetSec = t; run.paceText = 'ritmo ' + (t < 60 ? short(t) : clock(t)); }
  }

  if (!run.customSplits && run.targetSec) run.splits = evenSplits(meters, run.targetSec);
  return run;
}

// ---------- ejercicio con flecha ----------

function parseArrow(left, right) {
  const item = { name: '', circuit: null, sets: null, reps: null, kg: null, holdSec: null, qty: null };
  let name = left.trim();

  // letra de circuito: "A HBDL" o "A1 HBDL"
  const cm = name.match(/^([A-Z])\d?\s+(.+)$/);
  if (cm && !/^[A-Z]{2,}/.test(name)) { item.circuit = cm[1]; name = cm[2]; }

  // duración en el nombre: "Cuádriceps 45”"
  const hm = name.match(/\s(\d+(?:[.,]\d+)?)\s*(?:”|"|''|″|s)\s*$/);
  if (hm) { item.holdSec = Number(hm[1].replace(',', '.')); name = name.slice(0, hm.index).trim(); }
  item.name = name;

  let r = right.replace(/[“”″]/g, '"').replace(/''/g, '"');
  let m;
  if ((m = r.match(/(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(?:'|min\b)/i))) { item.sets = Number(m[1]); item.durationSec = Number(m[2].replace(',', '.')) * 60; }
  else if ((m = r.match(/(\d+)\s*[x×]\s*(\d+)(e\b)?/i))) { item.sets = Number(m[1]); item.reps = Number(m[2]); if (m[3]) item.perSide = true; }
  else if ((m = r.match(/^\s*(\d+(?:[.,]\d+)?)\s*(?:'|min\b)/i))) { item.sets = 1; item.durationSec = Number(m[1].replace(',', '.')) * 60; }
  if ((m = r.match(/(\d+)\s*(tiros|lanzamientos|saltos|rebotes|contactos|reps?)\b/i))) item.qty = Number(m[1]);

  // progresión por serie: @35-37,5-40 kg
  const pm = r.match(/@\s*(\d+(?:[.,]\d+)?(?:\s*-\s*\d+(?:[.,]\d+)?)+)\s*(kg)?/i);
  if (pm) {
    item.kgList = pm[1].split('-').map((x) => Number(x.trim().replace(',', '.')));
    item.kg = Math.round(item.kgList.reduce((a, b) => a + b, 0) / item.kgList.length * 100) / 100;
    return item;
  }
  if ((m = r.match(/@\s*(\d+(?:[.,]\d+)?)\s*(kg|"|s\b|seg)?/i))) {
    const v = Number(m[1].replace(',', '.'));
    const isTime = m[2] && /^("|s|seg)$/i.test(m[2]);
    if (isTime) { if (item.holdSec == null) item.holdSec = v; }
    else item.kg = v; // "@18 kg" o "@18" sin unidad = kg
  }
  return item;
}

// ---------- tipo ----------

function guessType(item, library) {
  const key = norm(item.name);
  if (library && library[key]) return { type: library[key], guessed: false };
  if (item.run) return { type: 'run', guessed: !library };
  if (item.holdSec != null || item.durationSec != null) return { type: 'iso', guessed: true };
  if (TIME_RE.test(item.name)) return { type: 'iso', guessed: true };
  if (GYM_FIRST_RE.test(item.name)) return { type: 'gym', guessed: true };
  if (THROW_RE.test(item.name)) return { type: 'throw', guessed: true };
  if (JUMP_RE.test(item.name)) return { type: 'jump', guessed: true };
  return { type: 'gym', guessed: true };
}

// Métricas para el entrenador (el atleta no las ve).
export function metricsOf(item) {
  const out = { tonnage: 0, throws: 0, contacts: 0, meters: 0 };
  const count = item.sets && item.reps ? item.sets * item.reps : (item.qty || (item.sets || 0));
  if (item.type === 'gym' && item.kg) out.tonnage = count * item.kg / 1000;
  if (item.type === 'throw') out.throws = item.qty || count;
  if (item.type === 'jump') out.contacts = item.qty || count;
  if (item.type === 'run' && item.run) out.meters = item.run.series * item.run.reps * item.run.meters;
  return out;
}

// Texto corto del plan, como lo escribió el entrenador.
export function planText(item) {
  if (item.type === 'run' && item.run) {
    const r = item.run;
    const parts = [];
    if (r.paceText) parts.push(r.paceText); else parts.push('a full');
    let t = parts.join('');
    if (r.targetSec && /km|\//.test(r.paceText)) t += ' → ' + clock(r.targetSec) + ' c/u';
    if (r.restRep != null) t += ' · r ' + short(r.restRep);
    if (r.restSet != null) t += ' · R ' + short(r.restSet);
    return t;
  }
  const parts = [];
  if (item.durationSec != null) parts.push((item.sets > 1 ? item.sets + ' × ' : '') + Math.round(item.durationSec / 60) + ' min');
  else if (item.sets && item.reps) parts.push(item.sets + ' × ' + item.reps + (item.perSide ? 'e' : ''));
  else if (item.qty) parts.push(item.qty + (item.type === 'throw' ? ' tiros' : item.type === 'jump' ? ' saltos' : ''));
  if (item.holdSec != null && item.type === 'iso') parts.push(item.holdSec + '"');
  if (item.kgList) parts.push(item.kgList.map((v) => String(v).replace('.', ',')).join('-') + ' kg');
  else if (item.kg != null) parts.push(String(item.kg).replace('.', ',') + ' kg');
  return parts.join(' · ');
}

// ---------- lector principal ----------

/**
 * @param {string} text  el mensaje pegado
 * @param {object} opts  { athletes: ['Jhon', ...], library: { 'arranque': 'gym', ... } }
 * @returns {{ athletes: Array, warnings: Array }}
 */
export function parsePlan(text, opts = {}) {
  const known = (opts.athletes || []).map((n) => ({ key: norm(n), name: n }));
  const library = opts.library ? Object.fromEntries(Object.entries(opts.library).map(([k, v]) => [norm(k), v])) : null;
  const lines = String(text).split(/\r?\n/);
  const result = { athletes: [], warnings: [] };

  let ath = null, day = null, block = null, lastWasBlank = true, lastWasPrio = false;

  const newDay = (dayIndex) => { day = { dayIndex, blocks: [], prio: '', lines: [] }; ath.days.push(day); block = null; };
  const ensure = () => {
    if (!ath) { ath = { name: '', days: [] }; result.athletes.push(ath); }
    if (!day) newDay(null);
    if (!block) { block = { name: 'Principal', orig: '', items: [] }; day.blocks.push(block); }
  };

  lines.forEach((raw, idx) => {
    const line = clean(raw);
    if (!line) { lastWasBlank = true; return; }

    // prioridad
    const pr = line.match(/^prioridad\s*:\s*(.*)$/i);
    if (pr) { ensure(); day.prio = pr[1].trim(); day.lines.push('💡 Prioridad: ' + day.prio); lastWasPrio = true; lastWasBlank = false; return; }

    // día
    const d = dayOf(line);
    if (d != null && !/→|->/.test(line)) {
      if (!ath) { ath = { name: '', days: [] }; result.athletes.push(ath); }
      newDay(d); lastWasBlank = false; lastWasPrio = false; return;
    }

    // bloque
    const b = !/→|->|\d/.test(line) ? blockOf(line) : null;
    if (b) {
      if (!ath) { ath = { name: '', days: [] }; result.athletes.push(ath); }
      if (!day) newDay(null);
      const same = day.blocks.find((x) => x.name === b);
      block = same || { name: b, orig: line.replace(/:$/, ''), items: [] };
      if (!same) day.blocks.push(block);
      day.lines.push(line);
      lastWasBlank = false; lastWasPrio = false; return;
    }

    // atleta
    const k = known.find((a) => a.key === norm(line));
    const looksName = !/→|->|\d|:/.test(line) && line.split(' ').length <= 4 && (idx === 0 || lastWasPrio || lastWasBlank && !block);
    if (k || (looksName && !known.length) || (looksName && lastWasPrio)) {
      ath = { name: k ? k.name : line, days: [] };
      result.athletes.push(ath);
      day = null; block = null; lastWasBlank = false; lastWasPrio = false;
      if (!k && known.length) result.warnings.push({ line: idx + 1, text: line, msg: 'Atleta no encontrado en tu lista' });
      return;
    }

    lastWasBlank = false; lastWasPrio = false;
    ensure();
    day.lines.push(line);

    let item = null;
    const run = parseRun(line);
    if (run) {
      item = { name: (run.series > 1 ? run.series + '×' : '') + (run.reps > 1 ? run.reps + '×' : '') + run.meters + ' m', circuit: null, run };
    } else {
      const am = line.match(/^(.*?)\s*(?:→|->)\s*(.*)$/);
      if (am) item = parseArrow(am[1], am[2]);
    }

    // En calentamiento y vuelta a la calma, una línea sin números es una tarea para marcar (ej. "ABC de carrera").
    if (!item && (block.name === 'Calentamiento' || block.name === 'Vuelta a la calma') && !/\d/.test(line) && line.split(' ').length <= 8) {
      item = { name: line, circuit: null, sets: null, reps: null, kg: null, holdSec: null, qty: null };
    }

    if (!item) {
      block.items.push({ type: 'note', text: line, raw: line });
      result.warnings.push({ line: idx + 1, text: line, msg: 'No se entendió: llegará como nota' });
      return;
    }

    item.marca = /\bmarca\b/i.test(line);
    const t = guessType(item, library);
    item.type = t.type;
    item.typeGuessed = t.guessed;
    item.raw = line;
    item.plan = planText(item);
    item.metrics = metricsOf(item);
    if (item.typeGuessed && item.type !== 'run') result.warnings.push({ line: idx + 1, text: item.name, msg: 'Ejercicio nuevo: confirma su tipo (' + item.type + ')', kind: 'type' });
    block.items.push(item);
  });

  // quitar días vacíos
  result.athletes.forEach((a) => { a.days = a.days.filter((d) => d.blocks.some((b) => b.items.length) || d.prio); a.days.forEach((d) => { d.text = d.lines.join('\n'); delete d.lines; }); });
  return result;
}
