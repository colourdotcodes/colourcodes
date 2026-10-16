// Regenerates public/vendor/keccak/keccak-pow.js — the proof-of-work kernel shared by the browser
// worker and the CLI miner. Run: node miner/build-kernel.mjs
//
// Two engines, same result:
//   wasm  a ~1.3 KB WebAssembly module assembled below (64-bit lanes, ~5x faster than JS)
//   js    js-sha3's Keccak-f[1600] round (MIT, public/vendor/keccak/LICENSE) rewritten to local variables
// Both are specialised for one message: keccak256(challenge[32] ‖ beneficiary[20] ‖ nonce[32]).
// The script checks both against ethers' keccak256 before writing the file.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { keccak256, solidityPacked, hexlify } from 'ethers';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SHA3 = ROOT + 'public/vendor/keccak/sha3.js';
const OUT = ROOT + 'public/vendor/keccak/keccak-pow.js';

// ------------------------------------------------------------------ JS engine (from js-sha3)
const src = readFileSync(SHA3, 'utf8');
const loopStart = src.indexOf('for (n = 0; n < 48; n += 2) {');
if (loopStart < 0) throw new Error('js-sha3 round loop not found');
let end = -1;
for (let i = src.indexOf('{', loopStart), depth = 0; i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}' && --depth === 0) { end = i; break; }
}
const roundBody = src.slice(src.indexOf('{', loopStart) + 1, end)
  .replace(/s\[(\d+)\]/g, 's$1')
  .split('\n').map((l) => l.trim()).filter(Boolean);
const RC_SRC = src.match(/var RC = \[([\s\S]*?)\];/)[1].replace(/\s+/g, ' ').trim();
const RC = RC_SRC.split(',').map((x) => Number(x.trim()));

