export interface RiskSettings {
  id: number;
  max_daily_spend: number;
  auto_increase_pct: number;
  auto_decrease_pct: number;
  daily_stop_loss_pct: number;
  daily_take_profit_pct: number;
  min_spend: number;
  max_spend: number;
  auto_risk: boolean;
  emergency_stop: boolean;
  daily_spend_used: number;
  daily_pnl_pct: number;
  profit_locked: boolean;
  max_open_positions: number;
  max_positions_per_token: number;
  token_cooldown_seconds: number;
  updated_at: string;
}

export type TraderStatus = 'idle' | 'buying' | 'selling' | 'halted' | 'locked';

export interface Trader {
  name: string;
  display_name: string;
  strategy: string;
  current_spend: number;
  win_streak: number;
  lose_streak: number;
  status: TraderStatus;
  today_trades: number;
  today_wins: number;
  today_losses: number;
  today_pnl: number;
  total_pnl: number;
  holding_token: string | null;
  active: boolean;
  updated_at: string;
}

export interface Trade {
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

export interface Whale {
  id: string;
  address: string;
  label: string;
  winrate: number;
  profit_sol: number;
  source: 'prefilled' | 'discovered';
  tracked: boolean;
  created_at: string;
}

export type TabKey = 'agents' | 'traders' | 'risk' | 'whales' | 'whale_killer' | 'wallet' | 'tokens' | 'settings';
