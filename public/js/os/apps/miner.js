// colour.codes Miner: a browser miner in the spirit of the 2009 v0.1 client.
// Drives window.ColourcodeMining (owned by the mining agent) and degrades honestly
// when it is missing, unsupported, or the contracts are not live yet.
import { h, icon, button, tool, field, group, listView, copyText, origin, ticker, cfg, timeHMS } from '../ui.js';
import { iconImg } from '../icons.js';
import { api } from '../api.js';
import { encode, fmtUnits, fmtHashrate, fmtInt, toBig, short, isAddress } from '../eth.js';
import { getWallet, connectFlow } from '../walletui.js';

const PREF = 'nkos.threads';
const cores = Math.max(1, navigator.hardwareConcurrency || 2);
const maxThreads = Math.min(16, (window.ColourcodeMining?.maxThreads?.() || cores));
let current = null; // the open miner window instance (events are relayed to it)
let relayed = false;

function relay() {
  const M = window.ColourcodeMining;
  if (relayed || !M || typeof M.on !== 'function') return;
  relayed = true;
  try {
    M.on('stats', (s) => current?.onStats(s));
    M.on('state', (s) => current?.onState(s));
    M.on('block', (b) => current?.onBlock(b));
  } catch (e) { console.warn('[miner] cannot subscribe', e); }
}

export default {
  title: 'colour.codes Miner',
  size: [604, 500],
  pos: [196, 52],
  min: [480, 430],
  toolbar: true,
  status: true,
  menu: (os) => [
    { label: 'File', items: () => [
      { label: 'Copy Agent Command', icon: 'copy', onClick: () => current?.copyAgent() },
      { sep: true },
      { label: 'Exit', onClick: () => os.close('miner') },
    ] },
    { label: 'Options', items: () => [
      { label: 'Generate Coins', checked: !!window.ColourcodeMining?.running, onClick: () => current?.toggle() },
      { sep: true },
      current?.address
        ? { label: 'Disconnect Wallet', onClick: () => window.ColourcodeWallet?.disconnect() }
        : { label: 'Connect Wallet…', icon: 'buy', onClick: () => current?.connect() },
      { label: 'Switch to Robinhood Chain', disabled: !current?.address, onClick: () => window.ColourcodeWallet?.ensureChain().catch(() => {}) },
    ] },
    { label: 'Help', items: () => [
      { label: 'How to Mine', icon: 'howto', onClick: () => os.open('howto') },
      { label: 'Whitepaper', icon: 'whitepaper', onClick: () => os.open('whitepaper') },
      { sep: true },
      { label: 'About colour.codes Miner', onClick: () => os.msgbox({ title: 'About colour.codes Miner', icon: 'miner', text: ['colour.codes Miner 0.1', 'Hashes keccak-256 in Web Workers inside your browser and sends shares to the colour.codes Pool. Your tokens never leave your wallet; holding them is the ticket to mine.'] }) },
    ] },
  ],

  mount(win, os) {
    const m = new Miner(win, os);
    current = m;
    relay();
    return {
      onClose: () => { m.destroy(); if (current === m) current = null; },
      onShow: () => m.refresh(),
    };
  },
};

class Miner {
  constructor(win, os) {
    this.win = win; this.os = os;
    this.address = null; this.onChain = false;
    this.chain = { kind: 'loading' };
    this.holder = { status: 'idle' };
    this.stats = { hashrate: 0, threads: 0, shares: 0, accepted: 0, rejected: 0, blocks: 0 };
    this.rows = [];
    let pref = 0;
    try { pref = parseInt(localStorage.getItem(PREF), 10) || 0; } catch {}
    this.threads = Math.min(maxThreads, pref || Math.max(1, Math.floor(cores / 2)));
    this.build();
    this.wireWallet();
    this.loadChain();
    this.timer = setInterval(() => { if (!document.hidden && this.win.visible) this.loadChain(); }, 30000);
  }

