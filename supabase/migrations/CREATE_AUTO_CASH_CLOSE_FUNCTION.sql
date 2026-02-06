-- 🤖 FUNCIÓN: Cierre Automático de Caja
-- Se ejecuta automáticamente a la hora configurada

CREATE OR REPLACE FUNCTION auto_close_cash_registers()
RETURNS void AS $$
DECLARE
  v_config RECORD;
  v_register RECORD;
  v_closure_id UUID;
  v_daily_totals JSON;
BEGIN
  -- Recorrer todas las configuraciones con cierre automático habilitado
  FOR v_config IN
    SELECT * FROM cash_register_config
    WHERE auto_close_enabled = true
      AND auto_close_time <= CURRENT_TIME
  LOOP
    -- Buscar cajas abiertas de esa sede
    FOR v_register IN
      SELECT * FROM cash_registers
      WHERE school_id = v_config.school_id
        AND status = 'open'
        AND DATE(opened_at) < CURRENT_DATE -- Solo las de días anteriores
    LOOP
      -- Calcular totales del día
      v_daily_totals := calculate_daily_totals(
        v_register.school_id,
        DATE(v_register.opened_at)
      );
      
      -- Crear el cierre
      INSERT INTO cash_closures (
        cash_register_id,
        school_id,
        closure_date,
        
        -- POS
        pos_cash,
        pos_card,
        pos_yape,
        pos_yape_qr,
        pos_credit,
        pos_mixed_cash,
        pos_mixed_card,
        pos_mixed_yape,
        pos_total,
        
        -- Lunch
        lunch_cash,
        lunch_credit,
        lunch_card,
        lunch_yape,
        lunch_total,
        
        -- Totales
        total_cash,
        total_card,
        total_yape,
        total_yape_qr,
        total_credit,
        total_sales,
        
        -- Movimientos
        total_ingresos,
        total_egresos,
        
        -- Caja
        initial_amount,
        expected_final,
        actual_final,
        difference,
        
        closed_by,
        whatsapp_phone
      )
      SELECT
        v_register.id,
        v_register.school_id,
        DATE(v_register.opened_at),
        
        -- POS
        (v_daily_totals->'pos'->>'cash')::DECIMAL,
        (v_daily_totals->'pos'->>'card')::DECIMAL,
        (v_daily_totals->'pos'->>'yape')::DECIMAL,
        (v_daily_totals->'pos'->>'yape_qr')::DECIMAL,
        (v_daily_totals->'pos'->>'credit')::DECIMAL,
        (v_daily_totals->'pos'->>'mixed_cash')::DECIMAL,
        (v_daily_totals->'pos'->>'mixed_card')::DECIMAL,
        (v_daily_totals->'pos'->>'mixed_yape')::DECIMAL,
        (v_daily_totals->'pos'->>'total')::DECIMAL,
        
        -- Lunch
        (v_daily_totals->'lunch'->>'cash')::DECIMAL,
        (v_daily_totals->'lunch'->>'credit')::DECIMAL,
        (v_daily_totals->'lunch'->>'card')::DECIMAL,
        (v_daily_totals->'lunch'->>'yape')::DECIMAL,
        (v_daily_totals->'lunch'->>'total')::DECIMAL,
        
        -- Totales
        (v_daily_totals->'pos'->>'cash')::DECIMAL + 
        (v_daily_totals->'pos'->>'mixed_cash')::DECIMAL + 
        (v_daily_totals->'lunch'->>'cash')::DECIMAL,
        
        (v_daily_totals->'pos'->>'card')::DECIMAL + 
        (v_daily_totals->'pos'->>'mixed_card')::DECIMAL + 
        (v_daily_totals->'lunch'->>'card')::DECIMAL,
        
        (v_daily_totals->'pos'->>'yape')::DECIMAL + 
        (v_daily_totals->'pos'->>'mixed_yape')::DECIMAL + 
        (v_daily_totals->'lunch'->>'yape')::DECIMAL,
        
        (v_daily_totals->'pos'->>'yape_qr')::DECIMAL,
        
        (v_daily_totals->'pos'->>'credit')::DECIMAL + 
        (v_daily_totals->'lunch'->>'credit')::DECIMAL,
        
        (v_daily_totals->'pos'->>'total')::DECIMAL + 
        (v_daily_totals->'lunch'->>'total')::DECIMAL,
        
        -- Movimientos
        COALESCE((
          SELECT SUM(amount) FROM cash_movements
          WHERE cash_register_id = v_register.id AND type = 'ingreso'
        ), 0),
        COALESCE((
          SELECT SUM(amount) FROM cash_movements
          WHERE cash_register_id = v_register.id AND type = 'egreso'
        ), 0),
        
        -- Caja
        v_register.initial_amount,
        v_register.initial_amount + 
        (v_daily_totals->'pos'->>'cash')::DECIMAL + 
        (v_daily_totals->'pos'->>'mixed_cash')::DECIMAL + 
        (v_daily_totals->'lunch'->>'cash')::DECIMAL +
        COALESCE((SELECT SUM(amount) FROM cash_movements WHERE cash_register_id = v_register.id AND type = 'ingreso'), 0) -
        COALESCE((SELECT SUM(amount) FROM cash_movements WHERE cash_register_id = v_register.id AND type = 'egreso'), 0),
        NULL, -- actual_final (no sabemos porque es auto)
        NULL, -- difference
        
        v_register.opened_by, -- Cerrado por el mismo que abrió
        v_config.whatsapp_phone
      RETURNING id INTO v_closure_id;
      
      -- Actualizar el registro como cerrado
      UPDATE cash_registers
      SET
        status = 'closed',
        closed_at = NOW(),
        closed_by = v_register.opened_by
      WHERE id = v_register.id;
      
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comentario
COMMENT ON FUNCTION auto_close_cash_registers IS 'Cierra automáticamente las cajas abiertas según configuración de hora';

-- Nota: Para ejecutar esto automáticamente, necesitas configurar un cron job
-- Por ejemplo, con pg_cron (extensión de PostgreSQL):
-- SELECT cron.schedule('auto-close-cash', '0 * * * *', 'SELECT auto_close_cash_registers()');
