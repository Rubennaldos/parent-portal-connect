/**
 * 🛡️ Interceptor global de console.error
 * Captura los últimos 5 errores para enviarlos como contexto
 * al Agente de Soporte IA.
 */

interface CapturedError {
  message: string;
  timestamp: string;
  stack?: string;
}

const MAX_ERRORS = 5;
const capturedErrors: CapturedError[] = [];
let isInstalled = false;

/**
 * Instala el interceptor global (se llama una vez en App.tsx)
 */
export function installConsoleErrorCapture(): void {
  if (isInstalled) return;
  isInstalled = true;

  const originalConsoleError = console.error.bind(console);

  console.error = (...args: any[]) => {
    // Llamar al console.error original
    originalConsoleError(...args);

    // Capturar el error
    const message = args
      .map((arg) => {
        if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg, null, 0).slice(0, 500);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      })
      .join(' ')
      .slice(0, 1000); // Limitar tamaño

    const stack = args.find((a) => a instanceof Error)?.stack?.slice(0, 500);

    capturedErrors.push({
      message,
      timestamp: new Date().toISOString(),
      stack,
    });

    // Mantener solo los últimos MAX_ERRORS
    while (capturedErrors.length > MAX_ERRORS) {
      capturedErrors.shift();
    }
  };

  // También capturar errores no manejados
  window.addEventListener('error', (event) => {
    capturedErrors.push({
      message: `Unhandled: ${event.message} at ${event.filename}:${event.lineno}`,
      timestamp: new Date().toISOString(),
      stack: event.error?.stack?.slice(0, 500),
    });
    while (capturedErrors.length > MAX_ERRORS) {
      capturedErrors.shift();
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    capturedErrors.push({
      message: `UnhandledPromise: ${reason instanceof Error ? reason.message : String(reason)}`,
      timestamp: new Date().toISOString(),
      stack: reason instanceof Error ? reason.stack?.slice(0, 500) : undefined,
    });
    while (capturedErrors.length > MAX_ERRORS) {
      capturedErrors.shift();
    }
  });
}

/**
 * Obtiene los últimos 5 errores capturados
 */
export function getRecentConsoleErrors(): CapturedError[] {
  return [...capturedErrors];
}

/**
 * Limpia los errores capturados
 */
export function clearCapturedErrors(): void {
  capturedErrors.length = 0;
}
