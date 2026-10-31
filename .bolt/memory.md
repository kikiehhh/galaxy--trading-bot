# Project memory

## Product intent & audience

- Galaxy Solana Trading app — crypto trading dashboard for Solana ecosystem
- Target users: active traders wanting on-chain trading automation and monitoring
- Core features: trading agents, whale killing bot, live wallet tracking, PumpPortal feed, Auto Fee Collector bot
- Up to 7 simultaneous traders with Turbo mode

## Brand personality & voice

- Trading/DeFi oriented — fast, data-dense, real-time responsiveness
- Space/crypto naming theme ("Galaxy")
- User communicates in Indonesian — responses should match user's language

## Visual design & UX direction

- Dark-mode trading dashboard aesthetic
- Responsive grid: `grid-cols-1` mobile, `grid-cols-3`/`grid-cols-4` desktop (`md:`)
- Tables: `overflow-x-auto` + small text (`text-[10px]`–`text-sm`)
- Header/nav: `flex-wrap` + `px-4` mobile
- Tab-based dashboard panels for feature modules
- Status indicators: blinking colored lights (green = active)
- Self-Heal badge: "CONNECTED" (active), "RETRYING" (RPC degraded, retrying), "CHECKING" (idle)
- Low-balance warning: orange banner above dashboard when wallet < MIN_BALANCE
- Confirm modal before Start/Stop toggle (no instant flip)
- Log displays: live timestamped entries, never raw JSON on mobile

## Decisions, constraints & rationale

- Framework: Vite + React; dev server port 5173
- Backend: `server.js` (Express) port 3000, serves `dist/` static + SPA fallback
- Route separation: `/` → HTML, `/api/*` → JSON
- RPC: Helius mainnet primary; `activeRpcUrl` dynamic switching on degradation
  - Fallback chain: api.mainnet-beta.solana.com → ankr → publicnode, 3x retry per endpoint
  - Successful URL persisted as `activeRpcUrl`
- Self-Heal: on DEGRADED, auto-retry RPC switch every cycle (not one-time); never auto-stop bot
- `heliusRpc()` uses `activeRpcUrl` as primary (was hardcoded to Helius — fixed)
- Risk Manager stop-loss: sets `emergency_stop=true` + halts traders, but does NOT call `this.stop()` — engine stays alive so UI keeps showing status
- Every `stop()` call logs `[WHY STOPPED] <reason>` to console
- 200ms delay between traders in tick loop (Turbo mode, 7 traders) to avoid Helius free-tier rate limit
- MIN_BALANCE setting (default 0.005 SOL); low-balance warning exposed via `/api/status` → `lowBalanceWarning`
- Fee collector logs persisted in localStorage
- Sandbox environment unstable: files, `node_modules`, `dist`, `.env` disappear between turns

## Open questions & assumptions

- No explicit design system beyond Tailwind utility classes
- Charting library not identified
- End-user Solana wallet connection approach not confirmed
- Wallet private key security — `.env` in `.gitignore` assumed but unverified
- `.env` persistence unreliable in sandbox; may need re-creation each turn
- MIN_BALANCE configurable via Settings UI — backend setting exists, UI control not yet confirmed
- Pump.fun claim transaction signing method assumed server-side with funded wallet

All requested fixes were applied and the build succeeded (1654 modules, 445KB JS). Server starts cleanly with 7 traders in MAINNET LIVE mode and PumpPortal connected.