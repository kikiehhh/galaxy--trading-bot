import WebSocket from 'ws';

const PUMPPORTAL_URL = 'wss://pumpportal.fun/api/data';
const REST_FALLBACK_URL = 'https://frontend-api-v3.pump.fun/coins?offset=0&limit=10&sort=created_timestamp&order=DESC';
const REST_FALLBACK_INTERVAL_MS = 5000;

export function createPumpPortalStream({ onTokenCreate, onTrade, log }) {
  let socket = null;
  let reconnectTimer = null;
  let running = false;
  let eventCount = 0;
  let status = 'disconnected';
  let restFallbackTimer = null;
  let seenMints = new Set();
  let lastWsEventAt = 0;

  function connect() {
    if (!running) return;
    status = 'connecting';
    socket = new WebSocket(PUMPPORTAL_URL);
    socket.on('open', () => {
      status = 'connected';
      lastWsEventAt = Date.now();
      socket.send(JSON.stringify({ method: 'subscribeNewToken' }));
      log('[pumpportal] server feed connected');
    });
    socket.on('message', (raw) => {
      try {
        const event = JSON.parse(raw.toString());
        if (!event || typeof event !== 'object' || typeof event.txType !== 'string') return;
        eventCount += 1;
        lastWsEventAt = Date.now();
        if (event.txType === 'create') {
          if (event.mint) seenMints.add(event.mint);
          void onTokenCreate(event);
        } else {
          void onTrade(event);
        }
      } catch {
        log('[pumpportal] ignored malformed event');
      }
    });
    socket.on('error', (error) => {
      status = 'error';
      log(`[pumpportal] ${error.message}`);
    });
    socket.on('close', () => {
      socket = null;
      status = 'disconnected';
      if (running) reconnectTimer = setTimeout(connect, 1500);
    });
  }

  async function restFallbackPoll() {
    if (!running) return;
    // Only use REST fallback if WS has been silent for 10+ seconds
    if (Date.now() - lastWsEventAt < 10000) return;
    try {
      const res = await fetch(REST_FALLBACK_URL, {
        headers: { 'Accept': 'application/json' },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data)) return;
      for (const coin of data) {
        if (!coin.mint || seenMints.has(coin.mint)) continue;
        seenMints.add(coin.mint);
        const event = {
          txType: 'create',
          mint: coin.mint,
          symbol: coin.symbol || coin.name || '',
          name: coin.name || '',
          marketCap: Number(coin.market_cap || coin.usd_market_cap || 0),
          imageUri: coin.image_uri || '',
          creator: coin.creator || '',
          bondingCurveKey: coin.bonding_curve || '',
        };
        eventCount += 1;
        void onTokenCreate(event);
      }
    } catch {
      // silent — will retry
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      connect();
      restFallbackTimer = setInterval(() => void restFallbackPoll(), REST_FALLBACK_INTERVAL_MS);
    },
    stop() {
      running = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (restFallbackTimer) clearInterval(restFallbackTimer);
      restFallbackTimer = null;
      socket?.close();
      socket = null;
      status = 'disconnected';
    },
    snapshot() {
      return { status, eventCount };
    },
  };
}
