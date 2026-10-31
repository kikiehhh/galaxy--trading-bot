import { useState, useEffect, useCallback, useRef } from 'react';
import { Coins, Zap, Activity, Check, AlertCircle, Loader2, Power, RefreshCw, TrendingUp } from 'lucide-react';
import { Panel, Stat } from './ui';
import {
  fetchFeeCollectorStatus,
  checkFees,
  claimFees,
  toggleFeeCollector,
  loadLogFromStorage,
  saveLogToStorage,
  type FeeCollectorStatus,
  type FeeCheckResult,
  type FeeLogEntry,
} from '@/lib/feeCollector';

const INTERVAL_OPTIONS = [
  { label: '1 menit', value: 60000 },
  { label: '5 menit', value: 300000 },
  { label: '15 menit', value: 900000 },
  { label: '1 jam', value: 3600000 },
];

export function FeeCollectorTab({ autoStart }: { autoStart: boolean }) {
  const [status, setStatus] = useState<FeeCollectorStatus | null>(null);
  const [checkResult, setCheckResult] = useState<FeeCheckResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [selectedInterval, setSelectedInterval] = useState(300000);
  const [log, setLog] = useState<FeeLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const autoStartRef = useRef(false);

  const loadStatus = useCallback(async () => {
    try {
      const s = await fetchFeeCollectorStatus();
      setStatus(s);
      if (s.log && s.log.length > 0) {
        setLog(s.log);
        saveLogToStorage(s.log);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const saved = loadLogFromStorage();
    if (saved.length > 0) setLog(saved);
    void loadStatus();
    const interval = setInterval(() => void loadStatus(), 5000);
    return () => clearInterval(interval);
  }, [loadStatus]);

  useEffect(() => {
    if (autoStart && !autoStartRef.current && status && !status.enabled) {
      autoStartRef.current = true;
      void handleToggle(true);
    }
    if (!autoStart) {
      autoStartRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, status]);

  async function handleToggle(enable: boolean) {
    setToggling(true);
    setError(null);
    try {
      const result = await toggleFeeCollector(enable, selectedInterval);
      if (result.ok) {
        setToast(enable ? 'Auto Colek AKTIF' : 'Auto Colek NONAKTIF');
        setTimeout(() => setToast(null), 3000);
        await loadStatus();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Toggle failed');
    } finally {
      setToggling(false);
    }
  }

  async function handleCheck() {
    setChecking(true);
    setError(null);
    try {
      const result = await checkFees();
      setCheckResult(result);
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check failed');
    } finally {
      setChecking(false);
    }
  }

  async function handleClaim() {
    setClaiming(true);
    setError(null);
    try {
      const result = await claimFees();
      if (result.ok && result.claimed) {
        setToast(`Ter-colek ${result.claimedSol.toFixed(6)} SOL!`);
        setTimeout(() => setToast(null), 4000);
      } else if (result.ok && !result.claimed) {
        setToast('Tidak ada fee siap di-colek saat ini');
        setTimeout(() => setToast(null), 3000);
      }
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Claim failed');
    } finally {
      setClaiming(false);
    }
  }

  function handleIntervalChange(value: number) {
    setSelectedInterval(value);
    if (status?.enabled) {
      void toggleFeeCollector(true, value);
    }
  }

  if (loading) {
    return (
      <Panel>
        <div className="flex items-center gap-3 text-slate-400">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Memuat Auto Colek Fee...</span>
        </div>
      </Panel>
    );
  }

  const enabled = status?.enabled ?? false;
  const todaySol = status?.todayCollectedSol ?? 0;
  const claimableSol = status?.claimableNowSol ?? checkResult?.claimableSol ?? 0;
  const totalClaims = status?.totalClaims ?? 0;

  return (
    <div className="space-y-4">
      <Panel glow={enabled}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Coins className="w-6 h-6 text-amber-400" />
            <h2 className="font-display text-xl md:text-2xl font-bold text-white">BOT AUTO COLEK</h2>
            {enabled ? (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg border text-[10px] font-bold tracking-wider bg-emerald-500/15 border-emerald-500/30 text-emerald-300">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                </span>
                AKTIF
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-lg border text-[10px] font-bold tracking-wider bg-slate-500/15 border-slate-500/30 text-slate-400">
                NONAKTIF
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleToggle(!enabled)}
              disabled={toggling}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-bold transition-all ${
                enabled
                  ? 'bg-red-500/15 border-red-500/30 text-red-300 hover:bg-red-500/25'
                  : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25'
              } disabled:opacity-50`}
            >
              {toggling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
              {enabled ? 'STOP' : 'START'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-xl bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/20 px-4 py-3">
            <div className="text-[10px] text-slate-400 mb-1 tracking-wide">TER-COLEK HARI INI</div>
            <div className="font-display text-2xl font-bold tabular-nums text-amber-300">{todaySol.toFixed(6)}</div>
            <div className="text-[10px] text-amber-400/60 mt-0.5">SOL</div>
          </div>

          <div className="rounded-xl bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 px-4 py-3">
            <div className="text-[10px] text-slate-400 mb-1 tracking-wide">FEE SIAP COLEK</div>
            <div className="font-display text-2xl font-bold tabular-nums text-cyan-300">{claimableSol.toFixed(6)}</div>
            <div className="text-[10px] text-cyan-400/60 mt-0.5">SOL</div>
          </div>

          <div className="rounded-xl bg-gradient-to-br from-purple-500/10 to-violet-500/10 border border-purple-500/20 px-4 py-3">
            <div className="text-[10px] text-slate-400 mb-1 tracking-wide">TOTAL CLAIM</div>
            <div className="font-display text-2xl font-bold tabular-nums text-purple-300">{totalClaims}</div>
            <div className="text-[10px] text-purple-400/60 mt-0.5">transaksi</div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Interval:</span>
            <select
              value={selectedInterval}
              onChange={(e) => handleIntervalChange(Number(e.target.value))}
              className="rounded-lg bg-white/5 border border-white/10 px-3 py-1.5 text-sm text-white focus:border-cyan-400/50 focus:outline-none cursor-pointer"
            >
              {INTERVAL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-slate-800">{opt.label}</option>
              ))}
            </select>
          </div>

          <button
            onClick={() => void handleCheck()}
            disabled={checking}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-medium text-slate-300 hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Cek Fee
          </button>

          <button
            onClick={() => void handleClaim()}
            disabled={claiming}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-xs font-bold text-amber-300 hover:bg-amber-500/25 transition-colors disabled:opacity-50"
          >
            {claiming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            Colek Sekarang
          </button>

          {status?.winterWallet && (
            <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
              <TrendingUp className="w-3 h-3" />
              Winter: {status.winterWallet.slice(0, 6)}…{status.winterWallet.slice(-4)}
            </div>
          )}
        </div>

        {toast && (
          <div className="mt-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-sm text-emerald-300 flex items-center gap-2 animate-fade-in">
            <Check className="w-4 h-4 shrink-0" />
            {toast}
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}
      </Panel>

      {checkResult && (
        <Panel>
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-5 h-5 text-cyan-400" />
            <h3 className="font-display font-semibold text-white">Hasil Cek Fee</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <Stat label="Pump.fun Claimable" value={`${checkResult.claimableSol.toFixed(6)} SOL`} tone="amber" />
            <Stat label="Dust Tokens" value={`${checkResult.dustTokens.length} token`} tone="purple" />
          </div>

          {checkResult.pumpTokens.length > 0 && (
            <div className="mb-4">
              <div className="text-[10px] text-slate-400 mb-2 tracking-wide">PUMP.FUN CREATOR FEES</div>
              <div className="space-y-1.5 overflow-x-auto">
                {checkResult.pumpTokens.map((t) => (
                  <div key={t.mint} className="flex items-center justify-between rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs">
                    <span className="font-semibold text-white truncate max-w-[120px] sm:max-w-[200px]">{t.symbol}</span>
                    <span className="font-mono text-amber-300 tabular-nums">{t.feeSol.toFixed(6)} SOL</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {checkResult.dustTokens.length > 0 && (
            <div>
              <div className="text-[10px] text-slate-400 mb-2 tracking-wide">DUST TOKENS (SWAP KE SOL)</div>
              <div className="max-h-[200px] overflow-y-auto space-y-1.5">
                {checkResult.dustTokens.map((t) => (
                  <div key={t.mint} className="flex items-center justify-between rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs">
                    <span className="font-mono text-slate-300 truncate max-w-[120px] sm:max-w-[200px]">{t.mint.slice(0, 8)}…</span>
                    <span className="font-mono text-purple-300 tabular-nums">{t.amount.toFixed(4)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {checkResult.pumpTokens.length === 0 && checkResult.dustTokens.length === 0 && (
            <div className="text-sm text-slate-400 text-center py-6">Tidak ada fee siap di-colek saat ini</div>
          )}
        </Panel>
      )}

      <Panel>
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-400" />
            <h3 className="font-display font-semibold text-white">Log Live</h3>
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15">
              <span className="relative flex h-1.5 w-1.5">
                {enabled && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
                <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${enabled ? 'bg-emerald-400' : 'bg-slate-500'}`} />
              </span>
              <span className="text-[9px] font-bold text-emerald-300 tracking-wider">{enabled ? 'LIVE' : 'OFF'}</span>
            </span>
          </div>
          <span className="text-[10px] text-slate-500">{log.length} entries</span>
        </div>

        {log.length > 0 ? (
          <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
            {log.map((entry, i) => (
              <div key={`${entry.ts}-${i}`} className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs flex items-start gap-2">
                <span className="font-mono text-[10px] text-slate-500 shrink-0">[{entry.time}]</span>
                <span className="text-slate-300">{entry.message}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-slate-400 text-center py-6">Belum ada log. Start Auto Colek untuk memulai.</div>
        )}
      </Panel>
    </div>
  );
}
