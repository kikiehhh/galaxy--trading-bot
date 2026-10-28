import type { Trade } from '@/lib/types';

export function TradeTicker({ trades }: { trades: Trade[] }) {
  // Duplicate the list so the CSS ticker loops seamlessly
  const loop = [...trades, ...trades];
  return (
    <div className="relative overflow-hidden rounded-xl border border-white/10 bg-space-900/60 py-2">
      <div className="flex gap-6 whitespace-nowrap animate-ticker">
        {loop.map((t, i) => (
          <TradeChip key={`${t.id}-${i}`} trade={t} />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-space-900 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-space-900 to-transparent" />
    </div>
  );
}

function TradeChip({ trade }: { trade: Trade }) {
  const isBuy = trade.side === 'buy';
  const pnlTone = trade.pnl_usd > 0 ? 'neon-text-green' : trade.pnl_usd < 0 ? 'neon-text-red' : 'text-slate-300';
  const sideTone = isBuy ? 'neon-text-green' : 'neon-text-orange';
  return (
    <span className="inline-flex items-center gap-2 text-xs font-mono">
      <span className="uppercase font-semibold">{trade.trader_name}</span>
      <span className={sideTone}>{isBuy ? 'BUY' : 'SELL'}</span>
      <span className="text-slate-300">{trade.token_symbol}</span>
      <span className="text-slate-400">${trade.amount_usd.toFixed(3)}</span>
      {trade.side === 'sell' && (
        <span className={pnlTone}>
          {trade.pnl_usd >= 0 ? '+' : ''}{trade.pnl_usd.toFixed(2)}
        </span>
      )}
    </span>
  );
}
