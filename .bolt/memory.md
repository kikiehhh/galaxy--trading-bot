# Project memory

## Product intent & audience

- Galaxy Solana Trading app — crypto trading dashboard for Solana ecosystem
- Target users: active traders wanting on-chain trading automation and monitoring
- Core features: trading agents, whale killing bot, live wallet tracking, real-time PumpPortal feed

## Brand personality & voice

- Trading/DeFi oriented — implies fast, data-dense, real-time responsiveness
- Naming convention uses space/crypto themes ("Galaxy")
- User communicates in Indonesian — responses should match user's language

## Visual design & UX direction

- Real-time data feeds require live-updating UI components
- Dashboard layout pattern for trading/monitoring views
- Likely dark-mode preference typical of trading interfaces (inferred from product type)

## Decisions, constraints & rationale

- Framework: Vite + React
- Production build verified — compiles with no errors after env updates
- RPC provider: Helius (`https://mainnet.helius-rpc.com/?api-key=3dabe168-494d-4b60-8660-b3c51a43916a`)
- Trading wallet generated and stored in `.env` — address: `9V96ySiVjxEgrTEAZrvqovCKK7VamyK95LjmZPg8eiRV`
- Wallet has zero SOL balance — requires funding (min 0.005 SOL) before live trading
- `.env` file used for RPC URL and wallet private key configuration

## Open questions & assumptions

- No explicit design system or styling framework confirmed yet
- No UI library or charting library identified — likely needed for trading dashboards
- PumpPortal integration specifics and API keys assumed handled in existing code
- Solana wallet connection approach for end users not yet confirmed
- Wallet private key security best practices not discussed — `.env` in `.gitignore` assumed but unverified