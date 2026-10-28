import { useState, useEffect, useCallback, useRef } from 'react';
import { Sparkles, ShoppingCart, RefreshCw, TrendingUp, ExternalLink, Clock } from 'lucide-react';
import { Panel, Stat } from './ui';
import { pumpFeed, type PumpTokenCreateEvent, type PumpTradeEvent } from '@/lib/pumpportal';
import { fetchTrades, type TradeRecord } from '@/lib/backend';

interface NewTokenEntry {
  mint: string;
  name: string;
  symbol: string;
  marketCap: number;
  imageUri?: string;
  creator: string;
  discoveredAt: number;
}

interface TokenTradeEntry {
  mint: string;
  symbol: string;
  solAmount: number;
  marketCap: number;
  txType: 'buy' | 'sell';
  trader: string;
  time: number;
  isRaydium: boolean;
}

export function TokenActivityTab({ turboMode }: { turboMode?: boolean }) {
  const [newTokens, setNewTokens] = useState<NewTokenEntry[]>([]);
  const [tokenTrades, setTokenTrades] = useState<TokenTradeEntry[]>([]);
  const [purchasedTokens, setPurchasedTokens] = useState<TradeRecord[]>([]);
  const [tradeLoading, setTradeLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [feedStatus, setFeedStatus] = useState('disconnected');
  const [filter, setFilter] = useState<'all' | 'buys' | 'sells'>('all');
  const [activeSection, setActiveSection] = useState<'new' | 'purchased'>('new');
  const buyCountRef = useRef(0);
  const sellCountRef = useRef(0);
  const [buyCount, setBuyCount] = useState(0);
  const [sellCount, setSellCount] = useState(0);

  // Subscribe to PumpPortal feed for new tokens + trade activity
  useEffect(() => {
    const unsubStatus = pumpFeed.onStatus(setFeedStatus);
    pumpFeed.start();

    const unsub = pumpFeed.on((ev) => {
      if (ev.type === 'tokenCreation') {
        const e = ev as PumpTokenCreateEvent;
        setNewTokens((prev) => {
          if (prev.some((t) => t.mint === e.mint)) return prev;
          const entry: NewTokenEntry = {
            mint: e.mint,
            name: e.name,
            symbol: e.symbol,
            marketCap: e.marketCap,
            imageUri: e.imageUri,
            creator: e.creator,
            discoveredAt: Date.now(),
          };
          return [entry, ...prev].slice(0, 100);
        });
      } else if (ev.type === 'trade') {
        const e = ev as PumpTradeEvent;
        setTokenTrades((prev) => {
          const entry: TokenTradeEntry = {
            mint: e.mint,
            symbol: '',
            solAmount: e.solAmount,
            marketCap: e.marketCap,
            txType: e.txType,
            trader: e.traderPublicKey,
            time: Date.now(),
            isRaydium: e.isRaydiumPool,
          };
          return [entry, ...prev].slice(0, 100);
        });
        if (e.txType === 'buy') {
          buyCountRef.current += 1;
          setBuyCount(buyCountRef.current);
        } else {
          sellCountRef.current += 1;
          setSellCount(sellCountRef.current);
        }
      }
    });

    return () => {
      unsubStatus();
      unsub();
    };
  }, []);

  // Fetch purchased tokens from backend
  const loadPurchased = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setTradeLoading(true);
    try {
      const result = await fetchTrades(80);
      setPurchasedTokens(result.trades || []);
    } catch {
      // leave stale data
    } finally {
      setTradeLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadPurchased();
    const id = setInterval(() => void loadPurchased(true), 10000);
    return () => clearInterval(id);
  }, [loadPurchased]);

  const filteredPurchased = purchasedTokens.filter((t) => {
    if (filter === 'buys') return t.side === 'buy';
    if (filter === 'sells') return t.side === 'sell';
    return true;
  });

  const uniqueBuyers = new Set(tokenTrades.filter((t) => t.txType === 'buy').map((t) => t.trader)).size;
  const newTokenCount = newTokens.length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <Panel glow className="animate-slide-up">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-400 via-purple-500 to-galaxy-500 flex items-center justify-center" style={{ boxShadow: '0 0 20px rgba(51,88,255,0.4)' }}>
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="font-display text-2xl font-bold text-white">Token Activity</h2>
              <p className="text-xs text-slate-400">
                Real-time token analysis · New launches & purchased tokens
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10">
            <span className={`w-2 h-2 rounded-full ${feedStatus === 'connected' ? 'bg-green-400 animate-pulse' : feedStatus === 'connecting' ? 'bg-yellow-400' : 'bg-slate-500'}`} />
            <span className="text-xs text-slate-300 font-mono">PumpPortal: {feedStatus}</span>
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="New Tokens Detected" value={newTokenCount} tone="cyan" />
          <Stat label="Feed Buys" value={buyCount} tone="green" />
          <Stat label="Feed Sells" value={sellCount} tone="red" />
          <Stat label="Unique Buyers" value={uniqueBuyers} tone="purple" />
        </div>
      </Panel>

      {/* Section switcher */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveSection('new')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-all ${
            activeSection === 'new'
              ? 'tab-active'
              : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          New Tokens
          {newTokenCount > 0 && (
            <span className="ml-1 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] px-2 py-0.5 font-mono">{newTokenCount}</span>
          )}
        </button>
        <button
          onClick={() => setActiveSection('purchased')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-all ${
            activeSection === 'purchased'
              ? 'tab-active'
              : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
          }`}
        >
          <ShoppingCart className="w-4 h-4" />
          Purchased Tokens
          {purchasedTokens.length > 0 && (
            <span className="ml-1 rounded-full bg-green-500/20 text-green-300 text-[10px] px-2 py-0.5 font-mono">{purchasedTokens.length}</span>
          )}
        </button>
      </div>

      {/* New Tokens Section */}
      {activeSection === 'new' && (
        <div className="space-y-3">
          {/* Live trade activity bar */}
          {tokenTrades.length > 0 && (
            <Panel>
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-cyan-400" />
                <h3 className="font-display font-semibold text-white text-sm">Live Trade Activity</h3>
                <span className="text-[10px] text-slate-500">(last {tokenTrades.length} trades on PumpPortal)</span>
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {tokenTrades.slice(0, 30).map((t, i) => (
                  <TradeActivityRow key={`${t.mint}-${i}`} trade={t} />
                ))}
              </div>
            </Panel>
          )}

          {newTokens.length === 0 ? (
            <Panel>
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Sparkles className="w-10 h-10 text-slate-600 mb-3" />
                <p className="text-slate-400 text-sm">
                  {feedStatus === 'connected'
                    ? 'Waiting for new token launches on PumpPortal…'
                    : 'Connecting to PumpPortal feed…'}
                </p>
                <p className="text-slate-500 text-xs mt-1">New tokens will appear here in real-time once detected.</p>
              </div>
            </Panel>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {newTokens.map((token) => (
                <NewTokenCard key={token.mint} token={token} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Purchased Tokens Section */}
      {activeSection === 'purchased' && (
        <div className="space-y-3">
          {/* Filter buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {(['all', 'buys', 'sells'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  filter === f
                    ? f === 'buys'
                      ? 'bg-green-500/20 border border-green-500/40 text-green-300'
                      : f === 'sells'
                        ? 'bg-red-500/20 border border-red-500/40 text-red-300'
                        : 'bg-cyan-500/20 border border-cyan-500/40 text-cyan-300'
                    : 'bg-white/5 border border-white/10 text-slate-400 hover:bg-white/10'
                }`}
              >
                {f === 'all' ? 'All Trades' : f === 'buys' ? 'Buys Only' : 'Sells Only'}
              </button>
            ))}
            <button
              onClick={() => void loadPurchased(true)}
              disabled={refreshing}
              className="ml-auto btn-ghost text-xs flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {tradeLoading ? (
            <Panel>
              <div className="flex items-center gap-3 text-slate-400 py-8 justify-center">
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span>Loading purchased tokens…</span>
              </div>
            </Panel>
          ) : filteredPurchased.length === 0 ? (
            <Panel>
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <ShoppingCart className="w-10 h-10 text-slate-600 mb-3" />
                <p className="text-slate-400 text-sm">No purchased tokens yet.</p>
                <p className="text-slate-500 text-xs mt-1">
                  Tokens bought by your trading agents will appear here with full trade details.
                </p>
              </div>
            </Panel>
          ) : (
            <Panel>
              <div className="space-y-2">
                {filteredPurchased.map((trade) => (
                  <PurchasedTokenRow key={trade.id} trade={trade} />
                ))}
              </div>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- New token card ----------

function NewTokenCard({ token }: { token: NewTokenEntry }) {
  const ageSec = Math.floor((Date.now() - token.discoveredAt) / 1000);
  const ageLabel = ageSec < 60 ? `${ageSec}s ago` : ageSec < 3600 ? `${Math.floor(ageSec / 60)}m ago` : `${Math.floor(ageSec / 3600)}h ago`;

  return (
    <div className="rounded-xl bg-white/5 border border-white/10 p-4 hover:border-cyan-400/30 transition-all group">
      <div className="flex items-start gap-3">
        {token.imageUri ? (
          <img
            src={token.imageUri}
            alt={token.symbol}
            className="w-12 h-12 rounded-lg object-cover border border-white/10 shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-galaxy-500/30 to-cyan-400/20 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-cyan-400" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-display font-bold text-white text-sm truncate">{token.symbol}</span>
            <span className="text-xs text-slate-500 truncate">{token.name}</span>
          </div>
          <div className="text-[10px] font-mono text-slate-500 truncate mt-0.5">{token.mint}</div>
        </div>
        <a
          href={`https://pump.fun/${token.mint}`}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 p-1.5 rounded-lg bg-white/5 hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"
          title="View on pump.fun"
        >
          <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
        </a>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3">
        <div className="rounded-lg bg-white/5 px-2.5 py-1.5">
          <div className="text-[9px] uppercase tracking-wider text-slate-500">Market Cap</div>
          <div className="font-mono text-xs neon-text-cyan">
            ${token.marketCap >= 1000 ? `${(token.marketCap / 1000).toFixed(1)}K` : token.marketCap.toFixed(0)}
          </div>
        </div>
        <div className="rounded-lg bg-white/5 px-2.5 py-1.5">
          <div className="text-[9px] uppercase tracking-wider text-slate-500">Detected</div>
          <div className="font-mono text-xs text-slate-300 flex items-center gap-1">
            <Clock className="w-3 h-3" /> {ageLabel}
          </div>
        </div>
      </div>

      <div className="mt-2 text-[10px] font-mono text-slate-500 truncate">
        Creator: {token.creator.slice(0, 6)}…{token.creator.slice(-4)}
      </div>
    </div>
  );
}

// ---------- Trade activity row (from feed) ----------

function TradeActivityRow({ trade }: { trade: TokenTradeEntry }) {
  const isBuy = trade.txType === 'buy';
  const ago = Math.floor((Date.now() - trade.time) / 1000);
  const agoLabel = ago < 60 ? `${ago}s` : `${Math.floor(ago / 60)}m`;

  return (
    <div className="flex items-center justify-between rounded-lg bg-white/5 px-2.5 py-1.5 text-xs">
      <div className="flex items-center gap-2 min-w-0">
        <span className={`font-semibold ${isBuy ? 'neon-text-green' : 'neon-text-red'}`}>
          {isBuy ? 'BUY' : 'SELL'}
        </span>
        <span className="font-mono text-slate-400 truncate">{trade.mint.slice(0, 10)}…</span>
        {trade.isRaydium && (
          <span className="rounded bg-purple-500/15 text-purple-300 text-[9px] px-1.5 py-0.5">Raydium</span>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="font-mono text-slate-300">{trade.solAmount.toFixed(3)} SOL</span>
        <span className="font-mono text-slate-500 text-[10px]">${(trade.marketCap / 1000).toFixed(1)}K</span>
        <span className="text-[10px] text-slate-500 font-mono">{agoLabel}</span>
      </div>
    </div>
  );
}

// ---------- Purchased token row (from database) ----------

function PurchasedTokenRow({ trade }: { trade: TradeRecord }) {
  const isBuy = trade.side === 'buy';
  const time = new Date(trade.created_at);
  const timeLabel = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateLabel = time.toLocaleDateString([], { month: 'short', day: 'numeric' });

  return (
    <div className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2.5 hover:bg-white/8 transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
          isBuy ? 'bg-green-500/15 border border-green-500/30' : 'bg-red-500/15 border border-red-500/30'
        }`}>
          {isBuy ? <ShoppingCart className="w-4 h-4 text-green-400" /> : <TrendingUp className="w-4 h-4 text-red-400" />}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold ${isBuy ? 'text-green-400' : 'text-red-400'}`}>
              {isBuy ? 'BUY' : 'SELL'}
            </span>
            <span className="text-sm text-white font-medium">{trade.token_symbol || 'UNKNOWN'}</span>
            <span className="text-[10px] text-slate-500">{trade.trader_name}</span>
          </div>
          <div className="text-[10px] font-mono text-slate-500 truncate mt-0.5">{trade.token_mint.slice(0, 16)}…</div>
        </div>
      </div>
      <div className="flex items-center gap-4 shrink-0 text-right">
        <div>
          <div className="font-mono text-sm text-slate-200">{trade.price_sol.toFixed(4)} SOL</div>
          <div className="text-[10px] text-slate-500">${trade.amount_usd.toFixed(2)}</div>
        </div>
        {trade.side === 'sell' && (
          <div>
            <div className={`font-mono text-sm ${trade.pnl_usd >= 0 ? 'neon-text-green' : 'neon-text-red'}`}>
              {trade.pnl_usd >= 0 ? '+' : ''}{trade.pnl_usd.toFixed(2)}
            </div>
            <div className="text-[10px] text-slate-500">PnL</div>
          </div>
        )}
        <div className="text-right">
          <div className="text-[10px] text-slate-400 font-mono">{timeLabel}</div>
          <div className="text-[10px] text-slate-500">{dateLabel}</div>
        </div>
        <span className={`text-[9px] uppercase font-mono px-2 py-1 rounded ${
          trade.status === 'executed'
            ? 'bg-green-500/10 text-green-400'
            : trade.status === 'failed'
              ? 'bg-red-500/10 text-red-400'
              : 'bg-white/5 text-slate-400'
        }`}>
          {trade.status}
        </span>
      </div>
    </div>
  );
}
