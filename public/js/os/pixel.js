// Tiny pixel-art engine for ColourcodeOS icons.
// Shapes are rasterised on an integer grid (pixel-centre test, no anti-aliasing),
// shaded with a material ramp, then given a selective outline, an inner bevel
// and an optional soft drop shadow. Every icon in the set goes through the same
// rules, which is what keeps them looking like one family.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function rgba(c) {
  if (Array.isArray(c)) return c.length === 4 ? c : [...c, 1];
  if (c.startsWith('rgba') || c.startsWith('rgb')) {
    const n = c.match(/[\d.]+/g).map(Number);
    return [n[0], n[1], n[2], n[3] ?? 1];
  }
  let h = c.slice(1);
  if (h.length === 3) h = h.replace(/./g, '$&$&');
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1];
}

export const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t,
];

// Piecewise-linear colour along a ramp (dark -> light).
export function ramp(stops, t) {
  const r = stops.map(rgba);
  t = clamp(t, 0, 1) * (r.length - 1);
  const i = Math.min(r.length - 2, Math.floor(t));
  return mix(r[i], r[i + 1], t - i);
}

// Deterministic per-pixel noise in [-1, 1] (material grain, never random).
const hash = (x, y, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) / 4294967295) * 2 - 1;
};

export class Sprite {
  constructor(w, h = w) {
    this.w = w; this.h = h;
    this.px = new Float32Array(w * h * 4);
  }
  inside(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x, y) { const i = (y * this.w + x) * 4; return [this.px[i], this.px[i + 1], this.px[i + 2], this.px[i + 3]]; }
  alpha(x, y) { return this.inside(x, y) ? this.px[(y * this.w + x) * 4 + 3] : 0; }
  // Source-over composite.
  put(x, y, c) {
    if (!this.inside(x, y)) return;
    c = rgba(c);
    const i = (y * this.w + x) * 4, a = c[3];
    if (a <= 0) return;
    const da = this.px[i + 3], oa = a + da * (1 - a);
    for (let k = 0; k < 3; k++) this.px[i + k] = oa ? (c[k] * a + this.px[i + k] * da * (1 - a)) / oa : 0;
    this.px[i + 3] = oa;
  }
  clear(x, y) { if (this.inside(x, y)) this.px.fill(0, (y * this.w + x) * 4, (y * this.w + x) * 4 + 4); }

