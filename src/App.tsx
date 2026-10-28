import { useState, useEffect } from 'react';
import { Rocket, Shield, Waves, Settings as SettingsIcon, Play, Square, Activity, Wallet, Sparkles, Skull, Bot, Flame } from 'lucide-react';
import { engine } from '@/lib/engine';
import { useEngine, usePumpFeed } from '@/lib/hooks';
import type { TabKey } from '@/lib/types';
import { TradersTab } from '@/components/TradersTab';
import { AgentsTab } from '@/components/AgentsTab';
import { RiskTab } from '@/components/RiskTab';
import { WhalesTab } from '@/components/WhalesTab';
import { WhaleKillerTab } from '@/components/WhaleKillerTab';
import { WalletTab } from '@/components/WalletTab';
import { TokenActivityTab } from '@/components/TokenActivityTab';
import { SettingsTab } from '@/components/SettingsTab';
import { TradeTicker } from '@/components/TradeTicker';
import { StatusDot } from '@/components/ui';
import { useBackendStatus, ModeBadge } from '@/components/BackendStatus';
import { useHealthBot } from '@/lib/useHealthBot';

const TABS: { key: TabKey; label: string; icon: typeof Rocket }[] = [
  { key: 'agents', label: 'Agents', icon: Activity },
  { key: 'traders', label: '7 Traders', icon: Rocket },
  { key: 'risk', label: 'Risk Manager (BOS)', icon: Shield },
  { key: 'whales', label: 'Whale Scout', icon: Waves },
  { key: 'whale_killer', label: 'WHALE KILLING', icon: Skull },
  { key: 'tokens', label: 'Token Activity', icon: Sparkles },
  { key: 'wallet', label: 'Wallet', icon: Wallet },
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
];

function App() {
  const snap = useEngine();
  const [tab, setTab] = useState<TabKey>('agents');
  const [turboMode, setTurboMode] = useState(true);
  const { status, latestToken, eventCount, newWhale, dismissWhale } = usePumpFeed(snap.running);
  const { status: backendStatus, configured: backendConfigured, backendUrl } = useBackendStatus(snap.running);
  const { health, active, lastCheckAgo } = useHealthBot();

  const settings = snap.settings;
  const running = snap.running;

  const toggleRun = () => {
    if (running) engine.stop();
    else engine.start();
  };

  return (
    <div className="galaxy-bg min-h-screen text-slate-100">
      <div className="relative z-10 max-w-7xl mx-auto px-4 py-5">
        {/* Header */}
        <header className="mb-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-galaxy-500 via-cyan-400 to-purple-500 flex items-center justify-center animate-float" style={{ boxShadow: '0 0 24px rgba(51,88,255,0.5)' }}>
                <Rocket className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight">
                  <span className="neon-text-cyan">GALAXY</span>{' '}
                  <span className="text-white">SOLANA TRADING</span>
                </h1>
                <p className="text-xs text-slate-400">7 Agents · 1 Risk Manager BOS · 7 Wallets · Whale Killing Bot · Auto Scout 60%</p>
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {health && (
                <div
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-medium ${active ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-300'}`}
                  title={`Last check: ${lastCheckAgo}s ago`}
                >
                  <Bot className="w-3.5 h-3.5" />
                  <span>Self-Heal: {active ? 'ACTIVE' : 'CHECKING'}</span>
                  {lastCheckAgo !== null && <span className="text-[10px] opacity-60 font-mono">{lastCheckAgo}s</span>}
                </div>
              )}
              <ModeBadge status={backendStatus} configured={backendConfigured} />
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10">
                <StatusDot status={status} />
                <span className="text-xs text-slate-300">
                  PumpPortal: <span className="font-mono">{status}</span>
                </span>
              </div>
              <button
                onClick={toggleRun}
                disabled={!settings}
                className={`btn-neon flex items-center gap-2 ${running ? 'btn-danger' : 'btn-primary'}`}
              >
                {running ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                {running ? 'Running' : 'Start'}
              </button>
              <button
                onClick={() => setTurboMode((v) => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all ${
                  turboMode
                    ? 'bg-orange-500/20 border-orange-400/50 text-orange-300 hover:bg-orange-500/30'
                    : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
                }`}
                title="Toggle Turbo Buy mode — sub-second Jupiter swaps with Jito tip"
              >
                <Flame className={`w-3.5 h-3.5 ${turboMode ? 'animate-pulse' : ''}`} />
                TURBO {turboMode ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          {/* Tabs */}
          <nav className="flex flex-wrap gap-2">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-all ${
                    tab === t.key ? 'tab-active' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {t.label}
                </button>
              );
            })}
          </nav>
        </header>

        {/* Trade ticker */}
        {snap.trades.length > 0 && (
          <div className="mb-5">
            <TradeTicker trades={snap.trades} />
          </div>
        )}

        {/* Content */}
        <main className="pb-10">
          {!settings ? (
            <div className="glass-panel p-10 text-center text-slate-400">
              Loading Galaxy trading core…
            </div>
          ) : tab === 'agents' ? (
            <AgentsTab />
          ) : tab === 'traders' ? (
            <TradersTab traders={snap.traders} />
          ) : tab === 'risk' ? (
            <RiskTab settings={settings} traders={snap.traders} />
          ) : tab === 'whales' ? (
            <WhalesTab newWhale={newWhale} dismissWhale={dismissWhale} />
          ) : tab === 'whale_killer' ? (
            <WhaleKillerTab />
          ) : tab === 'tokens' ? (
            <TokenActivityTab turboMode={turboMode} />
          ) : tab === 'wallet' ? (
            <WalletTab turboMode={turboMode} />
          ) : (
            <SettingsTab
              settings={settings}
              running={running}
              onToggleRun={toggleRun}
              feedStatus={status}
              eventCount={eventCount}
              latestToken={latestToken}
              backendStatus={backendStatus}
              backendConfigured={backendConfigured}
              backendUrl={backendUrl}
            />
          )}
        </main>

        <footer className="text-center text-xs text-slate-500 py-4 border-t border-white/5">
          Galaxy Solana Trading · PumpPortal public · Helius + Jupiter public · No API keys required
          {backendConfigured && <span className="block mt-1">Backend: <span className="font-mono text-slate-400">{backendUrl}</span></span>}
        </footer>
      </div>
    </div>
  );
}

export default App;
