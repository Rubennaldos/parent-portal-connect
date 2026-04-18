-- ════════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Agregar school_id a la tabla sales
-- Fecha: 2026-04-17
--
-- PROBLEMA:
--   La tabla sales fue creada sin la columna school_id.
--   El RPC complete_pos_sale_v2 intenta insertar school_id en sales y falla con:
--   "column 'school_id' does not exist"
--
-- SOLUCIÓN:
--   1. Agregar school_id a sales (nullable para no romper registros existentes).
--   2. Rellenar school_id de registros pasados desde transactions (mismo UUID).
--   3. Rellenar lo que quede desde students como fallback.
--   4. NO toca lógica de negocio ni datos de saldo.
-- ════════════════════════════════════════════════════════════════════════════

-- Paso 1: Agregar la columna (si no existe)
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE;

-- Paso 2: Rellenar school_id de registros pasados desde transactions
-- sales.transaction_id guarda el UUID de la transacción como texto
UPDATE public.sales s
SET    school_id = t.school_id
FROM   public.transactions t
WHERE  s.transaction_id::text = t.id::text
  AND  s.school_id IS NULL
  AND  t.school_id IS NOT NULL;

-- Paso 3: Rellenar lo que siga NULL desde el alumno
UPDATE public.sales s
SET    school_id = st.school_id
FROM   public.students st
WHERE  s.student_id = st.id
  AND  s.school_id IS NULL
  AND  st.school_id IS NOT NULL;

-- Paso 4: Índice para acelerar consultas por sede
CREATE INDEX IF NOT EXISTS idx_sales_school_id ON public.sales(school_id);

NOTIFY pgrst, 'reload schema';

SELECT
  'school_id agregado a sales OK' AS resultado,
  COUNT(*) FILTER (WHERE school_id IS NOT NULL) AS con_school_id,
  COUNT(*) FILTER (WHERE school_id IS NULL)     AS sin_school_id,
  COUNT(*) AS total
FROM public.sales;
