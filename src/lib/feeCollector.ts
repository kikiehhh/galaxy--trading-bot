// Frontend client for the Auto Fee Collector backend endpoints.

export interface FeeLogEntry {
  time: string;
  message: string;
  ts: number;
}

export interface FeeCollectorStatus {
  ok: boolean;
  enabled: boolean;
  intervalMs: number;
  todayCollectedSol: number;
  todayDate: string;
  lastCheckAt: number | null;
  lastClaimAt: number | null;
  claimableNowSol: number;
  totalClaims: number;
  log: FeeLogEntry[];
  wallet: string | null;
  winterWallet: string | null;
  minClaimSol: number;
}

export interface PumpFeeToken {
  mint: string;
  symbol: string;
  feeLamports: number;
  feeSol: number;
}

export interface DustToken {
  mint: string;
  amount: number;
  decimals: number;
  rawAmount: string;
}

export interface FeeCheckResult {
  ok: boolean;
  claimableSol: number;
  pumpTokens: PumpFeeToken[];
  dustTokens: DustToken[];
  wallet: string | null;
  error?: string;
}

export interface FeeClaimResult {
  ok: boolean;
  claimed: boolean;
  claimedSol: number;
  claimableSol: number;
  dustSwapped: number;
  signatures: { type: string; mint?: string; signature: string }[];
  error?: string;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`Backend ${res.status}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('Backend returned invalid JSON');
  }
}

export async function fetchFeeCollectorStatus(): Promise<FeeCollectorStatus> {
  return apiFetch<FeeCollectorStatus>('/api/fee-collector/status');
}

export async function checkFees(): Promise<FeeCheckResult> {
  return apiFetch<FeeCheckResult>('/api/fee-collector/check', { method: 'POST' });
}

export async function claimFees(): Promise<FeeClaimResult> {
  return apiFetch<FeeClaimResult>('/api/fee-collector/claim', { method: 'POST' });
}

export async function toggleFeeCollector(enabled: boolean, intervalMs?: number): Promise<{ ok: boolean; enabled: boolean; intervalMs: number }> {
  return apiFetch('/api/fee-collector/toggle', {
    method: 'POST',
    body: JSON.stringify({ enabled, intervalMs }),
  });
}

const LOG_KEY = 'galaxy_fee_collector_log';

export function saveLogToStorage(log: FeeLogEntry[]): void {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, 100)));
  } catch { /* ignore */ }
}

export function loadLogFromStorage(): FeeLogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
