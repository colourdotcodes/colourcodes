// ColourcodeOS icon set: original pixel art, drawn by code with one palette.
// Every icon exists at 32x32 (desktop, dialogs) and 16x16 (title bars, menus, taskbar).
import { Sprite, rgba, mix } from './pixel.js';

export const PAL = {
  ink: '#17140f',
  beige: ['#6b604c', '#968970', '#b9ac91', '#d6cbb2', '#e9e1cd', '#f8f3e7'],
  paper: ['#9a958a', '#c8c3b7', '#e3dfd6', '#f3f1eb', '#ffffff'],
  cream: ['#a19782', '#cbc1a9', '#e8e0cb', '#f7f1e2', '#fffcf3'],
  orange: ['#5a2506', '#8c400c', '#bf601a', '#e0812a', '#f1a556', '#fad19b'],
  gold: ['#573809', '#875a11', '#b6831e', '#d9ab40', '#efcf7c', '#fbeec4'],
  steel: ['#252a30', '#434b55', '#68727d', '#939ca6', '#bfc6cd', '#e9ecef'],
  blue: ['#0d1928', '#1a2f48', '#2a4c70', '#436e98', '#7099c0', '#b0cbe3'],
  red: ['#3d100c', '#6b1e16', '#983024', '#be4839', '#da7768', '#f1b1a6'],
  leather: ['#24140b', '#3f2416', '#5e3821', '#7f512e', '#a26e48', '#c4936c'],
  wood: ['#3a210e', '#5c391a', '#845429', '#a6713b', '#c7985c'],
  glass: ['#06080b', '#0f1318', '#182028', '#232d38', '#36424f'],
  skin: ['#6e4430', '#a26c4f', '#c99372', '#e3b694', '#f4d6bc'],
  note: ['#3b3934', '#5d5a52', '#837f75', '#aaa59a', '#cdc9bf', '#ebe8e0'],
};

const S32 = 32;

// ---- helpers ----------------------------------------------------------------
function cube(sp, x, y, s, faces, outline) {
  const h = s / 2, q = s / 4;
  const top = sp.poly([[x + h, y], [x + s, y + q], [x + h, y + h], [x, y + q]]);
  const left = sp.poly([[x, y + q], [x + h, y + h], [x + h, y + s], [x, y + s - q]]);
  const right = sp.poly([[x + h, y + h], [x + s, y + q], [x + s, y + s - q], [x + h, y + s]]);
  sp.fill(left, faces.left, { shade: 'v', lo: 0.35, hi: 0.75, outline: false });
  sp.fill(right, faces.right, { shade: 'v', lo: 0.15, hi: 0.5, outline: false });
  sp.fill(top, faces.top, { shade: 'd', lo: 0.6, hi: 1, outline: false });
  if (outline) sp.outline(sp.union(top, left, right), outline);
  return sp.union(top, left, right);
}

// Quadratic-bezier crescent (outer and inner arcs share end points).
function crescent(sp, p0, p1, c0, c1, n = 18) {
  const q = (a, c, b, t) => [(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]];
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(q(p0, c0, p1, i / n));
  for (let i = n; i >= 0; i--) pts.push(q(p0, c1, p1, i / n));
  return sp.poly(pts);
}

