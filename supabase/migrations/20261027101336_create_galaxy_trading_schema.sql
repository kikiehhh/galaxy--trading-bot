/*
# Galaxy Solana Trading - Database Schema

## Summary
Creates the persistence layer for a Solana trading dashboard with 5 trader agents,
a Risk Manager (BOS) that auto-adjusts spend based on win/lose streaks, a whale
scout with 7 prefilled wallets, and a live trade log.

## New Tables

### risk_settings (single row, id=1)
- `max_daily_spend` (numeric, default 5.00) - hard daily cap in USD; stop trading when hit
- `auto_increase_pct` (numeric, default 20) - % to raise spend on 3-win streak
- `auto_decrease_pct` (numeric, default 30) - % to lower spend on 2-lose streak
- `daily_stop_loss_pct` (numeric, default 10) - daily PnL % loss that cuts all trading
- `daily_take_profit_pct` (numeric, default 20) - daily PnL % gain that locks profit
- `min_spend` (numeric, default 0.01) - floor per-trade spend (USD)
- `max_spend` (numeric, default 1.00) - ceiling per-trade spend (USD)
- `auto_risk` (boolean, default true) - when ON the BOS adjusts spend automatically
- `emergency_stop` (boolean, default false) - master kill switch
- `daily_spend_used` (numeric, default 0) - running total spent today (USD)
- `daily_pnl_pct` (numeric, default 0) - running daily PnL percentage
- `profit_locked` (boolean, default false) - true once daily TP hits
- `updated_at` (timestamptz)

### traders (5 fixed rows, keyed by name)
- `name` (text, primary key) - Sniper | Scalper | Degen | Safe | Holder
- `display_name` (text)
- `strategy` (text) - short human description
- `current_spend` (numeric, default 0.02) - current per-trade spend (USD)
- `win_streak` (int, default 0)
- `lose_streak` (int, default 0)
- `status` (text, default 'idle') - idle | buying | selling | halted | locked
- `today_trades` (int, default 0)
- `today_wins` (int, default 0)
- `today_losses` (int, default 0)
- `today_pnl` (numeric, default 0) - USD PnL for the day
- `total_pnl` (numeric, default 0) - lifetime USD PnL
- `holding_token` (text, nullable) - mint address currently held
- `active` (boolean, default true) - whether this agent may trade
- `updated_at` (timestamptz)

### trades
- `id` (uuid, primary key)
- `trader_name` (text) - which agent
- `side` (text) - buy | sell
- `token_mint` (text) - mint address
- `token_symbol` (text) - symbol for display
- `amount_usd` (numeric) - USD value of the trade
- `price_sol` (numeric) - price in SOL
- `pnl_usd` (numeric, default 0) - realized PnL on sell
- `status` (text) - executed | failed | pending
- `created_at` (timestamptz, default now())

### whales
- `id` (uuid, primary key)
- `address` (text, unique) - Solana wallet address
- `label` (text) - display name / tag
- `winrate` (numeric, default 0) - 0-100
- `profit_sol` (numeric, default 0) - realized profit in SOL
- `source` (text) - prefilled | discovered
- `tracked` (boolean, default true)
- `created_at` (timestamptz, default now())

## Security
- Single-tenant app with NO sign-in screen. All tables use `TO anon, authenticated`
  with `USING (true)` / `WITH CHECK (true)` because the data is intentionally shared.
- RLS enabled on every table.
- Grants: full CRUD to anon + authenticated on all tables.

## Seed Data
- 1 risk_settings row with defaults.
- 5 traders (Sniper, Scalper, Degen, Safe, Holder) with distinct strategies + base spends.
- 7 prefilled "sultan" whales with placeholder addresses + plausible winrates/profits.
*/

-- risk_settings: single config row
CREATE TABLE IF NOT EXISTS risk_settings (
  id int PRIMARY KEY DEFAULT 1,
  max_daily_spend numeric NOT NULL DEFAULT 5.00,
  auto_increase_pct numeric NOT NULL DEFAULT 20,
  auto_decrease_pct numeric NOT NULL DEFAULT 30,
  daily_stop_loss_pct numeric NOT NULL DEFAULT 10,
  daily_take_profit_pct numeric NOT NULL DEFAULT 20,
  min_spend numeric NOT NULL DEFAULT 0.01,
  max_spend numeric NOT NULL DEFAULT 1.00,
  auto_risk boolean NOT NULL DEFAULT true,
  emergency_stop boolean NOT NULL DEFAULT false,
  daily_spend_used numeric NOT NULL DEFAULT 0,
  daily_pnl_pct numeric NOT NULL DEFAULT 0,
  profit_locked boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT risk_settings_singleton CHECK (id = 1)
);

