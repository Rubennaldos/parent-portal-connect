-- ============================================================
-- AUDITORÍA DE CONCURRENCIA Y ARQUITECTURA — CashRegisterV2
-- Ejecutar en Supabase SQL Editor
-- ============================================================


-- ─── EC-CONC: Verificar que el UNIQUE constraint existe ──────────────────────
-- El constraint uq_cash_session_school_date garantiza que solo puede existir
-- UNA fila por (school_id, session_date) en la tabla cash_sessions.
-- PostgreSQL aplica este constraint con un índice único a nivel de BD,
-- por lo que aunque dos admins hagan clic al mismo milisegundo, la BD
-- acepta el primero y lanza error 23505 (duplicate key) en el segundo.
-- El Frontend ya maneja el 23505 con un toast informativo.

-- Verificación: debe mostrar 1 fila
SELECT conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'cash_sessions'::regclass
  AND conname = 'uq_cash_session_school_date';

-- Si no aparece nada, crear:
ALTER TABLE cash_sessions
  ADD CONSTRAINT IF NOT EXISTS uq_cash_session_school_date
  UNIQUE (school_id, session_date);


-- ─── EC-LIMBO: Trigger que rechaza ingresos en caja cerrada ──────────────────
-- Escenario: El cajero tiene el modal abierto. La admin cierra la caja desde
-- otra pantalla. El cajero confirma el ingreso. Sin esta protección, el insert
-- se haría en una sesión ya cerrada, corrompiendo el histórico.
--
-- SOLUCIÓN: Un trigger BEFORE INSERT en cash_manual_entries que verifica que
-- la cash_session referenciada esté con status = 'open'. Si no, lanza excepción.

CREATE OR REPLACE FUNCTION fn_guard_manual_entry_on_closed_session()
RETURNS TRIGGER AS $$
DECLARE
  session_status TEXT;
BEGIN
  SELECT status INTO session_status
  FROM cash_sessions
  WHERE id = NEW.cash_session_id;

  IF session_status IS NULL THEN
    RAISE EXCEPTION 'cash_session_not_found: La sesión de caja no existe (id: %)', NEW.cash_session_id
      USING ERRCODE = 'P0001';
  END IF;

  IF session_status <> 'open' THEN
    RAISE EXCEPTION 'cash_session_closed: No se pueden registrar movimientos en una caja cerrada. La caja fue cerrada antes de que pudieras confirmar. Por favor recarga la página.'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Instalar el trigger
DROP TRIGGER IF EXISTS trg_guard_manual_entry ON cash_manual_entries;
CREATE TRIGGER trg_guard_manual_entry
  BEFORE INSERT ON cash_manual_entries
  FOR EACH ROW
  EXECUTE FUNCTION fn_guard_manual_entry_on_closed_session();


-- ─── EC-TZ: Verificar que calculate_daily_totals usa timezone Lima ────────────
-- La función v6 usa DATE(created_at AT TIME ZONE 'America/Lima') = p_date
-- El Frontend ahora envía p_date calculado en hora Lima, no UTC.
-- Verificación: llamar con la fecha Lima de hoy
SELECT
  'EC-TZ: RPC en Lima' AS check_name,
  calculate_daily_totals(
    (SELECT id FROM schools LIMIT 1),
    (CURRENT_TIMESTAMP AT TIME ZONE 'America/Lima')::date
  )->>'pos' AS pos_hoy_lima;


-- ─── Verificación final de todos los constraints clave ───────────────────────
SELECT
  t.table_name,
  c.conname       AS constraint_name,
  c.contype       AS type, -- u=unique, c=check, f=foreign_key, p=primary
  pg_get_constraintdef(c.oid) AS definition
FROM information_schema.tables t
JOIN pg_class pc ON pc.relname = t.table_name
JOIN pg_constraint c ON c.conrelid = pc.oid
WHERE t.table_schema = 'public'
  AND t.table_name IN ('cash_sessions', 'cash_manual_entries')
ORDER BY t.table_name, c.contype;
