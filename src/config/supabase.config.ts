// Configuración de Supabase para Múltiples Entornos
// IMPORTANTE: Solo incluye credenciales PÚBLICAS (anon key)

// 🔍 Detectar entorno — SOLO localhost/127.0.0.1 activa DEV.
// Previews de Vercel (*.vercel.app) y cualquier otro hostname usan PRODUCCIÓN.
// Antes se chequeaba hostname.includes('dev') lo que rompía Vercel preview URLs.
const isLocalhost = typeof window !== 'undefined' && (
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
);

// 🟢 DESARROLLO (solo para el programador en su máquina local)
// Para activarlo: crea un .env.local con VITE_SUPABASE_URL_DEV y VITE_SUPABASE_ANON_KEY_DEV
const DEV_CONFIG = {
  url:     import.meta.env.VITE_SUPABASE_URL_DEV     || '',
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY_DEV || '',
};

// 🔴 PRODUCCIÓN — credenciales hardcodeadas como fallback seguro
// (las variables de entorno de Vercel tienen prioridad cuando están definidas)
const PROD_CONFIG = {
  url:     import.meta.env.VITE_SUPABASE_URL     || 'https://duxqzozoahvrvqseinji.supabase.co',
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1eHF6b3pvYWh2cnZxc2VpbmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY3ODgwOTQsImV4cCI6MjA4MjM2NDA5NH0.JLxfApjPBYkCBPd5yfKyIE0SI-sw_8S_vweDR59Hflg',
};

// Solo usar DEV si estamos en localhost Y las credenciales DEV están configuradas
const useDevConfig = isLocalhost && Boolean(DEV_CONFIG.url && DEV_CONFIG.anonKey);

export const supabaseConfig = useDevConfig ? DEV_CONFIG : PROD_CONFIG;

// Debug en consola (solo en desarrollo para no llenar la consola en prod)
if (typeof console !== 'undefined') {
  if (useDevConfig) {
    console.log('🔧 ENTORNO: DESARROLLO LOCAL');
    console.log('📦 Base de datos DEV activa — URL:', supabaseConfig.url);
  } else if (isLocalhost) {
    console.log('🔧 ENTORNO: localhost → usando PRODUCCIÓN (DEV no configurado)');
  }
  // En producción: sin logs para no exponer info
}

