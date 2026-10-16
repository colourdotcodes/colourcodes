// Window manager: frames, focus / z-order, drag, resize, minimise, maximise.
import { h, glyph, GLYPH, icon } from './ui.js';

let seq = 0;

export class Win {
  constructor(wm, o) {
    this.wm = wm; this.os = wm.os;
    this.id = o.id || 'w' + ++seq;
    this.appId = o.appId || null;
    this.title = o.title || '';
    this.iconName = o.icon || 'logo';
    this.dialog = !!o.dialog;
    this.resizable = o.resizable !== false && !o.dialog;
    this.minW = o.minW || 220; this.minH = o.minH || 140;
    this.w = o.w || 480; this.h = o.h || 340;
    this.x = o.x ?? 80; this.y = o.y ?? 60;
    this.maximized = false; this.minimized = false;
    this.cleanup = [];
    this.build(o);
  }
  build(o) {
    const btns = h('div', { class: 'win-btns' });
    if (!this.dialog) {
      this.bMin = h('button', { class: 'wb wb-min', type: 'button', 'aria-label': 'Minimise', title: 'Minimise' }, glyph(GLYPH.min));
      this.bMax = h('button', { class: 'wb wb-max', type: 'button', 'aria-label': 'Maximise', title: 'Maximise' }, glyph(GLYPH.max));
      this.bMin.addEventListener('click', () => this.minimize());
      this.bMax.addEventListener('click', () => this.toggleMax());
      if (!this.resizable) this.bMax.disabled = true;
      btns.append(this.bMin, this.bMax);
    }
    this.bClose = h('button', { class: 'wb wb-close', type: 'button', 'aria-label': 'Close', title: 'Close' }, glyph(GLYPH.close));
    this.bClose.addEventListener('click', () => this.close());
    btns.append(this.bClose);
    this.iconEl = icon(this.iconName, 16);
    this.captionEl = h('span', { class: 'win-caption', id: this.id + '-t' }, this.title);
    this.titleEl = h('header', { class: 'win-title' }, this.iconEl, this.captionEl, btns);
    this.body = h('div', { class: 'win-body' });
    this.el = h('section', { class: 'win' + (this.dialog ? ' dialog' : '') + (o.cls ? ' ' + o.cls : ''), role: this.dialog ? 'alertdialog' : 'dialog', 'aria-labelledby': this.id + '-t', tabindex: '-1', 'data-app': this.appId || '' }, this.titleEl);
    if (o.menu) this.setMenu(o.menu);
    if (o.toolbar) { this.toolbar = h('div', { class: 'win-toolbar' }); this.el.append(this.toolbar); }
    this.el.append(this.body);
    if (o.status) { this.status = h('footer', { class: 'win-status' }); this.el.append(this.status); }
    if (this.resizable) { this.grip = h('div', { class: 'win-grip', 'aria-hidden': 'true' }); this.el.append(this.grip); this.bindResize(); }
    this.bindDrag();
    this.el.addEventListener('pointerdown', () => this.focus(), true);
    this.titleEl.addEventListener('dblclick', (e) => { if (!e.target.closest('.wb') && this.resizable) this.toggleMax(); });
    this.apply();
  }
  setMenu(items) {
    const bar = this.menubar || h('nav', { class: 'win-menubar', role: 'menubar' });
    bar.replaceChildren();
    for (const m of items) {
      const b = h('button', { type: 'button', role: 'menuitem' }, m.label);
      b.addEventListener('click', () => {
        b.classList.add('is-open');
        this.os.popup(typeof m.items === 'function' ? m.items() : m.items, { anchor: b, onClose: () => b.classList.remove('is-open') });
      });
      bar.append(b);
    }
    if (!this.menubar) { this.menubar = bar; this.titleEl.after(bar); }
  }
  setTitle(t) { this.title = t; this.captionEl.textContent = t; this.wm.sync(); }
  setStatus(cells) {
    if (!this.status) return;
    this.status.replaceChildren(...cells.map((c) => {
      if (c instanceof Node) return c;
      return h('span', { class: c.grow ? 'grow' : '', style: c.width ? { width: c.width + 'px', flex: 'none' } : null, title: c.title }, c.icon ? icon(c.icon, 16) : null, c.text ?? '');
    }));
  }
  apply() {
    const s = this.el.style;
    if (this.maximized) {
      const a = this.wm.area();
      s.left = '0px'; s.top = '0px'; s.width = a.w + 'px'; s.height = a.h + 'px';
    } else {
      s.left = Math.round(this.x) + 'px'; s.top = Math.round(this.y) + 'px';
      s.width = Math.round(this.w) + 'px'; s.height = Math.round(this.h) + 'px';
    }
  }
  moveTo(x, y) {
    const a = this.wm.area();
    this.x = Math.max(-this.w + 80, Math.min(a.w - 80, x));
    this.y = Math.max(0, Math.min(a.h - 26, y));
    this.apply();
  }
  bindDrag() {
    this.titleEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.wb') || this.maximized || this.os.mode === 'native') return;
      const p0 = this.os.toVirtual(e.clientX, e.clientY, true);
      if (!p0) return;
      e.preventDefault();
      const x0 = this.x, y0 = this.y;
      this.titleEl.setPointerCapture(e.pointerId);
      let raf = 0, last = null;
      const move = (ev) => {
        last = this.os.toVirtual(ev.clientX, ev.clientY);
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (last) this.moveTo(x0 + last.x - p0.x, y0 + last.y - p0.y); });
      };
      const up = () => {
        this.titleEl.removeEventListener('pointermove', move);
        this.titleEl.removeEventListener('pointerup', up);
        this.titleEl.removeEventListener('pointercancel', up);
      };
      this.titleEl.addEventListener('pointermove', move);
      this.titleEl.addEventListener('pointerup', up);
      this.titleEl.addEventListener('pointercancel', up);
    });
  }
  bindResize() {
    this.grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.maximized || this.os.mode === 'native') return;
      const p0 = this.os.toVirtual(e.clientX, e.clientY, true);
      if (!p0) return;
      e.preventDefault(); e.stopPropagation();
      const w0 = this.w, h0 = this.h, a = this.wm.area();
      this.grip.setPointerCapture(e.pointerId);
      let raf = 0, last = null;
      const move = (ev) => {
        last = this.os.toVirtual(ev.clientX, ev.clientY);
        if (!raf) raf = requestAnimationFrame(() => {
          raf = 0;
          if (!last) return;
          this.w = Math.max(this.minW, Math.min(a.w - this.x, w0 + last.x - p0.x));
          this.h = Math.max(this.minH, Math.min(a.h - this.y, h0 + last.y - p0.y));
          this.apply();
        });
      };
      const up = () => { this.grip.removeEventListener('pointermove', move); this.grip.removeEventListener('pointerup', up); this.grip.removeEventListener('pointercancel', up); };
      this.grip.addEventListener('pointermove', move);
      this.grip.addEventListener('pointerup', up);
      this.grip.addEventListener('pointercancel', up);
    });
  }
  focus() { this.wm.focus(this); }
  minimize() {
    if (this.dialog) return;
    this.minimized = true; this.el.classList.add('is-min');
    this.hooks?.onHide?.();
    this.wm.focusTop();
  }
  restore() {
    if (this.minimized) { this.minimized = false; this.el.classList.remove('is-min'); this.hooks?.onShow?.(); }
    this.focus();
  }
  toggleMax() {
    if (!this.resizable) return;
    this.maximized = !this.maximized;
    this.el.classList.toggle('is-max', this.maximized);
    this.bMax?.replaceChildren(glyph(this.maximized ? GLYPH.restore : GLYPH.max));
    if (this.bMax) this.bMax.title = this.maximized ? 'Restore' : 'Maximise';
    this.apply();
    this.hooks?.onResize?.();
  }
  close() {
    if (this.closed) return;
    if (this.hooks?.beforeClose && this.hooks.beforeClose() === false) return;
    this.closed = true;
    this.hooks?.onClose?.();
    for (const fn of this.cleanup) { try { fn(); } catch {} }
    const done = () => { this.el.remove(); };
    if (this.os.motion && !this.minimized && this.os.mode !== 'native') {
      this.el.classList.add('is-closing');
      setTimeout(done, 120);
    } else done();
    this.wm.remove(this);
  }
  onCleanup(fn) { this.cleanup.push(fn); }
  get visible() { return !this.closed && !this.minimized; }
}

