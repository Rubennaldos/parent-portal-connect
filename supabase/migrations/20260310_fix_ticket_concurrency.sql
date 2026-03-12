-- =====================================================================
-- FIX: Race condition en generación de tickets
--
-- Problema: get_next_ticket_number no usaba FOR UPDATE ni advisory lock.
-- Dos cajeros presionando "COBRAR" al mismo milisegundo podían obtener
-- el mismo número de ticket.
--
-- Solución:
-- 1. Reparar duplicados existentes añadiendo sufijo -DUP-N
-- 2. Advisory lock + FOR UPDATE en la función
-- 3. UNIQUE index parcial en ticket_code
-- =====================================================================

-- PASO 1: Reparar tickets duplicados existentes
-- Mantiene el original (el más antiguo) y renombra los demás
WITH duplicates AS (
  SELECT id, ticket_code,
         ROW_NUMBER() OVER (PARTITION BY ticket_code ORDER BY created_at ASC) AS rn
  FROM transactions
  WHERE ticket_code IS NOT NULL
)
UPDATE transactions t
SET ticket_code = d.ticket_code || '-DUP-' || d.rn
FROM duplicates d
WHERE t.id = d.id
  AND d.rn > 1;

-- PASO 2: Función blindada
CREATE OR REPLACE FUNCTION get_next_ticket_number(p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_number INTEGER;
  v_prefix TEXT;
  v_ticket_number TEXT;
BEGIN
  -- Advisory lock por usuario: serializa todas las llamadas del mismo cajero
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

  -- Intentar obtener y bloquear la fila del cajero
  SELECT prefix, current_number INTO v_prefix, v_number
  FROM ticket_sequences
  WHERE profile_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_prefix := generate_user_prefix(p_user_id);
    INSERT INTO ticket_sequences (profile_id, current_number, prefix)
    VALUES (p_user_id, 1, v_prefix)
    ON CONFLICT (profile_id) DO UPDATE
      SET current_number = ticket_sequences.current_number + 1,
          updated_at = NOW()
    RETURNING current_number INTO v_number;
  ELSE
    UPDATE ticket_sequences
    SET current_number = current_number + 1,
        updated_at = NOW()
    WHERE profile_id = p_user_id
    RETURNING current_number INTO v_number;
  END IF;

  v_ticket_number := v_prefix || LPAD(v_number::TEXT, 6, '0');
  RETURN v_ticket_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- PASO 3: Índice único (ahora sin duplicados)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_transactions_ticket_code_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_transactions_ticket_code_unique
    ON transactions (ticket_code)
    WHERE ticket_code IS NOT NULL;
  END IF;
END $$;

SELECT '✅ Duplicados reparados + función blindada + UNIQUE index creado' as status;