// ---- icons -------------------------------------------------------------------
const ICONS = {
  // colour.codes: a 3×3 mosaic of hash colours on dark glass (same as the site logo).
  logo(S) {
    const sp = new Sprite(S);
    const C = [['#ff6b5b', '#ffd166', '#7bdc8e'], ['#6ec3ff', '#c792ea', '#ff8fb1'], ['#9be7d8', '#ffa94d', '#8fa8ff']];
    const hx = (c, t, to) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(c.slice(i, i + 2), 16) * (1 - t) + to * t).toString(16).padStart(2, '0')).join('');
    const tone = (c) => [hx(c, 0.3, 0), c, hx(c, 0.3, 255)];
    if (S === 32) {
      sp.fill(sp.rect(1, 1, 30, 30, 6), PAL.glass, { shade: 'd', lo: 0.15, hi: 0.9, outline: '#1b1f1c' });
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        sp.fill(sp.rect(4.5 + c * 8, 4.5 + r * 8, 7, 7, 1.5), tone(C[r][c]), { shade: 'v', lo: 0.2, hi: 0.95, hl: 0.35, outline: false });
      }
      sp.hline(4, 12, 3, 'rgba(255,255,255,0.18)');
    } else {
      sp.fill(sp.rect(0, 0, 16, 16, 3), PAL.glass, { shade: 'd', lo: 0.15, hi: 0.9, outline: false });
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        sp.fill(sp.rect(2 + c * 4.3, 2 + r * 4.3, 3.6, 3.6, 0.6), tone(C[r][c]), { shade: 'v', lo: 0.3, hi: 1, outline: false });
      }
    }
    return sp;
  },

  agent(S) {
    const sp = new Sprite(S);
    if (S === 32) {
      sp.fill(sp.poly([[11.5, 23], [20.5, 23], [22, 27.5], [10, 27.5]]), PAL.beige, { shade: 'h', lo: 0.3, hi: 0.8 });
      sp.fill(sp.rect(5, 27, 22, 3.5, 1.5), PAL.beige, { shade: 'v', lo: 0.35, hi: 0.95, hl: 0.4 });
      sp.fill(sp.rect(1, 2, 30, 22.5, 2.5), PAL.beige, { shade: 'v', lo: 0.4, hi: 1, hl: 0.55, sh: 0.1 });
      sp.fill(sp.rect(4, 5, 24, 16, 1.5), PAL.beige, { shade: (u, v) => u * 0.4 + v * 0.6, lo: 0.25, hi: 0.6, outline: false });
      sp.fill(sp.rect(5, 6, 22, 14, 1), PAL.glass, { shade: 'd', lo: 0.1, hi: 0.95, outline: '#2c271f' });
      const o = PAL.orange[4], g = '#b8b2a6', dg = '#7b766c';
      sp.map(7, 8, ['o..', '.o.', 'o..'], { o });
      sp.hline(11, 21, 9, g);
      sp.hline(7, 18, 12, dg).hline(7, 23, 14, dg);
      sp.map(7, 16, ['o..', '.o.', 'o..'], { o });
      sp.hline(11, 13, 18, o);
      sp.dot(6, 7, 'rgba(255,255,255,0.18)').hline(7, 9, 7, 'rgba(255,255,255,0.08)');
      sp.dot(26, 22, PAL.orange[4]).dot(24, 22, '#8d826b');
      sp.shadow();
    } else {
      sp.fill(sp.rect(5.5, 12, 5, 2), PAL.beige, { shade: 'v', lo: 0.3, hi: 0.7 });
      sp.fill(sp.rect(3, 13, 10, 2.2, 0.8), PAL.beige, { shade: 'v', lo: 0.4, hi: 0.95 });
      sp.fill(sp.rect(0.5, 1, 15, 11.5, 1.5), PAL.beige, { shade: 'v', lo: 0.4, hi: 1, hl: 0.5 });
      sp.fill(sp.rect(2.5, 3, 11, 7.5), PAL.glass, { shade: 'd', lo: 0.1, hi: 0.95, outline: false });
      const o = PAL.orange[4];
      sp.map(3, 4, ['o.', '.o', 'o.'], { o });
      sp.hline(6, 11, 5, '#a9a397');
      sp.hline(3, 9, 8, '#7b766c');
      sp.hline(10, 11, 8, o);
    }
    return sp;
  },

  miner(S) {
    const sp = new Sprite(S);
    const emb = { top: ['#f1d58a', '#fff6d8'], left: ['#d9ab40', '#efcf7c'], right: ['#8a5c12', '#b6831e'] };
    if (S === 32) {
      const coin = sp.ellipse(13.5, 15, 12.5);
      sp.fill(coin, PAL.gold, { shade: 'sphere', lo: 0.25, hi: 1, hl: 0.3, outline: '#4a2f07' });
      sp.fill(sp.ellipse(13.5, 15, 9.5), PAL.gold, { shade: (u, v) => 0.3 + (u * 0.45 + v * 0.55) * 0.45, outline: false });
      sp.ring(13.5, 15, 10, 'rgba(110,70,10,0.6)', 'rgba(255,246,214,0.75)');
      cube(sp, 8.5, 9.5, 10, emb, '#6b4609');
      // pickaxe
      sp.fill(sp.stroke(13.5, 30, 26.5, 15.5, 2.6), PAL.wood, { shade: 'd', lo: 0.3, hi: 0.95, outline: '#2a1709' });
      const head = crescent(sp, [18.6, 10.6], [31.2, 23.4], [29.8, 11.2], [26.2, 16.2]);
      sp.fill(head, PAL.steel, { shade: 'd', lo: 0.25, hi: 1, hl: 0.35, outline: '#1d2126' });
      sp.fill(sp.rect(24.5, 15, 3.5, 3.5, 0.8), PAL.steel, { shade: 'd', lo: 0.15, hi: 0.6, outline: '#1d2126' });
      sp.shadow();
    } else {
      const coin = sp.ellipse(7, 8, 6.8);
      sp.fill(coin, PAL.gold, { shade: 'sphere', lo: 0.3, hi: 1, hl: 0.25, outline: '#5a3a0a' });
      cube(sp, 3.5, 4.5, 7, emb, '#7a5010');
      sp.fill(sp.stroke(7.5, 15.4, 14.3, 8.3, 1.6), PAL.wood, { shade: 'd', lo: 0.4, hi: 1, outline: '#2a1709' });
      const head = crescent(sp, [10.2, 5.2], [16, 11.6], [15.4, 5.4], [13.3, 8.2], 10);
      sp.fill(head, PAL.steel, { shade: 'd', lo: 0.35, hi: 1, outline: '#1d2126' });
    }
    return sp;
  },

  explorer(S) {
    const sp = new Sprite(S);
    const blk = { top: ['#b0cbe3', '#e4eef7'], left: ['#7099c0', '#a9c4de'], right: ['#2a4c70', '#436e98'] };
    const hot = { top: ['#f6c58a', '#fde6c4'], left: ['#e0812a', '#f1a556'], right: ['#8c400c', '#bf601a'] };
    if (S === 32) {
      sp.hline(10, 14, 8, '#5d6a77').hline(10, 14, 9, '#8d99a5');
      cube(sp, 1, 2, 11, blk, '#172a40');
      cube(sp, 13, 2, 11, blk, '#172a40');
      sp.hline(21, 24, 13, '#5d6a77');
      // magnifier
      sp.fill(sp.stroke(20.5, 21.5, 29, 29.5, 4.2), PAL.steel, { shade: 'd', lo: 0.05, hi: 0.45, hl: 0.25, outline: '#121518' });
      const ring = sp.ellipse(14.5, 18, 9.5), lens = sp.ellipse(14.5, 18, 7);
      sp.fill(sp.sub(ring, lens), PAL.steel, { shade: 'd', lo: 0.2, hi: 1, hl: 0.4, outline: '#1d2126' });
      sp.fill(lens, ['#9fb6c9', '#d6e3ee', '#f4f8fb'], { shade: 'd', lo: 0, hi: 1, outline: false });
      // the block seen through the lens, enlarged and warm
      const tmp = new Sprite(S);
      cube(tmp, 8.5, 12, 12, hot, '#6b2f08');
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (lens[y * S + x] && tmp.alpha(x, y)) sp.put(x, y, tmp.get(x, y));
      sp.dots([[10, 13], [11, 12], [12, 12]], 'rgba(255,255,255,0.75)');
      sp.shadow();
    } else {
      cube(sp, 0.5, 0.5, 7, blk, '#172a40');
      cube(sp, 7.5, 0.5, 7, blk, '#172a40');
      sp.fill(sp.stroke(10.5, 11, 15, 15.2, 2.6), PAL.steel, { shade: 'd', lo: 0.05, hi: 0.4, outline: '#121518' });
      const ring = sp.ellipse(7, 9, 5.6), lens = sp.ellipse(7, 9, 3.8);
      sp.fill(sp.sub(ring, lens), PAL.steel, { shade: 'd', lo: 0.25, hi: 1, outline: '#1d2126' });
      sp.fill(lens, ['#e0812a', '#f1a556', '#fad19b'], { shade: 'd', outline: false });
      sp.dot(5, 7, 'rgba(255,255,255,0.8)');
    }
    return sp;
  },

  pool(S) {
    const sp = new Sprite(S);
    const person = (cx, cy, r, shirt, lo) => {
      const body = sp.and(sp.ellipse(cx, cy + r * 2.75, r * 1.95, r * 1.9), sp.rect(0, 0, S, cy + r * 3.2));
      sp.fill(body, shirt, { shade: 'cylv', lo, hi: lo + 0.55, hl: 0.2 });
      sp.fill(sp.ellipse(cx, cy, r, r * 1.08), PAL.skin, { shade: 'sphere', lo: lo + 0.1, hi: 1, outline: '#3c2214' });
    };
    const coins = (x, y0, n, rx, ry, step) => {
      for (let i = 0; i < n; i++) {
        const y = y0 - i * step;
        sp.fill(sp.union(sp.rect(x - rx, y, rx * 2, step), sp.ellipse(x, y + step, rx, ry)), PAL.gold, { shade: 'cylv', lo: 0.2, hi: 0.85, outline: '#4a2f07' });
        sp.fill(sp.ellipse(x, y, rx, ry), PAL.gold, { shade: 'd', lo: 0.55, hi: 1, outline: '#5a3a0a' });
      }
    };
    if (S === 32) {
      person(19.5, 6.5, 4.2, PAL.steel, 0.15);
      person(10.5, 10, 4.6, PAL.blue, 0.25);
      coins(23, 27, 4, 7, 2.4, 3);
      sp.shadow();
    } else {
      person(10, 3.2, 2.3, PAL.steel, 0.2);
      person(5, 5, 2.6, PAL.blue, 0.3);
      coins(11.5, 13.2, 3, 4, 1.4, 1.8);
    }
    return sp;
  },

  whitepaper(S) {
    const sp = new Sprite(S);
    if (S === 32) {
      const page = sp.poly([[5, 1], [21, 1], [28, 8], [28, 31], [5, 31]]);
      sp.fill(page, PAL.paper, { shade: 'd', lo: 0.45, hi: 1, outline: '#6c675d' });
      const fold = sp.poly([[21, 1], [21, 8], [28, 8]]);
      sp.fill(fold, PAL.paper, { shade: 'd', lo: 0.2, hi: 0.75, outline: '#6c675d' });
      const ink = '#3b3832', g = '#a8a397';
      sp.hline(8, 18, 4, ink).hline(8, 16, 5, ink);
      sp.hline(8, 25, 9, g).hline(8, 23, 11, g);
      const o = { top: ['#f6c58a', '#fde6c4'], left: ['#e0812a', '#f1a556'], right: ['#8c400c', '#bf601a'] };
      cube(sp, 8, 13.5, 5, o, '#6b2f08');
      cube(sp, 14.5, 13.5, 5, o, '#6b2f08');
      cube(sp, 21, 13.5, 5, o, '#6b2f08');
      sp.hline(13, 14, 16, '#8f897d').hline(19, 20, 16, '#8f897d');
      sp.hline(8, 25, 21, g).hline(8, 24, 23, g).hline(8, 25, 25, g).hline(8, 19, 27, g);
      sp.shadow();
    } else {
      const page = sp.poly([[2, 0.5], [10.5, 0.5], [14, 4], [14, 15.5], [2, 15.5]]);
      sp.fill(page, PAL.paper, { shade: 'd', lo: 0.5, hi: 1, outline: '#6c675d' });
      sp.fill(sp.poly([[10.5, 0.5], [10.5, 4], [14, 4]]), PAL.paper, { shade: 'd', lo: 0.2, hi: 0.7, outline: '#6c675d' });
      sp.hline(4, 8, 3, '#3b3832');
      sp.hline(4, 12, 6, '#aaa599');
      sp.hline(4, 5, 8, PAL.orange[3]).hline(7, 8, 8, PAL.orange[3]).hline(10, 11, 8, PAL.orange[3]);
      sp.hline(4, 5, 9, PAL.orange[1]).hline(7, 8, 9, PAL.orange[1]).hline(10, 11, 9, PAL.orange[1]);
      sp.hline(4, 12, 11, '#aaa599').hline(4, 10, 13, '#aaa599');
    }
    return sp;
  },

  howto(S) {
    const sp = new Sprite(S);
    if (S === 32) {
      sp.fill(sp.rect(7, 4, 21, 27, 1), PAL.cream, { shade: 'h', lo: 0.35, hi: 0.95, outline: '#6d6450' });
      for (let y = 6; y < 30; y += 2) sp.hline(26, 27, y, 'rgba(120,108,84,0.35)');
      sp.hline(8, 26, 29, 'rgba(120,108,84,0.35)');
      const cover = sp.rect(3, 1, 22, 27.5, 1.5);
      sp.fill(cover, PAL.blue, { shade: 'h', lo: 0.25, hi: 0.8, hl: 0.35, outline: '#0a1420' });
      sp.fill(sp.rect(3, 1, 3, 27.5, 1), PAL.blue, { shade: 'h', lo: 0.05, hi: 0.35, outline: false });
      sp.outline(sp.rect(8, 4, 15, 21), 'rgba(239,207,124,0.55)');
      const q = '#f3dfa6';
      sp.map(11, 7, [
        '..####..',
        '.##..##.',
        '.##..##.',
        '.....##.',
        '....##..',
        '...##...',
        '...##...',
        '........',
        '...##...',
        '...##...',
      ], { '#': q });
      sp.fill(sp.poly([[17, 27], [21, 27], [21, 31.5], [19, 29.8], [17, 31.5]]), PAL.orange, { shade: 'h', lo: 0.4, hi: 0.9, outline: '#5a2506' });
      sp.shadow();
    } else {
      sp.fill(sp.rect(3.5, 2, 11, 13.5), PAL.cream, { shade: 'h', lo: 0.4, hi: 1, outline: '#6d6450' });
      const cover = sp.rect(1, 0.5, 11.5, 14, 1);
      sp.fill(cover, PAL.blue, { shade: 'h', lo: 0.3, hi: 0.85, hl: 0.3, outline: '#0a1420' });
      sp.vline(2, 1, 13, PAL.blue[1]);
      sp.map(5, 3, ['.##.', '#..#', '...#', '..#.', '.#..', '....', '.#..'], { '#': '#f3dfa6' });
      sp.fill(sp.rect(8.5, 13.5, 2, 2.5), PAL.orange, { shade: 'flat', outline: false });
    }
    return sp;
  },

  buy(S) {
    const sp = new Sprite(S);
    if (S === 32) {
      sp.fill(sp.ellipse(20, 9, 7.5), PAL.gold, { shade: 'sphere', lo: 0.3, hi: 1, hl: 0.3, outline: '#4a2f07' });
      sp.outline(sp.sub(sp.ellipse(20, 9.4, 5.6), sp.ellipse(20, 9.4, 4.6)), 'rgba(138,92,18,0.55)');
      sp.fill(sp.ellipse(12, 11, 6), PAL.gold, { shade: 'sphere', lo: 0.2, hi: 0.95, hl: 0.25, outline: '#4a2f07' });
      const body = sp.rect(2, 12, 27, 18, 3);
      sp.fill(body, PAL.leather, { shade: 'v', lo: 0.3, hi: 0.92, grain: 0.05, hl: 0.25, outline: '#160b05' });
      for (let x = 5; x <= 26; x += 2) sp.dot(x, 14, 'rgba(214,170,128,0.55)');
      for (let x = 5; x <= 26; x += 2) sp.dot(x, 27, 'rgba(214,170,128,0.35)');
      const flap = sp.rect(17, 16, 14, 8.5, 2);
      sp.fill(flap, PAL.leather, { shade: 'v', lo: 0.2, hi: 0.7, grain: 0.05, hl: 0.2, outline: '#160b05' });
      sp.fill(sp.ellipse(26, 20.3, 2), PAL.gold, { shade: 'sphere', lo: 0.3, hi: 1, outline: '#3a2405' });
      sp.shadow();
    } else {
      sp.fill(sp.ellipse(10, 4.5, 4), PAL.gold, { shade: 'sphere', lo: 0.3, hi: 1, outline: '#4a2f07' });
      sp.fill(sp.rect(0.5, 6, 14.5, 9.5, 1.8), PAL.leather, { shade: 'v', lo: 0.3, hi: 0.95, hl: 0.25, outline: '#160b05' });
      sp.fill(sp.rect(8.5, 8, 7, 4.5, 1), PAL.leather, { shade: 'v', lo: 0.2, hi: 0.65, outline: '#160b05' });
      sp.dot(13, 10, PAL.gold[4]);
    }
    return sp;
  },

  notes(S) {
    const sp = new Sprite(S);
    if (S === 32) {
      const pad = sp.rect(3, 4, 22, 27);
      sp.fill(pad, PAL.cream, { shade: 'd', lo: 0.45, hi: 1, outline: '#6d6450' });
      for (const y of [11, 15, 19, 23, 27]) sp.hline(4, 24, y, '#a9bdd1');
      sp.vline(7, 5, 30, '#d9968a');
      const ink = '#5a5650';
      sp.hline(9, 17, 10, ink).hline(19, 21, 10, ink);
      sp.hline(9, 14, 14, ink).hline(16, 22, 14, ink);
      sp.hline(9, 19, 18, ink);
      sp.hline(9, 12, 22, ink);
      for (let x = 6; x <= 22; x += 4) {
        sp.map(x, 1, ['.#.', '#.#', '#.#', '#.#', '.#.'], { '#': '#3d3a34' });
        sp.dot(x + 1, 6, 'rgba(0,0,0,0.25)');
      }
      // pencil
      sp.fill(sp.stroke(17.5, 28.5, 28.5, 17.5, 3.6), PAL.orange, { shade: 'd', lo: 0.25, hi: 0.95, outline: '#4a1d04' });
      sp.fill(sp.stroke(27.6, 18.4, 29.8, 16.2, 3.6), PAL.steel, { shade: 'd', lo: 0.3, hi: 1, outline: '#1d2126' });
      sp.fill(sp.stroke(29.6, 16.4, 30.6, 15.4, 3.4), ['#7a3f3a', '#b56a63', '#d99a92'], { shade: 'd', outline: '#3d1a16' });
      sp.fill(sp.poly([[15.6, 26.2], [19.8, 30.4], [13.6, 32]]), PAL.wood, { shade: 'd', lo: 0.6, hi: 1, outline: false });
      sp.dots([[14, 30], [14, 31], [15, 31], [13, 31]], '#2b2824');
      sp.shadow();
    } else {
      sp.fill(sp.rect(1.5, 2, 11.5, 13.5), PAL.cream, { shade: 'd', lo: 0.45, hi: 1, outline: '#6d6450' });
      for (const y of [6, 9, 12]) sp.hline(2, 12, y, '#a9bdd1');
      sp.vline(4, 3, 14, '#d9968a');
      for (let x = 3; x <= 11; x += 3) sp.vline(x, 0, 2, '#3d3a34');
      sp.fill(sp.stroke(9.5, 14.5, 14.8, 9.2, 2.4), PAL.orange, { shade: 'd', lo: 0.3, hi: 0.95, outline: '#4a1d04' });
      sp.dots([[8, 15]], '#2b2824');
    }
    return sp;
  },

  trash(S, full = true) {
    const sp = new Sprite(S);
    if (S === 32) {
      const body = sp.poly([[5, 9], [27, 9], [24.5, 31], [7.5, 31]]);
      sp.fill(body, PAL.steel, { shade: 'cylv', lo: 0.15, hi: 0.95, hl: 0.15, outline: '#1d2126' });
      for (const [x0, x1] of [[9.5, 11], [13.5, 14.3], [17.5, 17.7], [21.5, 21]]) {
        sp.line(Math.round(x0), 12, Math.round(x1), 29, 'rgba(37,42,48,0.55)');
        sp.line(Math.round(x0) + 1, 12, Math.round(x1) + 1, 29, 'rgba(255,255,255,0.22)');
      }
      sp.fill(sp.rect(7, 28.5, 18, 2.5), PAL.steel, { shade: 'v', lo: 0.1, hi: 0.5, outline: false });
      const rim = sp.ellipse(16, 9, 12, 3.6), inside = sp.ellipse(16, 9, 10, 2.4);
      sp.fill(rim, PAL.steel, { shade: 'v', lo: 0.4, hi: 1, outline: '#1d2126' });
      sp.fill(inside, PAL.steel, { shade: 'v', lo: 0, hi: 0.25, outline: false });
      if (full) {
        const front = sp.rect(0, 9.5, 32, 4);
        const b1 = sp.sub(sp.ellipse(12, 6.5, 5, 4.2), front), b2 = sp.sub(sp.ellipse(19.5, 5.2, 5.4, 4.6), front);
        sp.fill(b1, PAL.paper, { shade: 'sphere', lo: 0.35, hi: 1, outline: '#6c675d' });
        sp.fill(b2, PAL.paper, { shade: 'sphere', lo: 0.4, hi: 1, outline: '#6c675d' });
        sp.dots([[18, 3], [19, 4], [21, 5], [22, 6], [17, 6], [11, 5], [12, 6], [13, 8]], 'rgba(110,104,93,0.55)');
        sp.hline(5, 27, 10, 'rgba(37,42,48,0.0)');
      }
      sp.shadow();
    } else {
      const body = sp.poly([[2.5, 4.5], [13.5, 4.5], [12.2, 15.5], [3.8, 15.5]]);
      sp.fill(body, PAL.steel, { shade: 'cylv', lo: 0.2, hi: 1, outline: '#1d2126' });
      for (const x of [6, 8, 10]) sp.vline(x, 6, 14, 'rgba(37,42,48,0.5)');
      sp.fill(sp.ellipse(8, 4.5, 6, 1.7), PAL.steel, { shade: 'v', lo: 0.45, hi: 1, outline: '#1d2126' });
      sp.fill(sp.ellipse(8, 4.5, 4.5, 0.9), PAL.steel, { shade: 'flat', lo: 0.05, hi: 0.1, outline: false });
      if (full) sp.fill(sp.sub(sp.ellipse(9, 2.5, 3.2, 2.6), sp.rect(0, 4.6, 16, 4)), PAL.paper, { shade: 'sphere', lo: 0.4, hi: 1, outline: '#6c675d' });
    }
    return sp;
  },

  trashEmpty(S) { return ICONS.trash(S, false); },

  info(S) {
    const sp = new Sprite(S);
    const r = S === 32 ? 14 : 7.5, c = S / 2;
    sp.fill(sp.ellipse(c, c, r), PAL.blue, { shade: 'sphere', lo: 0.3, hi: 1, hl: 0.25, outline: S === 32 ? '#0a1420' : false });
    if (S === 32) sp.map(13, 6, ['.###.', '.###.', '.....', '####.', '.###.', '.###.', '.###.', '.###.', '.###.', '.###.', '.###.', '#####', '#####'].map((s) => s), { '#': '#ffffff' });
    else sp.map(7, 3, ['##', '..', '##', '##', '##', '##', '##'], { '#': '#ffffff' });
    if (S === 32) sp.shadow();
    return sp;
  },

  warn(S) {
    const sp = new Sprite(S);
    const amber = ['#6a3a06', '#a5620f', '#d48b1e', '#ecb03f', '#f8d27d', '#fdeec0'];
    if (S === 32) {
      sp.fill(sp.poly([[16, 1.5], [30.8, 29], [1.2, 29]]), amber, { shade: 'v', lo: 0.35, hi: 1, hl: 0.3, outline: '#4a2804' });
      sp.fill(sp.rect(14.5, 10, 3, 11, 1), ['#1d1710', '#3a2f20'], { shade: 'flat', outline: false });
      sp.fill(sp.rect(14.5, 23, 3, 3, 0.5), ['#1d1710', '#3a2f20'], { shade: 'flat', outline: false });
      sp.shadow();
    } else {
      sp.fill(sp.poly([[8, 0.5], [15.6, 14.8], [0.4, 14.8]]), amber, { shade: 'v', lo: 0.4, hi: 1, outline: '#4a2804' });
      sp.vline(7, 5, 9, '#1d1710').vline(8, 5, 9, '#1d1710');
      sp.dots([[7, 11], [8, 11], [7, 12], [8, 12]], '#1d1710');
    }
    return sp;
  },

  error(S) {
    const sp = new Sprite(S);
    if (S === 32) {
      sp.fill(sp.ellipse(16, 16, 14), PAL.red, { shade: 'sphere', lo: 0.3, hi: 1, hl: 0.25, outline: '#2a0a07' });
      sp.fill(sp.union(sp.stroke(10.5, 10.5, 21.5, 21.5, 3.6), sp.stroke(21.5, 10.5, 10.5, 21.5, 3.6)), ['#e9e4dc', '#ffffff'], { shade: 'flat', outline: false });
      sp.shadow();
    } else {
      sp.fill(sp.ellipse(8, 8, 7.5), PAL.red, { shade: 'sphere', lo: 0.3, hi: 1, outline: false });
      sp.fill(sp.union(sp.stroke(5, 5, 11, 11, 2), sp.stroke(11, 5, 5, 11, 2)), ['#ffffff', '#ffffff'], { shade: 'flat', outline: false });
    }
    return sp;
  },

  ok(S) {
    const sp = new Sprite(S);
    const r = S === 32 ? 14 : 7.5, c = S / 2, k = S / 16;
    sp.fill(sp.ellipse(c, c, r), PAL.blue, { shade: 'sphere', lo: 0.35, hi: 1, outline: S === 32 ? '#0a1420' : false });
    sp.fill(sp.union(sp.stroke(4.2 * k, 8.4 * k, 6.8 * k, 11 * k, 2 * k), sp.stroke(6.8 * k, 11 * k, 11.8 * k, 5 * k, 2 * k)), ['#ffffff', '#ffffff'], { shade: 'flat', outline: false });
    if (S === 32) sp.shadow();
    return sp;
  },

  network(S, on = true) {
    const sp = new Sprite(S);
    const scr = on ? ['#2a4c70', '#7099c0', '#cfe0ef'] : PAL.glass;
    const mon = (x, y, w, h) => {
      sp.fill(sp.rect(x, y, w, h, 0.6), PAL.beige, { shade: 'v', lo: 0.4, hi: 1, outline: '#3b352a' });
      sp.fill(sp.rect(x + 1.2, y + 1.2, w - 2.4, h - 2.6), scr, { shade: 'd', outline: false });
    };
    if (S === 16) {
      mon(6, 0.5, 9.5, 7.5);
      sp.vline(10, 8, 9, '#3b352a');
      mon(0.5, 6, 9.5, 7.5);
      sp.hline(3, 7, 14, '#3b352a').hline(2, 8, 15, '#6b604c');
    } else {
      mon(12, 1, 19, 15);
      mon(1, 12, 19, 15);
      sp.fill(sp.rect(6, 27, 9, 3), PAL.beige, { shade: 'v', outline: '#3b352a' });
      sp.shadow();
    }
    return sp;
  },
  networkOff(S) { return ICONS.network(S, false); },

  note(S) {
    const sp = new Sprite(S);
    const bill = (x, y, w, h, lo) => {
      sp.fill(sp.rect(x, y, w, h, 0.8), PAL.note, { shade: 'd', lo, hi: lo + 0.45, grain: 0.03, outline: '#24221e' });
      sp.outline(sp.rect(x + 2, y + 2, w - 4, h - 4), 'rgba(40,38,34,0.35)');
      sp.fill(sp.ellipse(x + w / 2, y + h / 2, h * 0.24, h * 0.3), PAL.note, { shade: 'd', lo: lo - 0.15, hi: lo + 0.2, outline: 'rgba(40,38,34,0.5)' });
    };
    if (S === 32) {
      bill(1, 7, 27, 14, 0.35);
      bill(3, 10, 27, 14, 0.4);
      bill(5, 14, 26, 14, 0.5);
      sp.dots([[8, 17], [9, 17], [26, 24], [27, 24]], 'rgba(40,38,34,0.6)');
      sp.shadow();
    } else {
      bill(0.5, 3, 13.5, 8, 0.35);
      bill(2.5, 6.5, 13, 8, 0.5);
    }
    return sp;
  },

  power(S) {
    const sp = new Sprite(S);
    const c = S / 2, r = S === 32 ? 14 : 7.5, k = S / 16;
    sp.fill(sp.ellipse(c, c, r), PAL.red, { shade: 'sphere', lo: 0.25, hi: 0.95, hl: 0.2, outline: S === 32 ? '#2a0a07' : false });
    const ring = sp.sub(sp.ellipse(c, c + 0.6 * k, 4.6 * k), sp.ellipse(c, c + 0.6 * k, 3.1 * k), sp.rect(c - 1.9 * k, 0, 3.8 * k, c));
    sp.fill(sp.union(ring, sp.rect(c - 0.9 * k, 2.6 * k, 1.8 * k, 5.4 * k)), ['#ffffff', '#ffffff'], { shade: 'flat', outline: false });
    if (S === 32) sp.shadow();
    return sp;
  },

  copy(S) {
    const sp = new Sprite(S);
    const k = S / 16;
    sp.fill(sp.rect(1 * k, 1 * k, 9 * k, 11 * k), PAL.paper, { shade: 'd', lo: 0.4, hi: 0.9, outline: '#5b574f' });
    sp.fill(sp.rect(5.5 * k, 4.5 * k, 9 * k, 11 * k), PAL.paper, { shade: 'd', lo: 0.55, hi: 1, outline: '#5b574f' });
    for (let y = 7; y <= 13; y += 2) sp.hline(Math.round(7.5 * k), Math.round(12.5 * k), Math.round(y * k), '#a8a397');
    return sp;
  },

  connect(S) {
    // wallet-plug: a small leather wallet with a link chevron
    return ICONS.buy(S);
  },

  folder(S) {
    const sp = new Sprite(S);
    const k = S / 16;
    sp.fill(sp.rect(0.5 * k, 2 * k, 6.5 * k, 3 * k, 0.8 * k), PAL.gold, { shade: 'v', lo: 0.4, hi: 0.8, outline: '#5a3a0a' });
    sp.fill(sp.rect(0.5 * k, 3.5 * k, 15 * k, 11.5 * k, 0.8 * k), PAL.gold, { shade: 'v', lo: 0.45, hi: 1, hl: 0.3, outline: '#5a3a0a' });
    if (S === 32) sp.shadow();
    return sp;
  },

  globe(S) {
    const sp = new Sprite(S);
    const k = S / 32, c = S / 2, r = S === 32 ? 13.5 : 7.4;
    const ball = sp.ellipse(c, c, r);
    sp.fill(ball, PAL.blue, { shade: 'sphere', lo: 0.3, hi: 1, hl: 0.25, outline: S === 32 ? '#0a1420' : '#13263c' });
    const land = '#c9a25a', landDk = 'rgba(122,88,32,0.9)';
    const meridian = (rx) => sp.and(sp.sub(sp.ellipse(c, c, rx, r - 0.2), sp.ellipse(c, c, Math.max(0.1, rx - 1), r - 1.2)), ball);
    const lat = (y) => sp.and(sp.rect(0, y, S, 1), ball);
    if (S === 32) {
      sp.paint(meridian(6), 'rgba(214,232,247,0.45)');
      sp.paint(lat(10), 'rgba(214,232,247,0.35)'); sp.paint(lat(21), 'rgba(214,232,247,0.35)'); sp.paint(lat(15.5), 'rgba(214,232,247,0.45)');
      const cont = sp.and(sp.union(sp.ellipse(11, 11, 5, 4), sp.ellipse(9, 17, 3, 5), sp.ellipse(21, 19, 5, 6), sp.ellipse(22, 9, 3, 2)), ball);
      sp.fill(cont, ['#7a5820', '#b38a43', '#d9b875'], { shade: 'd', lo: 0.3, hi: 1, outline: false });
      sp.ring(c, c, r - 0.5, 'rgba(255,255,255,0.0)', 'rgba(0,0,0,0.0)');
      sp.dots([[9, 6], [10, 6], [8, 7]], 'rgba(255,255,255,0.75)');
      sp.shadow();
    } else {
      sp.paint(meridian(3), 'rgba(214,232,247,0.45)');
      sp.paint(lat(7.5), 'rgba(214,232,247,0.4)');
      const cont = sp.and(sp.union(sp.ellipse(5.5, 5.5, 2.6, 2), sp.ellipse(10.5, 9.5, 2.6, 3)), ball);
      sp.fill(cont, ['#7a5820', '#b38a43', '#d9b875'], { shade: 'd', lo: 0.4, hi: 1, outline: false });
    }
    return sp;
  },

  file(S) {
    const sp = new Sprite(S);
    const k = S / 16;
    sp.fill(sp.poly([[2 * k, 0.5 * k], [10.5 * k, 0.5 * k], [14 * k, 4 * k], [14 * k, 15.5 * k], [2 * k, 15.5 * k]]), PAL.paper, { shade: 'd', lo: 0.5, hi: 1, outline: '#6c675d' });
    sp.fill(sp.poly([[10.5 * k, 0.5 * k], [10.5 * k, 4 * k], [14 * k, 4 * k]]), PAL.paper, { shade: 'd', lo: 0.2, hi: 0.7, outline: '#6c675d' });
    const g = sp.sub(sp.union(sp.ellipse(8 * k, 9.5 * k, 3.6 * k), sp.rect(7.2 * k, 4.6 * k, 1.6 * k, 9.8 * k), sp.rect(3.1 * k, 8.7 * k, 9.8 * k, 1.6 * k)), sp.ellipse(8 * k, 9.5 * k, 1.3 * k));
    sp.fill(g, PAL.steel, { shade: 'd', lo: 0.25, hi: 0.95, outline: '#1d2126' });
    if (S === 32) sp.shadow();
    return sp;
  },

  chain(S) {
    // a single block (cube) for list rows
    const sp = new Sprite(S);
    const blk = { top: ['#f6c58a', '#fde6c4'], left: ['#e0812a', '#f1a556'], right: ['#8c400c', '#bf601a'] };
    cube(sp, S === 16 ? 1.5 : 3, S === 16 ? 1 : 2, S === 16 ? 13 : 26, blk, '#5a2506');
    if (S === 32) sp.shadow();
    return sp;
  },
};

