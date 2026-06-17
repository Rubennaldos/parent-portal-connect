import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';

/**
 * VersionChecker — detección de nuevo deploy y actualización limpia.
 *
 * COMPORTAMIENTO:
 *  1. Consulta /version.json cada 60 segundos (y al volver a la pestaña / reconectarse).
 *  2. Si detecta un nuevo deploy, muestra un toast con botón "Actualizar ahora".
 *     → NO recarga la página automáticamente: el padre puede estar en medio del
 *       wizard de almuerzos o eligiendo una fecha.
 *  3. El canal Realtime "force-update" permite que el admin dispare la misma
 *     notificación suave para todos los conectados (no una recarga forzada).
 *  4. La función cleanReload borra caches y SW SOLO cuando el usuario acepta.
 *
 * POR QUÉ SE ELIMINÓ EL AUTO-RELOAD:
 *  - Workbox (skipWaiting + clientsClaim) ya activa el nuevo SW automáticamente
 *    al instalar. El auto-reload extra era redundante y rompía flujos en curso.
 *  - Una recarga en pleno wizard masivo descarta la selección de fechas del padre,
 *    aunque el progreso esté en sessionStorage.
 */

const CHECK_INTERVAL_MS  = 60 * 1000;
const INITIAL_DELAY_MS   = 15 * 1000;

async function cleanReload(): Promise<void> {
  if ('caches' in window) {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    } catch { /* ignorar */ }
  }

  if ('serviceWorker' in navigator) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    } catch { /* ignorar */ }
  }

  try { sessionStorage.removeItem('app_session_start'); } catch { /* noop */ }

  window.location.reload();
}

export function VersionChecker() {
  const { toast } = useToast();
  const currentVersion  = useRef<string | null>(null);
  const updatePending   = useRef(false);
  const isReloading     = useRef(false);

  const fetchVersion = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch('/version.json?t=' + Date.now(), {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      });

      if (!res.ok) {
        // status distinto de 200: el archivo no existe en el build → el prebuild falló
        // o el deploy no incluyó public/version.json. Requiere revisión del pipeline.
        console.warn(`[VersionChecker] /version.json devolvió HTTP ${res.status}. ` +
          'Verifica que el prebuild (scripts/generate-version.mjs) se haya ejecutado.');
        return null;
      }

      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json') && !contentType.includes('text/plain')) {
        // Vercel está sirviendo index.html (rewrite SPA) en lugar del JSON.
        // Causa: version.json no está en dist/ y el rewrite catch-all lo interceptó.
        console.warn('[VersionChecker] /version.json devolvió Content-Type inesperado: ' +
          `"${contentType}". El rewrite SPA de Vercel puede estar interceptando la ruta. ` +
          'Verifica vercel.json y que public/version.json exista en el build.');
        return null;
      }

      const data = await res.json();
      if (!data.version) {
        console.warn('[VersionChecker] /version.json no contiene el campo "version".');
        return null;
      }
      return data.version;
    } catch {
      // Error de red (offline, CORS, abort): silencioso.
      // No loguear — es esperado en dispositivos con conectividad intermitente.
      return null;
    }
  }, []);

  const notifyUpdate = useCallback((source: string) => {
    if (updatePending.current || isReloading.current) return;
    updatePending.current = true;

    console.info(`[VersionChecker] Nueva versión detectada (${source}). Notificando al usuario.`);

    toast({
      title: '🆕 Actualización disponible',
      description: 'Hay una versión nueva de la app. Toca para aplicarla ahora.',
      // Infinity: Radix no programa el auto-dismiss. El toast permanece visible
      // hasta que el usuario haga clic en "Actualizar ahora" o lo cierre manualmente.
      duration: Infinity,
      action: (
        <ToastAction
          altText="Actualizar ahora"
          onClick={() => {
            isReloading.current = true;
            void cleanReload();
          }}
        >
          Actualizar ahora
        </ToastAction>
      ),
    });
  }, [toast]);

  const checkForUpdate = useCallback(async () => {
    if (isReloading.current) return;

    const serverVersion = await fetchVersion();
    if (!serverVersion) return;

    if (currentVersion.current === null) {
      currentVersion.current = serverVersion;
      return;
    }

    if (serverVersion !== currentVersion.current) {
      notifyUpdate('version.json');
    }
  }, [fetchVersion, notifyUpdate]);

  useEffect(() => {
    const initialTimer = setTimeout(checkForUpdate, INITIAL_DELAY_MS);
    const intervalId   = setInterval(checkForUpdate, CHECK_INTERVAL_MS);

    const onVisible = () => { if (document.visibilityState === 'visible') checkForUpdate(); };
    const onOnline  = () => checkForUpdate();
    const onFocus   = () => checkForUpdate();

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onFocus);

    // Canal Realtime: el admin puede emitir la señal "force-update" desde Dashboard.
    // Se convierte en notificación suave (igual que detección por version.json).
    const channel = supabase?.channel('force-update', {
      config: { broadcast: { self: false } },
    });

    channel
      ?.on('broadcast', { event: 'reload' }, () => {
        notifyUpdate('admin force-update');
      })
      .subscribe();

    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onFocus);
      if (channel) supabase?.removeChannel(channel);
    };
  }, [checkForUpdate, notifyUpdate]);

  return null;
}
