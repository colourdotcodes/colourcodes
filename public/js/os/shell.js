// Desktop icons, taskbar, start menu, system tray, clock and balloons.
import { h, icon, glyph, GLYPH } from './ui.js';
import { iconImg } from './icons.js';
import { APPS, DESKTOP, START_PROGRAMS, START_DOCS } from './registry.js';
import { fmtHashrate } from './eth.js';

export class Shell {
  constructor(os) {
    this.os = os;
    this.icons = [];
    this.selected = null;
  }

  mount() {
    const os = this.os;
    // desktop icons
    for (const [id, x, y] of DESKTOP) {
      const app = APPS[id];
      const img = iconImg(app.icon, 32);
      const pic = h('span', { class: 'os-icon-pic', style: { '--icon': `url(${img.src})` } }, img);
      const b = h('button', { class: 'os-icon', type: 'button', 'data-app': id, 'aria-label': app.title },
        pic, h('span', { class: 'os-icon-label' }, app.title));
      b._pos = [x, y];
      b.addEventListener('click', (e) => {
        this.select(b);
        if (os.mode === 'native' || e.detail === 0) os.open(id); // tap on phones, Enter/Space on keyboards
      });
      b.addEventListener('dblclick', () => { if (os.mode !== 'native') os.open(id); });
      b.addEventListener('keydown', (e) => this.iconKeys(e, b));
      this.icons.push(b);
    }
    os.iconLayer.append(...this.icons);
    os.desktop.addEventListener('pointerdown', (e) => { if (e.target === os.desktop || e.target === os.iconLayer || e.target === os.winLayer) this.select(null); });
    this.layoutIcons();

    // taskbar
    this.startBtn = h('button', { class: 'os-startbtn', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('logo', 16), h('span', null, 'colour.codes'));
    this.startBtn.addEventListener('click', () => this.toggleStart());
    this.tasks = h('div', { class: 'os-tasks', role: 'toolbar', 'aria-label': 'Open windows' });
    this.netIcon = h('button', { class: 'os-tray-btn', type: 'button', title: 'Robinhood Chain' }, iconImg('network', 16));
    this.netIcon.addEventListener('click', () => os.open('explorer'));
    this.minerIcon = h('button', { class: 'os-tray-btn', type: 'button', title: 'colour.codes Miner', hidden: true }, iconImg('miner', 16));
    this.minerIcon.addEventListener('click', () => os.open('miner'));
    this.clock = h('button', { class: 'os-clock', type: 'button' });
    this.tray = h('div', { class: 'os-tray' }, this.minerIcon, this.netIcon, this.clock);
    this.bar = h('div', { class: 'os-taskbar', role: 'toolbar', 'aria-label': 'Taskbar' }, this.startBtn, h('i', { class: 'os-tb-sep' }), this.tasks, this.tray);
    os.screen.append(this.bar);
    this.tick();
  }

  layoutIcons() {
    const os = this.os;
    if (os.mode === 'native') { for (const b of this.icons) { b.style.left = ''; b.style.top = ''; } return; }
    const a = os.wm.area();
    for (const b of this.icons) {
      const [x, y] = b._pos;
      b.style.left = (x < 0 ? a.w + x : x) + 'px';
      b.style.top = (y < 0 ? a.h + y : y) + 'px';
    }
  }

  select(b) {
    this.selected?.classList.remove('is-selected');
    this.selected = b;
    b?.classList.add('is-selected');
  }

  iconKeys(e, b) {
    const i = this.icons.indexOf(b);
    let j = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') j = (i + 1) % this.icons.length;
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') j = (i - 1 + this.icons.length) % this.icons.length;
    if (j >= 0) { e.preventDefault(); this.icons[j].focus(); this.select(this.icons[j]); }
  }

  // ---- taskbar buttons ----
  syncTasks() {
    const wm = this.os.wm;
    const list = wm.wins.filter((w) => !w.dialog && !w.closed);
    const have = new Map([...this.tasks.children].map((b) => [b._win, b]));
    for (const w of list) {
      let b = have.get(w);
      if (!b) {
        b = h('button', { class: 'os-task', type: 'button' }, icon(w.iconName, 16), h('span'));
        b._win = w;
        b.addEventListener('click', () => {
          if (w.minimized) w.restore();
          else if (wm.active === w) w.minimize();
          else w.focus();
        });
        this.tasks.append(b);
      }
      have.delete(w);
      b.querySelector('span').textContent = w.title;
      b.title = w.title;
      b.classList.toggle('is-active', wm.active === w && !w.minimized);
    }
    for (const b of have.values()) b.remove();
  }

  // ---- clock ----
  tick() {
    const now = new Date();
    this.clock.textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    this.clock.title = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    clearTimeout(this.clockT);
    this.clockT = setTimeout(() => this.tick(), 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
  }

  setNet(state) {
    const on = state === 'online';
    this.netIcon.replaceChildren(iconImg(on ? 'network' : 'networkOff', 16));
    const label = { online: 'Pool server online', not_ready: 'Pool server not online yet', offline: 'No connection', not_deployed: 'Pool server online · contracts not deployed yet', not_started: 'Pool server online · waiting for the first block' }[state] || 'Checking…';
    this.netIcon.title = `Robinhood Chain (id 4663) · ${label}`;
  }

  setMiner(stats) {
    const running = !!(window.ColourcodeMining && window.ColourcodeMining.running);
    this.minerIcon.hidden = !running;
    if (running) this.minerIcon.title = `Generating · ${fmtHashrate(stats?.hashrate || 0)}`;
  }

  // ---- start menu ----
  toggleStart(force) {
    const open = force ?? !this.startEl;
    if (!open) { this.closeStart(); return; }
    if (this.startEl) return;
    const os = this.os;
    this.os.closePopups();
    const item = (id, big) => {
      const app = APPS[id];
      const b = h('button', { class: 'menu-item' + (big ? ' big' : ''), type: 'button', role: 'menuitem' },
        iconImg(app.icon, big ? 32 : 16),
        big ? h('span', null, h('b', null, app.title), h('small', null, app.desc)) : h('span', null, app.title));
      b.addEventListener('click', () => { this.closeStart(); os.open(id); });
      return b;
    };
    const shut = h('button', { class: 'menu-item', type: 'button', role: 'menuitem' }, iconImg('power', 16), h('span', null, 'Shut Down…'));
    shut.addEventListener('click', () => { this.closeStart(); os.shutdown(); });
    const about = h('button', { class: 'menu-item', type: 'button', role: 'menuitem' }, iconImg('logo', 16), h('span', null, 'About'));
    about.addEventListener('click', () => { this.closeStart(); os.about(); });
    this.startEl = h('div', { class: 'os-start', role: 'menu', 'aria-label': 'colour.codes menu' },
      h('div', { class: 'os-start-head' }, iconImg('logo', 32), h('div', null, h('b', null, 'colour', h('em', null, '.codes')), h('small', null, 'Release 1 · 2009 · user: anonymous'))),
      h('div', { class: 'os-start-body' },
        h('div', { class: 'os-start-cap' }, 'Programs'),
        START_PROGRAMS.map((id) => item(id, true)),
        h('div', { class: 'menu-sep' }),
        START_DOCS.map((id) => item(id, false))),
      h('div', { class: 'os-start-foot' }, about, shut));
    const menuEl = this.startEl;
    menuEl.addEventListener('keydown', (e) => {
      const items = [...menuEl.querySelectorAll('.menu-item')];
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    });
    os.screen.append(this.startEl);
    this.startBtn.classList.add('is-open');
    this.startBtn.setAttribute('aria-expanded', 'true');
    if (os.interactive) this.startEl.querySelector('.menu-item')?.focus({ preventScroll: true });
    setTimeout(() => {
      this.outside = (e) => { if (!this.startEl?.contains(e.target) && !this.startBtn.contains(e.target)) this.closeStart(); };
      os.root.addEventListener('pointerdown', this.outside, true);
    });
  }
  closeStart() {
    if (!this.startEl) return;
    this.startEl.remove(); this.startEl = null;
    this.startBtn.classList.remove('is-open');
    this.startBtn.setAttribute('aria-expanded', 'false');
    this.os.root.removeEventListener('pointerdown', this.outside, true);
  }

  // ---- balloons ----
  balloon({ title, text, icon: ic = 'info', timeout = 8000, onClick }) {
    this.balloonEl?.remove();
    const x = h('button', { class: 'x', type: 'button', 'aria-label': 'Close' }, glyph(GLYPH.x));
    const el = h('div', { class: 'os-balloon', role: 'status' }, h('h5', null, iconImg(ic, 16), title), text ? h('p', null, text) : null, x);
    const close = () => { el.remove(); if (this.balloonEl === el) this.balloonEl = null; };
    x.addEventListener('click', (e) => { e.stopPropagation(); close(); });
    if (onClick) { el.addEventListener('click', () => { close(); onClick(); }); el.dataset.cur = 'hand'; }
    this.os.screen.append(el);
    this.balloonEl = el;
    if (timeout) setTimeout(close, timeout);
    return close;
  }
}
