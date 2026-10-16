// colour.codes Agent: the pool operator's console. Types a short intro (the mining
// loop it runs), then streams real event lines from GET /api/agent/log.
import { h, timeHMS, toMs, origin, ticker, copyText } from '../ui.js';
import { api, poller } from '../api.js';
import { fmtInt, fmtUnits, fmtHashrate, fmtCompact } from '../eth.js';

const PROMPT = [['t-or', 'colourcode@2009'], ['t-dim', ':'], ['t-blue', '~'], ['t-dim', '$ ']];
const KIND = { block: 't-or', found: 't-or', share: '', payout: 't-gold', claim: 't-gold', epoch: 't-gold', error: 't-red', warn: 't-red', info: 't-dim', agent: 't-dim', chain: 't-blue' };

// The loop the agent runs, as the contract checks it. C-ish, highlighted by hand.
const CODE = [
  [['t-cm', '/* proof of work, exactly as the contract checks it */']],
  [['t-kw', 'for'], ['', ' (nonce = '], ['t-num', '0'], ['', '; ; nonce++) {']],
  [['', '    digest = '], ['t-fn', 'keccak256'], ['', '(challenge, beneficiary, nonce);']],
  [['', '    '], ['t-kw', 'if'], ['', ' (digest <= target)']],
  [['', '        '], ['t-kw', 'break'], ['', ';            '], ['t-cm', '/* found a block */']],
  [['', '}']],
  [['t-fn', 'mint'], ['', '(nonce, beneficiary);   '], ['t-cm', '/* checked again on-chain */']],
];

export default {
  title: 'colour.codes Agent',
  size: [640, 430],
  pos: [318, 96],
  min: [360, 220],
  status: true,
  menu: (os) => [
    { label: 'File', items: () => [
      { label: 'Clear Screen', onClick: () => os.wm.byApp('agent')?._term?.clear() },
      { sep: true },
      { label: 'Close', onClick: () => os.close('agent') },
    ] },
    { label: 'Edit', items: () => [
      { label: 'Copy All', onClick: () => { const t = os.wm.byApp('agent')?._term; if (t) copyText(t.el.innerText); } },
    ] },
    { label: 'Help', items: () => [
      { label: 'Commands', onClick: () => os.wm.byApp('agent')?._term?.run('help') },
      { label: 'How to Mine', icon: 'howto', onClick: () => os.open('howto') },
      { label: 'Whitepaper', icon: 'whitepaper', onClick: () => os.open('whitepaper') },
    ] },
  ],

  mount(win, os) {
    const term = new Terminal(win, os);
    win._term = term;
    term.start();
    return {
      onShow: () => term.focus(),
      onClose: () => term.destroy(),
    };
  },
};

