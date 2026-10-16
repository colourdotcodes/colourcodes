// colour.codes Pool: pool stats (GET /api/pool/stats), your account (GET /api/pool/me),
// and claims sent straight from your wallet to ColourcodePool.claim.
import { h, button, group, listView, statePanel, ago, until, timeHMS, ticker, cfg, openLink } from '../ui.js';
import { iconImg } from '../icons.js';
import { api, describe, poller } from '../api.js';
import { fmtInt, fmtUnits, fmtHashrate, short, selector, signatureOf, encode, isAddress } from '../eth.js';
import { getWallet, connectFlow } from '../walletui.js';

const CLAIM_SIG = 'claim(uint256,address,uint256,bytes32[])';

export default {
  title: 'colour.codes Pool',
  size: [560, 486],
  pos: [404, 70],
  min: [440, 400],
  status: true,
  menu: (os) => [
    { label: 'File', items: () => [{ label: 'Refresh', onClick: () => cur?.refresh() }, { sep: true }, { label: 'Close', onClick: () => os.close('pool') }] },
    { label: 'Account', items: () => [
      cur?.address ? { label: 'Disconnect Wallet', onClick: () => window.ColourcodeWallet?.disconnect() } : { label: 'Connect Wallet…', icon: 'buy', onClick: () => cur?.connect() },
      { label: 'Open colour.codes Miner', icon: 'miner', onClick: () => os.open('miner') },
    ] },
    { label: 'Help', items: () => [{ label: 'How payouts work', onClick: () => os.msgbox({ title: 'colour.codes Pool', icon: 'pool', text: ['Every holder\'s miner works on the same pool job. When a share is good enough to be a block, the pool submits it and the reward goes to the pool contract.', 'Once a day the rewards are split by shares (PPLNS), a Merkle root is posted on-chain, and each miner claims their part from their own wallet. There are no deposits and no other way to withdraw.'] }) }] },
  ],
  mount(win, os) {
    const p = new Pool(win, os);
    cur = p;
    return { onClose: () => { p.destroy(); if (cur === p) cur = null; }, onShow: () => p.refresh() };
  },
};
let cur = null;

