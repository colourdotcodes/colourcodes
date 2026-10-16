#!/usr/bin/env node
// colour.codes — CLI miner for humans and AI agents. Node 18+. One file.
//
//   pool mode (no private key, nothing to sign):
//     node colourcode-miner.mjs --address 0xYourWallet [--server https://site] [--threads N]
//   solo mode (you submit blocks yourself, your wallet pays gas and must hold minHold):
//     PRIVATE_KEY=0x… node colourcode-miner.mjs --solo [--rpc URL] [--contract 0xMiner] [--threads N]
//
// Other flags: --js (force the JS kernel), --json (one JSON status line every 10 s), --quiet,
//              --duration SEC, --max-shares N, --help
// Pool mode needs no npm packages. Solo mode needs `ethers` (npm i ethers).
// Hashing kernel: public/vendor/keccak/keccak-pow.js (same file the browser uses). When this script runs
// outside the repo it downloads that file from the server once.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import vm from 'node:vm';

// ====================================================================== worker thread
if (!isMainThread) {
  vm.runInThisContext(workerData.kernel, { filename: 'keccak-pow.js' });
  const P = globalThis.ColourcodePow;
  const searcher = P.createSearcher({ engine: workerData.engine });
  parentPort.postMessage({ type: 'ready', engine: searcher.engine });
  let job = null, shareTarget = 0n, blockTarget = 0n, tgtTop = 0, mid = 0, lo = 0;
  let running = false, chunk = 1 << 16, hashes = 0, lastReport = performance.now();
  const hexBytes = (h) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ''), 'hex'));
  const setTargets = (s, b) => {
    shareTarget = BigInt(s); blockTarget = BigInt(b);
    const top = shareTarget >> 224n;
    tgtTop = top > 0xffffffffn ? 0xffffffff : Number(top);
  };
  const step = () => {
    if (!running || !job) return;
    const t0 = performance.now();
    const room = 4294967296 - lo;
    const n = searcher.search(mid, lo, Math.min(chunk, room), tgtTop);
    for (let k = 0; k < searcher.hits; k++) {
      const d = BigInt('0x' + P.toHex(searcher.hitDigest(k)));
      if (d > shareTarget) continue;
      const nonce = '0x' + job.prefix.replace(/^0x/, '') + mid.toString(16).padStart(8, '0') + searcher.hitLo(k).toString(16).padStart(8, '0');
      parentPort.postMessage({ type: 'share', challenge: job.challenge, nonce, digest: '0x' + d.toString(16).padStart(64, '0'), block: d <= blockTarget });
    }
    lo += n;
    if (lo >= 4294967296) { lo = 0; mid = (mid + 1) >>> 0; }
    hashes += n;
    const t1 = performance.now();
    if (t1 - t0 < 25 && chunk < 1 << 22) chunk *= 2; else if (t1 - t0 > 100 && chunk > 256) chunk >>= 1;
    if (t1 - lastReport >= 1000) { parentPort.postMessage({ type: 'rate', hashes, ms: t1 - lastReport }); hashes = 0; lastReport = t1; }
    setImmediate(step);
  };
  parentPort.on('message', (m) => {
    if (m.type === 'job') {
      setTargets(m.shareTarget, m.blockTarget);
      if (!job || job.challenge !== m.challenge || job.prefix !== m.prefix || job.beneficiary !== m.beneficiary) {
        job = { challenge: m.challenge, prefix: m.prefix, beneficiary: m.beneficiary };
        searcher.setBase(P.makeBase(hexBytes(m.challenge), hexBytes(m.beneficiary), hexBytes(m.prefix)));
        mid = m.mid >>> 0; lo = 0;
      }
      if (!running) { running = true; lastReport = performance.now(); hashes = 0; setImmediate(step); }
    } else if (m.type === 'target') setTargets(m.shareTarget, m.blockTarget);
    else if (m.type === 'pause') running = false;
    else if (m.type === 'stop') { running = false; process.exit(0); }
  });
}

