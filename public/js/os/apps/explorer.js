// Block Explorer: real blocks from GET /api/chain (contract events), difficulty, halving.
import { h, listView, statePanel, button, ago, timeHMS, toMs, ticker, openLink, cfg } from '../ui.js';
import { iconImg } from '../icons.js';
import { api, describe, poller } from '../api.js';
import { fmtInt, fmtUnits, fmtCompact, short, toBig } from '../eth.js';

export default {
  title: 'Block Explorer',
  size: [700, 470],
  pos: [262, 132],
  min: [480, 320],
  status: true,
  menu: (os) => [
    { label: 'File', items: () => [{ label: 'Refresh', key: 'F5', onClick: () => cur?.poll.now() }, { sep: true }, { label: 'Close', onClick: () => os.close('explorer') }] },
    { label: 'View', items: () => [
      { label: 'Open in Blockscout', onClick: () => { const m = cfg().contracts?.miner; openLink((cfg().chain?.explorer || 'https://robinhoodchain.blockscout.com') + (m ? '/address/' + m : '')); } },
    ] },
    { label: 'Help', items: () => [{ label: 'Whitepaper', icon: 'whitepaper', onClick: () => os.open('whitepaper') }] },
  ],
  mount(win, os) {
    const e = new Explorer(win, os);
    cur = e;
    return { onClose: () => { e.destroy(); if (cur === e) cur = null; }, onShow: () => e.poll.now() };
  },
};
let cur = null;

class Explorer {
  constructor(win, os) {
    this.win = win; this.os = os;
    const stat = (label) => { const b = h('b', { class: 'dim' }, '—'); return { el: h('div', { class: 'stat' }, h('small', null, label), b), b }; };
    this.s = {
      height: stat('Block height'), difficulty: stat('Difficulty'), reward: stat('Block reward'),
      last: stat('Last block'), halving: stat('Next halving'), reserve: stat('Reserve left'),
    };
    this.strip = h('div', { class: 'stat-strip' }, Object.values(this.s).map((x) => x.el));
    this.list = listView([
      { label: 'Height', key: 'height', width: '70px', num: true },
      { label: 'Age', key: 'age', width: '84px' },
      { label: 'Miner', key: 'miner', width: '128px', cls: 'mono' },
      { label: 'Reward', key: 'reward', width: '120px', num: true },
      { label: 'Digest', key: 'digest', cls: 'mono' },
    ], { empty: 'Loading…', onOpen: (r) => r?.tx && openLink(window.ColourcodeWallet?.txUrl(r.tx) || `${cfg().chain?.explorer}/tx/${r.tx}`) });
    this.panel = h('div', { style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0', padding: '4px 4px 0' } }, this.strip, this.list.el);
    win.body.append(this.panel);
    this.list.setEmpty(statePanel({ icon: 'info', title: 'Contacting the pool server…', text: '' }));
    this.updated = null;
    this.status('Contacting the pool server…');
    this.poll = poller(() => this.load(), 15000);
  }

  async load() {
    const r = await api.chain();
    if (this.dead) return r;
    if (r.kind !== 'ok') {
      const d = describe(r);
      for (const k in this.s) { this.s[k].b.textContent = '—'; this.s[k].b.classList.add('dim'); }
      this.list.setRows([]);
      this.list.setEmpty(statePanel({ ...d, action: r.kind === 'offline' || r.kind === 'error' ? button('Retry', { small: true, onClick: () => this.poll.now() }) : null }));
      this.status(d.title);
      return r;
    }
    const d = r.data, T = ticker();
    const set = (k, v) => { this.s[k].b.textContent = v; this.s[k].b.classList.toggle('dim', v === '—'); };
    set('height', fmtInt(d.height));
    set('difficulty', d.difficulty != null ? fmtCompact(d.difficulty) : '—');
    set('reward', d.reward != null ? `${fmtUnits(d.reward)} ${T}` : '—');
    set('last', d.lastBlockTime ? ago(d.lastBlockTime) : '—');
    set('reserve', d.reserve != null ? `${fmtUnits(d.reserve, 18, 0)} ${T}` : '—');
    const hgt = toBig(d.height), nh = toBig(d.nextHalvingAt);
    if (nh != null && hgt != null) {
      const left = nh > hgt ? nh - hgt : 0n;
      const days = Number(left) * (cfg().mining?.targetSpacingSec || 600) / 86400;
      set('halving', `#${fmtInt(nh)}`);
      this.s.halving.b.title = `${fmtInt(left)} blocks to go, about ${days < 1 ? '<1' : Math.round(days)} day${Math.round(days) === 1 ? '' : 's'} at 10 minutes per block`;
    } else set('halving', '—');
    if (d.difficulty != null) this.s.difficulty.b.title = `Target ${d.target ?? '—'}`;
    const blocks = Array.isArray(d.blocks) ? d.blocks : [];
    this.list.setRows(blocks.map((b) => ({
      height: fmtInt(b.height),
      age: b.timestamp ? ago(b.timestamp) : '—',
      miner: short(b.miner, 6, 4) || '—',
      reward: b.reward != null ? `${fmtUnits(b.reward)} ${T}` : '—',
      digest: b.digest ? short(b.digest, 12, 8) : '—',
      tx: b.tx,
      title: [b.digest && 'digest ' + b.digest, b.miner && 'miner ' + b.miner, b.beneficiary && 'paid to ' + b.beneficiary, b.timestamp && timeHMS(toMs(b.timestamp))].filter(Boolean).join('\n'),
    })));
    this.list.setEmpty(statePanel({ icon: 'chain', title: 'No blocks mined yet', text: 'The first block appears here the moment it is found.' }));
    this.updated = Date.now();
    this.status(`${blocks.length} recent block${blocks.length === 1 ? '' : 's'}`);
    return r;
  }

  status(text) {
    this.win.setStatus([
      { text, grow: true },
      { text: 'Robinhood Chain · id 4663', width: 168 },
      { text: this.updated ? 'Updated ' + timeHMS(this.updated) : 'Not updated', width: 128 },
    ]);
  }
  destroy() { this.dead = true; this.poll.stop(); }
}
