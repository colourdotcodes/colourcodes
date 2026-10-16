// Small shared helpers for the pool server. No secrets pass through here.

export const TWO256 = 1n << 256n;
export const MAX_UINT256 = TWO256 - 1n;

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const B32_RE = /^0x[0-9a-fA-F]{64}$/;

export const isAddress = (s) => typeof s === 'string' && ADDR_RE.test(s);
export const isBytes32 = (s) => typeof s === 'string' && B32_RE.test(s);
export const lower = (s) => String(s).toLowerCase();

/** Parse a uint256 given as decimal string, 0x-hex string or safe integer. Returns BigInt or null. */
export function parseUint256(v) {
  try {
    if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null;
    if (typeof v !== 'string' || v.length === 0 || v.length > 80) return null;
    if (!/^(0x[0-9a-fA-F]{1,64}|[0-9]{1,78})$/.test(v)) return null;
    const n = BigInt(v);
    return n >= 0n && n <= MAX_UINT256 ? n : null;
  } catch { return null; }
}

export const hex32 = (n) => '0x' + BigInt(n).toString(16).padStart(64, '0');

/** Expected hashes to find a digest <= target. */
export const workOf = (target) => Number(TWO256 / (BigInt(target) + 1n));

/** The target whose expected work is `work` hashes. */
export function targetOfWork(work) {
  const w = BigInt(Math.max(1, Math.round(work)));
  const t = TWO256 / w - 1n;
  return t > MAX_UINT256 ? MAX_UINT256 : t;
}

export const nowSec = () => Date.now() / 1000;

/** "0x12ab…cdef" */
export const short = (a) => (typeof a === 'string' && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : String(a));

/** Human token amount from wei (BigInt|string), 2 decimals, thousands separators. */
export function fmtTokens(wei, decimals = 18) {
  const v = BigInt(wei);
  const base = 10n ** BigInt(decimals);
  const cents = (v * 100n + base / 2n) / base;
  const whole = cents / 100n, frac = cents % 100n;
  return `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac.toString().padStart(2, '0')}`;
}

/** Compact hash rate: 12.4 MH/s */
export function fmtRate(hps) {
  if (!Number.isFinite(hps) || hps <= 0) return '0 H/s';
  const u = ['H/s', 'kH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s'];
  let i = 0;
  while (hps >= 1000 && i < u.length - 1) { hps /= 1000; i++; }
  return `${hps >= 100 ? hps.toFixed(0) : hps.toFixed(1)} ${u[i]}`;
}

/** Compact big number: 1.23M, 4.5G */
export function fmtNum(n) {
  if (!Number.isFinite(n)) return String(n);
  const u = ['', 'k', 'M', 'G', 'T', 'P', 'E'];
  let i = 0;
  while (Math.abs(n) >= 1000 && i < u.length - 1) { n /= 1000; i++; }
  return `${Math.abs(n) >= 100 || i === 0 ? n.toFixed(0) : n.toFixed(2)}${u[i]}`;
}

/** JSON reply. Read routes are CORS-open; pass { cors: false } for routes other sites must not drive. */
export function json(res, status, body, extra = {}, { cors = true } = {}) {
  const data = JSON.stringify(body, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(cors ? { 'access-control-allow-origin': '*' } : {}),
    ...extra,
  });
  res.end(data);
}

export function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const xf = req.headers['x-forwarded-for'];
    if (typeof xf === 'string' && xf) return xf.split(',')[0].trim();
    const xr = req.headers['x-real-ip'];
    if (typeof xr === 'string' && xr) return xr.trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Strip anything that could be a private key or long secret from an error message before logging. */
export function safeError(e) {
  const msg = String(e?.shortMessage || e?.message || e || 'error');
  return msg.replace(/0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g, (m) => `${m.slice(0, 10)}…`).slice(0, 300);
}
