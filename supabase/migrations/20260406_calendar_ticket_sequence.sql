-- =====================================================================
-- TICKETS T-CAL- PARA PEDIDOS DEL CALENDARIO DEL PADRE/MADRE
--
-- Problema: Los pedidos automáticos del calendario del padre no tenían
-- un número de ticket propio. Usaban el prefijo de iniciales del padre
-- (ej: T-AN-000001), mezclándose visualmente con las ventas del kiosco.
--
-- Solución: Una secuencia global exclusiva para el calendario.
-- Cada pedido del calendario recibe T-CAL-000001, T-CAL-000002, etc.
-- La secuencia de PostgreSQL garantiza unicidad sin locks adicionales.
-- =====================================================================

-- PASO 1: Crear la secuencia global del calendario
-- Si ya existe (por doble ejecución), no falla.
CREATE SEQUENCE IF NOT EXISTS cal_ticket_seq
  START WITH 1
  INCREMENT BY 1
  NO CYCLE;

-- PASO 2: Función sin parámetros que devuelve el siguiente T-CAL-
CREATE OR REPLACE FUNCTION get_next_calendar_ticket()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_number BIGINT;
BEGIN
  -- nextval() es atómico: dos llamadas simultáneas NUNCA obtienen el mismo número
  v_number := nextval('cal_ticket_seq');
  RETURN 'T-CAL-' || LPAD(v_number::TEXT, 6, '0');
END;
$$;

-- PASO 3: Permisos — solo usuarios autenticados (padres) pueden llamarla
GRANT EXECUTE ON FUNCTION get_next_calendar_ticket() TO authenticated;
GRANT USAGE ON SEQUENCE cal_ticket_seq TO authenticated;

-- PASO 4: Verificar que funciona
SELECT
  get_next_calendar_ticket() AS ticket_1,
  get_next_calendar_ticket() AS ticket_2,
  get_next_calendar_ticket() AS ticket_3;

-- Esperado: T-CAL-000001 | T-CAL-000002 | T-CAL-000003
-- (o el número donde esté la secuencia si ya existía)

SELECT '✅ Secuencia T-CAL- creada y función get_next_calendar_ticket() lista' AS status;
