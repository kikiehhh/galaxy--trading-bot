import { useEffect, useState, useCallback } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Coins, Crown, Key, RefreshCw, Shield, TrendingUp, Wallet, Zap } from 'lucide-react';
import { fetchAgents, fetchLiveWallet, isBackendConfigured } from '@/lib/backend';
import type { AgentsStatus, AgentTrader, RiskManagerBOS, AgentsSummary, LiveWalletSnapshot } from '@/lib/backend';
import { AgentIcon, Panel, ProgressBar, StatusDot, Stat, Toggle } from './ui';
import { PnLChart } from './PnLChart';

export function AgentsTab() {
  const [data, setData] = useState<AgentsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const configured = isBackendConfigured();

  const load = useCallback(async () => {
    if (!configured) {
      setLoading(false);
      setError('Backend not configured — set VITE_BACKEND_URL to see live agent status.');
      return;
    }
    try {
      const result = await fetchAgents();
      setData(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load agent status');
    } finally {
      setLoading(false);
    }
  }, [configured]);

  useEffect(() => {
    void load();
    if (!configured) return;
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [load, configured]);

  if (loading) {
    return (
      <div className="glass-panel p-10 text-center text-slate-400">
        Loading agent status…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="glass-panel p-8 text-center">
        <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-3" />
        <p className="text-slate-300 mb-4">{error || 'No data available'}</p>
        <button onClick={() => void load()} className="btn-neon btn-ghost text-sm">
          <RefreshCw className="w-4 h-4 mr-1" /> Retry
        </button>
      </div>
    );
  }

  const { summary, riskManager, traders } = data;

  return (
    <div className="space-y-5">
      {/* Summary header */}
      <Panel glow className="animate-slide-up">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-galaxy-500 via-cyan-400 to-emerald-400 flex items-center justify-center">
              <Activity className="w-7 h-7 text-white" />
            </div>
            <div>
              <h2 className="font-display text-2xl font-bold text-white">Trading Agents</h2>
              <p className="text-sm text-slate-400">
                {summary.activeCount} of {summary.totalAgents} agents active · Live status from backend
              </p>
            </div>
          </div>
          <button onClick={() => void load()} className="btn-neon btn-ghost text-sm flex items-center gap-2">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
          <Stat label="Today PnL" value={`${summary.totalTodayPnl >= 0 ? '+' : ''}$${summary.totalTodayPnl.toFixed(2)}`} tone={summary.totalTodayPnl >= 0 ? 'green' : 'red'} />
          <Stat label="Total PnL" value={`${summary.totalPnl >= 0 ? '+' : ''}$${summary.totalPnl.toFixed(2)}`} tone={summary.totalPnl >= 0 ? 'green' : 'red'} />
          <Stat label="Win Rate" value={`${summary.winRate}%`} tone={summary.winRate >= 60 ? 'green' : 'default'} />
          <Stat label="Today Trades" value={summary.totalTrades} tone="cyan" />
          <Stat label="Total Spend/Trade" value={`$${summary.totalSpend.toFixed(3)}`} tone="cyan" />
        </div>
      </Panel>

      {/* Performance chart */}
      <PnLChart />

      {/* Wallet + auto-confirm status */}
      <WalletBanner summary={summary} />

      {/* Risk Manager BOS */}
      {riskManager && <RiskManagerCard rm={riskManager} />}

      {/* Agent cards */}
      <div>
        <h3 className="font-display font-semibold text-white mb-3 flex items-center gap-2">
          <Zap className="w-5 h-5 text-cyan-400" /> Trading Agents
        </h3>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {traders.map((t) => (
            <AgentStatusCard key={t.name} trader={t} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Wallet + auto-confirm banner ----------

function WalletBanner({ summary }: { summary: AgentsSummary }) {
  const walletConfigured = summary.walletConfigured ?? false;
  const autoConfirm = summary.autoConfirm ?? false;
  const address = summary.walletAddress ?? null;
  const [live, setLive] = useState<LiveWalletSnapshot | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  useEffect(() => {
    if (!walletConfigured) return;
    let cancelled = false;

    const loadBalance = async () => {
      setBalanceLoading(true);
      try {
        const result = await fetchLiveWallet();
        if (!cancelled) setLive(result);
      } catch {
        if (!cancelled) setLive(null);
      } finally {
        if (!cancelled) setBalanceLoading(false);
      }
    };

    void loadBalance();
    const id = setInterval(() => void loadBalance(), 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [walletConfigured]);

  const sol = live?.solBalance ?? 0;
  const solLow = sol > 0 && sol < 0.002;

  return (
    <Panel className="animate-slide-up">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${walletConfigured ? 'bg-emerald-500/15 border border-emerald-500/30' : 'bg-amber-500/15 border border-amber-500/30'}`}>
            {walletConfigured ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <Key className="w-5 h-5 text-amber-400" />}
          </div>
          <div>
            <div className="text-sm font-medium text-white">
              Trading Wallet {walletConfigured ? 'Connected' : 'Not Configured'}
            </div>
            {walletConfigured && address ? (
              <div className="text-xs font-mono text-slate-400">
                {address.slice(0, 6)}…{address.slice(-4)}
              </div>
            ) : (
              <div className="text-xs text-slate-400">
                Set TRADER_PRIVATE_KEY in .env (use a test wallet with ~0.001 SOL)
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className={`rounded-lg px-3 py-1.5 text-xs flex items-center gap-1.5 ${autoConfirm ? 'bg-emerald-500/15 border border-emerald-500/40 neon-text-green' : 'bg-white/5 border border-white/10 text-slate-400'}`}>
            <Zap className="w-3.5 h-3.5" /> Auto-Confirm: {autoConfirm ? 'ON' : 'OFF'}
          </div>
        </div>
      </div>

      {/* Live balance + token holdings */}
      {walletConfigured && (
        <div className="border-t border-white/10 pt-3">
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-cyan-400" />
              <span className="text-xs text-slate-400">SOL Balance</span>
              <span className={`font-mono text-sm ${solLow ? 'neon-text-red' : 'neon-text-cyan'}`}>
                {balanceLoading && !live ? '…' : `${sol.toFixed(6)} SOL`}
              </span>
              {solLow && (
                <span className="text-[10px] text-red-300/80 flex items-center gap-0.5">
                  <AlertTriangle className="w-3 h-3" /> Low
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Coins className="w-4 h-4 text-amber-400" />
              <span className="text-xs text-slate-400">Token Holdings</span>
              <span className="font-mono text-sm text-slate-200">
                {balanceLoading && !live ? '…' : live ? `${live.tokens.length}` : '0'}
              </span>
            </div>
            {live?.rpc?.error && (
              <span className="text-[10px] text-amber-300/70 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> {live.rpc.error}
              </span>
            )}
          </div>

          {/* Token list */}
          {live && live.tokens.length > 0 && (
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {live.tokens.map((tok) => (
                <div key={tok.mint} className="rounded-lg bg-white/5 px-2.5 py-1.5 text-xs flex items-center justify-between gap-2">
                  <span className="font-mono text-slate-300 truncate">{tok.mint.slice(0, 8)}…</span>
                  <span className="font-mono neon-text-cyan whitespace-nowrap">
                    {tok.amount < 0.01 ? '<0.01' : tok.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  </span>
                </div>
              ))}
            </div>
          )}
          {live && live.tokens.length === 0 && !live.rpc?.error && (
            <div className="text-xs text-slate-500">No SPL token holdings in this wallet.</div>
          )}
        </div>
      )}
    </Panel>
  );
}

// ---------- Risk Manager BOS card ----------

function RiskManagerCard({ rm }: { rm: RiskManagerBOS }) {
  const halted = rm.emergency_stop;

  return (
    <Panel glow={!halted} className="animate-slide-up">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-galaxy-500 to-cyan-400 flex items-center justify-center">
            <Crown className="w-7 h-7 text-white" />
          </div>
          <div>
            <h3 className="font-display text-xl font-bold text-white">{rm.display_name}</h3>
            <p className="text-xs text-slate-400 max-w-[280px] leading-snug">{rm.strategy}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <StatusDot status={rm.status === 'active' ? 'buying' : rm.status === 'halted' ? 'halted' : 'locked'} />
            <span className="text-[10px] uppercase tracking-wider text-slate-400">{rm.status}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-slate-400">Auto</span>
            <div className="opacity-60 pointer-events-none">
              <Toggle checked={rm.auto_risk} onChange={() => {}} label="Auto Risk" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 mb-4">
        <div>
          <div className="flex justify-between items-end mb-2">
            <span className="text-[10px] uppercase tracking-wider text-slate-400">Daily Spend</span>
            <span className="font-mono text-sm neon-text-cyan">
              ${rm.daily_spend_used.toFixed(2)} / ${rm.max_daily_spend.toFixed(2)}
            </span>
          </div>
          <ProgressBar value={rm.daily_spend_used} max={rm.max_daily_spend} tone="cyan" />
        </div>
        <div>
          <div className="flex justify-between items-end mb-2">
            <span className="text-[10px] uppercase tracking-wider text-slate-400">Daily PnL</span>
            <span className={`font-mono text-sm ${rm.daily_pnl_pct >= 0 ? 'neon-text-green' : 'neon-text-red'}`}>
              {rm.daily_pnl_pct >= 0 ? '+' : ''}{rm.daily_pnl_pct.toFixed(2)}%
            </span>
          </div>
          <ProgressBar
            value={Math.abs(rm.daily_pnl_pct)}
            max={Math.max(rm.daily_stop_loss_pct, rm.daily_take_profit_pct)}
            tone={rm.daily_pnl_pct >= 0 ? 'green' : 'red'}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Stop Loss" value={`-${rm.daily_stop_loss_pct}%`} tone="red" />
        <Stat label="Take Profit" value={`+${rm.daily_take_profit_pct}%`} tone="green" />
        <Stat label="Increase" value={`+${rm.auto_increase_pct}%`} tone="cyan" />
        <Stat label="Decrease" value={`-${rm.auto_decrease_pct}%`} tone="yellow" />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <div className={`rounded-lg px-3 py-1.5 text-xs flex items-center gap-1.5 ${rm.profit_locked ? 'bg-emerald-500/15 border border-emerald-500/40 neon-text-green' : 'bg-white/5 border border-white/10 text-slate-400'}`}>
          <TrendingUp className="w-3.5 h-3.5" /> Profit Locked: {rm.profit_locked ? 'YES' : 'NO'}
        </div>
        {halted && (
          <div className="rounded-lg px-3 py-1.5 text-xs flex items-center gap-1.5 bg-red-500/15 border border-red-500/40 neon-text-red">
            <Shield className="w-3.5 h-3.5" /> Emergency Stop Active
          </div>
        )}
        <div className="rounded-lg px-3 py-1.5 text-xs bg-white/5 border border-white/10 text-slate-400">
          Range: ${rm.min_spend.toFixed(2)} – ${rm.max_spend.toFixed(2)}
        </div>
      </div>
    </Panel>
  );
}

// ---------- Individual agent card ----------

function AgentStatusCard({ trader }: { trader: AgentTrader }) {
  const winRate =
    trader.today_wins + trader.today_losses > 0
      ? Math.round((trader.today_wins / (trader.today_wins + trader.today_losses)) * 100)
      : 0;

  const pnlTone = trader.today_pnl > 0 ? 'green' : trader.today_pnl < 0 ? 'red' : 'default';

  return (
    <Panel glow={trader.status === 'buying' || trader.status === 'selling'} className="animate-slide-up">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-galaxy-500/10 border border-galaxy-400/30 flex items-center justify-center">
            <AgentIcon name={trader.name} />
          </div>
          <div>
            <h4 className="font-display font-semibold text-lg text-white">{trader.display_name}</h4>
            <p className="text-xs text-slate-400 max-w-[200px] leading-snug">{trader.strategy}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusDot status={trader.status} />
          <span className="text-[10px] uppercase tracking-wider text-slate-400">{trader.status}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <Stat label="Spend/Trade" value={`$${trader.current_spend.toFixed(3)}`} tone="cyan" />
        <Stat label="Today PnL" value={`${trader.today_pnl >= 0 ? '+' : ''}$${trader.today_pnl.toFixed(2)}`} tone={pnlTone as 'green' | 'red' | 'default'} />
        <Stat label="Win Rate" value={`${winRate}%`} tone={winRate >= 60 ? 'green' : 'default'} />
      </div>

      <div className="grid grid-cols-4 gap-2 mb-3 text-center">
        <div className="rounded-lg bg-white/5 py-1.5">
          <div className="text-[10px] text-slate-400">Trades</div>
          <div className="font-mono text-sm text-slate-200">{trader.today_trades}</div>
        </div>
        <div className="rounded-lg bg-emerald-500/10 py-1.5">
          <div className="text-[10px] text-emerald-300/70">Wins</div>
          <div className="font-mono text-sm neon-text-green">{trader.today_wins}</div>
        </div>
        <div className="rounded-lg bg-red-500/10 py-1.5">
          <div className="text-[10px] text-red-300/70">Losses</div>
          <div className="font-mono text-sm neon-text-red">{trader.today_losses}</div>
        </div>
        <div className="rounded-lg bg-white/5 py-1.5">
          <div className="text-[10px] text-slate-400">Total</div>
          <div className={`font-mono text-sm ${trader.total_pnl >= 0 ? 'neon-text-green' : 'neon-text-red'}`}>
            ${trader.total_pnl.toFixed(2)}
          </div>
        </div>
      </div>

      <div className="mb-3">
        <div className="flex justify-between text-[10px] mb-1">
          <span className="text-emerald-300">W {trader.win_streak}</span>
          <span className="text-red-300">L {trader.lose_streak}</span>
        </div>
        <ProgressBar
          value={trader.win_streak}
          max={Math.max(3, trader.win_streak, trader.lose_streak)}
          tone={trader.win_streak > trader.lose_streak ? 'green' : 'red'}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        {trader.holding_token ? (
          <div className="rounded-lg bg-galaxy-500/10 border border-galaxy-400/20 px-3 py-1.5 text-xs">
            <span className="text-slate-400">Holding: </span>
            <span className="font-mono neon-text-cyan">{trader.holding_token.slice(0, 10)}…</span>
          </div>
        ) : (
          <div className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-slate-400">No position</div>
        )}
        <div className={`rounded-lg px-3 py-1.5 text-xs ${trader.active ? 'bg-emerald-500/10 border border-emerald-500/30 neon-text-green' : 'bg-white/5 border border-white/10 text-slate-400'}`}>
          {trader.active ? 'ACTIVE' : 'PAUSED'}
        </div>
      </div>
    </Panel>
  );
}