// ====================================================================== main thread
const HELP = `colour.codes miner

  Pool mode (recommended, no private key):
    node colourcode-miner.mjs --address 0xYourWallet [--server URL] [--threads N]

  Solo mode (your wallet submits blocks and pays gas; needs: npm i ethers):
    PRIVATE_KEY=0x... node colourcode-miner.mjs --solo [--rpc URL] [--contract 0xMiner] [--threads N]

  Flags:
    --address 0x..   wallet that holds at least minHold tokens (pool mode)
    --server URL     pool server (default: COLOURCODE_SERVER env, the site in config.js, or http://127.0.0.1:9070)
    --threads N      worker threads (default: CPU cores - 1)
    --js             use the JavaScript kernel instead of WebAssembly
    --json           print one JSON status object every 10 s (for agents)
    --quiet          no status line, only events
    --duration SEC   stop after SEC seconds
    --max-shares N   stop after N accepted shares
`;

function parseArgs(argv) {
  const a = { threads: 0 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === '--address') a.address = v();
    else if (k === '--server') a.server = v();
    else if (k === '--threads') a.threads = Number(v());
    else if (k === '--solo') a.solo = true;
    else if (k === '--rpc') a.rpc = v();
    else if (k === '--contract') a.contract = v();
    else if (k === '--beneficiary') a.beneficiary = v();
    else if (k === '--js') a.js = true;
    else if (k === '--json') a.json = true;
    else if (k === '--quiet') a.quiet = true;
    else if (k === '--duration') a.duration = Number(v());
    else if (k === '--max-shares') a.maxShares = Number(v());
    else if (k === '--help' || k === '-h') a.help = true;
    else { console.error(`unknown flag ${k}`); a.help = true; a.bad = true; }
  }
  return a;
}

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const here = fileURLToPath(new URL('.', import.meta.url));
const localFile = (p) => { const f = here + p; return existsSync(f) ? f : null; };

function siteFromConfig() {
  const f = localFile('../public/config.js');
  if (!f) return '';
  try {
    const sb = { window: {} };
    vm.runInNewContext(readFileSync(f, 'utf8'), sb, { timeout: 100 });
    const d = sb.window.COLOURCODE?.domain;
    return d ? (d.startsWith('http') ? d : `https://${d}`) : '';
  } catch { return ''; }
}

function fmtRate(h) {
  if (!(h > 0)) return '0 H/s';
  const u = ['H/s', 'kH/s', 'MH/s', 'GH/s', 'TH/s'];
  let i = 0;
  while (h >= 1000 && i < u.length - 1) { h /= 1000; i++; }
  return `${h.toFixed(h >= 100 ? 0 : 2)} ${u[i]}`;
}

const ts = () => new Date().toISOString().slice(11, 19);

async function getJSON(url, init) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  let body = {};
  try { body = await r.json(); } catch { /* empty */ }
  return { status: r.status, body };
}

async function loadKernel(server) {
  const f = localFile('../public/vendor/keccak/keccak-pow.js');
  if (f) return readFileSync(f, 'utf8');
  const r = await fetch(`${server}/vendor/keccak/keccak-pow.js`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`could not download the kernel from ${server} (${r.status})`);
  return await r.text();
}

class Miner {
  constructor(opts, kernel) {
    this.o = opts;
    this.kernel = kernel;
    this.workers = [];
    this.rates = [];
    this.engine = '';
    this.st = { shares: 0, accepted: 0, rejected: 0, blocks: 0, stale: 0 };
    this.started = Date.now();
    this.lastLine = '';
  }

