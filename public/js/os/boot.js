// Power-on self test, then the ColourcodeOS splash. Skippable with any key or click.
import { h } from './ui.js';
import { iconURL } from './icons.js';

const sleep = (ms, sig) => new Promise((r) => { const t = setTimeout(r, ms); sig.onSkip = () => { clearTimeout(t); r(); }; });

export async function runBoot(os, overlay, { post = true } = {}) {
  const sig = { skipped: false, onSkip: null };
  const skip = () => { sig.skipped = true; sig.onSkip?.(); };
  const keys = (e) => { if (os.interactive) skip(); };
  overlay.addEventListener('pointerdown', skip);
  window.addEventListener('keydown', keys);
  try {
    if (post) await runPost(os, overlay, sig);
    if (!sig.skipped) await runSplash(os, overlay, sig);
  } finally {
    overlay.removeEventListener('pointerdown', skip);
    window.removeEventListener('keydown', keys);
  }
}

async function runPost(os, overlay, sig) {
  const pre = h('div', { class: 'os-post' });
  const logo = h('img', { class: 'os-post-logo', src: iconURL('logo', 32), alt: '' });
  const foot = h('div', { class: 'os-post-foot' }, 'Press any key or click to skip');
  overlay.replaceChildren(pre, logo, foot);
  const line = (html = '') => { const d = h('div', { html }); pre.append(d); os.emit('post', html.includes('Detecting') || html.includes('Booting') ? 'seek' : 'line'); return d; };
  const wait = (ms) => (sig.skipped ? Promise.resolve() : sleep(ms, sig));
  line('<span class="hl">COLOUR.CODES BIOS v1.09</span>   Release 01/03/2009');
  line('Copyright (C) 2009 colour.codes. No rights reserved.');
  line('');
  await wait(260);
  line('Main Processor : x86-64 Dual Core @ 2.40GHz');
  const mem = line('Memory Testing : 0K');
  const total = 2097152;
  const steps = sig.skipped ? 1 : 14;
  for (let i = 1; i <= steps; i++) {
    mem.textContent = `Memory Testing : ${Math.round((total * i) / steps)}K${i === steps ? ' OK' : ''}`;
    await wait(42);
  }
  line('');
  await wait(140);
  line('Detecting Primary Master ... <span class="ok">WDC 160GB</span>');
  await wait(170);
  line('Detecting Primary Slave  ... <span class="ok">DVD-RW</span>');
  await wait(140);
  line('Keyboard ................... <span class="ok">OK</span>');
  line('Mouse ...................... <span class="ok">OK</span>');
  await wait(120);
  line('Network .................... <span class="or">Robinhood Chain (id 4663)</span>');
  await wait(200);
  line('');
  line('Verifying DMI Pool Data ......');
  await wait(260);
  line('Booting from Hard Disk...');
  await wait(320);
}

async function runSplash(os, overlay, sig) {
  os.emit('post', 'splash');
  const wait = (ms) => (sig.skipped ? Promise.resolve() : sleep(ms, sig));
  overlay.replaceChildren(h('div', { class: 'os-splash' },
    h('img', { class: 'mark', src: iconURL('logo', 32), alt: '' }),
    h('div', { class: 'word' }, 'colour', h('em', null, '.codes')),
    h('div', { class: 'sub' }, 'Release 1 · 2009'),
    h('div', { class: 'bar' }, h('i')),
  ));
  await wait(1150);
}
