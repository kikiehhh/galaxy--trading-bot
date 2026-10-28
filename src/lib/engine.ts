import { supabase } from './supabase';
import type { RiskSettings, Trader, Trade } from './types';
import type { PumpTokenCreateEvent } from './pumpportal';

// ---------- Helpers ----------

const TOKEN_SYMBOLS = ['PEPE', 'WIF', 'BONK', 'DOG', 'CAT', 'FROG', 'MOON', 'GM', 'SLAY', 'CHAD', 'RETARD', 'COPE', 'FOMO', 'HODL', 'YOLO'];
const rand = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randFloat = (min: number, max: number) => Math.random() * (max - min) + min;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

// ---------- Engine types ----------

export interface EngineSnapshot {
  settings: RiskSettings | null;
  traders: Trader[];
  trades: Trade[];
  running: boolean;
  tick: number;
}

type Listener = (snap: EngineSnapshot) => void;

// Per-trader transient state (not persisted)
interface TraderRuntime {
  holdTicks: number;
  buyPrice: number;
  tokenMint: string;
  tokenSymbol: string;
  cooldown: number;
  aggression: number;
}

// Retrace strategy: tracks token age + dip + volume for dip-buy decisions
interface TokenTracker {
  mint: string;
  symbol: string;
  firstSeen: number;
  peakPrice: number;
  currentPrice: number;
  volumeUsd: number;
}

// ---------- Engine ----------

class TradingEngine {
  private listeners = new Set<Listener>();
  private snap: EngineSnapshot = {
    settings: null,
    traders: [],
    trades: [],
    running: false,
    tick: 0,
  };
  private interval: ReturnType<typeof setInterval> | null = null;
  private runtimes = new Map<string, TraderRuntime>();
  private latestToken: { mint: string; symbol: string } | null = null;
  private tokenTrackers = new Map<string, TokenTracker>();
  private recentBuys = new Map<string, number>();
  private openPositionsByMint = new Map<string, Set<string>>();