  get M() { return window.ColourcodeMining; }
  get available() { return !!(this.M && typeof this.M.start === 'function'); }
  get supported() { try { return this.available && (typeof this.M.supported !== 'function' || this.M.supported()); } catch { return false; } }
  get running() { return !!this.M?.running; }

  build() {
    const w = this.win;
    // toolbar
    this.tConnect = tool('Connect Wallet', 'buy', () => (this.address ? this.walletMenu() : this.connect()));
    this.tGen = tool('Generate Coins', 'miner', () => this.toggle(), 'Start or stop mining in this browser');
    this.tGen.classList.add('mn-gen');
    this.tCopy = tool('Agent Command', 'copy', () => this.copyAgent(), 'Copy the one-line command for AI agents');
    this.chip = h('span', { class: 'chip', title: 'Robinhood Chain, chain id 4663' }, h('i'), 'Robinhood Chain');
    w.toolbar.append(this.tConnect, this.tGen, h('i', { class: 'tool-sep' }), this.tCopy, h('span', { class: 'grow' }), this.chip);

    // address / balance / threads
    this.addrField = field('', { readonly: true, mono: true, placeholder: 'Not connected', label: 'Your address' });
    this.copyAddr = button('Copy', { small: true, onClick: async () => { if (this.address && await copyText(this.address)) this.flash(this.copyAddr, 'Copied'); } });
    this.balance = h('span', { class: 'mn-balance' }, '—');
    this.holderEl = h('span', { class: 'mn-check' });
    this.threadSel = h('select', { class: 'field', 'aria-label': 'Threads', style: { width: '64px' } },
      Array.from({ length: maxThreads }, (_, i) => h('option', { value: i + 1, selected: i + 1 === this.threads }, String(i + 1))));
    this.threadSel.addEventListener('change', () => this.setThreads(+this.threadSel.value));
    const top = h('div', { class: 'mn-top' },
      h('label', null, 'Your address:'), this.addrField, this.copyAddr,
      h('label', null, 'Balance:'), h('div', { class: 'row', style: { gap: '14px' } }, this.balance, this.holderEl), h('span'),
      h('label', null, 'Threads:'), h('div', { class: 'row' }, this.threadSel, h('span', { class: 'muted' }, `of ${cores} logical core${cores > 1 ? 's' : ''}`)), h('span'),
    );
    // meter
    this.meter = h('div', { class: 'progress sunken', role: 'progressbar', 'aria-label': 'Mining activity' }, h('i'));
    this.rate = h('span', { class: 'mn-rate' }, '0 H/s');
    const meter = h('div', { class: 'mn-meter' }, h('span', { class: 'lbl' }, 'Activity'), this.meter, this.rate);
    // activity list
    this.list = listView([
      { label: 'Time', key: 'time', width: '76px' },
      { label: 'Status', key: 'status', width: '112px' },
      { label: 'Description', key: 'text' },
    ], { empty: 'No activity yet.' });
    // agent panel
    const cmd = `Read ${origin()}/skill.md and start mining.`;
    this.agentField = field(cmd, { readonly: true, mono: true, label: 'Agent command' });
    this.agentCopy = button('Copy', { small: true, icon: 'copy', onClick: () => this.copyAgent() });
    const agent = group('Let your AI agent mine',
      h('div', { class: 'muted', style: { marginBottom: '6px' } }, 'Paste this into any AI agent that can run code. Pool mode needs no private key.'),
      h('div', { class: 'mn-agent' }, this.agentField, this.agentCopy));

    w.body.append(h('div', { style: { padding: '2px 4px 0', display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0' } },
      top, meter, this.list.el, agent));
    this.list.el.style.minHeight = '96px';
    this.render();
  }

  // ---- wallet ----
  async wireWallet() {
    const W = await getWallet();
    if (!W) return;
    const sync = (s) => {
      const a = s ? s.address : W.address;
      const changed = a !== this.address;
      this.address = a; this.onChain = s ? s.onChain : W.onChain;
      if (changed) {
        if (a) this.log('Wallet', `Connected ${short(a, 6, 4)}${W.walletName ? ' (' + W.walletName + ')' : ''}`);
        if (!a && this.running) this.stop('Wallet disconnected');
        this.checkHolder();
      }
      this.render();
    };
    this.unW = W.on('change', sync);
    sync();
  }
  async connect() {
    const a = await connectFlow(this.os, this.win);
    if (a) { this.address = a; this.render(); this.checkHolder(); }
    return a;
  }
  walletMenu() {
    this.os.popup([
      { label: 'Copy Address', icon: 'copy', onClick: () => copyText(this.address) },
      { label: 'View on Explorer', onClick: () => window.open(window.ColourcodeWallet.addressUrl(this.address), '_blank', 'noopener') },
      { label: 'Switch to Robinhood Chain', disabled: this.onChain, onClick: () => window.ColourcodeWallet.ensureChain().catch(() => {}) },
      { sep: true },
      { label: 'Disconnect', onClick: () => window.ColourcodeWallet.disconnect() },
    ], { anchor: this.tConnect });
  }

  async checkHolder() {
    const ca = cfg().ca;
    if (!this.address) { this.holder = { status: 'idle' }; this.render(); return; }
    if (!isAddress(ca)) { this.holder = { status: 'na', text: 'Token not launched yet' }; this.render(); return; }
    this.holder = { status: 'checking' }; this.render();
    try {
      const W = await getWallet();
      const [b, d] = await Promise.all([W.call(ca, encode.balanceOf(this.address)), W.call(ca, encode.decimals()).catch(() => '0x12')]);
      const bal = toBig(b), dec = Number(toBig(d) ?? 18n) || 18;
      this.holder = { status: 'read', balance: bal, decimals: dec };
    } catch (e) {
      this.holder = { status: 'unknown', text: 'Balance unavailable' };
    }
    this.render();
  }
  minHold() {
    const fromChain = this.chain.kind === 'ok' ? toBig(this.chain.data.minHold) : null;
    if (fromChain != null) return fromChain;
    const c = Number(cfg().mining?.minHold || 0);
    return c > 0 ? BigInt(Math.round(c)) * 10n ** BigInt(this.holder.decimals || 18) : null;
  }

  // ---- chain state ----
  async loadChain() {
    const r = await api.chain();
    const prev = this.chain.kind;
    this.chain = r;
    if (prev !== r.kind && prev !== 'loading') this.log('Network', r.kind === 'ok' ? 'Contracts are live on Robinhood Chain' : stateText(r.kind));
    if (prev === 'loading') this.log('Network', r.kind === 'ok' ? 'Contracts are live on Robinhood Chain' : stateText(r.kind));
    this.render();
  }
  refresh() { this.loadChain(); if (this.address) this.checkHolder(); }

  // ---- mining ----
  async toggle() {
    if (this.running) { this.stop('Stopped by you'); return; }
    if (!this.available) { this.os.msgbox({ title: 'colour.codes Miner', icon: 'info', text: ['The browser miner is not available on this page yet.', 'AI agents can already read the skill file; people can mine here once mining opens at launch.'], parent: this.win }); return; }
    if (!this.supported) { this.os.msgbox({ title: 'colour.codes Miner', icon: 'warn', text: ['This browser cannot run the miner (Web Workers are unavailable).', 'Try a current desktop browser.'], parent: this.win }); return; }
    if (this.chain.kind !== 'ok') { this.os.msgbox({ title: 'Mining opens at launch', icon: 'info', text: [stateText(this.chain.kind), 'Generate Coins unlocks by itself when the contracts are live.'], parent: this.win }); return; }
    if (!this.address) { const a = await this.connect(); if (!a) return; }
    const min = this.minHold();
    if (this.holder.status === 'read' && min != null && this.holder.balance < min) {
      const r = await this.os.msgbox({ title: 'Holders only', icon: 'warn', buttons: ['Buy ' + ticker(), 'Close'], parent: this.win,
        text: [`Mining needs at least ${fmtUnits(min, this.holder.decimals || 18)} ${ticker()} in this wallet.`, `This wallet holds ${fmtUnits(this.holder.balance, this.holder.decimals || 18)}. Nothing is deposited: the balance is only checked.`] });
      if (r && r.startsWith('Buy')) this.os.open('buy');
      return;
    }
    this.starting = true; this.render();
    this.log('Miner', `Starting ${this.threads} thread${this.threads > 1 ? 's' : ''}…`);
    try {
      await this.M.start({ address: this.address, threads: this.threads });
    } catch (e) {
      const code = e && e.code;
      if (!code) this.log('Error', (e && e.message) || 'Could not start the miner');
      const msg = (e && e.message && e.message !== 'network') ? e.message : 'Cannot reach the pool.';
      if (code === 'not_holder') {
        const r = await this.os.msgbox({ title: 'Holders only', icon: 'warn', buttons: ['Buy ' + ticker(), 'Close'], parent: this.win, text: [msg, 'Nothing is deposited: the pool only checks the balance of the address you mine for.'] });
        if (r && r.startsWith('Buy')) this.os.open('buy');
      } else if (code === 'not_deployed' || code === 'not_started' || code === 'paused') {
        this.os.msgbox({ title: 'colour.codes Miner', icon: 'info', text: [msg, 'Generate Coins will work as soon as the pool has a job for you.'], parent: this.win });
      } else if (code === 'offline' || code === 'rate_limited') {
        this.os.msgbox({ title: 'colour.codes Miner', icon: 'warn', text: msg, parent: this.win });
      } else {
        this.os.msgbox({ title: 'colour.codes Miner', icon: 'error', text: msg || 'The miner could not start.', parent: this.win });
      }
    } finally {
      this.starting = false; this.render(); this.os.shell.setMiner(this.stats);
    }
  }
  stop(reason) {
    const n = this.stateCount || 0;
    try { this.M?.stop(); } catch {}
    if ((this.stateCount || 0) === n) this.log('Stopped', reason || 'Generate Coins is off');
    this.render(); this.os.shell.setMiner(this.stats);
  }
  async setThreads(n) {
    this.threads = n;
    try { localStorage.setItem(PREF, String(n)); } catch {}
    if (this.running) {
      try { this.M.stop(); await this.M.start({ address: this.address, threads: n }); this.log('Miner', `Now using ${n} thread${n > 1 ? 's' : ''}`); }
      catch (e) { this.log('Error', e?.message || 'Restart failed'); }
    }
    this.render();
  }

  // ---- events from ColourcodeMining ----
  onStats(s) {
    this.stats = { ...this.stats, ...s };
    this.renderStats();
  }
  onState(s) {
    this.stateCount = (this.stateCount || 0) + 1;
    if (s && s.message) this.log(STATUS[s.status] || cap(s.status || 'Miner'), s.message);
    this.render();
  }
  onBlock(b) {
    this.log('Block found', `Block ${fmtInt(b?.height)} mined by the pool${b?.tx ? ' · tx ' + short(b.tx, 8, 6) : ''}`);
    this.os.notify({ title: 'Block found', text: `The colour.codes Pool mined block ${fmtInt(b?.height)}.`, icon: 'miner' });
  }

  log(status, text) {
    this.rows.unshift({ time: timeHMS(Date.now()), status, text });
    if (this.rows.length > 200) this.rows.length = 200;
    this.list.setRows(this.rows);
  }

  // ---- view ----
  render() {
    const run = this.running;
    this.addrField.value = this.address || '';
    this.copyAddr.disabled = !this.address;
    this.tConnect.querySelector('span').textContent = this.address ? short(this.address, 6, 4) : 'Connect Wallet';
    this.tConnect.title = this.address ? 'Wallet options' : 'Connect a wallet on Robinhood Chain';
    this.tGen.classList.toggle('is-on', run);
    this.tGen.querySelector('span').textContent = run ? 'Generating' : this.starting ? 'Starting…' : 'Generate Coins';
    this.chip.classList.toggle('on', this.address && this.onChain);
    this.chip.lastChild.textContent = this.address ? (this.onChain ? 'Robinhood Chain' : 'Wrong network') : 'Robinhood Chain';

    // balance + holder check
    const hs = this.holder, dec = hs.decimals || 18, min = this.minHold();
    let ic = 'info', txt = '';
    if (!this.address) { this.balance.textContent = '—'; txt = 'Connect a wallet to check'; }
    else if (hs.status === 'checking') { this.balance.textContent = '…'; txt = 'Checking balance…'; }
    else if (hs.status === 'read') {
      this.balance.textContent = `${fmtUnits(hs.balance, dec)} ${ticker()}`;
      if (min == null) { txt = 'Minimum set at launch'; }
      else if (hs.balance >= min) { ic = 'ok'; txt = 'Holder: can mine'; }
      else { ic = 'warn'; txt = `Needs ${fmtUnits(min, dec)} to mine`; }
    } else { this.balance.textContent = '—'; ic = hs.status === 'unknown' ? 'warn' : 'info'; txt = hs.text || ''; }
    this.holderEl.replaceChildren(iconImg(ic, 16), h('span', { class: 'muted' }, txt));

    // empty state copy for the activity list
    this.list.setEmpty(!this.available ? 'The browser miner is not loaded on this page yet.' :
      this.chain.kind !== 'ok' ? 'Mining opens at launch. Real shares and blocks will be listed here.' :
      'Turn on Generate Coins to start. Shares and blocks you find appear here.');
    if (!this.rows.length) this.list.setRows([]);
    this.renderStats();
  }

  renderStats() {
    const s = this.stats, run = this.running;
    this.meter.classList.toggle('busy', run && this.os.motion);
    this.meter.firstChild.style.width = run && !this.os.motion ? '100%' : run ? '' : '0';
    this.rate.textContent = fmtHashrate(run ? s.hashrate || 0 : 0);
    const label = !this.available ? 'Miner not loaded' : !this.supported ? 'Not supported' : run ? 'Generating' : this.chain.kind === 'ok' ? 'Not generating' : 'Mining opens at launch';
    this.win.setStatus([
      { text: label, grow: true, icon: run ? 'miner' : null },
      { text: `${run ? s.threads || this.threads : 0} thread${(run ? s.threads || this.threads : 0) === 1 ? '' : 's'}`, width: 82 },
      { text: fmtHashrate(run ? s.hashrate || 0 : 0), width: 84 },
      { text: `${fmtInt(s.accepted || 0)} shares`, width: 92, title: `${fmtInt(s.shares || 0)} found, ${fmtInt(s.accepted || 0)} accepted, ${fmtInt(s.rejected || 0)} rejected` },
      { text: `${fmtInt(s.blocks || 0)} blocks`, width: 76 },
    ]);
    if (run) this.os.shell.setMiner(s);
  }

  async copyAgent() {
    if (await copyText(this.agentField.value)) this.flash(this.agentCopy, 'Copied');
  }
  flash(btn, text) {
    const span = btn.querySelector('span');
    const old = span.textContent;
    span.textContent = text;
    setTimeout(() => (span.textContent = old), 1400);
  }
  destroy() { clearInterval(this.timer); this.unW?.(); }
}

const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1).replace(/_/g, ' ');
const STATUS = { connecting: 'Connecting', mining: 'Generating', not_deployed: 'Not deployed', not_started: 'Not started', not_holder: 'Not a holder', paused: 'Paused', offline: 'Offline', rate_limited: 'Slowed down', error: 'Error', stopped: 'Stopped' };
function stateText(kind) {
  return {
    not_ready: 'The pool server is not online yet. Mining opens at launch.',
    not_deployed: 'The contracts are not deployed yet. Mining opens at launch.',
    not_started: 'The contracts are deployed but the first block has not started. Mining opens at launch.',
    offline: 'Cannot reach the pool server.',
    error: 'The pool server returned an error.',
    loading: 'Checking the network…',
  }[kind] || kind;
}