  spawn(n, onShare) {
    for (let i = 0; i < n; i++) {
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { kernel: this.kernel, engine: this.o.js ? 'js' : undefined } });
      w.on('message', (m) => {
        if (m.type === 'rate') this.rates[i] = (m.hashes * 1000) / m.ms;
        else if (m.type === 'ready') this.engine = m.engine;
        else if (m.type === 'share') onShare(m);
      });
      w.on('error', (e) => this.event(`worker ${i} error: ${e.message}`));
      this.workers.push(w);
      this.rates.push(0);
    }
  }

  broadcast(job, prefix, beneficiary) {
    this.workers.forEach((w, i) => w.postMessage({
      type: 'job', challenge: job.challenge, beneficiary, prefix, mid: (i << 24) >>> 0,
      shareTarget: job.shareTarget, blockTarget: job.blockTarget,
    }));
  }

  retarget(shareTarget, blockTarget) { for (const w of this.workers) w.postMessage({ type: 'target', shareTarget, blockTarget }); }
  pause() { for (const w of this.workers) w.postMessage({ type: 'pause' }); this.rates = this.rates.map(() => 0); }
  hashrate() { return this.rates.reduce((s, r) => s + (r || 0), 0); }

  event(msg) {
    if (this.lastLine && process.stdout.isTTY) process.stdout.write('\r\x1b[2K');
    console.log(`[${ts()}] ${msg}`);
    this.lastLine = '';
  }

  status(extra) {
    const s = this.st;
    const line = `${fmtRate(this.hashrate())} | ${this.workers.length} threads (${this.engine || '...'}) | shares ${s.accepted}/${s.shares} accepted, ${s.rejected} rejected | blocks ${s.blocks}${extra ? ' | ' + extra : ''}`;
    if (this.o.json) return;
    if (this.o.quiet) return;
    if (process.stdout.isTTY) { process.stdout.write('\r\x1b[2K' + line); this.lastLine = line; }
    else if (Date.now() - (this.lastPlain || 0) > 30000) { console.log(`[${ts()}] ${line}`); this.lastPlain = Date.now(); }
  }

  json(obj) { if (this.o.json) console.log(JSON.stringify({ t: Date.now(), hashrate: Math.round(this.hashrate()), threads: this.workers.length, engine: this.engine, ...this.st, ...obj })); }

  async stop(code = 0) {
    for (const w of this.workers) { try { w.postMessage({ type: 'stop' }); } catch { /* gone */ } }
    await Promise.race([Promise.all(this.workers.map((w) => w.terminate())), new Promise((r) => setTimeout(r, 1000))]);
    if (this.lastLine && process.stdout.isTTY) process.stdout.write('\n');
    const s = this.st;
    console.log(`[${ts()}] stopped. ${s.accepted} shares accepted, ${s.rejected} rejected, ${s.blocks} block${s.blocks === 1 ? '' : 's'}.`);
    process.exit(code);
  }
}

