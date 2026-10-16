// HTTP API (SPEC 5.2). server.mjs calls the default export for every /api/* request.
//
//   GET  /api/chain                 contract state + recent blocks
//   GET  /api/pool/stats            pool totals (real numbers only)
//   GET  /api/pool/job?address=     work for a holder (403 not_holder otherwise)
//   POST /api/pool/share            {address, nonce, challenge[, worker]}
//   GET  /api/pool/me?address=      shares, hashrate, pending, claimable epochs with proofs
//   GET  /api/pool/proof?address=   alias of the claimable part of /me
//   GET  /api/agent/log?since=      narration lines [{t, kind, text}], t = unix ms
//   GET  /api/miner.mjs             the CLI miner itself (so an agent can download and run it)
//
// CORS: read routes are open to any origin. POST /api/pool/share and the job route are same-origin for
// browsers (no CORS headers), so another website cannot quietly mine into this pool from its visitors'
// browsers. Command-line miners and agents are not affected by CORS.
//
// Numbers that can exceed 2^53 (targets, wei amounts) are decimal strings.
// Optional query params: job `worker` (id per browser tab / CLI process) and `hashrate` (H/s hint).
import { readFile } from 'node:fs/promises';
import { App } from './app.mjs';
import { ROOT } from './config.mjs';
import { json, readBody, clientIp } from './util.mjs';

const app = new App();

let flushed = false;
const flushAndExit = (code) => () => {
  if (!flushed) { flushed = true; try { app.flush(); } catch { /* ignore */ } }
  process.exit(code);
};
process.once('SIGINT', flushAndExit(130));
process.once('SIGTERM', flushAndExit(143));
process.once('beforeExit', () => { try { app.flush(); } catch { /* ignore */ } });

const notDeployed = { status: 'not_deployed' };

export default async function api(req, res, url) {
  const path = url.pathname.replace(/\/+$/, '');
  const method = req.method || 'GET';

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET',
      'access-control-max-age': '86400',
    }).end();
    return;
  }

  const ip = clientIp(req, app.cfg.trustProxy);
  const live = Boolean(app.pool);

  switch (`${method} ${path}`) {
    case 'GET /api/chain':
      return json(res, 200, live ? app.chain.snapshot() : notDeployed);

    case 'GET /api/pool/stats':
      return json(res, 200, live ? app.pool.stats() : notDeployed);

    case 'GET /api/pool/job': {
      if (!live) return json(res, 503, notDeployed, {}, { cors: false });
      const [code, body] = await app.pool.job(url.searchParams, ip);
      return json(res, code, body, code === 429 ? { 'retry-after': '5' } : {}, { cors: false });
    }

    case 'POST /api/pool/share': {
      if (!live) return json(res, 503, { ok: false, ...notDeployed }, {}, { cors: false });
      // JSON only: a cross-site form/text post cannot set this header without a (refused) preflight
      if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
        return json(res, 415, { ok: false, error: 'content_type', hint: 'send content-type: application/json' }, {}, { cors: false });
      }
      let body;
      try { body = JSON.parse(await readBody(req, 2048)); }
      catch (e) { return json(res, e.status || 400, { ok: false, error: 'bad_request' }, {}, { cors: false }); }
      const [code, out] = await app.pool.share(body, ip);
      return json(res, code, out, code === 429 ? { 'retry-after': String(out.retryAfter || 5) } : {}, { cors: false });
    }

    case 'GET /api/miner.mjs': {
      const src = await readFile(`${ROOT}miner/colourcode-miner.mjs`);
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', 'access-control-allow-origin': '*' });
      return res.end(src);
    }

    case 'GET /api/pool/me': {
      if (!live) return json(res, 200, notDeployed);
      const [code, body] = await app.pool.me(url.searchParams, ip);
      return json(res, code, body);
    }

    case 'GET /api/pool/proof': {
      if (!live) return json(res, 200, notDeployed);
      const [code, body] = await app.pool.me(url.searchParams, ip);
      return json(res, code, code === 200 ? { address: body.address, pool: body.pool, claimable: body.claimable } : body);
    }

    case 'GET /api/agent/log': {
      // Always an array of real lines (when nothing is deployed the agent says so in one honest line).
      const since = Number(url.searchParams.get('since')) || 0;
      return json(res, 200, app.agent.since(since), { 'x-colourcode-status': app.status });
    }

    default:
      return json(res, 404, { error: 'not_found' });
  }
}
