# colour.codes

**Every hash is a colour.** $CCODE is a token on Robinhood Chain (chain id 4663) that is mined with real
proof of work. The contract checks every block itself; nobody can mint, pause or withdraw by hand.

Website: https://colour.codes · X: https://x.com/colourdotcodes · Code: https://github.com/colourdotcodes/colourcodes

## Live on Robinhood Chain (chain id 4663)

| Contract | Address |
| --- | --- |
| $CCODE token (Pons) | [`0xcf595c67A50c423cD663E90f47922c4651f91cd6`](https://robinhoodchain.blockscout.com/token/0xcf595c67A50c423cD663E90f47922c4651f91cd6) |
| ColourcodeMiner | [`0x646721dA9c7E32d401a3FF8FA802edC20E0c0317`](https://repo.sourcify.dev/4663/0x646721dA9c7E32d401a3FF8FA802edC20E0c0317) (verified on Sourcify) |
| ColourcodePool | [`0x3009B1B2560F32CeeD40F67b4b8BE47aff3BA948`](https://repo.sourcify.dev/4663/0x3009B1B2560F32CeeD40F67b4b8BE47aff3BA948) (verified on Sourcify) |

Reserve: 2,928,672 CCODE transferred into the miner, `start()` called in tx
[`0x40b1f926…2404`](https://robinhoodchain.blockscout.com/tx/0x40b1f9263c395b2beaec759bd09d5c9351ba25f170b008c83800f5b78ac22404).
Minimum hold to mine: 100,000 CCODE. Live state: https://colour.codes/api/chain

First mainnet cycle: block #1 [`0x9190fda8…b17d`](https://robinhoodchain.blockscout.com/tx/0x9190fda882801188ab0ee64ffbc0d63b30acf7d625194751175e4b8a0cedb17d), first daily payout (epoch 1, 1,355.87 CCODE to 4 miners) [`0xe2b1bc7b…fa7c`](https://robinhoodchain.blockscout.com/tx/0xe2b1bc7bf634cc7ae04cb83c202b647a4daa182d33b6dc1f56532de2dc1bfa7c), first claim [`0xba7b6555…6b3c`](https://robinhoodchain.blockscout.com/tx/0xba7b65554f92c4c74b8c90c387ee407895c9866c0d4d610706967c8383d56b3c). Every proof in one place: https://colour.codes/verify

`contracts/deploy.mainnet.json` holds these addresses. `contracts/deploy.local.json` is only the local test chain (31337).

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
