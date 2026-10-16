// Chain reader: polls ColourcodeMiner.state() and pages through Mined logs (<= LOG_RANGE blocks per call).
// Emits:
//   'challenge' (state, prevChallenge)   the work changed (new block or start)
//   'mined'     (event, { live, targetBefore })   one Mined log, ascending height, never twice per height
//   'synced'    ({ blocks, height })      first catch-up finished
import { EventEmitter } from 'node:events';
import { minerIface, erc20Iface, MINED_TOPIC, decodeMined } from './contracts.mjs';
import { workOf, safeError } from './util.mjs';

const KEEP_BLOCKS = 200;

export class Chain extends EventEmitter {
  constructor(cfg, rpc, store) {
    super();
    this.cfg = cfg;
    this.rpc = rpc;
    this.store = store;
    const saved = store.load('chain', null);
    this.p = saved && saved.miner === cfg.miner ? saved : {
      miner: cfg.miner, cursor: null, blocks: [], lastNewTarget: null, poolBlocksFound: 0, poolBlocks: [], lastHeight: 0,
    };
    this.state = null;          // decoded state() with BigInt fields
    this.latest = null;         // { number, timestamp, at }
    this.prevChallenge = null;
    this.challengeChangedAt = 0;
    this.info = { token: cfg.token, decimals: 18, symbol: cfg.ticker, genesisMessage: '', halvingInterval: cfg.halvingInterval, targetSpacing: cfg.targetSpacing, maxTarget: null, initialTarget: null };
    this.bootAt = Date.now() / 1000;
    this.synced = false;
    this.lastError = '';
    this.stopped = false;
    this.timer = null;
  }

  _save() { this.store.later('chain', () => this.p); }

  async _view(iface, to, fn, args = []) {
    const data = iface.encodeFunctionData(fn, args);
    const out = await this.rpc.ethCall(to, data);
    return iface.decodeFunctionResult(fn, out);
  }

  async _optional(fn) { try { return (await this._view(minerIface, this.cfg.miner, fn))[0]; } catch { return null; } }

  async init() {
    const chainId = Number(BigInt(await this.rpc.call('eth_chainId')));
    if (chainId !== this.cfg.chainId) throw new Error(`rpc chain id ${chainId} != expected ${this.cfg.chainId}`);
    const code = await this.rpc.call('eth_getCode', [this.cfg.miner, 'latest']);
    if (!code || code === '0x') throw new Error(`no contract at miner address ${this.cfg.miner}`);

    const token = String((await this._view(minerIface, this.cfg.miner, 'token'))[0]).toLowerCase();
    if (this.cfg.token && this.cfg.token !== token) console.warn(`[pool] configured token ${this.cfg.token} differs from miner.token() ${token}; using the contract's`);
    this.info.token = token;
    try { this.info.decimals = Number((await this._view(erc20Iface, token, 'decimals'))[0]); } catch { /* 18 */ }
    try { this.info.symbol = String((await this._view(erc20Iface, token, 'symbol'))[0]) || this.info.symbol; } catch { /* config */ }
    try { this.info.genesisMessage = String((await this._view(minerIface, this.cfg.miner, 'genesisMessage'))[0]); } catch { /* none */ }
    const hi = await this._optional('HALVING_INTERVAL'); if (hi) this.info.halvingInterval = Number(hi);
    const ts = await this._optional('TARGET_SPACING'); if (ts) this.info.targetSpacing = Number(ts);
    const mt = await this._optional('MAX_TARGET'); if (mt) this.info.maxTarget = BigInt(mt);
    const it = await this._optional('INITIAL_TARGET'); if (it) this.info.initialTarget = BigInt(it);

    if (this.p.cursor === null) {
      const start = this.cfg.startBlock || await this._findDeployBlock();
      this.p.cursor = Math.max(0, start - 1);
      this._save();
    }
  }

  /** First block where the miner has code (binary search over eth_getCode; needs an archive RPC). */
  async _findDeployBlock() {
    const latest = await this.rpc.blockNumber();
    let lo = 0, hi = latest;
    try {
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        const code = await this.rpc.call('eth_getCode', [this.cfg.miner, '0x' + mid.toString(16)]);
        if (code && code !== '0x') hi = mid; else lo = mid + 1;
      }
      return lo;
    } catch (e) {
      console.warn(`[pool] could not locate deploy block (${safeError(e)}); scanning the last 200k blocks. Set START_BLOCK to be exact.`);
      return Math.max(0, latest - 200000);
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    (async () => {
      while (!this.stopped) {
        this.kicked = false;
        try { await this.poll(); this.lastError = ''; }
        catch (e) {
          const msg = safeError(e);
          if (msg !== this.lastError) console.warn(`[pool] chain poll: ${msg}`);
          this.lastError = msg;
        }
        if (this.stopped || this.kicked) continue;
        await new Promise((resolve) => {
          this.wake = resolve;
          this.timer = setTimeout(resolve, this.cfg.pollMs);
        });
        this.wake = null;
      }
      this.running = false;
    })();
  }

  stop() { this.stopped = true; clearTimeout(this.timer); this.wake?.(); }

