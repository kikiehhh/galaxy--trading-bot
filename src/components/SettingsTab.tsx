import { useState, useEffect } from 'react';
import { Send, Loader2, Check, AlertCircle, MessageCircle } from 'lucide-react';
import { engine } from '@/lib/engine';
import type { RiskSettings } from '@/lib/types';
import { Panel, Stat } from './ui';
import type { BackendStatus } from '@/lib/backend';
import { setAutoTrade, emergencySellAll as backendEmergency, setLiveMainnet, fetchTelegramConfig, saveTelegramConfig, sendTelegramTest, type TelegramConfig } from '@/lib/backend';

export function SettingsTab({
  settings,
  running,
  onToggleRun,
  feedStatus,
  eventCount,
  latestToken,
  backendStatus,
  backendConfigured,
  backendUrl,
}: {
  settings: RiskSettings;
  running: boolean;
  onToggleRun: () => void;
  feedStatus: string;
  eventCount: number;
  latestToken: string;
  backendStatus: BackendStatus | null;
  backendConfigured: boolean;
  backendUrl: string;
}) {
  const [liveMainnet, setLiveMainnetState] = useState<boolean>(backendStatus?.liveMainnet ?? false);
  const [liveToggling, setLiveToggling] = useState(false);
  const [autoTradeOptimistic, setAutoTradeOptimistic] = useState<boolean | null>(null);
  const [autoTradeToggling, setAutoTradeToggling] = useState(false);
  const [autoTradeError, setAutoTradeError] = useState<string | null>(null);
  const [emergencyLoading, setEmergencyLoading] = useState(false);
  const [emergencyResult, setEmergencyResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Telegram config
  const [tgConfig, setTgConfig] = useState<TelegramConfig | null>(null);
  const [tgBotToken, setTgBotToken] = useState('');
  const [tgChatId, setTgChatId] = useState('');
  const [tgSaving, setTgSaving] = useState(false);
  const [tgTesting, setTgTesting] = useState(false);
  const [tgResult, setTgResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    void fetchTelegramConfig().then((c) => setTgConfig(c)).catch(() => {});
  }, []);

  useEffect(() => {
    if (backendStatus?.liveMainnet !== undefined) {
      setLiveMainnetState(backendStatus.liveMainnet);
    }
  }, [backendStatus?.liveMainnet]);

  async function handleToggleLiveMainnet() {
    const next = !liveMainnet;
    setLiveToggling(true);
    try {
      await setLiveMainnet(next);
      setLiveMainnetState(next);
    } catch {
      // leave state as-is on failure
    } finally {
      setLiveToggling(false);
    }
  }

  async function handleToggleAutoTrade() {
    if (!backendStatus) return;
    const next = !backendStatus.autoTradeEnabled;
    setAutoTradeToggling(true);
    setAutoTradeOptimistic(next);
    setAutoTradeError(null);
    try {
      await setAutoTrade(next);
    } catch (e) {
      setAutoTradeOptimistic(null);
      setAutoTradeError(e instanceof Error ? e.message : 'Failed to toggle auto-trade');
    } finally {
      setAutoTradeToggling(false);
    }
  }

  async function handleBackendEmergency() {
    setEmergencyLoading(true);
    setEmergencyResult(null);
    try {
      const result = await backendEmergency();
      setEmergencyResult({ ok: true, message: result.message || 'Emergency sell complete' });
    } catch (e) {
      setEmergencyResult({ ok: false, message: e instanceof Error ? e.message : 'Emergency sell failed' });
    } finally {
      setEmergencyLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Panel glow className="animate-slide-up">
        <h2 className="font-display text-2xl font-bold text-white mb-1 flex items-center gap-2">
          ⚙️ Settings & Connections
        </h2>
        <p className="text-sm text-slate-400">
          All connections use free public endpoints. No API keys required.
        </p>
      </Panel>

      {liveMainnet && (
        <div className="rounded-xl border-2 border-red-500/60 bg-red-500/15 px-4 py-3 animate-slide-up">
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
            </span>
            <span className="font-display font-bold text-lg text-red-300 tracking-wide">
              LIVE MAINNET — Real SOL will be spent
            </span>
          </div>
          <p className="text-xs text-red-200/80 mt-1 pl-5">
            Auto-trading is active. Every buy order submits a real on-chain transaction signed by your configured wallet.
          </p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Panel>
          <h3 className="font-display font-semibold text-white mb-3">🔌 Data Feeds</h3>
          <div className="space-y-3">
            <FeedRow
              name="PumpPortal Public"
              url="wss://pumpportal.fun/api/data"
              status={feedStatus}
              note="Free public trades + token creation stream"
            />
            <FeedRow
              name="Helius Mainnet RPC"
              url={backendConfigured && backendStatus ? 'connected (backend)' : 'HELIUS_RPC (env)'}
              status={backendConfigured && backendStatus && !backendStatus.walletError ? 'connected' : 'ready'}
              note="Solana mainnet RPC for transactions"
            />
            <FeedRow
              name="Jupiter Public"
              url="https://quote-api.jup.ag/v6 (public)"
              status={backendConfigured && backendStatus ? 'connected' : 'ready'}
              note="Public Jupiter swap quoting — no API key"
            />
          </div>
          <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between">
            <Stat label="Feed Events" value={eventCount} tone="cyan" />
            <Stat label="Latest Token" value={latestToken || '—'} tone="purple" mono={false} />
          </div>
        </Panel>

        <Panel>
          <h3 className="font-display font-semibold text-white mb-3">🚀 Engine Control</h3>
          <div className="space-y-3">
            {/* LIVE MAINNET toggle */}
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-white">LIVE MAINNET</div>
                  <div className="text-[11px] text-slate-400">
                    {liveMainnet
                      ? 'Real SOL is being spent on every auto-buy.'
                      : 'Engine runs in paper/simulation mode — no real transactions.'}
                  </div>
                </div>
                <button
                  onClick={handleToggleLiveMainnet}
                  disabled={liveToggling}
                  className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors duration-200 disabled:opacity-50 ${
                    liveMainnet ? 'bg-red-500' : 'bg-slate-600'
                  }`}
                  aria-label="Toggle live mainnet trading"
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform duration-200 ${
                      liveMainnet ? 'translate-x-8' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              {backendStatus && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono">
                  <span className={liveMainnet ? 'neon-text-red' : 'text-slate-400'}>
                    liveMainnet: {liveMainnet ? 'ON' : 'OFF'}
                  </span>
                  <span className="text-slate-400">
                    min balance: {backendStatus.minWalletBalanceSol ?? 0.005} SOL
                  </span>
                  <span className={backendStatus.walletFunded ? 'neon-text-green' : 'neon-text-red'}>
                    wallet: {backendStatus.walletFunded ? 'funded' : 'low balance'}
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={onToggleRun}
              className={`w-full btn-neon ${running ? 'btn-danger' : 'btn-primary'}`}
            >
              {running ? '⏸ Stop Trading Engine' : '▶ Start Trading Engine'}
            </button>
            <button
              onClick={() => engine.emergencySellAll()}
              className="w-full btn-danger text-base py-3"
            >
              🚨 EMERGENCY SELL ALL
            </button>
            <p className="text-xs text-slate-400">
              Emergency Sell All halts every agent, clears all holdings, and triggers the master
              kill switch. Use only in crisis.
            </p>
            <div className="flex items-center justify-between pt-2 border-t border-white/10">
              <Stat label="Emergency Stop" value={settings.emergency_stop ? 'ACTIVE' : 'clear'} tone={settings.emergency_stop ? 'red' : 'green'} />
              <Stat label="Auto Risk" value={settings.auto_risk ? 'ON' : 'OFF'} tone={settings.auto_risk ? 'green' : 'yellow'} />
            </div>
          </div>
        </Panel>
      </div>

      {backendConfigured && (
        <Panel glow className="animate-slide-up">
          <h3 className="font-display font-semibold text-white mb-3 flex items-center gap-2">
            🛰️ Live Trading Backend
          </h3>
          {backendStatus ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Stat label="Mode" value={backendStatus.mode.toUpperCase()} tone={backendStatus.mode === 'live' ? 'green' : backendStatus.mode === 'paper' ? 'cyan' : 'yellow'} />
                <Stat label="SOL Balance" value={`${backendStatus.solBalance.toFixed(4)} SOL`} tone="cyan" />
                <Stat label="Auto-Buys" value={backendStatus.totalAutoBuys} tone="green" />
                <Stat label="Tracked Whales" value={backendStatus.trackedWhales} tone="purple" />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Stat label="Auto-Trade" value={backendStatus.autoTradeEnabled ? 'ON' : 'OFF'} tone={backendStatus.autoTradeEnabled ? 'green' : 'red'} />
                <Stat label="Auto-Buy SOL" value={`${backendStatus.autoBuySol}`} tone="cyan" />
                <Stat label="Feed Events" value={backendStatus.feedEvents} tone="cyan" />
                <Stat label="Uptime" value={`${Math.floor(backendStatus.uptime / 60)}m`} tone="default" />
              </div>
              {backendStatus.wallet && (
                <div className="text-xs">
                  <span className="text-slate-400">Wallet: </span>
                  <span className="font-mono neon-text-cyan">{backendStatus.wallet.slice(0, 6)}…{backendStatus.wallet.slice(-4)}</span>
                </div>
              )}
              {backendStatus.walletError && (
                <div className="rounded-lg bg-orange-500/10 border border-orange-500/30 px-3 py-2 text-xs text-orange-300">
                  Wallet not configured on backend: {backendStatus.walletError}
                </div>
              )}
              {backendStatus.lastAutoBuy && (
                <div className="rounded-lg bg-white/5 px-3 py-2 text-xs">
                  <span className="text-slate-400">Last auto-buy: </span>
                  <span className="font-mono">{backendStatus.lastAutoBuy.mint.slice(0, 10)}…</span>
                  {' · '}
                  <span className={backendStatus.lastAutoBuy.ok ? 'neon-text-green' : 'neon-text-red'}>
                    {backendStatus.lastAutoBuy.ok ? 'SUCCESS' : 'FAILED'}
                  </span>
                </div>
              )}
              {backendStatus.lastError && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs neon-text-red">
                  Last error: {backendStatus.lastError}
                </div>
              )}
              <div className="flex flex-wrap gap-2 pt-2 border-t border-white/10">
                <button
                  onClick={() => void handleToggleAutoTrade()}
                  disabled={autoTradeToggling}
                  className={`btn-neon text-sm ${(autoTradeOptimistic ?? backendStatus.autoTradeEnabled) ? 'btn-danger' : 'btn-primary'} disabled:opacity-50`}
                >
                  {autoTradeToggling ? 'Toggling…' : (autoTradeOptimistic ?? backendStatus.autoTradeEnabled) ? 'Disable Auto-Trade' : 'Enable Auto-Trade'}
                </button>
                <button
                  onClick={() => void handleBackendEmergency()}
                  disabled={emergencyLoading}
                  className="btn-danger text-sm disabled:opacity-50"
                >
                  {emergencyLoading ? 'Selling…' : 'Backend Emergency Stop'}
                </button>
              </div>
              {autoTradeError && (
                <div className="mt-2 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" /> {autoTradeError}
                </div>
              )}
              {emergencyResult && (
                <div className={`mt-2 rounded-lg px-3 py-2 text-xs flex items-center gap-2 ${emergencyResult.ok ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border border-red-500/30 text-red-300'}`}>
                  {emergencyResult.ok ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  {emergencyResult.message}
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-slate-400">
              Connecting to backend at <span className="font-mono text-slate-300">{backendUrl}</span>…
            </div>
          )}
        </Panel>
      )}

      <Panel>
        <h3 className="font-display font-semibold text-white mb-3 flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-cyan-400" />
          Telegram Bot Alerts
        </h3>
        <p className="text-xs text-slate-400 mb-4">
          Get notified in your Telegram channel whenever the Self-Heal Bot auto-generates a wallet, switches RPCs, or detects degraded services.
        </p>
        {tgConfig?.configured && (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 mb-4 text-xs text-emerald-300 flex items-center gap-2">
            <Check className="w-4 h-4" /> Connected{tgConfig.chatIdPreview ? ` — Chat ID: ${tgConfig.chatIdPreview}` : ''}
          </div>
        )}
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Bot Token</label>
            <input
              type="password"
              value={tgBotToken}
              onChange={(e) => setTgBotToken(e.target.value)}
              placeholder={tgConfig?.hasBotToken ? '•••••••• (saved, enter new to change)' : '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11'}
              className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm font-mono text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none transition-colors"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Chat ID</label>
            <input
              type="text"
              value={tgChatId}
              onChange={(e) => setTgChatId(e.target.value)}
              placeholder={tgConfig?.hasChatId ? `${tgConfig.chatIdPreview} (saved, enter new to change)` : '-1001234567890'}
              className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm font-mono text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none transition-colors"
            />
            <p className="text-[10px] text-slate-500 mt-1">Use a negative number for channels (e.g. -1001234567890). Forward a message from your channel to @userinfobot to find the Chat ID.</p>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              onClick={async () => {
                setTgSaving(true);
                setTgResult(null);
                try {
                  const cfg = await saveTelegramConfig(tgBotToken, tgChatId);
                  setTgConfig(cfg);
                  setTgBotToken('');
                  setTgChatId('');
                  setTgResult({ ok: true, message: 'Telegram config saved' });
                } catch (e) {
                  setTgResult({ ok: false, message: e instanceof Error ? e.message : 'Save failed' });
                } finally {
                  setTgSaving(false);
                }
              }}
              disabled={(!tgBotToken.trim() && !tgChatId.trim()) || tgSaving}
              className="btn-neon btn-primary text-sm flex items-center gap-2"
            >
              {tgSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Save Config
            </button>
            <button
              onClick={async () => {
                setTgTesting(true);
                setTgResult(null);
                try {
                  const result = await sendTelegramTest();
                  setTgResult({ ok: result.ok, message: result.message });
                } catch (e) {
                  setTgResult({ ok: false, message: e instanceof Error ? e.message : 'Test failed' });
                } finally {
                  setTgTesting(false);
                }
              }}
              disabled={!tgConfig?.configured || tgTesting}
              className="btn-ghost text-sm flex items-center gap-2"
            >
              {tgTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Send Test
            </button>
          </div>
          {tgResult && (
            <div className={`rounded-lg px-3 py-2 text-xs flex items-center gap-2 ${tgResult.ok ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border border-red-500/30 text-red-300'}`}>
              {tgResult.ok ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {tgResult.message}
            </div>
          )}
        </div>
      </Panel>

      <Panel>
        <h3 className="font-display font-semibold text-white mb-3">📋 Current Risk Configuration</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Max Daily Spend" value={`$${settings.max_daily_spend.toFixed(2)}`} tone="cyan" />
          <Stat label="Auto Increase" value={`+${settings.auto_increase_pct}%`} tone="green" />
          <Stat label="Auto Decrease" value={`-${settings.auto_decrease_pct}%`} tone="red" />
          <Stat label="Stop Loss" value={`-${settings.daily_stop_loss_pct}%`} tone="red" />
          <Stat label="Take Profit" value={`+${settings.daily_take_profit_pct}%`} tone="green" />
          <Stat label="Min Spend" value={`$${settings.min_spend.toFixed(2)}`} tone="default" />
          <Stat label="Max Spend" value={`$${settings.max_spend.toFixed(2)}`} tone="default" />
          <Stat label="Spend Today" value={`$${settings.daily_spend_used.toFixed(2)}`} tone="cyan" />
        </div>
      </Panel>

      <Panel>
        <h3 className="font-display font-semibold text-white mb-3">⚡ Quick Actions</h3>
        <div className="flex flex-wrap gap-3">
          <button onClick={() => engine.resetDaily()} className="btn-ghost text-sm">
            ↻ Reset Daily Counters
          </button>
          <button onClick={() => engine.clearEmergency()} className="btn-ghost text-sm">
            🟢 Clear Emergency Stop
          </button>
        </div>
      </Panel>
    </div>
  );
}

function FeedRow({ name, url, status, note }: { name: string; url: string; status: string; note: string }) {
  const statusTone: Record<string, string> = {
    connected: 'neon-text-green',
    connecting: 'neon-text-yellow',
    ready: 'neon-text-green',
    disconnected: 'text-slate-400',
    error: 'neon-text-red',
  };
  return (
    <div className="rounded-lg bg-white/5 px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="font-medium text-white text-sm">{name}</span>
        <span className={`text-xs font-mono uppercase ${statusTone[status] ?? 'text-slate-400'}`}>{status}</span>
      </div>
      <div className="text-[10px] font-mono text-slate-400 mt-0.5 truncate">{url}</div>
      <div className="text-[10px] text-slate-500 mt-0.5">{note}</div>
    </div>
  );
}
