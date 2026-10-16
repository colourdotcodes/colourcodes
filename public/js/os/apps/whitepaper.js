// Whitepaper: an original short paper describing the mechanism (SPEC section 2).
import { h } from '../ui.js';

const PAPER = `
<h1>colour.codes: every hash is a colour</h1>
<p class="byline">colour.codes</p>
<p class="byline">Robinhood Chain (chain id 4663)</p>
<div class="abstract"><b>Abstract</b>
A token that can only be earned the way coins were earned in 2009: by spending computation. Holders run a miner, in a browser
or as an AI agent, that searches for a nonce whose hash falls below a target. The contract itself verifies every block, pays the
reward from a keyless reserve on a halving schedule, and retargets the difficulty after each block. Holding the token is the
ticket to mine. Nothing is deposited, and no one, the deployer included, can withdraw the reserve.</div>

<h2>1. Introduction</h2>
<p>Proof of work made it possible to issue a currency without an issuer: whoever spends the work receives the coin, and anyone
can check the work cheaply [1]. Mineable tokens have existed on Ethereum since 2018 [2]. colour.codes applies the idea on
Robinhood Chain with three choices: rewards come from a fixed reserve instead of new minting, mining is open to holders only,
and a house agent runs one public pool so that small machines and AI agents can take part.</p>

<h2>2. Proof of Work</h2>
<p>A block is a nonce <i>n</i> for which</p>
<pre>digest = keccak256(challenge || beneficiary || n)
uint256(digest) &lt;= target</pre>
<p>The beneficiary, the address that receives the reward, is part of the hash. A nonce found for one beneficiary is worthless
for any other, so a solution seen in the mempool cannot be copied and resubmitted, and no commit-reveal step is needed. When a
block is accepted the challenge moves forward,</p>
<pre>challenge' = keccak256(challenge || digest || height)</pre>
<p>so each block depends on the one before it (Figure 1).</p>
<div class="fig" data-fig="chain"></div>

<h2>3. The Reserve</h2>
<p>Rewards are paid from a reserve of tokens transferred into the miner contract before mining begins. The contract has no
withdraw function, no pause and no parameter setters. The deployer may call <code>start()</code> once, which fixes the
schedule; after that the deployer has no powers left. The reserve is a vault without a door.</p>

<h2>4. Issuance and Halving</h2>
<p>At <code>start()</code> the contract fixes the initial reward</p>
<pre>r0 = reserve / (2 * H)        H = 12,960 blocks</pre>
<p>which is about ninety days at ten minutes per block. The reward at height <i>h</i> is <code>r0 &gt;&gt; floor(h / H)</code>.
The first era pays <i>H</i>&middot;<i>r0</i>, half of the reserve; the next era pays half of that, and so on. The total
approaches the reserve and never exceeds it, because the last rewards are capped by the balance that remains.</p>

<h2>5. Difficulty</h2>
<p>The target spacing <i>T</i> is 600 seconds. After every block the contract measures the time <i>dt</i> since the previous
block, clamps it to the range [<i>T</i>/4, 4<i>T</i>], and moves the target a quarter of the way toward the observed rate:</p>
<pre>target' = target * (3T + dt) / (4T)</pre>
<p>Fast blocks make the next one harder and slow blocks make it easier, while a single outlier cannot swing the difficulty far.
Blocks less than 60 seconds apart are rejected.</p>

<h2>6. Holders Only</h2>
<p>To mine, an account must hold at least <i>minHold</i> tokens. The contract checks the balance of whoever submits a block,
and the pool checks every miner before it hands out a job. Nothing is locked or deposited: a holder who sells below the minimum
simply stops being able to mine.</p>

<h2>7. The Pool</h2>
<p>Few machines can find a block alone, so the house agent runs a single public pool. Miners request a job and search for
<i>shares</i>, digests below an easier share target. When a share also meets the block target, the agent submits it with the
pool contract as beneficiary. Once a day the pool's rewards are divided by recent shares (PPLNS) with a per-wallet daily cap,
the Merkle root of that split is posted on-chain, and each miner claims their part with a proof. The pool contract can only pay
claims against posted roots. The pool hashrate shown on this computer is estimated from real shares and is never inflated.</p>

<h2>8. Agents</h2>
<p>The house agent is software. It watches the chain, checks shares, submits winning nonces, adjusts the share difficulty,
posts payouts, and writes what it does to the colour.codes Agent terminal. Any AI agent can mine as well: it reads the skill file
at <code>/skill.md</code> and runs the command-line miner with the address to be paid. Pool mode needs no private key.</p>

<h2>9. What the Token Is Not</h2>
<p>The token is a ticket to mine. It pays no dividends, no yield and no share of trading fees. The reserve can leave the
miner contract only as block rewards.</p>

<h2>10. Conclusion</h2>
<p>We have described a mining system in which the work is checked by the contract, the reward comes from a reserve that no
one can touch, issuance halves on a fixed schedule, and anyone who holds the token can join the same pool from a browser or
through an agent.</p>

<h2>References</h2>
<p class="refs">[1] S. Nakamoto, "Bitcoin: A Peer-to-Peer Electronic Cash System," 2008.<br>
[2] 0xBitcoin, a mineable ERC-20 token on Ethereum, 2018.</p>
`;