// ------------------------------------------------------------------ WASM engine (assembled here)
// Memory (1 page): 0..199 base state (25 x i64 LE lanes), 256 hit count (i32), 260.. hit lo values (i32 x63),
// 512..703 round constants (24 x i64), 1024.. hit digests (32 bytes each).
// export search(mid:i32, lo:i32, count:i32, tgtTop:i32) -> i32 hashed
function buildWasm() {
  const op = {
    block: 0x02, loop: 0x03, if: 0x04, end: 0x0b, br: 0x0c, br_if: 0x0d,
    lget: 0x20, lset: 0x21, ltee: 0x22, i64load: 0x29, i32store: 0x36, i64store: 0x37,
    i32const: 0x41, i64const: 0x42, i32eqz: 0x45, i32lt_u: 0x49, i32le_u: 0x4d, i32ge_u: 0x4f,
    i32add: 0x6a, i32and: 0x71, i32or: 0x72, i32shl: 0x74, i32shr_u: 0x76,
    i64and: 0x83, i64or: 0x84, i64xor: 0x85, i64shl: 0x86, i64rotl: 0x89, i32wrap: 0xa7, i64ext_u: 0xad,
  };
  const uleb = (n) => { const o = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b); } while (n); return o; };
  const sleb = (v) => {
    const o = []; let more = true;
    while (more) {
      let b = Number(v & 0x7fn); v >>= 7n;
      if ((v === 0n && !(b & 0x40)) || (v === -1n && (b & 0x40))) more = false; else b |= 0x80;
      o.push(b);
    }
    return o;
  };
  // params 0..3 (i32) mid, lo, count, tgt | i32 locals 4 i, 5 hits, 6 x, 7 r, 8 tmp
  // i64 locals 9 lane9, 10 lane10hi, 11..35 A, 36..60 B, 61..65 C, 66 D
  const MID = 0, LO = 1, CNT = 2, TGT = 3, I = 4, HITS = 5, X = 6, R = 7, T = 8, L9 = 9, L10 = 10, D = 66;
  const A = (k) => 11 + k, B = (k) => 36 + k, C = (k) => 61 + k;
  const code = [];
  const e = (...b) => code.push(...b);
  const get = (l) => e(op.lget, ...uleb(l));
  const set = (l) => e(op.lset, ...uleb(l));
  const tee = (l) => e(op.ltee, ...uleb(l));
  const i32c = (v) => e(op.i32const, ...sleb(BigInt(v | 0)));
  const i64c = (v) => e(op.i64const, ...sleb(BigInt.asIntN(64, BigInt(v))));
  const mem = (o, align, off) => e(o, align, ...uleb(off));
  const bswap32 = () => {
    set(T);
    get(T); i32c(24); e(op.i32shl);
    get(T); i32c(0xff00); e(op.i32and); i32c(8); e(op.i32shl); e(op.i32or);
    get(T); i32c(8); e(op.i32shr_u); i32c(0xff00); e(op.i32and); e(op.i32or);
    get(T); i32c(24); e(op.i32shr_u); e(op.i32or);
  };
  const RHO = [[0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14]];
  const lane = (x, y) => x + 5 * y;

  i32c(0); mem(op.i64load, 3, 72); i64c(0xffffffffn); e(op.i64and);
  get(MID); bswap32(); e(op.i64ext_u); i64c(32); e(op.i64shl); e(op.i64or); set(L9);
  i32c(0); mem(op.i64load, 3, 80); i64c(0xffffffff00000000n); e(op.i64and); set(L10);
  i32c(0); set(I); i32c(0); set(HITS);
  e(op.block, 0x40);
  get(CNT); e(op.i32eqz); e(op.br_if, 0);
  e(op.loop, 0x40);
  get(LO); get(I); e(op.i32add); set(X);
  for (let k = 0; k < 25; k++) {
    if (k === 9) { get(L9); set(A(k)); continue; }
    if (k === 10) { get(X); bswap32(); e(op.i64ext_u); get(L10); e(op.i64or); set(A(k)); continue; }
    i32c(0); mem(op.i64load, 3, 8 * k); set(A(k));
  }
  i32c(0); set(R);
  e(op.loop, 0x40);
  for (let x = 0; x < 5; x++) { get(A(lane(x, 0))); for (let y = 1; y < 5; y++) { get(A(lane(x, y))); e(op.i64xor); } set(C(x)); }
  for (let x = 0; x < 5; x++) {
    get(C((x + 4) % 5)); get(C((x + 1) % 5)); i64c(1); e(op.i64rotl); e(op.i64xor); set(D);
    for (let y = 0; y < 5; y++) { get(A(lane(x, y))); get(D); e(op.i64xor); set(A(lane(x, y))); }
  }
  for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
    get(A(lane(x, y))); if (RHO[x][y]) { i64c(RHO[x][y]); e(op.i64rotl); } set(B(lane(y, (2 * x + 3 * y) % 5)));
  }
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    get(B(lane(x, y))); get(B(lane((x + 1) % 5, y))); i64c(-1); e(op.i64xor);
    get(B(lane((x + 2) % 5, y))); e(op.i64and); e(op.i64xor); set(A(lane(x, y)));
  }
  get(A(0)); get(R); i32c(3); e(op.i32shl); mem(op.i64load, 3, 512); e(op.i64xor); set(A(0));
  get(R); i32c(1); e(op.i32add); tee(R); i32c(24); e(op.i32lt_u); e(op.br_if, 0);
  e(op.end);
  get(A(0)); e(op.i32wrap); bswap32(); get(TGT); e(op.i32le_u);
  e(op.if, 0x40);
  get(HITS); i32c(1); e(op.i32add); set(HITS);
  get(HITS); i32c(2); e(op.i32shl); get(X); mem(op.i32store, 2, 256);
  for (let k = 0; k < 4; k++) { get(HITS); i32c(5); e(op.i32shl); get(A(k)); mem(op.i64store, 3, 992 + 8 * k); }
  get(HITS); i32c(63); e(op.i32ge_u);
  e(op.if, 0x40); get(I); i32c(1); e(op.i32add); set(I); e(op.br, 3); e(op.end);
  e(op.end);
  get(I); i32c(1); e(op.i32add); tee(I); get(CNT); e(op.i32lt_u); e(op.br_if, 0);
  e(op.end);
  e(op.end);
  i32c(256); get(HITS); mem(op.i32store, 2, 0);
  get(I);
  e(op.end);

  const body = [...uleb(2), ...uleb(5), 0x7f, ...uleb(58), 0x7e, ...code];
  const section = (id, bytes) => [id, ...uleb(bytes.length), ...bytes];
  const str = (s) => [...uleb(s.length), ...Buffer.from(s)];
  return Buffer.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, [1, 0x60, 4, 0x7f, 0x7f, 0x7f, 0x7f, 1, 0x7f]),
    ...section(3, [1, 0]),
    ...section(5, [1, 0x00, 1]),
    ...section(7, [2, ...str('search'), 0x00, 0, ...str('mem'), 0x02, 0]),
    ...section(10, [1, ...uleb(body.length), ...body]),
  ]);
}

