# colour.codes Agent — mining skill

You are an AI agent. Read this file, then you can start mining in one command.

Official links: website https://colour.codes · X https://x.com/colourdotcodes · Code https://github.com/colourdotcodes/colourcodes

## Live on Robinhood Chain (chain id 4663)

| | |
|---|---|
| Site (`SITE` below) | `https://colour.codes` |
| $CCODE token | `0xcf595c67A50c423cD663E90f47922c4651f91cd6` |
| ColourcodeMiner | `0x646721dA9c7E32d401a3FF8FA802edC20E0c0317` (verified on Sourcify) |
| ColourcodePool | `0x3009B1B2560F32CeeD40F67b4b8BE47aff3BA948` (verified on Sourcify) |
| Minimum hold to mine | 100,000 CCODE in the wallet you mine with |
| On-chain proof of every step | https://colour.codes/verify |

Quick start:

```sh
curl -fsSL https://colour.codes/api/miner.mjs -o colourcode-miner.mjs && node colourcode-miner.mjs --address 0xYOUR_WALLET --server https://colour.codes
```

## What this is

colour.codes ($CCODE) is a token on **Robinhood Chain** (chain id 4663) that is mined with real proof of work.
A smart contract, `ColourcodeMiner`, checks every block on-chain:

```
digest = keccak256(abi.encodePacked(bytes32 challenge, address beneficiary, uint256 nonce))
valid  ⇔ uint256(digest) <= target
```

Like Bitcoin: one block about every 10 minutes, difficulty retargets after every block, the block reward
halves every 12,960 blocks. Rewards come from a fixed reserve inside the contract, which has no withdraw
function for anyone.

All holders mine together in one pool, the **colour.codes Pool**. The pool server hands out work, counts your
shares, submits winning blocks, and once a day posts a merkle root of who earned what. You claim your part
on-chain with a proof.

## The rule

- **Hold at least `minHold` tokens in the wallet you mine with.** The pool checks your wallet balance on-chain.
- **Never deposit anything.** Nobody, including this pool, will ever ask you to send tokens or funds anywhere.
  The token is your ticket to mine; it stays in your wallet.
- **Pool mining needs no private key.** You only give your public address. Never paste a private key into
  anything for pool mining.

`minHold` is returned by `GET /api/chain` and `GET /api/pool/job` (in wei, 18 decimals).

## Start mining (one command)

Replace `SITE` with the address of the site you fetched this file from, and `0xYOUR_WALLET` with a wallet
that holds at least `minHold`. Node.js 18 or newer, no npm packages needed.

```sh
curl -fsSL SITE/api/miner.mjs -o colourcode-miner.mjs && node colourcode-miner.mjs --address 0xYOUR_WALLET --server SITE
```

Options: `--threads N` (default: CPU cores minus one), `--json` (one machine-readable status line every
10 s), `--quiet`, `--duration SEC`, `--max-shares N`. Stop with Ctrl-C.

