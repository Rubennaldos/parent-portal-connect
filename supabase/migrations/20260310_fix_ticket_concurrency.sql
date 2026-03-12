-- =====================================================================
-- FIX: Race condition en generación de tickets
--
-- Problema: get_next_ticket_number no usaba FOR UPDATE ni advisory lock.
-- Dos cajeros presionando "COBRAR" al mismo milisegundo podían obtener
-- el mismo número de ticket.
--
-- Solución: Advisory lock por user_id + FOR UPDATE en el SELECT.
-- =====================================================================

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

-- Constraint UNIQUE en ticket_code para protección a nivel de datos
-- (solo donde no es null, permitiendo transacciones sin ticket)
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

SELECT '✅ get_next_ticket_number blindado con advisory lock + FOR UPDATE + UNIQUE index' as status;
