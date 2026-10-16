# colour.codes

**Every hash is a colour.** $CCODE is a token on Robinhood Chain (chain id 4663) that is mined with real
proof of work. The contract checks every block itself; nobody can mint, pause or withdraw by hand.

Website: https://colour.codes · X: https://x.com/colourdotcodes

## How it works

- **Holders mine, nothing is deposited.** To submit a block you must hold at least `minHold` $CCODE in your
  wallet. The contract reads your balance; it never takes custody of it.
- **Real proof of work.** A block is valid when
  `keccak256(abi.encodePacked(challenge, beneficiary, nonce)) <= target`. The beneficiary is inside the hash,
  so a copied nonce can only ever pay the original miner.
- **Bitcoin-style schedule.** About one block every 10 minutes, difficulty retargets after every block, and the
  reward halves every 12,960 blocks. Rewards come from a fixed reserve held by the contract, which has no
  withdraw function for anyone.
- **One pool for everyone.** The pool server hands out work, counts shares, submits winning blocks and posts a
  daily merkle root. Each miner claims their part on-chain with a proof.

The full design is in [contracts/README.md](contracts/README.md).

## Repository

| Path | What it is |
| --- | --- |
| `contracts/` | `ColourcodeMiner` and `ColourcodePool` (Foundry, Solidity 0.8.26, OpenZeppelin 5.1) with tests |
| `server/`, `server.mjs` | Website server, pool server and API (Node, one dependency: ethers) |
| `miner/colourcode-miner.mjs` | CLI miner for people and AI agents, one file |
| `public/` | The website: the room, the retro OS, the browser miner (WASM keccak) |
| `public/skill.md` | Instructions an AI agent reads to start mining |
| `tools/e2e-mining.mjs` | End-to-end test: local chain, contracts, pool, CLI miner, claims |

## Run it locally

Requires Node 22+ and [Foundry](https://getfoundry.sh).

```sh
npm install
npm run serve             # http://127.0.0.1:9070
cd contracts
forge install foundry-rs/forge-std@v1.17.0 OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-git
forge test
cd ..
npm run test:e2e          # starts a local anvil chain and mines real blocks against it
```

## Mine from the command line

```sh
node miner/colourcode-miner.mjs --address 0xYourWallet --server https://colour.codes
```

Pool mode needs no private key. Run `node miner/colourcode-miner.mjs --help` for every option.

## Licence

MIT. See [LICENSE](LICENSE).
