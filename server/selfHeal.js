import { Keypair } from '@solana/web3.js';
import bs58Pkg from 'bs58';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const bs58 = bs58Pkg.default || bs58Pkg;
const BACKUP_RPCS = [
  'https://api.mainnet-beta.solana.com',
  'https://rpc.ankr.com/solana',
  'https://solana-rpc.publicnode.com',
];
const JUPITER_URL = 'https://lite-api.jup.ag/price/v3';
const HEAL_INTERVAL_MS = 30000;
const MAX_LOG_ENTRIES = 50;

// ---------- Anti-spam constants ----------
const TELEGRAM_COOLDOWN_MS = 5 * 60 * 1000; // 5 min per alert type
const WALLET_RETRY_LOCKOUT_MS = 10 * 60 * 1000; // 10 min after failure
const STATUS_ALERT_COOLDOWN_MS = 5 * 60 * 1000;
const REPEAT_THRESHOLD = 3; // after 3 repeats, send summary + pause

export function createSelfHealBot({
  envPath,
  heliusUrl,
  getTraderKeypair,
  setTraderKeypair,
  getWalletAddress,
  setWalletAddress,
  getActiveRpc,
  setActiveRpc,
  log: parentLog,
  telegramNotifier,
}) {
  const healLog = [];
  let lastHealAt = null;
  let lastHealthCheck = null;

  // ---------- Anti-spam state ----------
  const lastSentMap = new Map(); // alertType -> timestamp
  const lastSentMessageMap = new Map(); // alertType -> message string (dedup)
  const errorCountMap = new Map(); // alertType -> count in window
  const errorWindowStartMap = new Map(); // alertType -> window start time
  const pausedAlerts = new Set(); // alertTypes paused after threshold

  // Wallet generation guard
  let isGenerating = false;
  let walletFailAt = 0; // timestamp of last failure
  let walletFailCount = 0;
  let ephemeralWalletActive = false;

  // Previous status for change detection
  let prevRpcStatus = null;
  let prevJupiterStatus = null;

  // ---------- Anti-spam helpers ----------
  function canSendTelegram(type) {
    if (pausedAlerts.has(type)) return false;
    const last = lastSentMap.get(type);
    if (last && Date.now() - last < TELEGRAM_COOLDOWN_MS) return false;
    return true;
  }

  function sendTelegramSafe(msg, type) {
    if (!telegramNotifier) return;
    if (!canSendTelegram(type)) {
      parentLog(`[self-heal] Skip spam: ${type}`);
      return;
    }
    // Deduplicate same message
    const lastMsg = lastSentMessageMap.get(type);
    if (lastMsg === msg) {
      parentLog(`[self-heal] Skip duplicate message: ${type}`);
      return;
    }
    lastSentMap.set(type, Date.now());
    lastSentMessageMap.set(type, msg);
    void telegramNotifier.send(msg);
  }

  function trackError(type) {
    const now = Date.now();
    const windowStart = errorWindowStartMap.get(type);
    if (!windowStart || now - windowStart > 10 * 60 * 1000) {
      errorWindowStartMap.set(type, now);
      errorCountMap.set(type, 1);
      pausedAlerts.delete(type);
      return 1;
    }
    const count = (errorCountMap.get(type) || 0) + 1;
    errorCountMap.set(type, count);
    if (count >= REPEAT_THRESHOLD) {
      pausedAlerts.add(type);
      // Send one summary alert then pause
      const summary = `🚫 <b>Self-Heal Bot</b> — Paused "${type}"\n\nFailed ${count}x in last 10 min — retries paused.\n⏱ ${new Date().toISOString().slice(0, 19)} UTC`;
      lastSentMap.set(type, Date.now());
      lastSentMessageMap.set(type, summary);
      void telegramNotifier?.send(summary);
      parentLog(`[self-heal] ${type} failed ${count}x — paused retries`);
    }
    return count;
  }

  function resetError(type) {
    errorCountMap.delete(type);
    errorWindowStartMap.delete(type);
    pausedAlerts.delete(type);
  }

  // Only send alert when status transitions
  function shouldAlertStatusChange(type, currentStatus) {
    if (currentStatus === 'live') {
      // Clear error tracking when recovered
      resetError(type);
      return false;
    }
    const prev = type === 'rpc' ? prevRpcStatus : prevJupiterStatus;
    // Only alert on transition from live→degraded (not on every check)
    return prev !== 'degraded' && currentStatus === 'degraded';
  }

  function addLog(message) {
    const entry = { time: new Date().toISOString(), message };
    healLog.unshift(entry);
    if (healLog.length > MAX_LOG_ENTRIES) healLog.length = MAX_LOG_ENTRIES;
    lastHealAt = Date.now();
    parentLog(`[self-heal] ${message}`);
  }

  function persistKey(keyB58) {
    try {
      let lines = [];
      if (existsSync(envPath)) {
        lines = readFileSync(envPath, 'utf8').split('\n');
      }
      const filtered = lines.filter((l) => !l.startsWith('TRADER_PRIVATE_KEY='));
      filtered.push(`TRADER_PRIVATE_KEY=${keyB58}`);
      writeFileSync(envPath, filtered.join('\n').replace(/\n+$/, '\n'));
      process.env.TRADER_PRIVATE_KEY = keyB58;
    } catch (e) {
      parentLog(`[self-heal] could not persist key: ${e.message}`);
    }
  }

  async function checkRpc(url) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth', params: [] }),
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const json = await res.json();
      return { ok: json.result === 'ok', error: json.result === 'ok' ? null : json.result };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async function checkJupiter() {
    try {
      const res = await fetch(`${JUPITER_URL}?ids=So11111111111111111111111111111111111111112`);
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const json = await res.json();
      const price = json?.['So11111111111111111111111111111111111111112']?.usdPrice;
      return { ok: Number.isFinite(price) && price > 0, error: null };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async function checkHealth() {
    const walletConfigured = Boolean(getTraderKeypair());
    const currentRpc = getActiveRpc() || heliusUrl || BACKUP_RPCS[0];
    const [rpcResult, jupiterResult] = await Promise.all([checkRpc(currentRpc), checkJupiter()]);
    const health = {
      walletConfigured,
      walletAddress: getWalletAddress(),
      rpcStatus: rpcResult.ok ? 'live' : 'degraded',
      rpcUrl: currentRpc,
      rpcError: rpcResult.error,
      jupiterStatus: jupiterResult.ok ? 'live' : 'degraded',
      jupiterError: jupiterResult.error,
      lastHeal: lastHealAt,
    };
    lastHealthCheck = Date.now();
    return health;
  }

  async function selfHeal() {
    const actions = [];
    const health = await checkHealth();

    // ----- Wallet generation (guarded) -----
    if (!health.walletConfigured) {
      // Check retry lockout
      if (isGenerating) {
        actions.push('Wallet generation already in progress — skipping');
      } else if (walletFailAt && Date.now() - walletFailAt < WALLET_RETRY_LOCKOUT_MS) {
        const remaining = Math.ceil((WALLET_RETRY_LOCKOUT_MS - (Date.now() - walletFailAt)) / 60000);
        actions.push(`Wallet generation paused — retry in ${remaining} min`);
        if (!ephemeralWalletActive) {
          // Use ephemeral in-memory wallet so app stays live
          try {
            const ephemeralKp = await Keypair.generate();
            const ephemeralPub = ephemeralKp.publicKey.toBase58();
            setTraderKeypair(ephemeralKp);
            setWalletAddress(ephemeralPub);
            ephemeralWalletActive = true;
            actions.push(`Using ephemeral wallet ${ephemeralPub.slice(0, 8)}… (not persisted)`);
            addLog(`Using ephemeral wallet ${ephemeralPub} while generation paused`);
          } catch (e) {
            addLog(`Ephemeral wallet fallback failed: ${e.message}`);
          }
        }
      } else {
        // Attempt generation
        isGenerating = true;
        try {
          const kp = await Keypair.generate();
          const secretKeyBytes = await kp.secretKey;
          const pubKey = kp.publicKey.toBase58();
          const keyB58 = bs58.encode(new Uint8Array(secretKeyBytes));
          setTraderKeypair(kp);
          setWalletAddress(pubKey);
          persistKey(keyB58);
          ephemeralWalletActive = false;
          walletFailCount = 0;
          actions.push(`Auto-generated wallet ${pubKey.slice(0, 8)}…`);
          addLog(`Auto-generated wallet ${pubKey}`);
          if (telegramNotifier) {
            sendTelegramSafe(
              `🔧 <b>Self-Heal Bot</b> — Auto-Generated Wallet\n\nNew trader wallet: <code>${pubKey}</code>\n⏱ ${new Date().toISOString().slice(0, 19)} UTC`,
              'wallet-generated',
            );
          }
        } catch (e) {
          walletFailCount += 1;
          walletFailAt = Date.now();
          actions.push(`Failed to auto-generate wallet: ${e.message}`);
          addLog(`Wallet generation failed (attempt ${walletFailCount}): ${e.message}`);
          if (telegramNotifier) {
            const count = trackError('wallet_failed');
            if (count <= REPEAT_THRESHOLD) {
              sendTelegramSafe(
                `⚠️ <b>Self-Heal Bot</b> — Wallet Generation Failed\n\n${e.message}\nRetries paused for 10 min.\n⏱ ${new Date().toISOString().slice(0, 19)} UTC`,
                'wallet_failed',
              );
            }
          }
          // Immediately try ephemeral fallback so app stays live
          if (!ephemeralWalletActive) {
            try {
              const ephemeralKp = await Keypair.generate();
              const ephemeralPub = ephemeralKp.publicKey.toBase58();
              setTraderKeypair(ephemeralKp);
              setWalletAddress(ephemeralPub);
              ephemeralWalletActive = true;
              actions.push(`Using ephemeral wallet ${ephemeralPub.slice(0, 8)}… (not persisted)`);
              addLog(`Using ephemeral wallet ${ephemeralPub} while generation paused`);
            } catch (e2) {
              addLog(`Ephemeral wallet fallback failed: ${e2.message}`);
            }
          }
        } finally {
          isGenerating = false;
        }
      }
    }

    // ----- RPC switching (status-change alerts only) -----
    if (health.rpcStatus === 'degraded') {
      const count = trackError('rpc_degraded');
      if (shouldAlertStatusChange('rpc', health.rpcStatus)) {
        const currentUrl = getActiveRpc() || heliusUrl;
        for (const backup of BACKUP_RPCS) {
          if (backup === currentUrl) continue;
          const test = await checkRpc(backup);
          if (test.ok) {
            setActiveRpc(backup);
            actions.push(`RPC switched to backup: ${backup}`);
            addLog(`RPC switched to ${backup}`);
            if (telegramNotifier) {
              sendTelegramSafe(
                `🔄 <b>Self-Heal Bot</b> — RPC Switched\n\nFrom <code>${currentUrl}</code> to <code>${backup}</code>\n⏱ ${new Date().toISOString().slice(0, 19)} UTC`,
                'rpc-switched',
              );
            }
            break;
          }
        }
      }
    } else if (health.rpcStatus === 'live' && prevRpcStatus === 'degraded') {
      // RPC recovered — send recovery notice once
      if (telegramNotifier && prevRpcStatus === 'degraded') {
        sendTelegramSafe(
          `✅ <b>Self-Heal Bot</b> — RPC Recovered\n\nRPC is back to live.\n⏱ ${new Date().toISOString().slice(0, 19)} UTC`,
          'rpc-recovered',
        );
      }
      resetError('rpc_degraded');
    }

    // ----- Jupiter degraded (status-change alerts only) -----
    if (health.jupiterStatus === 'degraded') {
      const count = trackError('jupiter_degraded');
      if (shouldAlertStatusChange('jupiter', health.jupiterStatus)) {
        actions.push('Jupiter API degraded — will retry next cycle');
        if (telegramNotifier) {
          sendTelegramSafe(
            `📉 <b>Self-Heal Bot</b> — Jupiter API Degraded\n\n${health.jupiterError || 'Jupiter price API not responding'}\n⏱ ${new Date().toISOString().slice(0, 19)} UTC`,
            'jupiter-degraded',
          );
        }
      }
    } else if (health.jupiterStatus === 'live' && prevJupiterStatus === 'degraded') {
      if (telegramNotifier) {
        sendTelegramSafe(
          `✅ <b>Self-Heal Bot</b> — Jupiter API Recovered\n\nJupiter price API is back to live.\n⏱ ${new Date().toISOString().slice(0, 19)} UTC`,
          'jupiter-recovered',
        );
      }
      resetError('jupiter_degraded');
    }

    // Update previous status for next cycle's change detection
    prevRpcStatus = health.rpcStatus;
    prevJupiterStatus = health.jupiterStatus;

    return { actions, health: await checkHealth() };
  }

  function getLog() {
    return healLog.slice(0, 20);
  }

  function getStatus() {
    return { lastHeal: lastHealAt, lastCheck: lastHealthCheck, logEntries: healLog.length };
  }

  // Start periodic self-heal
  const interval = setInterval(() => {
    void selfHeal().catch((e) => parentLog(`[self-heal] periodic check failed: ${e.message}`));
  }, HEAL_INTERVAL_MS);

  return {
    checkHealth,
    selfHeal,
    getLog,
    getStatus,
    stop: () => clearInterval(interval),
  };
}
