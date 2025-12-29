// Configuración de Supabase para Lovable
// IMPORTANTE: Solo incluye credenciales PÚBLICAS (anon key)

export const supabaseConfig = {
  // URL de tu proyecto Supabase
  url: import.meta.env.VITE_SUPABASE_URL || 'https://duxqzozoahvrvqseinji.supabase.co',
  
  // Anon key (clave pública) - Es seguro exponerla
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_1IjZsZ2X-_fay6oFVUc2Qg_gzCZRFNU',
};

// Validar que las credenciales estén configuradas
if (!supabaseConfig.url || !supabaseConfig.anonKey) {
  console.error('⚠️ ADVERTENCIA: Credenciales de Supabase no configuradas');
  console.log('Por favor configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY');
}

