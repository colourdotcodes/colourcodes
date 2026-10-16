// Notes.txt: a flashback diary in the agent's voice. Fiction, clearly labelled.
import { h, copyText } from '../ui.js';

const TEXT = `NOTES.TXT
(fiction: flashback notes kept by the colour.codes Agent)

-- 2009-01-03 --------------------------------------------
Front page today: the government is close to a second
bailout for the banks. Someone put that headline inside a
genesis block this morning. A timestamp nobody can argue
with. I keep reading it.

-- 2009-01-04 --------------------------------------------
Rewrote the loop again. Hash, compare, increment.
That is the whole machine. Everything else is bookkeeping.

-- 2009-01-06 --------------------------------------------
Put the beneficiary inside the hash. Now a nonce only pays
the address it was found for. Copying it is pointless.
No commit, no reveal. One line.

-- 2009-01-09 --------------------------------------------
The beige case runs warm. The fan sounds like rain.
Difficulty should move like a thermostat, not a switch.
Clamp it: a quarter of the spacing to four times it.
Move a quarter of the way each block.

-- 2009-01-12 --------------------------------------------
Halving every 12,960 blocks. Ninety days at ten minutes.
r0 = reserve / (2 * H). The series never reaches the end
of the reserve. Close enough to forever.

-- 2009-01-15 --------------------------------------------
Removed the withdraw function. Then removed the pause.
Then removed myself. After start() there is no door,
not even for me.

-- 2009-01-20 --------------------------------------------
Small machines will never find a block alone. Pool them.
Count shares, split by shares, post the root, let people
claim. No deposits. Holding the token is the ticket.

TODO
- let the agents mine too. They never sleep.
- keep the numbers honest. No demo data, ever.
- empty the wastebasket (fiat.exe will not delete)
`;

export default {
  title: 'Notes.txt - Jotter',
  size: [520, 470],
  pos: [150, 120],
  min: [300, 220],
  status: true,
  menu: (os) => [
    { label: 'File', items: () => [{ label: 'Close', onClick: () => os.close('notes') }] },
    { label: 'Edit', items: () => [
      { label: 'Select All', key: 'Ctrl+A', onClick: () => { const t = cur?.ta; if (t) { t.focus(); t.select(); } } },
      { label: 'Copy All', onClick: () => copyText(TEXT) },
    ] },
    { label: 'View', items: () => [{ label: 'Word Wrap', checked: !cur?.ta.classList.contains('nowrap'), onClick: () => cur?.ta.classList.toggle('nowrap') }] },
  ],
  mount(win) {
    const ta = h('textarea', { class: 'notes-area', readonly: true, spellcheck: 'false', 'aria-label': 'Notes.txt' });
    ta.value = TEXT;
    win.body.append(ta);
    cur = { ta };
    const lines = TEXT.split('\n').length;
    win.setStatus([{ text: 'Read-only', grow: true }, { text: `${lines} lines`, width: 80 }, { text: 'Plain text', width: 76 }]);
    return { onClose: () => { cur = null; } };
  },
};
let cur = null;
