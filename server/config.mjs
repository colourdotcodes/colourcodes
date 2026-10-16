// Server-side configuration. Reads the same values the site uses (public/config.js) and lets env
// variables (or a local deployment file) override them. The operator key is NOT part of this object:
// read it only through operatorKey().
//
// env:
//   RPC_URL, RPC_FALLBACK (comma list, "none" to disable), CHAIN_ID
//   MINER_ADDRESS, POOL_ADDRESS, TOKEN_ADDRESS, START_BLOCK
//   DEPLOY_FILE           JSON with {miner, pool, token, startBlock?} (local tests)
//   OPERATOR_KEY          pool operator private key (.env only)
//   POOL_DATA_DIR         default pool/data
//   SHARE_INTERVAL_SEC    vardiff goal, seconds per share per worker (30)
//   MIN_SHARE_WORK        easiest share, expected hashes (65536)
//   INITIAL_SHARE_WORK    first share difficulty for a new worker (16777216)
//   PPLNS_FACTOR          window = factor x block work (2)
//   EPOCH_SECONDS         payout epoch length, aligned to unix time (86400 = daily at 00:00 UTC)
//   PAYOUT_CAP_BPS        per-wallet cap per epoch, in bps of the epoch's expected emission (2500 = 25%; 0 = no cap).
//                         Anything above the cap stays pending for that wallet and is paid in later epochs.
//   PAYOUT_CAP_TOKENS     absolute per-wallet cap per epoch in whole tokens (overrides bps)
//   POLL_MS               chain poll interval (3000)
//   LOG_RANGE             max blocks per eth_getLogs (10000)
//   TRUST_PROXY           "1" when behind a reverse proxy (use X-Forwarded-For)
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { isAddress } from './util.mjs';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PUBLIC_CONFIG = join(ROOT, 'public/config.js');
const DEFAULT_FALLBACK = 'https://robinhood.drpc.org';

function readPublicConfig() {
  try {
    const src = readFileSync(PUBLIC_CONFIG, 'utf8');
    const sandbox = { window: {} };
    vm.runInNewContext(src, sandbox, { timeout: 100 });
    return sandbox.window.COLOURCODE || {};
  } catch { return {}; }
}

function deployPath() {
  const p = process.env.DEPLOY_FILE;
  if (!p) return '';
  return isAbsolute(p) ? p : join(ROOT, p);
}

function readDeployFile() {
  const p = deployPath();
  if (!p) return {};
  try {
    const d = JSON.parse(readFileSync(p, 'utf8'));
    const pick = (...keys) => { for (const k of keys) if (typeof d[k] === 'string' && d[k]) return d[k]; return ''; };
    return {
      miner: pick('miner', 'ColourcodeMiner', 'minerAddress'),
      pool: pick('pool', 'ColourcodePool', 'poolAddress'),
      token: pick('token', 'Token', 'tokenAddress', 'MockERC20'),
      startBlock: Number(d.startBlock ?? d.deployBlock ?? d.block ?? 0) || 0,
      chainId: Number(d.chainId || 0) || 0,
    };
  } catch { return {}; }
}

const num = (v, d) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) ? n : d; };
const first = (...vals) => { for (const v of vals) if (typeof v === 'string' && v.trim()) return v.trim(); return ''; };

export function loadConfig() {
  const env = process.env;
  const pub = readPublicConfig();
  const dep = readDeployFile();
  const chain = pub.chain || {};

  let rpcUrls;
  if (env.RPC_URL) {
    rpcUrls = [env.RPC_URL];
    if (env.RPC_FALLBACK && env.RPC_FALLBACK !== 'none') rpcUrls.push(...env.RPC_FALLBACK.split(','));
  } else {
    rpcUrls = [chain.rpc || 'https://rpc.mainnet.chain.robinhood.com'];
    const fb = env.RPC_FALLBACK === 'none' ? [] : (env.RPC_FALLBACK || DEFAULT_FALLBACK).split(',');
    rpcUrls.push(...fb);
  }
  rpcUrls = [...new Set(rpcUrls.map((u) => u.trim()).filter(Boolean))];

  const addr = (v) => (isAddress(v) ? v.toLowerCase() : '');
  return {
    chainId: num(env.CHAIN_ID, dep.chainId || chain.id || 4663),
    rpcUrls,
    miner: addr(first(env.MINER_ADDRESS, dep.miner, pub.contracts?.miner)),
    pool: addr(first(env.POOL_ADDRESS, dep.pool, pub.contracts?.pool)),
    token: addr(first(env.TOKEN_ADDRESS, dep.token, pub.ca)),
    startBlock: num(env.START_BLOCK, dep.startBlock || pub.contracts?.startBlock || 0),
    ticker: pub.ticker || 'COLOURCODE',
    targetSpacing: num(pub.mining?.targetSpacingSec, 600),
    halvingInterval: num(pub.mining?.halvingInterval, 12960),
    dataDir: env.POOL_DATA_DIR ? (isAbsolute(env.POOL_DATA_DIR) ? env.POOL_DATA_DIR : join(ROOT, env.POOL_DATA_DIR)) : join(ROOT, 'pool/data'),
    shareInterval: num(env.SHARE_INTERVAL_SEC, 30),
    minShareWork: num(env.MIN_SHARE_WORK, 65536),
    initialShareWork: num(env.INITIAL_SHARE_WORK, 2 ** 24),
    pplnsFactor: num(env.PPLNS_FACTOR, 2),
    epochSeconds: Math.max(10, num(env.EPOCH_SECONDS, 86400)),
    payoutCapBps: num(env.PAYOUT_CAP_BPS, 2500),
    payoutCapTokens: env.PAYOUT_CAP_TOKENS ? String(env.PAYOUT_CAP_TOKENS) : '',
    pollMs: Math.max(500, num(env.POLL_MS, 3000)),
    logRange: Math.max(100, Math.min(10000, num(env.LOG_RANGE, 10000))),
    staleGraceSec: num(env.STALE_GRACE_SEC, 10),
    trustProxy: env.TRUST_PROXY === '1',
  };
}

/** The pool operator key, only from the environment (.env). Never returned by any route or logged. */
export function operatorKey() {
  const k = (process.env.OPERATOR_KEY || '').trim();
  return /^(0x)?[0-9a-fA-F]{64}$/.test(k) ? (k.startsWith('0x') ? k : '0x' + k) : '';
}

/** Cheap change detection so a launch-time edit of public/config.js is picked up without a restart. */
export function configStamp() {
  const m = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };
  return `${m(PUBLIC_CONFIG)}:${m(deployPath())}`;
}

export const deployed = (cfg) => Boolean(cfg.miner && cfg.pool);
