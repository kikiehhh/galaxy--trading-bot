import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Whale } from '@/lib/types';
import { Panel, Stat, shortenAddr } from './ui';

export function WhalesTab({ newWhale, dismissWhale }: {
  newWhale: Whale | null;
  dismissWhale: () => void;
}) {
  const [whales, setWhales] = useState<Whale[]>([]);

  useEffect(() => {
    void loadWhales();
    const channel = supabase
      .channel('whales-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whales' }, () => loadWhales())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function loadWhales() {
    const { data } = await supabase.from('whales').select('*').order('profit_sol', { ascending: false });
    setWhales((data as Whale[]) ?? []);
  }

  async function toggleTracked(w: Whale) {
    await supabase.from('whales').update({ tracked: !w.tracked }).eq('id', w.id);
  }

  async function removeWhale(w: Whale) {
    await supabase.from('whales').delete().eq('id', w.id);
  }

  const prefilled = whales.filter((w) => w.source === 'prefilled');
  const discovered = whales.filter((w) => w.source === 'discovered');

  return (
    <div className="space-y-4">
      {newWhale && (
        <Panel glow className="animate-slide-up border-emerald-400/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🐋</span>
              <div>
                <div className="font-display font-semibold neon-text-green">New whale discovered!</div>
                <div className="text-xs text-slate-300 font-mono">
                  {newWhale.label} · {shortenAddr(newWhale.address)} · {newWhale.winrate}% winrate · {newWhale.profit_sol} SOL profit
                </div>
              </div>
            </div>
            <button onClick={dismissWhale} className="btn-ghost text-xs">Dismiss</button>
          </div>
        </Panel>
      )}

      <Panel>
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-display text-2xl font-bold text-white flex items-center gap-2">🐋 Whale Scout</h2>
          <span className="stat-pill bg-galaxy-500/20 text-cyan-300">
            {whales.length} / 15 tracked
          </span>
        </div>
        <p className="text-sm text-slate-400">
          Auto-discovers wallets with &gt;60% winrate and &gt;5 SOL profit from the live PumpPortal feed.
          7 sultan wallets prefilled at startup.
        </p>
        <div className="grid grid-cols-3 gap-3 mt-3">
          <Stat label="Prefilled" value={prefilled.length} tone="purple" />
          <Stat label="Discovered" value={discovered.length} tone="cyan" />
          <Stat label="Total Tracked" value={whales.filter((w) => w.tracked).length} tone="green" />
        </div>
      </Panel>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {whales.map((w) => (
          <WhaleCard key={w.id} whale={w} onToggle={() => toggleTracked(w)} onRemove={() => removeWhale(w)} />
        ))}
      </div>
    </div>
  );
}

function WhaleCard({ whale, onToggle, onRemove }: {
  whale: Whale;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const isPrefilled = whale.source === 'prefilled';
  return (
    <Panel glow={whale.tracked} className={`animate-slide-up ${whale.tracked ? '' : 'opacity-60'}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">{isPrefilled ? '👑' : '🐋'}</span>
          <div>
            <div className="font-display font-semibold text-white">{whale.label}</div>
            <div className="text-[10px] font-mono text-slate-400">{shortenAddr(whale.address, 8, 6)}</div>
          </div>
        </div>
        <span className={`stat-pill ${isPrefilled ? 'bg-purple-500/20 text-purple-300' : 'bg-cyan-500/20 text-cyan-300'}`}>
          {isPrefilled ? 'SULTAN' : 'FOUND'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <Stat label="Winrate" value={`${whale.winrate.toFixed(1)}%`} tone={whale.winrate >= 75 ? 'green' : 'cyan'} />
        <Stat label="Profit" value={`${whale.profit_sol.toFixed(2)} SOL`} tone="green" />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onToggle}
          className={`flex-1 btn-neon text-xs ${whale.tracked ? 'btn-primary' : 'btn-ghost'}`}
        >
          {whale.tracked ? 'Tracking' : 'Track'}
        </button>
        {!isPrefilled && (
          <button onClick={onRemove} className="btn-ghost text-xs px-3 py-2 text-red-300">
            Remove
          </button>
        )}
      </div>
    </Panel>
  );
}
