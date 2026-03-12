import { create } from 'zustand';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Store de sincronización entre componentes de billing.
 *
 * 3 capas de propagación:
 * 1. Zustand in-memory  → misma pestaña, instantáneo
 * 2. BroadcastChannel   → otras pestañas del mismo navegador
 * 3. Supabase Realtime   → otras PCs/redes (Postgres CDC)
 *
 * Los listeners usan `useDebouncedSync()` para colapsar ráfagas.
 */

export type BillingChannel =
  | 'vouchers'
  | 'debtors'
  | 'transactions'
  | 'balances'
  | 'dashboard';

interface BillingSyncState {
  channels: Record<BillingChannel, number>;
  /** Timestamp de la última emisión LOCAL (para filtrar auto-origen en Realtime) */
  _lastLocalEmit: number;
  emit: (channel: BillingChannel | BillingChannel[]) => void;
}

// ─── BroadcastChannel (misma PC, distinta pestaña) ─────────────────────────

const BROADCAST_KEY = 'billing-sync';
let bc: BroadcastChannel | null = null;
try {
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    bc = new BroadcastChannel(BROADCAST_KEY);
  }
} catch { /* not supported */ }

// ─── Supabase Realtime CDC (distinta PC / red) ─────────────────────────────

const SELF_ORIGIN_WINDOW_MS = 2500;

const TABLE_TO_CHANNELS: Record<string, BillingChannel[]> = {
  transactions:       ['transactions', 'debtors', 'dashboard'],
  recharge_requests:  ['vouchers', 'debtors', 'balances', 'dashboard'],
  students:           ['balances'],
};

function initRealtimeSubscription() {
  if (!supabase) return;

  const channel = supabase.channel('billing-cdc', {
    config: { broadcast: { self: false } },
  });

  for (const table of Object.keys(TABLE_TO_CHANNELS)) {
    channel.on(
      'postgres_changes' as any,
      { event: '*', schema: 'public', table },
      (payload: any) => {
        const state = useBillingSync.getState();
        const now = Date.now();

        // Skip if this tab just emitted recently (self-origin guard)
        if (now - state._lastLocalEmit < SELF_ORIGIN_WINDOW_MS) return;

        const targetChannels = TABLE_TO_CHANNELS[payload.table] || [];
        if (targetChannels.length === 0) return;

        const patch = Object.fromEntries(targetChannels.map((c) => [c, now]));
        useBillingSync.setState((prev) => ({
          channels: { ...prev.channels, ...patch },
        }));
      }
    );
  }

  channel.subscribe((status: string) => {
    if (status === 'SUBSCRIBED') {
      console.log('[BillingSync] Realtime CDC activo — transactions, recharge_requests, students');
    }
  });
}

// ─── Store ──────────────────────────────────────────────────────────────────

export const useBillingSync = create<BillingSyncState>((set) => {
  // Listen for BroadcastChannel from other tabs
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
    _lastLocalEmit: 0,
    emit: (channel) => {
      const now = Date.now();
      const list = Array.isArray(channel) ? channel : [channel];
      const patch = Object.fromEntries(list.map((c) => [c, now]));

      set((state) => ({
        channels: { ...state.channels, ...patch },
        _lastLocalEmit: now,
      }));

      // Layer 2: Broadcast to other tabs on same browser
      if (bc) {
        try { bc.postMessage(patch); } catch { /* tab closed */ }
      }
      // Layer 3 (Realtime) propagates automatically via Postgres CDC
    },
  };
});

// Boot Realtime on first import
initRealtimeSubscription();

// ─── Debounced listener hook ────────────────────────────────────────────────

/**
 * Colapsa múltiples emisiones rápidas en un solo refetch.
 * Retorna un timestamp > 0 solo cuando hay un cambio real (no en mount).
 */
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