// ------------------------------------------------------------------ self-test vector
const vec = {
  challenge: '0x' + Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)).toString('hex'),
  beneficiary: '0x' + 'aa'.repeat(20),
  prefix: '0x' + Buffer.from(Array.from({ length: 24 }, (_, i) => 0xc0 + i)).toString('hex'),
  mid: 0x01020304, lo: 0xfffffffe,
};
const vecNonce = (BigInt(vec.prefix) << 64n) | (BigInt(vec.mid) << 32n) | BigInt(vec.lo);
vec.digest = keccak256(solidityPacked(['bytes32', 'address', 'uint256'], [vec.challenge, vec.beneficiary, vecNonce]));

// ------------------------------------------------------------------ emit
const wasm = buildWasm();
const ind = (n, lines) => lines.map((l) => ' '.repeat(n) + l).join('\n');
const sVars = Array.from({ length: 50 }, (_, k) => 's' + k).join(', ');
const bVars = Array.from({ length: 50 }, (_, k) => 'b' + k).join(', ');
const loadSearch = [];
for (let k = 0; k < 50; k += 5) {
  loadSearch.push(Array.from({ length: 5 }, (_, q) => {
    const j = k + q;
    if (j === 19) return 's19 = mid;';
    if (j === 20) return 's20 = ((x << 24) | ((x & 0xff00) << 8) | ((x >>> 8) & 0xff00) | (x >>> 24));';
    return `s${j} = base[${j}];`;
  }).join(' '));
}
const loadState = [], storeState = [];
for (let k = 0; k < 50; k += 5) {
  loadState.push(Array.from({ length: 5 }, (_, q) => `s${k + q} = st[${k + q}];`).join(' '));
  storeState.push(Array.from({ length: 5 }, (_, q) => `st[${k + q}] = s${k + q};`).join(' '));
}
const hexToArr = (h) => `[${Buffer.from(h.slice(2), 'hex').join(', ')}]`;

