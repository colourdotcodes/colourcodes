// End-to-end mining test on a LOCAL anvil fork of Robinhood Chain. Never touches mainnet state:
// the fork is read-only towards the remote RPC, every transaction goes to 127.0.0.1:8548 and is signed
// with public anvil test keys.
//
//   node tools/e2e-mining.mjs            (add --browser to also mine from headless Chrome)
//
// Steps: anvil fork (:8548) → contracts/script/Local.s.sol (LOCAL_FORK=true, very easy target) →
// API server on :9071 → non-holder refused → CLI miner (pool mode) → shares accepted → a block submitted
// to the pool → payout epoch posted → claim() succeeds on-chain. Cleans up only what it started.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, copyFileSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonRpcProvider, Wallet, Contract, keccak256, solidityPacked } from 'ethers';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ANVIL_PORT = 8548;
const API_PORT = 9071;
const RPC = `http://127.0.0.1:${ANVIL_PORT}`;
const API = `http://127.0.0.1:${API_PORT}`;
const FORK_URL = process.env.FORK_URL || 'https://robinhood.drpc.org';
const WITH_BROWSER = process.argv.includes('--browser');

// public anvil/hardhat test keys (mnemonic "test test ... junk") — worthless outside a local node
const KEY = {
  deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // #0
  operator: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // #1
};
const MINER_ADDR = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';   // anvil #2, holds mock tokens
const BROWSER_ADDR = '0x90F79bf6EB2c4f870365E785982E1f101E93b906';  // anvil #3, holds mock tokens
const NON_HOLDER = '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720';    // anvil #9, holds none

