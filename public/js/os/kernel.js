// ColourcodeOS kernel: owns the virtual screen, modes, events, app loading,
// popups, message boxes and the boot / shutdown cycle.
import { h, icon, reducedMotion } from './ui.js';
import { iconImg } from './icons.js';
import { WindowManager } from './wm.js';
import { Shell } from './shell.js';
import { Cursor } from './cursor.js';
import { runBoot } from './boot.js';
import { APPS, loaders } from './registry.js';
import { api } from './api.js';

const CRT_W = 1024, CRT_H = 960;   // the classic tube is almost square
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

export class OS {
  // autoMode: pick crt/native from the viewport by itself (no hero on the page).
  // Otherwise the hero owns data-mode on #os-root and the OS follows it.
  constructor(root, { autoMode = true } = {}) {
    this.root = root;
    this.events = new Map();
    this.interactive = true;
    this.booted = false;
    this.mq = window.matchMedia('(max-width: 760px)');
    this.autoMode = autoMode && !root.hasAttribute('data-mode-lock');
    this.mode = this.autoMode ? (this.mq.matches ? 'native' : 'crt') : (root.dataset.mode === 'native' ? 'native' : 'crt');
    root.dataset.mode = this.mode;
    this.motion = !reducedMotion();
    this.wm = new WindowManager(this);
    this.cursor = new Cursor(this);
    this.shell = new Shell(this);
    this.popups = [];
    this.build();
    this.bind();
    this.readyPromise = new Promise((r) => (this._ready = r));
  }

  // ---------------------------------------------------------------- dom ---
  build() {
    const r = this.root;
    r.classList.add('nkos');
    if (r.dataset.crt !== 'off') r.classList.add('crt-fx');
    this.screen = h('div', { class: 'os-screen' });
    this.desktop = h('div', { class: 'os-desktop' });
    this.iconLayer = h('div', { class: 'os-icons', role: 'group', 'aria-label': 'Desktop' });
    this.winLayer = h('div', { class: 'os-windows' });
    this.desktop.append(this.iconLayer, this.winLayer);
    this.fx = h('div', { class: 'os-fx', 'aria-hidden': 'true' }, h('div', { class: 'grain' }));
    this.bootEl = h('div', { class: 'os-boot', 'aria-hidden': 'true' });
    this.tip = h('div', { class: 'os-tip', hidden: true, role: 'tooltip' });
    this.screen.append(this.desktop);
    this.shell.mount();
    this.cursor.mount(this.screen);
    this.screen.append(this.tip, this.bootEl, this.fx);
    r.replaceChildren(this.screen);
    this.cursor.show(this.mode === 'crt');
    this.cursor.moveTo(CRT_W * 0.62, CRT_H * 0.58);
    // wallpaper (the CSS gradient stays as the fallback)
    const img = new Image();
    img.onload = () => this.desktop.classList.add('has-wallpaper');
    img.src = '/img/os/wallpaper.jpg';
    // film grain tile, generated once
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d'), d = g.createImageData(128, 128);
    let s = 1234567;
    for (let i = 0; i < d.data.length; i += 4) {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      const v = (s >>> 16) & 255;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255;
    }
    g.putImageData(d, 0, 0);
    r.style.setProperty('--crt-noise', `url(${c.toDataURL()})`);
  }

