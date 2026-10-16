// Minimal JSON-RPC client: URL fallback, per-URL backoff on 429/5xx/network errors, request timeouts,
// and eth_getLogs paging (the official Robinhood Chain RPC limits log ranges).
import { sleep } from './util.mjs';

export class RpcError extends Error {
  constructor(message, code, data) { super(message); this.code = code; this.data = data; }
}

const RATE_LIMIT_RE = /rate.?limit|too many requests|exceeded|throttl|capacity/i;
const RANGE_RE = /block range|range (is )?too (large|wide)|limit|10000|10,000|query returned more than|too many (results|logs)/i;

export class Rpc {
  constructor(urls, { timeoutMs = 12000 } = {}) {
    if (!urls.length) throw new Error('no rpc urls');
    this.urls = urls;
    this.timeoutMs = timeoutMs;
    this.cool = new Map();     // url -> { until, delay }
    this.id = 1;
    this.stats = { calls: 0, errors: 0, rateLimited: 0 };
  }

  _usable() {
    const now = Date.now();
    const ok = this.urls.filter((u) => !(this.cool.get(u)?.until > now));
    return ok.length ? ok : [...this.urls].sort((a, b) => (this.cool.get(a)?.until || 0) - (this.cool.get(b)?.until || 0));
  }

  _penalize(url, rateLimited) {
    const prev = this.cool.get(url);
    const delay = Math.min(60000, prev ? prev.delay * 2 : (rateLimited ? 2000 : 1000));
    this.cool.set(url, { until: Date.now() + delay, delay });
    if (rateLimited) this.stats.rateLimited++;
  }

  async _post(url, payload) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (res.status === 429) throw Object.assign(new Error('rate limited (429)'), { transient: true, rateLimited: true });
    if (res.status >= 500) throw Object.assign(new Error(`rpc http ${res.status}`), { transient: true });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { throw Object.assign(new Error(`rpc bad response (${res.status})`), { transient: true }); }
    return body;
  }

  /**
   * One JSON-RPC call. `write: true` sends only to the first (primary) URL and never retries elsewhere,
   * so a transaction can never leak to an endpoint the operator did not choose.
   */
  async call(method, params = [], { write = false, retries = 3 } = {}) {
    this.stats.calls++;
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const urls = write ? [this.urls[0]] : this._usable();
      for (const url of urls) {
        try {
          const body = await this._post(url, { jsonrpc: '2.0', id: this.id++, method, params });
          if (body.error) {
            const msg = String(body.error.message || 'rpc error');
            if (RATE_LIMIT_RE.test(msg) && !RANGE_RE.test(msg)) {
              this._penalize(url, true);
              lastErr = new RpcError(msg, body.error.code, body.error.data);
              continue;
            }
            throw new RpcError(msg, body.error.code, body.error.data);
          }
          this.cool.delete(url);
          return body.result;
        } catch (e) {
          if (e instanceof RpcError) throw e;
          this.stats.errors++;
          lastErr = e;
          this._penalize(url, Boolean(e.rateLimited));
          if (write) break;
        }
      }
      if (write) break;
      await sleep(Math.min(8000, 500 * 2 ** attempt));
    }
    throw lastErr || new Error('rpc failed');
  }

  async blockNumber() { return Number(BigInt(await this.call('eth_blockNumber'))); }

  async latestBlock() {
    const b = await this.call('eth_getBlockByNumber', ['latest', false]);
    return { number: Number(BigInt(b.number)), timestamp: Number(BigInt(b.timestamp)) };
  }

  ethCall(to, data, from) {
    const tx = from ? { from, to, data } : { to, data };
    return this.call('eth_call', [tx, 'latest']);
  }

  /**
   * eth_getLogs over [from, to] in pages of at most `range` blocks. Halves the page on range errors.
   * Calls onPage(logs, pageTo) after each page so the caller can persist its cursor.
   */
  async getLogsPaged(filter, from, to, range, onPage) {
    let size = range;
    let cur = from;
    while (cur <= to) {
      const end = Math.min(to, cur + size - 1);
      let logs;
      try {
        logs = await this.call('eth_getLogs', [{ ...filter, fromBlock: '0x' + cur.toString(16), toBlock: '0x' + end.toString(16) }]);
      } catch (e) {
        if (e instanceof RpcError && RANGE_RE.test(e.message) && size > 50) { size = Math.max(50, Math.floor(size / 2)); continue; }
        throw e;
      }
      await onPage(logs, end);
      cur = end + 1;
    }
  }
}
