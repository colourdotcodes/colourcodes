// DOM helpers and the small widget kit every ColourcodeOS app uses.
import { iconImg } from './icons.js';

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const icon = (name, size = 16, cls) => iconImg(name, size, cls);

// Pixel glyphs for title-bar buttons, check marks etc. Rows of '#'.
export function glyph(rows, color = 'currentColor') {
  const w = Math.max(...rows.map((r) => r.length)), hgt = rows.length;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', w); svg.setAttribute('height', hgt); svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  svg.setAttribute('aria-hidden', 'true');
  let d = '';
  rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === '#') d += `M${x} ${y}h1v1h-1z`; }));
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', d); p.setAttribute('fill', color);
  svg.appendChild(p);
  return svg;
}
export const GLYPH = {
  min: ['........', '........', '........', '........', '........', '.######.', '.######.'],
  max: ['########', '########', '#......#', '#......#', '#......#', '#......#', '########'],
  restore: ['..######', '..######', '..#....#', '######.#', '######.#', '#....###', '#....#..', '######..'],
  close: ['##....##', '###..###', '.######.', '..####..', '.######.', '###..###', '##....##'],
  x: ['#.....#', '##...##', '.##.##.', '..###..', '.##.##.', '##...##', '#.....#'],
  arrowR: ['#...', '##..', '###.', '####', '###.', '##..', '#...'],
};

export function button(label, opts = {}) {
  const b = h('button', { class: 'btn' + (opts.primary ? ' default' : '') + (opts.small ? ' small' : '') + (opts.cls ? ' ' + opts.cls : ''), type: 'button', title: opts.title });
  if (opts.icon) b.appendChild(icon(opts.icon, 16));
  if (label) b.appendChild(h('span', null, label));
  if (opts.onClick) b.addEventListener('click', opts.onClick);
  if (opts.disabled) b.disabled = true;
  return b;
}
export function tool(label, iconName, onClick, title) {
  const b = h('button', { class: 'tool', type: 'button', title: title || label });
  if (iconName) b.appendChild(icon(iconName, 16));
  if (label) b.appendChild(h('span', null, label));
  if (onClick) b.addEventListener('click', onClick);
  return b;
}
export function field(value = '', opts = {}) {
  const f = h('input', { class: 'field' + (opts.mono ? ' mono' : '') + (opts.cls ? ' ' + opts.cls : ''), type: 'text', spellcheck: 'false', autocomplete: 'off', readonly: opts.readonly, placeholder: opts.placeholder, 'aria-label': opts.label });
  f.value = value;
  if (opts.readonly) f.addEventListener('focus', () => f.select());
  return f;
}
export function group(legend, ...kids) {
  return h('div', { class: 'group' + (legend ? '' : ' nolegend') }, legend ? h('span', { class: 'legend' }, legend) : null, ...kids);
}
export function kv(pairs, cls = '') {
  const dl = h('dl', { class: 'kv ' + cls });
  const refs = {};
  for (const [key, label, value] of pairs) {
    dl.append(h('dt', null, label));
    refs[key] = h('dd', null, value ?? '—');
    dl.append(refs[key]);
  }
  return { el: dl, refs };
}

// Classic list view with sticky column headers.
export function listView(columns, { empty = 'Nothing here yet.', onOpen, onSelect } = {}) {
  const tbody = h('tbody');
  const colgroup = h('colgroup', null, columns.map((c) => h('col', { style: c.width ? { width: c.width } : null })));
  const thead = h('thead', null, h('tr', null, columns.map((c) => h('th', { class: c.num ? 'num' : '' }, c.label))));
  const emptyEl = h('div', { class: 'list-empty' }, empty);
  const wrap = h('div', { class: 'list sunken' }, h('table', null, colgroup, thead, tbody), emptyEl);
  let rows = [], sel = -1;
  const select = (i) => {
    sel = i;
    [...tbody.children].forEach((tr, j) => tr.classList.toggle('is-selected', j === i));
    onSelect?.(rows[i], i);
  };
  tbody.addEventListener('click', (e) => { const tr = e.target.closest('tr'); if (tr) select([...tbody.children].indexOf(tr)); });
  tbody.addEventListener('dblclick', (e) => { const tr = e.target.closest('tr'); if (tr) onOpen?.(rows[[...tbody.children].indexOf(tr)]); });
  return {
    el: wrap,
    setRows(list) {
      rows = list;
      const frag = document.createDocumentFragment();
      for (const r of list) {
        frag.append(h('tr', { title: r.title }, columns.map((c) => {
          const v = typeof c.get === 'function' ? c.get(r) : r[c.key];
          return h('td', { class: (c.num ? 'num ' : '') + (c.cls || '') }, v);
        })));
      }
      tbody.replaceChildren(frag);
      emptyEl.hidden = list.length > 0;
      if (sel >= list.length) sel = -1;
      if (sel >= 0) tbody.children[sel]?.classList.add('is-selected');
    },
    setEmpty(content) { emptyEl.replaceChildren(...(Array.isArray(content) ? content : [content])); },
    get selected() { return rows[sel]; },
    get selectedIndex() { return sel; },
  };
}

// Empty / error / not-deployed panels. Same look across apps.
export function statePanel({ icon: ic = 'info', title, text, action }) {
  return h('div', { class: 'state' },
    h('div', { class: 'state-box' }, iconImg(ic, 32),
      h('div', null, h('h4', null, title), text ? h('p', null, text) : null, action || null)));
}

// Copy to clipboard with a fallback that works inside transformed iframes too.
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try {
    const t = h('textarea', { style: { position: 'fixed', left: '-9999px', top: '0' } });
    t.value = text; document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy'); t.remove(); return ok;
  } catch { return false; }
}

export function openLink(url) {
  const w = window.open(url, '_blank', 'noopener,noreferrer');
  if (w) w.opener = null;
}

export function timeHMS(t) {
  const d = t instanceof Date ? t : new Date(t);
  if (isNaN(d)) return '--:--:--';
  return d.toLocaleTimeString('en-GB', { hour12: false });
}
export function ago(ts) {
  let ms = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!isFinite(ms)) return '—';
  if (ms < 1e12) ms *= 1000; // seconds
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return s + ' s ago';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return Math.floor(s / 86400) + ' d ago';
}
export function until(ts) {
  let ms = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!isFinite(ms)) return '—';
  if (ms < 1e12) ms *= 1000;
  const s = Math.round((ms - Date.now()) / 1000);
  if (s <= 0) return 'now';
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60);
  return hh ? `${hh} h ${mm} min` : mm ? `${mm} min` : `${s} s`;
}
export const toMs = (ts) => { let ms = typeof ts === 'number' ? ts : Date.parse(ts); if (ms < 1e12) ms *= 1000; return ms; };

export const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
export const origin = () => location.origin;
export const cfg = () => window.COLOURCODE || {};
export const ticker = () => cfg().ticker || 'CCODE';
