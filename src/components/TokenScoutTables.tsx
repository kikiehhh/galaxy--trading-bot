import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { TrendingUp, TrendingDown, Sparkles, Users, Crosshair, Eye, BarChart3, ExternalLink, ArrowUpDown, Zap, Check, Loader2, X, AlertCircle, Flame, Skull, ShieldCheck } from 'lucide-react';
import { Panel } from './ui';
import { useTokenScout } from '@/lib/hooks';
import { backendBuy, turboBuy, prefetchTurboQuote, fetchWhaleSafety, type WhaleSafetyEntry } from '@/lib/backend';
import type { TokenStat } from '@/lib/tokenScout';

function fmtMc(mc: number): string {
  if (mc >= 1_000_000) return `$${(mc / 1_000_000).toFixed(2)}M`;
  if (mc >= 1_000) return `$${(mc / 1_000).toFixed(1)}K`;
  return `$${mc.toFixed(2)}`;
}

function fmtVol(sol: number): string {
  if (sol >= 1000) return `${(sol / 1000).toFixed(1)}K SOL`;
  return `${sol.toFixed(1)} SOL`;
}

function fmtAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function fmtPct(pct: number): string {
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

type SortKey = 'changePct' | 'marketCap' | 'volumeSol' | 'uniqueHolders' | 'sniperCount' | 'viewers' | 'ageSeconds';

const QUICK_AMOUNTS = [0.01, 0.02, 0.05];

interface BuyState {
  amount: string;
  status: 'idle' | 'sending' | 'success' | 'error';
  message: string;
  signature: string | null;
  latencyMs?: number;
}

interface TokenTableProps {
  title: string;
  icon: React.ReactNode;
  tokens: TokenStat[];
  accent: 'green' | 'red' | 'cyan';
  defaultSort: SortKey;
  defaultDir: 'asc' | 'desc';
  turboMode?: boolean;
}

function TokenTable({ title, icon, tokens, accent, defaultSort, defaultDir, turboMode }: TokenTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>(defaultSort);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultDir);
  const [buyMint, setBuyMint] = useState<string | null>(null);
  const [buyState, setBuyState] = useState<Record<string, BuyState>>({});
  const [safetyMap, setSafetyMap] = useState<Record<string, WhaleSafetyEntry>>({});
  const lastSafetyEnqueueRef = useRef<number>(0);

  // Poll whale safety data for visible tokens every 3s
  useEffect(() => {
    const visibleMints = tokens.map((t) => t.mint).slice(0, 30);
    if (visibleMints.length === 0) return;

    const poll = async () => {
      try {
        const res = await fetchWhaleSafety(visibleMints);
        if (res.ok && res.safety) {
          setSafetyMap((prev) => {
            const next = { ...prev };
            for (const [mint, entry] of Object.entries(res.safety)) {
              next[mint] = entry;
            }
            return next;
          });
        }
      } catch {
        // silent — will retry
      }
    };

    // Enqueue checks on mount/refresh, then poll every 3s
    const now = Date.now();
    if (now - lastSafetyEnqueueRef.current > 3000) {
      lastSafetyEnqueueRef.current = now;
      void poll();
    }
    const interval = setInterval(() => void poll(), 3000);
    return () => clearInterval(interval);
  }, [tokens]);

  const sorted = useMemo(() => {
    const arr = [...tokens];
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'desc' ? bv - av : av - bv;
      }
      return sortDir === 'desc'
        ? String(bv).localeCompare(String(av))
        : String(av).localeCompare(String(bv));
    });
    return arr;
  }, [tokens, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const openBuy = useCallback((mint: string) => {
    setBuyMint(mint);
    setBuyState((prev) =>
      prev[mint]
        ? prev
        : { ...prev, [mint]: { amount: '0.01', status: 'idle', message: '', signature: null } },
    );
  }, []);

  const closeBuy = useCallback(() => setBuyMint(null), []);

  const quoteCacheRef = useRef<Map<string, { outAmount: string; time: number }>>(new Map());

  const handleBuy = useCallback(async (mint: string, symbol: string) => {
    const state = buyState[mint];
    if (!state) return;
    const amt = parseFloat(state.amount);
    if (!Number.isFinite(amt) || amt <= 0) return;
    setBuyState((prev) => ({
      ...prev,
      [mint]: { ...prev[mint], status: 'sending', message: '', signature: null, latencyMs: undefined },
    }));
    try {
      if (turboMode) {
        const result = await turboBuy(mint, amt, 'manual');
        setBuyState((prev) => ({
          ...prev,
          [mint]: {
            amount: prev[mint].amount,
            status: result.ok ? 'success' : 'error',
            message: result.ok
              ? `\u26a1 Bought ${symbol} in ${(result.latencyMs / 1000).toFixed(2)}s`
              : result.error || 'Turbo buy failed',
            signature: result.signature,
            latencyMs: result.latencyMs,
          },
        }));
      } else {
        const result = await backendBuy(mint, amt, 'manual');
        setBuyState((prev) => ({
          ...prev,
          [mint]: {
            amount: prev[mint].amount,
            status: result.ok ? 'success' : 'error',
            message: result.ok
              ? `Bought ${symbol} with ${amt} SOL`
              : result.error || 'Buy failed',
            signature: result.signature,
          },
        }));
      }
    } catch (e) {
      setBuyState((prev) => ({
        ...prev,
        [mint]: {
          amount: prev[mint].amount,
          status: 'error',
          message: e instanceof Error ? e.message : 'Buy failed',
          signature: null,
        },
      }));
    }
  }, [buyState, turboMode]);

  const handleHoverPrefetch = useCallback((mint: string, amount: string) => {
    const amt = parseFloat(amount);
    if (!turboMode || !Number.isFinite(amt) || amt <= 0) return;
    const key = `${mint}:${amt}`;
    const cached = quoteCacheRef.current.get(key);
    if (cached && Date.now() - cached.time < 5000) return;
    void prefetchTurboQuote(mint, amt).then((q) => {
      if (q.ok) quoteCacheRef.current.set(key, { outAmount: q.outAmount, time: Date.now() });
    }).catch(() => {});
  }, [turboMode]);

  const accentClasses = {
    green: { border: 'border-green-500/20', text: 'text-green-300', bg: 'bg-green-500/5', badge: 'bg-green-500/15 text-green-300' },
    red: { border: 'border-red-500/20', text: 'text-red-300', bg: 'bg-red-500/5', badge: 'bg-red-500/15 text-red-300' },
    cyan: { border: 'border-cyan-500/20', text: 'text-cyan-300', bg: 'bg-cyan-500/5', badge: 'bg-cyan-500/15 text-cyan-300' },
  };
  const a = accentClasses[accent];

  const headerCellClass = "px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400 cursor-pointer select-none hover:text-slate-200 transition-colors whitespace-nowrap";
  const rowCellClass = "px-3 py-2 text-xs font-mono text-slate-300 tabular-nums whitespace-nowrap";

  function SortHeader({ k, label, align = 'left' }: { k: SortKey; label: string; align?: 'left' | 'right' | 'center' }) {
    return (
      <th
        onClick={() => toggleSort(k)}
        className={`${headerCellClass} ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''}`}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {sortKey === k && <ArrowUpDown className="w-3 h-3 opacity-60" />}
        </span>
      </th>
    );
  }

  return (
    <div className={`rounded-xl border ${a.border} ${a.bg} overflow-hidden`}>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5">
        {icon}
        <h4 className="font-display text-sm font-semibold text-white">{title}</h4>
        <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded ${a.badge}`}>
          {tokens.length} tokens
        </span>
      </div>

      <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-black/40 backdrop-blur-sm z-10">
            <tr className="border-b border-white/5">
              <th className={`${headerCellClass} min-w-[120px]`}>Token</th>
              <SortHeader k="changePct" label="Chg%" align="right" />
              <SortHeader k="marketCap" label="MC" align="right" />
              <SortHeader k="volumeSol" label="Vol" align="right" />
              <SortHeader k="uniqueHolders" label="Holders" align="right" />
              <SortHeader k="sniperCount" label="Snipers" align="right" />
              <SortHeader k="viewers" label="Viewers" align="right" />
              <SortHeader k="ageSeconds" label="Age" align="right" />
              <th className={`${headerCellClass} text-center`}>Buy</th>
              <th className={headerCellClass}></th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-xs text-slate-500">
                  No tokens yet — waiting for pump.fun feed data…
                </td>
              </tr>
            ) : (
              sorted.map((t) => {
                const isUp = t.changePct >= 0;
                const bs = buyState[t.mint];
                const showBuyRow = buyMint === t.mint;
                const safety = safetyMap[t.mint];
                const isDanger = safety?.status === 'danger';
                const isSafe = safety?.status === 'safe';
                const turboDisabled = turboMode && isDanger;
                return (
                  <>
                    <tr key={t.mint} className="border-b border-white/5 hover:bg-white/[0.03] transition-colors">
                      <td className="px-3 py-2 min-w-[120px]">
                        <div className="flex items-center gap-2">
                          {t.imageUri ? (
                            <img
                              src={t.imageUri}
                              alt={t.symbol || ''}
                              className="w-6 h-6 rounded-full shrink-0 border border-white/10 object-cover"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center shrink-0">
                              <Sparkles className="w-3 h-3 text-cyan-400" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-white truncate max-w-[100px] flex items-center gap-1">
                              {t.symbol || '—'}
                              {isSafe && <span title={`Safe: top10 ${safety?.top10Pct}% dev ${safety?.devPct}%`}><ShieldCheck className="w-3 h-3 text-green-400 shrink-0" /></span>}
                              {isDanger && <span title={`Danger: ${(safety?.reasons || []).join(', ')}`}><Skull className="w-3 h-3 text-red-400 shrink-0 animate-pulse" /></span>}
                            </div>
                            <div className="text-[9px] text-slate-500 font-mono truncate max-w-[100px]">
                              {t.mint.slice(0, 6)}…{t.mint.slice(-4)}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className={`${rowCellClass} text-right`}>
                        <span className={isUp ? 'text-green-400' : 'text-red-400'}>
                          {fmtPct(t.changePct)}
                        </span>
                      </td>
                      <td className={`${rowCellClass} text-right text-slate-200`}>{fmtMc(t.marketCap)}</td>
                      <td className={`${rowCellClass} text-right text-slate-400`}>{fmtVol(t.volumeSol)}</td>
                      <td className={`${rowCellClass} text-right`}>
                        <span className="inline-flex items-center gap-1 text-slate-300">
                          <Users className="w-3 h-3 text-slate-500" />
                          {t.uniqueHolders}
                        </span>
                      </td>
                      <td className={`${rowCellClass} text-right`}>
                        <span className="inline-flex items-center gap-1 text-amber-300">
                          <Crosshair className="w-3 h-3 text-amber-500" />
                          {t.sniperCount}
                        </span>
                      </td>
                      <td className={`${rowCellClass} text-right`}>
                        <span className="inline-flex items-center gap-1 text-cyan-300">
                          <Eye className="w-3 h-3 text-cyan-500" />
                          {t.viewers}
                        </span>
                      </td>
                      <td className={`${rowCellClass} text-right text-slate-500`}>{fmtAge(t.ageSeconds)}</td>
                      <td className="px-2 py-2 text-center">
                        <button
                          onClick={() => (showBuyRow ? closeBuy() : openBuy(t.mint))}
                          onMouseEnter={() => handleHoverPrefetch(t.mint, buyState[t.mint]?.amount || '0.01')}
                          disabled={turboDisabled}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                            turboDisabled
                              ? 'bg-red-500/10 text-red-400/50 border border-red-500/20 cursor-not-allowed'
                              : showBuyRow
                                ? 'bg-white/10 text-slate-300'
                                : turboMode
                                  ? 'bg-orange-500/15 hover:bg-orange-500/25 text-orange-300 border border-orange-500/20 hover:border-orange-400/40'
                                  : 'bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/20 hover:border-cyan-400/40'
                          }`}
                          title={turboDisabled ? `DANGER: ${(safety?.reasons || []).join(', ')}` : `Quick-buy ${t.symbol || t.mint.slice(0, 6)}`}
                        >
                          {turboDisabled ? <Skull className="w-3 h-3" /> : turboMode ? <Flame className="w-3 h-3" /> : <Zap className="w-3 h-3" />}
                          {turboDisabled ? 'DANGER' : turboMode ? 'TURBO' : 'Buy'}
                        </button>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <a
                          href={`https://pump.fun/${t.mint}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                          title="View on pump.fun"
                        >
                          <ExternalLink className="w-3 h-3 text-slate-400" />
                        </a>
                      </td>
                    </tr>
                    {showBuyRow && bs && (
                      <tr key={`${t.mint}-buy`} className="border-b border-white/5">
                        <td colSpan={10} className="px-4 py-3 bg-black/20">
                          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
                            <div className="flex items-center gap-2">
                              <Zap className="w-4 h-4 text-cyan-400" />
                              <span className="text-xs font-semibold text-white">
                                Quick-Buy {t.symbol || t.mint.slice(0, 8)}
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              {QUICK_AMOUNTS.map((amt) => (
                                <button
                                  key={amt}
                                  onClick={() =>
                                    setBuyState((prev) => ({
                                      ...prev,
                                      [t.mint]: { ...prev[t.mint], amount: String(amt) },
                                    }))
                                  }
                                  className={`px-2 py-1 rounded text-[10px] font-mono font-bold transition-colors ${
                                    bs.amount === String(amt)
                                      ? 'bg-cyan-500/30 text-cyan-200 border border-cyan-400/40'
                                      : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'
                                  }`}
                                >
                                  {amt} SOL
                                </button>
                              ))}
                            </div>

                            <input
                              type="number"
                              value={bs.amount}
                              onChange={(e) =>
                                setBuyState((prev) => ({
                                  ...prev,
                                  [t.mint]: { ...prev[t.mint], amount: e.target.value },
                                }))
                              }
                              step="any"
                              min="0.001"
                              placeholder="SOL amount"
                              className="w-24 rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 text-xs font-mono text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none transition-colors"
                            />

                            <button
                              onClick={() => void handleBuy(t.mint, t.symbol || t.mint.slice(0, 6))}
                              disabled={bs.status === 'sending' || !bs.amount || parseFloat(bs.amount) <= 0 || (turboMode && isDanger)}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                                turboMode
                                  ? 'bg-orange-500/20 hover:bg-orange-500/30 text-orange-200 border border-orange-500/30'
                                  : 'bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/30'
                              }`}
                            >
                              {bs.status === 'sending' ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : turboMode ? (
                                <Flame className="w-3.5 h-3.5" />
                              ) : (
                                <Zap className="w-3.5 h-3.5" />
                              )}
                              {bs.status === 'sending' ? 'Sending…' : turboMode ? 'BUY TURBO' : 'Confirm Buy'}
                            </button>

                            <button
                              onClick={closeBuy}
                              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-200 bg-white/5 hover:bg-white/10 transition-colors"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Safety warning for danger coins in turbo mode */}
                          {turboMode && isDanger && (
                            <div className="mt-2 flex items-center gap-2 text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                              <Skull className="w-3.5 h-3.5 shrink-0 animate-pulse" />
                              <span className="break-all">Whale danger detected — TURBO BUY disabled for this token. {(safety?.reasons || []).join(', ')}</span>
                            </div>
                          )}

                          {/* Result feedback */}
                          {bs.status === 'success' && (
                            <div className="mt-2 flex items-center gap-2 text-[11px] text-green-300">
                              <Check className="w-3.5 h-3.5" />
                              <span>{bs.message}</span>
                              {bs.signature && (
                                <a
                                  href={`https://solscan.io/tx/${bs.signature}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
                                >
                                  View tx <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                          )}
                          {bs.status === 'error' && (
                            <div className="mt-2 flex items-center gap-2 text-[11px] text-red-300">
                              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                              <span className="break-all">{bs.message}</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function TokenScoutTables({ turboMode }: { turboMode?: boolean }) {
  const allTokens = useTokenScout();

  const gainers = useMemo(() => {
    return allTokens
      .filter((t) => t.buyCount + t.sellCount >= 2 && t.changePct > 0)
      .sort((a, b) => b.changePct - a.changePct)
      .slice(0, 20);
  }, [allTokens]);

  const losers = useMemo(() => {
    return allTokens
      .filter((t) => t.buyCount + t.sellCount >= 2 && t.changePct < 0)
      .sort((a, b) => a.changePct - b.changePct)
      .slice(0, 20);
  }, [allTokens]);

  const newTokens = useMemo(() => {
    return allTokens
      .filter((t) => t.isPumpFun)
      .sort((a, b) => a.firstSeen - b.firstSeen)
      .slice(0, 10);
  }, [allTokens]);

  return (
    <Panel>
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-cyan-400" />
          <h3 className="font-display font-semibold text-white">Token Scout</h3>
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            <span className="text-[9px] font-bold text-emerald-300 tracking-wider">LIVE 1s</span>
          </span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-slate-500">
          <span className="flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            {allTokens.length} tokens tracked
          </span>
          <span className="flex items-center gap-1 text-cyan-400/70">
            <Zap className="w-3 h-3" />
            Quick-buy enabled
          </span>
        </div>
      </div>

      <div className="space-y-4">
        {/* Top 20 Gainers */}
        <TokenTable
          title="Top 20 Gainers"
          icon={<TrendingUp className="w-4 h-4 text-green-400" />}
          tokens={gainers}
          accent="green"
          defaultSort="changePct"
          defaultDir="desc"
          turboMode={turboMode}
        />

        {/* Top 20 Losers */}
        <TokenTable
          title="Top 20 Losers"
          icon={<TrendingDown className="w-4 h-4 text-red-400" />}
          tokens={losers}
          accent="red"
          defaultSort="changePct"
          defaultDir="asc"
          turboMode={turboMode}
        />

        {/* 10 New Tokens */}
        <TokenTable
          title="10 Newest pump.fun Tokens"
          icon={<Sparkles className="w-4 h-4 text-cyan-400" />}
          tokens={newTokens}
          accent="cyan"
          defaultSort="ageSeconds"
          defaultDir="asc"
          turboMode={turboMode}
        />
      </div>
    </Panel>
  );
}