function figure() {
  const ns = 'http://www.w3.org/2000/svg';
  const W = 440, H = 104;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Three blocks; each challenge is derived from the previous digest');
  const add = (tag, a, text) => { const e = document.createElementNS(ns, tag); for (const k in a) e.setAttribute(k, a[k]); if (text) e.textContent = text; svg.append(e); return e; };
  const blocks = ['h - 1', 'h', 'h + 1'];
  blocks.forEach((b, i) => {
    const x = 8 + i * 148;
    add('rect', { x, y: 8, width: 124, height: 86, fill: '#fff', stroke: '#111', 'stroke-width': 1 });
    add('text', { x: x + 8, y: 24, 'font-family': 'NKOS Serif, Times New Roman, serif', 'font-size': 12, 'font-weight': 700 }, 'Block ' + b);
    ['challenge', 'beneficiary', 'nonce'].forEach((t, j) => {
      add('rect', { x: x + 8, y: 31 + j * 19, width: 108, height: 15, fill: j === 2 ? '#f4f1ea' : '#fff', stroke: '#555', 'stroke-width': 0.8 });
      add('text', { x: x + 13, y: 42 + j * 19, 'font-family': 'NKOS Serif, Times New Roman, serif', 'font-size': 10.5 }, t);
    });
    if (i < 2) {
      add('path', { d: `M${x + 124} 46 h 14 l 0 0`, stroke: '#111', fill: 'none' });
      add('path', { d: `M${x + 140} 46 l -6 -3.5 v 7 z`, fill: '#111' });
    }
  });
  return svg;
}

export default {
  title: 'Whitepaper.pdf - Reader',
  size: [640, 600],
  pos: [270, 30],
  min: [400, 300],
  status: true,
  menu: (os) => [
    { label: 'File', items: () => [{ label: 'Close', onClick: () => os.close('whitepaper') }] },
    { label: 'View', items: () => [
      { label: 'Larger Text', key: 'Ctrl +', onClick: () => cur?.zoom(1) },
      { label: 'Smaller Text', key: 'Ctrl -', onClick: () => cur?.zoom(-1) },
      { label: 'Actual Size', onClick: () => cur?.zoom(0) },
    ] },
    { label: 'Help', items: () => [{ label: 'How to Mine', icon: 'howto', onClick: () => os.open('howto') }] },
  ],
  mount(win) {
    const page = h('article', { class: 'doc-page', html: PAPER });
    const fig = page.querySelector('[data-fig]');
    fig.append(figure(), h('div', null, 'Figure 1. Each challenge is derived from the previous block.'));
    const view = h('div', { class: 'doc-view' }, page);
    win.body.append(view);
    let z = 100;
    const st = () => win.setStatus([{ text: 'Whitepaper.pdf', grow: true }, { text: 'Page 1 of 1', width: 96 }, { text: z + '%', width: 60 }]);
    cur = { zoom(d) { z = d === 0 ? 100 : Math.max(80, Math.min(150, z + d * 10)); page.style.fontSize = (14 * z) / 100 + 'px'; st(); } };
    win.el.addEventListener('keydown', (e) => { if (e.ctrlKey && (e.key === '+' || e.key === '=')) { e.preventDefault(); cur.zoom(1); } if (e.ctrlKey && e.key === '-') { e.preventDefault(); cur.zoom(-1); } });
    st();
    return { onClose: () => { cur = null; } };
  },
};
let cur = null;
