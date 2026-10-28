const JUPITER_PRICE_URL = 'https://lite-api.jup.ag/price/v3';
const PUBLIC_RPC_URL = 'https://api.mainnet-beta.solana.com';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_ACCOUNT_SIZE = 165;
const PRICE_INTERVAL_MS = 2000;
const PRICE_CACHE_MS = 1500;
const BALANCE_TICK_MS = 1000;
const BALANCE_CACHE_MS = 1500;
const BALANCE_POLL_WITH_WS_MS = 5000;
const STALE_MS = 10000;
const WS_RECONNECT_MS = 5000;
const WS_DEBOUNCE_MS = 250;
const RATE_LIMIT_RETRY_MS = [400, 900];
const PRICE_BACKOFF_MS = 5000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callRpc(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (res.status === 429) throw new Error('rate limited');
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'RPC error');
  return json.result;
}

export function createLiveWallet({ heliusUrl, supabase, log }) {
  let address = null;
  let ws = null;
  let wsConnected = false;
  let wsTimer = null;
  let debounceTimer = null;
  let loaded = false;
  let balanceInFlight = null;
  let lastBalanceAt = 0;
  let priceBackoffUntil = 0;
  let lastPriceAt = 0;
  let baselineUsd = null;
  let solLamports = 0;
  let tokens = [];
  let rpc = { status: 'connecting', source: 'none', lastUpdate: null, error: null };
  const prices = new Map();
  const positions = new Map();

  async function rpcWithFallback(method, params) {
    if (heliusUrl) {
      for (let attempt = 0; attempt <= RATE_LIMIT_RETRY_MS.length; attempt++) {
        try {
          return { data: await callRpc(heliusUrl, method, params), source: 'helius' };
        } catch (e) {
          if (e.message === 'rate limited' && attempt < RATE_LIMIT_RETRY_MS.length) {
            await sleep(RATE_LIMIT_RETRY_MS[attempt]);
            continue;
          }
          break;
        }
      }
    }
    return { data: await callRpc(PUBLIC_RPC_URL, method, params), source: 'public' };
  }

  function parseTokens(accounts) {
    const list = [];
    for (const acct of accounts || []) {
      const info = acct.account?.data?.parsed?.info;
      const amount = info?.tokenAmount;
      if (!info || !amount) continue;
      const raw = BigInt(amount.amount || '0');
      if (raw === 0n) continue;
      const decimals = Number(amount.decimals || 0);
      list.push({ mint: info.mint, amount: Number(raw) / Math.pow(10, decimals), decimals });
    }
    return list;
  }

  async function refreshBalances(force = false) {
    if (!address) return;
    if (balanceInFlight) return balanceInFlight;
    if (!force && Date.now() - lastBalanceAt < BALANCE_CACHE_MS) return;
    const owner = address;
    balanceInFlight = (async () => {
      try {
        const [bal, accts] = await Promise.all([
          rpcWithFallback('getBalance', [owner, { commitment: 'confirmed' }]),
          rpcWithFallback('getTokenAccountsByOwner', [
            owner,
            { programId: TOKEN_PROGRAM_ID },
            { encoding: 'jsonParsed', commitment: 'confirmed' },
          ]),
        ]);
        if (owner !== address) return;
        solLamports = Number(bal.data?.value ?? 0);
        tokens = parseTokens(accts.data?.value);
        const source = bal.source === 'helius' && accts.source === 'helius' ? 'helius' : 'public';
        rpc = {
          status: source === 'helius' ? 'live' : 'degraded',
          source,
          lastUpdate: Date.now(),
          error: null,
        };
        lastBalanceAt = Date.now();
        await recordPositions();
        await recordBaseline();
      } catch (e) {
        if (owner !== address) return;
        rpc = { ...rpc, status: 'degraded', error: e.message };
        log(`[live-wallet] balance refresh failed: ${e.message}`);
      } finally {
        balanceInFlight = null;
      }
    })();
    return balanceInFlight;
  }

  async function refreshPrices() {
    if (Date.now() < priceBackoffUntil) return;
    const mints = [...new Set([SOL_MINT, ...tokens.map((t) => t.mint)])].slice(0, 50);
    try {
      const res = await fetch(`${JUPITER_PRICE_URL}?ids=${mints.join(',')}`);
      if (res.status === 429) {
        priceBackoffUntil = Date.now() + PRICE_BACKOFF_MS;
        return;
      }
      if (!res.ok) throw new Error(`Jupiter ${res.status}`);
      const json = await res.json();
      for (const mint of mints) {
        const usd = Number(json?.[mint]?.usdPrice);
        if (Number.isFinite(usd) && usd > 0) prices.set(mint, usd);
      }
      lastPriceAt = Date.now();
      await recordPositions();
      await recordBaseline();
    } catch (e) {
      log(`[live-wallet] price refresh failed: ${e.message}`);
    }
  }

  async function loadPersisted(owner) {
    loaded = false;
    baselineUsd = null;
    positions.clear();
    if (!supabase) {
      loaded = true;
      return;
    }
    try {
      const [pos, base] = await Promise.all([
        supabase.from('wallet_positions').select('mint, entry_price_usd').eq('wallet_address', owner),
        supabase.from('wallet_baseline').select('baseline_usd').eq('wallet_address', owner).maybeSingle(),
      ]);
      if (owner !== address) return;
      if (pos.error) throw new Error(pos.error.message);
      if (base.error) throw new Error(base.error.message);
      for (const row of pos.data || []) positions.set(row.mint, Number(row.entry_price_usd));
      baselineUsd = base.data ? Number(base.data.baseline_usd) : null;
      loaded = true;
    } catch (e) {
      log(`[live-wallet] could not load saved PNL basis: ${e.message}`);
    }
  }

  async function recordPositions() {
    if (!loaded) return;
    for (const t of tokens) {
      const price = prices.get(t.mint);
      if (price == null || positions.has(t.mint)) continue;
      positions.set(t.mint, price);
      if (supabase) {
        const { error } = await supabase.from('wallet_positions').upsert(
          { wallet_address: address, mint: t.mint, entry_price_usd: price },
          { onConflict: 'wallet_address,mint', ignoreDuplicates: true },
        );
        if (error) log(`[live-wallet] could not save entry price: ${error.message}`);
      }
    }
  }

  async function recordBaseline() {
    if (!loaded || baselineUsd != null) return;
    const { portfolioUsd } = computeValues();
    if (portfolioUsd == null) return;
    baselineUsd = portfolioUsd;
    if (supabase) {
      const { error } = await supabase.from('wallet_baseline').upsert(
        { wallet_address: address, baseline_usd: portfolioUsd },
        { onConflict: 'wallet_address', ignoreDuplicates: true },
      );
      if (error) log(`[live-wallet] could not save baseline: ${error.message}`);
    }
  }

  function computeValues() {
    const solPrice = prices.get(SOL_MINT) ?? null;
    const solUsd = solPrice != null ? (solLamports / 1_000_000_000) * solPrice : null;
    let portfolioUsd = solUsd;
    const holdings = tokens.map((t) => {
      const priceUsd = prices.get(t.mint) ?? null;
      const entryPriceUsd = positions.get(t.mint) ?? null;
      const valueUsd = priceUsd != null ? t.amount * priceUsd : null;
      const pnlUsd = priceUsd != null && entryPriceUsd != null ? (priceUsd - entryPriceUsd) * t.amount : null;
      const pnlPct = pnlUsd != null && entryPriceUsd > 0 ? ((priceUsd - entryPriceUsd) / entryPriceUsd) * 100 : null;
      if (portfolioUsd != null) portfolioUsd = valueUsd != null ? portfolioUsd + valueUsd : null;
      return { ...t, priceUsd, valueUsd, entryPriceUsd, pnlUsd, pnlPct };
    });
    return { solPrice, solUsd, holdings, portfolioUsd };
  }

  function snapshot() {
    const { solPrice, solUsd, holdings, portfolioUsd } = computeValues();
    const stale = rpc.lastUpdate == null || Date.now() - rpc.lastUpdate > STALE_MS;
    const allTimePnlUsd = portfolioUsd != null && baselineUsd != null ? portfolioUsd - baselineUsd : null;
    return {
      ok: true,
      configured: Boolean(address),
      address,
      rpc: { ...rpc, status: stale && rpc.status === 'live' ? 'degraded' : rpc.status, wsConnected },
      solBalance: solLamports / 1_000_000_000,
      solPriceUsd: solPrice,
      solUsd,
      tokens: holdings,
      portfolioUsd,
      baselineUsd,
      allTimePnlUsd,
      priceUpdatedAt: lastPriceAt || null,
    };
  }

  function scheduleRefresh() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void refreshBalances(true), WS_DEBOUNCE_MS);
  }

  function connectWs() {
    clearTimeout(wsTimer);
    if (!heliusUrl || !address || typeof WebSocket === 'undefined') return;
    const owner = address;
    const socket = new WebSocket(heliusUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:'));
    ws = socket;
    socket.onopen = () => {
      wsConnected = true;
      socket.send(JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'accountSubscribe',
        params: [owner, { encoding: 'jsonParsed', commitment: 'confirmed' }],
      }));
      socket.send(JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'programSubscribe',
        params: [TOKEN_PROGRAM_ID, {
          encoding: 'jsonParsed',
          commitment: 'confirmed',
          filters: [{ dataSize: TOKEN_ACCOUNT_SIZE }, { memcmp: { offset: 32, bytes: owner } }],
        }],
      }));
    };
    socket.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.method === 'accountNotification' || msg.method === 'programNotification') scheduleRefresh();
    };
    socket.onclose = () => {
      wsConnected = false;
      if (ws === socket) ws = null;
      if (address === owner) wsTimer = setTimeout(connectWs, WS_RECONNECT_MS);
    };
  }

  function resetFor(nextAddress) {
    if (ws) {
      const old = ws;
      ws = null;
      old.onclose = null;
      old.close();
    }
    wsConnected = false;
    clearTimeout(wsTimer);
    clearTimeout(debounceTimer);
    address = nextAddress;
    solLamports = 0;
    tokens = [];
    lastBalanceAt = 0;
    rpc = { status: 'connecting', source: 'none', lastUpdate: null, error: null };
    if (!nextAddress) {
      loaded = false;
      baselineUsd = null;
      positions.clear();
      return;
    }
    void loadPersisted(nextAddress).then(() => refreshBalances(true));
    connectWs();
  }

  setInterval(() => {
    if (!address) return;
    const due = !wsConnected || Date.now() - lastBalanceAt > BALANCE_POLL_WITH_WS_MS;
    if (due) void refreshBalances();
  }, BALANCE_TICK_MS);

  setInterval(() => {
    if (!address) return;
    if (Date.now() - lastPriceAt >= PRICE_CACHE_MS) void refreshPrices();
  }, PRICE_INTERVAL_MS);

  return {
    setAddress(nextAddress) {
      if (nextAddress === address) return;
      resetFor(nextAddress);
    },
    snapshot,
  };
}
