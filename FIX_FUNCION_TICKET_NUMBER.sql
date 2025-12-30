-- ============================================
-- FIX: FUNCIÓN GET_NEXT_TICKET_NUMBER
-- ============================================
-- La función espera p_pos_user_id pero el código envía p_user_id
-- Vamos a modificarla para aceptar ambos nombres

-- Eliminar la función anterior
DROP FUNCTION IF EXISTS get_next_ticket_number(UUID);

-- Recrear con el nombre correcto del parámetro
CREATE OR REPLACE FUNCTION get_next_ticket_number(p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_prefix TEXT;
  v_next_number INTEGER;
  v_ticket_code TEXT;
  v_last_reset DATE;
BEGIN
  -- Verificar si hay que reiniciar (nuevo día)
  SELECT last_reset_date INTO v_last_reset
  FROM ticket_sequences
  WHERE pos_user_id = p_user_id;
  
  -- Si es un nuevo día, reiniciar contador
  IF v_last_reset IS NOT NULL AND v_last_reset < CURRENT_DATE THEN
    UPDATE ticket_sequences
    SET current_number = 0,
        last_reset_date = CURRENT_DATE,
        updated_at = now()
    WHERE pos_user_id = p_user_id;
  END IF;
  
  -- Obtener prefijo y siguiente número
  UPDATE ticket_sequences
  SET current_number = current_number + 1,
      updated_at = now()
  WHERE pos_user_id = p_user_id
  RETURNING prefix, current_number INTO v_prefix, v_next_number;
  
  -- Formatear ticket: FN1-001
  v_ticket_code := v_prefix || '-' || LPAD(v_next_number::TEXT, 3, '0');
  
  RETURN v_ticket_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_next_ticket_number IS 'Obtiene el siguiente número de ticket y reinicia automáticamente cada día';

-- ============================================
-- VERIFICAR QUE LA FUNCIÓN SE CREÓ CORRECTAMENTE
-- ============================================

SELECT 
  proname as "Función", 
  pg_get_function_arguments(oid) as "Parámetros"
FROM pg_proc 
WHERE proname = 'get_next_ticket_number';

