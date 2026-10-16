// Everything the owner may need to change lives here.
window.COLOURCODE = {
  name: 'colour.codes',
  ticker: 'CCODE',
  domain: 'colour.codes',
  ca: '',                      // set at launch: the token address on Robinhood Chain
  caText: 'DROPS AT LAUNCH',
  links: { x: 'https://x.com/colourdotcodes', telegram: '', pons: '', dexscreener: '' },

  chain: {
    id: 4663,
    name: 'Robinhood Chain',
    rpc: 'https://rpc.mainnet.chain.robinhood.com',
    explorer: 'https://robinhoodchain.blockscout.com',
  },

  // Filled after the contracts are deployed. Empty = honest "not deployed" states.
  contracts: { miner: '', pool: '' },

  mining: {
    targetSpacingSec: 600,
    halvingInterval: 12960,
    minHold: 0,                // tokens required to mine, set at launch
  },
};
