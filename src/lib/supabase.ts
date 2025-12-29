import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/config/supabase.config";

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? supabaseConfig.url ?? "").toString().trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? supabaseConfig.anonKey ?? "").toString().trim();

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
