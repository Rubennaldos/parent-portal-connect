import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";

/**
 * 🛡️ PARCHE CRÍTICO: Prevenir error "removeChild" de React
 * 
 * Este error ocurre cuando extensiones del navegador (Grammarly, LastPass,
 * traducción automática de Chrome, ad blockers, etc.) modifican el DOM
 * directamente, rompiendo la relación padre-hijo que React espera.
 * 
 * React internamente llama node.removeChild(child) pero el child ya fue
 * movido/envuelto por la extensión. Este parche intercepta esas llamadas
 * y las maneja gracefully en vez de crashear toda la app.
 * 
 * Solución estándar usada en producción por grandes apps React.
 * Ref: https://github.com/facebook/react/issues/11538
 */
if (typeof Node !== 'undefined' && Node.prototype) {
  const originalRemoveChild = Node.prototype.removeChild;
  // @ts-expect-error - Overriding native method for React compatibility
  Node.prototype.removeChild = function <T extends Node>(child: T): T {
    if (child.parentNode !== this) {
      console.warn(
        '[DOM Patch] removeChild: el nodo no es hijo directo, ignorando para evitar crash de React',
      );
      return child;
    }
    return originalRemoveChild.call(this, child) as T;
  };

  const originalInsertBefore = Node.prototype.insertBefore;
  // @ts-expect-error - Overriding native method for React compatibility
  Node.prototype.insertBefore = function <T extends Node>(
    newNode: T,
    referenceNode: Node | null,
  ): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      console.warn(
        '[DOM Patch] insertBefore: el nodo de referencia no es hijo directo, ignorando para evitar crash de React',
      );
      return newNode;
    }
    return originalInsertBefore.call(this, newNode, referenceNode) as T;
  };
}

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);

/**
 * 🔄 REGISTRO DEL SERVICE WORKER CON AUTO-ACTUALIZACIÓN
 * 
 * Cuando hay un nuevo deploy en Vercel:
 * 1. El navegador detecta que sw.js cambió
 * 2. Descarga el nuevo SW automáticamente
 * 3. skipWaiting + clientsClaim = el SW nuevo toma control de inmediato
 * 4. El VersionChecker detecta el cambio y recarga la página
 * 
 * Esto garantiza que los padres SIEMPRE tengan la última versión
 * sin necesidad de hacer Ctrl+Shift+R.
 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {

    // En desarrollo: desregistrar cualquier SW existente para evitar
    // el error "unsupported MIME type (text/html)" en la consola.
    if (import.meta.env.DEV) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        if (registrations.length > 0) {
          registrations.forEach(r => r.unregister());
        }
      }).catch(() => {});
      return; // No registrar SW en desarrollo
    }

    // Producción: registro normal con auto-actualización
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        // Verificar actualizaciones cada 60 segundos
        setInterval(() => {
          registration.update().catch(() => {
            // Silenciar errores de red
          });
        }, 60 * 1000);

        // Cuando un nuevo SW está listo, recargar
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'activated') {
                // El VersionChecker se encargará de recargar
                console.log('[SW] Nuevo Service Worker activado');
              }
            });
          }
        });
      })
      .catch((error) => {
        console.log('[SW] Error al registrar:', error);
      });

    // Si el SW toma control mientras la página está abierta
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('[SW] Nuevo controller detectado');
    });
  });
}