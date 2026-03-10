import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * 🔄 VersionChecker — Auto-actualización del sistema
 * 
 * Este componente verifica periódicamente si hay una nueva versión desplegada.
 * Si detecta un cambio, recarga la página automáticamente (como Ctrl+Shift+R).
 * 
 * ¿Cómo funciona?
 * 1. En cada build, se genera un /version.json con un hash único
 * 2. Este componente lo consulta cada 60 segundos y al volver a la pestaña
 * 3. Si el hash cambió → hay nuevo deploy → recarga automática
 * 4. La recarga es "limpia" (borra cache del service worker)
 * 5. NUEVO: También escucha un canal Realtime "force-update" para que el
 *    admin pueda forzar la recarga de TODOS los usuarios al instante.
 * 
 * Esto resuelve el problema de que los padres se quedan con versiones viejas
 * y ven errores porque su navegador cachea todo.
 */

const CHECK_INTERVAL_MS = 60 * 1000; // Verificar cada 60 segundos
const INITIAL_DELAY_MS = 10 * 1000;  // Esperar 10 seg antes de la primera verificación

/** Función reutilizable: limpiar cache + service workers y recargar */
async function forceCleanReload(reason: string) {
  console.log(`[VersionChecker] 🔄 ${reason}. Recargando...`);

  // 1. Limpiar el cache del Service Worker
  if ('caches' in window) {
    try {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name)));
    } catch {
      // Ignorar errores de cache
    }
  }

  // 2. Des-registrar el Service Worker viejo
  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(reg => reg.unregister()));
    } catch {
      // Ignorar
    }
  }

  // 3. Limpiar sessionStorage/localStorage de versión
  try {
    sessionStorage.removeItem('app_session_start');
  } catch { /* noop */ }

  // 4. Recargar la página
  setTimeout(() => {
    window.location.reload();
  }, 500);
}

export function VersionChecker() {
  const currentVersion = useRef<string | null>(null);
  const isReloading = useRef(false);
  const sessionStartedAt = useRef(Date.now());

  const fetchVersion = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch('/version.json?t=' + Date.now(), {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
        },
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data.version || null;
    } catch {
      return null;
    }
  }, []);

  const checkForUpdate = useCallback(async () => {
    if (isReloading.current) return;

    const serverVersion = await fetchVersion();
    if (!serverVersion) return;

    // Primera vez: guardar la versión actual
    if (currentVersion.current === null) {
      currentVersion.current = serverVersion;
      return;
    }

    // Si la versión cambió → nuevo deploy → recargar
    if (serverVersion !== currentVersion.current) {
      isReloading.current = true;
      await forceCleanReload(
        `Nueva versión detectada: ${currentVersion.current} → ${serverVersion}`
      );
    }
  }, [fetchVersion]);

  useEffect(() => {
    // Guardar momento en que esta sesión inició
    sessionStartedAt.current = Date.now();

    // ── 1. Verificación por version.json (polling) ──
    const initialTimer = setTimeout(() => {
      checkForUpdate();
    }, INITIAL_DELAY_MS);

    const intervalId = setInterval(() => {
      checkForUpdate();
    }, CHECK_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkForUpdate();
      }
    };
    const handleOnline = () => { checkForUpdate(); };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', checkForUpdate);

    // ── 2. Canal Realtime: "force-update" (señal del admin) ──
    const channel = supabase.channel('force-update', {
      config: { broadcast: { self: false } },
    });

    channel
      .on('broadcast', { event: 'reload' }, (payload) => {
        if (isReloading.current) return;
        isReloading.current = true;
        const ts = payload?.payload?.triggered_at || 'unknown';
        forceCleanReload(`Actualización forzada por el administrador (${ts})`);
      })
      .subscribe();

    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('focus', checkForUpdate);
      supabase.removeChannel(channel);
    };
  }, [checkForUpdate]);

  // Este componente no renderiza nada visible
  return null;
}
