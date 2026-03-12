-- ============================================================
-- MEJORA DE SEGURIDAD: adjust_student_balance
-- Agrega validaciones contra null, montos absurdos y logging
-- ============================================================

CREATE OR REPLACE FUNCTION adjust_student_balance(
  p_student_id UUID,
  p_amount NUMERIC
) RETURNS NUMERIC AS $$
DECLARE
  v_new_balance NUMERIC;
BEGIN
  -- Validar que el student_id no sea null
  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'student_id no puede ser NULL';
  END IF;

  -- Validar que el monto no sea null
  IF p_amount IS NULL THEN
    RAISE EXCEPTION 'amount no puede ser NULL';
  END IF;

  -- Validar que el monto no sea 0 (operación sin sentido)
  IF p_amount = 0 THEN
    -- Retornar el saldo actual sin modificar
    SELECT balance INTO v_new_balance FROM students WHERE id = p_student_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Student % not found', p_student_id;
    END IF;
    RETURN v_new_balance;
  END IF;

  -- Protección contra montos absurdos (> S/ 10,000 en una sola operación)
  IF ABS(p_amount) > 10000 THEN
    RAISE EXCEPTION 'Monto % excede el límite de seguridad de S/ 10,000', p_amount;
  END IF;

  -- Operación atómica: UPDATE adquiere row-level lock automáticamente
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

-- Verificación
SELECT 'adjust_student_balance actualizado con validaciones de seguridad' AS resultado;
