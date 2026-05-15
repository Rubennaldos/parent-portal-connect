-- =============================================================================
-- Comprobantes de prueba (panel Nubefact) — limpieza abril 2026
-- Ejecutar en Supabase → SQL Editor. Revisar conteos ANTES de cada UPDATE.
--
-- REFERENCIA (auditoría 2026-05-15, emission_date abril 2026):
--
-- RUC 20100130492 (EMPRESA DE PRUEBA) por sede:
--   Jean LeBouch 4 | St. George's Villa 1 | MC2 1 | Little St. George's 1  → 7
--
-- "Cliente de Prueba" sin RUC por sede:
--   Jean LeBouch 7 | MC2 2 | Little St. George's 1 | St. George's Villa 1  → 11
--
-- Comprobantes REALES abril (post-UPDATE RUC, pre-UPDATE Cliente de Prueba):
--   SGM 899 | SGV 804 | MC2 782 | MC1 678 | JLB 561 | Nordic 341 | LSG 8  → 4073
--
-- UPDATE RUC (paso 1): ya ejecutado en producción (13 filas globales históricas).
-- =============================================================================

-- ── 0) Diagnóstico abril 2026 ───────────────────────────────────────────────

-- RUC prueba por sede
SELECT s.name, count(*) AS cnt
FROM public.invoices i
JOIN public.schools s ON s.id = i.school_id
WHERE i.client_document_number = '20100130492'
  AND i.emission_date >= '2026-04-01'
  AND i.emission_date <= '2026-04-30'
GROUP BY s.name
ORDER BY cnt DESC;

-- Cliente de Prueba sin RUC por sede
SELECT s.name, count(*) AS cnt
FROM public.invoices i
JOIN public.schools s ON s.id = i.school_id
WHERE i.emission_date >= '2026-04-01'
  AND i.emission_date <= '2026-04-30'
  AND i.client_name ILIKE 'Cliente de Prueba'
  AND coalesce(i.client_document_number, '') = ''
GROUP BY s.name
ORDER BY cnt DESC;

SELECT count(*) AS cliente_de_prueba_abril_sin_ruc_total
FROM public.invoices
WHERE emission_date >= '2026-04-01'
  AND emission_date <= '2026-04-30'
  AND client_name ILIKE 'Cliente de Prueba'
  AND coalesce(client_document_number, '') = '';

-- ── 1) UPDATE RUC prueba (TODAS las sedes, con o sin transaction_id) ─────
-- Idempotente: solo filas que aún no están marcadas.
UPDATE public.invoices
SET
  is_demo      = true,
  sunat_status = 'rejected',
  updated_at   = now(),
  notes        = trim(both ' ' from coalesce(notes, '') || ' [2026-05-15 Marcado demo/rejected — RUC prueba 20100130492]')
WHERE client_document_number = '20100130492'
  AND (is_demo IS DISTINCT FROM true OR sunat_status IS DISTINCT FROM 'rejected');

-- Verificación RUC
SELECT count(*) AS ruc_prueba_aun_sin_marcar
FROM public.invoices
WHERE client_document_number = '20100130492'
  AND (is_demo IS DISTINCT FROM true OR sunat_status <> 'rejected');

-- ── 2) UPDATE "Cliente de Prueba" sin RUC — abril 2026, TODAS las sedes ───
-- (11 filas en auditoría: JLB 7, MC2 2, LSG 1, SGV 1)

UPDATE public.invoices
SET
  is_demo      = true,
  sunat_status = 'rejected',
  updated_at   = now(),
  notes        = trim(both ' ' from coalesce(notes, '') || ' [2026-05-15 Marcado demo/rejected — Cliente de Prueba]')
WHERE client_name ILIKE 'Cliente de Prueba'
  AND coalesce(client_document_number, '') = ''
  AND emission_date >= '2026-04-01'
  AND emission_date <= '2026-04-30'
  AND (is_demo IS DISTINCT FROM true OR sunat_status IS DISTINCT FROM 'rejected');

-- Verificación Cliente de Prueba
SELECT count(*) AS cliente_prueba_abril_aun_sin_marcar
FROM public.invoices
WHERE emission_date >= '2026-04-01'
  AND emission_date <= '2026-04-30'
  AND client_name ILIKE 'Cliente de Prueba'
  AND coalesce(client_document_number, '') = ''
  AND (is_demo IS DISTINCT FROM true OR sunat_status <> 'rejected');

-- ── 3) Comprobantes para contadora abril 2026 ───────────────────────────────
-- Misma lógica que Registro de Ventas (CierreMensual): ACEPTADOS por SUNAT,
-- sin demo, sin RUC prueba (excluye rechazados por suspensión Nubefact, etc.)

SELECT count(*) AS comprobantes_aceptados_abril_red_total
FROM public.invoices
WHERE emission_date >= '2026-04-01'
  AND emission_date <= '2026-04-30'
  AND sunat_status = 'accepted'
  AND is_demo = false
  AND coalesce(client_document_number, '') <> '20100130492';

-- Por sede
SELECT s.name AS sede, count(*) AS comprobantes_aceptados
FROM public.invoices i
JOIN public.schools s ON s.id = i.school_id
WHERE i.emission_date >= '2026-04-01'
  AND i.emission_date <= '2026-04-30'
  AND i.sunat_status = 'accepted'
  AND i.is_demo = false
  AND coalesce(i.client_document_number, '') <> '20100130492'
GROUP BY s.name
ORDER BY comprobantes_aceptados DESC;

-- Solo Jean LeBouch (school_id fijo)
SELECT count(*) AS comprobantes_aceptados_abril_jlb
FROM public.invoices
WHERE emission_date >= '2026-04-01'
  AND emission_date <= '2026-04-30'
  AND sunat_status = 'accepted'
  AND is_demo = false
  AND coalesce(client_document_number, '') <> '20100130492'
  AND school_id = '8a0dbd73-0571-4db1-af5c-65f4948c4c98';

-- Rechazados abril (no van al Excel contable; referencia GODIÑO, CASTRO, etc.)
SELECT count(*) AS rechazados_abril_jlb
FROM public.invoices
WHERE emission_date >= '2026-04-01'
  AND emission_date <= '2026-04-30'
  AND sunat_status = 'rejected'
  AND is_demo = false
  AND school_id = '8a0dbd73-0571-4db1-af5c-65f4948c4c98';
