import { supabase } from './supabase';
import type { Whale } from './types';
import type { PumpTradeEvent } from './pumpportal';

// Tracks traders seen on the PumpPortal feed and computes a rolling winrate/profit
// estimate. Any wallet crossing winrate>60% AND profit>5 SOL becomes a discovered
// whale (up to the 15-whale cap). NO API keys used — pure public feed analysis.

const MAX_WHALES = 15;

interface TraderStat {
  address: string;
  buys: number;
  sells: number;
  wins: number;
  losses: number;
  profitSol: number;
  lastSeen: number;
}

class WhaleScout {
  private stats = new Map<string, TraderStat>();
  private discovered = new Set<string>(); // addresses already saved as discovered
  private onDiscoverCb: ((w: Whale) => void) | null = null;

  onDiscover(cb: (w: Whale) => void) {
    this.onDiscoverCb = cb;
  }

  offDiscover() {
    this.onDiscoverCb = null;
  }

  /** Ingest a single trade event from the PumpPortal feed. */
  async ingest(ev: PumpTradeEvent) {
    const addr = ev.traderPublicKey;
    if (!addr) return;
    const stat = this.stats.get(addr) ?? {
      address: addr,
      buys: 0,
      sells: 0,
      wins: 0,
      losses: 0,
      profitSol: 0,
      lastSeen: Date.now(),
    };

    if (ev.txType === 'buy') {
      stat.buys += 1;
      stat.profitSol -= ev.solAmount;
    } else {
      stat.sells += 1;
      stat.profitSol += ev.solAmount;
      // approximate win/loss: a sell with positive cumulative profit = win
      if (stat.profitSol > 0) stat.wins += 1;
      else stat.losses += 1;
    }
    stat.lastSeen = Date.now();
    this.stats.set(addr, stat);

    await this.maybePromote(stat);
  }

  private async maybePromote(stat: TraderStat) {
    if (this.discovered.has(stat.address)) return;
    if (this.discovered.size >= MAX_WHALES) return;
    const totalClosed = stat.wins + stat.losses;
    if (totalClosed < 2) return;
    const winrate = (stat.wins / totalClosed) * 100;
    if (winrate < 60) return;
    if (stat.profitSol < 5) return;

    // check existing rows (prefilled or discovered) to avoid dup
    const { data: existing } = await supabase
      .from('whales')
      .select('id, address')
      .eq('address', stat.address)
      .maybeSingle();
    if (existing) {
      this.discovered.add(stat.address);
      return;
    }

    // enforce cap by counting current rows
    const { count } = await supabase
      .from('whales')
      .select('id', { count: 'exact', head: true });
    if ((count ?? 0) >= MAX_WHALES) return;

    const label = `Discovered #${this.discovered.size + 1}`;
    const { data: row } = await supabase
      .from('whales')
      .insert({
        address: stat.address,
        label,
        winrate: Math.round(winrate * 10) / 10,
        profit_sol: Math.round(stat.profitSol * 100) / 100,
        source: 'discovered',
        tracked: true,
      })
      .select()
      .maybeSingle();

    if (row) {
      this.discovered.add(stat.address);
      this.onDiscoverCb?.(row as Whale);
    }
  }

  /** Seed the discovered-set from existing DB rows on startup. */
  async syncDiscovered() {
    const { data } = await supabase
      .from('whales')
      .select('address, source')
      .eq('source', 'discovered');
    (data as Whale[] | null)?.forEach((w) => this.discovered.add(w.address));
  }

  statsSnapshot(): TraderStat[] {
    return Array.from(this.stats.values()).sort((a, b) => b.profitSol - a.profitSol).slice(0, 12);
  }
}

export const whaleScout = new WhaleScout();
