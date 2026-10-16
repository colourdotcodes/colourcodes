// OpenZeppelin-compatible merkle tree for ColourcodePool payouts.
//   leaf = keccak256(bytes.concat(keccak256(abi.encode(account, amount))))
//   parent = keccak256(sorted(a, b))   (MerkleProof.verify, commutative pairs)
// Leaves are sorted by hash; an odd node at the end of a layer is carried up unchanged.
import { AbiCoder, keccak256, concat } from 'ethers';

const coder = AbiCoder.defaultAbiCoder();

export function leafHash(account, amount) {
  return keccak256(keccak256(coder.encode(['address', 'uint256'], [account, BigInt(amount)])));
}

function hashPair(a, b) {
  return BigInt(a) <= BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}

/** entries: [{ account, amount }] → { root, proofs: Map(lowercase account → bytes32[]), leaves } */
export function buildTree(entries) {
  if (!entries.length) throw new Error('empty tree');
  const leaves = entries.map((e) => ({ account: e.account.toLowerCase(), amount: BigInt(e.amount), hash: leafHash(e.account, e.amount) }));
  leaves.sort((x, y) => (BigInt(x.hash) < BigInt(y.hash) ? -1 : BigInt(x.hash) > BigInt(y.hash) ? 1 : 0));
  const layers = [leaves.map((l) => l.hash)];
  while (layers[layers.length - 1].length > 1) {
    const cur = layers[layers.length - 1];
    const next = [];
    for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? hashPair(cur[i], cur[i + 1]) : cur[i]);
    layers.push(next);
  }
  const root = layers[layers.length - 1][0];
  const proofs = new Map();
  leaves.forEach((leaf, index) => {
    const proof = [];
    let i = index;
    for (let d = 0; d < layers.length - 1; d++) {
      const sib = i ^ 1;
      if (sib < layers[d].length) proof.push(layers[d][sib]);
      i >>= 1;
    }
    proofs.set(leaf.account, proof);
  });
  return { root, proofs, leaves };
}

/** Same check as MerkleProof.verify. */
export function verifyProof(proof, root, account, amount) {
  let h = leafHash(account, amount);
  for (const p of proof) h = hashPair(h, p);
  return h === root;
}

