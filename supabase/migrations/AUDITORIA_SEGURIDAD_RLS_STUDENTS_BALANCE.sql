-- ================================================================
-- AUDITORÍA DE SEGURIDAD CRÍTICA — Línea de tiempo + RLS students
-- Pregunta: ¿puede un padre inyectar balance al registrar a su hijo?
-- ================================================================


-- ════════════════════════════════════════════════════════════════
-- PARTE 1: LÍNEA DE TIEMPO EXACTA DE EMA NOGUEROL
-- ¿El dinero ya estaba desde el día 1?
-- ════════════════════════════════════════════════════════════════

-- 1-A) ¿Cuándo nació Ema en el sistema y con qué balance?
SELECT
  id,
  full_name,
  balance          AS balance_HOY,
  created_at       AS nacimiento_en_sistema,
  school_id,
  parent_id,
  is_active,
  free_account
FROM students
WHERE id = 'f9f2569a-7bd9-4609-b451-50e8bfbe45ef';

-- 1-B) Primera transacción de Ema (para comparar con created_at)
SELECT
  id,
  amount,
  type,
  payment_status,
  metadata,
  created_at       AS primera_transaccion
FROM transactions
WHERE student_id = 'f9f2569a-7bd9-4609-b451-50e8bfbe45ef'
ORDER BY created_at ASC
LIMIT 1;

-- 1-C) ¿Cuántos milisegundos pasaron entre el nacimiento y la primera transacción?
SELECT
  s.created_at                                           AS nacio_en,
  t.created_at                                           AS primer_movimiento,
  EXTRACT(EPOCH FROM (t.created_at - s.created_at)) / 60 AS minutos_de_diferencia,
  CASE
    WHEN EXTRACT(EPOCH FROM (t.created_at - s.created_at)) < 5
    THEN '🚨 SOSPECHOSO: menos de 5 segundos entre creación y transacción'
    WHEN EXTRACT(EPOCH FROM (t.created_at - s.created_at)) < 60
    THEN '⚠️ REVISAR: menos de 1 minuto'
    ELSE '✅ Normal: hubo tiempo entre registro y primera compra'
  END AS diagnostico
FROM students s
CROSS JOIN (
  SELECT created_at FROM transactions
  WHERE student_id = 'f9f2569a-7bd9-4609-b451-50e8bfbe45ef'
  ORDER BY created_at ASC LIMIT 1
) t
WHERE s.id = 'f9f2569a-7bd9-4609-b451-50e8bfbe45ef';


-- ════════════════════════════════════════════════════════════════
-- PARTE 2: AUDITORÍA RLS DE LA TABLA STUDENTS
-- ¿Qué políticas protegen el INSERT de un padre?
-- ════════════════════════════════════════════════════════════════

-- 2-A) TODAS las políticas RLS activas sobre la tabla students
SELECT
  policyname     AS politica,
  cmd            AS operacion,
  roles          AS roles_afectados,
  qual           AS using_clause,
  with_check     AS with_check_clause
FROM pg_policies
WHERE tablename = 'students'
ORDER BY cmd, policyname;

-- 2-B) ¿Está RLS habilitado en students?
SELECT
  relname         AS tabla,
  relrowsecurity  AS rls_habilitado,
  relforcerowsecurity AS rls_forzado
FROM pg_class
WHERE relname = 'students'
  AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

-- 2-C) ¿Hay CHECK CONSTRAINTS en la columna balance?
SELECT
  conname          AS constraint_nombre,
  contype          AS tipo,
  pg_get_constraintdef(oid) AS definicion
FROM pg_constraint
WHERE conrelid = 'public.students'::regclass
ORDER BY contype;

-- 2-D) ¿Hay algún trigger BEFORE INSERT que fuerce balance = 0?
SELECT
  tgname         AS trigger_nombre,
  CASE tgtype & 2 WHEN 2 THEN 'BEFORE' ELSE 'AFTER' END AS momento,
  CASE tgtype & 28
    WHEN 4  THEN 'INSERT'
    WHEN 16 THEN 'UPDATE'
    WHEN 28 THEN 'INSERT/UPDATE/DELETE'
    ELSE tgtype::text
  END            AS evento,
  proname        AS funcion,
  tgenabled      AS activo
FROM pg_trigger t
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE t.tgrelid = 'public.students'::regclass
  AND NOT t.tgisinternal
ORDER BY tgname;

-- 2-E) Código del trigger sync_student_names (el único BEFORE INSERT detectado)
SELECT pg_get_functiondef(oid) AS codigo
FROM pg_proc
WHERE proname = 'sync_student_names'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

-- 2-F) ¿Hay un DEFAULT en la columna balance de students?
SELECT
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'students'
  AND column_name  = 'balance';


-- ════════════════════════════════════════════════════════════════
-- PARTE 3: ESCÁNER DE ALUMNOS CREADOS CON BALANCE > 0 DESDE EL INICIO
-- Si el RLS no protege, habría alumnos cuyo balance inicial > 0
-- y que tienen created_at muy cercano al momento del "depósito"
-- ════════════════════════════════════════════════════════════════

-- 3-A) Los 97 alumnos con saldo fantasma: ¿cuándo fueron creados?
--      Queremos ver si el saldo apareció en el momento del INSERT
--      (solo lectura, top 30 por saldo fantasma mayor)
WITH fantasma AS (
  SELECT
    s.id,
    s.full_name,
    s.balance           AS balance_actual,
    s.created_at,
    sch.name            AS sede,
    COALESCE(SUM(
      CASE
        WHEN t.is_deleted = false
         AND t.payment_status != 'cancelled'
         AND (t.metadata IS NULL OR (t.metadata->>'lunch_order_id') IS NULL)
        THEN t.amount ELSE 0
      END
    ), 0)               AS balance_transacciones
  FROM students s
  LEFT JOIN schools sch ON sch.id = s.school_id
  LEFT JOIN transactions t ON t.student_id = s.id
  WHERE s.is_active = true
  GROUP BY s.id, s.full_name, s.balance, s.created_at, sch.name
  HAVING ABS(s.balance - COALESCE(SUM(
    CASE
      WHEN t.is_deleted = false AND t.payment_status != 'cancelled'
       AND (t.metadata IS NULL OR (t.metadata->>'lunch_order_id') IS NULL)
      THEN t.amount ELSE 0 END
  ), 0)) > 0.01
)
SELECT
  f.full_name,
  f.sede,
  f.created_at                                                        AS fecha_registro,
  ROUND((f.balance_actual - f.balance_transacciones)::numeric, 2)    AS saldo_fantasma,
  f.balance_actual                                                    AS balance_hoy,
  (SELECT MIN(created_at) FROM transactions WHERE student_id = f.id) AS primera_transaccion,
  ROUND(
    EXTRACT(EPOCH FROM (
      (SELECT MIN(created_at) FROM transactions WHERE student_id = f.id) - f.created_at
    )) / 3600
  , 1)                                                                AS horas_hasta_primer_movimiento
FROM fantasma f
ORDER BY saldo_fantasma DESC
LIMIT 30;
