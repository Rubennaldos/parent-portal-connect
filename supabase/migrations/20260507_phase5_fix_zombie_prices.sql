-- ============================================================
-- Fase 5 — Saneamiento de "precios zombie"
-- ============================================================
-- Un "precio zombie" es una fila en product_school_prices cuya
-- school_id NO está en products.school_ids (el producto fue
-- restringido a otras sedes o ya no tiene esa sede en su alcance).
--
-- Política: NO se borran filas (preserva trazabilidad / REGLA #13).
--           Se pone is_available = false + updated_at = now().
--
-- Alcance: solo productos con school_ids IS NOT NULL (los globales,
--          school_ids IS NULL, pueden tener precio en cualquier sede).
--
-- Tipo en BD: products.school_ids se almacena como text[].
--             Usamos ::text en la comparación para evitar error 42883.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- PASO 1 — AUDITORÍA (solo lectura, seguro para ejecutar primero)
-- ─────────────────────────────────────────────────────────────
-- Muestra cada fila zombie con contexto suficiente para revisar
-- antes de ejecutar el UPDATE.
-- Columnas:
--   psp_id           → id de la fila en product_school_prices
--   product_id       → UUID del producto
--   product_name     → nombre del producto
--   school_id        → sede del precio zombie
--   school_name      → nombre de la sede (join)
--   product_scope    → school_ids del producto (para contexto)
--   current_available→ estado actual del flag
-- ─────────────────────────────────────────────────────────────

/*
SELECT
  psp.id                         AS psp_id,
  psp.product_id,
  p.name                         AS product_name,
  psp.school_id,
  s.name                         AS school_name,
  p.school_ids                   AS product_scope,
  psp.price_sale,
  psp.is_available               AS current_available,
  psp.updated_at
FROM public.product_school_prices psp
JOIN public.products p
  ON p.id = psp.product_id
LEFT JOIN public.schools s
  ON s.id = psp.school_id
WHERE
  -- Solo productos con alcance restringido (global = NULL queda fuera)
  p.school_ids IS NOT NULL
  -- Detectar cuando la sede ya no está en el alcance del producto
  AND (
    -- Array vacío: ninguna sede es válida
    cardinality(p.school_ids) = 0
    OR
    -- La school_id no aparece en el array (cast a text para evitar error 42883)
    NOT (psp.school_id::text = ANY (p.school_ids::text[]))
  )
  -- Opcional: descomenta para ver solo los que aún están activos (los que necesitan corrección)
  -- AND psp.is_available = true
ORDER BY p.name, s.name;
*/

-- ─────────────────────────────────────────────────────────────
-- PASO 2 — CORRECCIÓN (ejecutar después de revisar el SELECT)
-- ─────────────────────────────────────────────────────────────
-- Desactiva los precios zombie: is_available = false.
-- No borra filas ni toca transactions/deudas.
-- Idempotente: ejecutarlo dos veces no produce daño adicional.
-- ─────────────────────────────────────────────────────────────

WITH zombie_prices AS (
  SELECT psp.id
  FROM public.product_school_prices psp
  JOIN public.products p
    ON p.id = psp.product_id
  WHERE
    p.school_ids IS NOT NULL
    AND (
      cardinality(p.school_ids) = 0
      OR NOT (psp.school_id::text = ANY (p.school_ids::text[]))
    )
    AND psp.is_available = true   -- solo los que aún están marcados como activos
)
UPDATE public.product_school_prices
SET
  is_available = false,
  updated_at   = now()
WHERE id IN (SELECT id FROM zombie_prices);

-- ─────────────────────────────────────────────────────────────
-- PASO 3 — VERIFICACIÓN POST-CORRECCIÓN
-- ─────────────────────────────────────────────────────────────
-- Devuelve un conteo de filas zombie que quedan con is_available = true
-- (debe ser 0 tras el UPDATE anterior).
-- Devuelve también el total de filas ya desactivadas por esta causa.
-- ─────────────────────────────────────────────────────────────

SELECT
  COUNT(*) FILTER (
    WHERE p.school_ids IS NOT NULL
      AND (cardinality(p.school_ids) = 0
           OR NOT (psp.school_id::text = ANY (p.school_ids::text[])))
      AND psp.is_available = true
  )                                      AS zombie_aun_activos,

  COUNT(*) FILTER (
    WHERE p.school_ids IS NOT NULL
      AND (cardinality(p.school_ids) = 0
           OR NOT (psp.school_id::text = ANY (p.school_ids::text[])))
      AND psp.is_available = false
  )                                      AS zombie_ya_desactivados,

  COUNT(*)                               AS total_filas_precio
FROM public.product_school_prices psp
JOIN public.products p ON p.id = psp.product_id;
