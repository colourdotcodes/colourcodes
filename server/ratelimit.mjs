// Token buckets keyed by IP / address. take() → 0 if allowed, else seconds to wait.
export class Buckets {
  constructor(capacity, perSecond) {
    this.capacity = capacity;
    this.rate = perSecond;
    this.map = new Map();
    const t = setInterval(() => this.sweep(), 60000);
    t.unref?.();
  }

  take(key, cost = 1) {
    const now = Date.now() / 1000;
    let b = this.map.get(key);
    if (!b) { b = { tokens: this.capacity, at: now }; this.map.set(key, b); }
    b.tokens = Math.min(this.capacity, b.tokens + (now - b.at) * this.rate);
    b.at = now;
    if (b.tokens >= cost) { b.tokens -= cost; return 0; }
    return Math.ceil((cost - b.tokens) / this.rate);
  }

  sweep() {
    const now = Date.now() / 1000;
    for (const [k, b] of this.map) if (b.tokens + (now - b.at) * this.rate >= this.capacity) this.map.delete(k);
  }
}
