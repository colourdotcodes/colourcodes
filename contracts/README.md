# colour.codes contracts

Two small contracts on Robinhood Chain (chain id 4663). Foundry project, Solidity 0.8.26, OpenZeppelin 5.1.

## How it works

**ColourcodeMiner** is a keyless vault that pays out the block-reward reserve to whoever finds proof of work.

- The owner transfers the reserve (from the launch bundle) into the contract, then the deployer calls `start()` once.
  `start()` fixes `initialReward = reserve / (2 * halvingInterval)`, so the whole halving series adds up to about the reserve.
  After that nobody has any power: no withdraw, no pause, no setters, no owner.
- To mine, find a `nonce` such that

  ```
  digest = keccak256(abi.encodePacked(challenge, beneficiary, nonce))   // bytes32 ++ address ++ uint256 = 84 bytes
  uint256(digest) <= target
  ```

  and call `mint(nonce, beneficiary)`. The beneficiary is inside the hash, so a copied nonce is useless to anyone else
  (submitting it can only pay the original beneficiary).
- The wallet that calls `mint` must hold at least `minHold` tokens (checked live with `balanceOf`, nothing is deposited).
- At most one block every `minSpacing` seconds.
- Reward = `initialReward >> (height / halvingInterval)`, capped at what is left in the vault. When it reaches 0,
  `mint` reverts with `EmissionComplete` and the leftover dust stays in the vault forever.
- Difficulty is retargeted **every block**, damped:
  `dt = clamp(now - lastBlockTime, T/4, 4T)`, `target = target * (3T + dt) / (4T)`.
  One block can make mining at most 1.75x easier or 1.23x harder (x13/16). The target never goes above
  `MAX_TARGET = 16 x initialTarget` and never below 1. The multiply is done with 512-bit `mulDiv`, no overflow.
- After every block: `challenge = keccak256(abi.encodePacked(challenge, digest, height))`, `height++`, event `Mined`.
- The first challenge is `keccak256(abi.encode(chainId, keccak256(bytes(genesisMessage))))`: fixed and public.
- `state()` returns everything a miner needs in one call. Extra views: `nextTarget(target, elapsed)`,
  `digestOf(beneficiary, nonce)`, `nextHalvingAt()`, `initialReward()`, and the parameters in capitals
  (`TARGET_SPACING()`, `HALVING_INTERVAL()`, `INITIAL_TARGET()`, `MAX_TARGET()`, `MIN_HOLD()`, `MIN_SPACING()`,
  `DEPLOYER()`, `GENESIS_CHALLENGE()`).

**ColourcodePool** holds the rewards of pool miners (it is the `beneficiary` the pool server mines to).

- The operator (pool server wallet, fixed forever at deployment) posts `postEpoch(epoch, root, total)`.
  `total` must be <= `unallocated()` (pool balance minus everything allocated and not yet claimed).
  An epoch number can be posted only once.
- Anyone can submit `claim(epoch, account, amount, proof)`; the tokens always go to `account`. Once per account per epoch,
  and an epoch can never pay out more than its posted `total`.
- Leaf = `keccak256(bytes.concat(keccak256(abi.encode(account, amount))))`, sorted-pair tree
  (same as OpenZeppelin `StandardMerkleTree.of(values, ["address","uint256"])`).
- No other way out: no withdraw, no sweep, no operator change. Unclaimed amounts stay reserved for their owner forever.

## Parameters

| name | meaning | production plan |
|---|---|---|
| `TARGET_SPACING` | seconds per block (T) | 600 |
| `HALVING_INTERVAL` | blocks per reward era | 12,960 (about 90 days) |
| `INITIAL_TARGET` | launch difficulty | from `tools/initial-target.mjs` |
| `MIN_HOLD` | tokens the submitter must hold | owner decides |
| `MIN_SPACING` | minimum seconds between blocks | 60 |
| `GENESIS_MESSAGE` | genesis headline, fixed forever | owner decides |
| `POOL_OPERATOR` | pool server wallet | owner decides (must also hold `MIN_HOLD`) |

```
node tools/initial-target.mjs 50M 600     # expected network H/s, spacing -> prints 0x... target
```

## Commands

```
forge build && node export-abi.mjs        # ABIs -> server/abi/*.json and public/js/abi.js
forge test                                # unit + fuzz tests (fork test is skipped)
forge test --gas-report

# fork test against Robinhood Chain (local anvil fork; ALWAYS pass --block-time or anvil fills the disk)
anvil --fork-url https://robinhood.drpc.org --chain-id 4663 --port 8547 --block-time 1
FORK_URL=http://127.0.0.1:8547 forge test --match-contract ForkTest -vv
lsof -tiTCP:8547 -sTCP:LISTEN | xargs kill  # stop that anvil when done
```

### Local development chain

```
anvil --port 8545 --block-time 1
forge script script/Local.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
forge script script/MineLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast   # mine one block to the pool
```

`Local.s.sol` deploys a mock token, the miner and the pool with the public anvil keys (account #0 deployer,
account #1 pool operator; accounts #0..#7 hold 1,000,000 mock tokens, #8 and #9 hold none), funds and starts the miner,
and writes `deploy.local.json`. On a fresh anvil the addresses are always the same. Local defaults are faster than
production (T = 60 s, minSpacing = 10 s, target for about 200 kH/s); override with the same env names as below.

## Mainnet deploy (later, by the owner)

1. Launch the token on Pons. Pick `MIN_HOLD`, the reserve size, the genesis message, the pool operator wallet,
   and the initial target (`node tools/initial-target.mjs <expected H/s>`).
2. Deploy with a keystore or hardware wallet (never a plain private key in a file):

   ```
   TOKEN=0x... INITIAL_TARGET=0x... MIN_HOLD=100000 GENESIS_MESSAGE="..." POOL_OPERATOR=0x... \
   TARGET_SPACING=600 HALVING_INTERVAL=12960 MIN_SPACING=60 CONFIRM_MAINNET=true \
   forge script script/Deploy.s.sol --rpc-url https://rpc.mainnet.chain.robinhood.com --account <name> --broadcast
   ```

   `MIN_HOLD` is in whole tokens (the script multiplies by `decimals()`). Deploy with a normal transaction from the
   wallet, not through a CREATE2 factory, because that wallet becomes `DEPLOYER` (the only one who can `start()`).
3. Transfer the reserve tokens to the miner address.
4. `MINER=0x... CONFIRM_MAINNET=true forge script script/Start.s.sol --rpc-url ... --account <name> --broadcast`
   (same wallet as step 2). From this moment the deployer has no powers.
5. Put the miner and pool addresses in `public/config.js` and the server config.

Note: anyone can compute block 1 in advance because the genesis challenge is public (one block reward, like
Bitcoin's genesis being known). Every later challenge depends on the previous block.
