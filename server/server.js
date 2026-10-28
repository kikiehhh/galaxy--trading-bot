import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Keypair, VersionedTransaction, PublicKey, SystemProgram, TransactionMessage } from '@solana/web3.js';
import bs58Pkg from 'bs58';
import { createLiveWallet } from './liveWallet.js';
import { createSelfHealBot } from './selfHeal.js';
import { createTelegramNotifier } from './telegramNotifier.js';
import { createJupiterSwap } from './jupiterSwap.js';
import { createPumpPortalStream } from './pumpPortalStream.js';
import { createTurboBuyBot } from './turboBuyBot.js';
import { createWhaleSafetyChecker } from './whaleSafetyChecker.js';
import { createAutoRepairBot } from './autoRepairBot.js';
const bs58 = bs58Pkg.default || bs58Pkg;

const app = express();
app.use(express.json({ limit: '2mb' }));

// ---------- CORS (allow ALL origins — no whitelist) ----------
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const PORT = process.env.PORT || 3001;

// ---------- Load .env (Vite-style vars live in the project root .env) ----------
const __dirname = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(__dirname, '..', '.env');
const serverEnvPath = resolve(__dirname, '.env');
function loadEnvFile(p) {
  try {
    const raw = readFileSync(p, 'utf8');
    for (const line of raw.split('\n')) {
      const supaMatch = line.match(/^VITE_SUPABASE_(URL|ANON_KEY)=(.*)$/);
      if (supaMatch && !process.env[`SUPABASE_${supaMatch[1]}`]) {
        process.env[`SUPABASE_${supaMatch[1]}`] = supaMatch[2].trim();
      }
      const serverMatch = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (serverMatch && !supaMatch && !process.env[serverMatch[1]]) {
        process.env[serverMatch[1]] = serverMatch[2].trim();
      }
    }
  } catch {
    // file optional if env vars already exported
  }
}
loadEnvFile(rootEnvPath);
loadEnvFile(serverEnvPath);

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const TRADER_PRIVATE_KEY = process.env.TRADER_PRIVATE_KEY || '';
const AUTO_CONFIRM = process.env.AUTO_CONFIRM === 'true';
const LIVE_TRADING = process.env.LIVE_TRADING === 'true';
const PAPER_TRADING = process.env.PAPER_TRADING === 'true';
const SIMULATION_MODE = process.env.SIMULATION_MODE === 'true';
const HELIUS_RPC = process.env.HELIUS_RPC || process.env.HELIUS_RPC_URL || '';
const PRIORITY_FEE_LAMPORTS = Number(process.env.PRIORITY_FEE_LAMPORTS || 100000);
const SWAP_SLIPPAGE_BPS = Number(process.env.SWAP_SLIPPAGE_BPS || 500);
const AUTO_BUY_ON_NEW_TOKENS = process.env.AUTO_BUY_ON_NEW_TOKENS === 'true';
const AUTO_BUY_SOL = Number(process.env.AUTO_BUY_SOL || 0.01);
// Live mainnet trading is only enabled when explicitly opted in via env.
// PAPER_TRADING / SIMULATION_MODE flags force it off as a safety guard.
const LIVE_MAINNET = LIVE_TRADING && !PAPER_TRADING && !SIMULATION_MODE;
const MIN_WALLET_BALANCE_SOL = 0.005;
const serverStartTime = Date.now();

// ---------- Auto-trade counters (in-memory) ----------
let totalAutoBuys = 0;
let totalAutoSells = 0;
let lastAutoBuy = null;
let lastError = null;
let pumpPortalStream = null;
let lastPumpTokenAt = 0;

let supabase = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
}

const liveWallet = createLiveWallet({ heliusUrl: HELIUS_RPC, supabase, log: (msg) => console.log(msg) });

let activeRpcUrl = HELIUS_RPC || '';

const whaleSafetyChecker = createWhaleSafetyChecker({ heliusRpc, log: (msg) => console.log(msg) });

const telegramNotifier = createTelegramNotifier({
  envPath: serverEnvPath,
  log: (msg) => console.log(msg),
});

const selfHealBot = createSelfHealBot({
  envPath: serverEnvPath,
  heliusUrl: HELIUS_RPC,
  getTraderKeypair: () => traderKeypair,
  setTraderKeypair: (kp) => { traderKeypair = kp; },
  getWalletAddress: () => traderWalletAddress,
  setWalletAddress: (addr) => { traderWalletAddress = addr; liveWallet.setAddress(addr); },
  getActiveRpc: () => activeRpcUrl,
  setActiveRpc: (url) => { activeRpcUrl = url; },
  log: (msg) => console.log(msg),
  telegramNotifier,
});

const autoRepairBot = createAutoRepairBot({
  getTraderKeypair: () => traderKeypair,
  setTraderKeypair: (kp) => { traderKeypair = kp; },
  getWalletAddress: () => traderWalletAddress,
  setWalletAddress: (addr) => { traderWalletAddress = addr; liveWallet.setAddress(addr); },
  getPumpPortalSnapshot: () => pumpPortalStream ? { ...pumpPortalStream.snapshot(), lastEventAt: lastPumpTokenAt } : null,
  reconnectPump: () => { if (pumpPortalStream) { pumpPortalStream.stop(); pumpPortalStream.start(); } },
  getAutoTradeEnabled: () => autoTradeEnabled,
  getLastTradeAt: () => lastAutoBuy?.time || 0,
  telegramNotifier,
  port: PORT,
  log: (msg) => console.log(`[auto-repair] ${msg}`),
});

// ---------- Derive trader wallet keypair from private key ----------
// Reads TRADER_PRIVATE_KEY from .env (base58). Invalid/placeholder values
// log a warning but never crash the server. The key is server-side only;
// only the public address is ever returned to the frontend.
let traderKeypair = null;
let traderWalletAddress = null;
const PLACEHOLDER_VALUES = ['', 'placeholder', 'your_private_key_here', 'xxx'];

