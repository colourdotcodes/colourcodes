// Wastebasket: a small easter egg. fiat.exe refuses to go away.
import { h, tool, listView } from '../ui.js';
import { iconImg } from '../icons.js';

const ITEMS = [
  { name: 'fiat.exe', icon: 'note', from: '/system/money', date: '2009-01-03', size: 'Unlimited', id: 'fiat' },
  { name: 'trusted_third_party.dll', icon: 'file', from: '/system/lib', date: '2008-10-31', size: '0 KB', id: 'ttp' },
];

export default {
  title: 'Wastebasket',
  size: [520, 300],
  pos: [404, 318],
  min: [360, 220],
  toolbar: true,
  status: true,
  mount(win, os) {
    let items = ITEMS.slice();
    const list = listView([
      { label: 'Name', get: (r) => [iconImg(r.icon, 16), r.name] },
      { label: 'Original location', key: 'from', width: '128px' },
      { label: 'Date deleted', key: 'date', width: '96px' },
      { label: 'Size', key: 'size', width: '76px' },
    ], { empty: 'The Wastebasket is empty.', onOpen: (r) => restore(r) });
    const st = () => win.setStatus([{ text: `${items.length} object${items.length === 1 ? '' : 's'}`, grow: true }, { text: items.find((i) => i.id === 'fiat') ? 'Size: unlimited' : '0 KB', width: 110 }]);
    const restore = async (r) => {
      r = r || list.selected;
      if (!r) { os.msgbox({ title: 'Wastebasket', icon: 'info', text: 'Select an item to restore first.', parent: win }); return; }
      if (r.id === 'fiat') await os.msgbox({ title: 'Restore', icon: 'error', parent: win, text: ['fiat.exe cannot be restored.', 'It keeps printing copies of itself. Leave it in the basket.'] });
      else await os.msgbox({ title: 'Restore', icon: 'warn', parent: win, text: ['trusted_third_party.dll is no longer needed.', 'The contract checks the work itself.'] });
    };
    const empty = async () => {
      const r = await os.msgbox({ title: 'Empty Wastebasket', icon: 'warn', buttons: ['Yes', 'No'], parent: win, text: `Are you sure you want to permanently delete these ${items.length} items?` });
      if (r !== 'Yes') return;
      const had = items.length;
      items = items.filter((i) => i.id === 'fiat');
      list.setRows(items); st();
      if (had > 1) await os.msgbox({ title: 'Empty Wastebasket', icon: 'error', parent: win, text: ['trusted_third_party.dll was deleted.', 'fiat.exe could not be deleted: it is still in use by too many programs.'] });
      else await os.msgbox({ title: 'Empty Wastebasket', icon: 'error', parent: win, text: 'fiat.exe could not be deleted: it is still in use. Try again in a few decades.' });
    };
    win.toolbar.append(tool('Empty Wastebasket', 'trashEmpty', empty), tool('Restore', 'folder', () => restore()), h('span', { class: 'grow' }));
    win.body.append(h('div', { style: { display: 'flex', flex: '1', minHeight: '0', padding: '0 2px' } }, list.el));
    list.setRows(items);
    st();
  },
};
