# Project memory

## Product intent & audience

- Galaxy Solana Trading app — crypto trading dashboard for Solana ecosystem
- Target users: active traders wanting on-chain trading automation and monitoring
- Core features: trading agents, whale killing bot, live wallet tracking, PumpPortal feed, Auto Fee Collector bot

## Brand personality & voice

- Trading/DeFi oriented — fast, data-dense, real-time responsiveness
- Space/crypto naming theme ("Galaxy")
- User communicates in Indonesian — responses should match user's language

## Visual design & UX direction

- Dark-mode trading dashboard aesthetic
- Responsive grid pattern: `grid-cols-1` on mobile, `grid-cols-3`/`grid-cols-4` on desktop (`md:` breakpoint)
- Tables use `overflow-x-auto` + small text (`text-[10px]`–`text-sm`) for mobile horizontal scroll
- Header/nav uses `flex-wrap` + `px-4` for mobile adaptation
- Tab-based dashboard panels for feature modules (Sniper Bot, Auto Colek, etc.)
- Status indicators use blinking colored lights (green = active)
- Log displays: live timestamped entries, never raw JSON on mobile
- SPA fallback: all non-API routes serve `index.html`; API isolated to `/api/*`

## Decisions, constraints & rationale

- Framework: Vite + React
- Backend: `server.js` (Express) port 3000, serves built `dist/` as static + SPA fallback
- Route separation: `/` always returns HTML, `/api/*` returns JSON; API 404 returns JSON, non-API 404 returns `index.html`
- If `dist/` missing, server serves minimal HTML fallback (never raw JSON)
- Frontend API calls include `Accept: application/json` header for `/api/*` endpoints only
- RPC: Helius mainnet; fallback retry 3x to `api.mainnet-beta.solana.com`
- Trading wallet + WINTER_WALLET (optional fee destination) stored in `.env`
- Auto Fee Collector: checks Pump.fun creator fees + dust tokens, claims when > 0.0005 SOL, swaps to SOL via Jupiter v6
- Fee collector intervals configurable: 1m, 5m, 15m, 1h
- Sniper Bot START triggers Auto Colek START; Sniper STOP does NOT stop Auto Colek (independent)
- Fee collector logs persisted in localStorage to survive page refresh
- Sandbox environment unstable: files, `node_modules`, `dist`, and `.env` disappear between turns — may need full rebuild

## Open questions & assumptions

- No explicit design system beyond Tailwind utility classes
- Charting library not identified — may be needed for advanced visualizations
- Solana wallet connection approach for end users not yet confirmed
- Wallet private key security — `.env` in `.gitignore` assumed but unverified
- `.env` persistence unreliable in sandbox; may need re-creation each turn
- Pump.fun claim transaction signing method not detailed (assumed server-side with funded wallet)