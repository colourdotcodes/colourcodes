// The fixed contract interface (SPEC 5.1) as ethers fragments, plus optional views and custom errors
// used only to decode reverts. server/abi/*.json (contracts agent) stays the source of truth for the site.
import { Interface } from 'ethers';

export const minerIface = new Interface([
  'function start()',
  'function mint(uint256 nonce, address beneficiary) returns (uint256 reward)',
  'function state() view returns (bytes32 challenge, uint256 target, uint256 height, uint256 reward, uint256 lastBlockTime, uint256 reserve, uint256 minHold, uint256 minSpacing, uint256 startTime, bool started)',
  'function token() view returns (address)',
  'function genesisMessage() view returns (string)',
  // optional views (present in the current contract; the server falls back to config if missing)
  'function HALVING_INTERVAL() view returns (uint256)',
  'function TARGET_SPACING() view returns (uint256)',
  'function MAX_TARGET() view returns (uint256)',
  'function INITIAL_TARGET() view returns (uint256)',
  'function initialReward() view returns (uint256)',
  'event Started(uint256 initialReward, uint256 reserve, uint256 startTime)',
  'event Mined(uint256 indexed height, address indexed miner, address indexed beneficiary, uint256 reward, bytes32 digest, uint256 newTarget, uint256 timestamp)',
  'error NotStarted()',
  'error ZeroBeneficiary()',
  'error TooEarly(uint256 earliest)',
  'error NotHolder(uint256 balance, uint256 minHold)',
  'error HashAboveTarget(bytes32 digest, uint256 target)',
  'error EmissionComplete()',
]);

export const poolIface = new Interface([
  'function postEpoch(uint256 epoch, bytes32 root, uint256 total)',
  'function claim(uint256 epoch, address account, uint256 amount, bytes32[] proof)',
  'function claimed(uint256 epoch, address account) view returns (bool)',
  'function unallocated() view returns (uint256)',
  'function operator() view returns (address)',
  'function epochRoot(uint256 epoch) view returns (bytes32)',
  'event EpochPosted(uint256 indexed epoch, bytes32 root, uint256 total)',
  'event Claimed(uint256 indexed epoch, address indexed account, uint256 amount)',
  'error NotOperator()',
  'error EpochExists(uint256 epoch)',
  'error OverAllocation(uint256 total, uint256 unallocated)',
  'error InvalidParameter()',
]);

export const erc20Iface = new Interface([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);

export const MINED_TOPIC = minerIface.getEvent('Mined').topicHash;

/** Best-effort name of a custom error from revert data (RpcError.data). */
export function revertName(data) {
  if (typeof data !== 'string' || data.length < 10) return '';
  for (const iface of [minerIface, poolIface]) {
    try { const e = iface.parseError(data); if (e) return e.name; } catch { /* next */ }
  }
  return '';
}

export function decodeMined(log) {
  const ev = minerIface.parseLog({ topics: log.topics, data: log.data });
  return {
    height: Number(ev.args.height),
    miner: ev.args.miner.toLowerCase(),
    beneficiary: ev.args.beneficiary.toLowerCase(),
    reward: ev.args.reward.toString(),
    digest: ev.args.digest,
    newTarget: ev.args.newTarget.toString(),
    timestamp: Number(ev.args.timestamp),
    tx: log.transactionHash,
    block: Number(BigInt(log.blockNumber)),
    logIndex: Number(BigInt(log.logIndex)),
  };
}
