# Project memory

## Product intent & audience

- Galaxy Solana Trading app — crypto trading dashboard for Solana ecosystem
- Target users: active traders wanting on-chain trading automation and monitoring
- Core features: trading agents, whale killing bot, live wallet tracking, real-time PumpPortal feed

## Brand personality & voice

- Trading/DeFi oriented — implies fast, data-dense, real-time responsiveness
- Naming convention uses space/crypto themes ("Galaxy")

## Visual design & UX direction

- Real-time data feeds require live-updating UI components
- Dashboard layout pattern for trading/monitoring views
- Likely dark-mode preference typical of trading interfaces (inferred from product type)

## Decisions, constraints & rationale

- Framework: Vite + React
- Production build verified — compiles with no errors
- Features already existed in codebase; no new feature work done this turn
- Dependency installation completed successfully

## Open questions & assumptions

- No explicit design system or styling framework confirmed yet
- No UI library or charting library identified — likely needed for trading dashboards
- PumpPortal integration specifics and API keys assumed handled in existing code
- Solana wallet connection approach not yet confirmed