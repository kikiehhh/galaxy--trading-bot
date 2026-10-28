import type { ReactNode } from 'react';

export function Panel({
  children,
  className = '',
  glow = false,
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <div className={`glass-panel p-4 ${glow ? 'neon-border' : ''} ${className}`}>
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  tone = 'default',
  mono = true,
}: {
  label: string;
  value: string | number;
  tone?: 'default' | 'cyan' | 'green' | 'red' | 'purple' | 'yellow' | 'orange';
  mono?: boolean;
}) {
  const toneClass = {
    default: 'text-slate-200',
    cyan: 'neon-text-cyan',
    green: 'neon-text-green',
    red: 'neon-text-red',
    purple: 'neon-text-purple',
    yellow: 'neon-text-yellow',
    orange: 'text-orange-400',
  }[tone];
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-slate-400">{label}</span>
      <span className={`${mono ? 'font-mono' : 'font-display'} font-semibold ${toneClass}`}>
        {value}
      </span>
    </div>
  );
}

export function StatusDot({ status }: { status: string }) {
  const map: Record<string, string> = {
    connected: 'bg-neon-green animate-pulse-glow',
    connecting: 'bg-neon-yellow animate-pulse',
    disconnected: 'bg-slate-500',
    error: 'bg-neon-red animate-pulse',
    idle: 'bg-slate-500',
    buying: 'bg-neon-green animate-pulse-glow',
    selling: 'bg-neon-orange animate-pulse-glow',
    halted: 'bg-neon-red',
    locked: 'bg-neon-yellow',
  };
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${map[status] ?? 'bg-slate-500'}`}
      style={{ boxShadow: '0 0 6px currentColor' }}
    />
  );
}

export function ProgressBar({
  value,
  max,
  tone = 'cyan',
}: {
  value: number;
  max: number;
  tone?: 'cyan' | 'green' | 'red' | 'yellow';
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const colors = {
    cyan: 'from-galaxy-500 to-cyan-400',
    green: 'from-emerald-500 to-emerald-300',
    red: 'from-red-600 to-red-400',
    yellow: 'from-amber-500 to-amber-300',
  };
  return (
    <div className="h-2 w-full rounded-full bg-white/5 overflow-hidden">
      <div
        className={`h-full bg-gradient-to-r ${colors[tone]} transition-all duration-500`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? 'bg-galaxy-500' : 'bg-white/10'
      }`}
      style={checked ? { boxShadow: '0 0 12px rgba(51,88,255,0.5)' } : undefined}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
      {label && <span className="sr-only">{label}</span>}
    </button>
  );
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <div className="flex flex-col gap-1.5 w-full">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-galaxy-400 cursor-pointer"
      />
      <div className="flex justify-between text-[10px] font-mono text-slate-400">
        <span>{format ? format(min) : min}</span>
        <span className="text-cyan-300 font-semibold">
          {format ? format(value) : value}
        </span>
        <span>{format ? format(max) : max}</span>
      </div>
    </div>
  );
}

export function AgentIcon({ name }: { name: string }) {
  const emoji: Record<string, string> = {
    sniper: '🎯',
    scalper: '⚡',
    degen: '🔥',
    safe: '🛡️',
    holder: '🪙',
    scalper_retrace: '📉',
    whale_killer: '💀',
  };
  return (
    <span className="text-2xl" aria-hidden>
      {emoji[name] ?? '🤖'}
    </span>
  );
}

export function shortenAddr(addr: string, head = 6, tail = 4) {
  if (!addr) return '';
  if (addr.length <= head + tail) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}
