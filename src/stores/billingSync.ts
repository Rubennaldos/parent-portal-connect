import { create } from 'zustand';

/**
 * Store de sincronización entre componentes de billing.
 *
 * - Cada canal representa un "dominio" de datos.
 * - Cuando un componente muta datos, llama a `emit(canal)`.
 * - Otros componentes observan el timestamp y refrescan.
 * - BroadcastChannel sincroniza entre pestañas del mismo navegador.
 * - Los listeners deben usar `useDebouncedSync()` para colapsar ráfagas.
 */

export type BillingChannel =
  | 'vouchers'
  | 'debtors'
  | 'transactions'
  | 'balances'
  | 'dashboard';

interface BillingSyncState {
  channels: Record<BillingChannel, number>;
  emit: (channel: BillingChannel | BillingChannel[]) => void;
}

const BROADCAST_KEY = 'billing-sync';
let bc: BroadcastChannel | null = null;
try {
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    bc = new BroadcastChannel(BROADCAST_KEY);
  }
} catch {
  // BroadcastChannel not supported (SSR, old browsers)
}

export const useBillingSync = create<BillingSyncState>((set) => {
  // Listen for emissions from OTHER tabs
  if (bc) {
    bc.onmessage = (event) => {
      const incoming = event.data as Partial<Record<BillingChannel, number>>;
      if (incoming && typeof incoming === 'object') {
        set((state) => ({
          channels: { ...state.channels, ...incoming },
        }));
      }
    };
  }

  return {
    channels: {
      vouchers: 0,
      debtors: 0,
      transactions: 0,
      balances: 0,
      dashboard: 0,
    },
    emit: (channel) => {
      const now = Date.now();
      const list = Array.isArray(channel) ? channel : [channel];
      const patch = Object.fromEntries(list.map((c) => [c, now]));

      set((state) => ({
        channels: { ...state.channels, ...patch },
      }));

      // Broadcast to other tabs
      if (bc) {
        try { bc.postMessage(patch); } catch { /* tab closed */ }
      }
    },
  };
});

/**
 * Hook de debounce para listeners de sync.
 * Colapsa múltiples emisiones rápidas en un solo refetch.
 * Retorna un timestamp que solo cambia después del debounce.
 *
 * Uso:
 *   const debouncedTs = useDebouncedSync('debtors', 500);
 *   useEffect(() => { if (debouncedTs > 0) refetch(); }, [debouncedTs]);
 */
import { useEffect, useRef, useState } from 'react';

export function useDebouncedSync(
  channel: BillingChannel | BillingChannel[],
  delayMs = 600
): number {
  const channels = Array.isArray(channel) ? channel : [channel];
  const rawTimestamps = useBillingSync((s) =>
    channels.map((c) => s.channels[c])
  );
  const maxRaw = Math.max(...rawTimestamps);

  const [debounced, setDebounced] = useState(0);
  const initialRef = useRef(maxRaw);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Skip initial mount
    if (maxRaw === initialRef.current) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setDebounced(maxRaw);
    }, delayMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [maxRaw, delayMs]);

  return debounced;
}
