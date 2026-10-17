// The room: a coder at a 2009 CRT. ColourcodeOS is projected onto the glass,
// his hand follows the visitor's mouse, and "Turn on the computer" pushes the
// camera into the screen until the OS fills the viewport.
import { quadMatrix, pointInQuad } from './homography.js';
import { createHand } from './hand.js';
import { bootSound } from './boot-sound.js';

const CFG = window.COLOURCODE || {};
const VW = 1024, VH = 960;                       // ColourcodeOS virtual screen
const FOCUS = [1500, 800];                       // point of the still kept in view
const ZOOM = 1.0;                               // a little closer than cover on wide screens
const PHONE = matchMedia('(max-width: 760px)');
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const FINE = matchMedia('(pointer: fine)');

const $ = (id) => document.getElementById(id);
const body = document.body;
const stage = $('stage'), shade = $('room-shade'), fx = $('screen-fx'), os = $('os-root'), base = $('screen-base');

const meta = await fetch('/img/hero/hero.json').then((r) => r.json());
const W = meta.still.w, H = meta.still.h;
stage.style.width = W + 'px';
stage.style.height = H + 'px';

// The bright glass includes the tube's rounded corners; pull the OS in a touch.
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const SCREEN = inset(meta.screen, 0);        // the whole tube face, rim to rim
// The classic tube is nearly square; the 4:3 desktop sits centred on it with black above and below.
function letterbox(q) {
  const w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2, h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  const r = Math.min(1, (w * VH / VW) / h), t0 = (1 - r) / 2, t1 = (1 + r) / 2;
  const L = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return [L(q[0], q[3], t0), L(q[1], q[2], t0), L(q[1], q[2], t1), L(q[0], q[3], t1)];
}
const BASE_H = Math.round(VW * ((dist(SCREEN[0], SCREEN[3]) + dist(SCREEN[1], SCREEN[2])) / (dist(SCREEN[0], SCREEN[1]) + dist(SCREEN[3], SCREEN[2]))));
base.style.height = BASE_H + 'px';

// He breathes and shifts in his chair: a seamless loop under everything else.
// The still stays underneath as the first paint and the reduced-motion view.
let idle = null;
if (meta.idle && !REDUCED.matches) {
  idle = document.createElement('video');
  idle.className = 'idle';
  Object.assign(idle, { muted: true, loop: true, playsInline: true, autoplay: true, preload: 'auto' });
  idle.setAttribute('muted', ''); idle.setAttribute('playsinline', '');
  for (const src of meta.idle.src) {
    const s = document.createElement('source');
    s.src = PHONE.matches && src.phone ? src.phone : src.url; s.type = src.type;
    idle.appendChild(s);
  }
  idle.addEventListener('playing', () => idle.classList.add('ready'), { once: true });
  stage.appendChild(idle);
  idle.play().catch(() => {});
}

const hand = createHand(meta.hand, stage);
hand.start();


let p = 0;            // 0 = room, 1 = inside the screen
let anim = null;
let quadNow = SCREEN;
let mode = 'room';    // 'room' | 'entering' | 'os' | 'leaving'

/* ---------- geometry ---------- */
function inset(q, d) {
  const cx = q.reduce((s, c) => s + c[0], 0) / 4, cy = q.reduce((s, c) => s + c[1], 0) / 4;
  return q.map(([x, y]) => {
    const dx = cx - x, dy = cy - y, l = Math.hypot(dx, dy);
    return [x + (dx / l) * d, y + (dy / l) * d];
  });
}
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, t) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
const easeInOut = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function viewport() {
  const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top-h')) || 64;
  return { w: innerWidth, h: innerHeight, top };
}

// Phones show the whole scene (him, the monitor, his hand) in the top half; copy sits below.
const PHONE_WINDOW = { x: 690, y: 330, w: 1260 };

function roomView(v) {
  if (PHONE.matches) {
    // Phones: fill the whole screen height, centred on him and the computer; copy floats on a soft floor.
    const s = Math.max(v.h / H, v.w / 900);
    const tx = Math.min(0, Math.max(v.w - W * s, v.w / 2 - 1335 * s));
    return { s, tx, ty: Math.min(0, v.h - H * s) };
  }
  const s = Math.max(v.w / W, v.h / H) * ZOOM;
  const tx = Math.min(0, Math.max(v.w - W * s, v.w / 2 - FOCUS[0] * s));
  const ty = Math.min(0, Math.max(v.h - H * s, v.h * 0.47 - FOCUS[1] * s));
  return { s, tx, ty };
}

