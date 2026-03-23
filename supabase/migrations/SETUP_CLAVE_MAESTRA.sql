-- ============================================================
-- CLAVE MAESTRA — Corre este SQL en Supabase
-- (Usa delimitadores con nombre para evitar el bug del editor)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.system_secrets (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
ALTER TABLE public.system_secrets ENABLE ROW LEVEL SECURITY;
