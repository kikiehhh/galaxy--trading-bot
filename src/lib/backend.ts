// Frontend client for the Galaxy Trading Server backend.
// When VITE_BACKEND_URL is set and the backend is healthy, the dashboard runs
// in LIVE mode (real on-chain trades via Helius + Jupiter). When the backend
// is unreachable or not configured, the dashboard falls back to SIM mode
// (the in-browser engine in src/lib/engine.ts).

export interface BackendStatus {
  ok: boolean;
  mode: 'live' | 'paper' | 'degraded';
  liveMainnet?: boolean;
  paperTrading?: boolean;
  walletFunded?: boolean;
  minWalletBalanceSol?: number;
  wallet: string | null;
  walletError: string | null;
  solBalance: number;
  feedStatus: string;
  feedEvents: number;
  autoTradeEnabled: boolean;
  autoBuySol: number;
  totalAutoBuys: number;
  totalAutoSells: number;
  lastAutoBuy: { time: number; whale: string; mint: string; solAmount: number; ok: boolean; signature?: string; error?: string } | null;
  lastError: string | null;
  trackedWhales: number;
  whaleStats: { address: string; buys: number; sells: number; wins: number; losses: number; profitSol: number }[];
  uptime: number;
}

export interface BuyResult {
  ok: boolean;
  signature: string | null;
  error?: string;
  side: 'buy';
  tokenMint: string;
  solAmount: number;
  outAmount?: string;
  priceImpactPct?: string;
}

export interface TurboBuyResult {
  ok: boolean;
  signature: string | null;
  error?: string;
  side: 'buy';
  tokenMint: string;
  solAmount: number;
  latencyMs: number;
  outAmount: string;
  priceImpactPct: string;
  simulated?: boolean;
  trader?: string | null;
}

export interface SellResult {
  ok: boolean;
  signature: string | null;
  error?: string;
  side: 'sell';
  tokenMint: string;
  tokenAmount: number;
  pnlSol?: number;
  outAmount?: string;
}

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/$/, '') || '';

// When VITE_BACKEND_URL is empty, we rely on the Vite dev-server proxy
// (configured in vite.config.ts) to forward /api/* requests to the backend
// on localhost:3000. This works in both `vite dev` and `vite preview`.
export function isBackendConfigured() {
  return true;
}

export function getBackendUrl() {
  return BACKEND_URL;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`Backend ${res.status}: ${contentType.includes('application/json') ? text : 'Backend response was not available'}`);
  }
  if (!contentType.includes('application/json')) {
    throw new Error('Backend response was not JSON');
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('Backend returned invalid JSON');
  }
}

let cachedStatus: BackendStatus | null = null;

export async function fetchStatus(): Promise<BackendStatus | null> {
  try {
    const data = await apiFetch<BackendStatus>('/api/status');
    cachedStatus = data;
    return data;
  } catch (e) {
    cachedStatus = null;
    return null;
  }
}

export function getCachedStatus() {
  return cachedStatus;
}

export async function backendBuy(tokenMint: string, solAmount: number, trader?: string): Promise<BuyResult> {
  return apiFetch<BuyResult>('/api/buy', {
    method: 'POST',
    body: JSON.stringify({ tokenMint, solAmount, trader }),
  });
}

export async function turboBuy(tokenMint: string, solAmount: number, trader?: string): Promise<TurboBuyResult> {
  return apiFetch<TurboBuyResult>('/api/turbo-buy', {
    method: 'POST',
    body: JSON.stringify({ tokenMint, solAmount, trader }),
  });
}

export async function prefetchTurboQuote(tokenMint: string, solAmount: number): Promise<{ ok: boolean; outAmount: string; priceImpactPct: string }> {
  const qs = new URLSearchParams({ tokenMint, solAmount: String(solAmount) }).toString();
  return apiFetch(`/api/turbo-quote?${qs}`);
}

export async function backendSell(tokenMint: string, tokenAmount: number, trader?: string): Promise<SellResult> {
  return apiFetch<SellResult>('/api/sell', {
    method: 'POST',
    body: JSON.stringify({ tokenMint, tokenAmount, trader }),
  });
}

export async function setAutoTrade(enabled: boolean): Promise<{ ok: boolean; autoTradeEnabled: boolean }> {
  return apiFetch('/api/auto-trade', {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });
}

export async function setLiveMainnet(enabled: boolean): Promise<{ ok: boolean; liveMainnet: boolean }> {
  return apiFetch('/api/live-mainnet', {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });
}

export async function emergencySellAll(): Promise<{ ok: boolean; message: string; openPositions: { mint: string; spentSol: number }[] }> {
  return apiFetch('/api/emergency-sell-all', { method: 'POST' });
}

export interface ScoutSignature {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown;
  memo: string | null;
}