ALTER TABLE risk_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON risk_settings TO anon, authenticated;

DROP POLICY IF EXISTS "anon_rw_risk_settings" ON risk_settings;
CREATE POLICY "anon_rw_risk_settings" ON risk_settings
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- traders: 5 agent rows
CREATE TABLE IF NOT EXISTS traders (
  name text PRIMARY KEY,
  display_name text NOT NULL,
  strategy text NOT NULL,
  current_spend numeric NOT NULL DEFAULT 0.02,
  win_streak int NOT NULL DEFAULT 0,
  lose_streak int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'idle',
  today_trades int NOT NULL DEFAULT 0,
  today_wins int NOT NULL DEFAULT 0,
  today_losses int NOT NULL DEFAULT 0,
  today_pnl numeric NOT NULL DEFAULT 0,
  total_pnl numeric NOT NULL DEFAULT 0,
  holding_token text,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE traders ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON traders TO anon, authenticated;

DROP POLICY IF EXISTS "anon_rw_traders" ON traders;
CREATE POLICY "anon_rw_traders" ON traders
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- trades: log
CREATE TABLE IF NOT EXISTS trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trader_name text NOT NULL,
  side text NOT NULL CHECK (side IN ('buy','sell')),
  token_mint text NOT NULL,
  token_symbol text NOT NULL,
  amount_usd numeric NOT NULL DEFAULT 0,
  price_sol numeric NOT NULL DEFAULT 0,
  pnl_usd numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'executed',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON trades TO anon, authenticated;

DROP POLICY IF EXISTS "anon_rw_trades" ON trades;
CREATE POLICY "anon_rw_trades" ON trades
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS trades_created_at_idx ON trades (created_at DESC);
CREATE INDEX IF NOT EXISTS trades_trader_idx ON trades (trader_name);

-- whales: scout list
CREATE TABLE IF NOT EXISTS whales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  address text UNIQUE NOT NULL,
  label text NOT NULL,
  winrate numeric NOT NULL DEFAULT 0,
  profit_sol numeric NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'discovered',
  tracked boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE whales ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON whales TO anon, authenticated;

DROP POLICY IF EXISTS "anon_rw_whales" ON whales;
CREATE POLICY "anon_rw_whales" ON whales
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Seed: risk settings singleton
INSERT INTO risk_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- Seed: 5 traders with distinct strategies + base spends
INSERT INTO traders (name, display_name, strategy, current_spend) VALUES
('sniper',  'Sniper',  'New-launch snipes, fast in/out on pumps',        0.02),
('scalper', 'Scalper', 'Quick 2-5 min trades on momentum candles',       0.03),
('degen',   'Degen',   'High-risk moonshots, small caps, big swings',    0.04),
('safe',    'Safe',    'Only established tokens, tight stops',            0.02),
('holder',  'Holder',  'Buys and holds for hours/days, slow compounding', 0.02)
ON CONFLICT (name) DO NOTHING;

-- Seed: 7 prefilled "sultan" whales
INSERT INTO whales (address, label, winrate, profit_sol, source) VALUES
('7Np41oeXqT7n3a1QkP4mVoVgR5dYxJ8hKcL2sF3qBz', 'Sultan Alpha',    78.4, 142.5, 'prefilled'),
('9Mq52peYrU6o4b2RlQ5nWoWhS6eXzK9jLdM3tG4rCa', 'Sultan Beta',     71.2, 98.3,  'prefilled'),
('3Kp61oeXqT7n3a1QkP4mVoVgR5dYxJ8hKcL2sF3qBd', 'Sultan Gamma',    74.8, 121.7, 'prefilled'),
('5Lq82peYrU6o4b2RlQ5nWoWhS6eXzK9jLdM3tG4rCz', 'Sultan Delta',    69.5, 76.4,  'prefilled'),
('2Hp93oeXqT7n3a1QkP4mVoVgR5dYxJ8hKcL2sF3qBe', 'Sultan Epsilon',  82.1, 188.9, 'prefilled'),
('8Jq04peYrU7o4b2RlQ5nWoWhS6eXzK9jLdM3tG4rCb', 'Sultan Zeta',    66.7, 54.2,  'prefilled'),
('4Qp15oeXqT8n3a1QkP4mVoVgR5dYxJ8hKcL2sF3qBf', 'Sultan Eta',     73.9, 105.6, 'prefilled')
ON CONFLICT (address) DO NOTHING;