// ---- cache -------------------------------------------------------------------
const cache = new Map();
export function iconURL(name, size = 32) {
  const key = name + '@' + size;
  if (!cache.has(key)) {
    const fn = ICONS[name] || ICONS.info;
    cache.set(key, fn(size).toDataURL());
  }
  return cache.get(key);
}

export function iconImg(name, size = 32, cls = '') {
  const img = document.createElement('img');
  img.src = iconURL(name, size);
  img.width = size; img.height = size;
  img.alt = '';
  img.draggable = false;
  img.className = ('px-icon ' + cls).trim();
  return img;
}

export const ICON_NAMES = Object.keys(ICONS);

// ---- cursors -----------------------------------------------------------------
// k = black edge, w = white fill. Hot spots in CURSOR_HOT.
const CURSORS = {
  arrow: [
    'k...........',
    'kk..........',
    'kwk.........',
    'kwwk........',
    'kwwwk.......',
    'kwwwwk......',
    'kwwwwwk.....',
    'kwwwwwwk....',
    'kwwwwwwwk...',
    'kwwwwwwwwk..',
    'kwwwwwwwwwk.',
    'kwwwwwwkkkkk',
    'kwwwkwwk....',
    'kwwk.kwwk...',
    'kwk..kwwk...',
    'kk....kwwk..',
    'k.....kwwk..',
    '.......kwwk.',
    '.......kkk..',
  ],
  hand: [
    '.....kk..........',
    '....kwwk.........',
    '....kwwk.........',
    '....kwwk.........',
    '....kwwk.........',
    '....kwwkkk.......',
    '....kwwkwwkkk....',
    '....kwwkwwkwwkk..',
    '.kk.kwwkwwkwwkwk.',
    'kwwkkwwwwwwwwkwwk',
    'kwwwkwwwwwwwwwwwk',
    '.kwwkwwwwwwwwwwwk',
    '..kwwwwwwwwwwwwwk',
    '..kwwwwwwwwwwwwk.',
    '...kwwwwwwwwwwwk.',
    '...kwwwwwwwwwwk..',
    '....kwwwwwwwwwk..',
    '....kwwwwwwwwwk..',
    '....kkkkkkkkkkk..',
  ],
  text: [
    'wwwwwww',
    'kkkwkkk',
    'wwwkwww',
    '..wkw..',
    '..wkw..',
    '..wkw..',
    '..wkw..',
    '..wkw..',
    '..wkw..',
    '..wkw..',
    '..wkw..',
    '..wkw..',
    '..wkw..',
    'wwwkwww',
    'kkkwkkk',
    'wwwwwww',
  ],
  resize: [
    'kkkkkk.....',
    'kwwwwk.....',
    'kwwwk......',
    'kwwwwk.....',
    'kwkwwwk....',
    'kk.kwwwk.kk',
    '....kwwwkwk',
    '.....kwwwwk',
    '......kwwwk',
    '.....kwwwwk',
    '.....kkkkkk',
  ],
  busy: [
    'kkkkkkkkkkk',
    'kwwwwwwwwwk',
    '.kwwwwwwwk.',
    '.kwokokowk.',
    '..kwooowk..',
    '...kwowk...',
    '....kwk....',
    '...kwwwk...',
    '..kwwowwk..',
    '.kwwwowwwk.',
    '.kwwooowwk.',
    'kwwooooowwk',
    'kkkkkkkkkkk',
  ],
};
export const CURSOR_HOT = { arrow: [0, 0], hand: [5, 0], text: [3, 8], resize: [5, 5], busy: [5, 6] };

export function cursorURL(name) {
  const key = 'cur:' + name;
  if (!cache.has(key)) {
    const rows = CURSORS[name] || CURSORS.arrow;
    const w = Math.max(...rows.map((r) => r.length)), h = rows.length;
    const sp = new Sprite(w + 1, h + 1);
    sp.map(0, 0, rows, { k: '#0b0a09', w: '#ffffff', o: PAL.orange[3] });
    sp.shadow([[1, 1, 0.28]]);
    cache.set(key, { url: sp.toDataURL(), w: w + 1, h: h + 1 });
  }
  return cache.get(key);
}

// Small decorative helpers used by the chrome (title-bar glyphs are CSS).
export { rgba, mix };
