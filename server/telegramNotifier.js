import { readFileSync, writeFileSync, existsSync } from 'fs';

const TELEGRAM_API = 'https://api.telegram.org';

export function createTelegramNotifier({ envPath, log }) {
  let botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  let chatId = process.env.TELEGRAM_CHAT_ID || '';

  function persistEnv(key, value) {
    try {
      let lines = [];
      if (existsSync(envPath)) {
        lines = readFileSync(envPath, 'utf8').split('\n');
      }
      const filtered = lines.filter((l) => !l.startsWith(`${key}=`));
      filtered.push(`${key}=${value}`);
      writeFileSync(envPath, filtered.join('\n').replace(/\n+$/, '\n'));
      process.env[key] = value;
    } catch (e) {
      log(`[telegram] could not persist ${key}: ${e.message}`);
    }
  }

  async function send(message) {
    if (!botToken || !chatId) return { sent: false, reason: 'not-configured' };
    try {
      const res = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        log(`[telegram] send failed: HTTP ${res.status} ${text}`);
        return { sent: false, reason: `HTTP ${res.status}` };
      }
      return { sent: true };
    } catch (e) {
      log(`[telegram] send error: ${e.message}`);
      return { sent: false, reason: e.message };
    }
  }

  async function notifyHealAction(action, details) {
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const messages = {
      'wallet-generated': `🔧 <b>Self-Heal Bot</b> — Auto-Generated Wallet\n\n${details}\n⏱ ${timestamp} UTC`,
      'rpc-switched': `🔄 <b>Self-Heal Bot</b> — RPC Switched\n\n${details}\n⏱ ${timestamp} UTC`,
      'wallet-failed': `⚠️ <b>Self-Heal Bot</b> — Wallet Generation Failed\n\n${details}\n⏱ ${timestamp} UTC`,
      'jupiter-degraded': `📉 <b>Self-Heal Bot</b> — Jupiter API Degraded\n\n${details}\n⏱ ${timestamp} UTC`,
    };
    const msg = messages[action] || `🔧 <b>Self-Heal Bot</b>\n\n${details}\n⏱ ${timestamp} UTC`;
    return send(msg);
  }

  async function sendTest() {
    return send(`✅ <b>Galaxy Trading</b> — Telegram alerts connected.\n\nSelf-Heal Bot notifications are now active.`);
  }

  function getConfig() {
    return {
      configured: Boolean(botToken && chatId),
      hasBotToken: Boolean(botToken),
      hasChatId: Boolean(chatId),
      chatIdPreview: chatId ? `${chatId.slice(0, 4)}…${chatId.slice(-3)}` : null,
    };
  }

  function setConfig(token, chat) {
    if (token !== undefined) {
      botToken = token.trim();
      persistEnv('TELEGRAM_BOT_TOKEN', botToken);
    }
    if (chat !== undefined) {
      chatId = chat.trim();
      persistEnv('TELEGRAM_CHAT_ID', chatId);
    }
  }

  return { send, notifyHealAction, sendTest, getConfig, setConfig };
}
