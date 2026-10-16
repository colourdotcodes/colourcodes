// Atomic JSON persistence for pool/data/<deployment>/*.json (write temp file, fsync, rename).
import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';

export class JsonStore {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    this.dirty = new Map();   // name -> () => object
    this.timer = null;
  }

  load(name, fallback) {
    try { return JSON.parse(readFileSync(join(this.dir, name + '.json'), 'utf8')); }
    catch { return fallback; }
  }

  /** Write now (synchronously, atomically). Use for anything money-related. */
  saveNow(name, obj) {
    const file = join(this.dir, name + '.json');
    const tmp = `${file}.${process.pid}.tmp`;
    const data = JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
    writeFileSync(tmp, data);
    const fd = openSync(tmp, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, file);
    this.dirty.delete(name);
  }

  /** Mark for a debounced write; `get` is called at write time. */
  later(name, get, ms = 4000) {
    this.dirty.set(name, get);
    if (!this.timer) {
      this.timer = setTimeout(() => { this.timer = null; this.flush(); }, ms);
      this.timer.unref?.();
    }
  }

  flush() {
    for (const [name, get] of [...this.dirty]) {
      try { this.saveNow(name, get()); } catch (e) { console.error(`[pool] save ${name} failed: ${e.message}`); }
    }
  }
}
