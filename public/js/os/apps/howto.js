// How to Mine: two tabs, one for people and one for AI agents.
import { h, button, field, copyText, origin, ticker, cfg } from '../ui.js';
import { iconImg } from '../icons.js';
import { api } from '../api.js';
import { fmtUnits, toBig } from '../eth.js';

export default {
  title: 'How to Mine',
  size: [560, 520],
  pos: [232, 74],
  min: [400, 340],
  status: true,
  mount(win, os) {
    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    const panel = h('div', { class: 'tab-panel' });
    const minHoldText = h('span', { class: 'strong' }, 'a minimum amount');
    const copyRow = (text) => {
      const f = field(text, { readonly: true, mono: true });
      const b = button('Copy', { small: true, icon: 'copy', onClick: async () => { if (await copyText(text)) { b.querySelector('span').textContent = 'Copied'; setTimeout(() => (b.querySelector('span').textContent = 'Copy'), 1400); } } });
      return h('div', { class: 'code' }, f, b);
    };
    const link = (label, app) => { const a = h('a', { href: '#', 'data-cur': 'hand' }, label); a.addEventListener('click', (e) => { e.preventDefault(); os.open(app); }); return a; };

    const people = () => h('div', { class: 'help' },
      h('h3', null, iconImg('miner', 32), 'Mine from this computer'),
      h('ol', null,
        h('li', null, h('b', null, `Hold ${ticker()}`), 'Keep at least ', minHoldText, ` ${ticker()} in your wallet on Robinhood Chain. Nothing is deposited; the balance is only checked. `, link('Buy ' + ticker(), 'buy'), '.'),
        h('li', null, h('b', null, 'Open colour.codes Miner'), 'Click Connect Wallet. Your wallet will be asked to switch to Robinhood Chain (chain id 4663).'),
        h('li', null, h('b', null, 'Turn on Generate Coins'), 'Pick how many threads to use. More threads hash faster and make the computer warmer.'),
        h('li', null, h('b', null, 'Leave the window open'), 'Every share you find is counted by the colour.codes Pool. When the pool finds a block, the reward goes to the pool.'),
        h('li', null, h('b', null, 'Claim your payout'), 'Once a day the pool splits its rewards by shares. Open ', link('colour.codes Pool', 'pool'), ' and press Claim; the tokens go straight to your wallet.')),
      h('div', { class: 'note' }, iconImg('info', 16), h('span', null, 'Mining opens at launch. Until the contracts are live, every window shows its real, empty state.')));

    const agents = () => h('div', { class: 'help' },
      h('h3', null, iconImg('agent', 32), 'Let an AI agent mine'),
      h('p', null, 'Any agent that can run code can join the pool. Paste this line into it:'),
      copyRow(`Read ${origin()}/skill.md and start mining.`),
      h('p', { style: { marginTop: '12px' } }, 'The skill file explains the rules and the three calls. Agents usually end up running the command-line miner:'),
      copyRow('node colourcode-miner.mjs --address 0xYOUR_WALLET'),
      h('ol', { style: { marginTop: '12px' } },
        h('li', null, h('b', null, 'No private key in pool mode'), 'The agent only needs the address to be paid. That address must hold ', minHoldText.cloneNode(true), ` ${ticker()}.`),
        h('li', null, h('b', null, 'Solo mode is optional'), 'With --solo and a PRIVATE_KEY in its environment, an agent can submit blocks itself. Never paste a private key into a chat.'),
        h('li', null, h('b', null, 'Fair limits'), 'Shares are rate-limited per address and payouts have a daily cap per wallet, so one machine cannot take over the pool.')));

    const pages = { people: ['For people', people], agents: ['For AI agents', agents] };
    const show = (key) => {
      [...tabs.children].forEach((t) => { t.classList.toggle('is-on', t.dataset.k === key); t.setAttribute('aria-selected', String(t.dataset.k === key)); });
      panel.replaceChildren(pages[key][1]());
    };
    for (const [k, [label]] of Object.entries(pages)) {
      const t = h('button', { class: 'tab', type: 'button', role: 'tab', 'data-k': k }, label);
      t.addEventListener('click', () => show(k));
      tabs.append(t);
    }
    win.body.append(h('div', { style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0', padding: '6px 4px 0' } }, tabs, panel));
    show('people');
    win.setStatus([{ text: 'Robinhood Chain · chain id 4663', grow: true }, { text: 'Holders only · no deposits', width: 170 }]);

    // fill in the real minimum when the contracts report it
    api.chain().then((r) => {
      const v = r.kind === 'ok' ? toBig(r.data.minHold) : null;
      const cfgMin = Number(cfg().mining?.minHold || 0);
      const txt = v != null ? fmtUnits(v) : cfgMin > 0 ? cfgMin.toLocaleString('en-US') : null;
      if (txt) win.body.querySelectorAll('.strong').forEach((s) => { if (s.textContent === 'a minimum amount') s.textContent = txt; });
      if (txt) minHoldText.textContent = txt;
    });
  },
};
