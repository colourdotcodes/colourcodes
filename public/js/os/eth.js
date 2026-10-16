// Minimal Ethereum helpers for the OS: keccak-256 (for function selectors),
// ABI encoding for the handful of calls the apps make, and number formatting.
// No ethers in the browser.

const MASK = (1n << 64n) - 1n;
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const rotl = (v, n) => (n === 0 ? v : ((v << BigInt(n)) | (v >> BigInt(64 - n))) & MASK);

function keccakF(s) {
  const B = new Array(25), C = new Array(5);
  for (let r = 0; r < 24; r++) {
    for (let x = 0; x < 5; x++) C[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) s[x + y] ^= D;
    }
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], ROT[x + 5 * y]);
    for (let y = 0; y < 25; y += 5) for (let x = 0; x < 5; x++) s[x + y] = B[x + y] ^ (~B[((x + 1) % 5) + y] & MASK & B[((x + 2) % 5) + y]);
    s[0] ^= RC[r];
  }
}

export function keccak256(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const rate = 136, len = bytes.length, padded = new Uint8Array(Math.ceil((len + 1) / rate) * rate);
  padded.set(bytes);
  padded[len] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const s = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let v = 0n;
      for (let b = 7; b >= 0; b--) v = (v << 8n) | BigInt(padded[off + i * 8 + b]);
      s[i] ^= v;
    }
    keccakF(s);
  }
  let hex = '';
  for (let i = 0; i < 4; i++) for (let b = 0; b < 8; b++) hex += Number((s[i] >> BigInt(8 * b)) & 0xffn).toString(16).padStart(2, '0');
  return '0x' + hex;
}

export const selector = (sig) => keccak256(sig).slice(0, 10);

// Signature from an ABI entry, e.g. claim(uint256,address,uint256,bytes32[])
export function signatureOf(abi, name) {
  const f = (abi || []).find((e) => e.type === 'function' && e.name === name);
  if (!f) return null;
  const t = (p) => (p.type.startsWith('tuple') ? `(${p.components.map(t).join(',')})${p.type.slice(5)}` : p.type);
  return `${name}(${f.inputs.map(t).join(',')})`;
}

const word = (hex) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const uint = (v) => word(BigInt(v).toString(16));
const addr = (a) => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a || '')) throw new Error('Invalid address');
  return word(a);
};
const b32 = (h) => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(h || '')) throw new Error('Invalid bytes32');
  return h.slice(2).toLowerCase();
};

export const encode = {
  balanceOf: (owner) => '0x70a08231' + addr(owner),
  decimals: () => '0x313ce567',
  claimed: (sel, epoch, account) => sel + uint(epoch) + addr(account),
  // claim(uint256 epoch, address account, uint256 amount, bytes32[] proof)
  claim: (sel, epoch, account, amount, proof) =>
    sel + uint(epoch) + addr(account) + uint(amount) + uint(32 * 4) + uint(proof.length) + proof.map(b32).join(''),
};

export const isAddress = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || '');

// ---- formatting --------------------------------------------------------------
export function toBig(v) {
  try {
    if (v == null || v === '') return null;
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number') return BigInt(Math.trunc(v));
    return BigInt(String(v).trim());
  } catch { return null; }
}

const group = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// wei-style decimal string -> "1,234.56"
export function fmtUnits(v, decimals = 18, frac = 2) {
  const b = toBig(v);
  if (b == null) return '—';
  const neg = b < 0n, a = neg ? -b : b, base = 10n ** BigInt(decimals);
  const whole = a / base;
  let f = (a % base).toString().padStart(decimals, '0').slice(0, frac).replace(/0+$/, '');
  if (!f && whole === 0n && a > 0n) return (neg ? '>-' : '<') + '0.' + ''.padStart(frac - 1, '0') + '1';
  return (neg ? '-' : '') + group(whole.toString()) + (f ? '.' + f : '');
}

export function fmtInt(v) {
  const b = toBig(v);
  return b == null ? '—' : group(b.toString());
}

export function fmtHashrate(h) {
  const n = Number(h);
  if (!isFinite(n) || n < 0) return '—';
  const u = ['H/s', 'kH/s', 'MH/s', 'GH/s', 'TH/s'];
  let i = 0, x = n;
  while (x >= 1000 && i < u.length - 1) { x /= 1000; i++; }
  return (i === 0 ? Math.round(x).toString() : x.toFixed(x < 10 ? 2 : x < 100 ? 1 : 0)) + ' ' + u[i];
}

export function fmtCompact(v) {
  const n = Number(v);
  if (!isFinite(n)) return String(v ?? '—');
  if (n < 1e4) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const u = ['', 'K', 'M', 'G', 'T', 'P', 'E'];
  let i = 0, x = n;
  while (x >= 1000 && i < u.length - 1) { x /= 1000; i++; }
  return x.toFixed(x < 10 ? 2 : x < 100 ? 1 : 0) + u[i];
}

export const short = (a, l = 6, r = 4) => (a && a.length > l + r + 2 ? a.slice(0, l) + '…' + a.slice(-r) : a || '');
