// Colourcode Pool: jobs, holder check, vardiff, share verification, block submission, PPLNS ledger,
// daily payout epochs (merkle roots posted on-chain) and claim proofs.
//
// Work accounting: a share found against target t is worth workOf(t) = 2^256/(t+1) expected hashes.
// Nonce rule: the high 160 bits of every pool nonce are the miner's own address
// (nonce = address << 96 | anything). The digest binds the pool as beneficiary, so this is what ties
// a share to the wallet that did the work: a share can't be re-submitted under another address.
import { keccak256, solidityPacked, parseUnits, formatEther } from 'ethers';
import { minerIface, poolIface, erc20Iface, revertName } from './contracts.mjs';
import { buildTree } from './merkle.mjs';
import { say } from './agent.mjs';
import { Buckets } from './ratelimit.mjs';
import { isAddress, isBytes32, parseUint256, lower, workOf, targetOfWork, nowSec, safeError } from './util.mjs';

const RAW_MIN_KEEP = 15 * 60;          // always keep 15 min of raw shares (10-min stats + slack)
const DAY = 86400;
const ADDR_BUCKET = 600;               // per-address 10-minute buckets for 24h counts
const HOLDER_TTL_MS = 60000;
const ZERO32 = '0x' + '0'.repeat(64);

export class Pool {
  constructor(cfg, rpc, chain, operator, store, agent) {
    this.cfg = cfg;
    this.rpc = rpc;
    this.chain = chain;
    this.operator = operator;
    this.store = store;
    this.agent = agent;

    const sh = store.load('shares', {});
    this.raw = Array.isArray(sh.raw) ? sh.raw : [];                 // [t, addr, work] ascending
    this.minutes = Array.isArray(sh.minutes) ? sh.minutes : [];     // [minute, n, work]
    this.addrBuckets = sh.addr && typeof sh.addr === 'object' ? sh.addr : {};
    this.seen = new Map(Object.entries(sh.seen || {}).map(([c, a]) => [c, new Set(a)]));
    const cur = Array.isArray(sh.cur) ? sh.cur : null;
    this.minuteCur = cur ? { idx: cur[0], n: cur[1], w: cur[2], addrs: new Set(cur[3] || []) } : { idx: Math.floor(nowSec() / 60), n: 0, w: 0, addrs: new Set() };

    this.L = store.load('ledger', null) || {
      pending: {}, unassigned: '0', lastAllocatedHeight: 0, allocations: [],
      nextEpoch: 1, lastCloseAt: 0, epochs: [], draft: null,
    };
    this.leafIndex = new Map();     // addr -> [{ epoch, amount }]
    for (const e of this.L.epochs) this._indexEpoch(e);

    this.workers = new Map();       // `${addr}:${worker}` -> vardiff state
    this.holders = new Map();       // addr -> { bal, at, p }
    this.claimedCache = new Map();  // `${epoch}:${addr}` -> { v, at }
    this.trees = new Map();         // epoch -> tree (small LRU)
    this.submitted = new Map();     // challenge -> tx hash ('pending' while sending)
    this.blockQueue = null;
    this.epochBusy = false;
    this.epochRetryAt = 0;
    this.health = { gasLow: false, notHolder: false, missing: false };

    this.ipBuckets = new Buckets(120, 4);         // all pool requests per IP
    this.shareBuckets = new Buckets(30, 1);       // shares per address: burst 30, 1/s sustained
    this.badBuckets = new Buckets(20, 0.2);       // invalid shares per IP

    chain.on('mined', (ev, meta) => { if (meta.isPool) this._allocate(ev, meta.targetBefore); });
    chain.on('challenge', (st) => this._onChallenge(st));
  }

  start() {
    const t1 = setInterval(() => this._tick().catch((e) => console.warn(`[pool] tick: ${safeError(e)}`)), 5000);
    const t2 = setInterval(() => this._trim(), 60000);
    const t3 = setInterval(() => this._checkOperator().catch(() => {}), 10 * 60000);
    for (const t of [t1, t2, t3]) t.unref?.();
    this.timers = [t1, t2, t3];
    this._checkOperator().catch(() => {});
    if (this.L.draft) this._tick().catch(() => {});
  }