// Where the OS sits once we're inside: a 4:3 box under the header.
function fitRect(v) {
  const padX = PHONE.matches ? 0 : Math.max(16, v.w * 0.02);
  const top = v.top + (PHONE.matches ? 0 : 6), bottom = PHONE.matches ? 0 : 16;
  const aw = v.w - padX * 2, ah = v.h - top - bottom;
  const s = Math.min(aw / VW, ah / VH);
  const w = VW * s, h = VH * s;
  const x = (v.w - w) / 2, y = top + (ah - h) / 2;
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

function insideView(v, rect) {
  const sw = (dist(SCREEN[0], SCREEN[1]) + dist(SCREEN[3], SCREEN[2])) / 2;
  const s = (rect[1][0] - rect[0][0]) / sw;
  const c = SCREEN.reduce((a, q) => [a[0] + q[0] / 4, a[1] + q[1] / 4], [0, 0]);
  const rc = [(rect[0][0] + rect[1][0]) / 2, (rect[0][1] + rect[2][1]) / 2];
  return { s, tx: rc[0] - c[0] * s, ty: rc[1] - c[1] * s };
}

function render() {
  const v = viewport();
  const a = roomView(v), rect = fitRect(v), b = insideView(v, rect);
  const e = easeInOut(p);
  // Interpolate the zoom in log space so the push feels even.
  const s = Math.exp(lerp(Math.log(a.s), Math.log(b.s), e));
  const k = (s - a.s) / ((b.s - a.s) || 1);
  const tx = lerp(a.tx, b.tx, k), ty = lerp(a.ty, b.ty, k);
  stage.style.transform = `translate3d(${tx}px,${ty}px,0) scale(${s})`;
  document.documentElement.style.setProperty('--ib', (ty + H * s).toFixed(1) + 'px');

  const proj = SCREEN.map(([x, y]) => [tx + x * s, ty + y * s]);
  const m = smooth(.45, 1, p);
  quadNow = proj.map((c, i) => [lerp(c[0], rect[i][0], m), lerp(c[1], rect[i][1], m)]);

  if (os.dataset.mode === 'crt') os.style.transform = quadMatrix(VW, VH, quadNow);
  base.style.transform = quadMatrix(VW, BASE_H, quadNow);
  base.style.opacity = m >= 1 ? 0 : 1;
  fx.style.transform = quadMatrix(VW, BASE_H, quadNow);
  shade.style.setProperty('--dark', (smooth(.25, 1, p) * 0.82).toFixed(3));
}

/* ---------- OS hookup ---------- */
function osReady() {
  return new Promise((res) => {
    if (window.ColourcodeOS) return res(window.ColourcodeOS);
    const t = setInterval(() => { if (window.ColourcodeOS) { clearInterval(t); res(window.ColourcodeOS); } }, 50);
  });
}
let OS = null;
let agentWin = null;   // in the room the agent terminal fills his screen: he is coding
const setCoding = (on) => { if (agentWin && agentWin.maximized !== on) agentWin.toggleMax?.(); };
osReady().then(async (api) => {
  OS = api;
  try { OS.setInteractive?.(mode === 'os'); } catch {}
  try { await OS.boot?.({ fast: true }); } catch {}
  try { agentWin = await OS.open?.('agent'); setCoding(mode !== 'os'); } catch {}
  OS.on?.('shutdown', () => leave());
  OS.on?.('post', (k) => { if (k === 'seek') bootSound.seek(); else if (k === 'line') bootSound.tick(); });
  OS.on?.('ready', () => { if (mode === 'os' || mode === 'entering') bootSound.ready(); });
});

/* ---------- transitions ---------- */
function animateTo(target, ms, done) {
  cancelAnimationFrame(anim);
  if (REDUCED.matches) { p = target; render(); done?.(); return; }
  const from = p, t0 = performance.now(), dur = ms * Math.abs(target - from);
  if (dur < 1) { p = target; render(); done?.(); return; }
  const step = (now) => {
    const t = Math.min(1, (now - t0) / dur);
    p = lerp(from, target, t);
    render();
    if (t < 1) anim = requestAnimationFrame(step); else done?.();
  };
  anim = requestAnimationFrame(step);
}

function enter(app) {
  if (mode === 'os' || mode === 'entering') { if (app) OS?.open?.(app); return; }
  mode = 'entering';
  setCoding(false);
  bootSound.unlock();
  body.classList.add('is-entering', 'is-off');     // the screen goes dark while we move in
  os.classList.remove('screen-hover');
  animateTo(1, 1700, async () => {
    mode = 'os';
    body.classList.remove('is-entering', 'is-room');
    body.classList.add('is-os');
    hand.stop();
    idle?.pause();
    if (PHONE.matches) toNative();
    OS?.setInteractive?.(true);
    history.replaceState(null, '', '#os');
    // Power on: clunk, chime, self-test, splash, desktop.
    bootSound.powerOn();
    await new Promise((r) => setTimeout(r, 350));
    body.classList.remove('is-off');
    try { await OS?.reboot?.(); } catch {}
    if (app) OS?.open?.(app);
  });
}

function leave() {
  if (mode !== 'os') return;
  mode = 'leaving';
  bootSound.powerOff();
  OS?.setInteractive?.(false);
  if (os.dataset.mode === 'native') toCrt();
  body.classList.remove('is-os');
  body.classList.add('is-entering', 'is-room');
  hand.start();
  idle?.play().catch(() => {});
  animateTo(0, 1300, () => {
    mode = 'room';
    setCoding(true);
    body.classList.remove('is-entering');
    history.replaceState(null, '', location.pathname + location.search);
  });
}

// Phones: once inside, the OS lays itself out at the real viewport size.
function toNative() {
  os.dataset.mode = 'native';
  os.style.transform = '';
  fx.style.opacity = '0';
  window.dispatchEvent(new Event('resize'));
}
function toCrt() {
  os.dataset.mode = 'crt';
  fx.style.opacity = '';
  render();
  window.dispatchEvent(new Event('resize'));
}

/* ---------- input ---------- */
const hint = $('hint');
let moved = false;
addEventListener('pointermove', (e) => {
  if (mode !== 'room' || e.pointerType !== 'mouse') return;
  hand.set(e.clientX / innerWidth);
  OS?.pointer?.((e.clientX / innerWidth) * VW, (e.clientY / innerHeight) * VH);
  const over = pointInQuad(quadNow, e.clientX, e.clientY) && !e.target.closest('.top, .hero-copy, .hero-stats');
  os.classList.toggle('screen-hover', over);
  if (!moved) { moved = true; setTimeout(() => hint.classList.add('is-gone'), 1400); }
}, { passive: true });
document.documentElement.addEventListener('mouseleave', () => hand.release());

addEventListener('click', (e) => {
  if (mode !== 'room') return;
  if (e.target.closest('.top, .hero-copy, .hero-stats, .toast')) return;
  if (pointInQuad(quadNow, e.clientX, e.clientY)) enter();
});
addEventListener('wheel', (e) => {
  if (mode === 'room' && e.deltaY > 12) enter();
}, { passive: true });
let touchY = null;
addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; }, { passive: true });
addEventListener('touchmove', (e) => {
  if (mode === 'room' && touchY !== null && touchY - e.touches[0].clientY > 40) { touchY = null; enter(); }
}, { passive: true });
addEventListener('keydown', (e) => {
  if (mode === 'room' && (e.key === 'Enter' || e.key === ' ') && document.activeElement === document.body) { e.preventDefault(); enter(); }
  // Esc leaves the computer, unless the OS used it (closing a menu or a dialog).
  if (mode === 'os' && e.key === 'Escape') setTimeout(() => { if (!e.defaultPrevented) leave(); });
});

