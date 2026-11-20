// Entrada: decide si se abre la app del atleta (enlace con #a=código) o la del entrenador.
const root = document.getElementById('app');

function athleteToken() {
  const m = location.hash.match(/[#&]a=([A-Za-z0-9]+)/);
  if (m) { try { localStorage.setItem('entto.token', m[1]); } catch (e) { /* sin almacenamiento */ } return m[1]; }
  if (/[#&]entrenador/.test(location.hash)) { try { localStorage.removeItem('entto.token'); } catch (e) { /* nada */ } return null; }
  try { return localStorage.getItem('entto.token'); } catch (e) { return null; }
}

async function main() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  let cfg;
  try { cfg = await import('./firebase-config.js'); } catch (e) { cfg = null; }
  if (!cfg || String(cfg.firebaseConfig.apiKey).startsWith('PEGAR')) {
    root.innerHTML = '<div class="app"><div class="hd"><h1>Entto</h1></div><div class="wrap"><div class="card"><p>Falta conectar Firebase: completa <code>js/firebase-config.js</code> (ver GUIA.md).</p></div></div></div>';
    return;
  }
  const token = athleteToken();
  globalThis.__ENTTO_MODE = token ? 'athlete' : 'coach';
  root.innerHTML = '';
  try {
    if (token) { const m = await import('./athlete.js'); await m.startAthlete(root, token); }
    else { const m = await import('./coach.js'); m.startCoach(root); }
  } catch (e) {
    console.error(e);
    root.innerHTML = '<div class="app"><div class="hd"><h1>Entto</h1></div><div class="wrap"><div class="card"><p>No se pudo cargar la app. ' + (navigator.onLine ? 'Recarga la página.' : 'Revisa tu conexión: la primera vez necesita internet.') + '</p></div></div></div>';
  }
}
window.addEventListener('hashchange', () => { if (/[#&](a=|entrenador)/.test(location.hash)) location.reload(); });
main();
