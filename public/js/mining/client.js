/* colour.codes Agent — browser mining client (SPEC 5.3). Classic script, no modules.
 *
 *   ColourcodeMining.supported()                 → boolean
 *   ColourcodeMining.start({ address, threads }) → Promise<void>  resolves once workers are hashing;
 *                                                rejects (err.code = state status) if the pool refuses
 *   ColourcodeMining.stop()
 *   ColourcodeMining.running                     → boolean
 *   ColourcodeMining.on(event, fn)               → returns an unsubscribe function
 *       'stats' { hashrate, threads, shares, accepted, rejected, blocks, engine, height }   every second
 *       'state' { status, message }   status: connecting | mining | not_deployed | not_started | not_holder |
 *                                     paused | offline | rate_limited | error | stopped
 *       'block' { height, tx }        one of your shares won a block (tx null while queued for min spacing)
 *   extras: ColourcodeMining.maxThreads(), ColourcodeMining.api (base URL, default same origin)
 *
 * Work: GET /api/pool/job, hash keccak256(challenge ‖ pool ‖ nonce) in Web Workers, POST shares to
 * /api/pool/share. The top 20 bytes of every nonce are your address, so a share only ever counts for you.
 * No keys, no signatures, no deposits: the pool only needs your address and checks you hold minHold.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  var BASE = new URL('.', (script && script.src) || location.href).href;
  var ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
  var JOB_POLL_MS = 10000;

  var listeners = {};
  var S = null;   // current session

  var api = {
    api: ((window.COLOURCODE && window.COLOURCODE.api) || '').replace(/\/+$/, ''),
    supported: supported,
    start: start,
    stop: stop,
    on: on,
    maxThreads: maxThreads,
  };
  Object.defineProperty(api, 'running', { enumerable: true, get: function () { return !!(S && S.started); } });

  function on(event, fn) {
    (listeners[event] = listeners[event] || []).push(fn);
    return function () {
      var a = listeners[event] || [];
      var i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    };
  }

  function emit(event, data) {
    var a = (listeners[event] || []).slice();
    for (var i = 0; i < a.length; i++) {
      try { a[i](data); } catch (e) { if (window.console) console.error(e); }
    }
  }

  function setState(status, message, extra) {
    var o = { status: status, message: message };
    if (extra) for (var k in extra) o[k] = extra[k];
    if (S) S.status = status;
    emit('state', o);
  }

  function supported() {
    try {
      return typeof Worker === 'function' && typeof BigInt === 'function' && typeof fetch === 'function' &&
        typeof MessageChannel === 'function' && !!(window.crypto && crypto.getRandomValues);
    } catch (e) { return false; }
  }

  function maxThreads() { return Math.max(1, Math.min(32, navigator.hardwareConcurrency || 2)); }

  function randomHex(bytes) {
    var u = crypto.getRandomValues(new Uint8Array(bytes)), s = '';
    for (var i = 0; i < u.length; i++) s += (u[i] < 16 ? '0' : '') + u[i].toString(16);
    return s;
  }

  function request(path, init) {
    return fetch(api.api + path, Object.assign({ cache: 'no-store' }, init || {})).then(function (r) {
      return r.text().then(function (t) {
        var body = null;
        try { body = t ? JSON.parse(t) : null; } catch (e) { body = null; }
        return { status: r.status, body: body || {} };
      });
    });
  }

  function tokens(wei) {
    try {
      var dec = 18, v = BigInt(wei), whole = v / (10n ** BigInt(dec));
      return whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    } catch (e) { return String(wei); }
  }

  /** Map a non-200 job/share reply to a state. */
  function refusal(r) {
    var b = r.body || {};
    if (r.status === 403 || b.error === 'not_holder') {
      return { status: 'not_holder', message: 'Hold at least ' + tokens(b.minHold) + ' tokens in this wallet to mine.', extra: { minHold: b.minHold, balance: b.balance } };
    }
    if (b.status === 'not_deployed') return { status: 'not_deployed', message: 'Mining opens at launch.' };
    if (b.status === 'not_started') return { status: 'not_started', message: 'The miner contract is deployed but mining has not started yet.' };
    if (b.status === 'operator_missing') return { status: 'paused', message: 'The pool cannot submit blocks right now. Waiting.' };
    if (b.status === 'syncing' || b.status === 'rpc_unavailable' || b.status === 'api_not_ready') return { status: 'paused', message: 'The pool is syncing with the chain. Waiting.' };
    if (r.status === 429) return { status: 'rate_limited', message: 'Too many requests. Slowing down.' };
    if (r.status === 400 && b.error === 'bad_address') return { status: 'error', message: 'Enter a valid wallet address.' };
    return { status: 'error', message: 'Pool error (' + r.status + ').' };
  }

  function jobQuery(s) {
    var q = '/api/pool/job?address=' + s.address + '&worker=' + s.workerId;
    if (s.hashrate > 0) q += '&hashrate=' + Math.round(s.hashrate);
    return q;
  }

  function sendJob(s, w, i) {
    w.postMessage({
      type: 'job',
      challenge: s.job.challenge,
      beneficiary: s.job.beneficiary,
      prefix: s.prefix,
      mid: (i << 24) >>> 0,
      shareTarget: s.job.shareTarget,
      blockTarget: s.job.blockTarget,
    });
  }

  function applyJob(s, job) {
    var newWork = !s.job || s.job.challenge !== job.challenge;
    var newTarget = !s.job || s.job.shareTarget !== job.shareTarget || s.job.blockTarget !== job.blockTarget;
    s.job = job;
    if (newWork) {
      s.queue = s.queue.filter(function (q) { return q.challenge === job.challenge; });
      for (var i = 0; i < s.workers.length; i++) sendJob(s, s.workers[i], i);
    } else if (newTarget) {
      for (var j = 0; j < s.workers.length; j++) s.workers[j].postMessage({ type: 'target', shareTarget: job.shareTarget, blockTarget: job.blockTarget });
    }
    if (s.paused) {
      s.paused = false;
      for (var k = 0; k < s.workers.length; k++) sendJob(s, s.workers[k], k);
      setState('mining', 'Mining block ' + (job.height + 1) + '.');
    }
  }

  function pause(s, st) {
    if (!s.paused) {
      s.paused = true;
      for (var i = 0; i < s.workers.length; i++) s.workers[i].postMessage({ type: 'pause' });
    }
    s.rates = s.rates.map(function () { return 0; });
    setState(st.status, st.message, st.extra);
  }

  function pollJob(s) {
    if (S !== s || s.polling) return;
    s.polling = true;
    request(jobQuery(s)).then(function (r) {
      s.polling = false;
      if (S !== s) return;
      if (r.status === 200) {
        var before = s.job && s.job.challenge;
        applyJob(s, r.body);
        if (before && before !== r.body.challenge && s.status === 'mining') setState('mining', 'New block on chain. Mining block ' + (r.body.height + 1) + '.');
        else if (s.status !== 'mining' && !s.paused) setState('mining', 'Mining block ' + (r.body.height + 1) + '.');
        return;
      }
      var st = refusal(r);
      if (st.status === 'not_holder' || st.status === 'not_deployed') { stop(st); return; }
      if (st.status === 'rate_limited') { setState(st.status, st.message); return; }
      pause(s, st);
    }, function () {
      s.polling = false;
      if (S === s) pause(s, { status: 'offline', message: 'Cannot reach the pool. Retrying.' });
    });
  }

  function pumpShares(s) {
    if (S !== s) return;
    while (s.inflight < 2 && s.queue.length && Date.now() >= s.holdUntil) {
      submit(s, s.queue.shift());
    }
  }

  function submit(s, share) {
    s.inflight++;
    request('/api/pool/share', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: s.address, nonce: share.nonce, challenge: share.challenge, worker: s.workerId }),
    }).then(function (r) {
      s.inflight--;
      if (S !== s) return;
      var b = r.body || {};
      if (r.status === 200 && b.ok) {
        s.accepted++;
        if (b.shareTarget && s.job) {
          s.job.shareTarget = b.shareTarget;
          for (var i = 0; i < s.workers.length; i++) s.workers[i].postMessage({ type: 'target', shareTarget: b.shareTarget, blockTarget: s.job.blockTarget });
        }
        if (b.block) {
          s.blocks++;
          emit('block', { height: b.height || (s.job ? s.job.height + 1 : null), tx: b.tx || null, queued: !!b.queued });
          setTimeout(function () { pollJob(s); }, 1500);
          setTimeout(function () { pollJob(s); }, 4000);
        } else if (s.job && typeof b.chainHeight === 'number' && b.chainHeight !== s.job.height) {
          pollJob(s);   // the chain moved on: fetch the new work now
        }
      } else if (r.status === 429) {
        s.holdUntil = Date.now() + 1000 * (Number(b.retryAfter) || 5);
        if (share.tries++ < 3) s.queue.unshift(share);
        setState('rate_limited', 'The pool asked to slow down.');
        setTimeout(function () { if (S === s && s.status === 'rate_limited') setState('mining', 'Mining.'); pumpShares(s); }, s.holdUntil - Date.now() + 50);
      } else if (r.status === 403) {
        s.rejected++;
        stop(refusal(r));
        return;
      } else if (r.status === 503) {
        pause(s, refusal(r));
      } else {
        s.rejected++;
        if (b.error === 'stale' || b.error === 'low_difficulty') pollJob(s);
      }
      pumpShares(s);
    }, function () {
      s.inflight--;
      if (S !== s) return;
      if (share.tries++ < 2) s.queue.unshift(share);
      s.holdUntil = Date.now() + 3000;
      setTimeout(function () { pumpShares(s); }, 3100);
    });
  }

  function onWorkerMessage(s, i, e) {
    if (S !== s) return;
    var m = e.data || {};
    if (m.type === 'rate') {
      s.rates[i] = m.ms > 0 ? (m.hashes * 1000) / m.ms : 0;
    } else if (m.type === 'share') {
      if (!s.job || m.challenge !== s.job.challenge) return;   // work for an old block
      s.shares++;
      s.queue.push({ nonce: m.nonce, challenge: m.challenge, tries: 0 });
      if (s.queue.length > 64) s.queue.splice(0, s.queue.length - 64);
      pumpShares(s);
    } else if (m.type === 'ready') {
      s.engine = m.engine;
    } else if (m.type === 'error') {
      if (window.console) console.warn('[mining] worker:', m.message);
    }
  }

  function emitStats(s) {
    var sum = 0;
    for (var i = 0; i < s.rates.length; i++) sum += s.rates[i] || 0;
    s.hashrate = s.paused ? 0 : (s.hashrate > 0 ? s.hashrate * 0.6 + sum * 0.4 : sum);
    emit('stats', {
      hashrate: Math.round(s.hashrate), threads: s.threads, shares: s.shares, accepted: s.accepted,
      rejected: s.rejected, blocks: s.blocks, engine: s.engine, height: s.job ? s.job.height : null,
    });
  }

  function start(opts) {
    opts = opts || {};
    if (S) stop();
    var address = String(opts.address || '').trim();
    if (!ADDR_RE.test(address)) {
      setState('error', 'Enter a valid wallet address.');
      return Promise.reject(Object.assign(new Error('invalid address'), { code: 'error' }));
    }
    if (!supported()) {
      setState('error', 'This browser cannot run the miner (needs Web Workers and BigInt).');
      return Promise.reject(Object.assign(new Error('unsupported'), { code: 'error' }));
    }
    var threads = Math.max(1, Math.min(maxThreads(), Math.floor(Number(opts.threads) || Math.max(1, maxThreads() - 1))));
    var workerId = randomHex(4);
    var s = S = {
      address: address.toLowerCase(), threads: threads, workerId: workerId,
      prefix: '0x' + address.toLowerCase().slice(2) + workerId,
      workers: [], rates: [], job: null, queue: [], inflight: 0, holdUntil: 0,
      shares: 0, accepted: 0, rejected: 0, blocks: 0, hashrate: 0, engine: '',
      started: false, paused: false, polling: false, status: '', timers: [],
    };
    setState('connecting', 'Asking the pool for work.');
    return request(jobQuery(s)).then(function (r) {
      if (S !== s) return;
      if (r.status !== 200) {
        var st = refusal(r);
        S = null;
        setState(st.status, st.message, st.extra);
        throw Object.assign(new Error(st.message), { code: st.status });
      }
      s.job = r.body;
      for (var i = 0; i < threads; i++) {
        var w = new Worker(BASE + 'worker.js');
        w.onmessage = onWorkerMessage.bind(null, s, i);
        w.onerror = function (ev) { if (window.console) console.warn('[mining] worker error', ev.message); };
        s.workers.push(w);
        s.rates.push(0);
        sendJob(s, w, i);
      }
      s.started = true;
      s.timers.push(setInterval(function () { pollJob(s); }, JOB_POLL_MS));
      s.timers.push(setInterval(function () { emitStats(s); }, 1000));
      setState('mining', 'Mining block ' + (s.job.height + 1) + '.');
      emitStats(s);
    }, function (err) {
      if (S !== s) return;
      S = null;
      setState('offline', 'Cannot reach the pool.');
      throw Object.assign(new Error('network'), { code: 'offline', cause: err });
    });
  }

  function stop(reason) {
    var s = S;
    if (!s) return;
    S = null;
    for (var i = 0; i < s.timers.length; i++) clearInterval(s.timers[i]);
    for (var j = 0; j < s.workers.length; j++) {
      try { s.workers[j].postMessage({ type: 'stop' }); s.workers[j].terminate(); } catch (e) { /* gone */ }
    }
    s.started = false;
    s.hashrate = 0;
    s.rates = [];
    emit('stats', { hashrate: 0, threads: 0, shares: s.shares, accepted: s.accepted, rejected: s.rejected, blocks: s.blocks, engine: s.engine, height: s.job ? s.job.height : null });
    if (reason && reason.status) setState(reason.status, reason.message, reason.extra);
    else setState('stopped', 'Stopped.');
  }

  window.ColourcodeMining = api;
})();