// ---------------------------------------------------------------------- pool mode
async function poolMode(o) {
  const server = (o.server || process.env.COLOURCODE_SERVER || siteFromConfig() || 'http://127.0.0.1:9070').replace(/\/+$/, '');
  const address = o.address.toLowerCase();
  const workerId = Buffer.from(crypto.getRandomValues(new Uint8Array(4))).toString('hex');
  const prefix = '0x' + address.slice(2) + workerId;
  const kernel = await loadKernel(server);
  const m = new Miner(o, kernel);
  let job = null, paused = false;
  const queue = [];
  let inflight = 0, holdUntil = 0;

  const jobUrl = () => `${server}/api/pool/job?address=${address}&worker=cli-${workerId}${m.hashrate() > 0 ? `&hashrate=${Math.round(m.hashrate())}` : ''}`;

  const refusal = (r) => {
    const b = r.body || {};
    if (r.status === 403) return { fatal: true, msg: `this wallet holds ${b.balance} (wei) but mining needs at least ${b.minHold}. Hold the token in this wallet, then start again. Never deposit anywhere.` };
    if (b.status === 'not_deployed') return { wait: true, msg: 'contracts are not deployed yet. mining opens at launch. waiting...' };
    if (b.status === 'not_started') return { wait: true, msg: 'mining has not started yet. waiting...' };
    if (b.status) return { wait: true, msg: `pool is ${b.status}. waiting...` };
    if (r.status === 429) return { wait: true, msg: 'rate limited. backing off...' };
    return { wait: true, msg: `pool answered ${r.status}${b.error ? ' ' + b.error : ''}. retrying...` };
  };

  const fetchJob = async () => {
    try {
      const r = await getJSON(jobUrl());
      if (r.status === 200) return r.body;
      const ref = refusal(r);
      if (ref.fatal) { m.event(ref.msg); await m.stop(2); }
      if (!paused) { m.pause(); paused = true; }
      m.event(ref.msg);
      return null;
    } catch (e) {
      if (!paused && m.workers.length) { m.pause(); paused = true; }
      m.event(`cannot reach ${server} (${e.message}). retrying...`);
      return null;
    }
  };

  const apply = (j) => {
    const changed = !job || job.challenge !== j.challenge;
    const retarget = job && (job.shareTarget !== j.shareTarget || job.blockTarget !== j.blockTarget);
    job = j;
    if (changed || paused) {
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].challenge !== j.challenge) queue.splice(i, 1);
      m.broadcast(j, prefix, j.beneficiary);
      if (changed) m.event(`work for block ${j.height + 1}. share difficulty ${Math.round(j.shareDifficulty || 0).toLocaleString('en-US')} hashes.`);
      paused = false;
    } else if (retarget) m.retarget(j.shareTarget, j.blockTarget);
  };

  const pump = () => {
    while (inflight < 2 && queue.length && Date.now() >= holdUntil) submit(queue.shift());
  };

  const submit = async (sh) => {
    inflight++;
    try {
      const r = await getJSON(`${server}/api/pool/share`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, nonce: sh.nonce, challenge: sh.challenge, worker: `cli-${workerId}` }),
      });
      const b = r.body || {};
      if (r.status === 200 && b.ok) {
        m.st.accepted++;
        if (b.shareTarget && job) { job.shareTarget = b.shareTarget; m.retarget(b.shareTarget, job.blockTarget); }
        if (b.block) {
          m.st.blocks++;
          m.event(b.tx ? `your share won block ${b.height}. pool sent mint(): ${b.tx}` : `your share won block ${b.height}. queued until min spacing passes.`);
          m.json({ event: 'block', height: b.height, tx: b.tx || null });
          setTimeout(poll, 1500);
          setTimeout(poll, 4000);
        } else if (job && typeof b.chainHeight === 'number' && b.chainHeight !== job.height) {
          poll();   // the chain moved on: fetch the new work now
        }
        if (o.maxShares && m.st.accepted >= o.maxShares) await m.stop(0);
      } else if (r.status === 429) {
        holdUntil = Date.now() + 1000 * (Number(b.retryAfter) || 5);
        if (sh.tries++ < 3) queue.unshift(sh);
      } else if (r.status === 403) {
        m.st.rejected++;
        m.event(refusal(r).msg);
        await m.stop(2);
      } else {
        m.st.rejected++;
        if (b.error === 'stale') m.st.stale++;
        if (b.error && b.error !== 'stale') m.event(`share rejected: ${b.error}`);
        if (b.error === 'stale' || b.error === 'low_difficulty') poll();
      }
    } catch {
      if (sh.tries++ < 2) queue.unshift(sh);
      holdUntil = Date.now() + 3000;
    } finally {
      inflight--;
      setTimeout(pump, Math.max(0, holdUntil - Date.now()));
    }
  };

  let polling = false;
  const poll = async () => {
    if (polling) return;
    polling = true;
    try { const j = await fetchJob(); if (j) apply(j); } finally { polling = false; }
  };

  console.log(`[${ts()}] Colourcode miner. pool ${server}, wallet ${address}.`);
  let first;
  for (;;) {
    first = await fetchJob();
    if (first) break;
    await new Promise((r) => setTimeout(r, 30000));
  }
  const threads = o.threads > 0 ? Math.floor(o.threads) : Math.max(1, (os.availableParallelism?.() || os.cpus().length) - 1);
  m.spawn(threads, (s) => {
    if (!job || s.challenge !== job.challenge) return;
    m.st.shares++;
    queue.push({ nonce: s.nonce, challenge: s.challenge, tries: 0 });
    if (queue.length > 256) queue.splice(0, queue.length - 256);
    pump();
  });
  apply(first);
  setInterval(poll, 10000);
  setInterval(() => m.status(job ? `block ${job.height + 1}` : ''), 1000);
  if (o.json) setInterval(() => m.json({ height: job?.height ?? null }), 10000);
  if (o.duration > 0) setTimeout(() => m.stop(0), o.duration * 1000);
  process.on('SIGINT', () => m.stop(0));
  process.on('SIGTERM', () => m.stop(0));
}

