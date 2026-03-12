import { create } from 'zustand';

/**
 * Store de sincronización entre componentes de billing.
 *
 * Cada canal representa un "dominio" de datos. Cuando un componente muta datos
 * (approveVoucher, registerPayment, annulSale…), llama a `emit(canal)`.
 * Los componentes consumidores observan el timestamp del canal con `useEffect`
 * y refrescan sus datos automáticamente cuando cambia.
 *
 * Esto evita polling y no requiere Supabase Realtime habilitado en las tablas.
 */

export type BillingChannel =
  | 'vouchers'      // recharge_requests cambió
  | 'debtors'       // deudas/cobros cambiaron
  | 'transactions'  // transactions cambió (ventas, anulaciones)
  | 'balances'      // saldo de estudiante cambió
  | 'dashboard';    // métricas globales

interface BillingSyncState {
  channels: Record<BillingChannel, number>;
  emit: (channel: BillingChannel | BillingChannel[]) => void;
}

export const useBillingSync = create<BillingSyncState>((set) => ({
  channels: {
    vouchers: 0,
    debtors: 0,
    transactions: 0,
    balances: 0,
    dashboard: 0,
  },
  emit: (channel) => {
    const now = Date.now();
    const channels = Array.isArray(channel) ? channel : [channel];
    set((state) => ({
      channels: {
        ...state.channels,
        ...Object.fromEntries(channels.map((c) => [c, now])),
      },
    }));
  },
}));
