import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Hook para detectar el estado de conexión a internet en tiempo real.
 * Retorna `isOnline` (boolean) y una función `checkConnection` para forzar verificación.
 *
 * FIX: No usar import.meta.env.VITE_SUPABASE_URL directamente como fallback porque
 * en producción puede estar vacío y caer a 'placeholder.supabase.co', lo cual hace
 * que el POS crea que siempre está offline y nunca sincroniza la cola offline.
 * Solución: leer la URL del cliente Supabase ya instanciado, con fallback a google/204.
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [lastChecked, setLastChecked] = useState(Date.now());

  const checkConnection = useCallback(async (): Promise<boolean> => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);

      // Leer URL real del cliente Supabase ya configurado
      const supabaseUrl: string = (supabase as any).supabaseUrl
        || import.meta.env.VITE_SUPABASE_URL
        || '';
      const supabaseKey: string = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

      // Si la URL no está disponible o es placeholder → ping a Google (siempre responde)
      const pingUrl = supabaseUrl && !supabaseUrl.includes('placeholder')
        ? `${supabaseUrl}/rest/v1/`
        : 'https://www.google.com/generate_204';

      const isSupabasePing = pingUrl.includes('supabase');

      const response = await fetch(pingUrl, {
        method: 'HEAD',
        signal: controller.signal,
        cache: 'no-store',
        headers: isSupabasePing && supabaseKey ? { apikey: supabaseKey } : {},
      });
      clearTimeout(timeout);

      // Supabase: 200 (con apikey) o 401 (sin apikey) = online
      // Google generate_204: 204 = online
      const online = response.ok || response.status === 401 || response.status === 204;
      setIsOnline(online);
      setLastChecked(Date.now());
      return online;
    } catch {
      setIsOnline(false);
      setLastChecked(Date.now());
      return false;
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      console.log('🟢 Conexión restaurada');
      setIsOnline(true);
      setLastChecked(Date.now());
    };

    const handleOffline = () => {
      console.log('🔴 Conexión perdida');
      setIsOnline(false);
      setLastChecked(Date.now());
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Verificar periódicamente cada 30 segundos para detectar internet lento
    const interval = setInterval(async () => {
      if (navigator.onLine) {
        await checkConnection();
      } else {
        setIsOnline(false);
      }
    }, 30000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [checkConnection]);

  return { isOnline, lastChecked, checkConnection };
}
