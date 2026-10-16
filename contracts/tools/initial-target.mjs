#!/usr/bin/env node
// Initial difficulty target for ColourcodeMiner.
//
//   node contracts/tools/initial-target.mjs <hashrate H/s> [spacing seconds = 600]
//   node contracts/tools/initial-target.mjs 50M          -> 50,000,000 H/s, 10-minute blocks
//   node contracts/tools/initial-target.mjs 2.5G 600
//
// The numbers: a keccak-256 digest is a uniform random 256-bit number, so one hash wins with probability
// target / 2^256. To find one block every `spacing` seconds at `hashrate` H/s the network must try
// hashrate * spacing hashes per block on average, therefore
//     target = 2^256 / (hashrate * spacing)
// Example: 50 browsers x 4 threads x 250 kH/s = 50 MH/s; 50e6 * 600 = 3e10 hashes per block
//          -> target = 2^256 / 3e10 = 0x0000000024a67fcd...
// A guess that is off is corrected by the per-block retarget (each block can move the target by
// x13/16 .. x7/4), and the target can never get easier than 16 x this value (MAX_TARGET).
// Prints the target as a 0x-prefixed 32-byte hex uint256 on stdout (pass it as INITIAL_TARGET);
// the explanation goes to stderr.

const UNITS = { k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12 };

function parseRate(s) {
  const m = /^([0-9]*\.?[0-9]+(?:e[0-9]+)?)([kKMGT]?)(?:H\/s|h\/s|H)?$/.exec(String(s ?? '').trim());
  if (!m) return NaN;
  return Number(m[1]) * (m[2] ? UNITS[m[2]] : 1);
}

const hashrate = parseRate(process.argv[2]);
const spacing = Number(process.argv[3] ?? 600);
if (!(hashrate > 0) || !Number.isInteger(spacing) || spacing < 4) {
  console.error('usage: node initial-target.mjs <hashrate H/s, e.g. 50M> [spacing seconds, default 600]');
  process.exit(1);
}

const hashesPerBlockNum = hashrate * spacing;
if (!Number.isFinite(hashesPerBlockNum) || hashesPerBlockNum > Number.MAX_SAFE_INTEGER) {
  console.error('hashrate * spacing is too large for this tool (> 2^53 hashes per block)');
  process.exit(1);
}
const hashesPerBlock = BigInt(Math.max(1, Math.round(hashesPerBlockNum)));
const TWO_256 = 1n << 256n;
const MAX = TWO_256 - 1n;
let target = TWO_256 / hashesPerBlock;
if (target > MAX) target = MAX;
if (target < 1n) target = 1n;
const maxTarget = target > MAX / 16n ? MAX : target * 16n;
const hex = (x) => '0x' + x.toString(16).padStart(64, '0');

console.error(`hashrate          ${hashrate.toLocaleString('en-US')} H/s`);
console.error(`spacing           ${spacing} s`);
console.error(`hashes per block  ${hashesPerBlock.toLocaleString('en-US')}  (= hashrate x spacing)`);
console.error(`initialTarget     ${target.toString()}  (= 2^256 / hashes per block)`);
console.error(`maxTarget (x16)   ${hex(maxTarget)}`);
console.log(hex(target));