$('enter').addEventListener('click', () => enter());
// straight into the Miner: the computer boots and colour.codes Miner opens, ready to connect a wallet
$('start-mining').addEventListener('click', () => enter('miner'));
$('open-paper').addEventListener('click', () => enter('whitepaper'));
$('back').addEventListener('click', () => leave());

/* ---------- how to mine ---------- */
const guide = $('guide');
const site = CFG.domain ? `https://${CFG.domain}` : location.origin;
$('guide-line').textContent = `Read ${site}/skill.md and start mining.`;
guide.querySelectorAll('[data-ticker]').forEach((e) => { e.textContent = '$' + (CFG.ticker || 'CCODE'); });
function openGuide() {
  guide.hidden = false; body.classList.add('guide-open');
  guide.querySelector('.guide-x').focus();
  fetch('/api/chain', { cache: 'no-store' }).then((r) => r.json()).then((d) => {
    const mh = guide.querySelector('[data-minhold]');
    if (d.status === 'live' && d.minHold) mh.textContent = `Minimum right now: ${Number(BigInt(d.minHold) / 10n ** 18n).toLocaleString('en-US')} ${'$' + (CFG.ticker || 'CCODE')}.`;
    $('guide-status').textContent = d.status === 'live' ? 'Mining is live.' : 'Mining opens at launch.';
  }).catch(() => {});
}
function closeGuide() { guide.hidden = true; body.classList.remove('guide-open'); $('open-guide').focus(); }
$('open-guide').addEventListener('click', openGuide);
guide.querySelectorAll('[data-close]').forEach((e) => e.addEventListener('click', closeGuide));
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !guide.hidden) { e.preventDefault(); closeGuide(); } }, true);
$('guide-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('guide-line').textContent); say('Copied. Paste it to your AI agent.'); }
  catch { say($('guide-line').textContent); }
});
$('guide-miner').addEventListener('click', () => { closeGuide(); enter('miner'); });
// The logo always leads back to the room (on phones it is the way out of the OS).
document.querySelector('.brand').addEventListener('click', (e) => {
  if (mode === 'os') { e.preventDefault(); leave(); }
});

