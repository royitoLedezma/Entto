// Gráficos simples en SVG (barras con plan de fondo, barras apiladas y líneas).
import { svg, html, nothing } from './vendor/lit-html/lit-html.js';

const W = 640, H = 220, L = 48, R = 12, T = 12, B = 34;
const PW = W - L - R, PH = H - T - B;
export const BLUE = '#2a78d6';
export const GHOST = '#E3E2DD';
export const SEQ = ['#0F3D73', '#2a78d6', '#8DB8EC', '#C9DDF5', '#5B606B'];

function nice(v) {
  if (!v || v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
function topBar(x, y, w, h) {
  if (!(h > 0.5)) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
const rect = (x, y, w, h) => (h > 0.5 ? `M${x},${y}H${x + w}V${y + h}H${x}Z` : '');

function axis(max, fmt, refY) {
  const ticks = [0, max / 2, max];
  return svg`${ticks.map((v) => { const y = T + PH - v / max * PH; return svg`<line x1=${L} x2=${W - R} y1=${y} y2=${y} stroke="#E1E0D9" stroke-width="1"></line><text x=${L - 6} y=${y + 4} font-size="11" fill="#5B606B" text-anchor="end">${fmt(v)}</text>`; })}
    ${refY != null ? svg`<line x1=${L} x2=${W - R} y1=${refY} y2=${refY} stroke="#898781" stroke-width="1.5" stroke-dasharray="5 4"></line>` : nothing}`;
}

function xLabels(labels, gw, sel) {
  const step = labels.length > 14 ? 2 : 1;
  return labels.map((l, i) => (i % step === 0 || i === sel ? svg`<text x=${L + i * gw + gw / 2} y=${H - 12} font-size="11" fill=${i === sel ? '#16181D' : '#5B606B'} font-weight=${i === sel ? '700' : '400'} text-anchor="middle">${l}</text>` : nothing));
}

/**
 * Barras: values (sólidas) sobre ghost (plan, de fondo). ref = línea de referencia (ej. 100).
 */
export function barChart({ labels, values, ghost, ref, fmt, onPick, sel, label, max }) {
  const n = labels.length || 1;
  const gw = PW / n;
  const all = [].concat(values, ghost || [], ref != null ? [ref * 1.15] : []).filter((v) => v != null && !isNaN(v));
  const mx = max || nice(Math.max(1, ...all));
  const y = (v) => T + PH - v / mx * PH;
  return html`<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label=${label}>
    ${axis(mx, fmt, ref != null ? y(ref) : null)}
    ${labels.map((_, i) => {
      const x = L + i * gw;
      const g = ghost ? ghost[i] : null;
      const v = values[i];
      return svg`${g != null ? svg`<path d=${topBar(x + gw * 0.18, y(g), gw * 0.64, T + PH - y(g))} fill=${GHOST}></path>` : nothing}
        ${v != null ? svg`<path d=${topBar(x + gw * 0.3, y(v), gw * 0.4, T + PH - y(v))} fill=${BLUE}></path>` : nothing}
        <rect x=${x} y=${T} width=${gw} height=${PH + B - 8} fill=${sel === i ? 'rgba(22,24,29,0.06)' : 'transparent'} @click=${() => onPick && onPick(i)} @mouseenter=${() => onPick && onPick(i)}></rect>`;
    })}
    ${xLabels(labels, gw, sel)}
  </svg>`;
}

/** Barras apiladas: stacks = [{ name, values }] de abajo hacia arriba. */
export function stackChart({ labels, stacks, fmt, onPick, sel, label }) {
  const n = labels.length || 1;
  const gw = PW / n;
  const tot = labels.map((_, i) => stacks.reduce((s, st) => s + (st.values[i] || 0), 0));
  const mx = nice(Math.max(1, ...tot));
  const y = (v) => T + PH - v / mx * PH;
  return html`<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label=${label}>
    ${axis(mx, fmt)}
    ${labels.map((_, i) => {
      const x = L + i * gw + gw * 0.22, w = gw * 0.56;
      let acc = 0;
      const topIdx = stacks.map((st, k) => (st.values[i] ? k : -1)).reduce((a, b) => Math.max(a, b), -1);
      return svg`${stacks.map((st, k) => {
        const v = st.values[i] || 0; if (!v) return nothing;
        const y0 = y(acc + v), h = y(acc) - y(acc + v) - (acc ? 2 : 0); acc += v;
        return svg`<path d=${k === topIdx ? topBar(x, y0, w, h) : rect(x, y0, w, h)} fill=${SEQ[k % SEQ.length]}></path>`;
      })}<rect x=${L + i * gw} y=${T} width=${gw} height=${PH + B - 8} fill=${sel === i ? 'rgba(22,24,29,0.06)' : 'transparent'} @click=${() => onPick && onPick(i)} @mouseenter=${() => onPick && onPick(i)}></rect>`;
    })}
    ${xLabels(labels, gw, sel)}
  </svg>`;
}

/** Línea con puntos; ref = línea punteada (ej. su promedio). */
export function lineChart({ labels, values, ref, fmt, onPick, sel, label, min, max }) {
  const n = labels.length || 1;
  const gw = PW / n;
  const vs = values.filter((v) => v != null);
  const lo = min != null ? min : Math.floor(Math.min(...vs, ref != null ? ref : Infinity) * 0.9);
  const hi = max != null ? max : nice(Math.max(...vs, ref != null ? ref : 0) * 1.05);
  const y = (v) => T + PH - (v - lo) / (hi - lo || 1) * PH;
  const pts = values.map((v, i) => (v == null ? null : [L + i * gw + gw / 2, y(v)]));
  let d = ''; pts.forEach((p) => { if (p) d += (d ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1); });
  const ticks = [lo, (lo + hi) / 2, hi];
  return html`<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label=${label}>
    ${ticks.map((v) => svg`<line x1=${L} x2=${W - R} y1=${y(v)} y2=${y(v)} stroke="#E1E0D9" stroke-width="1"></line><text x=${L - 6} y=${y(v) + 4} font-size="11" fill="#5B606B" text-anchor="end">${fmt(v)}</text>`)}
    ${ref != null ? svg`<line x1=${L} x2=${W - R} y1=${y(ref)} y2=${y(ref)} stroke="#898781" stroke-width="1.5" stroke-dasharray="5 4"></line>` : nothing}
    <path d=${d} fill="none" stroke=${BLUE} stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path>
    ${pts.map((p, i) => (p ? svg`<circle cx=${p[0]} cy=${p[1]} r=${sel === i ? 6 : 4} fill=${BLUE} stroke="#fff" stroke-width="2"></circle>` : nothing))}
    ${labels.map((_, i) => svg`<rect x=${L + i * gw} y=${T} width=${gw} height=${PH + B - 8} fill="transparent" @click=${() => onPick && onPick(i)} @mouseenter=${() => onPick && onPick(i)}></rect>`)}
    ${xLabels(labels, gw, sel)}
  </svg>`;
}

export function legend(items) {
  return html`<div class="legend">${items.map(([c, t, dashed]) => html`<span class="lg">${dashed ? html`<span class="sw-line"></span>` : html`<span class="sw" style="background:${c}"></span>`}${t}</span>`)}</div>`;
}