  bind() {
    const r = this.root;
    // own cursor: follow the real pointer while interactive
    r.addEventListener('pointermove', (e) => {
      if (!this.interactive || this.mode !== 'crt') return;
      if (e.pointerType === 'touch') { this.cursor.show(false); return; }
      const p = this.toVirtual(e.clientX, e.clientY);
      if (!p) return;
      this.cursor.show(true);
      this.cursor.moveTo(p.x, p.y);
      if (e.target !== this._lastTarget) { this._lastTarget = e.target; this.cursor.set(this.cursor.kindFor(e.target)); }
    }, { passive: true });
    r.addEventListener('pointerleave', () => { if (this.interactive && this.mode === 'crt') this.cursor.show(false); this.hideTip(); });
    r.addEventListener('pointerdown', (e) => {
      this.hideTip();
      if (!e.target.closest('.menu, .win-menubar')) this.closePopups();
    }, true);
    // tooltips in the period style
    r.addEventListener('pointerover', (e) => this.maybeTip(e));
    r.addEventListener('pointerout', (e) => { if (this._tipFor && !this._tipFor.contains(e.relatedTarget)) this.hideTip(); });
    // keyboard
    window.addEventListener('keydown', (e) => {
      if (!this.interactive) return;
      if (e.key === 'Escape') {
        if (this.popups.length) { this.closePopups(); e.preventDefault(); return; }
        if (this.shell.startEl) { this.shell.closeStart(); this.shell.startBtn.focus(); e.preventDefault(); return; }
        const top = this.wm.active;
        if (top && top.dialog) { top.close(); e.preventDefault(); }
      }
    }, true);
    // phones / desktops switch layout live (crt never reads the viewport for layout)
    this.mq.addEventListener?.('change', () => { if (this.autoMode) this.setMode(this.mq.matches ? 'native' : 'crt'); });
    // follow the hero when it flips data-mode itself
    new MutationObserver(() => { const m = r.dataset.mode; if ((m === 'crt' || m === 'native') && m !== this.mode) this.setMode(m); })
      .observe(r, { attributes: true, attributeFilter: ['data-mode'] });
    // pause effects when hidden
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((ents) => { for (const en of ents) r.classList.toggle('os-hidden', !en.isIntersecting); }).observe(r);
    }
    document.addEventListener('visibilitychange', () => r.classList.toggle('os-paused', document.hidden));
    window.addEventListener('resize', () => { this.cursor.invalidate(); if (this.mode === 'native') { this.wm.relayout(); this.shell.layoutIcons(); } });
  }

  // -------------------------------------------------------------- events ---
  on(ev, fn) { if (!this.events.has(ev)) this.events.set(ev, new Set()); this.events.get(ev).add(fn); return () => this.off(ev, fn); }
  off(ev, fn) { this.events.get(ev)?.delete(fn); }
  emit(ev, data) { for (const fn of this.events.get(ev) || []) { try { fn(data); } catch (e) { console.error(e); } } }

  // ---------------------------------------------------------------- geometry
  size() {
    if (this.mode === 'crt') return { w: CRT_W, h: CRT_H };
    return { w: this.root.clientWidth || 390, h: this.root.clientHeight || 700 };
  }
  tbHeight() {
    if (this.mode !== 'native') return 30;
    const inset = parseFloat(getComputedStyle(this.root).getPropertyValue('--os-inset-top')) || 0;
    return 48 + inset;
  }
  toVirtual(cx, cy, force) { return this.cursor.toVirtual(cx, cy, force); }
  // element rect in virtual px (layout coordinates, unaffected by the hero's transform)
  rectOf(el) {
    let x = 0, y = 0, n = el;
    while (n && n !== this.screen) { x += n.offsetLeft - (n.offsetParent && n.offsetParent !== this.screen ? n.offsetParent.scrollLeft : 0); y += n.offsetTop - (n.offsetParent && n.offsetParent !== this.screen ? n.offsetParent.scrollTop : 0); n = n.offsetParent; }
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  }

  // ------------------------------------------------------------- public ----
  boot(opts = {}) {
    if (this.bootPromise) return this.bootPromise;
    const first = !store.get('nkos.booted');
    const full = !opts.fast && this.motion && (opts.force || first);
    this.bootPromise = (async () => {
      this.emit('boot', { full });
      if (full) {
        this.cursor.set('busy');
        await runBoot(this, this.bootEl, { post: opts.post !== false });
        this.cursor.set('arrow');
      }
      store.set('nkos.booted', '1');
      this.bootEl.classList.add('is-off');
      setTimeout(() => { this.bootEl.hidden = true; this.bootEl.replaceChildren(); }, full ? 380 : 0);
      this.booted = true;
      this._ready();
      this.emit('ready');
      this.checkNet();
      this.netTimer = setInterval(() => { if (!document.hidden) this.checkNet(); }, 60000);
      this.watchMiner();
      // warm the app modules while the visitor looks around
      const idle = window.requestIdleCallback || ((f) => setTimeout(f, 600));
      idle(() => Object.values(loaders).forEach((l) => l().catch(() => {})));
      if (first && opts.welcome !== false) this.pendingWelcome = true;
      if (this.interactive) this.flushWelcome(full ? 1400 : 2200);
    })();
    return this.bootPromise;
  }

  // Power-cycle: the hero asks for this when the visitor enters the computer.
  async reboot(opts = {}) {
    if (this.rebooting) return;
    this.rebooting = true;
    this.bootEl.hidden = false;
    this.bootEl.classList.remove('is-off');
    this.bootEl.replaceChildren();
    this.emit('boot', { full: true });
    this.cursor.set('busy');
    try { await runBoot(this, this.bootEl, { post: opts.post !== false }); } finally { this.cursor.set('arrow'); }
    this.bootEl.classList.add('is-off');
    setTimeout(() => { this.bootEl.hidden = true; this.bootEl.replaceChildren(); }, 380);
    this.emit('ready');
    this.rebooting = false;
  }

  async open(id, opts = {}) {
    if (!APPS[id] || !loaders[id]) { console.warn('[ColourcodeOS] unknown app', id); return null; }
    if (!this.booted) await this.readyPromise;
    this.shell.closeStart();
    const existing = this.wm.byApp(id);
    if (existing) { existing.restore(); return existing; }
    if (this._opening?.[id]) return this._opening[id];
    (this._opening ||= {})[id] = (async () => {
      try {
        const mod = (await loaders[id]()).default;
        const meta = APPS[id];
        const win = this.wm.create({
          appId: id, title: mod.title || meta.title, icon: meta.icon,
          w: mod.size?.[0], h: mod.size?.[1], x: opts.x ?? mod.pos?.[0], y: opts.y ?? mod.pos?.[1],
          minW: mod.min?.[0], minH: mod.min?.[1],
          menu: mod.menu ? mod.menu(this) : null, toolbar: mod.toolbar, status: mod.status, resizable: mod.resizable,
          cls: 'app-' + id,
        });
        win.hooks = mod.mount(win, this, opts) || {};
        this.emit('open', id);
        return win;
      } catch (e) {
        console.error(e);
        this.msgbox({ title: APPS[id].title, icon: 'error', text: 'This program could not be started. Please try again.' });
        return null;
      } finally { delete this._opening[id]; }
    })();
    return this._opening[id];
  }

  close(id) { this.wm.byApp(id)?.close(); }

  setInteractive(on) {
    this.interactive = !!on;
    const r = this.root;
    r.classList.toggle('os-interactive', this.interactive);
    r.classList.toggle('os-noninteractive', !this.interactive);
    r.classList.toggle('os-has-cursor', this.interactive && this.mode === 'crt' && window.matchMedia('(pointer: fine)').matches);
    if (this.interactive) r.removeAttribute('inert'); else r.setAttribute('inert', '');
    if (this.interactive && this.booted) this.flushWelcome();
    if (!this.interactive) {
      this.closePopups(); this.hideTip();
      if (r.contains(document.activeElement)) document.activeElement.blur();
      this.cursor.show(this.mode === 'crt');
    }
    this.cursor.invalidate();
  }

  pointer(x, y) {
    if (this.mode !== 'crt') return;
    this.cursor.show(true);
    this.cursor.moveTo(Math.max(0, Math.min(CRT_W - 1, +x || 0)), Math.max(0, Math.min(CRT_H - 1, +y || 0)));
  }

  setMode(m, lock = false) {
    if (m !== 'crt' && m !== 'native') return;
    if (lock) this.autoMode = false;
    if (m === this.mode) return;
    this.mode = m;
    if (this.root.dataset.mode !== m) this.root.dataset.mode = m;
    this.closePopups(); this.shell.closeStart();
    this.cursor.show(m === 'crt'); this.cursor.invalidate();
    this.setInteractive(this.interactive);
    this.wm.relayout(); this.shell.layoutIcons();
    for (const w of this.wm.wins) w.hooks?.onResize?.();
    this.emit('mode', m);
  }

  shutdown() {
    this.closePopups();
    if (this.events.get('shutdown')?.size) { this.emit('shutdown'); return; }
    // no hero listening (standalone): show a power-off screen
    const btn = h('button', { type: 'button' }, 'Turn on');
    const off = h('div', { class: 'os-poweroff' }, h('div', { style: { textAlign: 'center' } }, h('p', null, 'colour.codes has shut down.'), btn));
    btn.addEventListener('click', () => off.remove());
    this.screen.append(off);
  }

  // ------------------------------------------------------------ helpers ---
  notify(o) { return this.shell.balloon(o); }

  // the welcome balloon waits until someone can actually read and click it
  flushWelcome(delay = 900) {
    if (!this.pendingWelcome) return;
    this.pendingWelcome = false;
    setTimeout(() => this.welcome(), delay);
  }
  welcome() {
    this.notify({
      title: 'Welcome to colour.codes',
      text: 'Double-click colour.codes Miner to generate coins, or read Notes.txt. Mining opens at launch.',
      icon: 'logo', timeout: 9000, onClick: () => this.open('miner'),
    });
  }

  async checkNet() {
    const r = await api.chain();
    const s = r.kind === 'ok' ? 'online' : r.kind;
    this.netState = s;
    this.shell.setNet(s);
    this.emit('net', s);
  }

  watchMiner() {
    const M = window.ColourcodeMining;
    if (!M || this._minerWatched || typeof M.on !== 'function') return;
    this._minerWatched = true;
    try {
      M.on('stats', (st) => this.shell.setMiner(st));
      M.on('state', () => this.shell.setMiner());
    } catch {}
  }

  // popup menus: items [{label, icon, onClick, disabled, checked, sep, key}]
  popup(items, { anchor, x, y, onClose } = {}) {
    this.closePopups();
    const m = h('div', { class: 'menu', role: 'menu' });
    for (const it of items) {
      if (it.sep) { m.append(h('div', { class: 'menu-sep', role: 'separator' })); continue; }
      const b = h('button', { class: 'menu-item', type: 'button', role: it.checked != null ? 'menuitemcheckbox' : 'menuitem', 'aria-checked': it.checked != null ? String(!!it.checked) : null },
        h('span', { class: 'mi-gap' }, it.icon ? iconImg(it.icon, 16) : it.checked ? h('i', { class: 'tick' }) : null),
        h('span', null, it.label), it.key ? h('span', { class: 'mi-key' }, it.key) : null);
      if (it.disabled) b.disabled = true;
      b.addEventListener('click', () => { this.closePopups(); it.onClick?.(); });
      m.append(b);
    }
    m.addEventListener('keydown', (e) => {
      const list = [...m.querySelectorAll('.menu-item:not(:disabled)')];
      const i = list.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    });
    this.screen.append(m);
    const S = this.size();
    let px = x ?? 0, py = y ?? 0;
    if (anchor) { const a = this.rectOf(anchor); px = a.x; py = a.y + a.h; }
    const mw = m.offsetWidth, mh = m.offsetHeight;
    m.style.left = Math.max(0, Math.min(S.w - mw - 2, px)) + 'px';
    m.style.top = Math.max(0, Math.min(S.h - this.tbHeight() - mh - 2, py)) + 'px';
    this.popups.push({ el: m, onClose });
    if (this.interactive) m.querySelector('.menu-item:not(:disabled)')?.focus({ preventScroll: true });
    return m;
  }
  closePopups() {
    const list = this.popups; this.popups = [];
    for (const p of list) { p.el.remove(); p.onClose?.(); }
  }

  // message box -> resolves with the clicked button label (or null when closed)
  msgbox({ title = 'colour.codes', icon: ic = 'info', text = '', html, buttons = ['OK'], parent } = {}) {
    return new Promise((resolve) => {
      const win = this.wm.create({ title, icon: ic === 'info' || ic === 'warn' || ic === 'error' || ic === 'ok' ? 'logo' : ic, dialog: true, w: 380, h: 10, center: true });
      win.el.style.height = 'auto';
      const paras = Array.isArray(text) ? text : [text];
      const msg = h('div', { class: 'dlg-msg' }, iconImg(ic, 32), h('div', null, html || paras.map((t) => h('p', null, t))));
      let result = null;
      const btns = h('div', { class: 'dlg-btns' + (buttons.length === 1 ? ' center' : '') }, buttons.map((b, i) => {
        const el = h('button', { class: 'btn' + (i === 0 ? ' default' : ''), type: 'button' }, b);
        el.addEventListener('click', () => { result = b; win.close(); });
        return el;
      }));
      win.body.append(msg, btns);
      win.hooks = { onClose: () => resolve(result) };
      if (parent && !parent.closed) parent.onCleanup(() => win.close());
      // centre on the parent window (or the desktop)
      const a = this.wm.area();
      const p = parent && !parent.closed && !parent.maximized ? parent : null;
      const hgt = win.el.offsetHeight;
      win.h = hgt;
      win.x = Math.round(p ? p.x + (p.w - win.w) / 2 : (a.w - win.w) / 2);
      win.y = Math.round(p ? p.y + Math.min(120, (p.h - hgt) / 2) : (a.h - hgt) / 2.4);
      win.moveTo(win.x, win.y);
      win.el.style.height = 'auto';
      if (this.interactive) btns.firstChild.focus({ preventScroll: true });
    });
  }

  about() {
    this.msgbox({
      title: 'About colour.codes', icon: 'logo',
      text: ['colour.codes, Release 1 (2009 edition).', 'The desktop of colour.codes: a token on Robinhood Chain mined with real proof of work, checked by the contract itself.', 'All numbers come from the chain and the pool server. Nothing is simulated.'],
    });
  }

  // ------------------------------------------------------------ tooltips --
  maybeTip(e) {
    if (!this.interactive || this.mode !== 'crt') return;
    const el = e.target instanceof Element ? e.target.closest('[title], [data-tip]') : null;
    if (!el || !this.root.contains(el) || el === this._tipFor) return;
    const t = el.getAttribute('title');
    if (t != null) { el.dataset.tip = t; el.removeAttribute('title'); }
    if (!el.dataset.tip) return;
    this.hideTip();
    this._tipFor = el;
    this._tipT = setTimeout(() => {
      if (this._tipFor !== el || !el.isConnected) return;
      this.tip.textContent = el.dataset.tip;
      this.tip.hidden = false;
      const S = this.size(), tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
      let x = this.cursor.x + 2, y = this.cursor.y + 21;
      if (y + th > S.h - 2) y = this.cursor.y - th - 4;
      this.tip.style.left = Math.max(2, Math.min(S.w - tw - 2, x)) + 'px';
      this.tip.style.top = y + 'px';
    }, 650);
  }
  hideTip() { clearTimeout(this._tipT); this._tipFor = null; this.tip.hidden = true; }
}
