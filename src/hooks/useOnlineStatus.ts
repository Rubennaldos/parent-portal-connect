import { useState, useEffect, useCallback } from 'react';

/**
 * Hook para detectar el estado de conexión a internet en tiempo real.
 * Retorna `isOnline` (boolean) y una función `checkConnection` para forzar verificación.
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [lastChecked, setLastChecked] = useState(Date.now());

  // Verificación real: intenta hacer un fetch pequeño a Supabase
  const checkConnection = useCallback(async (): Promise<boolean> => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

      const response = await fetch(
        `${supabaseUrl}/rest/v1/`,
        {
          method: 'HEAD',
          signal: controller.signal,
          cache: 'no-store',
          headers: supabaseKey ? { 'apikey': supabaseKey } : {},
        }
      );
      clearTimeout(timeout);
      
      // Con apikey el servidor devuelve 200; sin él devolvería 401 (ambos indican que está online)
      const online = response.ok || response.status === 401;
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

    // Verificar periódicamente (cada 30 segundos) para detectar internet lento
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
