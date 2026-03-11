-- ============================================================
-- RPC: adjust_student_balance
-- Operación ATÓMICA para modificar el saldo de un alumno.
-- Elimina race conditions del patrón read-calculate-write.
-- ============================================================

CREATE OR REPLACE FUNCTION adjust_student_balance(
  p_student_id UUID,
  p_amount NUMERIC
) RETURNS NUMERIC AS $$
DECLARE
  v_new_balance NUMERIC;
BEGIN
  UPDATE students 
  SET balance = balance + p_amount 
  WHERE id = p_student_id
  RETURNING balance INTO v_new_balance;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student % not found', p_student_id;
  END IF;
  
  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RPC: set_student_balance
-- Para casos donde necesitamos establecer un valor absoluto
-- (ej: auto-saldar deudas donde el cálculo ya está hecho)
-- ============================================================

CREATE OR REPLACE FUNCTION set_student_balance(
  p_student_id UUID,
  p_new_balance NUMERIC,
  p_also_set_free_account BOOLEAN DEFAULT NULL
) RETURNS NUMERIC AS $$
DECLARE
  v_final_balance NUMERIC;
BEGIN
  IF p_also_set_free_account IS NOT NULL THEN
    UPDATE students 
    SET balance = p_new_balance, free_account = p_also_set_free_account
    WHERE id = p_student_id
    RETURNING balance INTO v_final_balance;
  ELSE
    UPDATE students 
    SET balance = p_new_balance
    WHERE id = p_student_id
    RETURNING balance INTO v_final_balance;
  END IF;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student % not found', p_student_id;
  END IF;
  
  RETURN v_final_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Verificación
SELECT 'adjust_student_balance y set_student_balance creados correctamente' AS resultado;
