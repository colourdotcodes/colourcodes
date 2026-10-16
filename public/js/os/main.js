// ColourcodeOS entry point. Exposes window.ColourcodeOS for the hero:
//   boot({fast, force, post, welcome}) -> Promise   (fast: straight to the desktop)
//   open(appId)                        -> Promise<Win>
//   close(appId)
//   setInteractive(bool)               (false while the room is shown: no focus, cursor mirror only)
//   pointer(x, y)                      (virtual px, 0..1024 x 0..960 in crt mode)
//   on(event, fn) / off(event, fn)     events: 'boot', 'post', 'ready', 'open', 'close', 'mode', 'net', 'shutdown'
//   setMode('crt' | 'native', lock)
//   mode, booted, root
// Dev flag: ?os=1 boots the OS (the hero zooms into the screen). Add &bare=1 to show the OS alone,
//   full window, without the room. &boot=0 skips the boot, &boot=full forces the POST,
//   &open=miner,pool opens apps, &mode=native forces the phone layout.
import { OS } from './kernel.js';

const root = document.getElementById('os-root');
if (!root) throw new Error('[ColourcodeOS] #os-root not found');

const params = new URLSearchParams(location.search);
const standalone = params.get('os') === '1';
const bare = params.get('bare') === '1';
const heroOnPage = !!document.getElementById('stage');
if (standalone && params.get('mode')) { root.dataset.mode = params.get('mode'); root.setAttribute('data-mode-lock', ''); }

const os = new OS(root, { autoMode: !heroOnPage || (standalone && bare) });
os.setInteractive(false);

// wallet module (classic script; also usable by the hero as window.ColourcodeWallet)
import('/js/wallet.js').catch((e) => console.warn('[ColourcodeOS] wallet module failed', e));

const api = {
  boot: (o) => os.boot(o),
  reboot: (o) => os.reboot(o),
  open: (id, o) => os.open(id, o),
  close: (id) => os.close(id),
  setInteractive: (b) => os.setInteractive(b),
  pointer: (x, y) => os.pointer(x, y),
  on: (ev, fn) => os.on(ev, fn),
  off: (ev, fn) => os.off(ev, fn),
  setMode: (m, lock) => os.setMode(m, lock),
  notify: (o) => os.notify(o),
  get mode() { return os.mode; },
  get booted() { return os.booted; },
  get interactive() { return os.interactive; },
  get root() { return root; },
};
window.ColourcodeOS = api;
window.dispatchEvent(new CustomEvent('colourcodeos:ready', { detail: api }));

if (standalone) {
  // With the hero on the page, ?os=1 is handled by the hero (it zooms into the screen);
  // add &bare=1 to look at the OS alone. Without a hero, the OS fills the window itself.
  const hero = heroOnPage && !bare;
  if (!hero) {
    document.documentElement.classList.add('nkos-bare');
    const st = document.createElement('style');
    st.textContent = `
      html.nkos-bare, html.nkos-bare body { margin: 0; height: 100%; background: #0b0a09; overflow: hidden; }
      html.nkos-bare body > :not(#os-root):not(script):not(style) { display: none !important; }
      html.nkos-bare body #os-root[data-mode='crt'] { position: fixed !important; left: 50% !important; top: 50% !important; margin: 0 !important;
        transform-origin: 0 0 !important; transform: var(--nkos-fit) !important; border-radius: 0 !important; filter: none !important; }
      html.nkos-bare body #os-root[data-mode='native'] { position: fixed !important; inset: 0 !important; width: 100% !important; height: 100% !important; transform: none !important; }`;
    document.head.append(st);
    const fit = () => {
      const s = Math.min(window.innerWidth / 1024, window.innerHeight / 960);
      document.documentElement.style.setProperty('--nkos-fit', `scale(${s}) translate(-512px, -384px)`);
      os.cursor.invalidate();
    };
    fit();
    window.addEventListener('resize', fit);
    os.setInteractive(true);
  }
  const b = params.get('boot');
  os.boot({ fast: b === '0', force: b === 'full' }).then(() => {
    const open = params.get('open');
    const list = open == null ? (hero ? [] : ['agent']) : open.split(',').filter(Boolean);
    list.reduce((p, id) => p.then(() => os.open(id.trim())), Promise.resolve());
  });
}