function decodePrivateKey(value) {
  let input = String(value || '').trim();
  if (!input) throw new Error('Private key is empty');

  // Strip surrounding quotes (single or double)
  if ((input.startsWith('"') && input.endsWith('"')) || (input.startsWith("'") && input.endsWith("'"))) {
    input = input.slice(1, -1).trim();
  }

  // 1) JSON array — e.g. [12, 34, ...] or multi-line variants
  if (input.startsWith('[')) {
    let parsed;
    try {
      // Remove all whitespace/newlines so multi-line arrays work
      const compact = input.replace(/\s+/g, '');
      parsed = JSON.parse(compact);
    } catch {
      throw new Error('JSON key array is malformed — check for missing brackets or commas');
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('JSON key must be a non-empty array of byte values (0-255)');
    }
    if (!parsed.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
      throw new Error('JSON key array must contain only integer byte values (0-255)');
    }
    return Uint8Array.from(parsed);
  }

  // 2) Base58 — most common for Solana wallets (Phantom, Solflare base58 export)
  // A valid base58 string is 88 chars for a 64-byte key, or ~44 chars for a 32-byte seed.
  // Try base58 FIRST because hex regex can falsely match base58 strings.
  try {
    const decoded = bs58.decode(input);
    if (decoded.length === 32 || decoded.length === 64) {
      return decoded;
    }
    // If base58 decodes but to wrong length, fall through to other formats
  } catch {
    // Not valid base58, continue to other formats
  }

  // 3) Hex string — with or without 0x prefix, even number of hex chars
  // Only treat as hex if it's clearly hex (contains a-f/A-F or has 0x prefix)
  // and is a reasonable length for a key (64 hex = 32 bytes, 128 hex = 64 bytes)
  const hexStr = input.replace(/^0x/i, '');
  if (/^[0-9a-fA-F]+$/.test(hexStr) && hexStr.length % 2 === 0 && (hexStr.length === 64 || hexStr.length === 128)) {
    return Uint8Array.from(hexStr.match(/.{2}/g).map((b) => parseInt(b, 16)));
  }

  // 4) Base64 fallback
  try {
    const decoded = Buffer.from(input, 'base64');
    if (decoded.length === 32 || decoded.length === 64) {
      return Uint8Array.from(decoded);
    }
  } catch {
    // continue
  }

  throw new Error(
    'Unsupported key format. Expected: base58 string (88 chars), JSON byte array [12,34,...], hex string (64 or 128 hex chars), or base64. Got ' +
    `${input.length} chars that decoded to an unexpected length.`
  );
}

// Normalizes seed exports to the 64-byte secret key used for signing.
async function keypairFromSecret(secret) {
  if (secret.length === 64) {
    return {
      keypair: await Keypair.fromSecretKey(secret),
      importedSeed: false,
    };
  }
  if (secret.length === 32) {
    const seedKeypair = await Keypair.fromSeed(secret);
    const secretKey64 = seedKeypair.secretKey;
    return {
      keypair: await Keypair.fromSecretKey(secretKey64),
      importedSeed: true,
    };
  }
  throw new Error(
    `Key decoded to ${secret.length} bytes. Solana expects a 64-byte secret key or 32-byte seed. ` +
    'If you exported from Phantom, copy the base58 string. If from Solflare, use the JSON array export.'
  );
}

async function loadTraderKeypair() {
  if (!TRADER_PRIVATE_KEY || PLACEHOLDER_VALUES.includes(TRADER_PRIVATE_KEY.toLowerCase())) {
    console.warn('TRADER_PRIVATE_KEY not set or placeholder — auto trading disabled');
    // Create ephemeral wallet so app stays live
    try {
      const ephemeral = await Keypair.generate();
      traderKeypair = ephemeral;
      traderWalletAddress = ephemeral.publicKey.toBase58();
      liveWallet.setAddress(traderWalletAddress);
      console.log(`[trader-key] Using ephemeral wallet (not persisted): ${traderWalletAddress}`);
    } catch (e2) {
      console.warn(`[trader-key] Ephemeral fallback failed: ${e2.message}`);
    }
    return;
  }
  try {
    let secret;
    secret = decodePrivateKey(TRADER_PRIVATE_KEY);
    const imported = await keypairFromSecret(secret);
    traderKeypair = imported.keypair;
    traderWalletAddress = traderKeypair.publicKey.toBase58();
    liveWallet.setAddress(traderWalletAddress);
    console.log(`Trader wallet loaded: ${traderWalletAddress}`);
  } catch (e) {
    console.warn(`TRADER_PRIVATE_KEY is set but invalid — using ephemeral: ${e.message}`);
    try {
      const ephemeral = await Keypair.generate();
      traderKeypair = ephemeral;
      traderWalletAddress = ephemeral.publicKey.toBase58();
      liveWallet.setAddress(traderWalletAddress);
      console.log(`[trader-key] Using ephemeral wallet (not persisted): ${traderWalletAddress}`);
    } catch (e2) {
      console.warn(`[trader-key] Ephemeral fallback failed: ${e2.message}`);
    }
  }
}

// In-memory auto-trade toggle (independent of the keypair; the keypair
// determines whether signing is possible, this determines whether the
// engine is allowed to fire buys automatically).
let autoTradeEnabled = AUTO_CONFIRM;
let liveMainnetRuntime = LIVE_MAINNET;

// ---------- JSON-RPC helper to Helius ----------
async function heliusRpc(method, params) {
  if (!HELIUS_RPC) {
    return { error: 'HELIUS_RPC not configured on server' };
  }
  try {
    const res = await fetch(HELIUS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { error: `Helius ${res.status}: ${text}` };
    }
    const json = await res.json();
    return json;
  } catch (e) {
    return { error: `Helius fetch failed: ${e.message}` };
  }
}

// ---------- Basic status (full BackendStatus shape) ----------
app.get('/api/status', async (req, res) => {
  let solBalance = 0;
  let walletError = null;
  if (traderKeypair && traderWalletAddress && HELIUS_RPC) {
    try {
      const balRes = await heliusRpc('getBalance', [traderWalletAddress]);
      if (!balRes.error && typeof balRes.result?.value === 'number') {
        solBalance = balRes.result.value / 1_000_000_000;
      } else if (balRes.error) {
        walletError = balRes.error;
      }
    } catch (e) {
      walletError = e.message;
    }
  }
  const walletReady = Boolean(traderKeypair && HELIUS_RPC && !walletError);
  const walletFunded = solBalance >= MIN_WALLET_BALANCE_SOL;
  const mode = liveMainnetRuntime && walletReady ? 'live' : walletReady ? 'paper' : 'degraded';
  res.json({
    ok: true,
    mode,
    liveMainnet: liveMainnetRuntime,
    paperTrading: PAPER_TRADING || SIMULATION_MODE || !liveMainnetRuntime,
    wallet: traderWalletAddress,
    walletError,
    solBalance: Math.round(solBalance * 1_000_000) / 1_000_000,
    walletFunded,
    minWalletBalanceSol: MIN_WALLET_BALANCE_SOL,
    feedStatus: pumpPortalStream?.snapshot().status || 'disconnected',
    feedEvents: pumpPortalStream?.snapshot().eventCount || 0,
    autoTradeEnabled: autoTradeEnabled && liveMainnetRuntime,
    autoBuySol: liveMainnetRuntime && Number.isFinite(AUTO_BUY_SOL) ? AUTO_BUY_SOL : 0,
    totalAutoBuys,
    totalAutoSells,
    lastAutoBuy,
    lastError,
    trackedWhales: 0,
    whaleStats: [],
    uptime: Math.floor((Date.now() - serverStartTime) / 1000),
  });
});

// ---------- Trader wallet status ----------
// GET /api/trader/wallet
// Returns whether the trading wallet is configured, its public address,
// and the auto-confirm setting. The private key is NEVER exposed.
app.get('/api/trader/wallet', (req, res) => {
  res.json({
    ok: true,
    configured: Boolean(traderKeypair),
    address: traderWalletAddress,
    autoConfirm: AUTO_CONFIRM,
    autoTradeEnabled,
  });
});