if (!FINE.matches) $('hint-text').textContent = 'Tap the screen';

addEventListener('resize', () => { if (os.dataset.mode === 'crt') render(); });

/* ---------- header: CA, links ---------- */
const toast = $('toast');
let toastT;
function say(msg) {
  toast.textContent = msg; toast.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => toast.classList.remove('show'), 2200);
}
const caVal = $('ca-value');
if (CFG.ca) caVal.textContent = CFG.ca;
else { caVal.textContent = CFG.caText || 'NOT MIXED YET'; caVal.classList.add('is-empty'); }
// copies exactly what the chip shows (the placeholder too, before launch)
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* blocked */ }
    ta.remove(); return ok;
  }
}
for (const id of ['ca-copy', 'ca-value']) $(id).addEventListener('click', async () => {
  const text = CFG.ca || `CA ${caVal.textContent.trim()}`;
  say(await copyText(text) ? (CFG.ca ? 'Contract address copied.' : `Copied: ${text}`) : text);
});
function bindLink(id, url, soon) {
  const a = $(id);
  if (url) { a.href = url; a.target = '_blank'; a.rel = 'noopener'; }
  else a.addEventListener('click', (e) => { e.preventDefault(); say(soon); });
}
bindLink('link-gh', CFG.links?.github, 'Source code coming soon.');
bindLink('link-x', CFG.links?.x, 'X account coming soon.');
bindLink('link-buy', CFG.links?.pons, 'Buying opens at launch.');

/* ---------- live chain numbers (honest when not live) ---------- */
const fmt = (n) => Number(n).toLocaleString('en-US');
async function stats() {
  const note = $('st-note');
  try {
    const r = await fetch('/api/chain', { cache: 'no-store' });
    const d = await r.json();
    if (d.status === 'live') {
      $('st-height').textContent = fmt(d.height);
      // same unit as the Block Explorer: 4.10G (hashes per block)
      const si = (n) => { const u = [[1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k']].find(([v]) => n >= v); return u ? (n / u[0]).toFixed(2) + u[1] : String(Math.round(n)); };
      $('st-diff').textContent = d.difficulty ? si(Number(d.difficulty)) : '—';
      const left = d.nextHalvingAt != null ? Number(d.nextHalvingAt) - Number(d.height) : null;
      $('st-halving').textContent = left != null ? fmt(left) + ' blk' : '—';
      note.textContent = 'Live from Robinhood Chain.';
    } else if (d.status === 'not_started') {
      note.textContent = 'Contract deployed. Mining starts at the announced block.';
    } else {
      note.textContent = 'Mining opens at launch.';
    }
  } catch {
    note.textContent = 'Mining opens at launch.';
  }
}
stats();
setInterval(stats, 30000);

/* ---------- start ---------- */
render();
if (location.hash === '#os' || new URLSearchParams(location.search).has('os')) {
  p = 1; enter();
}
