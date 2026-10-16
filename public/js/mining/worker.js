/* colour.codes — mining worker (one per thread). Started by client.js.
 *
 * in : {type:'job', challenge, beneficiary, prefix, mid, shareTarget, blockTarget}
 *        prefix = nonce bytes 0..23 (your address + a 4-byte session id), mid = nonce bytes 24..27 start
 *      {type:'target', shareTarget, blockTarget}     new share difficulty, same work
 *      {type:'pause'} / {type:'stop'}
 * out: {type:'ready', engine}
 *      {type:'rate', hashes, ms}                      about once per second
 *      {type:'share', challenge, nonce, digest, block}  every digest <= shareTarget, checked twice
 *      {type:'error', message}
 */
/* global importScripts, ColourcodePow, keccak256 */
'use strict';

importScripts('../../vendor/keccak/keccak-pow.js', '../../vendor/keccak/sha3.js');

var P = self.ColourcodePow;
var searcher = null;
var job = null;            // { challenge, beneficiary, prefix, msg: Uint8Array(84) }
var shareTarget = 0n, blockTarget = 0n, tgtTop = 0;
var mid = 0, lo = 0;
var running = false;
var chunk = 4096;
var hashes = 0, lastReport = 0;

var tick = new MessageChannel();       // zero-delay yield between chunks (no setTimeout clamping)
tick.port1.onmessage = step;
function schedule() { tick.port2.postMessage(0); }

function hexBytes(h) {
  h = h.replace(/^0x/, '');
  var u = new Uint8Array(h.length / 2);
  for (var i = 0; i < u.length; i++) u[i] = parseInt(h.substr(2 * i, 2), 16);
  return u;
}

function setTargets(share, block) {
  shareTarget = BigInt(share);
  blockTarget = BigInt(block);
  var top = shareTarget >> 224n;
  tgtTop = top > 0xffffffffn ? 0xffffffff : Number(top);
}

function setJob(m) {
  if (!searcher) {
    try { searcher = P.createSearcher(); }
    catch (e) { postMessage({ type: 'error', message: String(e && e.message || e) }); return false; }
    postMessage({ type: 'ready', engine: searcher.engine });
  }
  setTargets(m.shareTarget, m.blockTarget);
  var same = job && job.challenge === m.challenge && job.prefix === m.prefix && job.beneficiary === m.beneficiary;
  if (!same) {
    var c = hexBytes(m.challenge), b = hexBytes(m.beneficiary), p = hexBytes(m.prefix);
    var msg = new Uint8Array(84);
    msg.set(c, 0); msg.set(b, 32); msg.set(p, 52);
    job = { challenge: m.challenge, beneficiary: m.beneficiary, prefix: m.prefix, msg: msg };
    searcher.setBase(P.makeBase(c, b, p));
    mid = m.mid >>> 0;
    lo = 0;
  }
  return true;
}

function hex(n, bytes) { var s = n.toString(16); while (s.length < bytes * 2) s = '0' + s; return s; }

function onHit(hitLo, digestBytes) {
  // independent check with js-sha3 over the full 84-byte message
  var msg = job.msg;
  msg[76] = mid >>> 24; msg[77] = (mid >>> 16) & 255; msg[78] = (mid >>> 8) & 255; msg[79] = mid & 255;
  msg[80] = hitLo >>> 24; msg[81] = (hitLo >>> 16) & 255; msg[82] = (hitLo >>> 8) & 255; msg[83] = hitLo & 255;
  var d = keccak256(msg);
  if (d !== P.toHex(digestBytes)) { postMessage({ type: 'error', message: 'kernel/js-sha3 digest mismatch' }); return; }
  var dv = BigInt('0x' + d);
  if (dv > shareTarget) return;    // only the top 32 bits matched
  var nonce = '0x' + job.prefix.replace(/^0x/, '') + hex(mid, 4) + hex(hitLo, 4);
  postMessage({ type: 'share', challenge: job.challenge, nonce: nonce, digest: '0x' + d, block: dv <= blockTarget });
}

function step() {
  if (!running || !job) return;
  var t0 = performance.now();
  var room = 4294967296 - lo;
  var n = searcher.search(mid, lo, chunk < room ? chunk : room, tgtTop);
  for (var k = 0; k < searcher.hits; k++) onHit(searcher.hitLo(k), searcher.hitDigest(k));
  lo += n;
  if (lo >= 4294967296) { lo = 0; mid = (mid + 1) >>> 0; }
  hashes += n;
  var t1 = performance.now(), dt = t1 - t0;
  if (dt < 25 && chunk < 4194304) chunk *= 2;
  else if (dt > 100 && chunk > 256) chunk >>= 1;
  if (t1 - lastReport >= 1000) {
    postMessage({ type: 'rate', hashes: hashes, ms: t1 - lastReport });
    hashes = 0; lastReport = t1;
  }
  schedule();
}

onmessage = function (e) {
  var m = e.data || {};
  if (m.type === 'job') {
    if (!setJob(m)) return;
    if (!running) { running = true; hashes = 0; lastReport = performance.now(); schedule(); }
  } else if (m.type === 'target') {
    setTargets(m.shareTarget, m.blockTarget);
  } else if (m.type === 'pause') {
    running = false;
  } else if (m.type === 'stop') {
    running = false;
    self.close();
  }
};
