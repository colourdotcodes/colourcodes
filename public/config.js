// Everything the owner may need to change lives here.
window.COLOURCODE = {
  name: 'colour.codes',
  ticker: 'CCODE',
  domain: 'colour.codes',
  ca: '0xcf595c67A50c423cD663E90f47922c4651f91cd6',                      // set at launch: the token address on Robinhood Chain
  caText: 'NOT MIXED YET',     // after the chip's "CA" label; the chip copies "CA NOT MIXED YET"
  links: { x: 'https://x.com/colourdotcodes', github: 'https://github.com/colourdotcodes/colourcodes', pons: 'https://ponsfamily.com/launchpad/0xcf595c67A50c423cD663E90f47922c4651f91cd6', dexscreener: 'https://dexscreener.com/robinhood/0xcf595c67A50c423cD663E90f47922c4651f91cd6' },

  chain: {
    id: 4663,
    name: 'Robinhood Chain',
    rpc: 'https://rpc.mainnet.chain.robinhood.com',
    explorer: 'https://robinhoodchain.blockscout.com',
  },

  // Filled after the contracts are deployed. Empty = honest "not deployed" states.
  contracts: { miner: '0x646721dA9c7E32d401a3FF8FA802edC20E0c0317', pool: '0x3009B1B2560F32CeeD40F67b4b8BE47aff3BA948' },

  mining: {
    targetSpacingSec: 600,
    halvingInterval: 12960,
    minHold: 100000,           // tokens required to mine (MIN_HOLD in ColourcodeMiner)
  },
};
