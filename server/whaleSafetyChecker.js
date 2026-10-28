// Whale safety checker — runs as a background pre-filter so turboBuy()
// never blocks on holder analysis. Checks top-10 holder concentration,
// dev wallet %, and fresh-wallet dump risk.

const PUMP_FUN_PROGRAM = '6EFSDrCvT7Ks7Wf3uBf5qBd3Jf9ZpY3vXxJhK2mN8rT';
const CHECK_INTERVAL_MS = 3000;
const CACHE_TTL_MS = 30_000;
const MAX_HOLDERS_TO_CHECK = 20;

export function createWhaleSafetyChecker({ heliusRpc, log }) {
  const safetyCache = new Map(); // mint -> { status, checkedAt, reasons }
  const pending = new Set();

  async function getTokenLargestAccounts(mint) {
    const res = await heliusRpc('getTokenLargestAccounts', [mint, { commitment: 'confirmed' }]);
    if (res.error || !res.result?.value) return [];
    return res.result.value;
  }

  async function getAccountInfo(address) {
    const res = await heliusRpc('getAccountInfo', [address, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
    if (res.error) return null;
    return res.result?.value;
  }

  // Check if a wallet is "fresh" — created recently with no transaction history
  async function isFreshWallet(address) {
    try {
      const sigRes = await heliusRpc('getSignaturesForAddress', [address, { limit: 3 }]);
      if (sigRes.error || !sigRes.result) return true; // no sigs = fresh or empty
      return sigRes.result.length === 0;
    } catch {
      return false;
    }
  }

  async function checkMint(mint) {
    if (safetyCache.has(mint)) {
      const cached = safetyCache.get(mint);
      if (Date.now() - cached.checkedAt < CACHE_TTL_MS) return cached;
    }
    if (pending.has(mint)) return safetyCache.get(mint) || { status: 'pending', reasons: [] };
    pending.add(mint);

    try {
      const holders = await getTokenLargestAccounts(mint);
      if (holders.length === 0) {
        const result = { status: 'unknown', checkedAt: Date.now(), reasons: ['No holder data'] };
        safetyCache.set(mint, result);
        pending.delete(mint);
        return result;
      }

      const totalSupply = BigInt(holders[0]?.amount || 0);
      let supplyBase = 0;
      for (const h of holders) {
        supplyBase += Number(h.amount || 0);
      }
      if (supplyBase === 0) {
        const result = { status: 'unknown', checkedAt: Date.now(), reasons: ['Zero supply'] };
        safetyCache.set(mint, result);
        pending.delete(mint);
        return result;
      }

      // Top 10 holder concentration
      const top10Raw = holders.slice(0, 10).reduce((sum, h) => sum + Number(h.amount || 0), 0);
      const top10Pct = (top10Raw / supplyBase) * 100;

      // Largest single holder (dev check — typically index 0 on pump.fun)
      const devPct = (Number(holders[0]?.amount || 0) / supplyBase) * 100;

      const reasons = [];
      let isDanger = false;

      if (top10Pct > 35) {
        isDanger = true;
        reasons.push(`Top 10 hold ${top10Pct.toFixed(1)}% (>35%)`);
      }

      if (devPct > 10) {
        isDanger = true;
        reasons.push(`Dev holds ${devPct.toFixed(1)}% (>10%)`);
      }

      // Check top 5 holders for fresh wallets holding >20%
      const top5 = holders.slice(0, 5);
      let freshDanger = false;
      for (const h of top5) {
        const holderPct = (Number(h.amount || 0) / supplyBase) * 100;
        if (holderPct > 20) {
          const fresh = await isFreshWallet(h.address);
          if (fresh) {
            freshDanger = true;
            reasons.push(`Fresh wallet ${h.address.slice(0, 6)}… holds ${holderPct.toFixed(1)}%`);
          }
        }
      }
      if (freshDanger) isDanger = true;

      const result = {
        status: isDanger ? 'danger' : 'safe',
        checkedAt: Date.now(),
        top10Pct: Math.round(top10Pct * 10) / 10,
        devPct: Math.round(devPct * 10) / 10,
        reasons,
      };
      safetyCache.set(mint, result);
      pending.delete(mint);
      return result;
    } catch (e) {
      pending.delete(mint);
      const result = { status: 'unknown', checkedAt: Date.now(), reasons: [`Check failed: ${e.message}`] };
      safetyCache.set(mint, result);
      return result;
    }
  }

  // Background worker — checks mints from a queue every 3s
  const checkQueue = new Set();
  let workerRunning = false;

  function enqueueCheck(mints) {
    for (const m of mints) {
      if (!safetyCache.has(m) || Date.now() - safetyCache.get(m).checkedAt > CACHE_TTL_MS) {
        checkQueue.add(m);
      }
    }
  }

  async function runWorker() {
    if (workerRunning) return;
    workerRunning = true;
    while (checkQueue.size > 0) {
      const batch = Array.from(checkQueue).slice(0, 5);
      for (const m of batch) checkQueue.delete(m);
      await Promise.allSettled(batch.map((m) => checkMint(m)));
      if (checkQueue.size > 0) await new Promise((r) => setTimeout(r, 500));
    }
    workerRunning = false;
  }

  const interval = setInterval(() => {
    if (checkQueue.size > 0) void runWorker();
  }, CHECK_INTERVAL_MS);

  function getSnapshot() {
    const result = {};
    for (const [mint, data] of safetyCache) {
      if (Date.now() - data.checkedAt < CACHE_TTL_MS) {
        result[mint] = data;
      }
    }
    return result;
  }

  function getStatus(mint) {
    const cached = safetyCache.get(mint);
    if (!cached) return null;
    if (Date.now() - cached.checkedAt > CACHE_TTL_MS) return null;
    return cached;
  }

  function isSafe(mint) {
    const s = getStatus(mint);
    return s?.status === 'safe';
  }

  return { checkMint, enqueueCheck, getSnapshot, getStatus, isSafe, stop: () => clearInterval(interval) };
}