  stop() { for (const t of this.timers || []) clearInterval(t); if (this.blockQueue) clearTimeout(this.blockQueue.timer); }

  // ------------------------------------------------------------------ status helpers

  _status() {
    const st = this.chain.state;
    if (!st) return 'syncing';
    if (!st.started) return 'not_started';
    if (!this.operator.ready) return 'operator_missing';
    return 'live';
  }

  _saveShares() {
    this.store.later('shares', () => ({
      raw: this.raw, minutes: this.minutes, addr: this.addrBuckets,
      cur: [this.minuteCur.idx, this.minuteCur.n, this.minuteCur.w, [...this.minuteCur.addrs]],
      seen: Object.fromEntries([...this.seen].map(([c, s]) => [c, [...s]])),
    }));
  }

  _saveLedger() { this.store.saveNow('ledger', this.L); }

  // ------------------------------------------------------------------ holders

  async balanceOf(addr) {
    const c = this.holders.get(addr);
    if (c && c.bal !== undefined && Date.now() - c.at < HOLDER_TTL_MS) return c.bal;
    if (c?.p) return c.p;
    const p = (async () => {
      const out = await this.rpc.ethCall(this.chain.info.token, erc20Iface.encodeFunctionData('balanceOf', [addr]));
      return BigInt(out);
    })();
    this.holders.set(addr, { ...(c || {}), p });
    try {
      const bal = await p;
      this.holders.set(addr, { bal, at: Date.now() });
      return bal;
    } catch (e) {
      if (c && c.bal !== undefined) { this.holders.set(addr, { bal: c.bal, at: c.at }); return c.bal; }
      this.holders.delete(addr);
      throw e;
    }
  }

  // ------------------------------------------------------------------ vardiff

  /** Vardiff state for one worker; `adjust` (job requests only) may ease an idle worker's target. */
  _worker(addr, id, hint, adjust = true) {
    const key = `${addr}:${id || '-'}`;
    let w = this.workers.get(key);
    const now = nowSec();
    if (!w) {
      w = { key, addr, target: null, work: 0, prev: null, setAt: now, n: 0, sum: 0, since: now, lastShareAt: 0, lastSeen: now };
      this._setWork(w, hint > 0 ? hint * this.cfg.shareInterval : this.cfg.initialShareWork);
      this.workers.set(key, w);
    } else if (adjust) {
      // keep the share target valid against a moving block target
      if (this.chain.state && w.target < this.chain.state.target) this._setWork(w, w.work);
      const idle = now - Math.max(w.lastShareAt, w.setAt);
      if (w.n === 0 && hint > 0 && idle > this.cfg.shareInterval) {
        const want = hint * this.cfg.shareInterval;
        if (want < w.work / 2 || want > w.work * 2) this._setWork(w, want);
      } else if (idle > 3 * this.cfg.shareInterval) {
        this._setWork(w, w.work / 2);   // too hard for this worker: ease off
      }
    }
    w.lastSeen = now;
    return w;
  }

  _setWork(w, work) {
    const now = nowSec();
    const st = this.chain.state;
    const blockWork = st ? workOf(st.target) : Infinity;
    const lo = this.cfg.minShareWork;
    work = Math.max(lo, Math.min(work, Math.max(lo, blockWork)));
    let t = targetOfWork(work);
    if (st && t < st.target) t = st.target;     // a share is never harder than a block
    if (w.target !== null && t !== w.target) w.prev = { target: w.target, work: w.work, until: now + 90 };
    w.target = t;
    w.work = workOf(t);
    w.setAt = now; w.n = 0; w.sum = 0; w.since = now;
  }

  /** After an accepted share. Returns true when the share target changed. */
  _vardiff(w, credited) {
    const now = nowSec();
    w.n++; w.sum += credited; w.lastShareAt = now;
    const elapsed = Math.max(1, now - w.since);
    const I = this.cfg.shareInterval;
    const due = (w.n >= 4 && elapsed < I) || (w.n >= 6 && elapsed >= 2 * I) || (w.n >= 2 && elapsed >= 5 * I);
    if (!due) return false;
    const hps = w.sum / elapsed;
    const f = Math.max(0.25, Math.min(16, (hps * I) / w.work));
    if (Math.abs(f - 1) < 0.25) { w.n = 0; w.sum = 0; w.since = now; return false; }
    const before = w.target;
    this._setWork(w, w.work * f);
    return w.target !== before;
  }