const results = [];
let restoreDeployFile = () => {};
const children = [];
const tmp = mkdtempSync(join(tmpdir(), 'colourcode-e2e-'));
const t0 = Date.now();
const log = (...a) => console.log(`[e2e +${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  return Boolean(ok);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function killPort(port) {
  try {
    const pids = execFileSync('lsof', [`-tiTCP:${port}`, '-sTCP:LISTEN']).toString().trim().split('\n').filter(Boolean);
    for (const pid of pids) { try { process.kill(Number(pid), 'SIGTERM'); } catch { /* gone */ } }
    return pids.length;
  } catch { return 0; }
}

function start(name, cmd, args, opts = {}) {
  const p = spawn(cmd, args, { cwd: opts.cwd || ROOT, env: { ...process.env, ...(opts.env || {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
  const file = join(tmp, `${name}.log`);
  let buf = '';
  const onData = (d) => { buf += d; writeFileSync(file, buf); if (opts.echo) process.stdout.write(d.toString().split('\n').filter(Boolean).map((l) => `    ${name}| ${l}`).join('\n') + '\n'); };
  p.stdout.on('data', onData);
  p.stderr.on('data', onData);
  p.output = () => buf;
  children.push(p);
  return p;
}

async function rpc(method, params = []) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

// one retry on a reset socket (a keep-alive connection the server closed while we were busy hashing)
async function fetchRetry(url, init) {
  try { return await fetch(url, init); }
  catch (e) { if (e.cause?.code !== 'ECONNRESET' && e.cause?.code !== 'UND_ERR_SOCKET') throw e; return fetch(url, init); }
}

async function get(path) {
  const r = await fetchRetry(API + path);
  let body = null;
  try { body = await r.json(); } catch { /* none */ }
  return { status: r.status, body };
}

async function post(path, obj) {
  const r = await fetchRetry(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function waitFor(what, fn, timeoutMs, everyMs = 1000) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e.message; }
    await sleep(everyMs);
  }
  throw new Error(`timeout waiting for ${what}`);
}

async function cleanup() {
  restoreDeployFile();
  for (const c of children) { try { c.kill('SIGTERM'); } catch { /* gone */ } }
  await sleep(500);
  killPort(API_PORT);
  killPort(ANVIL_PORT);
}

/** Mine one share in-process with the shared kernel (single thread). */
async function mineShare(job, address) {
  await import(join(ROOT, 'public/vendor/keccak/keccak-pow.js'));
  const P = globalThis.ColourcodePow;
  const s = P.createSearcher();
  const hb = (h) => Uint8Array.from(Buffer.from(h.slice(2), 'hex'));
  const prefix = '0x' + address.toLowerCase().slice(2) + 'e2e0e2e0';
  s.setBase(P.makeBase(hb(job.challenge), hb(job.beneficiary), hb(prefix)));
  const target = BigInt(job.shareTarget);
  const top = Number(target >> 224n > 0xffffffffn ? 0xffffffffn : target >> 224n);
  for (let lo = 0; lo < 2 ** 32; lo += 1 << 20) {
    s.search(0x7f000000, lo, 1 << 20, top);
    await new Promise((r) => setImmediate(r));
    for (let k = 0; k < s.hits; k++) {
      const d = BigInt('0x' + P.toHex(s.hitDigest(k)));
      if (d <= target) return '0x' + prefix.slice(2) + '7f000000' + s.hitLo(k).toString(16).padStart(8, '0');
    }
  }
  throw new Error('no share found');
}

async function main() {
  log(`temp dir ${tmp}`);
  for (const f of ['contracts/script/Local.s.sol', 'contracts/out/ColourcodeMiner.sol/ColourcodeMiner.json']) {
    if (!existsSync(join(ROOT, f))) { check(`prerequisite ${f}`, false, 'contracts not ready'); return; }
  }
  if (killPort(ANVIL_PORT)) log('stopped a leftover listener on 8548');
  if (killPort(API_PORT)) log('stopped a leftover listener on 9071');
  await sleep(300);

  // 1. anvil fork — ALWAYS with --block-time
  log(`anvil --fork-url ${FORK_URL} --chain-id 4663 --port ${ANVIL_PORT} --block-time 1`);
  start('anvil', 'anvil', ['--fork-url', FORK_URL, '--chain-id', '4663', '--port', String(ANVIL_PORT), '--block-time', '1', '--silent']);
  await waitFor('anvil', async () => Number(await rpc('eth_chainId')) === 4663, 90000, 1000);
  const forkBlock = Number(BigInt(await rpc('eth_blockNumber')));
  check('anvil fork of Robinhood Chain is up (chain id 4663)', true, `fork block ${forkBlock}`);

  // 2. deploy with the contracts agent's script; very easy target
  const env = {
    LOCAL_FORK: 'true',
    TARGET_SPACING: '8',
    MIN_SPACING: '2',
    INITIAL_TARGET: ((1n << 256n) / 20000000n).toString(),     // ~20M hashes per block
    GENESIS_MESSAGE: 'e2e genesis',
  };
  log('forge script script/Local.s.sol (LOCAL_FORK=true)');
  // Local.s.sol always writes contracts/deploy.local.json; keep the contracts agent's copy and put it back
  const deployFile = join(ROOT, 'contracts/deploy.local.json');
  const original = existsSync(deployFile) ? readFileSync(deployFile) : null;
  // forge also leaves broadcast/cache records for chain 4663; remove them only if this run created them
  const forgeDirs = ['contracts/broadcast/Local.s.sol/4663', 'contracts/cache/Local.s.sol/4663'].map((d) => join(ROOT, d)).filter((d) => !existsSync(d));
  const forgeParents = ['contracts/broadcast/Local.s.sol', 'contracts/broadcast', 'contracts/cache/Local.s.sol'].map((d) => join(ROOT, d)).filter((d) => !existsSync(d));
  restoreDeployFile = () => {
    if (original) writeFileSync(deployFile, original); else rmSync(deployFile, { force: true });
    for (const d of forgeDirs) rmSync(d, { recursive: true, force: true });
    for (const d of forgeParents) { try { rmdirSync(d); } catch { /* not empty or gone */ } }
    restoreDeployFile = () => {};
  };
  const myDeploy = join(tmp, 'deploy.json');
  try {
    execFileSync('forge', ['script', 'script/Local.s.sol', '--rpc-url', RPC, '--broadcast', '--slow'], { cwd: join(ROOT, 'contracts'), env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    copyFileSync(deployFile, myDeploy);     // private copy: nobody else's deploy can change it under us
  } finally { restoreDeployFile(); }
  const dep = JSON.parse(readFileSync(myDeploy, 'utf8'));
  const code = await rpc('eth_getCode', [dep.miner, 'latest']);
  if (!check('Local.s.sol deployed token, miner, pool on the fork', dep.chainId === 4663 && code.length > 2, `miner ${dep.miner} pool ${dep.pool}`)) return;

  // 3. API server
  log(`API on :${API_PORT}`);
  const serverEnv = {
    PORT: String(API_PORT), DEPLOY_FILE: myDeploy, RPC_URL: RPC, RPC_FALLBACK: 'none', OPERATOR_KEY: KEY.operator,
    POOL_DATA_DIR: join(tmp, 'data'), EPOCH_SECONDS: '20', SHARE_INTERVAL_SEC: '3', MIN_SHARE_WORK: '4096',
    INITIAL_SHARE_WORK: String(2 ** 22), POLL_MS: '1000', PAYOUT_CAP_BPS: '0',
  };
  let server = start('server', 'node', ['server.mjs'], { env: serverEnv });
  const chain = await waitFor('api /api/chain live', async () => { const r = await get('/api/chain'); return r.body?.status === 'live' ? r.body : null; }, 60000);
  check('/api/chain reports live state from the contract', chain.height === 0 && chain.minHold === dep.minHold, `height ${chain.height}, difficulty ${Math.round(chain.difficulty)}`);

  // 4. holder rule
  const nh = await get(`/api/pool/job?address=${NON_HOLDER}`);
  check('non-holder gets 403 not_holder', nh.status === 403 && nh.body.error === 'not_holder', JSON.stringify(nh.body));

  // 5. protocol checks with a share mined here
  const job = (await get(`/api/pool/job?address=${MINER_ADDR}&worker=e2e`)).body;
  check('holder gets a job bound to the pool', job.beneficiary === dep.pool.toLowerCase() && BigInt(job.shareTarget) >= BigInt(job.blockTarget), `share difficulty ${Math.round(job.shareDifficulty)}`);
  const nonce = await mineShare(job, MINER_ADDR);
  const digest = keccak256(solidityPacked(['bytes32', 'address', 'uint256'], [job.challenge, job.beneficiary, BigInt(nonce)]));
  check('kernel share meets the share target (checked with ethers)', BigInt(digest) <= BigInt(job.shareTarget));
  const s1 = await post('/api/pool/share', { address: MINER_ADDR, nonce, challenge: job.challenge, worker: 'e2e' });
  check('share accepted', s1.status === 200 && s1.body.ok === true, JSON.stringify(s1.body));
  const s2 = await post('/api/pool/share', { address: MINER_ADDR, nonce, challenge: job.challenge, worker: 'e2e' });
  check('same share again is rejected as duplicate', s2.status === 409 && s2.body.error === 'duplicate');
  const s3 = await post('/api/pool/share', { address: BROWSER_ADDR, nonce, challenge: job.challenge, worker: 'e2e' });
  check('share claimed by another address is rejected (bad_nonce)', s3.status === 400 && s3.body.error === 'bad_nonce');
  const s4 = await post('/api/pool/share', { address: MINER_ADDR, nonce, challenge: '0x' + '11'.repeat(32), worker: 'e2e' });
  check('share for an unknown challenge is rejected (stale)', s4.status === 409 && s4.body.error === 'stale');
  const s5 = await fetchRetry(API + '/api/pool/share', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ address: MINER_ADDR, nonce, challenge: job.challenge }) });
  const pre = await fetchRetry(API + '/api/pool/share', { method: 'OPTIONS', headers: { origin: 'https://elsewhere.example', 'access-control-request-method': 'POST' } });
  check('cross-site share posting is refused (JSON only, CORS preflight allows GET only)', s5.status === 415 && !/POST/.test(pre.headers.get('access-control-allow-methods') || ''));

  // 6. CLI miner (pool mode, no key)
  log('CLI miner: node miner/colourcode-miner.mjs --address <anvil #2> --threads 4 --json');
  const cli = start('cli', 'node', ['miner/colourcode-miner.mjs', '--address', MINER_ADDR, '--server', API, '--threads', '4', '--json']);

  let browserStats = null;
  const browserRun = WITH_BROWSER ? runBrowser().then((s) => { browserStats = s; }, (e) => { browserStats = { error: e.message }; }) : null;

  const me1 = await waitFor('accepted CLI shares', async () => {
    const r = await get(`/api/pool/me?address=${MINER_ADDR}`);
    return r.body?.shares24h >= 10 ? r.body : null;
  }, 120000);
  check('CLI shares accepted by the pool', me1.shares24h >= 10, `${me1.shares24h} shares, ~${(me1.hashrate / 1e6).toFixed(2)} MH/s credited`);

  const stats = await waitFor('a pool block', async () => { const r = await get('/api/pool/stats'); return r.body?.blocksFound >= 1 ? r.body : null; }, 180000);
  const lb = stats.lastBlock;
  const rc = await rpc('eth_getTransactionReceipt', [lb.tx]);
  check('a share met the block target and the operator mined a block to the pool', rc && rc.status === '0x1', `block ${lb.height}, tx ${lb.tx}`);

  const me2 = await waitFor('an epoch with a claim for the miner', async () => {
    const r = await get(`/api/pool/me?address=${MINER_ADDR}`);
    return r.body?.claimable?.length ? r.body : null;
  }, 120000);
  const c = me2.claimable[0];
  const st2 = (await get('/api/pool/stats')).body;
  check('payout epoch posted on-chain (merkle root)', st2.lastEpoch && st2.lastEpoch.tx, `epoch ${st2.lastEpoch?.epoch}, ${st2.lastEpoch?.wallets} wallet(s), tx ${st2.lastEpoch?.tx}`);

  // 7. claim on-chain with the proof from /api/pool/me (anyone may send it; tokens go to the account)
  const provider = new JsonRpcProvider(RPC, 4663, { staticNetwork: true });
  const claimer = new Wallet(KEY.deployer, provider);
  const token = new Contract(dep.token, ['function balanceOf(address) view returns (uint256)'], provider);
  const pool = new Contract(dep.pool, ['function claim(uint256,address,uint256,bytes32[])', 'function claimed(uint256,address) view returns (bool)'], claimer);
  const before = await token.balanceOf(MINER_ADDR);
  const tx = await pool.claim(c.epoch, MINER_ADDR, c.amount, c.proof);
  const r = await tx.wait();
  const after = await token.balanceOf(MINER_ADDR);
  check('claim() succeeds on-chain and pays exactly the amount', r.status === 1 && after - before === BigInt(c.amount) && await pool.claimed(c.epoch, MINER_ADDR),
    `epoch ${c.epoch}, ${(Number(BigInt(c.amount)) / 1e18).toFixed(4)} tokens, tx ${tx.hash}`);
  const me3 = await waitFor('claimed epoch listed', async () => { const x = (await get(`/api/pool/me?address=${MINER_ADDR}`)).body; return x.claimed?.some((e) => e.epoch === c.epoch) ? x : null; }, 40000);
  check('/api/pool/me moves the epoch to claimed', !me3.claimable.some((e) => e.epoch === c.epoch));

  // 8. restart: nothing may be lost
  const statsBefore = (await get('/api/pool/stats')).body;
  const logBefore = (await get('/api/agent/log?since=0')).body.length;
  server.kill('SIGTERM');
  await waitFor('server exit', async () => server.exitCode !== null || server.signalCode !== null, 10000, 200);
  killPort(API_PORT);
  server = start('server-2', 'node', ['server.mjs'], { env: serverEnv });
  await waitFor('api live after restart', async () => { const r = await get('/api/chain'); return r.body?.status === 'live' && r.body.synced ? r.body : null; }, 60000);
  const statsAfter = (await get('/api/pool/stats')).body;
  const meAfter = (await get(`/api/pool/me?address=${MINER_ADDR}`)).body;
  const logAfter = (await get('/api/agent/log?since=0')).body.length;
  check('restart keeps ledger, epochs, shares and the agent log', statsAfter.blocksFound >= statsBefore.blocksFound && statsAfter.lastEpoch?.epoch >= statsBefore.lastEpoch?.epoch &&
    statsAfter.shares24h >= statsBefore.shares24h && meAfter.claimed.some((e) => e.epoch === c.epoch) && logAfter >= logBefore,
    `blocks ${statsBefore.blocksFound}→${statsAfter.blocksFound}, last epoch ${statsBefore.lastEpoch?.epoch}→${statsAfter.lastEpoch?.epoch}, shares24h ${statsBefore.shares24h}→${statsAfter.shares24h}, log lines ${logBefore}→${logAfter}`);

  // 9. narration
  // the per-minute share line needs a minute boundary while shares flow; the CLI keeps mining meanwhile
  const lines = await waitFor('a per-minute share line', async () => {
    const l = (await get('/api/agent/log?since=0')).body;
    return l.some((x) => x.kind === 'shares') ? l : null;
  }, 75000, 2000).catch(() => []);
  const kinds = new Set(lines.map((l) => l.kind));
  check('agent log narrates real events (shares, submit, block, payout)', ['shares', 'submit', 'block', 'payout'].every((k) => kinds.has(k)), [...kinds].join(','));
  console.log('\n--- agent log (last 14) ---');
  for (const l of lines.slice(-14)) console.log(`  ${new Date(l.t).toISOString().slice(11, 19)} [${l.kind}] ${l.text}`);

  // 10. CLI hashrate from its own JSON status lines
  const cliLines = cli.output().split('\n').filter((l) => l.startsWith('{')).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const last = cliLines[cliLines.length - 1];
  if (last) log(`CLI miner: ${(last.hashrate / 1e6).toFixed(2)} MH/s on ${last.threads} threads (${last.engine}), accepted ${last.accepted}, rejected ${last.rejected}, blocks ${last.blocks}`);

  if (browserRun) {
    await browserRun;
    if (browserStats?.error) check('browser miner (headless Chrome)', false, browserStats.error);
    else check('browser miner shares accepted (headless Chrome)', browserStats.accepted > 0,
      `${(browserStats.hashrate / 1e6).toFixed(2)} MH/s on ${browserStats.threads} workers (${browserStats.engine}) = ${(browserStats.hashrate / browserStats.threads / 1e6).toFixed(2)} MH/s per worker, accepted ${browserStats.accepted}, rejected ${browserStats.rejected}`);
  }
}

async function runBrowser() {
  const { default: puppeteer } = await import(join(process.env.HOME, 'Desktop/PROVENTARIUM/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'));
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-first-run'] });
  try {
    const page = await browser.newPage();
    await page.goto(API + '/', { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ url: '/js/mining/client.js' });
    await page.evaluate((addr) => {
      window.__s = []; window.__st = [];
      ColourcodeMining.on('stats', (s) => window.__s.push(s));
      ColourcodeMining.on('state', (s) => window.__st.push(s));
      return ColourcodeMining.start({ address: addr, threads: 4 });
    }, BROWSER_ADDR);
    await sleep(25000);
    const out = await page.evaluate(() => { const s = window.__s.slice(-1)[0]; ColourcodeMining.stop(); return { ...s, running: ColourcodeMining.running, states: window.__st.map((x) => x.status) }; });
    return out;
  } finally { await browser.close(); }
}

main()
  .catch((e) => check('e2e run', false, `${e.message}${e.cause ? ' (' + (e.cause.code || e.cause.message) + ')' : ''}\n${e.stack}`))
  .finally(async () => {
    await cleanup();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed. logs: ${tmp}`);
    process.exit(failed.length ? 1 : 0);
  });
