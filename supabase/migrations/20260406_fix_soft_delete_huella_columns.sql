-- ================================================================
-- FIX: Corregir columnas incorrectas en fn_soft_delete_product
--      y fn_soft_delete_combo al insertar en huella_digital_logs
--
-- Problema: el trigger usaba nombres en inglés (action, table_name,
--   record_id, performed_by, details, created_at) pero la tabla usa
--   nombres en español (accion, modulo, usuario_id, contexto, creado_at).
-- ================================================================

CREATE OR REPLACE FUNCTION fn_soft_delete_product()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Convertir DELETE en soft-delete (desactivar lógicamente)
  UPDATE products
  SET active    = false,
      is_active = false,
      updated_at = clock_timestamp()
  WHERE id = OLD.id;

  -- Registrar en huella_digital_logs con los nombres de columna correctos
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'huella_digital_logs'
  ) THEN
    INSERT INTO huella_digital_logs (
      accion, modulo, usuario_id, contexto, creado_at
    ) VALUES (
      'SOFT_DELETE_INTERCEPTED',
      'PRODUCTOS',
      auth.uid(),
      jsonb_build_object(
        'product_id',   OLD.id::text,
        'product_name', OLD.name,
        'reason',       'DELETE convertido a soft-delete'
      ),
      clock_timestamp()
    );
  END IF;

  RETURN NULL; -- Cancela el DELETE físico
END;
$$;

CREATE OR REPLACE FUNCTION fn_soft_delete_combo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE combos
  SET active    = false,
      is_active = false,
      updated_at = clock_timestamp()
  WHERE id = OLD.id;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'huella_digital_logs'
  ) THEN
    INSERT INTO huella_digital_logs (
      accion, modulo, usuario_id, contexto, creado_at
    ) VALUES (
      'SOFT_DELETE_INTERCEPTED',
      'PRODUCTOS',
      auth.uid(),
      jsonb_build_object(
        'combo_id',   OLD.id::text,
        'combo_name', OLD.name,
        'reason',     'DELETE convertido a soft-delete'
      ),
      clock_timestamp()
    );
  END IF;

  RETURN NULL;
END;
$$;

SELECT 'Fix huella_digital_logs columns ✅ — soft delete triggers corregidos' AS resultado;
