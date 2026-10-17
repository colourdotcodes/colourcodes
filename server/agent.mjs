// The colour.codes agent's terminal narration. Template lines about real events only — no LLM, no randomness.
// Variation comes from the event itself (height parity etc.), so the same event always reads the same.
// Line: { t: unix ms (strictly increasing, use as the `since` cursor), kind, text }
import { short, fmtTokens, fmtRate, fmtNum, workOf } from './util.mjs';

const KEEP = 2000;

export class AgentLog {
  constructor(store) {
    this.store = store;
    const saved = store ? store.load('agent-log', null) : null;
    this.lines = Array.isArray(saved?.lines) ? saved.lines.slice(-KEEP) : [];
    this.lastT = this.lines.length ? this.lines[this.lines.length - 1].t : 0;
  }

  add(kind, text) {
    let t = Date.now();
    if (t <= this.lastT) t = this.lastT + 1;
    this.lastT = t;
    this.lines.push({ t, kind, text });
    if (this.lines.length > KEEP) this.lines.splice(0, this.lines.length - KEEP);
    this.store?.later('agent-log', () => ({ lines: this.lines }));
  }

  since(t, limit = 200) {
    const s = Number(t) || 0;
    const out = [];
    for (let i = this.lines.length - 1; i >= 0 && out.length < limit; i--) {
      if (this.lines[i].t <= s) break;
      out.push(this.lines[i]);
    }
    return out.reverse();
  }
}

/** Phrasebook. Every function maps a real event to one line. */
export const say = {
  boot: (c) => `node up. watching ColourcodeMiner ${short(c.miner)}, pool ${short(c.pool)}.`,
  notDeployed: () => 'no contracts on chain yet. mining opens at launch. waiting.',
  notStarted: () => 'contracts are deployed. start() not called yet. nothing to mine.',
  started: (h) => (h === 0 ? 'start() is in. genesis challenge is live. first block is up for grabs.' : `mining is open. height ${h}.`),
  synced: (n, h) => `synced with the chain. height ${h}. ${n} block${n === 1 ? '' : 's'} in the recent log.`,
  rpcDown: (msg) => `rpc not answering (${msg}). retrying with backoff.`,
  rpcBack: () => 'rpc is back.',

  block(ev, sym, dec) {
    const amt = `${fmtTokens(ev.reward, dec)} ${sym}`;
    if (ev.isPool) {
      return ev.height % 2
        ? `block ${ev.height}. ours. ${amt} into the pool, split by shares.`
        : `block ${ev.height} found by the pool. ${amt}. credited to everyone in the window.`;
    }
    return ev.height % 2
      ? `block ${ev.height} went to ${short(ev.beneficiary)}. ${amt}. new challenge.`
      : `block ${ev.height}. ${short(ev.beneficiary)} solved it. ${amt}.`;
  },

  retarget(before, after) {
    const d0 = workOf(before), d1 = workOf(after);
    const pct = ((d1 / d0) - 1) * 100;
    if (Math.abs(pct) < 0.05) return `difficulty holds at ${fmtNum(d1)}.`;
    const dir = pct > 0 ? 'up' : 'down';
    return `retarget. difficulty ${dir} ${Math.abs(pct).toFixed(1)}% to ${fmtNum(d1)} hashes per block.`;
  },

  halving(remaining, nextAt, reward, sym, dec) {
    if (remaining === 0) return `halving. reward is now ${fmtTokens(reward, dec)} ${sym} per block.`;
    return remaining === 1
      ? `one block to the halving at ${nextAt}.`
      : `${remaining.toLocaleString('en-US')} blocks to the halving at height ${nextAt}.`;
  },

  shares: (n, miners, hps) => `last minute: ${n} share${n === 1 ? '' : 's'} from ${miners} miner${miners === 1 ? '' : 's'}. pool at ${fmtRate(hps)}.`,

  submit: (height, tx) => `a share beat the block target. sent mint() for block ${height}. tx ${short(tx)}.`,
  queued: (secs) => `block found ${Math.ceil(secs)}s before min spacing allows. holding the nonce.`,
  confirmed: (height) => `mint() confirmed. block ${height} is the pool's.`,
  mintFailed: (why) => `mint() did not land (${why}). someone may have been faster.`,
  lostRace: () => 'a winning share arrived after the chain moved on. it still counts as a share.',

  payout: (epoch, n, total, sym, dec, root) => `epoch ${epoch} posted. ${n} wallet${n === 1 ? '' : 's'}, ${fmtTokens(total, dec)} ${sym}. root ${short(root)}. claim any time.`,
  payoutEmpty: (epoch) => `epoch closed with nothing to pay. epoch ${epoch} stays open.`,
  payoutFailed: (why) => `postEpoch did not land (${why}). will retry.`,
  capped: (n) => `${n} wallet${n === 1 ? '' : 's'} hit the per-wallet cap. the rest carries to the next epoch.`,

  operatorMissing: () => 'operator key missing. shares are counted but cannot become blocks.',
  operatorReady: (addr, bal, sym, dec, eth) => `operator ${short(addr)} ready: holds ${fmtTokens(bal, dec)} ${sym} and ${eth} ETH. winning shares become blocks.`,
  operatorLowGas: (eth) => `operator gas is low: ${eth} ETH left.`,
  operatorNotHolder: () => 'operator wallet holds less than minHold. it cannot submit blocks.',
  operatorWrong: () => 'operator key does not match the pool contract. payouts are on hold.',
};
