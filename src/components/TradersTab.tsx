import { engine } from '@/lib/engine';
import type { Trader } from '@/lib/types';
import { AgentIcon, Panel, ProgressBar, Slider, StatusDot, Stat } from './ui';

export function TradersTab({ traders }: { traders: Trader[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {traders.map((t) => (
        <TraderCard key={t.name} trader={t} />
      ))}
    </div>
  );
}

function TraderCard({ trader }: { trader: Trader }) {
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
            <h3 className="font-display font-semibold text-lg text-white">{trader.display_name}</h3>
            <p className="text-xs text-slate-400 max-w-[200px] leading-snug">{trader.strategy}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusDot status={trader.status} />
          <span className="text-[10px] uppercase tracking-wider text-slate-400">{trader.status}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
        <Stat label="Spend/Trade" value={`${trader.current_spend.toFixed(3)}`} tone="cyan" />
        <Stat label="Today PnL" value={`${trader.today_pnl >= 0 ? '+' : ''}${trader.today_pnl.toFixed(2)}`} tone={pnlTone as 'green' | 'red' | 'default'} />
        <Stat label="Win Rate" value={`${winRate}%`} tone={winRate >= 60 ? 'green' : 'default'} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 text-center">
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

      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1">
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
      </div>

      {trader.holding_token && (
        <div className="mb-3 rounded-lg bg-galaxy-500/10 border border-galaxy-400/20 px-3 py-2 text-xs">
          <span className="text-slate-400">Holding: </span>
          <span className="font-mono neon-text-cyan">{trader.holding_token.slice(0, 10)}…</span>
        </div>
      )}

      <div className="space-y-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">Per-trade spend</div>
          <Slider
            value={trader.current_spend}
            min={0.01}
            max={1.0}
            step={0.005}
            onChange={(v) => engine.setTraderSpend(trader.name, v)}
            format={(v) => `$${v.toFixed(3)}`}
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => engine.toggleTraderActive(trader.name, !trader.active)}
            className={`flex-1 btn-neon text-xs ${trader.active ? 'btn-ghost' : 'btn-primary'}`}
          >
            {trader.active ? 'Pause Agent' : 'Activate Agent'}
          </button>
        </div>
      </div>
    </Panel>
  );
}
