# Project memory

## Product intent & audience

- Galaxy Solana Trading app — crypto trading dashboard for Solana ecosystem
- Target users: active traders wanting on-chain trading automation and monitoring
- Core features: trading agents, whale killing bot, live wallet tracking, real-time PumpPortal feed

## Brand personality & voice

- Trading/DeFi oriented — fast, data-dense, real-time responsiveness
- Space/crypto naming theme ("Galaxy")
- User communicates in Indonesian — responses should match user's language

## Visual design & UX direction

- Dark-mode trading dashboard aesthetic
- Responsive grid pattern: `grid-cols-1` on mobile, `grid-cols-3`/`grid-cols-4` on desktop (`md:` breakpoint)
- Tables use `overflow-x-auto` + small text (`text-[10px]`–`text-sm`) for mobile horizontal scroll
- Header/nav uses `flex-wrap` + `px-4` for mobile adaptation
- SPA fallback: all non-API routes serve `index.html`; API isolated to `/api/*`

## Decisions, constraints & rationale

- Framework: Vite + React
- Backend server: `server.js` (Express) on port 3000, serves built `dist/` as static + SPA fallback
- Route separation fix: `/` always returns HTML (frontend), `/api/*` returns JSON; API 404 returns JSON, non-API 404 returns `index.html`
- If `dist/` missing, server serves minimal HTML fallback (never raw JSON)
- Frontend API calls include `Accept: application/json` header for `/api/*` endpoints only
- No `JSON.stringify` raw JSON rendering in frontend components
- Production build verified — compiles and serves correctly
- Server runs in MAINNET LIVE mode with PumpPortal feed connected; 7 traders loaded
- RPC provider: Helius mainnet
- Trading wallet stored in `.env` (zero SOL balance, requires funding for live trading)

## Open questions & assumptions

- No explicit design system or styling framework confirmed beyond Tailwind utility classes
- Charting library not identified — may be needed for advanced trading visualizations
- Solana wallet connection approach for end users not yet confirmed
- Wallet private key security best practices not discussed — `.env` in `.gitignore` assumed but unverified
- `.env` file management persistence in sandbox environment appears unstable (node_modules/dist disappeared between turns)