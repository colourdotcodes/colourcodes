// Static app metadata (icons, titles, start-menu copy). Modules load lazily on first open.
import { ticker } from './ui.js';

export const APPS = {
  agent: { title: 'colour.codes Agent', icon: 'agent', desc: "The pool operator's console" },
  miner: { title: 'colour.codes Miner', icon: 'miner', desc: 'Generate coins in your browser' },
  explorer: { title: 'Block Explorer', icon: 'explorer', desc: 'Blocks mined on Robinhood Chain' },
  pool: { title: 'colour.codes Pool', icon: 'pool', desc: 'Shares, payouts and claims' },
  whitepaper: { title: 'Whitepaper', icon: 'whitepaper' },
  howto: { title: 'How to Mine', icon: 'howto' },
  buy: { get title() { return 'Buy ' + ticker(); }, icon: 'buy' },
  notes: { title: 'Notes.txt', icon: 'notes' },
  trash: { title: 'Wastebasket', icon: 'trash' },
};

// Desktop layout for the 1024x738 crt desktop (native mode uses a grid).
export const DESKTOP = [
  ['agent', 12, 10], ['miner', 12, 92], ['explorer', 12, 174], ['pool', 12, 256], ['buy', 12, 338],
  ['whitepaper', 98, 10], ['howto', 98, 92], ['notes', 98, 174],
  ['trash', -96, -92],
];

export const START_PROGRAMS = ['agent', 'miner', 'explorer', 'pool'];
export const START_DOCS = ['whitepaper', 'howto', 'notes', 'buy', 'trash'];

export const loaders = {
  agent: () => import('./apps/agent.js'),
  miner: () => import('./apps/miner.js'),
  explorer: () => import('./apps/explorer.js'),
  pool: () => import('./apps/pool.js'),
  whitepaper: () => import('./apps/whitepaper.js'),
  howto: () => import('./apps/howto.js'),
  buy: () => import('./apps/buy.js'),
  notes: () => import('./apps/notes.js'),
  trash: () => import('./apps/trash.js'),
};