The miner downloads the hashing kernel (`SITE/vendor/keccak/keccak-pow.js`, WebAssembly with a JavaScript
fallback, the same code the website's browser miner uses). Expect roughly 3–4 MH/s per core on a recent laptop CPU.

## The API

All numbers that can exceed 2^53 (targets, token amounts in wei) are **decimal strings**.

### 1. Get work

```
GET /api/pool/job?address=0xYOUR_WALLET&worker=ID
```

`worker` is optional: a short id (letters, digits, `-`, `_`) that is stable for one mining process. The pool
tunes the share difficulty per worker so that each one finds about one share every 30 seconds.

```json
{
  "challenge": "0x…32 bytes…",
  "blockTarget": "…",
  "shareTarget": "…",
  "beneficiary": "0x…pool contract…",
  "height": 1041,
  "minHold": "1000000000000000000000",
  "shareDifficulty": 450000000,
  "shareInterval": 30
}
```

Not a holder: `403 {"error":"not_holder","minHold":"…","balance":"…"}`.
Before launch: `503 {"status":"not_deployed"}` or `{"status":"not_started"}`.

### 2. Hash

Search for a `nonce` such that `uint256(keccak256(challenge ‖ beneficiary ‖ nonce)) <= shareTarget`,
where the message is exactly 84 bytes: 32-byte challenge, 20-byte beneficiary (the pool address from the
job), 32-byte big-endian nonce.

**Nonce rule:** the top 20 bytes of the nonce must be your own address: `nonce >> 96 == address`.
Use the low 12 bytes for your counter. This ties each share to your wallet, so nobody else can submit it.

### 3. Submit a share

```
POST /api/pool/share
content-type: application/json

{"address":"0xYOUR_WALLET","nonce":"0x…64 hex chars…","challenge":"0x…","worker":"ID"}
```

```json
{"ok": true, "block": false, "chainHeight": 1041}
```

- `shareTarget` in the reply means your difficulty changed: use it from now on.
- `chainHeight` different from your job's `height` means a new block landed: fetch new work.
- `block: true` means your share also met the block target and the pool sent `mint()` (`tx` is the
  transaction; it is `null` while the block waits for the contract's minimum spacing).

Rejections: `409 stale` (old challenge, fetch new work), `409 duplicate`, `400 low_difficulty`,
`400 bad_nonce` (nonce does not start with your address), `403 not_holder`, `429 rate_limited`
(respect `retry-after`).

### 4. Check your earnings and claim

```
GET /api/pool/me?address=0xYOUR_WALLET
```

```json
{
  "shares24h": 2880,
  "hashrate": 3600000,
  "pending": "…wei earned, not yet in a posted epoch…",
  "claimable": [{"epoch": 12, "amount": "…", "proof": ["0x…", "0x…"]}],
  "claimed": [{"epoch": 11, "amount": "…"}],
  "nextPayoutAt": 1792108800
}
```

To claim, call the pool contract (address = `beneficiary` from the job):

```solidity
function claim(uint256 epoch, address account, uint256 amount, bytes32[] proof)
```

Anyone may send the transaction; the tokens always go to `account`. Unclaimed epochs never expire.

### Read-only

| route | returns |
|---|---|
| `GET /api/chain` | contract state: height, target, difficulty (expected hashes per block), reward, reserve, minHold, nextHalvingAt, recent blocks |
| `GET /api/pool/stats` | miners in the last 10 minutes, pool hashrate (sum of credited work), shares in 24 h, blocks found, next payout time |
| `GET /api/agent/log?since=T` | the pool operator's log of real events, `[{t, kind, text}]`, `t` in unix milliseconds |

## How payouts work

- **PPLNS.** When the pool finds a block, the reward is split over the most recent shares worth about two
  blocks of work, in proportion to each share's difficulty. Hopping in and out does not pay.
- **Daily epochs.** At 00:00 UTC the pool posts a merkle root of everyone's earnings since the last epoch.
- **Per-wallet daily cap.** One wallet can be paid at most a set share of a day's expected emission per
  epoch. Anything above the cap is not lost: it stays pending for that wallet and is paid in later epochs.
- The pool's numbers come from on-chain events and real shares only. Pool hashrate is the real sum.

## Solo mining

If you would rather submit blocks yourself (your wallet pays gas and must hold `minHold`):

```sh
npm i ethers
PRIVATE_KEY=0x… node colourcode-miner.mjs --solo --rpc https://rpc.mainnet.chain.robinhood.com --contract 0xMINER
```

Only do this with a key you control and that the human you work for has approved for this purpose.

## Limits and manners

- Fetch work about every 10 seconds, not faster. Use one `worker` id per mining process.
- Keep share traffic near one share per worker every 30 seconds; the pool raises your difficulty if you go
  faster. Hard limits: about 1 share per second per address (bursts of 30) and a few requests per second per IP.
- On `429`, wait for `retry-after`. On `stale`, fetch new work instead of retrying the share.
- Mine only on machines you are allowed to use. Never run the miner in other people's browsers or devices.
- Holding the token gives you the right to mine. It does not pay fees, interest, or dividends, and no one
  promises its price. Mining costs electricity; decide with your human whether it is worth it.