const out = `/**
 * keccak-pow.js — colour.codes proof-of-work kernel. GENERATED by miner/build-kernel.mjs, do not edit.
 *
 *   digest = keccak256(challenge[32] ‖ beneficiary[20] ‖ nonce[32])      84 bytes = one Keccak block
 *
 * Two engines with identical results, chosen at runtime (createSearcher):
 *   wasm  WebAssembly module (64-bit lanes) assembled by miner/build-kernel.mjs, embedded below
 *   js    the Keccak-f[1600] round of js-sha3 v0.9.3 (https://github.com/emn178/js-sha3,
 *         Copyright 2015-2023 Chen, Yi-Cyuan, MIT licence — see ./LICENSE), rewritten to keep the
 *         state in local variables
 * The message is absorbed once per job (makeBase). Per nonce only nonce bytes 24..31 change:
 * lane 9 high word = nonce bytes 24..27 ("mid"), lane 10 low word = nonce bytes 28..31 ("lo").
 *
 * Classic script, no imports/exports: works with importScripts() in a Web Worker, with <script>, and
 * as a side-effect import in Node. Sets globalThis.ColourcodePow.
 */
(function (root) {
  'use strict';

  var RC = new Int32Array([${RC.join(', ')}]);
  var WASM_B64 = '${wasm.toString('base64')}';
  var VEC = {
    challenge: ${hexToArr(vec.challenge)},
    beneficiary: ${hexToArr(vec.beneficiary)},
    prefix: ${hexToArr(vec.prefix)},
    mid: ${vec.mid}, lo: ${vec.lo},
    digest: '${vec.digest.slice(2)}'
  };

  function bswap(x) {
    return ((x << 24) | ((x & 0xff00) << 8) | ((x >>> 8) & 0xff00) | (x >>> 24)) >>> 0;
  }

  /**
   * Absorb challenge (32 bytes), beneficiary (20 bytes) and nonce bytes 0..23 (prefix, 24 bytes) with
   * keccak padding. Returns Int32Array(50): word 2k / 2k+1 = low / high half of lane k (little endian).
   */
  function makeBase(challenge, beneficiary, prefix) {
    var m = new Uint8Array(136);
    m.set(challenge, 0);
    m.set(beneficiary, 32);
    m.set(prefix, 52);
    m[84] = 0x01;      // keccak pad (0x01, not SHA-3's 0x06)
    m[135] |= 0x80;
    var s = new Int32Array(50);
    for (var w = 0; w < 34; w++) s[w] = m[4 * w] | (m[4 * w + 1] << 8) | (m[4 * w + 2] << 16) | (m[4 * w + 3] << 24);
    return s;
  }

  /**
   * JS engine. Hashes nonces with bytes 24..27 = mid and bytes 28..31 = lo + i (big endian), i < count.
   * A hit is a digest whose top 32 bits (big endian) are <= tgtTop. out[0] = hits, out[1..] = lo values.
   * Stops early when out is full. Returns the number of nonces hashed.
   */
  function searchJs(base, mid, lo, count, tgtTop, out) {
    var ${sVars};
    var h, l, n, c0, c1, c2, c3, c4, c5, c6, c7, c8, c9;
    var ${bVars};
    var x, i, top, hits = 0, cap = out.length - 1;
    mid = bswap(mid) | 0;
    for (i = 0; i < count; i++) {
      x = (lo + i) | 0;
${ind(6, loadSearch)}
      for (n = 0; n < 48; n += 2) {
${ind(8, roundBody)}
      }
      top = ((s0 << 24) | ((s0 & 0xff00) << 8) | ((s0 >>> 8) & 0xff00) | (s0 >>> 24)) >>> 0;
      if (top <= tgtTop) {
        out[++hits] = (lo + i) >>> 0;
        if (hits >= cap) { out[0] = hits; return i + 1; }
      }
    }
    out[0] = hits;
    return count;
  }

  function permute(st) {
    var ${sVars};
    var h, l, n, c0, c1, c2, c3, c4, c5, c6, c7, c8, c9;
    var ${bVars};
${ind(4, loadState)}
    for (n = 0; n < 48; n += 2) {
${ind(6, roundBody)}
    }
${ind(4, storeState)}
  }

  /** Full 32-byte digest for one (mid, lo) with the JS engine. */
  function digestJs(base, mid, lo) {
    var s = new Int32Array(base);
    s[19] = bswap(mid >>> 0) | 0;
    s[20] = bswap(lo >>> 0) | 0;
    permute(s);
    var d = new Uint8Array(32);
    for (var k = 0; k < 8; k++) {
      d[4 * k] = s[k] & 0xff; d[4 * k + 1] = (s[k] >>> 8) & 0xff;
      d[4 * k + 2] = (s[k] >>> 16) & 0xff; d[4 * k + 3] = (s[k] >>> 24) & 0xff;
    }
    return d;
  }

  function toHex(u8) {
    var s = '';
    for (var i = 0; i < u8.length; i++) s += (u8[i] < 16 ? '0' : '') + u8[i].toString(16);
    return s;
  }

  function b64(s) {
    var bin = atob(s), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  var wasmModule = null;

  function wasmSearcher() {
    if (!wasmModule) wasmModule = new WebAssembly.Module(b64(WASM_B64));
    var inst = new WebAssembly.Instance(wasmModule, {});
    var mem = inst.exports.mem, fn = inst.exports.search;
    var i32 = new Int32Array(mem.buffer), u8 = new Uint8Array(mem.buffer);
    i32.set(RC, 128);
    return {
      engine: 'wasm',
      hits: 0,
      setBase: function (base) { i32.set(base, 0); },
      search: function (mid, lo, count, tgtTop) {
        var n = fn(mid | 0, lo | 0, count | 0, tgtTop | 0);
        this.hits = i32[64];
        return n;
      },
      hitLo: function (k) { return i32[65 + k] >>> 0; },
      hitDigest: function (k) { return u8.slice(1024 + 32 * k, 1056 + 32 * k); }
    };
  }

  function jsSearcher() {
    var base = null, out = new Uint32Array(64), lastMid = 0;
    return {
      engine: 'js',
      hits: 0,
      setBase: function (b) { base = new Int32Array(b); },
      search: function (mid, lo, count, tgtTop) {
        lastMid = mid >>> 0;
        var n = searchJs(base, mid >>> 0, lo >>> 0, count, tgtTop >>> 0, out);
        this.hits = out[0];
        return n;
      },
      hitLo: function (k) { return out[1 + k]; },
      hitDigest: function (k) { return digestJs(base, lastMid, out[1 + k]); }
    };
  }

  function selfTest(s) {
    s.setBase(makeBase(VEC.challenge, VEC.beneficiary, VEC.prefix));
    s.search(VEC.mid, VEC.lo, 1, 0xffffffff);
    return s.hits === 1 && s.hitLo(0) === VEC.lo && toHex(s.hitDigest(0)) === VEC.digest;
  }

  /** Fastest engine that passes the known-answer test. opts.engine = 'js' forces the fallback. */
  function createSearcher(opts) {
    opts = opts || {};
    if (opts.engine !== 'js' && typeof WebAssembly === 'object') {
      try { var w = wasmSearcher(); if (selfTest(w)) return w; } catch (e) { /* fall back */ }
    }
    var j = jsSearcher();
    if (!selfTest(j)) throw new Error('keccak kernel failed its self-test');
    return j;
  }

  root.ColourcodePow = { createSearcher: createSearcher, makeBase: makeBase, digest: digestJs, bswap: bswap, toHex: toHex };
})(typeof self !== 'undefined' ? self : globalThis);
`;
writeFileSync(OUT, out);
console.log(`wrote ${OUT} (${out.length} bytes, wasm ${wasm.length} bytes)`);

