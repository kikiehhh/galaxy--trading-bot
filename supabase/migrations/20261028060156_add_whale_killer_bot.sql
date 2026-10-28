/*
# WHALE KILLING Bot — whale-buys tracking table + 7th trading agent

## Summary
Adds a new table `whale_buys` that logs every token purchase made by tracked
whale wallets (detected via the PumpPortal live feed), and inserts a 7th
trading agent "WHALE KILLING" into the `traders` table. This bot reads the
whale-buy graph and trades the same tokens whales are accumulating, acting
as a Senior Web3 / High-Frequency sniping bot that follows whale wallets
in real-time.

## New Tables

### whale_buys
- `id` (uuid, primary key) — unique buy event
- `whale_address` (text) — the whale wallet that bought
- `whale_label` (text) — display label of the whale (e.g. "Sultan Alpha")
- `token_mint` (text) — mint address of the token bought
- `token_symbol` (text) — symbol of the token
- `token_name` (text, nullable) — full name if available
- `image_uri` (text, nullable) — token image URL
- `sol_amount` (numeric) — SOL spent by the whale
- `market_cap` (numeric) — market cap at time of buy
- `price_sol` (numeric) — approximate token price in SOL
- `is_raydium_pool` (boolean) — true if bought via Raydium (graduated)
- `v_sol_in_bc` (numeric) — vSOL in bonding curve
- `v_tokens_in_bc` (numeric) — vTokens in bonding curve
- `killer_action` (text, default 'pending') — pending | bought | skipped | sold
- `killer_spend_sol` (numeric, default 0) — SOL spent by WHALE KILLING bot
- `killer_pnl_sol` (numeric, default 0) — realized PnL when killer sells
- `chart_signal` (text, nullable) — chart-reading analysis text (e.g. "RSI oversold + volume spike")
- `created_at` (timestamptz, default now()) — when the whale bought

## Changes to `traders` table
- Inserts a new row: `whale_killer` (display: "WHALE KILLING")
  Strategy: "Senior HFT sniping bot — reads whale-buy graph + chart signals,
  follows whale accumulation in real-time with high-frequency entries"
  Base spend: 0.02 SOL

## Security
- RLS enabled on `whale_buys`.
- Grant full CRUD to `anon, authenticated` (single-tenant, no-auth app).
- 4 separate policies (SELECT/INSERT/UPDATE/DELETE) with USING(true)/WITH CHECK(true)
  because data is intentionally shared across the dashboard.
- Indexes on whale_address and created_at for fast queries.

## Idempotent
- `CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` before recreate, `ON CONFLICT DO NOTHING` for seed.
*/

-- ---------- whale_buys table ----------
CREATE TABLE IF NOT EXISTS whale_buys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  whale_address text NOT NULL,
  whale_label text NOT NULL DEFAULT '',
  token_mint text NOT NULL,
  token_symbol text NOT NULL DEFAULT '',
  token_name text,
  image_uri text,
  sol_amount numeric NOT NULL DEFAULT 0,
  market_cap numeric NOT NULL DEFAULT 0,
  price_sol numeric NOT NULL DEFAULT 0,
  is_raydium_pool boolean NOT NULL DEFAULT false,
  v_sol_in_bc numeric NOT NULL DEFAULT 0,
  v_tokens_in_bc numeric NOT NULL DEFAULT 0,
  killer_action text NOT NULL DEFAULT 'pending',
  killer_spend_sol numeric NOT NULL DEFAULT 0,
  killer_pnl_sol numeric NOT NULL DEFAULT 0,
  chart_signal text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE whale_buys ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON whale_buys TO anon, authenticated;

DROP POLICY IF EXISTS "anon_select_whale_buys" ON whale_buys;
CREATE POLICY "anon_select_whale_buys" ON whale_buys FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_whale_buys" ON whale_buys;
CREATE POLICY "anon_insert_whale_buys" ON whale_buys FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_whale_buys" ON whale_buys;
CREATE POLICY "anon_update_whale_buys" ON whale_buys FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_whale_buys" ON whale_buys;
CREATE POLICY "anon_delete_whale_buys" ON whale_buys FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS whale_buys_whale_address_idx ON whale_buys (whale_address);
CREATE INDEX IF NOT EXISTS whale_buys_created_at_idx ON whale_buys (created_at DESC);
CREATE INDEX IF NOT EXISTS whale_buys_token_mint_idx ON whale_buys (token_mint);

-- ---------- 7th trader: WHALE KILLING ----------
INSERT INTO traders (name, display_name, strategy, current_spend)
VALUES (
  'whale_killer',
  'WHALE KILLING',
  'Senior HFT sniping bot — reads whale-buy graph + chart signals, follows whale accumulation in real-time',
  0.02
)
ON CONFLICT (name) DO NOTHING;
