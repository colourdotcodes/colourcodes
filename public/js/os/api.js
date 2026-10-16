// Talking to the pool server. Every call resolves to a small, honest result:
//   { kind: 'ok' | 'not_ready' | 'not_deployed' | 'not_started' | 'forbidden' | 'error' | 'offline', data, status }
// so every window can show a real state instead of guessing.

export async function getJSON(path, { timeout = 9000, method = 'GET', body } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  let res, data = null;
  try {
    res = await fetch(path, {
      method, signal: ctl.signal, cache: 'no-store',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    clearTimeout(timer);
    return { kind: 'offline', status: 0, data: null, error: e };
  }
  clearTimeout(timer);
  try { data = await res.json(); } catch { data = null; }
  const st = data && typeof data === 'object' ? data.status : undefined;
  if (st === 'api_not_ready' || (res.status === 503 && !st)) return { kind: 'not_ready', status: res.status, data };
  if (st === 'not_deployed') return { kind: 'not_deployed', status: res.status, data };
  if (st === 'not_started') return { kind: 'not_started', status: res.status, data };
  if (res.status === 403) return { kind: 'forbidden', status: res.status, data };
  if (!res.ok || data == null) return { kind: 'error', status: res.status, data };
  return { kind: 'ok', status: res.status, data };
}

// Human copy for the non-ok states (one place, so every app says the same thing).
export function describe(r) {
  switch (r.kind) {
    case 'not_ready': return { icon: 'info', title: 'The pool server is not online yet', text: 'Mining opens at launch. This window will update by itself.' };
    case 'not_deployed': return { icon: 'info', title: 'Contracts are not deployed yet', text: 'Mining opens at launch. Nothing here is simulated, so this stays empty until then.' };
    case 'not_started': return { icon: 'info', title: 'Waiting for the first block', text: 'The miner contract is deployed but the reserve has not been started yet. Mining opens at launch.' };
    case 'offline': return { icon: 'warn', title: 'Cannot reach the server', text: 'Check your connection. Retrying automatically.' };
    case 'forbidden': return { icon: 'warn', title: 'Not allowed', text: (r.data && (r.data.error || r.data.message)) || 'The server refused this request.' };
    default: return { icon: 'error', title: 'Something went wrong', text: `The server answered with HTTP ${r.status || '?'}. Retrying automatically.` };
  }
}

// Visibility-aware poller with back-off on failures. fn must return an api result.
export function poller(fn, interval = 15000, { maxInterval = 60000 } = {}) {
  let timer = 0, stopped = false, wait = interval, running = false;
  const tick = async () => {
    if (stopped) return;
    if (document.hidden) { timer = setTimeout(tick, 2000); return; }
    running = true;
    let r;
    try { r = await fn(); } catch { r = { kind: 'error' }; }
    running = false;
    if (stopped) return;
    wait = r && (r.kind === 'ok' || r.kind === 'not_deployed' || r.kind === 'not_started') ? interval : Math.min(maxInterval, Math.round(wait * 1.6));
    timer = setTimeout(tick, wait);
  };
  tick();
  return {
    stop() { stopped = true; clearTimeout(timer); },
    now() { if (!running) { clearTimeout(timer); wait = interval; tick(); } },
  };
}

export const api = {
  chain: () => getJSON('/api/chain'),
  stats: () => getJSON('/api/pool/stats'),
  me: (address) => getJSON('/api/pool/me?address=' + encodeURIComponent(address)),
  job: (address) => getJSON('/api/pool/job?address=' + encodeURIComponent(address)),
  log: (since) => getJSON('/api/agent/log' + (since != null ? '?since=' + encodeURIComponent(since) : '')),
};
