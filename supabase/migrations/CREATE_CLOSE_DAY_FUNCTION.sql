-- ============================================
-- FUNCIÓN PARA CERRAR EL DÍA AUTOMÁTICAMENTE
-- ============================================

CREATE OR REPLACE FUNCTION close_lunch_day(p_school_id UUID, p_date DATE)
RETURNS TABLE (
  updated_orders INTEGER,
  message TEXT
) AS $$
DECLARE
  v_updated INTEGER := 0;
BEGIN
  -- Marcar como "delivered" todos los pedidos "confirmed" del día especificado
  UPDATE public.lunch_orders
  SET 
    status = 'delivered',
    delivered_at = NOW()
  WHERE 
    order_date = p_date
    AND status = 'confirmed'
    AND student_id IN (
      SELECT id 
      FROM public.students 
      WHERE school_id = p_school_id
    );
  
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  
  RETURN QUERY SELECT v_updated, 'Día cerrado exitosamente. ' || v_updated || ' pedidos marcados como entregados.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comentario
COMMENT ON FUNCTION close_lunch_day IS 'Cierra el día de almuerzos marcando todos los pedidos "confirmed" como "delivered"';

-- Dar permisos
GRANT EXECUTE ON FUNCTION close_lunch_day TO authenticated;