// verify both engines against ethers on random inputs
await import(OUT + '?v=' + Date.now());
const P = globalThis.ColourcodePow;
let bad = 0;
const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));
for (const engine of ['wasm', 'js']) {
  const s = P.createSearcher({ engine });
  if (s.engine !== engine) throw new Error(`engine ${engine} unavailable`);
  for (let t = 0; t < 200; t++) {
    const ch = rnd(32), ben = rnd(20), prefix = rnd(24);
    const mid = crypto.getRandomValues(new Uint32Array(1))[0], lo = crypto.getRandomValues(new Uint32Array(1))[0];
    const nonce = (BigInt(hexlify(prefix)) << 64n) | (BigInt(mid) << 32n) | BigInt(lo);
    const ref = keccak256(solidityPacked(['bytes32', 'address', 'uint256'], [hexlify(ch), hexlify(ben), nonce]));
    s.setBase(P.makeBase(ch, ben, prefix));
    s.search(mid, lo, 1, 0xffffffff);
    if (s.hits !== 1 || s.hitLo(0) !== lo || '0x' + P.toHex(s.hitDigest(0)) !== ref) bad++;
    const top = Number(BigInt(ref) >> 224n);
    if (top > 0) { s.search(mid, lo, 1, top - 1); if (s.hits !== 0) bad++; }
  }
}
if (bad) { console.error(`SELF-CHECK FAILED: ${bad} mismatches`); process.exit(1); }
console.log('both engines match ethers keccak256 on 400 random vectors');
