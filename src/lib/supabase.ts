import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? "").toString().trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").toString().trim();

let configured = Boolean(supabaseUrl && supabaseAnonKey);
if (configured) {
  try {
    new URL(supabaseUrl);
  } catch {
    configured = false;
  }
}

export const isAuthConfigured = configured;

// IMPORTANT: No lanzamos error aquí para evitar pantalla en blanco por fallos al importar.
export const supabase: SupabaseClient | null = configured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
