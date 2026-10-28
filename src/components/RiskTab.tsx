import { engine } from '@/lib/engine';
import type { RiskSettings, Trader } from '@/lib/types';
import { Panel, ProgressBar, Slider, Stat, Toggle } from './ui';

export function RiskTab({
  settings,
  traders,
}: {
  settings: RiskSettings;
  traders: Trader[];
}) {
  const spendPct = (settings.daily_spend_used / settings.max_daily_spend) * 100;
  const pnlTone: 'green' | 'red' | 'yellow' =
    settings.daily_pnl_pct <= -settings.daily_stop_loss_pct
      ? 'red'
      : settings.daily_pnl_pct >= settings.daily_take_profit_pct
        ? 'green'
        : 'yellow';

  const dailyHalted = settings.emergency_stop;

  return (
    <div className="space-y-4">
      {/* BOS header */}
      <Panel glow className="animate-slide-up">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-galaxy-500 to-cyan-400 flex items-center justify-center text-2xl">
              👑
            </div>
            <div>
              <h2 className="font-display text-2xl font-bold text-white">RISK MANAGER — BOS</h2>
              <p className="text-sm text-slate-400">
                Controls spend for all 6 traders. {settings.auto_risk ? 'AUTO mode active' : 'Manual mode'}.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Auto Risk</div>
              <div className={`text-sm font-semibold ${settings.auto_risk ? 'neon-text-green' : 'neon-text-yellow'}`}>
                {settings.auto_risk ? 'ON' : 'OFF'}
              </div>
            </div>
            <Toggle
              checked={settings.auto_risk}
              onChange={(v) => engine.updateSettings({ auto_risk: v })}
              label="Auto Risk"
            />
          </div>
        </div>
      </Panel>

      {/* Daily overview */}
      <div className="grid gap-4 md:grid-cols-2">
        <Panel>
          <h3 className="font-display font-semibold text-white mb-3 flex items-center gap-2">
            📊 Daily Spend
          </h3>
          <div className="flex items-end justify-between mb-2">
            <div>
              <span className="font-mono text-3xl neon-text-cyan">${settings.daily_spend_used.toFixed(2)}</span>
              <span className="text-slate-400 text-sm"> / ${settings.max_daily_spend.toFixed(2)}</span>
            </div>
            <span className="stat-pill bg-galaxy-500/20 text-cyan-300">{spendPct.toFixed(1)}%</span>
          </div>
          <ProgressBar value={settings.daily_spend_used} max={settings.max_daily_spend} tone="cyan" />
          <div className="grid grid-cols-2 gap-3 mt-4">
            <Stat label="Daily PnL" value={`${settings.daily_pnl_pct >= 0 ? '+' : ''}${settings.daily_pnl_pct.toFixed(2)}%`} tone={pnlTone} />
            <Stat label="Profit Locked" value={settings.profit_locked ? 'YES' : 'NO'} tone={settings.profit_locked ? 'green' : 'default'} />
          </div>
        </Panel>

        <Panel>
          <h3 className="font-display font-semibold text-white mb-3 flex items-center gap-2">
            🛑 Daily Limits
          </h3>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-red-300">Stop Loss: -{settings.daily_stop_loss_pct}%</span>
                <span className={`font-mono ${settings.daily_pnl_pct <= -settings.daily_stop_loss_pct ? 'neon-text-red' : 'text-slate-400'}`}>
                  {settings.daily_pnl_pct.toFixed(2)}%
                </span>
              </div>
              <ProgressBar value={Math.abs(Math.min(0, settings.daily_pnl_pct))} max={settings.daily_stop_loss_pct} tone="red" />
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-emerald-300">Take Profit: +{settings.daily_take_profit_pct}%</span>
                <span className={`font-mono ${settings.daily_pnl_pct >= settings.daily_take_profit_pct ? 'neon-text-green' : 'text-slate-400'}`}>
                  {settings.daily_pnl_pct.toFixed(2)}%
                </span>
              </div>
              <ProgressBar value={Math.max(0, settings.daily_pnl_pct)} max={settings.daily_take_profit_pct} tone="green" />
            </div>
          </div>
          {dailyHalted && (
            <div className="mt-4 rounded-lg bg-red-500/15 border border-red-500/40 px-3 py-2 text-sm neon-text-red flex items-center justify-between">
              <span>Trading halted for the day</span>
              <button onClick={() => engine.clearEmergency()} className="btn-ghost text-xs px-3 py-1">
                Clear
              </button>
            </div>
          )}
        </Panel>
      </div>

      {/* Per-agent table */}
      <Panel>
        <h3 className="font-display font-semibold text-white mb-3 flex items-center gap-2">
          🤖 Per-Agent Risk State
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 border-b border-white/10">
                <th className="py-2 pr-3">Agent</th>
                <th className="py-2 pr-3">Spend</th>
                <th className="py-2 pr-3">Win Streak</th>
                <th className="py-2 pr-3">Lose Streak</th>
                <th className="py-2 pr-3">Today PnL</th>
                <th className="py-2 pr-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {traders.map((t) => (
                <tr key={t.name} className="border-b border-white/5">
                  <td className="py-2 pr-3 font-medium text-white">{t.display_name}</td>
                  <td className="py-2 pr-3 font-mono neon-text-cyan">${t.current_spend.toFixed(3)}</td>
                  <td className="py-2 pr-3 font-mono">
                    <span className={t.win_streak >= 3 ? 'neon-text-green' : 'text-slate-300'}>
                      {t.win_streak}
                      {t.win_streak >= 3 && ' 🔥'}
                    </span>
                  </td>
                  <td className="py-2 pr-3 font-mono">
                    <span className={t.lose_streak >= 2 ? 'neon-text-red' : 'text-slate-300'}>
                      {t.lose_streak}
                      {t.lose_streak >= 2 && ' ⚠️'}
                    </span>
                  </td>
                  <td className={`py-2 pr-3 font-mono ${t.today_pnl >= 0 ? 'neon-text-green' : 'neon-text-red'}`}>
                    {t.today_pnl >= 0 ? '+' : ''}${t.today_pnl.toFixed(2)}
                  </td>
                  <td className="py-2 pr-3 text-slate-300">{t.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Risk settings */}
      <Panel>
        <h3 className="font-display font-semibold text-white mb-4 flex items-center gap-2">
          ⚙️ Risk Settings
        </h3>
        <div className="grid gap-5 md:grid-cols-2">
          <SettingRow
            label="Max Daily Spend"
            value={`$${settings.max_daily_spend.toFixed(2)}`}
            slider={
              <Slider
                value={settings.max_daily_spend}
                min={1}
                max={50}
                step={0.5}
                onChange={(v) => engine.updateSettings({ max_daily_spend: v })}
                format={(v) => `$${v.toFixed(2)}`}
              />
            }
          />
          <SettingRow
            label="Auto Increase % (on win streak)"
            value={`+${settings.auto_increase_pct}%`}
            slider={
              <Slider
                value={settings.auto_increase_pct}
                min={5}
                max={50}
                step={1}
                onChange={(v) => engine.updateSettings({ auto_increase_pct: v })}
                format={(v) => `+${v}%`}
              />
            }
          />
          <SettingRow
            label="Auto Decrease % (on lose streak)"
            value={`-${settings.auto_decrease_pct}%`}
            slider={
              <Slider
                value={settings.auto_decrease_pct}
                min={5}
                max={60}
                step={1}
                onChange={(v) => engine.updateSettings({ auto_decrease_pct: v })}
                format={(v) => `-${v}%`}
              />
            }
          />
          <SettingRow
            label="Daily Stop Loss"
            value={`-${settings.daily_stop_loss_pct}%`}
            slider={
              <Slider
                value={settings.daily_stop_loss_pct}
                min={1}
                max={30}
                step={1}
                onChange={(v) => engine.updateSettings({ daily_stop_loss_pct: v })}
                format={(v) => `-${v}%`}
              />
            }
          />
          <SettingRow
            label="Daily Take Profit"
            value={`+${settings.daily_take_profit_pct}%`}
            slider={
              <Slider
                value={settings.daily_take_profit_pct}
                min={5}
                max={100}
                step={1}
                onChange={(v) => engine.updateSettings({ daily_take_profit_pct: v })}
                format={(v) => `+${v}%`}
              />
            }
          />
          <SettingRow
            label="Per-Trade Range"
            value={`$${settings.min_spend.toFixed(2)} – $${settings.max_spend.toFixed(2)}`}
            slider={
              <div className="space-y-2">
                <Slider
                  value={settings.min_spend}
                  min={0.01}
                  max={0.5}
                  step={0.01}
                  onChange={(v) => engine.updateSettings({ min_spend: Math.min(v, settings.max_spend) })}
                  format={(v) => `Min $${v.toFixed(2)}`}
                />
                <Slider
                  value={settings.max_spend}
                  min={0.05}
                  max={1.0}
                  step={0.05}
                  onChange={(v) => engine.updateSettings({ max_spend: Math.max(v, settings.min_spend) })}
                  format={(v) => `Max $${v.toFixed(2)}`}
                />
              </div>
            }
          />
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <button onClick={() => engine.resetDaily()} className="btn-ghost text-sm">
            Reset Daily Counters
          </button>
        </div>
      </Panel>

      {/* Spend sparkline (live-ish) */}
      <SpendSparkline traders={traders} />
    </div>
  );
}