  /** Poll again right away (e.g. after our own mint lands). */
  kick() {
    this.kicked = true;
    if (this.wake) { clearTimeout(this.timer); this.wake(); }
  }

  async poll() {
    const [raw, latest] = await Promise.all([
      this.rpc.ethCall(this.cfg.miner, minerIface.encodeFunctionData('state')),
      this.rpc.latestBlock(),
    ]);
    const r = minerIface.decodeFunctionResult('state', raw);
    const st = {
      challenge: String(r.challenge).toLowerCase(), target: BigInt(r.target), height: Number(r.height), reward: BigInt(r.reward),
      lastBlockTime: Number(r.lastBlockTime), reserve: BigInt(r.reserve), minHold: BigInt(r.minHold),
      minSpacing: Number(r.minSpacing), startTime: Number(r.startTime), started: Boolean(r.started),
    };
    this.latest = { ...latest, at: Date.now() };

    // Logs first, so 'mined' handlers run before 'challenge' handlers see the new work.
    const behind = latest.number - this.p.cursor;
    if (behind > 0) {
      const to = Math.min(latest.number, this.p.cursor + this.cfg.logRange * 25);
      await this.rpc.getLogsPaged({ address: this.cfg.miner, topics: [MINED_TOPIC] }, this.p.cursor + 1, to, this.cfg.logRange, async (logs, pageTo) => {
        const evs = logs.filter((l) => !l.removed).map(decodeMined).sort((a, b) => a.height - b.height);
        for (const ev of evs) this._onMined(ev);
        this.p.cursor = pageTo;
        this._save();
      });
    }

    const prev = this.state;
    this.state = st;
    if (!prev || prev.challenge !== st.challenge || prev.started !== st.started) {
      if (prev && prev.challenge !== st.challenge) { this.prevChallenge = prev.challenge; this.challengeChangedAt = Date.now() / 1000; }
      this.emit('challenge', st, prev);
    }
    if (!this.synced && this.p.cursor >= latest.number) {
      this.synced = true;
      this.emit('synced', { blocks: this.p.blocks.length, height: st.height });
    }
  }

  _onMined(ev) {
    if (ev.height <= this.p.lastHeight) return; // already seen
    const targetBefore = this.p.lastNewTarget ?? (this.info.initialTarget !== null ? this.info.initialTarget.toString() : ev.newTarget);
    this.p.lastHeight = ev.height;
    this.p.lastNewTarget = ev.newTarget;
    this.p.blocks.push(ev);
    if (this.p.blocks.length > KEEP_BLOCKS) this.p.blocks.splice(0, this.p.blocks.length - KEEP_BLOCKS);
    const isPool = ev.beneficiary === this.cfg.pool;
    if (isPool) {
      this.p.poolBlocksFound++;
      this.p.poolBlocks.push({ height: ev.height, timestamp: ev.timestamp, tx: ev.tx, reward: ev.reward, miner: ev.miner });
      if (this.p.poolBlocks.length > 100) this.p.poolBlocks.shift();
    }
    const live = ev.timestamp >= this.bootAt - 90;
    this.emit('mined', ev, { live, isPool, targetBefore: BigInt(targetBefore) });
  }

  /** Best guess of the chain's current timestamp. */
  chainNow() {
    const local = Date.now() / 1000;
    if (!this.latest) return local;
    return Math.max(local, this.latest.timestamp + (Date.now() - this.latest.at) / 1000);
  }

  get poolBlocksFound() { return this.p.poolBlocksFound; }
  get lastPoolBlock() { return this.p.poolBlocks[this.p.poolBlocks.length - 1] || null; }

  snapshot() {
    const base = { chainId: this.cfg.chainId, miner: this.cfg.miner, pool: this.cfg.pool, token: this.info.token };
    if (!this.state) return { status: 'syncing', ...base, error: this.lastError || undefined };
    const s = this.state;
    const hi = this.info.halvingInterval;
    return {
      status: s.started ? 'live' : 'not_started',
      ...base,
      symbol: this.info.symbol,
      decimals: this.info.decimals,
      genesisMessage: this.info.genesisMessage,
      challenge: s.challenge,
      height: s.height,
      target: s.target.toString(),
      difficulty: workOf(s.target),
      reward: s.reward.toString(),
      reserve: s.reserve.toString(),
      minHold: s.minHold.toString(),
      minSpacing: s.minSpacing,
      targetSpacing: this.info.targetSpacing,
      halvingInterval: hi,
      lastBlockTime: s.lastBlockTime,
      startTime: s.startTime,
      nextHalvingAt: (Math.floor(s.height / hi) + 1) * hi,
      blocks: this.p.blocks.slice(-20).reverse().map((b) => ({
        height: b.height, miner: b.miner, beneficiary: b.beneficiary, reward: b.reward, digest: b.digest, timestamp: b.timestamp, tx: b.tx,
      })),
      chainBlock: this.latest?.number ?? null,
      synced: this.synced,
      updatedAt: Math.floor((this.latest?.at ?? Date.now()) / 1000),
    };
  }
}
