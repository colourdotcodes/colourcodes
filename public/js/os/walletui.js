// Shared wallet flow for the apps: connect (with an EIP-6963 chooser), switch to Robinhood Chain.
import { h } from './ui.js';
import { iconImg } from './icons.js';

export async function getWallet() {
  for (let i = 0; i < 40 && !window.ColourcodeWallet; i++) await new Promise((r) => setTimeout(r, 50));
  return window.ColourcodeWallet || null;
}

function chooser(os, list, parent) {
  return new Promise((resolve) => {
    const win = os.wm.create({ title: 'Connect a wallet', icon: 'buy', dialog: true, w: 340, h: 10, center: true });
    win.el.style.height = 'auto';
    let picked = null;
    const items = list.map((p) => {
      const img = p.info.icon ? h('img', { src: p.info.icon, alt: '', width: 20, height: 20, style: { width: '20px', height: '20px', borderRadius: '4px' } }) : iconImg('buy', 16);
      const b = h('button', { class: 'menu-item', type: 'button', style: { height: '32px' } }, h('span', { class: 'mi-gap', style: { width: '22px' } }, img), h('span', null, p.info.name || 'Wallet'));
      b.addEventListener('click', () => { picked = p.info.uuid; win.close(); });
      return b;
    });
    win.body.append(
      h('p', { style: { margin: '0 0 8px' } }, 'Choose the wallet to use on Robinhood Chain:'),
      h('div', { class: 'sunken', style: { padding: '3px', background: '#fff' } }, items),
      h('div', { class: 'dlg-btns' }, (() => { const c = h('button', { class: 'btn', type: 'button' }, 'Cancel'); c.addEventListener('click', () => win.close()); return c; })()),
    );
    win.hooks = { onClose: () => resolve(picked) };
    const a = os.wm.area();
    win.moveTo(Math.round((a.w - win.w) / 2), Math.round((a.h - win.el.offsetHeight) / 2.4));
  });
}

// Returns the connected address or null. Never throws.
export async function connectFlow(os, parent) {
  const W = await getWallet();
  if (!W) { os.msgbox({ title: 'Wallet', icon: 'error', text: 'The wallet module did not load. Please reload the page.', parent }); return null; }
  try {
    let addr;
    try { addr = await W.connect(); }
    catch (e) {
      if (e.code === 'CHOOSE') {
        const uuid = await chooser(os, W.providers(), parent);
        if (!uuid) return null;
        addr = await W.connect(uuid);
      } else throw e;
    }
    try { await W.ensureChain(); }
    catch (e) {
      if (e && e.code !== 4001) os.msgbox({ title: 'Robinhood Chain', icon: 'warn', text: ['Your wallet did not switch to Robinhood Chain (chain id 4663).', 'You can still view your address; switch networks in the wallet before claiming.'], parent });
    }
    return addr;
  } catch (e) {
    if (e && (e.code === 4001 || /reject|denied/i.test(e.message || ''))) return null;
    if (e && e.code === 'NO_WALLET') {
      os.msgbox({ title: 'No wallet found', icon: 'warn', text: ['colour.codes could not find a browser wallet.', 'Install a wallet that supports Robinhood Chain (chain id 4663), then try again. AI agents can mine without a wallet popup: see How to Mine.'], parent });
      return null;
    }
    os.msgbox({ title: 'Wallet', icon: 'error', text: (e && e.message) || 'The wallet returned an error.', parent });
    return null;
  }
}