class Terminal {
  constructor(win, os) {
    this.win = win; this.os = os;
    this.el = h('div', { class: 'term', role: 'log', 'aria-live': 'polite' });
    this.input = h('input', { class: 'term-input', type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Command' });
    this.caret = h('i', { class: 'term-caret' });
    this.inputLine = h('div', { class: 'term-line term-input-line' }, this.promptSpans(), h('span', { class: 'term-input-wrap' }, this.input, this.caret));
    win.body.append(this.el);
    this.history = []; this.hi = 0;
    this.seen = new Set();
    this.since = null;
    this.state = null;
    this.lines = 0;
    this.typing = true;
    this.dead = false;
    this.el.addEventListener('pointerup', () => { if (!getSelection().toString()) this.focus(true); });
    this.input.addEventListener('keydown', (e) => this.key(e));
    this.input.addEventListener('input', () => this.syncCaret());
    ['keyup', 'click', 'select'].forEach((ev) => this.input.addEventListener(ev, () => this.syncCaret()));
    win.el.addEventListener('focus', () => this.focus());
    this.setStatus();
  }

  promptSpans() { return PROMPT.map(([c, t]) => h('span', { class: c }, t)); }
  atBottom() { return this.el.scrollHeight - this.el.scrollTop - this.el.clientHeight < 40; }
  scroll(force) { if (force || this.stick) this.el.scrollTop = this.el.scrollHeight; }

  line(segs, cls = '') {
    this.stick = this.atBottom();
    const d = h('div', { class: 'term-line ' + cls });
    for (const s of Array.isArray(segs) ? segs : [['', segs]]) d.append(h('span', { class: s[0] }, s[1]));
    if (this.inputLine.isConnected) this.el.insertBefore(d, this.inputLine); else this.el.append(d);
    if (++this.lines > 600) { this.el.firstChild?.remove(); this.lines--; }
    this.scroll();
    return d;
  }

  async type(segs, speed, sig) {
    const d = this.line([]);
    for (const [cls, text] of segs) {
      const span = h('span', { class: cls });
      d.append(span);
      if (!this.os.motion || speed <= 0) { span.textContent = text; continue; }
      for (let i = 0; i < text.length; i++) {
        if (this.dead) return;
        span.textContent += text[i];
        if (text[i] !== ' ') await new Promise((r) => setTimeout(r, speed * (0.6 + ((i * 7919) % 10) / 12)));
      }
    }
    this.scroll(true);
    return d;
  }
  pause(ms) { return this.os.motion ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve(); }

  async start() {
    await this.pause(350);
    await this.type([...PROMPT, ['t-white', 'cat miner.c']], 48);
    await this.pause(180);
    for (const l of CODE) { await this.type(l, 6); }
    this.line('');
    await this.pause(400);
    await this.type([...PROMPT, ['t-white', './colourcode-miner --pool']], 42);
    await this.pause(250);
    this.line([['t-white', 'colour.codes Agent 0.1'], ['t-dim', ' · pool operator · Robinhood Chain (id 4663)']]);
    await this.pause(90);
    this.line([['t-dim', 'I watch the chain, check shares, submit winning nonces and post payouts.']]);
    await this.pause(90);
    this.line([['t-dim', 'Every line below is a real event from the pool server. Type '], ['t-white', 'help'], ['t-dim', '.']]);
    this.line('');
    if (this.dead) return;
    this.typing = false;
    this.el.append(this.inputLine);
    this.syncCaret();
    this.scroll(true);
    this.focus();
    this.poll = poller(() => this.fetchLog(), 5000, { maxInterval: 30000 });
  }

  // ---- live log ----
  async fetchLog() {
    const r = await api.log(this.since);
    this.setState(r.kind);
    if (r.kind !== 'ok') return r;
    const rows = Array.isArray(r.data) ? r.data : r.data.lines || r.data.events || r.data.log || [];
    for (const ev of rows) {
      const key = `${ev.t}|${ev.kind}|${ev.text}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      if (this.seen.size > 2000) this.seen = new Set([...this.seen].slice(-1000));
      if (this.since == null || ev.t > this.since) this.since = ev.t;
      const k = String(ev.kind || 'info').toLowerCase();
      this.line([['t-faint', `[${timeHMS(toMs(ev.t))}] `], [KIND[k] ?? 't-dim', k.padEnd(7, ' ').slice(0, 7) + ' '], ['', String(ev.text ?? '')]]);
    }
    if (!rows.length && this.state === 'ok' && !this.saidEmpty) {
      this.saidEmpty = true;
      this.line([['t-faint', `[${timeHMS(Date.now())}] `], ['t-dim', 'agent   '], ['t-dim', 'listening. No events yet.']]);
    }
    return r;
  }

  setState(kind) {
    if (kind === this.state) return;
    const prev = this.state;
    this.state = kind;
    const now = `[${timeHMS(Date.now())}] `;
    const say = {
      ok: prev ? 'pool server online. Streaming events.' : null,
      not_ready: 'pool server is not online yet. Mining opens at launch.',
      not_deployed: 'contracts are not deployed yet. Mining opens at launch.',
      not_started: 'contracts deployed, waiting for the first block. Mining opens at launch.',
      offline: 'cannot reach the pool server. Retrying.',
      error: 'the pool server returned an error. Retrying.',
      forbidden: 'the pool server refused the request.',
    }[kind];
    if (say) this.line([['t-faint', now], [kind === 'ok' ? 't-dim' : kind === 'offline' || kind === 'error' ? 't-red' : 't-dim', 'agent   '], ['', say]]);
    this.setStatus();
  }

  setStatus() {
    const label = { ok: 'Live: streaming pool events', not_ready: 'Pool server not online yet', not_deployed: 'Contracts not deployed yet', not_started: 'Waiting for the first block', offline: 'Offline, retrying', error: 'Server error, retrying' }[this.state] || 'Starting…';
    this.win.setStatus([
      { text: label, grow: true, icon: this.state === 'ok' ? 'network' : 'networkOff' },
      { text: 'Robinhood Chain · 4663', width: 160 },
    ]);
  }

  // ---- input ----
  // user = an explicit tap/click; phones never get the keyboard thrown at them otherwise
  focus(user = false) {
    if (!this.os.interactive || this.typing || this.dead) return;
    if (this.os.mode === 'native' && !user) return;
    if (this.os.wm.active !== this.win) return;
    this.input.focus({ preventScroll: true });
  }
  syncCaret() {
    const pos = this.input.selectionStart ?? this.input.value.length;
    this.caret.style.left = `calc(${pos}ch - ${this.input.scrollLeft}px)`;
  }
  key(e) {
    if (e.key === 'Enter') {
      const v = this.input.value;
      this.input.value = '';
      this.syncCaret();
      if (v.trim()) { this.history.push(v); this.hi = this.history.length; }
      this.line([...PROMPT, ['t-white', v]]);
      this.run(v);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.hi > 0) { this.input.value = this.history[--this.hi]; requestAnimationFrame(() => this.syncCaret()); }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (this.hi < this.history.length) { this.input.value = this.history[++this.hi] || ''; requestAnimationFrame(() => this.syncCaret()); }
    } else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); this.clear(); }
  }

  async run(raw) {
    const [cmd, ...args] = raw.trim().split(/\s+/);
    const c = (cmd || '').toLowerCase();
    const out = (t, cls = '') => this.line([[cls, t]]);
    switch (c) {
      case '': return;
      case 'help':
        out('Commands:', 't-white');
        out('  status       chain and pool numbers, straight from the server');
        out('  mine         how to start mining (opens colour.codes Miner)');
        out('  whitepaper   open the whitepaper');
        out('  log          show recent agent events again');
        out('  clear        clear the screen');
        out('  whoami, date, exit');
        return;
      case 'status': return this.status();
      case 'mine':
        out('Opening colour.codes Miner…', 't-dim');
        out(`People: hold ${ticker()}, connect a wallet, turn on Generate Coins.`);
        out(`AI agents: Read ${origin()}/skill.md and start mining.`, 't-or');
        this.os.open('miner');
        return;
      case 'whitepaper': case 'paper':
        out('Opening whitepaper…', 't-dim');
        this.os.open('whitepaper');
        return;
      case 'clear': case 'cls': this.clear(); return;
      case 'log': {
        this.seen.clear(); this.since = null; this.saidEmpty = false;
        const r = await this.fetchLog();
        if (r.kind !== 'ok') out('No events available: ' + (this.state || 'unknown').replace('_', ' ') + '.', 't-dim');
        return;
      }
      case 'whoami': out('anonymous'); return;
      case 'date': out(new Date().toString()); return;
      case 'echo': out(args.join(' ')); return;
      case 'exit': case 'logout': this.win.close(); return;
      case 'sudo': out('Nice try. There are no admin keys here, not even for me.', 't-dim'); return;
      default: out(`${cmd}: command not found. Type 'help'.`, 't-red');
    }
  }

  async status() {
    const pend = this.line([['t-dim', 'querying /api/chain and /api/pool/stats…']]);
    const [c, s] = await Promise.all([api.chain(), api.stats()]);
    pend.remove(); this.lines--;
    const out = (segs) => this.line(segs);
    if (c.kind === 'ok') {
      const d = c.data;
      out([['t-white', 'chain  '], ['', `height ${fmtInt(d.height)} · difficulty ${fmtCompact(d.difficulty)} · reward ${fmtUnits(d.reward)} ${ticker()}`]]);
      out([['t-white', '       '], ['', `reserve ${fmtUnits(d.reserve, 18, 0)} ${ticker()} · next halving at block ${fmtInt(d.nextHalvingAt)}`]]);
    } else out([['t-white', 'chain  '], ['t-dim', explain(c.kind)]]);
    if (s.kind === 'ok') {
      const d = s.data;
      out([['t-white', 'pool   '], ['', `${fmtInt(d.miners10m)} miners (10 min) · ${fmtHashrate(d.hashrate)} · ${fmtInt(d.shares24h)} shares (24 h) · ${fmtInt(d.blocksFound)} blocks found`]]);
    } else out([['t-white', 'pool   '], ['t-dim', explain(s.kind)]]);
  }

  clear() {
    [...this.el.children].forEach((n) => { if (n !== this.inputLine) n.remove(); });
    this.lines = 0;
  }
  destroy() { this.dead = true; this.poll?.stop(); }
}

function explain(kind) {
  return {
    not_ready: 'pool server not online yet. Mining opens at launch.',
    not_deployed: 'contracts not deployed yet. Mining opens at launch.',
    not_started: 'deployed, waiting for the first block. Mining opens at launch.',
    offline: 'cannot reach the server.',
    error: 'server error.',
  }[kind] || kind;
}
