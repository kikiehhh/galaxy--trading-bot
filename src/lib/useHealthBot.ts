import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchHealth, triggerSelfHeal, type HealthStatus } from '@/lib/backend';

export function useHealthBot() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [active, setActive] = useState(false);
  const [lastCheckAgo, setLastCheckAgo] = useState<number | null>(null);
  const [healActions, setHealActions] = useState<{ time: string; message: string }[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const check = useCallback(async () => {
    try {
      const h = await fetchHealth();
      setHealth(h);
      const allGood = h.walletConfigured && h.rpcStatus === 'live' && h.jupiterStatus === 'live';
      setActive(allGood);

      // Auto-heal if wallet not configured or RPC degraded
      if (!h.walletConfigured || h.rpcStatus === 'degraded') {
        const result = await triggerSelfHeal();
        if (result.actions.length > 0) {
          const newActions = result.actions.map((msg) => ({
            time: new Date().toLocaleTimeString(),
            message: msg,
          }));
          setHealActions((prev) => [...newActions, ...prev].slice(0, 5));
          showToast(result.actions[0]);
        }
        if (result.health) setHealth(result.health);
        const healedGood = result.health.walletConfigured && result.health.rpcStatus === 'live';
        setActive(healedGood);
      }

      if (h.lastCheck) {
        setLastCheckAgo(Math.floor((Date.now() - h.lastCheck) / 1000));
      }
    } catch {
      setActive(false);
    }
  }, []);

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }

  useEffect(() => {
    void check();
    const interval = setInterval(() => void check(), 10000);
    return () => clearInterval(interval);
  }, [check]);

  useEffect(() => {
    if (!health) return;
    const id = setInterval(() => {
      if (health.lastCheck) {
        setLastCheckAgo(Math.floor((Date.now() - health.lastCheck) / 1000));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [health]);

  return { health, active, lastCheckAgo, healActions, toast, dismissToast: () => setToast(null) };
}
