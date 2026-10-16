// Buy: the full contract address with copy, and links from config.js.
import { h, button, field, group, copyText, openLink, cfg, ticker } from '../ui.js';
import { iconImg } from '../icons.js';
import { isAddress } from '../eth.js';

export default {
  get title() { return 'Buy ' + ticker(); },
  size: [470, 362],
  pos: [300, 150],
  min: [380, 300],
  resizable: false,
  status: true,
  mount(win, os) {
    const C = cfg(), ca = C.ca || '', live = isAddress(ca);
    const caField = field(live ? ca : C.caText || 'CA SOON', { readonly: true, mono: true, label: 'Contract address' });
    const copy = button('Copy', { icon: 'copy', small: true, onClick: async () => {
      if (!live) { os.notify({ title: 'Contract address', text: 'The contract address is published at launch.', icon: 'info', timeout: 5000 }); return; }
      if (await copyText(ca)) { copy.querySelector('span').textContent = 'Copied'; setTimeout(() => (copy.querySelector('span').textContent = 'Copy'), 1400); }
    } });
    const L = C.links || {};
    const exp = C.chain?.explorer || 'https://robinhoodchain.blockscout.com';
    const links = [
      ['Pons', L.pons, 'buy'],
      ['DEX Screener', L.dexscreener, 'globe'],
      ['Blockscout', live ? `${exp}/token/${ca}` : '', 'chain'],
      ['X (Twitter)', L.x, 'globe'],
      ['Telegram', L.telegram, 'globe'],
      ['How to Mine', '#howto', 'howto'],
    ].map(([label, url, ic]) => button(label, { icon: ic, onClick: () => {
      if (url === '#howto') { os.open('howto'); return; }
      if (!url) { os.notify({ title: label, text: 'Coming soon. The link is added at launch.', icon: 'info', timeout: 5000 }); return; }
      openLink(url);
    } }));
    win.body.append(h('div', { class: 'pad', style: { paddingTop: '4px' } },
      h('div', { class: 'row', style: { gap: '12px', marginBottom: '4px' } }, iconImg('buy', 32),
        h('div', null, h('div', { class: 'strong', style: { fontSize: '14px' } }, `${C.name || 'colour.codes'} (${ticker()})`),
          h('div', { class: 'muted' }, 'A token on Robinhood Chain. Holding it is the ticket to mine.'))),
      group('Contract address · Robinhood Chain', h('div', { class: 'buy-ca' }, caField, copy),
        !live ? h('div', { class: 'faint', style: { marginTop: '5px', fontSize: '11px' } }, 'Published at launch. Always check the address here before you buy.') : null),
      group('Links', h('div', { class: 'buy-links' }, links)),
      h('div', { class: 'stat-note', style: { marginTop: '10px', marginBottom: '0' } }, iconImg('info', 16),
        h('span', null, 'To mine, keep the minimum balance in the wallet you mine with. Nothing is ever deposited.')),
    ));
    win.setStatus([{ text: live ? 'Contract published' : 'Launching soon', grow: true }, { text: 'Chain id 4663', width: 100 }]);
  },
};