export interface ScoutResult {
  ok: boolean;
  address: string;
  txCount: number;
  successCount: number;
  failCount: number;
  successRate: number;
  lastActivity: number | null;
  signatures: ScoutSignature[];
}

export async function scoutWhale(address: string, limit = 20): Promise<ScoutResult> {
  const qs = new URLSearchParams({ address, limit: String(limit) }).toString();
  return apiFetch<ScoutResult>(`/api/scout?${qs}`);
}

export interface WalletInfo {
  ok: boolean;
  address: string;
  connected: boolean;
  solBalance: number;
  lamports: number;
  owner: string | null;
  executable: boolean;
  rentEpoch: number | null;
  dataLen: number;
  empty: boolean;
}

export async function connectWallet(address: string): Promise<WalletInfo> {
  return apiFetch<WalletInfo>('/api/wallet/connect', {
    method: 'POST',
    body: JSON.stringify({ address }),
  });
}

// ---------- Trading agents status ----------

export interface AgentTrader {
  name: string;
  display_name: string;
  strategy: string;
  current_spend: number;
  win_streak: number;
  lose_streak: number;
  status: string;
  today_trades: number;
  today_wins: number;
  today_losses: number;
  today_pnl: number;
  total_pnl: number;
  holding_token: string | null;
  active: boolean;
  updated_at: string;
}

export interface RiskManagerBOS {
  name: string;
  display_name: string;
  strategy: string;
  status: 'active' | 'manual' | 'halted';
  active: boolean;
  auto_risk: boolean;
  emergency_stop: boolean;
  profit_locked: boolean;
  max_daily_spend: number;
  daily_spend_used: number;
  daily_pnl_pct: number;
  daily_stop_loss_pct: number;
  daily_take_profit_pct: number;
  auto_increase_pct: number;
  auto_decrease_pct: number;
  min_spend: number;
  max_spend: number;
  max_open_positions: number;
  max_positions_per_token: number;
  token_cooldown_seconds: number;
  updated_at: string;
}

export interface AgentsSummary {
  activeCount: number;
  totalAgents: number;
  totalTodayPnl: number;
  totalPnl: number;
  totalTrades: number;
  totalWins: number;
  totalLosses: number;
  winRate: number;
  totalSpend: number;
  autoConfirm?: boolean;
  walletConfigured?: boolean;
  walletAddress?: string | null;
}

export interface AgentsStatus {
  ok: boolean;
  traders: AgentTrader[];
  riskManager: RiskManagerBOS | null;
  summary: AgentsSummary;
}

export async function fetchAgents(): Promise<AgentsStatus> {
  return apiFetch<AgentsStatus>('/api/agents');
}

export interface TradeRecord {
  id: string;
  trader_name: string;
  side: 'buy' | 'sell';
  token_mint: string;
  token_symbol: string;
  amount_usd: number;
  price_sol: number;
  pnl_usd: number;
  status: string;
  created_at: string;
}

export async function fetchTrades(limit = 50): Promise<{ ok: boolean; trades: TradeRecord[] }> {
  return apiFetch(`/api/trades?limit=${limit}`);
}

// ---------- Trader wallet status ----------

export interface TraderWalletStatus {
  ok: boolean;
  configured: boolean;
  address: string | null;
  autoConfirm: boolean;
  autoTradeEnabled?: boolean;
}

export async function fetchTraderWallet(): Promise<TraderWalletStatus> {
  return apiFetch<TraderWalletStatus>('/api/trader/wallet');
}

// ---------- Wallet config (public address only) ----------

export interface WalletConfig {
  ok: boolean;
  configured: boolean;
  publicKey: string | null;
}

export async function fetchWalletConfig(): Promise<WalletConfig> {
  return apiFetch<WalletConfig>('/api/wallet-config');
}

// ---------- Whale safety pre-filter ----------

export interface WhaleSafetyEntry {
  status: 'safe' | 'danger' | 'unknown' | 'pending';
  checkedAt: number;
  top10Pct?: number;
  devPct?: number;
  reasons: string[];
}

export interface WhaleSafetyResponse {
  ok: boolean;
  safety: Record<string, WhaleSafetyEntry>;
}

export async function fetchWhaleSafety(mints?: string[]): Promise<WhaleSafetyResponse> {
  const qs = mints && mints.length > 0 ? `?mints=${mints.join(',')}` : '';
  return apiFetch<WhaleSafetyResponse>(`/api/whale-safety${qs}`);
}

// ---------- Live wallet snapshot (real-time balances + PNL) ----------

export interface RpcStatus {
  status: 'live' | 'degraded' | 'connecting';
  source: 'helius' | 'public' | 'none';
  lastUpdate: number | null;
  error: string | null;
  wsConnected: boolean;
}

