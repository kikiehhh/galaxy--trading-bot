/*
# Add live wallet tracking tables

1. New Tables
- `wallet_baseline`: the portfolio value (USD) recorded the first time the server sees a trader wallet. All-time PNL is measured against this value.
  - `wallet_address` (text, primary key)
  - `baseline_usd` (numeric, not null)
  - `set_at` (timestamptz, default now())
- `wallet_positions`: the USD price at which each token was first seen in the trader wallet. Per-token PNL is measured against this entry price.
  - `wallet_address` (text, not null)
  - `mint` (text, not null)
  - `entry_price_usd` (numeric, not null)
  - `first_seen_at` (timestamptz, default now())
  - primary key (`wallet_address`, `mint`)

2. Security
- Row level security is enabled on both tables.
- anon and authenticated roles get SELECT, INSERT, UPDATE on both tables, matching the existing trading tables (the app has no sign-in screen).
- No DELETE is granted, so recorded baselines and entry prices cannot be removed through the API.

3. Notes
- Both tables are safe to re-apply: statements use IF NOT EXISTS and policies are dropped before they are created.
*/

CREATE TABLE IF NOT EXISTS wallet_baseline (
  wallet_address text PRIMARY KEY,
  baseline_usd numeric NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallet_positions (
  wallet_address text NOT NULL,
  mint text NOT NULL,
  entry_price_usd numeric NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet_address, mint)
);

ALTER TABLE wallet_baseline ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_positions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON wallet_baseline TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON wallet_positions TO anon, authenticated;

DROP POLICY IF EXISTS "anon_rw_wallet_baseline" ON wallet_baseline;
CREATE POLICY "anon_rw_wallet_baseline" ON wallet_baseline
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_rw_wallet_positions" ON wallet_positions;
CREATE POLICY "anon_rw_wallet_positions" ON wallet_positions
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