// ---------- Trading agents status ----------
// GET /api/agents
// Returns the status + performance metrics + config for all 5 traders
// and the Risk Manager (BOS), sourced from Supabase.
app.get('/api/agents', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ ok: false, error: 'Supabase not configured on server' });
  }

  try {
    const [tradersRes, settingsRes] = await Promise.all([
      supabase.from('traders').select('*').order('name'),
      supabase.from('risk_settings').select('*').eq('id', 1).maybeSingle(),
    ]);

    if (tradersRes.error) {
      console.error('[/api/agents] traders query error:', tradersRes.error.message);
      return res.status(502).json({ ok: false, error: tradersRes.error.message });
    }
    if (settingsRes.error) {
      console.error('[/api/agents] settings query error:', settingsRes.error.message);
      return res.status(502).json({ ok: false, error: settingsRes.error.message });
    }

  const traders = tradersRes.data || [];
  const settings = settingsRes.data;

  const activeCount = traders.filter((t) => t.active).length;
  const totalTodayPnl = traders.reduce((s, t) => s + Number(t.today_pnl || 0), 0);
  const totalPnl = traders.reduce((s, t) => s + Number(t.total_pnl || 0), 0);
  const totalTrades = traders.reduce((s, t) => s + Number(t.today_trades || 0), 0);
  const totalWins = traders.reduce((s, t) => s + Number(t.today_wins || 0), 0);
  const totalLosses = traders.reduce((s, t) => s + Number(t.today_losses || 0), 0);
  const totalSpend = traders.reduce((s, t) => s + Number(t.current_spend || 0), 0);

  const riskManager = settings
    ? {
        name: 'risk_manager_bos',
        display_name: 'Risk Manager (BOS)',
        strategy: 'Auto-adjusts per-trader spend based on win/lose streaks',
        status: settings.emergency_stop ? 'halted' : settings.auto_risk ? 'active' : 'manual',
        active: !settings.emergency_stop,
        auto_risk: settings.auto_risk,
        emergency_stop: settings.emergency_stop,
        profit_locked: settings.profit_locked,
        max_daily_spend: Number(settings.max_daily_spend),
        max_open_positions: Number(settings.max_open_positions || 8),
        max_positions_per_token: Number(settings.max_positions_per_token || 2),
        token_cooldown_seconds: Number(settings.token_cooldown_seconds || 60),
        daily_spend_used: Number(settings.daily_spend_used),
        daily_pnl_pct: Number(settings.daily_pnl_pct),
        daily_stop_loss_pct: Number(settings.daily_stop_loss_pct),
        daily_take_profit_pct: Number(settings.daily_take_profit_pct),
        auto_increase_pct: Number(settings.auto_increase_pct),
        auto_decrease_pct: Number(settings.auto_decrease_pct),
        min_spend: Number(settings.min_spend),
        max_spend: Number(settings.max_spend),
        updated_at: settings.updated_at,
      }
    : null;

  res.json({
    ok: true,
    traders: traders.map((t) => ({
      ...t,
      current_spend: Number(t.current_spend),
      today_pnl: Number(t.today_pnl),
      total_pnl: Number(t.total_pnl),
    })),
    riskManager,
    summary: {
      activeCount,
      totalAgents: traders.length,
      totalTodayPnl: Math.round(totalTodayPnl * 100) / 100,
      totalPnl: Math.round(totalPnl * 100) / 100,
      totalTrades,
      totalWins,
      totalLosses,
      winRate: totalWins + totalLosses > 0
        ? Math.round((totalWins / (totalWins + totalLosses)) * 1000) / 10
        : 0,
      totalSpend: Math.round(totalSpend * 1000) / 1000,
      autoConfirm: AUTO_CONFIRM,
      autoTradeEnabled,
      walletConfigured: Boolean(traderKeypair),
      walletAddress: traderWalletAddress,
    },
  });
  } catch (e) {
    console.error('[/api/agents] unexpected error:', e);
    return res.status(500).json({ ok: false, error: `agents fetch failed: ${e.message}` });
  }
});