export class WindowManager {
  constructor(os) {
    this.os = os;
    this.wins = [];
    this.z = 10;
    this.active = null;
  }
  area() {
    const s = this.os.size();
    return { w: s.w, h: s.h - this.os.tbHeight() };
  }
  create(o) {
    const w = new Win(this, o);
    const a = this.area();
    w.w = Math.min(w.w, a.w - 8); w.h = Math.min(w.h, a.h - 8);
    if (o.center || o.x == null) {
      const n = this.wins.filter((x) => !x.closed && !x.dialog).length;
      w.x = o.x ?? Math.round((a.w - w.w) / 2) + (o.center ? 0 : n * 24 - 36);
      w.y = o.y ?? Math.max(8, Math.round((a.h - w.h) / 2.4) + (o.center ? 0 : n * 22 - 30));
    }
    w.x = Math.max(4, Math.min(a.w - w.w - 4, w.x)); w.y = Math.max(4, Math.min(a.h - w.h - 4, w.y));
    w.apply();
    this.wins.push(w);
    this.os.winLayer.append(w.el);
    if (this.os.motion && this.os.mode !== 'native') {
      w.el.classList.add('is-opening');
      setTimeout(() => w.el.classList.remove('is-opening'), 200);
    } else if (this.os.mode === 'native' && this.os.motion) {
      w.el.classList.add('is-opening');
      setTimeout(() => w.el.classList.remove('is-opening'), 220);
    }
    this.focus(w);
    return w;
  }
  focus(w) {
    if (!w || w.closed) return;
    if (w.minimized) { w.minimized = false; w.el.classList.remove('is-min'); w.hooks?.onShow?.(); }
    if (this.active !== w) {
      this.active?.el.classList.remove('is-active');
      w.el.style.zIndex = ++this.z;
      w.el.classList.add('is-active');
      this.active = w;
      if (this.os.interactive && !w.el.contains(document.activeElement)) w.el.focus({ preventScroll: true });
    } else if (+w.el.style.zIndex < this.z) w.el.style.zIndex = ++this.z;
    this.sync();
  }
  focusTop() {
    const vis = this.wins.filter((w) => w.visible).sort((a, b) => +b.el.style.zIndex - +a.el.style.zIndex);
    this.active?.el.classList.remove('is-active');
    this.active = null;
    if (vis[0]) this.focus(vis[0]); else this.sync();
  }
  remove(w) {
    this.wins = this.wins.filter((x) => x !== w);
    if (this.active === w) { this.active = null; this.focusTop(); } else this.sync();
    this.os.emit('close', w.appId);
  }
  byApp(id) { return this.wins.find((w) => w.appId === id && !w.closed); }
  sync() { this.os.shell?.syncTasks(); }
  relayout() { for (const w of this.wins) { if (!w.maximized) w.moveTo(w.x, w.y); w.apply(); } }
}
