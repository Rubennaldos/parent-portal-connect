/**
 * Hook para leer el estado global del sistema.
 *
 * Estrategia:
 * 1. Lectura inicial con maybeSingle (si la tabla no existe → DEFAULTS = todo ON)
 * 2. Suscripción Realtime para bloqueo INSTANTÁNEO (< 1 seg) cuando el SuperAdmin
 *    cambia un flag. No necesita que el padre refresque la página.
 * 3. Si el canal Realtime falla (tabla inexistente, red), cae silenciosamente a
 *    polling cada 15 segundos como respaldo.
 *
 * Regla de oro: ante cualquier error → DEFAULTS (todo ON), nunca bloquear
 * accidentalmente a nadie.
 */
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface SystemStatus {
  is_parent_portal_enabled: boolean;
  is_admin_panel_enabled: boolean;
  parent_maintenance_msg: string;
  admin_maintenance_msg: string;
  /** Emails que pueden saltarse el bloqueo del portal de padres */
  parent_bypass_emails: string[];
  /** Emails que pueden saltarse el bloqueo del panel admin */
  admin_bypass_emails: string[];
}

const DEFAULTS: SystemStatus = {
  is_parent_portal_enabled: true,
  is_admin_panel_enabled:   true,
  parent_maintenance_msg:   'Estamos realizando mejoras para ti. Volvemos pronto.',
  admin_maintenance_msg:    'Sistema en mantenimiento programado.',
  parent_bypass_emails:     [],
  admin_bypass_emails:      [],
};

const SELECT_COLS = 'is_parent_portal_enabled,is_admin_panel_enabled,parent_maintenance_msg,admin_maintenance_msg,parent_bypass_emails,admin_bypass_emails';

export function useSystemStatus() {
  const [status, setStatus]           = useState<SystemStatus>(DEFAULTS);
  const [loading, setLoading]         = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const realtimeOk = useRef(false);

  const refresh = () => setRefreshTick(t => t + 1);

  useEffect(() => {
    let mounted = true;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const applyData = (data: Partial<SystemStatus> | null) => {
      if (data && mounted) setStatus(prev => ({ ...prev, ...data }));
      if (mounted) setLoading(false);
    };

    // ── Lectura inicial ──────────────────────────────────────────────────────
    const doFetch = async () => {
      try {
        const { data, error } = await supabase
          .from('system_status')
          .select(SELECT_COLS)
          .eq('id', 1)
          .maybeSingle();
        if (!error) applyData(data);
        else if (mounted) setLoading(false);
      } catch {
        if (mounted) setLoading(false);
      }
    };

    doFetch();

    // ── Realtime: cambio instantáneo para todos los clientes ─────────────────
    const channel = supabase
      .channel('system-status-global')
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'UPDATE', schema: 'public', table: 'system_status', filter: 'id=eq.1' },
        (payload: { new: Partial<SystemStatus> }) => {
          if (mounted) {
            setStatus(prev => ({ ...prev, ...payload.new }));
          }
        },
      )
      .subscribe((subscriptionStatus: string) => {
        if (subscriptionStatus === 'SUBSCRIBED') {
          realtimeOk.current = true;
          // Realtime activo → no necesitamos polling agresivo
          if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
        }
        if (
          subscriptionStatus === 'CHANNEL_ERROR' ||
          subscriptionStatus === 'TIMED_OUT' ||
          subscriptionStatus === 'CLOSED'
        ) {
          realtimeOk.current = false;
          // Realtime no disponible → activar polling cada 10 segundos
          if (!pollTimer) {
            pollTimer = setInterval(doFetch, 10_000);
          }
        }
      });

    // Polling de respaldo inicial (se cancela si Realtime conecta)
    pollTimer = setInterval(doFetch, 10_000);

    return () => {
      mounted = false;
      if (pollTimer) clearInterval(pollTimer);
      supabase.removeChannel(channel);
    };
  // refreshTick fuerza re-mount del effect (y re-suscripción) cuando se llama refresh()
  }, [refreshTick]); // eslint-disable-line react-hooks/exhaustive-deps

  return { status, loading, refresh };
}