  subscribe(cb: Listener) {
    this.listeners.add(cb);
    cb(this.snap);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit() {
    this.snap = { ...this.snap, tick: this.snap.tick };
    this.listeners.forEach((cb) => cb({ ...this.snap, traders: [...this.snap.traders], trades: [...this.snap.trades] }));
  }

  async init() {
    await Promise.all([this.loadSettings(), this.loadTraders(), this.loadRecentTrades()]);
    this.seedRuntimes();
    this.emit();
  }

  private async loadSettings() {
    const { data } = await supabase.from('risk_settings').select('*').eq('id', 1).maybeSingle();
    this.snap.settings = data as RiskSettings | null;
  }

  private async loadTraders() {
    const { data } = await supabase.from('traders').select('*').order('name');
    this.snap.traders = (data as Trader[]) ?? [];
    this.snap.traders.forEach((t) => {
      if (!this.runtimes.has(t.name)) this.runtimes.set(t.name, this.blankRuntime(t));
    });
  }

  private async loadRecentTrades() {
    const { data } = await supabase
      .from('trades')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(40);
    this.snap.trades = (data as Trade[]) ?? [];
  }

  private blankRuntime(_t: Trader): TraderRuntime {
    return { holdTicks: 0, buyPrice: 0, tokenMint: '', tokenSymbol: '', cooldown: 0, aggression: 0.4 };
  }

  private seedRuntimes() {
    const aggr: Record<string, number> = {
      sniper: 0.7, scalper: 0.65, degen: 0.8, safe: 0.3, holder: 0.25, scalper_retrace: 0.55, whale_killer: 0.6,
    };
    this.snap.traders.forEach((t) => {
      const rt = this.runtimes.get(t.name)!;
      rt.aggression = aggr[t.name] ?? 0.4;
    });
  }

  // ---------- Control ----------

  start() {
    if (this.snap.running) return;
    this.snap.running = true;
    this.interval = setInterval(() => this.tick(), 2200);
    this.emit();
  }

  stop() {
    this.snap.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.emit();
  }

  async updateSettings(patch: Partial<RiskSettings>) {
    const { data, error } = await supabase
      .from('risk_settings')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', 1)
      .select()
      .maybeSingle();
    if (error || !data) return;
    this.snap.settings = data as RiskSettings;
    this.emit();
  }

  async setTraderSpend(name: string, spend: number) {
    const clamped = Math.max(0.01, Math.min(1, round2(spend)));
    const { data } = await supabase
      .from('traders')
      .update({ current_spend: clamped, updated_at: new Date().toISOString() })
      .eq('name', name)
      .select()
      .maybeSingle();
    if (data) {
      this.snap.traders = this.snap.traders.map((t) => (t.name === name ? (data as Trader) : t));
      this.emit();
    }
  }

  async toggleTraderActive(name: string, active: boolean) {
    const { data } = await supabase
      .from('traders')
      .update({ active, status: active ? 'idle' : 'halted', updated_at: new Date().toISOString() })
      .eq('name', name)
      .select()
      .maybeSingle();
    if (data) {
      this.snap.traders = this.snap.traders.map((t) => (t.name === name ? (data as Trader) : t));
      this.emit();
    }
  }

  async emergencySellAll() {
    await this.updateSettings({ emergency_stop: true });
    await supabase
      .from('traders')
      .update({ status: 'halted', holding_token: null, updated_at: new Date().toISOString() })
      .neq('name', '__none__');
    this.snap.traders = this.snap.traders.map((t) => ({
      ...t,
      status: 'halted',
      holding_token: null,
    }));
    this.runtimes.forEach((rt) => {
      rt.holdTicks = 0;
      rt.buyPrice = 0;
      rt.tokenMint = '';
      rt.tokenSymbol = '';
    });
    this.openPositionsByMint.clear();
    this.recentBuys.clear();
    this.stop();
    this.emit();
  }

  async clearEmergency() {
    await this.updateSettings({ emergency_stop: false });
  }

  async resetDaily() {
    await supabase
      .from('risk_settings')
      .update({
        daily_spend_used: 0,
        daily_pnl_pct: 0,
        profit_locked: false,
        emergency_stop: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1);
    await supabase
      .from('traders')
      .update({
        today_trades: 0,
        today_wins: 0,
        today_losses: 0,
        today_pnl: 0,
        updated_at: new Date().toISOString(),
      })
      .neq('name', '__none__');
    await this.loadSettings();
    await this.loadTraders();
    this.emit();
  }

  // Receive token creations from PumpPortal feed
  onTokenCreate(ev: PumpTokenCreateEvent) {
    this.latestToken = { mint: ev.mint, symbol: ev.symbol };
    if (!this.tokenTrackers.has(ev.mint)) {
      const initPrice = round4(randFloat(0.0001, 0.05));
      this.tokenTrackers.set(ev.mint, {
        mint: ev.mint,
        symbol: ev.symbol,
        firstSeen: Date.now(),
        peakPrice: initPrice,
        currentPrice: initPrice,
        volumeUsd: randFloat(500, 50000),
      });
    }
  }

  // ---------- Core loop ----------

  private async tick() {
    this.snap.tick += 1;
    const settings = this.snap.settings;
    if (!settings || settings.emergency_stop) {
      this.emit();
      return;
    }

    // Daily cap & lock checks
    const usedPct = settings.max_daily_spend > 0
      ? (settings.daily_spend_used / settings.max_daily_spend) * 100
      : 0;
    const dailyCapped = settings.daily_spend_used >= settings.max_daily_spend;
    const stopLossHit = settings.daily_pnl_pct <= -settings.daily_stop_loss_pct;
    const takeProfitHit = settings.daily_pnl_pct >= settings.daily_take_profit_pct;

    if (takeProfitHit && !settings.profit_locked) {
      // Lock profit: halve every trader's spend
      await this.updateSettings({ profit_locked: true });
      for (const t of this.snap.traders) {
        await this.setTraderSpend(t.name, t.current_spend * 0.5);
      }
      this.emit();
      return;
    }

    if (stopLossHit) {
      // Cut all trading for the day
      await this.updateSettings({ emergency_stop: true });
      await supabase
        .from('traders')
        .update({ status: 'halted', updated_at: new Date().toISOString() })
        .neq('name', '__none__');
      this.snap.traders = this.snap.traders.map((t) => ({ ...t, status: 'halted' as const }));
      this.stop();
      return;
    }

    // Process each trader
    let totalSpentThisTick = 0;
    let totalPnlThisTick = 0;

    for (const trader of this.snap.traders) {
      if (!trader.active || dailyCapped) {
        if (trader.status !== 'halted' && trader.status !== 'locked') {
          // mark locked but keep row
        }
        continue;
      }
      const rt = this.runtimes.get(trader.name)!;
      if (rt.cooldown > 0) {
        rt.cooldown -= 1;
        continue;
      }

      // Decide action
      const holdProfile = this.holdProfile(trader.name);
      if (trader.holding_token) {
        rt.holdTicks += 1;
        let shouldSell = rt.holdTicks >= holdProfile.maxHold;
        if (trader.name === 'scalper_retrace' && rt.buyPrice > 0) {
          const tracker = this.tokenTrackers.get(rt.tokenMint);
          const currentPrice = tracker?.currentPrice ?? rt.buyPrice;
          const changePct = ((currentPrice - rt.buyPrice) / rt.buyPrice) * 100;
          if (changePct >= 12) shouldSell = true;
          else if (changePct <= -8) shouldSell = true;
        }
        if (shouldSell) {
          const result = await this.executeSell(trader, rt);
          if (result) {
            totalPnlThisTick += result.pnl;
            rt.cooldown = holdProfile.cooldownAfter;
          }
        }
      } else {
        if (Math.random() < rt.aggression) {
          if (trader.name === 'scalper_retrace') {
            const retraceTarget = this.findRetraceOpportunity();
            if (!retraceTarget) {
              rt.cooldown = 1;
              continue;
            }
            const guard = this.canOpenPosition(retraceTarget.mint, settings);
            if (!guard.ok) {
              rt.cooldown = 1;
              continue;
            }
            const result = await this.executeBuy(trader, rt, retraceTarget);
            if (result) {
              this.recordOpenPosition(retraceTarget.mint, trader.name);
              totalSpentThisTick += result.spend;
              rt.cooldown = holdProfile.cooldownAfter;
            }
          } else {
            const token = this.latestToken ?? this.randomToken();
            const guard = this.canOpenPosition(token.mint, settings);
            if (!guard.ok) {
              rt.cooldown = 1;
              continue;
            }
            const result = await this.executeBuy(trader, rt, token);
            if (result) {
              this.recordOpenPosition(token.mint, trader.name);
              totalSpentThisTick += result.spend;
              rt.cooldown = holdProfile.cooldownAfter;
            }
          }
        } else {
          rt.cooldown = 1;
        }
      }
    }

    // Apply risk manager BOS adjustments (auto)
    if (settings.auto_risk && !settings.profit_locked) {
      await this.applyAutoRisk();
    }

    // Update daily totals
    if (totalSpentThisTick > 0 || totalPnlThisTick !== 0) {
      const newUsed = round2(settings.daily_spend_used + totalSpentThisTick);
      const pnlDeltaPct = settings.max_daily_spend > 0
        ? round2((totalPnlThisTick / settings.max_daily_spend) * 100)
        : 0;
      const newPnlPct = round2(settings.daily_pnl_pct + pnlDeltaPct);
      await this.updateSettings({
        daily_spend_used: newUsed,
        daily_pnl_pct: newPnlPct,
      });
    }

    await this.loadRecentTrades();
    this.emit();
  }

  private holdProfile(name: string) {
    switch (name) {
      case 'sniper':          return { maxHold: 2, cooldownAfter: 2 };
      case 'scalper':         return { maxHold: 3, cooldownAfter: 2 };
      case 'degen':           return { maxHold: 4, cooldownAfter: 3 };
      case 'safe':            return { maxHold: 6, cooldownAfter: 4 };
      case 'holder':          return { maxHold: 9, cooldownAfter: 5 };
      case 'scalper_retrace': return { maxHold: 2, cooldownAfter: 3 };
      case 'whale_killer':    return { maxHold: 3, cooldownAfter: 2 };
      default:                return { maxHold: 4, cooldownAfter: 3 };
    }
  }

  // ---------- Position guard helpers (Risk Manager BOS rules) ----------

  private canOpenPosition(mint: string, settings: RiskSettings): { ok: boolean; reason: string } {
    const totalOpen = Array.from(this.openPositionsByMint.values())
      .reduce((sum, set) => sum + set.size, 0);
    if (totalOpen >= settings.max_open_positions) {
      return { ok: false, reason: `Max open positions (${settings.max_open_positions}) reached` };
    }
    const holders = this.openPositionsByMint.get(mint);
    if (holders && holders.size >= settings.max_positions_per_token) {
      return { ok: false, reason: `Max positions per token (${settings.max_positions_per_token}) reached` };
    }
    const lastBuy = this.recentBuys.get(mint);
    if (lastBuy) {
      const elapsed = (Date.now() - lastBuy) / 1000;
      if (elapsed < settings.token_cooldown_seconds) {
        return { ok: false, reason: `Token on cooldown (${Math.ceil(settings.token_cooldown_seconds - elapsed)}s left)` };
      }
    }
    return { ok: true, reason: '' };
  }

  private recordOpenPosition(mint: string, traderName: string) {
    if (!this.openPositionsByMint.has(mint)) this.openPositionsByMint.set(mint, new Set());
    this.openPositionsByMint.get(mint)!.add(traderName);
    this.recentBuys.set(mint, Date.now());
  }

  private clearOpenPosition(mint: string, traderName: string) {
    const holders = this.openPositionsByMint.get(mint);
    if (holders) {
      holders.delete(traderName);
      if (holders.size === 0) this.openPositionsByMint.delete(mint);
    }
  }

  private findRetraceOpportunity(): { mint: string; symbol: string } | null {
    const now = Date.now();
    for (const tracker of this.tokenTrackers.values()) {
      const ageMin = (now - tracker.firstSeen) / 60000;
      if (ageMin < 5) continue;
      if (tracker.volumeUsd < 10000) continue;
      if (tracker.peakPrice <= 0) continue;
      const dipPct = ((tracker.peakPrice - tracker.currentPrice) / tracker.peakPrice) * 100;
      if (dipPct < 15) continue;
      const midPrice = (tracker.peakPrice + tracker.currentPrice) / 2;
      if (tracker.currentPrice < midPrice) continue;
      return { mint: tracker.mint, symbol: tracker.symbol };
    }
    return null;
  }

  private async executeBuy(
    trader: Trader,
    rt: TraderRuntime,
    presetToken?: { mint: string; symbol: string },
  ): Promise<{ spend: number } | null> {
    const settings = this.snap.settings!;
    const effectiveSpend = trader.name === 'scalper_retrace'
      ? round2(trader.current_spend * 0.5)
      : trader.current_spend;
    if (settings.daily_spend_used + effectiveSpend > settings.max_daily_spend) return null;

    const token = presetToken ?? this.latestToken ?? this.randomToken();
    const priceSol = round4(randFloat(0.0001, 0.05));
    const amountUsd = round2(effectiveSpend);

    const { data: tradeRow } = await supabase
      .from('trades')
      .insert({
        trader_name: trader.name,
        side: 'buy',
        token_mint: token.mint,
        token_symbol: token.symbol,
        amount_usd: amountUsd,
        price_sol: priceSol,
        pnl_usd: 0,
        status: 'executed',
      })
      .select()
      .maybeSingle();

    if (!tradeRow) return null;

    const { data: updated } = await supabase
      .from('traders')
      .update({
        status: 'buying',
        holding_token: token.mint,
        today_trades: trader.today_trades + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('name', trader.name)
      .select()
      .maybeSingle();

    if (updated) {
      this.snap.traders = this.snap.traders.map((t) => (t.name === trader.name ? (updated as Trader) : t));
    }

    rt.buyPrice = priceSol;
    rt.tokenMint = token.mint;
    rt.tokenSymbol = token.symbol;
    rt.holdTicks = 0;

    const tracker = this.tokenTrackers.get(token.mint);
    if (tracker) {
      tracker.peakPrice = Math.max(tracker.peakPrice, priceSol);
      tracker.currentPrice = priceSol;
    }

    const logName = trader.name === 'scalper_retrace' ? 'SCALPER RETRACE' : trader.name === 'whale_killer' ? 'WHALE KILLING' : trader.name.toUpperCase();
    console.log(`${logName} BUY ${token.symbol} @ ${priceSol} SOL (${amountUsd})`);

    return { spend: amountUsd };
  }

  private async executeSell(trader: Trader, rt: TraderRuntime): Promise<{ pnl: number } | null> {
    // Win/lose based on per-trader bias
    const bias: Record<string, number> = { sniper: 0.58, scalper: 0.55, degen: 0.5, safe: 0.62, holder: 0.6, scalper_retrace: 0.57, whale_killer: 0.62 };
    const winChance = bias[trader.name] ?? 0.55;
    const isWin = Math.random() < winChance;
    const amountUsd = round2(trader.current_spend);
    const pnl = isWin ? round2(amountUsd * randFloat(0.15, 0.9)) : round2(-amountUsd * randFloat(0.3, 0.9));
    const sellPrice = isWin
      ? round4(rt.buyPrice * randFloat(1.1, 1.8))
      : round4(rt.buyPrice * randFloat(0.3, 0.85));

    await supabase.from('trades').insert({
      trader_name: trader.name,
      side: 'sell',
      token_mint: rt.tokenMint,
      token_symbol: rt.tokenSymbol,
      amount_usd: amountUsd,
      price_sol: sellPrice,
      pnl_usd: pnl,
      status: 'executed',
    });

    const newWins = trader.today_wins + (isWin ? 1 : 0);
    const newLosses = trader.today_losses + (isWin ? 0 : 1);
    const newWinStreak = isWin ? trader.win_streak + 1 : 0;
    const newLoseStreak = isWin ? 0 : trader.lose_streak + 1;
    const newTodayPnl = round2(trader.today_pnl + pnl);
    const newTotalPnl = round2(trader.total_pnl + pnl);

    const { data: updated } = await supabase
      .from('traders')
      .update({
        status: 'selling',
        holding_token: null,
        today_wins: newWins,
        today_losses: newLosses,
        win_streak: newWinStreak,
        lose_streak: newLoseStreak,
        today_pnl: newTodayPnl,
        total_pnl: newTotalPnl,
        updated_at: new Date().toISOString(),
      })
      .eq('name', trader.name)
      .select()
      .maybeSingle();

    if (updated) {
      this.snap.traders = this.snap.traders.map((t) => (t.name === trader.name ? (updated as Trader) : t));
      setTimeout(() => this.setIdle(trader.name), 600);
    }

    this.clearOpenPosition(rt.tokenMint, trader.name);

    rt.holdTicks = 0;
    rt.buyPrice = 0;
    const soldSymbol = rt.tokenSymbol;
    rt.tokenMint = '';
    rt.tokenSymbol = '';

    const logName = trader.name === 'scalper_retrace' ? 'SCALPER RETRACE' : trader.name === 'whale_killer' ? 'WHALE KILLING' : trader.name.toUpperCase();
    console.log(`${logName} SELL ${soldSymbol} PnL: ${pnl >= 0 ? '+' : ''}${pnl}`);

    return { pnl };
  }

  private async setIdle(name: string) {
    const { data } = await supabase
      .from('traders')
      .update({ status: 'idle', updated_at: new Date().toISOString() })
      .eq('name', name)
      .select()
      .maybeSingle();
    if (data) {
      this.snap.traders = this.snap.traders.map((t) => (t.name === name ? (data as Trader) : t));
      this.emit();
    }
  }

  private async applyAutoRisk() {
    const settings = this.snap.settings!;
    for (const trader of this.snap.traders) {
      // Win streak 3 -> +increase%
      if (trader.win_streak >= 3) {
        const newSpend = round2(
          trader.current_spend * (1 + settings.auto_increase_pct / 100)
        );
        const clamped = Math.min(settings.max_spend, Math.max(settings.min_spend, newSpend));
        if (clamped !== trader.current_spend) {
          await this.setTraderSpend(trader.name, clamped);
          // reset streak so it doesn't keep compounding forever
          await supabase.from('traders').update({ win_streak: 0 }).eq('name', trader.name);
          this.snap.traders = this.snap.traders.map((t) =>
            t.name === trader.name ? { ...t, win_streak: 0, current_spend: clamped } : t
          );
        }
      }
      // Lose streak 2 -> -decrease%
      if (trader.lose_streak >= 2) {
        const newSpend = round2(
          trader.current_spend * (1 - settings.auto_decrease_pct / 100)
        );
        const clamped = Math.min(settings.max_spend, Math.max(settings.min_spend, newSpend));
        if (clamped !== trader.current_spend) {
          await this.setTraderSpend(trader.name, clamped);
          await supabase.from('traders').update({ lose_streak: 0 }).eq('name', trader.name);
          this.snap.traders = this.snap.traders.map((t) =>
            t.name === trader.name ? { ...t, lose_streak: 0, current_spend: clamped } : t
          );
        }
      }
    }
  }

  private randomToken() {
    const symbol = rand(TOKEN_SYMBOLS) + Math.floor(Math.random() * 99);
    const mint = Array.from({ length: 44 }, () =>
      '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'[Math.floor(Math.random() * 58)]
    ).join('');
    return { mint, symbol };
  }
}

export const engine = new TradingEngine();