// ---------------------------------------------------------------------- solo mode
async function soloMode(o) {
  let ethers;
  try { ethers = await import('ethers'); }
  catch { console.error('solo mode needs ethers: npm i ethers'); process.exit(1); }
  const key = (process.env.PRIVATE_KEY || '').trim();
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(key)) { console.error('solo mode needs PRIVATE_KEY in the environment.'); process.exit(1); }
  const server = (o.server || process.env.COLOURCODE_SERVER || siteFromConfig() || 'http://127.0.0.1:9070').replace(/\/+$/, '');
  let rpcUrl = o.rpc || process.env.RPC_URL || '';
  let contract = o.contract || process.env.MINER_ADDRESS || '';
  if (!contract) {
    try { const r = await getJSON(`${server}/api/chain`); contract = r.body.miner || ''; } catch { /* below */ }
  }
  if (!rpcUrl) {
    const f = localFile('../public/config.js');
    if (f) { try { const sb = { window: {} }; vm.runInNewContext(readFileSync(f, 'utf8'), sb); rpcUrl = sb.window.COLOURCODE?.chain?.rpc || ''; } catch { /* default */ } }
    rpcUrl ||= 'https://rpc.mainnet.chain.robinhood.com';
  }
  if (!ADDR_RE.test(contract)) { console.error('no miner contract address (use --contract 0x… or MINER_ADDRESS).'); process.exit(1); }

  const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
  const wallet = new ethers.Wallet(key.startsWith('0x') ? key : '0x' + key, provider);
  const miner = new ethers.Contract(contract, [
    'function state() view returns (bytes32 challenge, uint256 target, uint256 height, uint256 reward, uint256 lastBlockTime, uint256 reserve, uint256 minHold, uint256 minSpacing, uint256 startTime, bool started)',
    'function token() view returns (address)',
    'function mint(uint256 nonce, address beneficiary) returns (uint256)',
  ], wallet);
  const token = new ethers.Contract(await miner.token(), ['function balanceOf(address) view returns (uint256)'], provider);
  const me = wallet.address.toLowerCase();
  const beneficiary = (o.beneficiary && ADDR_RE.test(o.beneficiary) ? o.beneficiary : me).toLowerCase();
  const workerId = Buffer.from(crypto.getRandomValues(new Uint8Array(4))).toString('hex');
  const prefix = '0x' + me.slice(2) + workerId;

  const kernel = await loadKernel(server);
  const m = new Miner(o, kernel);
  console.log(`[${ts()}] Colourcode miner, SOLO. wallet ${me}, contract ${contract}, rpc ${rpcUrl}.`);

  let st = await miner.state();
  if (!st.started) { console.error('mining has not started yet.'); process.exit(1); }
  const bal = await token.balanceOf(me);
  if (bal < st.minHold) { console.error(`wallet holds ${bal} but submitting a block needs ${st.minHold}.`); process.exit(2); }

  let job = null, sending = false;
  const toJob = (s) => ({ challenge: s.challenge.toLowerCase(), shareTarget: s.target.toString(), blockTarget: s.target.toString(), height: Number(s.height) });
  const refresh = async () => {
    try {
      st = await miner.state();
      const j = toJob(st);
      if (!job || j.challenge !== job.challenge || j.blockTarget !== job.blockTarget) {
        job = j; m.broadcast(job, prefix, beneficiary);
        m.event(`work for block ${job.height + 1}. difficulty ${Math.round(Number((1n << 256n) / (BigInt(job.blockTarget) + 1n))).toLocaleString('en-US')} hashes.`);
      }
    } catch (e) { m.event(`rpc: ${e.shortMessage || e.message}`); }
  };
  m.spawn(o.threads > 0 ? Math.floor(o.threads) : Math.max(1, (os.availableParallelism?.() || os.cpus().length) - 1), async (s) => {
    if (!job || s.challenge !== job.challenge || sending) return;
    sending = true;
    m.st.shares++;
    try {
      const earliest = Number(st.lastBlockTime) + Number(st.minSpacing);
      const wait = earliest - Math.floor(Date.now() / 1000);
      if (wait > 0) { m.event(`found a block ${wait}s before min spacing allows. holding it.`); await new Promise((r) => setTimeout(r, (wait + 1) * 1000)); }
      const tx = await miner.mint(BigInt(s.nonce), beneficiary);
      m.event(`block found. mint() sent: ${tx.hash}`);
      const rc = await tx.wait();
      if (rc.status === 1) { m.st.blocks++; m.st.accepted++; m.event(`block ${job.height + 1} is yours.`); }
      else { m.st.rejected++; m.event('mint() reverted.'); }
    } catch (e) { m.st.rejected++; m.event(`mint() failed: ${e.shortMessage || e.message}`); }
    finally { sending = false; await refresh(); }
  });
  await refresh();
  setInterval(refresh, 5000);
  setInterval(() => m.status(job ? `block ${job.height + 1}` : ''), 1000);
  if (o.json) setInterval(() => m.json({ height: job?.height ?? null, mode: 'solo' }), 10000);
  if (o.duration > 0) setTimeout(() => m.stop(0), o.duration * 1000);
  process.on('SIGINT', () => m.stop(0));
  process.on('SIGTERM', () => m.stop(0));
}

if (isMainThread) {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log(HELP); process.exit(o.bad ? 1 : 0); }
  if (o.solo) await soloMode(o);
  else {
    if (!ADDR_RE.test(o.address || '')) { console.error('--address 0x… (your wallet) is required. See --help.'); process.exit(1); }
    await poolMode(o);
  }
}