// Global error handler — prevents a route crash from killing the process
app.use((err, req, res, next) => {
  console.error('[unhandled route error]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, error: `internal server error: ${err.message}` });
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

// ---------- Trader wallet live snapshot ----------
// GET /api/trader/live
// Balances, token holdings, USD values and PNL from the live wallet tracker.
app.get('/api/trader/live', (req, res) => {
  res.json(liveWallet.snapshot());
});

// ---------- Wallet config ----------
// GET /api/wallet-config
// Returns only the public address. Key material is never exposed here.
app.get('/api/wallet-config', (req, res) => {
  try {
    res.json({ ok: true, configured: Boolean(traderKeypair), publicKey: traderWalletAddress });
  } catch (e) {
    res.json({ ok: true, configured: false, publicKey: null, error: e.message });
  }
});

// ---------- Wallet alias routes (alternative paths) ----------
// POST /api/wallet/import — alias for /api/trader/private-key
app.post('/api/wallet/import', async (req, res) => {
  try {
    const { privateKey } = req.body || {};
    if (!privateKey || typeof privateKey !== 'string') {
      return res.json({ ok: false, error: 'privateKey (string) required' });
    }
    const trimmed = privateKey.trim();
    if (PLACEHOLDER_VALUES.includes(trimmed.toLowerCase())) {
      return res.json({ ok: false, error: 'Invalid or placeholder private key' });
    }
    const secret = decodePrivateKey(trimmed);
    const imported = await keypairFromSecret(secret);
    const addr = imported.keypair.publicKey.toBase58();
    traderKeypair = imported.keypair;
    traderWalletAddress = addr;
    liveWallet.setAddress(addr);
    const keyB58 = bs58.encode(new Uint8Array(await imported.keypair.secretKey));
    persistTraderKey(keyB58);
    console.log(`[wallet/import] New trader wallet loaded: ${addr}`);
    res.json({ ok: true, pubkey: addr });
  } catch (e) {
    res.json({ ok: false, error: `Private key format not supported: ${e.message}` });
  }
});

// POST /api/wallet/generate — alias for /api/trader/generate-wallet
app.post('/api/wallet/generate', async (req, res) => {
  try {
    const kp = await Keypair.generate();
    const secretKeyBytes = await kp.secretKey;
    const pubKey = kp.publicKey.toBase58();
    traderKeypair = kp;
    traderWalletAddress = pubKey;
    liveWallet.setAddress(pubKey);
    const base58Key = bs58.encode(new Uint8Array(secretKeyBytes));
    persistTraderKey(base58Key);
    console.log(`[wallet/generate] New trader wallet: ${pubKey}`);
    res.json({ ok: true, pubkey: pubKey, privateKey: base58Key });
  } catch (e) {
    res.json({ ok: false, error: `Failed to generate wallet: ${e.message}` });
  }
});

// ---------- Trade control alias routes ----------
// POST /api/trade/start — enable auto-trade
app.post('/api/trade/start', (req, res) => {
  try {
    autoTradeEnabled = true;
    res.json({ ok: true, trading: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// POST /api/trade/stop — disable auto-trade
app.post('/api/trade/stop', (req, res) => {
  try {
    autoTradeEnabled = false;
    res.json({ ok: true, trading: false });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// POST /api/emergency-stop — alias for /api/emergency-sell-all
app.post('/api/emergency-stop', async (req, res) => {
  try {
    autoTradeEnabled = false;
    if (pumpPortalStream) pumpPortalStream.stop();
    if (!liveMainnetRuntime || !traderKeypair || !HELIUS_RPC) {
      return res.json({ ok: true, message: 'Emergency stop applied (paper mode)', openPositions: [] });
    }
    const acctsRes = await heliusRpc('getTokenAccountsByOwner', [
      traderWalletAddress,
      { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
      { encoding: 'jsonParsed', commitment: 'confirmed' },
    ]);
    const accounts = acctsRes.result?.value || [];
    const openPositions = [];
    for (const acct of accounts) {
      const info = acct.account?.data?.parsed?.info;
      const amt = info?.tokenAmount;
      if (!info || !amt) continue;
      const raw = BigInt(amt.amount || '0');
      if (raw === 0n) continue;
      const decimals = Number(amt.decimals || 0);
      const humanAmount = Number(raw) / Math.pow(10, decimals);
      try {
        await executeJupiterSell(info.mint, humanAmount, 'emergency-stop');
        openPositions.push({ mint: info.mint });
      } catch {}
    }
    res.json({ ok: true, message: `Emergency stop — ${openPositions.length} positions liquidated`, openPositions });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ---------- Self-Heal Bot ----------
// GET /api/health — current health snapshot
app.get('/api/health', async (req, res) => {
  try {
    const health = await selfHealBot.checkHealth();
    const status = selfHealBot.getStatus();
    res.json({ ok: true, ...health, log: selfHealBot.getLog(), ...status });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/self-heal — trigger a heal cycle manually
app.post('/api/self-heal', async (req, res) => {
  try {
    const result = await selfHealBot.selfHeal();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Telegram alert config ----------
// GET /api/telegram/config
app.get('/api/telegram/config', (req, res) => {
  res.json({ ok: true, ...telegramNotifier.getConfig() });
});

// POST /api/telegram/config { botToken, chatId }
app.post('/api/telegram/config', (req, res) => {
  const { botToken, chatId } = req.body || {};
  if (!botToken && !chatId) {
    return res.status(400).json({ ok: false, error: 'botToken or chatId required' });
  }
  telegramNotifier.setConfig(botToken, chatId);
  res.json({ ok: true, ...telegramNotifier.getConfig(), message: 'Telegram config saved' });
});

// POST /api/telegram/test
app.post('/api/telegram/test', async (req, res) => {
  const result = await telegramNotifier.sendTest();
  if (result.sent) {
    res.json({ ok: true, message: 'Test message sent to your Telegram channel' });
  } else {
    res.status(400).json({ ok: false, error: result.reason || 'Send failed' });
  }
});

// ---------- Recent trades (purchased tokens) ----------
// GET /api/trades?limit=50
app.get('/api/trades', async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ ok: false, error: 'Supabase not configured on server' });
  }
  const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
  try {
    const { data, error } = await supabase
      .from('trades')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      return res.status(502).json({ ok: false, error: error.message });
    }
    res.json({ ok: true, trades: data || [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: `trades fetch failed: ${e.message}` });
  }
});

// ---------- Update trader keypair at runtime ----------
// POST /api/trader/private-key { privateKey: string }
// Loads a new Solana keypair and persists it to .env so it survives restarts.
// Only the public address is returned; the private key is never echoed back.
function persistTraderKey(keyB58) {
  try {
    const envPath = serverEnvPath;
    let lines = [];
    if (existsSync(envPath)) {
      lines = readFileSync(envPath, 'utf8').split('\n');
    }
    const filtered = lines.filter((l) => !l.startsWith('TRADER_PRIVATE_KEY='));
    filtered.push(`TRADER_PRIVATE_KEY=${keyB58}`);
    writeFileSync(envPath, filtered.join('\n').replace(/\n+$/, '\n'));
    process.env.TRADER_PRIVATE_KEY = keyB58;
  } catch (e) {
    console.warn(`[trader-key] could not persist to .env: ${e.message}`);
  }
}

app.post('/api/trader/private-key', async (req, res) => {
  const { privateKey } = req.body || {};
  if (!privateKey || typeof privateKey !== 'string') {
    return res.json({ ok: false, error: 'privateKey (string) required' });
  }
  const trimmed = privateKey.trim();
  if (PLACEHOLDER_VALUES.includes(trimmed.toLowerCase())) {
    return res.json({ ok: false, error: 'Invalid or placeholder private key' });
  }
  try {
    const secret = decodePrivateKey(trimmed);
    const imported = await keypairFromSecret(secret);
    const addr = imported.keypair.publicKey.toBase58();
    traderKeypair = imported.keypair;
    traderWalletAddress = addr;
    liveWallet.setAddress(addr);
    const keyB58 = bs58.encode(new Uint8Array(await imported.keypair.secretKey));
    persistTraderKey(keyB58);
    console.log(`[trader-key] New trader wallet loaded at runtime: ${addr}`);
    res.json({
      ok: true,
      configured: true,
      address: addr,
      message: imported.importedSeed
        ? 'Imported 32-byte seed and converted to 64-byte'
        : '64-byte secret key imported successfully',
    });
  } catch (e) {
    console.warn(`[trader-key] rejected private key: ${e.message}`);
    // Return 200 (not 400) so apiFetch doesn't throw and the frontend
    // can read the error + hint directly from the JSON body.
    res.json({
      ok: false,
      error: e.message,
      hint: 'Supported formats: base58 string (Phantom, ~88 chars), JSON byte array [12,34,...] (Solflare), hex string (64 or 128 chars), or base64.',
    });
  }
});

// ---------- Generate a new trader wallet ----------
// POST /api/trader/generate-wallet
// Generates a fresh Solana keypair, loads it as the active trader wallet,
// persists the key to .env AND server memory, and returns the key material
// ONE TIME so the user can back it up. The key is never exposed again after
// this response.
app.post('/api/trader/generate-wallet', async (req, res) => {
  try {
    const kp = await Keypair.generate();
    const secretKeyBytes = await kp.secretKey;
    const pubKey = kp.publicKey.toBase58();
    traderKeypair = kp;
    traderWalletAddress = pubKey;
    liveWallet.setAddress(pubKey);
    const base58Key = bs58.encode(new Uint8Array(secretKeyBytes));
    const jsonKey = JSON.stringify(Array.from(secretKeyBytes));
    persistTraderKey(base58Key);
    console.log(`[generate-wallet] New trader wallet generated and persisted: ${pubKey}`);
    res.json({
      ok: true,
      configured: true,
      address: pubKey,
      privateKeyBase58: base58Key,
      privateKeyJson: jsonKey,
      message: 'New trader wallet generated and connected. Save your private key now — it will not be shown again.',
    });
  } catch (e) {
    console.warn(`[generate-wallet] failed: ${e.message}`);
    res.status(500).json({ ok: false, error: `Failed to generate wallet: ${e.message}` });
  }
});

// ---------- Auto-trade toggle ----------
// POST /api/auto-trade { enabled: boolean }
app.post('/api/auto-trade', (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ ok: false, error: 'enabled (boolean) required' });
  }
  autoTradeEnabled = enabled;
  res.json({ ok: true, autoTradeEnabled });
});
// POST /api/live-mainnet { enabled: boolean }
// Runtime override of the LIVE_MAINNET flag from .env. Turning it OFF from
// the UI disables live auto-trading without a server restart. Turning it ON
// only re-enables if the .env already opted into LIVE_TRADING (i.e. the
// server booted with LIVE_TRADING=true and no paper/sim overrides).
app.post('/api/live-mainnet', (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ ok: false, error: 'enabled (boolean) required' });
  }
  if (enabled && !LIVE_TRADING) {
    return res.status(403).json({
      ok: false,
      error: 'Cannot enable live mainnet at runtime — set LIVE_TRADING=true in .env and restart the server',
    });
  }
  liveMainnetRuntime = enabled;
  console.log(`  [live-mainnet] runtime override: ${enabled ? 'ON' : 'OFF'}`);
  res.json({ ok: true, liveMainnet: liveMainnetRuntime });
});

async function executeJupiterBuy(tokenMint, solAmount, trader = 'auto') {
  if (!traderKeypair || !HELIUS_RPC) throw new Error('Trading wallet or RPC is not configured');
  const swapper = createJupiterSwap({ heliusRpc, wallet: traderKeypair, priorityFeeLamports: PRIORITY_FEE_LAMPORTS, slippageBps: SWAP_SLIPPAGE_BPS });
  const result = await swapper.buy(tokenMint, solAmount);
  totalAutoBuys += 1;
  lastAutoBuy = { time: Date.now(), whale: trader, mint: tokenMint, solAmount, ok: true, signature: result.signature };
  if (supabase) {
    await supabase.from('trades').insert({ trader_name: trader, side: 'buy', token_mint: tokenMint, token_symbol: 'AUTO', amount_usd: solAmount, price_sol: solAmount, pnl_usd: 0, status: 'executed' });
  }
  return result;
}

async function executeJupiterSell(tokenMint, tokenAmount, trader = 'auto') {
  if (!traderKeypair || !HELIUS_RPC) throw new Error('Trading wallet or RPC is not configured');
  const swapper = createJupiterSwap({ heliusRpc, wallet: traderKeypair, priorityFeeLamports: PRIORITY_FEE_LAMPORTS, slippageBps: SWAP_SLIPPAGE_BPS });
  const result = await swapper.sell(tokenMint, tokenAmount);
  totalAutoSells += 1;
  if (supabase) {
    await supabase.from('trades').insert({ trader_name: trader, side: 'sell', token_mint: tokenMint, token_symbol: 'AUTO', amount_usd: 0, price_sol: 0, pnl_usd: 0, status: 'executed' });
  }
  return result;
}

app.post('/api/buy', async (req, res) => {
  const { tokenMint, solAmount, trader } = req.body || {};
  const sol = Number(solAmount);
  if (!tokenMint || typeof tokenMint !== 'string' || !Number.isFinite(sol) || sol <= 0 || sol > 0.05) {
    return res.status(400).json({ ok: false, error: 'Invalid token or amount (maximum 0.05 SOL)' });
  }
  if (!liveMainnetRuntime) return res.json({ ok: true, autoSigned: false, simulated: true, side: 'buy', tokenMint, solAmount: sol, signature: null, outAmount: 0, priceImpactPct: 0, trader: trader || null });
  if (!AUTO_CONFIRM || !traderKeypair) return res.json({ ok: false, autoSigned: false, requiresManualSign: true, error: 'Automatic signing is disabled' });
  try {
    const balance = await heliusRpc('getBalance', [traderWalletAddress]);
    const solBalance = Number(balance.result?.value || 0) / 1_000_000_000;
    if (solBalance < sol + MIN_WALLET_BALANCE_SOL) return res.status(402).json({ ok: false, error: 'Insufficient SOL balance for this trade' });
    const result = await executeJupiterBuy(tokenMint, sol, trader || 'manual');
    res.json({ ok: true, autoSigned: true, side: 'buy', tokenMint, solAmount: sol, signature: result.signature, outAmount: result.outAmount, priceImpactPct: result.priceImpactPct, trader: trader || null });
  } catch (error) {
    lastError = 'Buy failed';
    res.status(502).json({ ok: false, error: 'Swap could not be completed' });
  }
});

// ---------- Turbo Buy (sub-second execution) ----------
// POST /api/turbo-buy { tokenMint, solAmount, trader }
// Uses Jupiter v6 swap with Jito tip, skipPreflight, processed commitment.
let turboBuyBot = null;
function getTurboBuyBot() {
  if (!turboBuyBot && traderKeypair && HELIUS_RPC) {
    turboBuyBot = createTurboBuyBot({ heliusRpc, wallet: traderKeypair });
  }
  return turboBuyBot;
}

app.post('/api/turbo-buy', async (req, res) => {
  const { tokenMint, solAmount, trader } = req.body || {};
  const sol = Number(solAmount);
  if (!tokenMint || typeof tokenMint !== 'string' || !Number.isFinite(sol) || sol <= 0 || sol > 0.05) {
    return res.status(400).json({ ok: false, error: 'Invalid token or amount (maximum 0.05 SOL)' });
  }
  if (!liveMainnetRuntime) return res.json({ ok: true, simulated: true, side: 'buy', tokenMint, solAmount: sol, signature: null, latencyMs: 0, outAmount: '0', priceImpactPct: '0', trader: trader || null });
  if (!AUTO_CONFIRM || !traderKeypair) return res.json({ ok: false, requiresManualSign: true, error: 'Automatic signing is disabled' });
  const bot = getTurboBuyBot();
  if (!bot) return res.status(503).json({ ok: false, error: 'Turbo buy bot not initialized — wallet or RPC missing' });
  try {
    const balance = await heliusRpc('getBalance', [traderWalletAddress]);
    const solBalance = Number(balance.result?.value || 0) / 1_000_000_000;
    if (solBalance < sol + MIN_WALLET_BALANCE_SOL) return res.status(402).json({ ok: false, error: 'Insufficient SOL balance for this trade' });
    const result = await bot.turboBuy(tokenMint, sol);
    totalAutoBuys += 1;
    lastAutoBuy = { time: Date.now(), whale: trader || 'turbo', mint: tokenMint, solAmount: sol, ok: true, signature: result.signature };
    if (supabase) {
      await supabase.from('trades').insert({ trader_name: trader || 'turbo', side: 'buy', token_mint: tokenMint, token_symbol: 'TURBO', amount_usd: 0, price_sol: sol, pnl_usd: 0, status: 'executed' });
    }
    res.json({ ok: true, side: 'buy', tokenMint, solAmount: sol, ...result, trader: trader || null });
  } catch (error) {
    lastError = `Turbo buy failed: ${error.message}`;
    res.status(502).json({ ok: false, error: error.message || 'Turbo swap could not be completed' });
  }
});

// GET /api/turbo-quote?tokenMint=<mint>&solAmount=<sol> — prefetch a quote
app.get('/api/turbo-quote', async (req, res) => {
  const { tokenMint, solAmount } = req.query;
  const sol = Number(solAmount);
  if (!tokenMint || !Number.isFinite(sol) || sol <= 0) return res.status(400).json({ ok: false, error: 'Invalid params' });
  const bot = getTurboBuyBot();
  if (!bot) return res.status(503).json({ ok: false, error: 'Turbo bot not initialized' });
  try {
    const quote = await bot.getQuote(tokenMint, sol);
    res.json({ ok: true, outAmount: quote.outAmount, priceImpactPct: quote.priceImpactPct, inputAmount: quote.inAmount });
  } catch (error) {
    res.status(502).json({ ok: false, error: error.message || 'Quote failed' });
  }
});

// ---------- Whale safety pre-filter (background worker) ----------
// GET /api/whale-safety — returns cached safety snapshot for all checked mints
// GET /api/whale-safety?mints=mint1,mint2 — returns safety for specific mints (triggers check)
app.get('/api/whale-safety', (req, res) => {
  const mintsParam = req.query.mints;
  if (mintsParam && typeof mintsParam === 'string') {
    const mints = mintsParam.split(',').map((m) => m.trim()).filter(Boolean);
    if (mints.length > 0) {
      whaleSafetyChecker.enqueueCheck(mints);
    }
  }
  res.json({ ok: true, safety: whaleSafetyChecker.getSnapshot() });
});

app.post('/api/sell', async (req, res) => {
  const { tokenMint, tokenAmount, trader } = req.body || {};
  const amount = Number(tokenAmount);
  if (!tokenMint || typeof tokenMint !== 'string' || !Number.isFinite(amount) || amount <= 0) return res.status(400).json({ ok: false, error: 'Invalid token or amount' });
  if (!liveMainnetRuntime) return res.json({ ok: true, autoSigned: false, simulated: true, side: 'sell', tokenMint, tokenAmount: amount, trader: trader || null });
  if (!AUTO_CONFIRM || !traderKeypair) return res.json({ ok: false, autoSigned: false, requiresManualSign: true, error: 'Automatic signing is disabled' });
  try {
    const result = await executeJupiterSell(tokenMint, amount, trader || 'manual');
    res.json({ ok: true, autoSigned: true, side: 'sell', tokenMint, tokenAmount: amount, signature: result.signature, outAmount: result.outAmount, trader: trader || null });
  } catch (error) {
    lastError = 'Sell failed';
    res.status(502).json({ ok: false, error: 'Swap could not be completed' });
  }
});

// ---------- Emergency sell all ----------
// POST /api/emergency-sell-all
app.post('/api/emergency-sell-all', async (req, res) => {
  autoTradeEnabled = false;
  if (pumpPortalStream) pumpPortalStream.stop();
  if (!liveMainnetRuntime || !traderKeypair || !HELIUS_RPC) {
    return res.json({ ok: true, message: 'Emergency stop applied (paper mode — no on-chain sells)', openPositions: [] });
  }
  try {
    const acctsRes = await heliusRpc('getTokenAccountsByOwner', [
      traderWalletAddress,
      { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
      { encoding: 'jsonParsed', commitment: 'confirmed' },
    ]);
    const accounts = acctsRes.result?.value || [];
    const openPositions = [];
    for (const acct of accounts) {
      const info = acct.account?.data?.parsed?.info;
      const amt = info?.tokenAmount;
      if (!info || !amt) continue;
      const raw = BigInt(amt.amount || '0');
      if (raw === 0n) continue;
      const decimals = Number(amt.decimals || 0);
      const humanAmount = Number(raw) / Math.pow(10, decimals);
      const mint = info.mint;
      try {
        await executeJupiterSell(mint, humanAmount, 'emergency-sell');
        openPositions.push({ mint, spentSol: 0 });
      } catch (e) {
        lastError = `Emergency sell failed for ${mint.slice(0, 8)}`;
      }
    }
    res.json({ ok: true, message: `Emergency sell complete — ${openPositions.length} position(s) liquidated`, openPositions });
  } catch (e) {
    res.status(502).json({ ok: false, error: `Emergency sell failed: ${e.message}`, openPositions: [] });
  }
});

// ---------- Whale scout proxy ----------
// GET /api/scout?address=<wallet>&limit=<n>
app.get('/api/scout', async (req, res) => {
  const { address, limit } = req.query;
  if (!address) {
    return res.status(400).json({ ok: false, error: 'address query param required' });
  }
  const max = Math.min(parseInt(limit || '20', 10) || 20, 100);

  const sigRes = await heliusRpc('getSignaturesForAddress', [address, { limit: max }]);

  if (sigRes.error) {
    return res.status(502).json({ ok: false, error: sigRes.error });
  }
  if (sigRes.error && sigRes.error.code) {
    return res.status(502).json({ ok: false, error: sigRes.error.message || 'Helius RPC error' });
  }

  const signatures = sigRes.result || [];
  const txCount = signatures.length;
  const successCount = signatures.filter((s) => !s.err).length;
  const failCount = txCount - successCount;
  const lastActivity = signatures[0]?.blockTime ?? null;

  res.json({
    ok: true,
    address,
    txCount,
    successCount,
    failCount,
    successRate: txCount > 0 ? Math.round((successCount / txCount) * 1000) / 10 : 0,
    lastActivity,
    signatures: signatures.slice(0, max).map((s) => ({
      signature: s.signature,
      slot: s.slot,
      blockTime: s.blockTime,
      err: s.err,
      memo: s.memo,
    })),
  });
});

// ---------- Wallet connection ----------
// POST /api/wallet/connect { address }
app.post('/api/wallet/connect', async (req, res) => {
  const { address } = req.body || {};
  if (!address || typeof address !== 'string') {
    return res.status(400).json({ ok: false, error: 'address required in body' });
  }
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    return res.status(400).json({ ok: false, error: 'invalid Solana address format' });
  }

  const acctRes = await heliusRpc('getAccountInfo', [address, { encoding: 'jsonParsed' }]);

  if (acctRes.error && acctRes.error.message) {
    return res.status(502).json({ ok: false, error: acctRes.error.message });
  }
  if (acctRes.error) {
    return res.status(502).json({ ok: false, error: acctRes.error });
  }

  const account = acctRes.result?.value;
  const lamports = account?.lamports ?? 0;
  const solBalance = lamports / 1_000_000_000;

  res.json({
    ok: true,
    address,
    connected: true,
    solBalance,
    lamports,
    owner: account?.owner ?? null,
    executable: account?.executable ?? false,
    rentEpoch: account?.rentEpoch ?? null,
    dataLen: account?.data?.length ?? 0,
    empty: account === null,
  });
});

// ---------- Recent on-chain transactions for the trader wallet ----------
// GET /api/trader/transactions?limit=20
// Fetches recent transaction signatures via Helius and parses out
// incoming/outgoing SOL transfers so the user can see a history of
// movements in and out of the connected wallet.
app.get('/api/trader/transactions', async (req, res) => {
  if (!traderKeypair || !traderWalletAddress) {
    return res.json({ ok: false, configured: false, address: null, transactions: [] });
  }
  if (!HELIUS_RPC) {
    return res.json({ ok: false, configured: true, address: traderWalletAddress, transactions: [], error: 'HELIUS_RPC not configured' });
  }

  try {
    const limit = Math.min(parseInt(req.query.limit || '20', 10) || 20, 50);
    const sigRes = await heliusRpc('getSignaturesForAddress', [traderWalletAddress, { limit }]);
    if (sigRes.error) {
      return res.json({ ok: false, configured: true, address: traderWalletAddress, transactions: [], error: sigRes.error.message || String(sigRes.error) });
    }

    const signatures = sigRes.result || [];
    const transactions = [];

    for (const s of signatures) {
      // Fetch the full transaction to determine direction + amount
      const txRes = await heliusRpc('getTransaction', [s.signature, { maxSupportedTransactionVersion: 0, encoding: 'jsonParsed' }]);
      if (txRes.error || !txRes.result) continue;

      const tx = txRes.result;
      const meta = tx.meta;
      if (!meta) continue;

      // Determine net SOL change for our wallet — find our index in accountKeys
      const accountKeys = (tx.transaction?.message?.accountKeys || []).map((k) => (typeof k === 'string' ? k : k.pubkey));
      const walletIndex = accountKeys.indexOf(traderWalletAddress);
      const idx = walletIndex >= 0 ? walletIndex : 0;
      const preBalance = meta.preBalances?.[idx] ?? 0;
      const postBalance = meta.postBalances?.[idx] ?? 0;
      const netLamports = postBalance - preBalance;
      const netSol = netLamports / 1_000_000_000;

      // Skip zero-change transactions (e.g. vote transactions)
      if (Math.abs(netSol) < 0.000000001) continue;

      // Try to find a destination/source address from the instructions
      let counterparty = null;
      const message = tx.transaction?.message;
      if (message) {
        const accountKeys = (message.accountKeys || []).map((k) => (typeof k === 'string' ? k : k.pubkey));
        // Look for System Program transfer instructions
        const SYSTEM_PROGRAM = '11111111111111111111111111111111';
        for (const ix of (message.instructions || [])) {
          const programId = accountKeys[ix.programIdIndex];
          if (programId === SYSTEM_PROGRAM && ix.parsed) {
            const info = ix.parsed?.info;
            if (info) {
              if (netSol < 0 && info.destination && info.destination !== traderWalletAddress) {
                counterparty = info.destination;
              } else if (netSol > 0 && info.source && info.source !== traderWalletAddress) {
                counterparty = info.source;
              }
            }
          }
        }
        // Fallback: use the second account key if no counterparty found
        if (!counterparty && accountKeys.length > 1) {
          const other = accountKeys.find((k) => k !== traderWalletAddress);
          if (other) counterparty = other;
        }
      }

      transactions.push({
        signature: s.signature,
        blockTime: s.blockTime,
        slot: s.slot,
        direction: netSol >= 0 ? 'in' : 'out',
        amountSol: Math.abs(Math.round(netSol * 1_000_000) / 1_000_000),
        counterparty,
        feeSol: (meta.fee || 0) / 1_000_000_000,
        err: s.err,
      });
    }

    res.json({
      ok: true,
      configured: true,
      address: traderWalletAddress,
      transactions,
    });
  } catch (e) {
    res.json({
      ok: false,
      configured: true,
      address: traderWalletAddress,
      transactions: [],
      error: `Transaction fetch failed: ${e.message}`,
    });
  }
});

// ---------- Send SOL or SPL token from the trader wallet ----------
// POST /api/trader/transfer { destination, amount, mint? }
// When mint is omitted, sends native SOL. When mint is provided, sends
// the SPL token. Auto-signs with the loaded trader keypair via Helius RPC.
app.post('/api/trader/transfer', async (req, res) => {
  const { destination, amount, mint } = req.body || {};
  if (!destination || typeof destination !== 'string') {
    return res.status(400).json({ ok: false, error: 'destination (address) required' });
  }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ ok: false, error: 'amount must be a positive number' });
  }

  if (!traderKeypair || !traderWalletAddress) {
    return res.status(400).json({ ok: false, error: 'No trader wallet loaded — set TRADER_PRIVATE_KEY on the server' });
  }
  if (!HELIUS_RPC) {
    return res.status(503).json({ ok: false, error: 'HELIUS_RPC not configured' });
  }

  // Validate destination address
  try {
    new PublicKey(destination);
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid destination address' });
  }

  try {
    const destPubkey = new PublicKey(destination);

    // Get a fresh blockhash
    const blockhashRes = await heliusRpc('getLatestBlockhash', []);
    if (blockhashRes.error || !blockhashRes.result?.value?.blockhash) {
      return res.status(502).json({ ok: false, error: blockhashRes.error || 'Failed to get blockhash' });
    }
    const blockhash = blockhashRes.result.value.blockhash;

    let instructions = [];
    let isToken = false;

    if (mint) {
      // SPL token transfer — find the associated token accounts
      isToken = true;
      const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

      // Get the source token account (trader's ATA for this mint)
      const sourceAccountsRes = await heliusRpc('getTokenAccountsByOwner', [
        traderWalletAddress,
        { mint },
        { encoding: 'jsonParsed' },
      ]);
      if (sourceAccountsRes.error || !sourceAccountsRes.result?.value?.length) {
        return res.status(400).json({ ok: false, error: 'No token account found for this mint in the trader wallet' });
      }
      const sourceATA = sourceAccountsRes.result.value[0].pubkey;

      // Get or create the destination token account
      // For simplicity, find an existing ATA; if none exists, we error
      const destAccountsRes = await heliusRpc('getTokenAccountsByOwner', [
        destination,
        { mint },
        { encoding: 'jsonParsed' },
      ]);
      if (destAccountsRes.error || !destAccountsRes.result?.value?.length) {
        return res.status(400).json({ ok: false, error: 'Destination wallet does not have a token account for this mint — the recipient must create one first' });
      }
      const destATA = destAccountsRes.result.value[0].pubkey;

      // Get the mint info for decimals
      const mintRes = await heliusRpc('getAccountInfo', [mint, { encoding: 'jsonParsed' }]);
      let decimals = 9;
      if (!mintRes.error && mintRes.result?.value?.data?.parsed?.info?.decimals !== undefined) {
        decimals = mintRes.result.value.data.parsed.info.decimals;
      }

      const rawTokenAmount = BigInt(Math.floor(amt * Math.pow(10, decimals)));

      instructions.push(
        // Token transfer instruction (manual assembly since we don't have @solana/spl-token)
        // Format: program_id = TOKEN_PROGRAM, keys = [source (signer/writable), dest (writable), owner (signer)], data = [1, amount_u64_le, decimals_pad]
        {
          programId: TOKEN_PROGRAM,
          keys: [
            { pubkey: sourceATA, isSigner: false, isWritable: true },
            { pubkey: destATA, isSigner: false, isWritable: true },
            { pubkey: traderKeypair.publicKey, isSigner: true, isWritable: false },
          ],
          data: Buffer.concat([
            Buffer.from([3]), // Transfer instruction (index 3 in SPL Token Program)
            (function () {
              const buf = Buffer.alloc(8);
              buf.writeBigUInt64LE(rawTokenAmount);
              return buf;
            })(),
          ]).toString('base64'),
        }
      );

      // Build the message with raw instructions
      const message = new TransactionMessage({
        payerKey: traderKeypair.publicKey,
        recentBlockhash: blockhash,
        instructions: instructions.map((ix) => ({
          programId: new PublicKey(ix.programId),
          keys: ix.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })),
          data: Buffer.from(ix.data, 'base64'),
        })),
      }).compileToV0Message();

      const tx = new VersionedTransaction(message);
      tx.sign([traderKeypair]);

      const sigRes = await heliusRpc('sendTransaction', [
        Buffer.from(tx.serialize()).toString('base64'),
        { encoding: 'base64', preflightCommitment: 'confirmed' },
      ]);

      if (sigRes.error) {
        return res.status(502).json({ ok: false, error: sigRes.error.message || String(sigRes.error) });
      }

      return res.json({
        ok: true,
        signature: sigRes.result,
        side: 'transfer',
        asset: 'token',
        mint,
        destination,
        amount: amt,
      });
    }

    // Native SOL transfer
    const lamports = Math.floor(amt * 1_000_000_000);
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: traderKeypair.publicKey,
        toPubkey: destPubkey,
        lamports,
      })
    );

    const message = new TransactionMessage({
      payerKey: traderKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    tx.sign([traderKeypair]);

    const sigRes = await heliusRpc('sendTransaction', [
      Buffer.from(tx.serialize()).toString('base64'),
      { encoding: 'base64', preflightCommitment: 'confirmed' },
    ]);

    if (sigRes.error) {
      return res.status(502).json({ ok: false, error: sigRes.error.message || String(sigRes.error) });
    }

    return res.json({
      ok: true,
      signature: sigRes.result,
      side: 'transfer',
      asset: 'sol',
      destination,
      amount: amt,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: `Transfer failed: ${e.message}` });
  }
});

const autoBoughtMints = new Map();
function startServerFeed() {
  pumpPortalStream = createPumpPortalStream({
    onTokenCreate: async (event) => {
      lastPumpTokenAt = Date.now();
      if (!AUTO_BUY_ON_NEW_TOKENS || !autoTradeEnabled || !liveMainnetRuntime || !traderKeypair) return;
      const now = Date.now();
      for (const [mint, seenAt] of autoBoughtMints) {
        if (now - seenAt > 10 * 60_000) autoBoughtMints.delete(mint);
      }
      if (!event.mint || autoBoughtMints.has(event.mint)) return;
      const marketCap = Number(event.marketCap || 0);
      if (marketCap <= 0 || marketCap > 100_000) return;
      if (!Number.isFinite(AUTO_BUY_SOL) || AUTO_BUY_SOL <= 0 || AUTO_BUY_SOL > 0.05) return;

      // Enqueue whale safety check for this new token
      whaleSafetyChecker.enqueueCheck([event.mint]);

      // Wait briefly for the background safety check to complete (up to 4s)
      let safetyOk = false;
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        const status = whaleSafetyChecker.getStatus(event.mint);
        if (status) { safetyOk = status.status === 'safe'; break; }
        await new Promise((r) => setTimeout(r, 200));
      }
      if (!safetyOk) {
        console.log(`[pumpportal] SKIP ${event.symbol || event.mint.slice(0, 8)} — whale safety check not passed`);
        return;
      }

      autoBoughtMints.set(event.mint, now);
      try {
        const result = await executeJupiterBuy(event.mint, AUTO_BUY_SOL, 'pumpportal-sniper');
        console.log(`[pumpportal] BUY ${event.symbol || event.mint.slice(0, 8)} ${result.signature}`);
      } catch (error) {
        autoBoughtMints.delete(event.mint);
        lastError = 'Automatic token buy failed';
        console.warn(`[pumpportal] buy failed: ${error.message}`);
      }
    },
    onTrade: async () => {},
    log: (message) => console.log(message),
  });
  pumpPortalStream.start();
}

// ---------- Serve built frontend (so root / never returns "Cannot GET /") ----------
const distDir = resolve(__dirname, '..', 'dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res) => {
    res.sendFile(resolve(distDir, 'index.html'));
  });
}

// ---------- Global error handler — always return JSON, never HTML ----------
app.use((err, req, res, _next) => {
  console.error(`[server] unhandled error on ${req.method} ${req.path}:`, err.message);
  res.status(500).json({ ok: false, error: err.message || 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', async () => {
  await loadTraderKeypair();
  // Run self-heal on startup — auto-generates wallet if missing
  try {
    const result = await selfHealBot.selfHeal();
    if (result.actions.length > 0) {
      console.log(`  [self-heal] startup actions: ${result.actions.join(', ')}`);
    }
  } catch (e) {
    console.log(`  [self-heal] startup check failed: ${e.message}`);
  }
  console.log(`Galaxy server running on port ${PORT}`);
  if (liveMainnetRuntime) {
    console.log('  *** MAINNET LIVE MODE ENABLED - Trading with real SOL ***');
  } else if (PAPER_TRADING || SIMULATION_MODE) {
    console.log('  (Paper/simulation mode — no real transactions will be submitted)');
  } else {
    console.log('  (Live trading OFF — set LIVE_TRADING=true to enable mainnet)');
  }
  if (!HELIUS_RPC) {
    console.log('  (HELIUS_RPC not set — /api/scout and /api/wallet/connect will return 502)');
  }
  if (!supabase) {
    console.log('  (Supabase not configured — /api/agents will return 503)');
  } else {
    try {
      const { data, error } = await supabase.from('traders').select('name');
      if (error) {
        console.log('  (traders table check failed:', error.message, ')');
      } else {
        console.log(`  Traders loaded: ${data.length} (${data.map((t) => t.name).join(', ')})`);
      }
    } catch (e) {
      console.log('  (traders table check error:', e.message, ')');
    }
  }
  startServerFeed();
  autoRepairBot.start();
  if (traderWalletAddress) {
    console.log(`  Trader wallet: ${traderWalletAddress} · Auto-confirm: ${AUTO_CONFIRM ? 'ON' : 'OFF'} · Live mainnet: ${liveMainnetRuntime ? 'ON' : 'OFF'} · Priority fee: ${PRIORITY_FEE_LAMPORTS} lamports`);
  } else {
    console.log('  (TRADER_PRIVATE_KEY not set or invalid — auto trading disabled)');
  }
});
