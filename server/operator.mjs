// The pool operator wallet: signs mint() and postEpoch() locally, broadcasts through the primary RPC only.
// The private key lives in a module-private variable (from OPERATOR_KEY in .env) and is never attached to
// an object, returned, or logged.
import { Wallet } from 'ethers';
import { operatorKey } from './config.mjs';
import { sleep } from './util.mjs';

let wallet = null;     // module private
let walletKeyFingerprint = '';

function loadWallet() {
  const k = operatorKey();
  const fp = k ? k.slice(-6) : '';
  if (fp !== walletKeyFingerprint) {
    wallet = k ? new Wallet(k) : null;
    walletKeyFingerprint = fp;
  }
  return wallet;
}

export class Operator {
  constructor(cfg, rpc) {
    this.cfg = cfg;
    this.rpc = rpc;
    this.queue = Promise.resolve();
    loadWallet();
  }

  get ready() { return Boolean(loadWallet()); }
  get address() { const w = loadWallet(); return w ? w.address.toLowerCase() : ''; }

  /** Sign and broadcast one transaction. Serialized so nonces never collide. Returns the tx hash. */
  send(to, data, { gasFloor = 0n } = {}) {
    const run = async () => {
      const w = loadWallet();
      if (!w) throw new Error('operator key missing');
      const from = w.address;
      const [nonceHex, gasPriceHex, gasHex] = await Promise.all([
        this.rpc.call('eth_getTransactionCount', [from, 'pending']),
        this.rpc.call('eth_gasPrice'),
        this.rpc.call('eth_estimateGas', [{ from, to, data }]),
      ]);
      const gasPrice = BigInt(gasPriceHex);
      let gasLimit = (BigInt(gasHex) * 13n) / 10n + 10000n;
      if (gasLimit < gasFloor) gasLimit = gasFloor;
      const tx = {
        type: 2,
        chainId: this.cfg.chainId,
        nonce: Number(BigInt(nonceHex)),
        to,
        data,
        value: 0n,
        gasLimit,
        maxFeePerGas: gasPrice * 2n + 1n,
        maxPriorityFeePerGas: 0n,
      };
      const raw = await w.signTransaction(tx);
      return await this.rpc.call('eth_sendRawTransaction', [raw], { write: true });
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  /** Poll for a receipt. Resolves { status, blockNumber } or null on timeout. */
  async wait(hash, timeoutMs = 120000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      try {
        const r = await this.rpc.call('eth_getTransactionReceipt', [hash]);
        if (r) return { status: Number(BigInt(r.status)), blockNumber: Number(BigInt(r.blockNumber)), gasUsed: BigInt(r.gasUsed) };
      } catch { /* retry */ }
      await sleep(1000);
    }
    return null;
  }

  async ethBalance() {
    if (!this.ready) return 0n;
    return BigInt(await this.rpc.call('eth_getBalance', [this.address, 'latest']));
  }
}
