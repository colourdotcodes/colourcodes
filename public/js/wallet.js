// ColourcodeWallet: EIP-6963 wallet discovery, connect, Robinhood Chain switch,
// read calls and transactions. No dependencies. Works as a classic script or
// a dynamic import; exposes window.ColourcodeWallet either way.
(function () {
  if (window.ColourcodeWallet) return;
  const CFG = (window.COLOURCODE && window.COLOURCODE.chain) || {};
  const CHAIN = {
    id: CFG.id || 4663,
    hex: '0x' + (CFG.id || 4663).toString(16),
    name: CFG.name || 'Robinhood Chain',
    rpc: CFG.rpc || 'https://rpc.mainnet.chain.robinhood.com',
    explorer: CFG.explorer || 'https://robinhoodchain.blockscout.com',
  };
  const STORE = 'nkos.wallet';
  const providers = new Map(); // uuid -> { info, provider }
  const listeners = new Map();
  const state = { address: null, chainId: null, provider: null, info: null };

  const emit = (ev, d) => (listeners.get(ev) || []).forEach((fn) => { try { fn(d); } catch (e) { console.error(e); } });
  const save = (v) => { try { v ? localStorage.setItem(STORE, v) : localStorage.removeItem(STORE); } catch (e) {} };
  const load = () => { try { return localStorage.getItem(STORE); } catch (e) { return null; } };

  window.addEventListener('eip6963:announceProvider', (e) => {
    const d = e.detail;
    if (!d || !d.info || !d.provider) return;
    providers.set(d.info.uuid, { info: d.info, provider: d.provider });
    emit('providers', list());
  });
  const request = () => window.dispatchEvent(new Event('eip6963:requestProvider'));
  request();

  function list() {
    const out = [...providers.values()];
    if (!out.length && window.ethereum) out.push({ info: { uuid: 'legacy', name: 'Browser wallet', icon: '', rdns: 'legacy' }, provider: window.ethereum });
    return out;
  }

  function attach(p, info) {
    if (state.provider && state.provider !== p && state.provider.removeListener) {
      try { state.provider.removeListener('accountsChanged', onAccounts); state.provider.removeListener('chainChanged', onChain); } catch (e) {}
    }
    state.provider = p; state.info = info;
    if (p.on) { p.on('accountsChanged', onAccounts); p.on('chainChanged', onChain); }
  }
  function onAccounts(a) {
    state.address = a && a[0] ? a[0] : null;
    if (!state.address) save(null);
    emit('change', snapshot());
  }
  function onChain(c) { state.chainId = parseInt(c, 16); emit('change', snapshot()); }
  const snapshot = () => ({ address: state.address, chainId: state.chainId, onChain: state.chainId === CHAIN.id, wallet: state.info && state.info.name });

  async function connect(uuid) {
    let pick = uuid ? list().find((x) => x.info.uuid === uuid) : null;
    if (!pick) { const all = list(); if (all.length === 1) pick = all[0]; }
    if (!pick) throw Object.assign(new Error(list().length ? 'Choose a wallet' : 'No browser wallet found'), { code: list().length ? 'CHOOSE' : 'NO_WALLET' });
    attach(pick.provider, pick.info);
    const accts = await pick.provider.request({ method: 'eth_requestAccounts' });
    state.address = accts && accts[0] ? accts[0] : null;
    state.chainId = parseInt(await pick.provider.request({ method: 'eth_chainId' }), 16);
    save(pick.info.rdns || pick.info.uuid);
    emit('change', snapshot());
    return state.address;
  }

  // silent reconnect if the visitor connected before (no popup)
  async function restore() {
    const want = load();
    if (!want) return null;
    await new Promise((r) => setTimeout(r, 300));
    const pick = list().find((x) => x.info.rdns === want || x.info.uuid === want);
    if (!pick) return null;
    try {
      const accts = await pick.provider.request({ method: 'eth_accounts' });
      if (!accts || !accts[0]) return null;
      attach(pick.provider, pick.info);
      state.address = accts[0];
      state.chainId = parseInt(await pick.provider.request({ method: 'eth_chainId' }), 16);
      emit('change', snapshot());
      return state.address;
    } catch (e) { return null; }
  }

  function disconnect() {
    state.address = null; save(null);
    emit('change', snapshot());
  }

  async function ensureChain() {
    const p = state.provider;
    if (!p) throw new Error('Wallet not connected');
    if (state.chainId === CHAIN.id) return true;
    try {
      await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN.hex }] });
    } catch (e) {
      if (e && (e.code === 4902 || e.code === -32603 || /unrecognized|not added|unknown chain/i.test(e.message || ''))) {
        await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: CHAIN.hex, chainName: CHAIN.name, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [CHAIN.rpc], blockExplorerUrls: [CHAIN.explorer] }] });
      } else throw e;
    }
    state.chainId = parseInt(await p.request({ method: 'eth_chainId' }), 16);
    emit('change', snapshot());
    return state.chainId === CHAIN.id;
  }

  // eth_call: through the wallet when it is on Robinhood Chain, else the public RPC
  async function call(to, data) {
    if (state.provider && state.chainId === CHAIN.id) {
      return state.provider.request({ method: 'eth_call', params: [{ to, data }, 'latest'] });
    }
    const res = await fetch(CHAIN.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) });
    const j = await res.json();
    if (j.error) throw new Error(j.error.message || 'eth_call failed');
    return j.result;
  }

  async function sendTransaction(tx) {
    if (!state.provider || !state.address) throw new Error('Wallet not connected');
    await ensureChain();
    return state.provider.request({ method: 'eth_sendTransaction', params: [Object.assign({ from: state.address }, tx)] });
  }

  async function waitForReceipt(hash, { timeout = 120000 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try {
        const r = await (state.provider && state.chainId === CHAIN.id
          ? state.provider.request({ method: 'eth_getTransactionReceipt', params: [hash] })
          : fetch(CHAIN.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [hash] }) }).then((x) => x.json()).then((j) => j.result));
        if (r) return r;
      } catch (e) {}
      await new Promise((r) => setTimeout(r, 2500));
    }
    return null;
  }

  window.ColourcodeWallet = {
    chain: CHAIN,
    providers: () => { request(); return list(); },
    connect, disconnect, restore, ensureChain, call, sendTransaction, waitForReceipt,
    get address() { return state.address; },
    get chainId() { return state.chainId; },
    get onChain() { return state.chainId === CHAIN.id; },
    get walletName() { return state.info && state.info.name; },
    state: snapshot,
    on(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, []); listeners.get(ev).push(fn); return () => listeners.set(ev, listeners.get(ev).filter((f) => f !== fn)); },
    txUrl: (h) => CHAIN.explorer + '/tx/' + h,
    addressUrl: (a) => CHAIN.explorer + '/address/' + a,
  };
  restore();
})();
