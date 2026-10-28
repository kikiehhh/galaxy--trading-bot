// Public free PumpPortal data feed — NO API key required.
// Docs: https://docs.pumpportal.ai/ (free public trades stream)
export const PUMPPORTAL_WS_URL = 'wss://pumpportal.fun/api/data';

export interface PumpTradeEvent {
  type: 'trade';
  mint: string;
  signature: string;
  traderPublicKey: string;
  txType: 'buy' | 'sell';
  solAmount: number;
  tokenAmount: number;
  marketCap: number;
  isRaydiumPool: boolean;
  vTokensInBondingCurve: number;
  vSOLInBondingCurve: number;
  vTokensInPool: number;
  vSOLInPool: number;
  imageUri?: string;
}

export interface PumpTokenCreateEvent {
  type: 'tokenCreation';
  mint: string;
  name: string;
  symbol: string;
  imageUri?: string;
  creator: string;
  marketCap: number;
}

export type PumpEvent = PumpTradeEvent | PumpTokenCreateEvent;

export type PumpMessageHandler = (event: PumpEvent) => void;

const SUBSCRIBE_PAYLOAD = JSON.stringify({ method: 'subscribe', options: {} });

export class PumpPortalFeed {
  private ws: WebSocket | null = null;
  private handlers = new Set<PumpMessageHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldRun = false;
  private status: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';
  private statusListeners = new Set<(s: string) => void>();

  onStatus(cb: (s: string) => void) {
    this.statusListeners.add(cb);
    cb(this.status);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  private setStatus(s: typeof this.status) {
    this.status = s;
    this.statusListeners.forEach((cb) => cb(s));
  }

  on(handler: PumpMessageHandler) {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  start() {
    if (this.shouldRun) return;
    this.shouldRun = true;
    this.connect();
  }

  stop() {
    this.shouldRun = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.setStatus('disconnected');
  }

  private connect() {
    if (!this.shouldRun) return;
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(PUMPPORTAL_WS_URL);
    } catch {
      this.setStatus('error');
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.setStatus('connected');
      try {
        ws.send(SUBSCRIBE_PAYLOAD);
      } catch {
        // ignore
      }
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (!data || typeof data !== 'object' || !data.type) return;
        this.handlers.forEach((h) => h(data as PumpEvent));
      } catch {
        // ignore malformed frames
      }
    };

    ws.onerror = () => {
      this.setStatus('error');
    };

    ws.onclose = () => {
      this.ws = null;
      this.setStatus('disconnected');
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (!this.shouldRun) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), 2500);
  }
}

export const pumpFeed = new PumpPortalFeed();
