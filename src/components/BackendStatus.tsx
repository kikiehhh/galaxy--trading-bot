import { useEffect, useState } from 'react';
import { fetchStatus, getCachedStatus, isBackendConfigured, getBackendUrl } from '@/lib/backend';
import type { BackendStatus } from '@/lib/backend';

export function useBackendStatus(running: boolean) {
  const [status, setStatus] = useState<BackendStatus | null>(getCachedStatus());
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!isBackendConfigured()) return;
    let active = true;

    const poll = async () => {
      setChecking(true);
      const s = await fetchStatus();
      if (active) {
        setStatus(s);
        setChecking(false);
      }
    };

    void poll();
    const interval = setInterval(poll, running ? 4000 : 10000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [running]);

  return { status, checking, configured: isBackendConfigured(), backendUrl: getBackendUrl() };
}

export function ModeBadge({ status, configured }: { status: BackendStatus | null; configured: boolean }) {
  if (!configured) {
    return (
      <span className="stat-pill bg-yellow-500/15 text-yellow-300 border border-yellow-500/30 flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
        SIM MODE
      </span>
    );
  }
  if (!status) {
    return (
      <span className="stat-pill bg-slate-500/15 text-slate-400 border border-slate-500/30 flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-pulse" />
        CONNECTING…
      </span>
    );
  }
  if (status.mode === 'live' && !status.walletError) {
    return (
      <span className="stat-pill bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-glow" />
        LIVE · {status.solBalance.toFixed(4)} SOL
      </span>
    );
  }
  if (status.mode === 'paper' && !status.walletError) {
    return (
      <span className="stat-pill bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
        PAPER · {status.solBalance.toFixed(4)} SOL
      </span>
    );
  }
  return (
    <span className="stat-pill bg-orange-500/15 text-orange-300 border border-orange-500/30 flex items-center gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
      DEGRADED · {status.walletError ? 'no wallet' : 'feed only'}
    </span>
  );
}
