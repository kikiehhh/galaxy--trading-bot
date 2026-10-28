/*
# Add Scalper Retrace agent + position-limit risk rules

## Summary
Adds a 6th trading agent "Scalper Retrace" to the traders table and new
position-management columns to risk_settings so the Risk Manager (BOS) can
enforce cross-agent guards:
  - max 2 bots buying the same token within 60 seconds
  - max 2 open positions per token across all bots
  - total max 8 open positions simultaneously

## Changes to `traders` table
- Inserts a new row: `scalper_retrace` (display: "Scalper Retrace")
  Strategy: "Buys -15% dips on coins 5+ min old with >$10k volume, trending up"
  Base spend: 0.015 (50% of normal scalper's 0.03, for safety)

## Changes to `risk_settings` table (new columns, additive)
- `max_open_positions` (int, default 8) — total simultaneous positions across all bots
- `max_positions_per_token` (int, default 2) — max bots holding the same token
- `token_cooldown_seconds` (int, default 60) — no two bots may buy the same token within this window

## Security
- No new tables; existing RLS policies cover the new columns automatically.
- No new grants needed (existing CRUD grant on risk_settings + traders covers new columns/rows).
- Idempotent: uses DO $$ blocks for conditional column adds, ON CONFLICT for the seed insert.
*/

-- Add position-management columns to risk_settings
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'risk_settings' AND column_name = 'max_open_positions') THEN
    ALTER TABLE risk_settings ADD COLUMN max_open_positions int NOT NULL DEFAULT 8;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'risk_settings' AND column_name = 'max_positions_per_token') THEN
    ALTER TABLE risk_settings ADD COLUMN max_positions_per_token int NOT NULL DEFAULT 2;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'risk_settings' AND column_name = 'token_cooldown_seconds') THEN
    ALTER TABLE risk_settings ADD COLUMN token_cooldown_seconds int NOT NULL DEFAULT 60;
  END IF;
END $$;

-- Seed the new 6th trader
INSERT INTO traders (name, display_name, strategy, current_spend)
VALUES ('scalper_retrace', 'Scalper Retrace', 'Buys -15% dips on coins 5+ min old with >$10k volume, trending up on 5m', 0.015)
ON CONFLICT (name) DO NOTHING;