  // ---- masks -------------------------------------------------------------
  mask(fn) {
    const m = new Uint8Array(this.w * this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (fn(x + 0.5, y + 0.5, x, y)) m[y * this.w + x] = 1;
    return m;
  }
  rect(x, y, w, h, r = 0) {
    return this.mask((px, py) => {
      if (px < x || py < y || px > x + w || py > y + h) return false;
      if (!r) return true;
      const cx = clamp(px, x + r, x + w - r), cy = clamp(py, y + r, y + h - r);
      return (px - cx) ** 2 + (py - cy) ** 2 <= r * r + 0.01;
    });
  }
  ellipse(cx, cy, rx, ry = rx) {
    return this.mask((px, py) => ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 <= 1.0001);
  }
  poly(pts) {
    return this.mask((px, py) => {
      let inn = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inn = !inn;
      }
      return inn;
    });
  }
  // Thick line as a capsule.
  stroke(x0, y0, x1, y1, w = 1) {
    const dx = x1 - x0, dy = y1 - y0, L = dx * dx + dy * dy || 1, r = w / 2;
    return this.mask((px, py) => {
      const t = clamp(((px - x0) * dx + (py - y0) * dy) / L, 0, 1);
      return (px - x0 - t * dx) ** 2 + (py - y0 - t * dy) ** 2 <= r * r + 0.02;
    });
  }
  union(...ms) { const m = new Uint8Array(this.w * this.h); for (const n of ms) for (let i = 0; i < m.length; i++) m[i] |= n[i]; return m; }
  sub(a, ...bs) { const m = a.slice(); for (const b of bs) for (let i = 0; i < m.length; i++) if (b[i]) m[i] = 0; return m; }
  and(a, b) { const m = a.slice(); for (let i = 0; i < m.length; i++) m[i] &= b[i]; return m; }
  bbox(m) {
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (m[y * this.w + x]) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  // ---- filling -----------------------------------------------------------
  // opts: shade ('v'|'h'|'d'|'sphere'|'cylh'|'cylv'|'flat'|fn), lo, hi, grain,
  //       outline (colour|'auto'|false), hl (0..1 inner highlight), sh (0..1 inner shadow),
  //       outline8 (diagonal neighbours too)
  fill(m, stops, o = {}) {
    const b = this.bbox(m);
    if (b.x1 < 0) return this;
    const lo = o.lo ?? 0, hi = o.hi ?? 1, W = this.w;
    const at = (x, y) => (x >= 0 && y >= 0 && x < this.w && y < this.h ? m[y * W + x] : 0);
    const shade = typeof o.shade === 'function' ? o.shade : SHADES[o.shade || 'v'];
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
      if (!m[y * W + x]) continue;
      const u = b.w > 1 ? (x - b.x0) / (b.w - 1) : 0.5, v = b.h > 1 ? (y - b.y0) / (b.h - 1) : 0.5;
      let t = lo + (hi - lo) * clamp(shade(u, v, x, y, b), 0, 1);
      if (o.grain) t += hash(x, y, o.seed || 1) * o.grain;
      let c = ramp(stops, t);
      const top = !at(x, y - 1) || !at(x - 1, y), bot = !at(x, y + 1) || !at(x + 1, y);
      if (o.hl && top && !bot) c = mix(c, [255, 255, 255, c[3]], o.hl);
      if (o.sh && bot && !top) c = mix(c, [0, 0, 0, c[3]], o.sh);
      if (o.alpha != null) c[3] *= o.alpha;
      this.put(x, y, c);
    }
    if (o.outline !== false) this.outline(m, o.outline === undefined || o.outline === 'auto' ? darker(stops) : o.outline, o.outline8, o.outlineTop);
    return this;
  }
  // Selective outline: full strength on the bottom/right, softened on the top/left.
  outline(m, color, diag = false, topColor) {
    const W = this.w, c = rgba(color), ct = topColor ? rgba(topColor) : c;
    const at = (x, y) => (x >= 0 && y >= 0 && x < this.w && y < this.h ? m[y * W + x] : 0);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (m[y * W + x]) continue;
      const below = at(x, y + 1), right = at(x + 1, y), above = at(x, y - 1), left = at(x - 1, y);
      const n = below || right || above || left || (diag && (at(x - 1, y - 1) || at(x + 1, y - 1) || at(x - 1, y + 1) || at(x + 1, y + 1)));
      if (!n) continue;
      this.put(x, y, (below || left) && !(above || right) ? ct : above || right ? c : ct);
    }
    return this;
  }
  paint(m, c) { for (let i = 0; i < m.length; i++) if (m[i]) this.put(i % this.w, (i / this.w) | 0, c); return this; }
  // Engraved ring: dark on the upper-left arc, light on the lower-right arc.
  ring(cx, cy, r, dark, light) {
    const m = this.sub(this.ellipse(cx, cy, r), this.ellipse(cx, cy, r - 1));
    for (let i = 0; i < m.length; i++) if (m[i]) {
      const x = i % this.w + 0.5, y = ((i / this.w) | 0) + 0.5;
      this.put(x - 0.5, y - 0.5, (x - cx) + (y - cy) < 0 ? dark : light);
    }
    return this;
  }
  // Direct pixels / lines in a flat colour.
  dot(x, y, c) { this.put(x, y, c); return this; }
  dots(list, c) { for (const [x, y] of list) this.put(x, y, c); return this; }
  hline(x0, x1, y, c) { for (let x = x0; x <= x1; x++) this.put(x, y, c); return this; }
  vline(x, y0, y1, c) { for (let y = y0; y <= y1; y++) this.put(x, y, c); return this; }
  line(x0, y0, x1, y1, c) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let e = dx + dy;
    for (;;) {
      this.put(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e;
      if (e2 >= dy) { e += dy; x0 += sx; }
      if (e2 <= dx) { e += dx; y0 += sy; }
    }
    return this;
  }
  // Paint from a character map (for tiny hand-placed details).
  map(x, y, rows, pal) {
    rows.forEach((row, j) => [...row].forEach((ch, i) => { if (pal[ch]) this.put(x + i, y + j, pal[ch]); }));
    return this;
  }
  // Soft drop shadow beneath everything drawn so far.
  shadow(steps = [[1, 1, 0.32], [2, 2, 0.14]]) {
    const src = this.px.slice();
    const a = (x, y) => (x >= 0 && y >= 0 && x < this.w && y < this.h ? src[(y * this.w + x) * 4 + 3] : 0);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (a(x, y) >= 0.99) continue;
      let s = 0;
      for (const [dx, dy, k] of steps) s = Math.max(s, a(x - dx, y - dy) * k);
      if (s > 0) {
        const i = (y * this.w + x) * 4, da = src[i + 3];
        // put shadow *under* the existing pixel
        const oa = da + s * (1 - da);
        for (let k = 0; k < 3; k++) this.px[i + k] = oa ? (src[i + k] * da) / oa : 0;
        this.px[i + 3] = oa;
      }
    }
    return this;
  }
  toCanvas(doc = document) {
    const c = doc.createElement('canvas');
    c.width = this.w; c.height = this.h;
    const ctx = c.getContext('2d'), img = ctx.createImageData(this.w, this.h);
    for (let i = 0; i < this.px.length; i += 4) {
      img.data[i] = Math.round(this.px[i]); img.data[i + 1] = Math.round(this.px[i + 1]);
      img.data[i + 2] = Math.round(this.px[i + 2]); img.data[i + 3] = Math.round(clamp(this.px[i + 3], 0, 1) * 255);
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
  toDataURL() { return this.toCanvas().toDataURL('image/png'); }
}

export function darker(stops) {
  const c = rgba(stops[0]);
  return [c[0] * 0.55, c[1] * 0.55, c[2] * 0.55, 1];
}

export const SHADES = {
  flat: () => 0.6,
  v: (u, v) => 1 - v,
  h: (u) => 1 - u,
  d: (u, v) => 1 - (u * 0.45 + v * 0.55),
  sphere: (u, v) => 1 - Math.hypot(u - 0.32, v - 0.28) / 1.05,
  cylh: (u, v) => 1 - Math.abs(v - 0.3) * 1.35,
  cylv: (u) => 1 - Math.abs(u - 0.32) * 1.35,
};
