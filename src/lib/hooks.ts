import { useEffect, useState, useCallback } from 'react';
import { engine } from './engine';
import { pumpFeed } from './pumpportal';
import { whaleScout } from './whaleScout';
import { tokenScout } from './tokenScout';
import { whaleKiller } from './whaleKiller';
import { supabase } from './supabase';
import type { EngineSnapshot } from './engine';
import type { Whale } from './types';
import type { TokenStat } from './tokenScout';
import type { WhaleKillerSnapshot } from './whaleKiller';

export function useEngine() {
  const [snap, setSnap] = useState<EngineSnapshot>({
    settings: null,
    traders: [],
    trades: [],
    running: false,
    tick: 0,
  });

  useEffect(() => {
    const unsub = engine.subscribe(setSnap);
    void engine.init();
    return unsub;
  }, []);

  return snap;
}

export function usePumpFeed(running: boolean) {
  const [status, setStatus] = useState('disconnected');
  const [latestToken, setLatestToken] = useState<string>('');
  const [eventCount, setEventCount] = useState(0);
  const [newWhale, setNewWhale] = useState<Whale | null>(null);

  useEffect(() => {
    const unsubStatus = pumpFeed.onStatus(setStatus);
    return unsubStatus;
  }, []);

  // Auto-start the PumpPortal feed on mount so the status shows "connected"
  // immediately, regardless of whether the trading engine is running.
  useEffect(() => {
    pumpFeed.start();
    return () => pumpFeed.stop();
  }, []);

  useEffect(() => {
    const unsub = pumpFeed.on((ev) => {
      setEventCount((c) => c + 1);
      if (ev.type === 'tokenCreation') {
        engine.onTokenCreate(ev);
        tokenScout.ingestCreate(ev);
        setLatestToken(`${ev.symbol} (${ev.mint.slice(0, 6)}…)`);
      } else if (ev.type === 'trade') {
        void whaleScout.ingest(ev);
        tokenScout.ingestTrade(ev);
        void whaleKiller.ingestTrade(ev);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    whaleScout.onDiscover((w) => setNewWhale(w));
    void whaleScout.syncDiscovered();
    return () => whaleScout.offDiscover();
  }, []);

  // Keep the WHALE KILLING bot synced with tracked whales
  useEffect(() => {
    void whaleKiller.syncTrackedWhales();
    const channel = supabaseChannel();
    return channel;
  }, []);

  const dismissWhale = useCallback(() => setNewWhale(null), []);

  return { status, latestToken, eventCount, newWhale, dismissWhale };
}

/**
 * Live token scout — returns a snapshot of all tracked pump.fun tokens,
 * refreshed every 1 second. Provides top gainers, top losers, and newest
 * tokens with market cap, holders, snipers, viewers, volume, and more.
 */
export function useTokenScout() {
  const [tokens, setTokens] = useState<TokenStat[]>(tokenScout.getSnapshot());

  useEffect(() => {
    const interval = setInterval(() => {
      const snap = tokenScout.snapshot();
      setTokens(snap);
      // Feed token stats to the whale killer for chart-reading
      snap.forEach((t) => whaleKiller.updateTokenStat(t));
    }, 1000);
    setTokens(tokenScout.snapshot());
    return () => clearInterval(interval);
  }, []);

  return tokens;
}

/** Subscribe to Supabase whale table changes so whaleKiller re-syncs. */
function supabaseChannel(): () => void {
  const ch = supabase
    .channel('whale-killer-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'whales' }, () => {
      void whaleKiller.syncTrackedWhales();
    })
    .subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

/** WHALE KILLING bot snapshot — refreshes every 2 seconds. */
export function useWhaleKiller() {
  const [snap, setSnap] = useState<WhaleKillerSnapshot>({
    whaleBuys: [],
    trackedWhaleCount: 0,
    totalWhaleBuys: 0,
    killerBuys: 0,
    killerWins: 0,
    killerLosses: 0,
    killerPnlSol: 0,
    signals: {},
  });

  useEffect(() => {
    void whaleKiller.getSnapshot().then(setSnap);
    const interval = setInterval(() => {
      void whaleKiller.getSnapshot().then(setSnap);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return snap;
}
