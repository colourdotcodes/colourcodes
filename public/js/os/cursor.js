// The OS draws its own cursor inside the virtual screen, and maps real pointer
// positions back into virtual pixels through whatever CSS transform the hero
// applies to #os-root (scale, matrix3d, perspective): four zero-size probes at
// the screen corners give the projected quad, and a homography inverts it.
import { cursorURL, CURSOR_HOT } from './icons.js';

function quadToSquare(q) {
  // q: [[x0,y0],[x1,y1],[x2,y2],[x3,y3]] for (0,0),(1,0),(1,1),(0,1)
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  let a, b, c, d, e, f, g, hh;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    a = x1 - x0; b = x3 - x0; c = x0; d = y1 - y0; e = y3 - y0; f = y0; g = 0; hh = 0;
  } else {
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    const den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-12) return null;
    g = (sx * dy2 - dx2 * sy) / den; hh = (dx1 * sy - sx * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + hh * x3; c = x0;
    d = y1 - y0 + g * y1; e = y3 - y0 + hh * y3; f = y0;
  }
  // inverse of [[a,b,c],[d,e,f],[g,h,1]]
  const A = e - f * hh, B = c * hh - b, C = b * f - c * e;
  const D = f * g - d, E = a - c * g, F = c * d - a * f;
  const G = d * hh - e * g, H = b * g - a * hh, I = a * e - b * d;
  if (Math.abs(I) < 1e-12 && Math.abs(A * a + B * d + C * g) < 1e-12) return null;
  return (x, y) => {
    const w = G * x + H * y + I;
    return [(A * x + B * y + C) / w, (D * x + E * y + F) / w];
  };
}

export class Cursor {
  constructor(os) {
    this.os = os;
    this.el = document.createElement('div');
    this.el.className = 'os-cursor';
    this.el.setAttribute('aria-hidden', 'true');
    this.kind = '';
    this.x = 512; this.y = 400;
    this.probes = ['0,0', '100%,0', '100%,100%', '0,100%'].map((p) => {
      const [l, t] = p.split(',');
      const d = document.createElement('div');
      d.className = 'os-probe'; d.style.left = l; d.style.top = t;
      return d;
    });
    this.map = null; this.mapAt = 0;
    this.set('arrow');
  }
  mount(screen) {
    screen.append(...this.probes, this.el);
  }
  set(kind) {
    if (kind === this.kind) return;
    this.kind = kind;
    const c = cursorURL(kind);
    const [hx, hy] = CURSOR_HOT[kind] || [0, 0];
    this.hot = [hx, hy];
    this.el.style.width = c.w + 'px'; this.el.style.height = c.h + 'px';
    this.el.style.backgroundImage = `url(${c.url})`;
    this.el.style.backgroundSize = `${c.w}px ${c.h}px`;
    this.place();
  }
  show(on) { this.el.classList.toggle('is-on', !!on); }
  moveTo(x, y) { this.x = x; this.y = y; this.place(); }
  place() {
    this.el.style.transform = `translate3d(${Math.round(this.x - this.hot[0])}px, ${Math.round(this.y - this.hot[1])}px, 0)`;
  }
  invalidate() { this.mapAt = 0; }
  // client px -> virtual px (null when the screen is not laid out)
  toVirtual(cx, cy, force) {
    const now = performance.now();
    if (force || !this.map || now - this.mapAt > 150) {
      const q = this.probes.map((p) => { const r = p.getBoundingClientRect(); return [r.left, r.top]; });
      const area = Math.abs((q[1][0] - q[0][0]) * (q[3][1] - q[0][1]) - (q[3][0] - q[0][0]) * (q[1][1] - q[0][1]));
      this.map = area > 4 ? quadToSquare(q) : null;
      this.mapAt = now;
    }
    if (!this.map) return null;
    const [u, v] = this.map(cx, cy);
    const s = this.os.size();
    return { x: u * s.w, y: v * s.h };
  }
  kindFor(target) {
    if (!(target instanceof Element)) return 'arrow';
    if (target.closest('.win-grip')) return 'resize';
    if (target.closest('input[type=text]:not([readonly]), textarea:not([readonly]), .term, .doc-page, .help p, .help li')) return 'text';
    if (target.closest('a[href], [data-cur=hand]')) return 'hand';
    return 'arrow';
  }
}
