import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';

interface MaintenanceState {
  blocked: boolean;
  title: string;
  message: string;
  loading: boolean;
}

/**
 * Hook que verifica si un módulo está en mantenimiento.
 * admin_general y superadmin NUNCA son bloqueados.
 * Escucha Realtime y hace poll cada 30s.
 */
export function useMaintenanceGuard(moduleKey: string, schoolId?: string | null): MaintenanceState {
  const { user } = useAuth();
  const { role } = useRole();
  const [state, setState] = useState<MaintenanceState>({
    blocked: false,
    title: '',
    message: '',
    loading: true,
  });

  const isExempt = role === 'admin_general' || role === 'superadmin';

  const checkMaintenance = async () => {
    if (!user || isExempt) {
      setState({ blocked: false, title: '', message: '', loading: false });
      return;
    }

    try {
      let sid = schoolId;

      if (!sid) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('school_id')
          .eq('id', user.id)
          .single();
        sid = profile?.school_id;
      }

      if (!sid) {
        setState(prev => ({ ...prev, loading: false }));
        return;
      }

      const { data: config } = await supabase
        .from('maintenance_config')
        .select('enabled, title, message, bypass_emails, schedule_start, schedule_end, schedule_timezone')
        .eq('school_id', sid)
        .eq('module_key', moduleKey)
        .maybeSingle();

      if (!config) {
        setState({ blocked: false, title: '', message: '', loading: false });
        return;
      }

      let isActive = config.enabled;

      // Auto-schedule: solo aplica si el toggle principal está habilitado
      // Si enabled=false, el mantenimiento está apagado sin importar el horario
      if (isActive && config.schedule_start && config.schedule_end) {
        const now = new Date();
        const tz = config.schedule_timezone || 'America/Lima';
        const localTime = now.toLocaleTimeString('en-GB', { timeZone: tz, hour12: false });
        const [h, m] = localTime.split(':').map(Number);
        const currentMinutes = h * 60 + m;

        const [sh, sm] = config.schedule_start.split(':').map(Number);
        const startMinutes = sh * 60 + sm;

        const [eh, em] = config.schedule_end.split(':').map(Number);
        const endMinutes = eh * 60 + em;

        if (startMinutes <= endMinutes) {
          isActive = currentMinutes >= startMinutes && currentMinutes < endMinutes;
        } else {
          // Rango cruza medianoche
          isActive = currentMinutes >= startMinutes || currentMinutes < endMinutes;
        }
      }

      if (!isActive) {
        setState({ blocked: false, title: '', message: '', loading: false });
        return;
      }

      // Verificar bypass
      const userEmail = user.email?.toLowerCase() || '';
      const isBypassed = (config.bypass_emails || []).some(
        (e: string) => e.toLowerCase() === userEmail
      );

      if (isBypassed) {
        setState({ blocked: false, title: '', message: '', loading: false });
        return;
      }

      setState({
        blocked: true,
        title: config.title || 'Módulo en Mantenimiento',
        message: config.message || 'Este módulo no está disponible temporalmente.',
        loading: false,
      });
    } catch (e) {
      console.error('[MaintenanceGuard] Error:', e);
      setState(prev => ({ ...prev, loading: false }));
    }
  };

  useEffect(() => {
    checkMaintenance();
    const interval = setInterval(checkMaintenance, 30000);
    return () => clearInterval(interval);
  }, [user, role, schoolId, moduleKey]);

  // Realtime
  useEffect(() => {
    if (!user || isExempt) return;

    const channel = supabase
      .channel(`maint-guard-${moduleKey}`)
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'maintenance_config' },
        () => checkMaintenance()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, role, moduleKey]);

  return state;
}