class Pool {
  constructor(win, os) {
    this.win = win; this.os = os;
    this.address = null;
    const stat = (label) => { const b = h('b', { class: 'dim' }, '—'); return { el: h('div', { class: 'stat' }, h('small', null, label), b), b }; };
    this.s = {
      miners: stat('Active miners (10 min)'), hashrate: stat('Pool hashrate'), shares: stat('Shares (24 h)'),
      blocks: stat('Blocks found'), last: stat('Last block'), payout: stat('Next payout'),
    };
    this.statsBox = h('div', { class: 'stat-strip' }, Object.values(this.s).map((x) => x.el));
    this.statsState = h('div', { class: 'stat-note', hidden: true });
    // account
    this.acct = h('div');
    this.claims = listView([
      { label: 'Epoch', key: 'epoch', width: '64px', num: true },
      { label: 'Amount', key: 'amount', num: true },
      { label: '', key: 'action', width: '96px' },
    ], { empty: 'Nothing to claim yet.' });
    this.claims.el.style.minHeight = '88px';
    win.body.append(h('div', { style: { padding: '0 4px', display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0' } },
      group('colour.codes Pool', this.statsState, this.statsBox,
        h('div', { class: 'faint', style: { fontSize: '11px' } }, 'Real numbers from the pool server. Hashrate is estimated from submitted shares.')),
      h('div', { class: 'group', style: { flex: '1', display: 'flex', flexDirection: 'column', minHeight: '0' } }, h('span', { class: 'legend' }, 'Your account'), this.acct, this.claims.el)));
    this.status('Contacting the pool server…');
    this.poll = poller(() => this.loadStats(), 15000);
    this.wire();
  }

  async wire() {
    const W = await getWallet();
    if (!W) { this.renderAccount(); return; }
    const sync = () => {
      const a = W.address;
      if (a !== this.address) { this.address = a; this.me = null; this.renderAccount(); if (a) this.loadMe(); }
    };
    this.unW = W.on('change', sync);
    sync();
    this.renderAccount();
  }
  async connect() { const a = await connectFlow(this.os, this.win); if (a) { this.address = a; this.renderAccount(); this.loadMe(); } }
  refresh() { this.poll.now(); if (this.address) this.loadMe(); }

  async loadStats() {
    const r = await api.stats();
    if (this.dead) return r;
    if (r.kind !== 'ok') {
      const d = describe(r);
      this.statsState.replaceChildren(iconImg(d.icon, 16), h('span', null, h('b', null, d.title + '. '), d.text));
      this.statsState.hidden = false;
      for (const k in this.s) { this.s[k].b.textContent = '—'; this.s[k].b.classList.add('dim'); }
      this.status(d.title);
      return r;
    }
    this.statsState.hidden = true;
    const d = r.data;
    const set = (k, v, t) => { this.s[k].b.textContent = v; this.s[k].b.classList.toggle('dim', v === '—'); if (t) this.s[k].b.title = t; };
    set('miners', d.miners10m != null ? fmtInt(d.miners10m) : '—');
    set('hashrate', d.hashrate != null ? fmtHashrate(d.hashrate) : '—');
    set('shares', d.shares24h != null ? fmtInt(d.shares24h) : '—');
    set('blocks', d.blocksFound != null ? fmtInt(d.blocksFound) : '—');
    const lb = d.lastBlock;
    set('last', lb ? (typeof lb === 'object' ? (lb.timestamp ? ago(lb.timestamp) : '#' + fmtInt(lb.height)) : '#' + fmtInt(lb)) : '—', lb && typeof lb === 'object' && lb.height != null ? 'Block #' + fmtInt(lb.height) : undefined);
    set('payout', d.nextPayoutAt ? 'in ' + until(d.nextPayoutAt) : '—', d.epoch != null ? 'Epoch ' + fmtInt(d.epoch) : undefined);
    this.updated = Date.now();
    this.status(d.epoch != null ? `Epoch ${fmtInt(d.epoch)}` : 'Pool online');
    return r;
  }

  async loadMe() {
    if (!this.address) return;
    this.meState = 'loading'; this.renderAccount();
    const r = await api.me(this.address);
    if (this.dead) return;
    this.meState = r.kind; this.me = r.kind === 'ok' ? r.data : null; this.meRes = r;
    this.renderAccount();
  }

  renderAccount() {
    const T = ticker();
    if (!this.address) {
      this.acct.replaceChildren(h('div', { class: 'row', style: { marginBottom: '8px' } }, iconImg('info', 16),
        h('span', { class: 'grow muted' }, 'Connect the wallet you mine with to see your shares and claim payouts.'),
        button('Connect Wallet', { icon: 'buy', onClick: () => this.connect() })));
      this.claims.setRows([]); this.claims.setEmpty('Connect a wallet to see claimable payouts.');
      return;
    }
    const head = h('div', { class: 'row', style: { marginBottom: '6px' } }, h('span', { class: 'lbl' }, 'Wallet:'), h('span', { class: 'mono strong' }, short(this.address, 8, 6)),
      h('span', { class: 'grow' }), button('Refresh', { small: true, onClick: () => this.loadMe() }));
    if (this.meState === 'loading') { this.acct.replaceChildren(head, h('div', { class: 'muted', style: { marginBottom: '8px' } }, 'Loading your account…')); return; }
    if (this.meState !== 'ok') {
      const d = describe(this.meRes || { kind: 'error' });
      this.acct.replaceChildren(head, h('div', { class: 'row', style: { marginBottom: '8px' } }, iconImg(d.icon, 16), h('span', { class: 'muted' }, d.title + '. ' + d.text)));
      this.claims.setRows([]); this.claims.setEmpty('Claims appear here after the first payout epoch.');
      return;
    }
    const m = this.me;
    this.acct.replaceChildren(head, h('dl', { class: 'kv cols2', style: { marginBottom: '8px' } },
      h('dt', null, 'Shares (24 h)'), h('dd', null, fmtInt(m.shares24h ?? 0)),
      h('dt', null, 'Your hashrate'), h('dd', null, fmtHashrate(m.hashrate ?? 0)),
      h('dt', null, 'Pending'), h('dd', { title: 'Estimated share of rewards not yet in a posted epoch' }, `${fmtUnits(m.pending ?? 0)} ${T}`),
      h('dt', null, 'Claimable'), h('dd', null, `${(m.claimable || []).length} epoch${(m.claimable || []).length === 1 ? '' : 's'}`)));
    const rows = (m.claimable || []).map((c) => ({
      epoch: fmtInt(c.epoch),
      amount: `${fmtUnits(c.amount)} ${T}`,
      action: (() => { const b = button('Claim', { small: true, onClick: () => this.claim(c, b) }); return b; })(),
    }));
    this.claims.setRows(rows);
    this.claims.setEmpty('Nothing to claim yet. Payout epochs are posted once a day.');
  }

  async claim(c, btn) {
    const poolAddr = cfg().contracts?.pool;
    if (!isAddress(poolAddr)) { this.os.msgbox({ title: 'Claim', icon: 'info', text: 'The pool contract is not deployed yet.', parent: this.win }); return; }
    const W = await getWallet();
    if (!W?.address) { await this.connect(); if (!W?.address) return; }
    let sel;
    try {
      const sig = signatureOf(window.COLOURCODE_ABI?.pool, 'claim') || CLAIM_SIG;
      if (sig !== CLAIM_SIG) throw new Error('Unexpected claim() signature in the ABI: ' + sig);
      sel = selector(sig);
      const data = encode.claim(sel, c.epoch, W.address, c.amount, c.proof || []);
      btn.disabled = true; btn.querySelector('span').textContent = 'Confirm…';
      const hash = await W.sendTransaction({ to: poolAddr, data });
      btn.querySelector('span').textContent = 'Pending…';
      this.os.notify({ title: 'Claim sent', text: `Epoch ${fmtInt(c.epoch)} · ${short(hash, 10, 8)}`, icon: 'pool', onClick: () => openLink(W.txUrl(hash)) });
      const rc = await W.waitForReceipt(hash);
      if (rc && rc.status === '0x1') {
        this.os.notify({ title: 'Claimed', text: `${fmtUnits(c.amount)} ${ticker()} from epoch ${fmtInt(c.epoch)} is in your wallet.`, icon: 'ok' });
      } else if (rc) {
        this.os.msgbox({ title: 'Claim failed', icon: 'error', text: ['The transaction was reverted.', 'It may already be claimed. ' + hash], parent: this.win });
      }
      this.loadMe();
    } catch (e) {
      btn.disabled = false; btn.querySelector('span').textContent = 'Claim';
      if (e && (e.code === 4001 || /reject|denied/i.test(e.message || ''))) return;
      this.os.msgbox({ title: 'Claim', icon: 'error', text: (e && e.message) || 'The claim could not be sent.', parent: this.win });
    }
  }

  status(text) {
    this.win.setStatus([{ text, grow: true }, { text: 'Holders only · no deposits', width: 170 }, { text: this.updated ? 'Updated ' + timeHMS(this.updated) : 'Not updated', width: 128 }]);
  }
  destroy() { this.dead = true; this.poll.stop(); this.unW?.(); }
}