export interface LiveTokenHolding {
  mint: string;
  amount: number;
  decimals: number;
  priceUsd: number | null;
  valueUsd: number | null;
  entryPriceUsd: number | null;
  pnlUsd: number | null;
  pnlPct: number | null;
}

export interface LiveWalletSnapshot {
  ok: boolean;
  configured: boolean;
  address: string | null;
  rpc: RpcStatus;
  solBalance: number;
  solPriceUsd: number | null;
  solUsd: number | null;
  tokens: LiveTokenHolding[];
  portfolioUsd: number | null;
  baselineUsd: number | null;
  allTimePnlUsd: number | null;
  priceUpdatedAt: number | null;
}

export async function fetchLiveWallet(): Promise<LiveWalletSnapshot> {
  return apiFetch<LiveWalletSnapshot>('/api/trader/live');
}

// ---------- Update trader private key at runtime ----------

export interface TraderKeyUpdate {
  ok: boolean;
  configured: boolean;
  address: string | null;
  error?: string;
  hint?: string;
  message?: string;
}

export async function updateTraderPrivateKey(privateKey: string): Promise<TraderKeyUpdate> {
  return apiFetch<TraderKeyUpdate>('/api/trader/private-key', {
    method: 'POST',
    body: JSON.stringify({ privateKey }),
  });
}

// ---------- Generate trader wallet (key shown once) ----------

export interface GeneratedWallet {
  ok: boolean;
  configured: boolean;
  address: string | null;
  privateKeyBase58: string | null;
  privateKeyJson: string | null;
  error?: string;
  message?: string;
}

export async function generateTraderWallet(): Promise<GeneratedWallet> {
  return apiFetch<GeneratedWallet>('/api/trader/generate-wallet', { method: 'POST' });
}

// ---------- Trader wallet transaction history ----------

export interface WalletTransaction {
  signature: string;
  blockTime: number | null;
  slot: number;
  direction: 'in' | 'out';
  amountSol: number;
  counterparty: string | null;
  feeSol: number;
  err: unknown;
}

export interface TransactionHistory {
  ok: boolean;
  configured: boolean;
  address: string | null;
  transactions: WalletTransaction[];
  error?: string;
}

export async function fetchTraderTransactions(limit = 20): Promise<TransactionHistory> {
  return apiFetch<TransactionHistory>(`/api/trader/transactions?limit=${limit}`);
}

// ---------- Send SOL / SPL token from trader wallet ----------

export interface TransferResult {
  ok: boolean;
  signature: string | null;
  side: 'transfer';
  asset: 'sol' | 'token';
  mint?: string;
  destination: string;
  amount: number;
  error?: string;
}

export async function sendTransfer(
  destination: string,
  amount: number,
  mint?: string,
): Promise<TransferResult> {
  return apiFetch<TransferResult>('/api/trader/transfer', {
    method: 'POST',
    body: JSON.stringify({ destination, amount, mint }),
  });
}

// ---------- Self-Heal Bot ----------

export interface HealLogEntry {
  time: string;
  message: string;
}

export interface HealthStatus {
  ok: boolean;
  walletConfigured: boolean;
  walletAddress: string | null;
  rpcStatus: 'live' | 'degraded';
  rpcUrl: string;
  rpcError: string | null;
  jupiterStatus: 'live' | 'degraded';
  jupiterError: string | null;
  lastHeal: number | null;
  lastCheck: number | null;
  log: HealLogEntry[];
  logEntries: number;
}

export async function fetchHealth(): Promise<HealthStatus> {
  return apiFetch<HealthStatus>('/api/health');
}

export interface SelfHealResult {
  ok: boolean;
  actions: string[];
  health: HealthStatus;
}

export async function triggerSelfHeal(): Promise<SelfHealResult> {
  return apiFetch<SelfHealResult>('/api/self-heal', { method: 'POST' });
}

// ---------- Telegram alert config ----------

export interface TelegramConfig {
  ok: boolean;
  configured: boolean;
  hasBotToken: boolean;
  hasChatId: boolean;
  chatIdPreview: string | null;
  error?: string;
}

export async function fetchTelegramConfig(): Promise<TelegramConfig> {
  return apiFetch<TelegramConfig>('/api/telegram/config');
}

export async function saveTelegramConfig(botToken: string, chatId: string): Promise<TelegramConfig> {
  return apiFetch<TelegramConfig>('/api/telegram/config', {
    method: 'POST',
    body: JSON.stringify({ botToken, chatId }),
  });
}

export async function sendTelegramTest(): Promise<{ ok: boolean; message: string; error?: string }> {
  return apiFetch<{ ok: boolean; message: string; error?: string }>('/api/telegram/test', { method: 'POST' });
}
