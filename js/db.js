// Conexión con Firebase: sesión, base de datos (con funcionamiento sin internet) y utilidades.
import { firebaseConfig, ADMIN_EMAIL } from './firebase-config.js';

const V = '13.4.0';
const base = `https://www.gstatic.com/firebasejs/${V}`;
const appMod = await import(`${base}/firebase-app.js`);
const authMod = await import(`${base}/firebase-auth.js`);
const fsMod = await import(`${base}/firebase-firestore.js`);

export const app = appMod.initializeApp(firebaseConfig);
export const auth = authMod.getAuth(app);

let firestore;
try {
  firestore = fsMod.initializeFirestore(app, {
    localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() })
  });
} catch (e) {
  firestore = fsMod.getFirestore(app);
}
export const fs = firestore;
export const F = fsMod;
export const A = authMod;
export const ADMIN = (ADMIN_EMAIL || '').toLowerCase();
export const AppMod = appMod;
export { firebaseConfig };

const { doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, orderBy, documentId, serverTimestamp, writeBatch } = fsMod;

// ---------- fechas ----------
export function ymd(d) {
  const z = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
}
export function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function mondayOf(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return x; }
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function weekDates(monday) { return [0, 1, 2, 3, 4, 5, 6].map((i) => ymd(addDays(monday, i))); }
export const DAY_LONG = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const DAY_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export function niceDate(s) { const d = parseYmd(s); return d.getDate() + ' ' + MONTHS[d.getMonth()]; }

export function randomToken(n = 22) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const a = new Uint32Array(n); crypto.getRandomValues(a);
  return Array.from(a, (v) => chars[v % chars.length]).join('');
}

export function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); }

// ---------- rutas ----------
export const P = {
  user: (uid) => doc(fs, 'users', uid),
  users: () => collection(fs, 'users'),
  coach: (cid) => doc(fs, 'coaches', cid),
  athletes: (cid) => collection(fs, 'coaches', cid, 'athletes'),
  athlete: (cid, aid) => doc(fs, 'coaches', cid, 'athletes', aid),
  exercises: (cid) => collection(fs, 'coaches', cid, 'exercises'),
  exercise: (cid, key) => doc(fs, 'coaches', cid, 'exercises', key),
  days: (cid, aid) => collection(fs, 'coaches', cid, 'athletes', aid, 'days'),
  day: (cid, aid, d) => doc(fs, 'coaches', cid, 'athletes', aid, 'days', d),
  logs: (cid, aid) => collection(fs, 'coaches', cid, 'athletes', aid, 'logs'),
  log: (cid, aid, d) => doc(fs, 'coaches', cid, 'athletes', aid, 'logs', d),
  tests: (cid, aid) => collection(fs, 'coaches', cid, 'athletes', aid, 'tests'),
  test: (cid, aid, tid) => doc(fs, 'coaches', cid, 'athletes', aid, 'tests', tid),
  access: (token) => doc(fs, 'access', token),
  link: (uid) => doc(fs, 'links', uid)
};

// Lee un rango de documentos por fecha (id = AAAA-MM-DD). Solo para el entrenador.
export async function rangeDocs(col, from, to) {
  const q = query(col, where(documentId(), '>=', from), where(documentId(), '<=', to));
  const snap = await getDocs(q);
  const out = {};
  snap.forEach((s) => { out[s.id] = s.data(); });
  return out;
}

// Lee días sueltos ignorando los que no existen o no se pueden leer (para el atleta).
export async function getMany(refs) {
  const res = await Promise.all(refs.map((r) => getDoc(r).then((s) => (s.exists() ? s.data() : null)).catch(() => null)));
  return res;
}

export { doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, orderBy, documentId, serverTimestamp, writeBatch };
