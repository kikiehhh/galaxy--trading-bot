import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Trade } from '@/lib/types';
import { Panel } from './ui';

const AGENT_COLORS: Record<string, string> = {
  sniper: '#22d3ee',
  scalper: '#a78bfa',
  degen: '#fb7185',
  safe: '#34d399',
  holder: '#fbbf24',
  scalper_retrace: '#f472b6',
};

const AGENT_ORDER = ['sniper', 'scalper', 'degen', 'safe', 'holder', 'scalper_retrace'];

interface Series {
  name: string;
  color: string;
  points: { t: number; pnl: number }[];
}

export function PnLChart() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [visibleAgents, setVisibleAgents] = useState<Set<string>>(new Set(AGENT_ORDER));

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data, error } = await supabase
          .from('trades')
          .select('*')
          .eq('side', 'sell')
          .order('created_at', { ascending: true })
          .limit(200);
        if (error) throw error;
        if (!cancelled) {
          setTrades((data as Trade[]) ?? []);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load PnL history');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const id = setInterval(() => void load(), 8000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const { series, xLabels, allPoints, totalPnl } = useMemo(() => {
    if (trades.length === 0) {
      return { series: [] as Series[], xLabels: [] as string[], allPoints: [] as { t: number; pnl: number }[], totalPnl: 0 };
    }

    const cumSums: Record<string, number> = {};
    const seriesMap: Record<string, { t: number; pnl: number }[]> = {};
    const timestamps: number[] = [];

    for (const tr of trades) {
      const name = tr.trader_name;
      if (!cumSums[name]) cumSums[name] = 0;
      cumSums[name] += Number(tr.pnl_usd || 0);
      const t = new Date(tr.created_at).getTime();
      timestamps.push(t);
      if (!seriesMap[name]) seriesMap[name] = [];
      seriesMap[name].push({ t, pnl: cumSums[name] });
    }

    const uniqueTs = [...new Set(timestamps)].sort((a, b) => a - b);

    const result: Series[] = AGENT_ORDER.filter((n) => seriesMap[n])
      .map((name) => ({
        name,
        color: AGENT_COLORS[name] ?? '#94a3b8',
        points: seriesMap[name],
      }));

    const labels = uniqueTs.map((t) => {
      const d = new Date(t);
      return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    });

    const flat = result.flatMap((s) => s.points);
    const total = Object.values(cumSums).reduce((a, b) => a + b, 0);

    return { series: result, xLabels: labels, allPoints: flat, totalPnl: total };
  }, [trades]);

  const toggleAgent = (name: string) => {
    setVisibleAgents((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const W = 760;
  const H = 280;
  const padL = 52;
  const padR = 16;
  const padT = 16;
  const padB = 36;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const visibleSeries = series.filter((s) => visibleAgents.has(s.name));
  const visiblePoints = visibleSeries.flatMap((s) => s.points);

  const yMin = visiblePoints.length > 0 ? Math.min(0, ...visiblePoints.map((p) => p.pnl)) : 0;
  const yMax = visiblePoints.length > 0 ? Math.max(0, ...visiblePoints.map((p) => p.pnl)) : 1;
  const yRange = yMax - yMin || 1;

  const xCount = xLabels.length;
  const xScale = (i: number) => xCount > 1 ? padL + (i / (xCount - 1)) * chartW : padL + chartW / 2;
  const yScale = (v: number) => padT + chartH - ((v - yMin) / yRange) * chartH;

  const yTicks = 4;
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) => yMin + (yRange * i) / yTicks);

  const pathFor = (s: Series) => {
    if (s.points.length === 0) return '';
    return s.points
      .map((p, i) => {
        const xIdx = xLabels.length > 0 ? Math.min(i, xLabels.length - 1) : 0;
        return `${i === 0 ? 'M' : 'L'} ${xScale(xIdx).toFixed(1)} ${yScale(p.pnl).toFixed(1)}`;
      })
      .join(' ');
  };

  const areaFor = (s: Series) => {
    if (s.points.length === 0) return '';
    const pts = s.points.map((p, i) => {
      const xIdx = Math.min(i, xLabels.length - 1);
      return `${xScale(xIdx).toFixed(1)} ${yScale(p.pnl).toFixed(1)}`;
    });
    const firstX = xScale(0).toFixed(1);
    const lastX = xScale(Math.min(s.points.length - 1, xLabels.length - 1)).toFixed(1);
    return `M ${firstX} ${yScale(0).toFixed(1)} L ${pts.join(' L ')} L ${lastX} ${yScale(0).toFixed(1)} Z`;
  };

  const zeroY = yScale(0);
  const totalUp = totalPnl >= 0;

  if (loading) {
    return (
      <Panel className="animate-slide-up">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-5 h-5 text-cyan-400 animate-pulse" />
          <h3 className="font-display font-semibold text-white">PnL Performance Chart</h3>
        </div>
        <div className="h-[280px] flex items-center justify-center text-slate-500 text-sm">
          Loading performance data…
        </div>
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel className="animate-slide-up">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-5 h-5 text-cyan-400" />
          <h3 className="font-display font-semibold text-white">PnL Performance Chart</h3>
        </div>
        <div className="h-[280px] flex items-center justify-center text-amber-400 text-sm">
          {error}
        </div>
      </Panel>
    );
  }

  if (trades.length === 0) {
    return (
      <Panel className="animate-slide-up">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-5 h-5 text-cyan-400" />
          <h3 className="font-display font-semibold text-white">PnL Performance Chart</h3>
        </div>
        <div className="h-[280px] flex flex-col items-center justify-center text-slate-500 text-sm gap-2">
          <Activity className="w-8 h-8 opacity-40" />
          No trades yet. Start the engine to see PnL history.
        </div>
      </Panel>
    );
  }

  return (
    <Panel glow className="animate-slide-up">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-galaxy-500/20 to-cyan-400/20 border border-cyan-400/20 flex items-center justify-center">
            <Activity className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h3 className="font-display font-semibold text-white">PnL Performance Chart</h3>
            <p className="text-xs text-slate-400">Cumulative profit &amp; loss per agent over time</p>
          </div>
        </div>
        <div className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-mono ${totalUp ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
          {totalUp ? <TrendingUp className="w-4 h-4 text-emerald-400" /> : <TrendingDown className="w-4 h-4 text-red-400" />}
          <span className={totalUp ? 'neon-text-green' : 'neon-text-red'}>
            {totalUp ? '+' : ''}{totalPnl.toFixed(2)} USD
          </span>
        </div>
      </div>

      {/* Legend toggles */}
      <div className="flex flex-wrap gap-2 mb-3">
        {AGENT_ORDER.map((name) => {
          const active = visibleAgents.has(name);
          const s = series.find((sr) => sr.name === name);
          const color = AGENT_COLORS[name] ?? '#94a3b8';
          const agentPnl = s && s.points.length > 0 ? s.points[s.points.length - 1].pnl : 0;
          return (
            <button
              key={name}
              onClick={() => toggleAgent(name)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                active ? 'bg-white/10 border border-white/15 text-slate-200' : 'bg-white/[0.02] border border-white/5 text-slate-500'
              }`}
              style={active ? { boxShadow: `0 0 8px ${color}30` } : undefined}
            >
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: color, opacity: active ? 1 : 0.3 }}
              />
              <span className="capitalize">{name.replace(/_/g, ' ')}</span>
              {s && s.points.length > 0 && (
                <span className={`font-mono text-[10px] ${agentPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {agentPnl >= 0 ? '+' : ''}{agentPnl.toFixed(2)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Chart */}
      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ minWidth: 480 }}
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            {visibleSeries.map((s) => (
              <linearGradient key={s.name} id={`grad-${s.name}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.25" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>

          {/* Y grid + labels */}
          {yTickVals.map((v, i) => {
            const y = yScale(v);
            return (
              <g key={i}>
                <line
                  x1={padL} y1={y} x2={W - padR} y2={y}
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth={1}
                  strokeDasharray={v === 0 ? '0' : '3 4'}
                />
                <text
                  x={padL - 8} y={y + 4}
                  textAnchor="end"
                  fill="rgba(148,163,184,0.7)"
                  fontSize={10}
                  fontFamily="monospace"
                >
                  {v >= 0 ? '+' : ''}{v.toFixed(2)}
                </text>
              </g>
            );
          })}

          {/* Zero line emphasis */}
          <line
            x1={padL} y1={zeroY} x2={W - padR} y2={zeroY}
            stroke="rgba(255,255,255,0.15)"
            strokeWidth={1.5}
          />

          {/* X axis labels (show ~6 ticks) */}
          {xLabels.map((label, i) => {
            const showEvery = Math.max(1, Math.ceil(xLabels.length / 6));
            if (i % showEvery !== 0 && i !== xLabels.length - 1) return null;
            return (
              <text
                key={i}
                x={xScale(i)} y={H - padB + 18}
                textAnchor="middle"
                fill="rgba(148,163,184,0.6)"
                fontSize={9}
                fontFamily="monospace"
              >
                {label}
              </text>
            );
          })}

          {/* Area fills (subtle) */}
          {visibleSeries.map((s) => (
            <path
              key={`area-${s.name}`}
              d={areaFor(s)}
              fill={`url(#grad-${s.name})`}
              opacity={0.6}
            />
          ))}

          {/* Lines */}
          {visibleSeries.map((s) => (
            <path
              key={`line-${s.name}`}
              d={pathFor(s)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 4px ${s.color}60)` }}
            />
          ))}

          {/* Hover crosshair + dots */}
          {hoverIdx !== null && xLabels.length > 0 && (
            <g>
              <line
                x1={xScale(hoverIdx)} y1={padT}
                x2={xScale(hoverIdx)} y2={padT + chartH}
                stroke="rgba(255,255,255,0.2)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              {visibleSeries.map((s) => {
                const pt = s.points[hoverIdx];
                if (!pt) return null;
                return (
                  <circle
                    key={`dot-${s.name}`}
                    cx={xScale(Math.min(hoverIdx, s.points.length - 1))}
                    cy={yScale(pt.pnl)}
                    r={3.5}
                    fill={s.color}
                    stroke="rgba(0,0,0,0.4)"
                    strokeWidth={1}
                    style={{ filter: `drop-shadow(0 0 6px ${s.color})` }}
                  />
                );
              })}
            </g>
          )}

          {/* Invisible hover rectangles for each x slot */}
          {xLabels.map((_, i) => {
            const slotW = chartW / Math.max(1, xLabels.length);
            return (
              <rect
                key={`hover-${i}`}
                x={padL + i * slotW - slotW / 2}
                y={padT}
                width={slotW}
                height={chartH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
              />
            );
          })}
        </svg>
      </div>

      {/* Hover tooltip row */}
      {hoverIdx !== null && xLabels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          <span className="text-slate-400 font-mono">{xLabels[hoverIdx]}</span>
          {visibleSeries.map((s) => {
            const pt = s.points[hoverIdx];
            if (!pt) return null;
            return (
              <span key={s.name} className="flex items-center gap-1 font-mono">
                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="capitalize text-slate-300">{s.name.replace(/_/g, ' ')}</span>
                <span className={pt.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {pt.pnl >= 0 ? '+' : ''}{pt.pnl.toFixed(2)}
                </span>
              </span>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
