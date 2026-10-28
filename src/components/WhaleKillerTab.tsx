import { useState, useCallback } from 'react';
import { Skull, Waves, TrendingUp, TrendingDown, Zap, ExternalLink, Activity, Crosshair, Users, BarChart3, Brain, CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';
import { Panel, Stat, shortenAddr } from './ui';
import { useWhaleKiller } from '@/lib/hooks';
import { whaleKiller } from '@/lib/whaleKiller';
import type { WhaleBuy, ChartSignal } from '@/lib/whaleKiller';

function fmtSol(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(2)}K SOL`;
  return `${n.toFixed(4)} SOL`;
}

function fmtMc(mc: number): string {
  if (mc >= 1_000_000) return `$${(mc / 1_000_000).toFixed(2)}M`;
  if (mc >= 1_000) return `$${(mc / 1_000).toFixed(1)}K`;
  return `$${mc.toFixed(0)}`;
}

function fmtAge(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function signalColor(score: number): string {
  if (score >= 68) return 'text-green-400 bg-green-500/10 border-green-500/20';
  if (score >= 40) return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
  return 'text-red-400 bg-red-500/10 border-red-500/20';
}

function actionBadge(action: string): { label: string; icon: typeof Zap; cls: string } {
  switch (action) {
    case 'bought':
      return { label: 'KILLER BOUGHT', icon: Zap, cls: 'text-cyan-300 bg-cyan-500/15 border-cyan-500/30' };
    case 'sold':
      return { label: 'SOLD', icon: CheckCircle, cls: 'text-purple-300 bg-purple-500/15 border-purple-500/30' };
    case 'skipped':
      return { label: 'SKIPPED', icon: XCircle, cls: 'text-slate-400 bg-white/5 border-white/10' };
    default:
      return { label: 'PENDING', icon: Clock, cls: 'text-amber-300 bg-amber-500/10 border-amber-500/20' };
  }
}

export function WhaleKillerTab() {
  const snap = useWhaleKiller();
  const [following, setFollowing] = useState<Set<string>>(new Set());

  const handleFollow = useCallback(async (buyId: string) => {
    setFollowing((prev) => new Set(prev).add(buyId));
    try {
      await whaleKiller.manualFollow(buyId);
    } catch {
      // silent
    }
    setTimeout(() => {
      setFollowing((prev) => {
        const next = new Set(prev);
        next.delete(buyId);
        return next;
      });
    }, 2000);
  }, []);

  const winrate = snap.killerBuys > 0
    ? ((snap.killerWins / snap.killerBuys) * 100).toFixed(1)
    : '—';

  return (
    <div className="space-y-4">
      {/* Bot Header */}
      <Panel glow className="animate-slide-up">
        <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-500 via-orange-500 to-amber-400 flex items-center justify-center" style={{ boxShadow: '0 0 24px rgba(239,68,68,0.4)' }}>
              <Skull className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="font-display text-2xl font-bold text-white flex items-center gap-2">
                WHALE KILLING
                <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/15">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  </span>
                  <span className="text-[9px] font-bold text-emerald-300 tracking-wider">ACTIVE</span>
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Senior HFT sniping bot · Reads whale-buy graph + chart signals · Follows whale accumulation in real-time
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-orange-400" />
            <span className="text-xs text-slate-400">Chart-reading AI engine</span>
          </div>
        </div>

        {/* Bot Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Whales Tracked" value={snap.trackedWhaleCount} tone="cyan" />
          <Stat label="Killer Buys" value={snap.killerBuys} tone="orange" />
          <Stat label="Win Rate" value={`${winrate}%`} tone={snap.killerWins >= snap.killerLosses ? 'green' : 'red'} />
          <Stat label="Killer PnL" value={fmtSol(snap.killerPnlSol)} tone={snap.killerPnlSol >= 0 ? 'green' : 'red'} />
        </div>

        <div className="grid grid-cols-3 gap-4 mt-3">
          <Stat label="Wins" value={snap.killerWins} tone="green" />
          <Stat label="Losses" value={snap.killerLosses} tone="red" />
          <Stat label="Total Whale Buys" value={snap.totalWhaleBuys} tone="purple" />
        </div>
      </Panel>

      {/* Whale Buys Table */}
      <Panel>
        <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Waves className="w-5 h-5 text-cyan-400" />
            <h3 className="font-display font-semibold text-white">Whale Token Buys</h3>
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              <span className="text-[9px] font-bold text-emerald-300 tracking-wider">LIVE 2s</span>
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-slate-500">
            <BarChart3 className="w-3 h-3" />
            <span>{snap.whaleBuys.length} whale buys tracked</span>
          </div>
        </div>

        {snap.whaleBuys.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-3">
              <Waves className="w-8 h-8 text-slate-600" />
            </div>
            <div className="text-sm text-slate-400 font-medium">No whale buys detected yet</div>
            <div className="text-xs text-slate-500 mt-1 max-w-md">
              The WHALE KILLING bot is watching all tracked whale wallets. When a whale buys a token on pump.fun,
              it will appear here with full chart analysis and a follow-buy option.
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto rounded-xl border border-white/10">
            <table className="w-full">
              <thead className="sticky top-0 bg-black/40 backdrop-blur-sm z-10">
                <tr className="border-b border-white/10">
                  <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">Whale</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">Token</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">Whale Spend</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">Market Cap</th>
                  <th className="px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-slate-400">Chart Signal</th>
                  <th className="px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-slate-400">Killer Action</th>
                  <th className="px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-slate-400">Follow</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-slate-400">Time</th>
                </tr>
              </thead>
              <tbody>
                {snap.whaleBuys.map((buy) => {
                  const signal = snap.signals[buy.token_mint];
                  return (
                    <WhaleBuyRow
                      key={buy.id}
                      buy={buy}
                      signal={signal}
                      following={following.has(buy.id)}
                      onFollow={() => void handleFollow(buy.id)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function WhaleBuyRow({ buy, signal, following, onFollow }: {
  buy: WhaleBuy;
  signal?: ChartSignal;
  following: boolean;
  onFollow: () => void;
}) {
  const badge = actionBadge(buy.killer_action);
  const BadgeIcon = badge.icon;
  const pnlPositive = buy.killer_pnl_sol > 0;
  const pnlNegative = buy.killer_pnl_sol < 0;

  return (
    <tr className="border-b border-white/5 hover:bg-white/[0.03] transition-colors">
      {/* Whale */}
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-base">🐋</span>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-white truncate max-w-[120px]">
              {buy.whale_label || 'Whale'}
            </div>
            <div className="text-[9px] text-slate-500 font-mono truncate max-w-[120px]">
              {shortenAddr(buy.whale_address, 6, 4)}
            </div>
          </div>
        </div>
      </td>

      {/* Token */}
      <td className="px-3 py-2.5 min-w-[140px]">
        <div className="flex items-center gap-2">
          {buy.image_uri ? (
            <img
              src={buy.image_uri}
              alt={buy.token_symbol || ''}
              className="w-7 h-7 rounded-full shrink-0 border border-white/10 object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-orange-500/20 to-red-500/20 border border-white/10 flex items-center justify-center shrink-0">
              <Skull className="w-3.5 h-3.5 text-orange-400" />
            </div>
          )}
          <div className="min-w-0">
            <div className="text-xs font-semibold text-white truncate max-w-[120px]">
              {buy.token_symbol || 'UNKNOWN'}
            </div>
            <div className="text-[9px] text-slate-500 font-mono truncate max-w-[120px]">
              {buy.token_mint.slice(0, 6)}…{buy.token_mint.slice(-4)}
            </div>
          </div>
        </div>
      </td>

      {/* Whale spend */}
      <td className="px-3 py-2.5 text-right">
        <span className="text-xs font-mono font-semibold text-cyan-300 tabular-nums">
          {fmtSol(buy.sol_amount)}
        </span>
      </td>

      {/* Market cap */}
      <td className="px-3 py-2.5 text-right">
        <span className="text-xs font-mono text-slate-200 tabular-nums">{fmtMc(buy.market_cap)}</span>
        {buy.is_raydium_pool && (
          <div className="text-[9px] text-purple-400">Raydium</div>
        )}
      </td>

      {/* Chart signal */}
      <td className="px-3 py-2.5 text-center min-w-[180px]">
        {signal ? (
          <div className="space-y-1">
            <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-bold ${signalColor(signal.score)}`}>
              <Activity className="w-3 h-3" />
              {signal.score}/100
            </div>
            <div className="text-[9px] text-slate-500 max-w-[180px] mx-auto leading-tight">
              {signal.label}
            </div>
          </div>
        ) : buy.chart_signal ? (
          <div className="text-[9px] text-slate-500 max-w-[180px] mx-auto leading-tight">
            {buy.chart_signal}
          </div>
        ) : (
          <span className="text-[10px] text-slate-600">No signal</span>
        )}
      </td>

      {/* Killer action */}
      <td className="px-3 py-2.5 text-center">
        <div className="flex flex-col items-center gap-1">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[9px] font-bold ${badge.cls}`}>
            <BadgeIcon className="w-2.5 h-2.5" />
            {badge.label}
          </span>
          {buy.killer_action === 'sold' && (
            <span className={`text-[10px] font-mono font-semibold ${pnlPositive ? 'text-green-400' : pnlNegative ? 'text-red-400' : 'text-slate-400'}`}>
              {buy.killer_pnl_sol >= 0 ? '+' : ''}{fmtSol(buy.killer_pnl_sol)}
            </span>
          )}
        </div>
      </td>

      {/* Follow button */}
      <td className="px-3 py-2.5 text-center">
        {buy.killer_action === 'pending' ? (
          <button
            onClick={onFollow}
            disabled={following}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-orange-500/15 hover:bg-orange-500/25 text-orange-300 border border-orange-500/20 hover:border-orange-400/40 transition-all disabled:opacity-50"
            title="Follow this whale buy now"
          >
            {following ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            {following ? 'Following…' : 'Follow'}
          </button>
        ) : buy.killer_action === 'bought' ? (
          <span className="text-[10px] text-cyan-400 font-semibold">Auto-followed</span>
        ) : (
          <span className="text-[10px] text-slate-500">—</span>
        )}
      </td>

      {/* Time */}
      <td className="px-3 py-2.5 text-right">
        <span className="text-[10px] text-slate-500 font-mono">{fmtAge(buy.created_at)}</span>
        <div>
          <a
            href={`https://pump.fun/${buy.token_mint}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block p-1 rounded bg-white/5 hover:bg-white/10 transition-colors mt-0.5"
            title="View on pump.fun"
          >
            <ExternalLink className="w-2.5 h-2.5 text-slate-400" />
          </a>
        </div>
      </td>
    </tr>
  );
}
