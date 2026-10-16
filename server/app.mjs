// Wires config → rpc → chain reader → pool → agent narration, and rebuilds itself when the
// deployment addresses change (e.g. the owner fills public/config.js at launch, no restart needed).
import { join } from 'node:path';
import { loadConfig, configStamp, deployed } from './config.mjs';
import { Rpc } from './rpc.mjs';
import { Chain } from './chain.mjs';
import { Operator } from './operator.mjs';
import { Pool } from './pool.mjs';
import { JsonStore } from './store.mjs';
import { AgentLog, say } from './agent.mjs';
import { safeError, sleep } from './util.mjs';

const HALVING_MILESTONES = [10000, 5000, 1000, 500, 144, 100, 50, 10, 3, 1];

export class App {
  constructor() {
    this.stamp = configStamp();
    this.cfg = loadConfig();
    this.gen = 0;
    this._build();
    const t = setInterval(() => this._watchConfig(), 5000);
    t.unref?.();
  }

  get status() {
    if (!deployed(this.cfg)) return 'not_deployed';
    return this.chain?.state ? (this.chain.state.started ? 'live' : 'not_started') : 'syncing';
  }

  _watchConfig() {
    const s = configStamp();
    if (s === this.stamp) return;
    this.stamp = s;
    const next = loadConfig();
    const key = (c) => `${c.chainId}|${c.miner}|${c.pool}|${c.rpcUrls.join(',')}`;
    if (key(next) === key(this.cfg)) { this.cfg = next; return; }
    this._teardown();
    this.cfg = next;
    this._build();
  }

  _teardown() {
    this.gen++;
    this.chain?.stop();
    this.pool?.stop();
    this.store?.flush();
    this.chain = this.pool = this.operator = this.rpc = this.store = null;
  }

  _build() {
    const cfg = this.cfg;
    const gen = this.gen;
    if (!deployed(cfg)) {
      this.agent = new AgentLog(null);
      this.agent.add('status', say.notDeployed());
      return;
    }
    this.store = new JsonStore(join(cfg.dataDir, `${cfg.chainId}-${cfg.pool.slice(0, 10)}`));
    this.agent = new AgentLog(this.store);
    this.rpc = new Rpc(cfg.rpcUrls);
    this.chain = new Chain(cfg, this.rpc, this.store);
    this.operator = new Operator(cfg, this.rpc);
    this.pool = new Pool(cfg, this.rpc, this.chain, this.operator, this.store, this.agent);
    this._narrate();
    this.agent.add('boot', say.boot(cfg));
    (async () => {
      let delay = 2000, rpcWarned = false;
      while (gen === this.gen) {
        try { await this.chain.init(); break; }
        catch (e) {
          if (!rpcWarned) { this.agent.add('warn', say.rpcDown(safeError(e).slice(0, 80))); rpcWarned = true; }
          console.warn(`[pool] init: ${safeError(e)}`);
          await sleep(delay);
          delay = Math.min(60000, delay * 2);
        }
      }
      if (gen !== this.gen) return;
      if (rpcWarned) this.agent.add('status', say.rpcBack());
      this.chain.start();
      this.pool.start();
    })();
  }

  _narrate() {
    const chain = this.chain, agent = this.agent;
    let lastHalvingRemaining = null;
    let wasStarted = null;
    chain.on('mined', (ev, meta) => {
      const { symbol, decimals, halvingInterval } = chain.info;
      const remaining = (Math.floor(ev.height / halvingInterval) + 1) * halvingInterval - ev.height;
      if (meta.live) {
        agent.add('block', say.block({ ...ev, isPool: meta.isPool }, symbol, decimals));
        agent.add('retarget', say.retarget(meta.targetBefore, BigInt(ev.newTarget)));
        if (ev.height % halvingInterval === 0) {
          const next = BigInt(ev.reward) >> 1n;
          agent.add('halving', say.halving(0, ev.height, next, symbol, decimals));
        } else if (lastHalvingRemaining !== null) {
          for (const m of HALVING_MILESTONES) {
            if (lastHalvingRemaining > m && remaining <= m) {
              agent.add('halving', say.halving(remaining, ev.height + remaining, 0n, symbol, decimals));
              break;
            }
          }
        }
      }
      lastHalvingRemaining = remaining;
    });
    chain.on('challenge', (st) => {
      if (wasStarted === false && st.started) agent.add('status', say.started(st.height));
      if (wasStarted === null && !st.started) agent.add('status', say.notStarted());
      wasStarted = st.started;
    });
    chain.on('synced', ({ blocks, height }) => {
      agent.add('status', say.synced(blocks, height));
      const hi = chain.info.halvingInterval;
      const remaining = (Math.floor(height / hi) + 1) * hi - height;
      lastHalvingRemaining = remaining;
      if (chain.state?.started) agent.add('halving', say.halving(remaining, height + remaining, 0n, chain.info.symbol, chain.info.decimals));
    });
  }

  flush() { this.store?.flush(); }
}
