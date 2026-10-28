import { useState, useEffect, useCallback, useRef } from 'react';
import { Wallet, RefreshCw, Copy, Check, AlertCircle, Coins, ShieldCheck, Activity, Send, ArrowUpRight, ArrowDownLeft, ExternalLink, Loader2, X, Zap, TrendingUp, TrendingDown, Radio, Plus, Bot, Wrench } from 'lucide-react';
import { Panel, Stat } from './ui';
import { TokenScoutTables } from './TokenScoutTables';
import { useHealthBot } from '@/lib/useHealthBot';
import {
  fetchWalletConfig,
  fetchLiveWallet,
  fetchTraderWallet,
  fetchTraderTransactions,
  sendTransfer,
  generateTraderWallet,
  updateTraderPrivateKey,
  connectWallet,
  type WalletConfig,
  type LiveWalletSnapshot,
  type TraderWalletStatus,
  type WalletTransaction,
  type GeneratedWallet,
} from '@/lib/backend';

function formatTimeAgo(blockTime: number | null): string {
  if (!blockTime) return '—';
  const diff = Math.floor((Date.now() / 1000) - blockTime);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function shortSig(sig: string): string {
  if (!sig) return '—';
  return `${sig.slice(0, 8)}…${sig.slice(-4)}`;
}

function formatUsd(v: number | null): string {
  if (v == null) return '—';
  const abs = Math.abs(v);
  if (abs < 0.01) return v.toFixed(6);
  if (abs < 1) return v.toFixed(4);
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function RpcBadge({ rpc }: { rpc: LiveWalletSnapshot['rpc'] }) {
  const isLive = rpc.status === 'live';
  const isDegraded = rpc.status === 'degraded';
  const color = isLive ? 'emerald' : isDegraded ? 'amber' : 'slate';
  const ago = rpc.lastUpdate ? Math.max(0, Math.floor((Date.now() - rpc.lastUpdate) / 1000)) : null;
  return (
    <span
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-bold tracking-wider bg-${color}-500/15 border-${color}-500/30 text-${color}-300`}
    >
      <Radio className="w-3 h-3" />
      RPC: {rpc.status.toUpperCase()}
      {ago !== null && <span className="text-${color}-400/60 font-mono normal-case ml-1">{ago}s</span>}
    </span>
  );
}

export function WalletTab({ turboMode }: { turboMode?: boolean }) {
  const { health, active, healActions, toast, dismissToast } = useHealthBot();
  const [config, setConfig] = useState<WalletConfig | null>(null);
  const [live, setLive] = useState<LiveWalletSnapshot | null>(null);
  const [walletStatus, setWalletStatus] = useState<TraderWalletStatus | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectInput, setConnectInput] = useState('');
  const [connectResult, setConnectResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // PNL animation
  const [pnlFlash, setPnlFlash] = useState<'up' | 'down' | null>(null);
  const prevPnlRef = useRef<number | null>(null);
  const [solFlash, setSolFlash] = useState<'up' | 'down' | null>(null);
  const prevSolRef = useRef<number | null>(null);

  // Key import
  const [showImport, setShowImport] = useState(false);
  const [importKey, setImportKey] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Generated wallet backup panel
  const [generated, setGenerated] = useState<GeneratedWallet | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  // Send modal state
  const [showSend, setShowSend] = useState(false);
  const [sendDest, setSendDest] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendAsset, setSendAsset] = useState<'sol' | 'token'>('sol');
  const [sendTokenMint, setSendTokenMint] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Auto-connect on load: fetch wallet config + live snapshot
  const loadInitial = useCallback(async () => {
    setError(null);
    try {
      const cfg = await fetchWalletConfig();
      setConfig(cfg);
      if (cfg.configured) {
        const [ws, lv] = await Promise.all([fetchTraderWallet(), fetchLiveWallet()]);
        setWalletStatus(ws);
        setLive(lv);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load wallet data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll live wallet every 1 second for real-time updates
  const refreshLive = useCallback(async () => {
    if (!config?.configured) return;
    try {
      const lv = await fetchLiveWallet();
      setLive(lv);

      const newPnl = lv.allTimePnlUsd;
      if (prevPnlRef.current !== null && newPnl != null && Math.abs(newPnl - prevPnlRef.current) > 0.0001) {
        setPnlFlash(newPnl > prevPnlRef.current ? 'up' : 'down');
        setTimeout(() => setPnlFlash(null), 1200);
      }
      if (newPnl != null) prevPnlRef.current = newPnl;

      const newSol = lv.solBalance;
      if (prevSolRef.current !== null && Math.abs(newSol - prevSolRef.current) > 0.000001) {
        setSolFlash(newSol > prevSolRef.current ? 'up' : 'down');
        setTimeout(() => setSolFlash(null), 1500);
      }
      prevSolRef.current = newSol;
    } catch {
      // silent — will retry next tick
    }
  }, [config?.configured]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    if (!config?.configured) return;
    void refreshLive();
    const interval = setInterval(() => void refreshLive(), 1000);
    return () => clearInterval(interval);
  }, [refreshLive, config?.configured]);

  const loadTransactions = useCallback(async () => {
    if (!config?.configured) return;
    setTxLoading(true);
    try {
      const result = await fetchTraderTransactions(20);
      if (result.ok) setTransactions(result.transactions);
    } catch {
      // silent
    } finally {
      setTxLoading(false);
    }
  }, [config?.configured]);

  useEffect(() => {
    void loadTransactions();
    const interval = setInterval(() => void loadTransactions(), 10000);
    return () => clearInterval(interval);
  }, [loadTransactions]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const result = await generateTraderWallet();
      setGenerated(result);
      setConfig({ ok: true, configured: true, publicKey: result.address });
      // Immediately start live polling
      const [ws, lv] = await Promise.all([fetchTraderWallet(), fetchLiveWallet()]);
      setWalletStatus(ws);
      setLive(lv);
      void loadTransactions();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate wallet');
    } finally {
      setGenerating(false);
    }
  }

  // Clean up the pasted key before sending to the server.
  // Handles: surrounding quotes, stray whitespace, multi-line JSON arrays,
  // accidental line breaks in the middle of base58 strings.
  function cleanKeyInput(raw: string): string {
    let s = raw.trim();
    // Strip surrounding quotes
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      s = s.slice(1, -1).trim();
    }
    // If it looks like a JSON array, collapse whitespace/newlines
       if (s.startsWith('[')) {
      return s.replace(/\s+/g, '');
    }
    // Otherwise remove all whitespace/newlines (base58 / hex / base64 are whitespace-free)
    return s.replace(/\s+/g, '');
  }

  async function handleImport() {
    const cleaned = cleanKeyInput(importKey);
    if (!cleaned) return;
    setImporting(true);
    setImportResult(null);
    try {
      const result = await updateTraderPrivateKey(cleaned);
      if (!result.ok) {
        const msg = result.error || 'Import failed';
        const hint = result.hint ? `\n${result.hint}` : '';
        setImportResult({ ok: false, message: `${msg}${hint}` });
        return;
      }
      setImportResult({ ok: true, message: `Connected: ${result.address}` });
      setConfig({ ok: true, configured: true, publicKey: result.address });
      const [ws, lv] = await Promise.all([fetchTraderWallet(), fetchLiveWallet()]);
      setWalletStatus(ws);
      setLive(lv);
      void loadTransactions();
      setShowImport(false);
      setImportKey('');
    } catch (e) {
      setImportResult({ ok: false, message: e instanceof Error ? e.message : 'Import failed' });
    } finally {
      setImporting(false);
    }
  }

  async function handleConnect() {
    if (!connectInput.trim()) return;
    setConnectResult(null);
    try {
      const result = await connectWallet(connectInput.trim());
      setConnectResult({ ok: true, message: `Connected · Balance: ${result.solBalance.toFixed(6)} SOL` });
    } catch (e) {
      setConnectResult({ ok: false, message: e instanceof Error ? e.message : 'Connection failed' });
    }
  }

  function copyAddress() {
    const addr = live?.address || config?.publicKey;
    if (addr) {
      void navigator.clipboard.writeText(addr);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function copyGeneratedKey() {
    if (generated?.privateKeyBase58) {
      void navigator.clipboard.writeText(generated.privateKeyBase58);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  }

  function openSendModal(asset: 'sol' | 'token', mint?: string) {
    setSendAsset(asset);
    setSendTokenMint(mint ?? null);
    setSendDest('');
    setSendAmount('');
    setSendResult(null);
    setShowSend(true);
  }

  async function handleSend() {
    const dest = sendDest.trim();
    const amt = parseFloat(sendAmount);
    if (!dest || !Number.isFinite(amt) || amt <= 0) return;
    setSending(true);
    setSendResult(null);
    try {
      const result = await sendTransfer(dest, amt, sendAsset === 'token' ? sendTokenMint ?? undefined : undefined);
      setSendResult({ ok: true, message: `Sent ${amt} ${sendAsset === 'sol' ? 'SOL' : 'tokens'} · ${shortSig(result.signature ?? '')}` });
      setSendDest('');
      setSendAmount('');
      await Promise.all([refreshLive(), loadTransactions()]);
    } catch (e) {
      setSendResult({ ok: false, message: e instanceof Error ? e.message : 'Transfer failed' });
    } finally {
      setSending(false);
    }
  }

  // Loading skeleton
  if (loading) {
    return (
      <div className="space-y-4">
        <Panel>
          <div className="flex items-center gap-3 text-slate-400">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span>Loading wallet…</span>
          </div>
          <div className="mt-4 space-y-3">
            <div className="h-28 rounded-2xl bg-white/5 animate-pulse" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-20 rounded-xl bg-white/5 animate-pulse" />
              ))}
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  const traderAddress = live?.address || config?.publicKey;
  const solBalance = live?.solBalance ?? 0;
  const solPriceUsd = live?.solPriceUsd ?? null;
  const solUsd = live?.solUsd ?? null;
  const tokens = live?.tokens ?? [];
  const portfolioUsd = live?.portfolioUsd ?? null;
  const allTimePnl = live?.allTimePnlUsd ?? null;
  const rpcInfo = live?.rpc;
  const isLive = rpcInfo?.status === 'live';

  const solColor = solFlash === 'up' ? 'text-green-300' : solFlash === 'down' ? 'text-red-300' : 'text-cyan-300';
  const pnlColor = pnlFlash === 'up' ? 'text-green-300' : pnlFlash === 'down' ? 'text-red-300' : (allTimePnl ?? 0) >= 0 ? 'text-green-300' : 'text-red-300';

  // No wallet connected — show generate / import options
  if (!traderAddress) {
    return (
      <div className="space-y-4">
        <Panel glow>
          <div className="flex items-center gap-2 mb-4">
            <Wallet className="w-6 h-6 text-cyan-400" />
            <h2 className="font-display text-2xl font-bold text-white">Trader Wallet</h2>
          </div>
          <div className="rounded-xl bg-orange-500/10 border border-orange-500/30 px-4 py-3 text-sm text-orange-300 flex items-center gap-2 mb-4">
            <AlertCircle className="w-5 h-5 shrink-0" />
            No trader wallet connected. Generate a new one or import an existing key.
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="btn-neon btn-primary flex items-center gap-2 justify-center"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {generating ? 'Generating…' : 'Generate New Wallet'}
            </button>
            <button
              onClick={() => setShowImport(true)}
              className="btn-ghost flex items-center gap-2 justify-center"
            >
              <Wallet className="w-4 h-4" />
              Import Private Key
            </button>
          </div>
        </Panel>

        {showImport && (
          <Panel>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display font-semibold text-white">Import Private Key</h3>
              <button onClick={() => setShowImport(false)} className="p-2 rounded-lg bg-white/5 hover:bg-white/10">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <textarea
              value={importKey}
              onChange={(e) => setImportKey(e.target.value)}
              placeholder="Paste base58 key (Phantom), JSON array [12,34,...] (Solflare), hex, or base64…"
              autoComplete="off"
              spellCheck={false}
              rows={3}
              className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm font-mono text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none transition-colors mb-3 resize-none"
            />
            <button
              onClick={handleImport}
              disabled={!importKey.trim() || importing}
              className="btn-neon btn-primary text-sm flex items-center gap-2"
            >
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
              {importing ? 'Importing…' : 'Import & Connect'}
            </button>
            {importResult && (
              <div className={`mt-3 rounded-lg px-3 py-2 text-xs flex items-start gap-2 ${importResult.ok ? 'bg-green-500/10 border border-green-500/30 text-green-300' : 'bg-red-500/10 border border-red-500/30 text-red-300'}`}>
                {importResult.ok ? <Check className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                <span className="whitespace-pre-line">{importResult.message}</span>
              </div>
            )}
          </Panel>
        )}

        <Panel>
          <div className="flex items-center gap-2 mb-3">
            <ArrowUpRight className="w-5 h-5 text-cyan-400" />
            <h3 className="font-display font-semibold text-white">Inspect Any Wallet</h3>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={connectInput}
              onChange={(e) => setConnectInput(e.target.value)}
              placeholder="Paste any Solana wallet address…"
              className="flex-1 rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none transition-colors"
            />
            <button onClick={handleConnect} disabled={!connectInput.trim()} className="btn-neon btn-primary text-sm whitespace-nowrap">
              Check Wallet
            </button>
          </div>
          {connectResult && (
            <div className={`mt-3 rounded-lg px-3 py-2 text-xs flex items-center gap-2 ${connectResult.ok ? 'bg-green-500/10 border border-green-500/30 text-green-300' : 'bg-red-500/10 border border-red-500/30 text-red-300'}`}>
              {connectResult.ok ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {connectResult.message}
            </div>
          )}
        </Panel>

        <TokenScoutTables turboMode={turboMode} />

        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-300 flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* One-time backup panel for newly generated wallet */}
      {generated && generated.privateKeyBase58 && (
        <Panel glow className="border-amber-500/40">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-amber-400" />
              <h3 className="font-display text-lg font-bold text-amber-300">Save Your Private Key</h3>
            </div>
            <button onClick={() => setGenerated(null)} className="p-2 rounded-lg bg-white/5 hover:bg-white/10">
              <X className="w-4 h-4 text-slate-400" />
            </button>
          </div>
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-200 mb-3">
            This is the ONLY time your private key will be shown. Copy it now and store it safely. If you lose it, you lose access to your funds.
          </div>
          <div className="rounded-xl bg-black/30 border border-white/10 px-4 py-3 mb-3">
            <div className="text-[10px] text-slate-500 mb-1">Private Key (base58)</div>
            <div className="flex items-center justify-between gap-2">
              <code className="font-mono text-xs text-amber-200 break-all">{generated.privateKeyBase58}</code>
              <button onClick={copyGeneratedKey} className="shrink-0 p-2 rounded-lg bg-white/5 hover:bg-white/10">
                {copiedKey ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-slate-300" />}
              </button>
            </div>
          </div>
          <button onClick={() => setGenerated(null)} className="btn-neon btn-primary text-sm">
            I've Saved My Key
          </button>
        </Panel>
      )}

      {/* Connected Wallet Overview */}
      <Panel glow className="animate-slide-up">
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <Wallet className="w-6 h-6 text-cyan-400" />
            <h2 className="font-display text-2xl font-bold text-white">Connected Wallet</h2>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {rpcInfo && <RpcBadge rpc={rpcInfo} />}
            <button
              onClick={() => openSendModal('sol')}
              className="btn-neon btn-primary text-sm flex items-center gap-2 whitespace-nowrap"
            >
              <Send className="w-4 h-4" />
              Withdraw
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl bg-green-500/10 border border-green-500/30 px-4 py-2.5 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-green-400 shrink-0" />
            <span className="text-sm text-green-300 font-medium">Wallet connected & active</span>
          </div>

          {/* Address */}
          <div className="rounded-xl bg-white/5 border border-white/10 px-4 py-3">
            <div className="text-xs text-slate-400 mb-1">Wallet Address</div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-sm text-cyan-300 break-all">{traderAddress}</span>
              <button onClick={copyAddress} className="shrink-0 p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors" title="Copy address">
                {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-slate-300" />}
              </button>
            </div>
          </div>

          {/* Live SOL Balance + USD */}
          <div className="rounded-2xl bg-gradient-to-br from-cyan-500/10 via-blue-500/10 to-purple-500/10 border border-cyan-500/20 px-5 py-5 relative overflow-hidden">
            <div className="absolute top-3 right-3 flex items-center gap-1.5">
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                </span>
                <span className="text-[9px] font-bold text-emerald-300 tracking-wider">LIVE</span>
              </span>
            </div>

            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-slate-400 font-medium tracking-wide">SOL BALANCE</span>
            </div>
            <div className="flex items-baseline gap-2 transition-all duration-300">
              <span
                className={`font-display text-4xl font-bold tabular-nums transition-colors duration-500 ${solColor}`}
                style={{ textShadow: solFlash ? '0 0 20px currentColor' : 'none' }}
              >
                {solBalance.toFixed(6)}
              </span>
              <span className="text-lg text-slate-400 font-medium">SOL</span>
              {solFlash === 'up' && <span className="text-xs text-green-400 font-mono animate-pulse">↑</span>}
              {solFlash === 'down' && <span className="text-xs text-red-400 font-mono animate-pulse">↓</span>}
            </div>
            <div className="mt-1 text-sm text-slate-400">
              ≈ <span className="font-mono text-cyan-300">{formatUsd(solUsd)}</span> USD
              {solPriceUsd != null && <span className="text-slate-500 ml-2">(@ ${solPriceUsd.toFixed(2)}/SOL)</span>}
            </div>
          </div>

          {/* Portfolio + PNL Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Portfolio Value" value={portfolioUsd != null ? `$${formatUsd(portfolioUsd)}` : '—'} tone="cyan" />
            <div className="rounded-xl bg-white/5 border border-white/10 px-4 py-3">
              <div className="text-[10px] text-slate-400 mb-1 tracking-wide">ALL-TIME PNL</div>
              <div
                className={`font-display text-xl font-bold tabular-nums transition-colors duration-300 ${pnlColor}`}
                style={{ textShadow: pnlFlash ? '0 0 16px currentColor' : 'none' }}
              >
                {allTimePnl != null ? `${allTimePnl >= 0 ? '+' : ''}$${formatUsd(allTimePnl)}` : '—'}
              </div>
              {pnlFlash === 'up' && <TrendingUp className="w-3 h-3 text-green-400 animate-pulse mt-1" />}
              {pnlFlash === 'down' && <TrendingDown className="w-3 h-3 text-red-400 animate-pulse mt-1" />}
            </div>
            <Stat label="SOL Price" value={solPriceUsd != null ? `$${solPriceUsd.toFixed(2)}` : '—'} tone="purple" />
            <Stat label="Auto-Trade" value={walletStatus?.autoTradeEnabled ? 'ON' : 'OFF'} tone={walletStatus?.autoTradeEnabled ? 'green' : 'red'} />
          </div>

          {solBalance < 0.03 && (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-4 py-3 text-sm text-amber-300 flex items-center gap-2">
              <Coins className="w-5 h-5 shrink-0" />
              <span>Fund this wallet with at least 0.03 SOL to enable live trading.</span>
            </div>
          )}

          {rpcInfo?.error && (
            <div className="rounded-lg bg-orange-500/10 border border-orange-500/30 px-3 py-2 text-xs text-orange-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {rpcInfo.error}
            </div>
          )}
        </div>
      </Panel>

      {/* All Token Holdings with PNL */}
      <Panel>
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <Coins className="w-5 h-5 text-purple-400" />
            <h3 className="font-display font-semibold text-white">Token Holdings</h3>
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              <span className="text-[9px] font-bold text-emerald-300 tracking-wider">LIVE</span>
            </span>
          </div>
          <span className="text-xs text-slate-500">{tokens.length} token{tokens.length !== 1 ? 's' : ''}</span>
        </div>

        {tokens.length > 0 ? (
          <div className="space-y-2">
            {tokens.map((t) => (
              <div
                key={t.mint}
                className="flex items-center justify-between rounded-xl bg-white/5 border border-white/10 px-4 py-3 hover:bg-white/[0.07] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-cyan-500/20 border border-white/10 flex items-center justify-center shrink-0">
                    <Coins className="w-5 h-5 text-purple-300" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-mono text-xs text-slate-300 truncate max-w-[160px] sm:max-w-[260px]">{t.mint}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {t.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })} tokens
                      {t.valueUsd != null && <span className="text-cyan-400 ml-1.5">· ${formatUsd(t.valueUsd)}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-3">
                  <div className="text-right">
                    {t.pnlUsd != null && (
                      <div className={`font-mono text-sm font-semibold tabular-nums ${t.pnlUsd >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {t.pnlUsd >= 0 ? '+' : ''}{formatUsd(t.pnlUsd)}
                      </div>
                    )}
                    {t.pnlPct != null && (
                      <div className={`text-[10px] tabular-nums ${t.pnlPct >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {t.pnlPct >= 0 ? '+' : ''}{t.pnlPct.toFixed(1)}%
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => openSendModal('token', t.mint)}
                    className="p-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 transition-colors"
                    title="Send this token"
                  >
                    <Send className="w-4 h-4 text-cyan-400" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-3">
              <Coins className="w-8 h-8 text-slate-600" />
            </div>
            <div className="text-sm text-slate-400 font-medium">No token holdings</div>
            <div className="text-xs text-slate-500 mt-1">Token holdings will appear here once trades are executed.</div>
          </div>
        )}
      </Panel>

      {/* Transaction History */}
      <Panel>
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-cyan-400" />
            <h3 className="font-display font-semibold text-white">Recent Transactions</h3>
          </div>
          <button onClick={() => void loadTransactions()} disabled={txLoading} className="btn-ghost text-xs flex items-center gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${txLoading ? 'animate-spin' : ''}`} />
            {txLoading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {transactions.length > 0 ? (
          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
            {transactions.map((tx) => (
              <div
                key={tx.signature}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
                  tx.direction === 'in' ? 'bg-green-500/5 border-green-500/15 hover:bg-green-500/10' : 'bg-red-500/5 border-red-500/15 hover:bg-red-500/10'
                }`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tx.direction === 'in' ? 'bg-green-500/15 border border-green-500/20' : 'bg-red-500/15 border border-red-500/20'}`}>
                  {tx.direction === 'in' ? <ArrowDownLeft className="w-5 h-5 text-green-400" /> : <ArrowUpRight className="w-5 h-5 text-red-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold ${tx.direction === 'in' ? 'text-green-300' : 'text-red-300'}`}>
                      {tx.direction === 'in' ? '+' : '-'}{tx.amountSol.toFixed(6)} SOL
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">{tx.direction === 'in' ? 'Received' : 'Sent'}</span>
                    {tx.err != null && <span className="text-[9px] text-red-400 px-1.5 py-0.5 rounded bg-red-500/15 border border-red-500/20">Failed</span>}
                  </div>
                  {tx.counterparty && (
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">
                      {tx.direction === 'in' ? 'From' : 'To'}: {tx.counterparty.slice(0, 6)}…{tx.counterparty.slice(-4)}
                    </div>
                  )}
                  <div className="text-[10px] text-slate-600 font-mono mt-0.5">{shortSig(tx.signature)} · {formatTimeAgo(tx.blockTime)}</div>
                </div>
                <a href={`https://solscan.io/tx/${tx.signature}`} target="_blank" rel="noopener noreferrer" className="shrink-0 p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors" title="View on Solscan">
                  <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                </a>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-3">
              <Activity className="w-8 h-8 text-slate-600" />
            </div>
            <div className="text-sm text-slate-400 font-medium">No recent transactions</div>
            <div className="text-xs text-slate-500 mt-1">Incoming and outgoing transfers will appear here once the wallet is active.</div>
          </div>
        )}
      </Panel>

      {/* Self-Heal Bot Panel */}
      <Panel>
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-emerald-400" />
            <h3 className="font-display font-semibold text-white">Self-Heal Bot</h3>
            <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded-lg border text-[10px] font-bold tracking-wider ${active ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' : 'bg-amber-500/15 border-amber-500/30 text-amber-300'}`}>
              <span className="relative flex h-1.5 w-1.5">
                {active && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
                <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              </span>
              {active ? 'ACTIVE' : 'CHECKING'}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-slate-500">
            {health?.rpcStatus && (
              <span className={`flex items-center gap-1 ${health.rpcStatus === 'live' ? 'text-emerald-400' : 'text-amber-400'}`}>
                <Radio className="w-3 h-3" /> RPC: {health.rpcStatus.toUpperCase()}
              </span>
            )}
            {health?.jupiterStatus && (
              <span className={`flex items-center gap-1 ${health.jupiterStatus === 'live' ? 'text-emerald-400' : 'text-amber-400'}`}>
                <Zap className="w-3 h-3" /> Jupiter: {health.jupiterStatus.toUpperCase()}
              </span>
            )}
          </div>
        </div>

        {healActions.length > 0 ? (
          <div className="space-y-1.5">
            <div className="text-[10px] text-slate-500 mb-1 flex items-center gap-1">
              <Wrench className="w-3 h-3" /> Recent Actions
            </div>
            {healActions.map((entry, i) => (
              <div key={i} className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-xs flex items-center gap-2">
                <span className="font-mono text-[10px] text-slate-500 shrink-0">{entry.time}</span>
                <span className="text-slate-300">{entry.message}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-slate-500 py-2">
            All systems healthy — no healing actions needed. The bot checks every 10 seconds.
          </div>
        )}
      </Panel>

      <TokenScoutTables />

      {/* Inspect Any Wallet */}
      <Panel>
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-5 h-5 text-cyan-400" />
          <h3 className="font-display font-semibold text-white">Inspect Any Wallet</h3>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={connectInput}
            onChange={(e) => setConnectInput(e.target.value)}
            placeholder="Paste any Solana wallet address…"
            className="flex-1 rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none transition-colors"
          />
          <button onClick={handleConnect} disabled={!connectInput.trim()} className="btn-neon btn-primary text-sm whitespace-nowrap">
            Check Wallet
          </button>
        </div>
        {connectResult && (
          <div className={`mt-3 rounded-lg px-3 py-2 text-xs flex items-center gap-2 ${connectResult.ok ? 'bg-green-500/10 border border-green-500/30 text-green-300' : 'bg-red-500/10 border border-red-500/30 text-red-300'}`}>
            {connectResult.ok ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {connectResult.message}
          </div>
        )}
      </Panel>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-300 flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
      )}

      {/* Send Modal */}
      {showSend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md glass-panel p-5 neon-border relative">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Send className="w-5 h-5 text-cyan-400" />
                <h3 className="font-display text-lg font-bold text-white">Send {sendAsset === 'sol' ? 'SOL' : 'Token'}</h3>
              </div>
              <button onClick={() => setShowSend(false)} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Recipient Address</label>
                <input
                  type="text"
                  value={sendDest}
                  onChange={(e) => setSendDest(e.target.value)}
                  placeholder="Paste destination wallet address…"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm font-mono text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none transition-colors"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Amount {sendAsset === 'sol' ? '(SOL)' : '(tokens)'}</label>
                <input
                  type="number"
                  value={sendAmount}
                  onChange={(e) => setSendAmount(e.target.value)}
                  placeholder="0.00"
                  step="any"
                  min="0"
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm font-mono text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none transition-colors"
                />
                {sendAsset === 'sol' && (
                  <button onClick={() => setSendAmount(String(Math.max(0, solBalance - 0.001).toFixed(6)))} className="text-[10px] text-cyan-400 hover:text-cyan-300 mt-1 font-mono">
                    Max: {solBalance.toFixed(6)} SOL (minus fee)
                  </button>
                )}
              </div>
              {sendAsset === 'token' && sendTokenMint && (
                <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2">
                  <div className="text-[10px] text-slate-500">Token mint</div>
                  <div className="font-mono text-xs text-slate-300 truncate">{sendTokenMint}</div>
                </div>
              )}
              <button onClick={handleSend} disabled={!sendDest.trim() || !sendAmount || sending} className="w-full btn-neon btn-primary text-sm flex items-center justify-center gap-2 py-3">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {sending ? 'Sending…' : `Send ${sendAsset === 'sol' ? 'SOL' : 'Token'}`}
              </button>
              {sendResult && (
                <div className={`rounded-lg px-3 py-2 text-xs flex items-center gap-2 ${sendResult.ok ? 'bg-green-500/10 border border-green-500/30 text-green-300' : 'bg-red-500/10 border border-red-500/30 text-red-300'}`}>
                  {sendResult.ok ? <Check className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                  <span className="break-all">{sendResult.message}</span>
                </div>
              )}
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-[11px] text-amber-200/80 flex items-start gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <span>This sends real on-chain assets from your connected wallet. Double-check the address before confirming. Transactions are irreversible.</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Self-Heal Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 animate-slide-up">
          <div className="glass-panel px-4 py-3 neon-border flex items-center gap-3 max-w-sm">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-emerald-400 font-bold tracking-wider">SELF-HEAL BOT</div>
              <div className="text-xs text-slate-200 truncate">{toast}</div>
            </div>
            <button onClick={dismissToast} className="p-1 rounded-lg bg-white/5 hover:bg-white/10 shrink-0">
              <X className="w-3.5 h-3.5 text-slate-400" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