function SettingRow({
  label,
  value,
  slider,
}: {
  label: string;
  value: string;
  slider: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-xs text-slate-400">{label}</span>
        <span className="font-mono text-sm neon-text-cyan">{value}</span>
      </div>
      {slider}
    </div>
  );
}

function SpendSparkline({ traders }: { traders: Trader[] }) {
  const maxSpend = Math.max(...traders.map((t) => t.current_spend), 0.05);
  return (
    <Panel>
      <h3 className="font-display font-semibold text-white mb-3 flex items-center gap-2">
        📈 Live Spend Per Agent
      </h3>
      <div className="flex items-end justify-around h-32 gap-3">
        {traders.map((t) => {
          const h = (t.current_spend / maxSpend) * 100;
          return (
            <div key={t.name} className="flex flex-col items-center gap-1 flex-1">
              <div className="text-[10px] font-mono neon-text-cyan">${t.current_spend.toFixed(3)}</div>
              <div className="w-full max-w-[60px] bg-white/5 rounded-t-lg overflow-hidden flex items-end h-24">
                <div
                  className="w-full bg-gradient-to-t from-galaxy-600 to-cyan-400 transition-all duration-700"
                  style={{ height: `${h}%`, boxShadow: '0 0 12px rgba(34,211,238,0.4)' }}
                />
              </div>
              <div className="text-[10px] text-slate-400">{t.display_name}</div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