  // ------------------------------------------------------------------ job

  async job(q, ip) {
    if (this.ipBuckets.take(ip)) return [429, { error: 'rate_limited' }];
    const address = q.get('address') || '';
    if (!isAddress(address)) return [400, { error: 'bad_address' }];
    const status = this._status();
    if (status !== 'live') return [503, { status }];
    const addr = lower(address);
    const st = this.chain.state;
    let bal;
    try { bal = await this.balanceOf(addr); } catch { return [503, { status: 'rpc_unavailable' }]; }
    if (bal < st.minHold) return [403, { error: 'not_holder', minHold: st.minHold.toString(), balance: bal.toString() }];
    const worker = (q.get('worker') || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
    const hint = Math.max(0, Math.min(1e12, Number(q.get('hashrate')) || 0));
    const w = this._worker(addr, worker, hint);
    return [200, {
      challenge: st.challenge,
      blockTarget: st.target.toString(),
      shareTarget: w.target.toString(),
      beneficiary: this.cfg.pool,
      height: st.height,
      minHold: st.minHold.toString(),
      shareDifficulty: w.work,
      shareInterval: this.cfg.shareInterval,
      nonceRule: 'nonce >> 96 == address (put your own 20-byte address in the top of the 32-byte nonce)',
    }];
  }

  // ------------------------------------------------------------------ shares

  async share(body, ip) {
    if (this.ipBuckets.take(ip)) return [429, { ok: false, error: 'rate_limited' }];
    if (!body || typeof body !== 'object') return [400, { ok: false, error: 'bad_request' }];
    const { address, challenge } = body;
    const nonce = parseUint256(body.nonce);
    if (!isAddress(address) || !isBytes32(challenge) || nonce === null) return [400, { ok: false, error: 'bad_request' }];
    const status = this._status();
    if (status !== 'live') return [503, { ok: false, status }];

    const addr = lower(address);
    const ch = lower(challenge);
    const retry = this.shareBuckets.take(addr);
    if (retry) return [429, { ok: false, error: 'rate_limited', retryAfter: retry }];

    const bad = (code, error, extra = {}) => {
      const ban = this.badBuckets.take(ip);
      return [ban ? 429 : code, { ok: false, error: ban ? 'rate_limited' : error, ...extra }];
    };

    if ((nonce >> 96n) !== BigInt(addr)) return bad(400, 'bad_nonce', { hint: 'nonce >> 96 must equal your address' });

    const st = this.chain.state;
    let current = ch === st.challenge;
    if (!current) {
      const graceOk = ch === this.chain.prevChallenge && nowSec() - this.chain.challengeChangedAt <= this.cfg.staleGraceSec;
      if (!graceOk) return [409, { ok: false, error: 'stale', challenge: st.challenge, height: st.height }];
    }

    const nonceHex = '0x' + nonce.toString(16).padStart(64, '0');
    let seen = this.seen.get(ch);
    if (seen?.has(nonceHex)) return bad(409, 'duplicate');

    // proof of work first (cheap, local), the holder check (cached RPC) only for valid work
    const digest = keccak256(solidityPacked(['bytes32', 'address', 'uint256'], [ch, this.cfg.pool, nonce]));
    const d = BigInt(digest);

    const worker = String(body.worker || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
    const w = this._worker(addr, worker, 0, false);
    const now = nowSec();
    let credited;
    if (d <= w.target) credited = w.work;
    else if (w.prev && now < w.prev.until && d <= w.prev.target) credited = w.prev.work;
    else return bad(400, 'low_difficulty', { shareTarget: w.target.toString() });

    let bal;
    try { bal = await this.balanceOf(addr); } catch { return [503, { ok: false, status: 'rpc_unavailable' }]; }
    if (bal < st.minHold) return [403, { ok: false, error: 'not_holder', minHold: st.minHold.toString(), balance: bal.toString() }];

    // re-check after the await: another request may have recorded the same nonce meanwhile
    seen = this.seen.get(ch);
    if (!seen) { seen = new Set(); this.seen.set(ch, seen); }
    if (seen.has(nonceHex)) return bad(409, 'duplicate');
    seen.add(nonceHex);

    this._record(addr, credited, now);
    const changed = this._vardiff(w, credited);
    const out = { ok: true, block: false, chainHeight: this.chain.state.height };
    if (!current) out.challenge = this.chain.state.challenge;   // credited in the grace window; fetch new work
    if (changed) out.shareTarget = w.target.toString();

    if (current && d <= this.chain.state.target && this.chain.state.challenge === ch) {
      const r = await this._blockCandidate({ nonce, challenge: ch, addr });
      Object.assign(out, r);
    }
    return [200, out];
  }

  _record(addr, work, t) {
    this.raw.push([Math.round(t * 1000) / 1000, addr, work]);
    const m = Math.floor(t / 60);
    if (m !== this.minuteCur.idx) this._rollMinute(m);
    this.minuteCur.n++; this.minuteCur.w += work; this.minuteCur.addrs.add(addr);
    const b = Math.floor(t / ADDR_BUCKET);
    const arr = this.addrBuckets[addr] || (this.addrBuckets[addr] = []);
    const last = arr[arr.length - 1];
    if (last && last[0] === b) { last[1]++; last[2] += work; } else arr.push([b, 1, work]);
    this._saveShares();
  }

  _rollMinute(m) {
    const cur = this.minuteCur;
    if (m <= cur.idx) return;
    if (cur.n > 0) {
      this.minutes.push([cur.idx, cur.n, cur.w]);
      if (m - cur.idx === 1) this.agent.add('shares', say.shares(cur.n, cur.addrs.size, cur.w / 60));
      this._saveShares();
    }
    this.minuteCur = { idx: m, n: 0, w: 0, addrs: new Set() };
  }

  _trim() {
    const now = nowSec();
    const st = this.chain.state;
    const need = st ? this.cfg.pplnsFactor * workOf(st.target) * 1.5 : Infinity;
    let cut = 0, acc = 0;
    for (let i = this.raw.length - 1; i >= 0; i--) {
      acc += this.raw[i][2];
      if (acc >= need && this.raw[i][0] < now - RAW_MIN_KEEP) { cut = i; break; }
    }
    while (cut < this.raw.length && this.raw[cut][0] < now - DAY) cut++;
    if (cut > 0) this.raw.splice(0, cut);
    const minM = Math.floor(now / 60) - 1440;
    while (this.minutes.length && this.minutes[0][0] < minM) this.minutes.shift();
    const minB = Math.floor(now / ADDR_BUCKET) - 144;
    for (const [a, arr] of Object.entries(this.addrBuckets)) {
      while (arr.length && arr[0][0] < minB) arr.shift();
      if (!arr.length) delete this.addrBuckets[a];
    }
    for (const [k, w] of this.workers) if (now - w.lastSeen > 3600) this.workers.delete(k);
    for (const [a, h] of this.holders) if (!h.p && Date.now() - h.at > 10 * HOLDER_TTL_MS) this.holders.delete(a);
    for (const [k, c] of this.claimedCache) if (!c.v && Date.now() - c.at > 600000) this.claimedCache.delete(k);
    this._saveShares();
  }

  _onChallenge(st) {
    for (const c of [...this.seen.keys()]) if (c !== st.challenge && c !== this.chain.prevChallenge) this.seen.delete(c);
    for (const c of [...this.submitted.keys()]) if (c !== st.challenge) this.submitted.delete(c);
    if (this.blockQueue && this.blockQueue.challenge !== st.challenge) {
      clearTimeout(this.blockQueue.timer);
      this.blockQueue = null;
      this.agent.add('submit', say.lostRace());
    }
    this._saveShares();
  }

  // ------------------------------------------------------------------ blocks

  async _blockCandidate(c) {
    if (this.submitted.has(c.challenge)) return { block: false };
    if (this.blockQueue && this.blockQueue.challenge === c.challenge) return { block: false };
    return this._submitBlock(c);
  }

  async _submitBlock(c) {
    const st = this.chain.state;
    if (!st || st.challenge !== c.challenge) { this.agent.add('submit', say.lostRace()); return { block: false }; }
    if (!this.operator.ready) return { block: false, error: 'operator_missing' };
    if (this.submitted.has(c.challenge)) return { block: false };
    const wait = st.lastBlockTime + st.minSpacing - this.chain.chainNow();
    if (wait > 0) return this._queue(c, wait, st.lastBlockTime + st.minSpacing);

    // claim this challenge before the first await so a second winning share cannot race us
    this.submitted.set(c.challenge, 'pending');
    const data = minerIface.encodeFunctionData('mint', [c.nonce, this.cfg.pool]);
    try {
      await this.rpc.ethCall(this.cfg.miner, data, this.operator.address);
    } catch (e) {
      this.submitted.delete(c.challenge);
      const name = revertName(e.data);
      if (name === 'TooEarly') return this._queue(c, 2, null);
      if (name === 'NotHolder') this.agent.add('warn', say.operatorNotHolder());
      else this.agent.add('submit', say.mintFailed(name || 'simulation failed'));
      return { block: false, error: name || 'mint_failed' };
    }
    let hash;
    try { hash = await this.operator.send(this.cfg.miner, data); }
    catch (e) {
      this.submitted.delete(c.challenge);
      this.agent.add('submit', say.mintFailed(revertName(e.data) || safeError(e).slice(0, 60)));
      return { block: false, error: 'send_failed' };
    }
    this.submitted.set(c.challenge, hash);
    this.agent.add('submit', say.submit(st.height + 1, hash));
    this.operator.wait(hash).then((r) => {
      if (r?.status === 1) this.chain.kick();
      else {
        this.agent.add('submit', say.mintFailed(r ? 'reverted' : 'no receipt yet'));
        if (r) this.submitted.delete(c.challenge);
      }
    });
    return { block: true, tx: hash, height: st.height + 1 };
  }

  _queue(c, wait, submitAt) {
    if (this.blockQueue) clearTimeout(this.blockQueue.timer);
    else this.agent.add('submit', say.queued(wait));
    const timer = setTimeout(() => {
      this.blockQueue = null;
      this._submitBlock(c).catch((e) => console.warn(`[pool] queued mint: ${safeError(e)}`));
    }, Math.ceil(wait * 1000) + 600);
    this.blockQueue = { challenge: c.challenge, timer, submitAt };
    return { block: true, tx: null, queued: true, submitAt: submitAt ? Math.ceil(submitAt) : null, height: (this.chain.state?.height ?? 0) + 1 };
  }

  // ------------------------------------------------------------------ PPLNS

  _allocate(ev, targetBefore) {
    if (ev.height <= this.L.lastAllocatedHeight) return;
    const reward = BigInt(ev.reward) + BigInt(this.L.unassigned || '0');
    const N = this.cfg.pplnsFactor * workOf(targetBefore);
    const weights = new Map();
    let acc = 0;
    for (let i = this.raw.length - 1; i >= 0 && acc < N; i--) {
      const [t, a, w] = this.raw[i];
      if (t > ev.timestamp + 2) continue;
      const take = Math.min(w, N - acc);
      weights.set(a, (weights.get(a) || 0) + take);
      acc += take;
    }
    let paid = 0n;
    if (acc > 0) {
      const SCALE = 10n ** 15n;
      for (const [a, w] of weights) {
        const amt = (reward * BigInt(Math.floor((w / acc) * 1e15))) / SCALE;
        if (amt > 0n) {
          this.L.pending[a] = (BigInt(this.L.pending[a] || '0') + amt).toString();
          paid += amt;
        }
      }
    }
    this.L.unassigned = (reward - paid).toString();
    this.L.lastAllocatedHeight = ev.height;
    this.L.allocations.push({ height: ev.height, reward: ev.reward, tx: ev.tx, miners: weights.size, work: acc, t: ev.timestamp });
    if (this.L.allocations.length > 200) this.L.allocations.splice(0, this.L.allocations.length - 200);
    this._saveLedger();
  }

  // ------------------------------------------------------------------ epochs / payouts

  _capWei() {
    const dec = this.chain.info.decimals;
    if (this.cfg.payoutCapTokens) return parseUnits(this.cfg.payoutCapTokens, dec);
    if (!this.cfg.payoutCapBps) return null;
    const reward = this.chain.state?.reward ?? 0n;
    if (reward === 0n) return null;
    const blocksPerEpoch = this.cfg.epochSeconds / this.chain.info.targetSpacing;
    const emission = (reward * BigInt(Math.round(blocksPerEpoch * 1000))) / 1000n;
    const cap = (emission * BigInt(Math.round(this.cfg.payoutCapBps))) / 10000n;
    return cap > 0n ? cap : null;
  }

  async _tick() {
    this._rollMinute(Math.floor(nowSec() / 60));
    if (this.epochBusy || Date.now() < this.epochRetryAt) return;
    this.epochBusy = true;
    try {
      if (this.L.draft) { await this._sendDraft(); return; }
      const E = this.cfg.epochSeconds;
      const boundary = Math.floor(nowSec() / E) * E;
      if (!this.L.lastCloseAt) { this.L.lastCloseAt = boundary; this._saveLedger(); return; }
      if (boundary <= this.L.lastCloseAt) return;
      if (!this.operator.ready || !this.chain.state || this.health.wrongOperator) return;
      await this._close(boundary);
    } catch (e) {
      console.warn(`[pool] epoch: ${safeError(e)}`);
      this.epochRetryAt = Date.now() + 30000;
    } finally { this.epochBusy = false; }
  }

  async _view(iface, to, fn, args = [], from) {
    const out = await this.rpc.ethCall(to, iface.encodeFunctionData(fn, args), from);
    return iface.decodeFunctionResult(fn, out);
  }

  async _close(boundary) {
    const cap = this._capWei();
    let entries = [];
    let capped = 0;
    for (const [a, v] of Object.entries(this.L.pending)) {
      let amt = BigInt(v);
      if (amt <= 0n) continue;
      if (cap !== null && amt > cap) { amt = cap; capped++; }
      entries.push({ account: a, amount: amt });
    }
    let total = entries.reduce((s, e) => s + e.amount, 0n);
    if (total > 0n) {
      const free = BigInt((await this._view(poolIface, this.cfg.pool, 'unallocated'))[0]);
      if (total > free) {
        entries = entries.map((e) => ({ account: e.account, amount: (e.amount * free) / total })).filter((e) => e.amount > 0n);
        total = entries.reduce((s, e) => s + e.amount, 0n);
        this.agent.add('warn', `pool balance is short of the ledger. paying ${formatEther(free)} worth pro rata, rest stays pending.`);
      }
    }
    if (total === 0n || !entries.length) {
      this.L.lastCloseAt = boundary;
      this._saveLedger();
      return;
    }
    const tree = buildTree(entries);
    for (const e of entries) {
      const left = BigInt(this.L.pending[e.account]) - e.amount;
      if (left > 0n) this.L.pending[e.account] = left.toString(); else delete this.L.pending[e.account];
    }
    this.L.draft = {
      epoch: this.L.nextEpoch, root: tree.root, total: total.toString(), boundary,
      leaves: entries.map((e) => [e.account, e.amount.toString()]), tx: null, sentAt: 0, capped,
    };
    this._saveLedger();
    await this._sendDraft();
  }

  async _sendDraft() {
    const d = this.L.draft;
    if (!d) return;
    const onchain = String((await this._view(poolIface, this.cfg.pool, 'epochRoot', [d.epoch]))[0]).toLowerCase();
    if (onchain === d.root.toLowerCase()) return this._finalizeDraft();
    if (onchain !== ZERO32) {
      // epoch id already used on-chain by something else: move to the next free id
      d.epoch += 1; d.tx = null; d.sentAt = 0;
      this._saveLedger();
      return;
    }
    if (d.tx) {
      const r = await this.operator.wait(d.tx, 1500);
      if (!r && nowSec() - d.sentAt < 300) return;            // still pending, check next tick
      if (r && r.status === 1) return;                          // landed; epochRoot catches up next tick
      d.tx = null;                                              // reverted or dropped: send again below
    }
    const data = poolIface.encodeFunctionData('postEpoch', [d.epoch, d.root, BigInt(d.total)]);
    try { await this.rpc.ethCall(this.cfg.pool, data, this.operator.address); }
    catch (e) {
      const name = revertName(e.data) || safeError(e).slice(0, 60);
      this.agent.add('payout', say.payoutFailed(name));
      this._rollbackDraft();
      this.epochRetryAt = Date.now() + 60000;
      return;
    }
    const hash = await this.operator.send(this.cfg.pool, data);
    d.tx = hash; d.sentAt = nowSec();
    this._saveLedger();
    const r = await this.operator.wait(hash, 90000);
    if (r?.status === 1) return this._finalizeDraft();
    if (r) { this.agent.add('payout', say.payoutFailed('reverted')); this._rollbackDraft(); this.epochRetryAt = Date.now() + 60000; }
  }

  _finalizeDraft() {
    const d = this.L.draft;
    const e = { epoch: d.epoch, root: d.root, total: d.total, leaves: d.leaves, tx: d.tx, postedAt: Math.floor(nowSec()), boundary: d.boundary };
    this.L.epochs.push(e);
    this.L.nextEpoch = d.epoch + 1;
    this.L.lastCloseAt = Math.max(this.L.lastCloseAt, d.boundary);
    this.L.draft = null;
    this._saveLedger();
    this._indexEpoch(e);
    const info = this.chain.info;
    this.agent.add('payout', say.payout(e.epoch, e.leaves.length, e.total, info.symbol, info.decimals, e.root));
    if (d.capped) this.agent.add('payout', say.capped(d.capped));
  }

  _rollbackDraft() {
    const d = this.L.draft;
    if (!d) return;
    for (const [a, amt] of d.leaves) this.L.pending[a] = (BigInt(this.L.pending[a] || '0') + BigInt(amt)).toString();
    this.L.draft = null;
    this._saveLedger();
  }

  _indexEpoch(e) {
    for (const [a, amt] of e.leaves) {
      const arr = this.leafIndex.get(a) || [];
      arr.push({ epoch: e.epoch, amount: amt });
      this.leafIndex.set(a, arr);
    }
  }

  _tree(epoch) {
    if (this.trees.has(epoch)) return this.trees.get(epoch);
    const e = this.L.epochs.find((x) => x.epoch === epoch);
    if (!e) return null;
    const t = buildTree(e.leaves.map(([account, amount]) => ({ account, amount })));
    if (t.root !== e.root) throw new Error(`epoch ${epoch} root mismatch`);
    this.trees.set(epoch, t);
    if (this.trees.size > 8) this.trees.delete(this.trees.keys().next().value);
    return t;
  }

  async _isClaimed(epoch, addr) {
    const k = `${epoch}:${addr}`;
    const c = this.claimedCache.get(k);
    if (c && (c.v || Date.now() - c.at < 30000)) return c.v;
    const v = Boolean((await this._view(poolIface, this.cfg.pool, 'claimed', [epoch, addr]))[0]);
    this.claimedCache.set(k, { v, at: Date.now() });
    return v;
  }

  // ------------------------------------------------------------------ read routes

  _addrRate(addr, now) {
    let sum = 0, first = Infinity;
    for (let i = this.raw.length - 1; i >= 0; i--) {
      const [t, a, w] = this.raw[i];
      if (t < now - 600) break;
      if (a === addr) { sum += w; first = t; }
    }
    if (!sum) return 0;
    return sum / Math.max(60, Math.min(600, now - first));
  }

  async me(q, ip) {
    if (this.ipBuckets.take(ip)) return [429, { error: 'rate_limited' }];
    const address = q.get('address') || '';
    if (!isAddress(address)) return [400, { error: 'bad_address' }];
    const addr = lower(address);
    const now = nowSec();
    const minB = Math.floor(now / ADDR_BUCKET) - 144;
    const shares24h = (this.addrBuckets[addr] || []).reduce((s, b) => s + (b[0] > minB ? b[1] : 0), 0);
    let pending = BigInt(this.L.pending[addr] || '0');
    const inDraft = this.L.draft?.leaves.find(([a]) => a === addr);
    if (inDraft) pending += BigInt(inDraft[1]);

    const claimable = [];
    const claimed = [];
    for (const { epoch, amount } of this.leafIndex.get(addr) || []) {
      let done = false;
      try { done = await this._isClaimed(epoch, addr); } catch { /* show it; the contract will refuse if claimed */ }
      if (done) { claimed.push({ epoch, amount }); continue; }
      const proof = this._tree(epoch).proofs.get(addr);
      claimable.push({ epoch, amount, proof });
    }
    return [200, {
      status: this._status(),
      address: addr,
      shares24h,
      hashrate: this._addrRate(addr, now),
      pending: pending.toString(),
      claimable,
      claimed,
      pool: this.cfg.pool,
      nextPayoutAt: (Math.floor(now / this.cfg.epochSeconds) + 1) * this.cfg.epochSeconds,
    }];
  }

  stats() {
    const now = nowSec();
    let sum = 0, first = Infinity;
    const miners = new Set();
    for (let i = this.raw.length - 1; i >= 0; i--) {
      const [t, a, w] = this.raw[i];
      if (t < now - 600) break;
      sum += w; first = t; miners.add(a);
    }
    const hashrate = sum ? sum / Math.max(30, Math.min(600, now - first)) : 0;
    const minM = Math.floor(now / 60) - 1440;
    const shares24h = this.minutes.reduce((s, m) => s + (m[0] > minM ? m[1] : 0), 0) + this.minuteCur.n;
    const lastEpoch = this.L.epochs[this.L.epochs.length - 1];
    const cap = this._capWei();
    const lb = this.chain.lastPoolBlock;
    return {
      status: this._status(),
      miners10m: miners.size,
      hashrate,
      shares24h,
      blocksFound: this.chain.poolBlocksFound,
      lastBlock: lb ? { height: lb.height, timestamp: lb.timestamp, tx: lb.tx, reward: lb.reward } : null,
      epoch: this.L.draft ? this.L.draft.epoch : this.L.nextEpoch,
      nextPayoutAt: (Math.floor(now / this.cfg.epochSeconds) + 1) * this.cfg.epochSeconds,
      epochSeconds: this.cfg.epochSeconds,
      lastEpoch: lastEpoch ? { epoch: lastEpoch.epoch, total: lastEpoch.total, wallets: lastEpoch.leaves.length, tx: lastEpoch.tx, postedAt: lastEpoch.postedAt } : null,
      payoutCap: cap === null ? null : cap.toString(),
      pplnsFactor: this.cfg.pplnsFactor,
      shareInterval: this.cfg.shareInterval,
      operator: this.operator.address || null,
      beneficiary: this.cfg.pool,
    };
  }

  async _checkOperator() {
    if (!this.operator.ready) {
      if (!this.health.missing) { this.health.missing = true; this.agent.add('warn', say.operatorMissing()); }
      return;
    }
    this.health.missing = false;
    try {
      const onchain = String((await this._view(poolIface, this.cfg.pool, 'operator'))[0]).toLowerCase();
      const wrong = onchain !== this.operator.address;
      if (wrong && !this.health.wrongOperator) {
        this.agent.add('warn', say.operatorWrong());
        console.warn(`[pool] OPERATOR_KEY is for ${this.operator.address} but the pool contract's operator is ${onchain}; payouts are off`);
      }
      this.health.wrongOperator = wrong;
    } catch { /* optional view */ }
    const eth = await this.operator.ethBalance();
    const low = eth < 5n * 10n ** 14n;
    if (low && !this.health.gasLow) this.agent.add('warn', say.operatorLowGas(formatEther(eth)));
    this.health.gasLow = low;
    const st = this.chain.state;
    if (st) {
      const bal = await this.balanceOf(this.operator.address);
      const nh = bal < st.minHold;
      if (nh && !this.health.notHolder) this.agent.add('warn', say.operatorNotHolder());
      this.health.notHolder = nh;
      // say it out loud once per boot when everything checks out (a stale "key missing" line must not be the last word)
      if (!nh && !low && !this.health.wrongOperator && !this.health.readySaid) {
        this.health.readySaid = true;
        this.agent.add('status', say.operatorReady(this.operator.address, bal, st.symbol || 'CCODE', st.decimals ?? 18, Number(formatEther(eth)).toFixed(4)));
      }
    }
  }
}
