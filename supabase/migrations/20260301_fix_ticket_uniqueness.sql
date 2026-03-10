-- ============================================================================
-- FIX: CORRELATIVOS DE TICKETS DUPLICADOS
-- ============================================================================
-- Problema: Dos padres con las mismas iniciales (ej: "AN") obtienen
-- el mismo prefijo "T-AN-" y generan tickets duplicados.
--
-- Solución: 
-- 1. Corregir prefijos duplicados existentes
-- 2. Actualizar generate_user_prefix() con verificación de unicidad
-- ============================================================================

-- PASO 1: Corregir prefijos duplicados existentes
-- Agrega un sufijo numérico al segundo (y posteriores) usuario con el mismo prefijo
DO $$
DECLARE
  dup_prefix TEXT;
  dup_row RECORD;
  v_counter INTEGER;
  v_base TEXT;
  v_new_prefix TEXT;
BEGIN
  -- Encontrar prefijos duplicados
  FOR dup_prefix IN 
    SELECT prefix FROM ticket_sequences 
    GROUP BY prefix HAVING COUNT(*) > 1
  LOOP
    v_counter := 2;
    -- Mantener el primero (más antiguo), renombrar los demás
    FOR dup_row IN 
      SELECT profile_id FROM ticket_sequences 
      WHERE prefix = dup_prefix
      ORDER BY COALESCE(created_at, '2000-01-01'::timestamptz) ASC
      OFFSET 1 -- saltar el primero
    LOOP
      -- Extraer las iniciales del prefijo original: "T-AN-" -> "AN"
      v_base := replace(replace(dup_prefix, 'T-', ''), '-', '');
      v_new_prefix := 'T-' || v_base || v_counter::TEXT || '-';
      
      RAISE NOTICE 'Corrigiendo prefijo duplicado: % -> % (profile: %)', 
        dup_prefix, v_new_prefix, dup_row.profile_id;
      
      UPDATE ticket_sequences 
      SET prefix = v_new_prefix
      WHERE profile_id = dup_row.profile_id;
      
      v_counter := v_counter + 1;
    END LOOP;
  END LOOP;
END $$;

-- PASO 2: Actualizar generate_user_prefix con verificación de unicidad
CREATE OR REPLACE FUNCTION generate_user_prefix(p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_full_name TEXT;
  v_email TEXT;
  v_base_initials TEXT;
  v_candidate TEXT;
  v_suffix INTEGER := 0;
  v_exists BOOLEAN;
  v_existing_prefix TEXT;
BEGIN
  -- Si ya tiene un prefijo asignado, devolverlo
  SELECT prefix INTO v_existing_prefix
  FROM ticket_sequences
  WHERE profile_id = p_user_id;
  
  IF FOUND AND v_existing_prefix IS NOT NULL THEN
    RETURN v_existing_prefix;
  END IF;

  -- Obtener datos del usuario
  SELECT full_name, email INTO v_full_name, v_email
  FROM profiles
  WHERE id = p_user_id;
  
  -- Generar iniciales base (hasta 3 iniciales)
  IF v_full_name IS NOT NULL AND trim(v_full_name) != '' THEN
    SELECT string_agg(upper(substring(word, 1, 1)), '')
    INTO v_base_initials
    FROM (
      SELECT word 
      FROM unnest(string_to_array(trim(v_full_name), ' ')) AS word 
      WHERE word != '' 
      LIMIT 3
    ) t;
  ELSE
    -- Fallback: primeras 3 letras del email
    v_base_initials := upper(substring(split_part(COALESCE(v_email, 'XX'), '@', 1), 1, 3));
  END IF;
  
  -- Verificar unicidad del prefijo
  v_candidate := 'T-' || v_base_initials || '-';
  
  LOOP
    SELECT EXISTS(
      SELECT 1 FROM ticket_sequences 
      WHERE prefix = v_candidate 
      AND profile_id != p_user_id
    ) INTO v_exists;
    
    EXIT WHEN NOT v_exists;
    
    v_suffix := v_suffix + 1;
    v_candidate := 'T-' || v_base_initials || v_suffix::TEXT || '-';
  END LOOP;
  
  RETURN v_candidate;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- PASO 3: Actualizar get_next_ticket_number para usar la nueva lógica
CREATE OR REPLACE FUNCTION get_next_ticket_number(p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_number INTEGER;
  v_prefix TEXT;
  v_ticket_number TEXT;
BEGIN
  -- Obtener prefijo existente
  SELECT prefix INTO v_prefix
  FROM ticket_sequences
  WHERE profile_id = p_user_id;
  
  -- Si no existe, generar prefijo personalizado ÚNICO
  IF NOT FOUND THEN
    v_prefix := generate_user_prefix(p_user_id);
    
    INSERT INTO ticket_sequences (profile_id, current_number, prefix)
    VALUES (p_user_id, 1, v_prefix)
    RETURNING current_number INTO v_number;
  ELSE
    -- Incrementar contador atómicamente
    UPDATE ticket_sequences
    SET 
      current_number = current_number + 1,
      updated_at = NOW()
    WHERE profile_id = p_user_id
    RETURNING current_number INTO v_number;
  END IF;
  
  -- Formatear número (ej: T-AG-000001)
  v_ticket_number := v_prefix || LPAD(v_number::TEXT, 6, '0');
  
  RETURN v_ticket_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Permisos
GRANT EXECUTE ON FUNCTION generate_user_prefix TO authenticated;
GRANT EXECUTE ON FUNCTION get_next_ticket_number TO authenticated;

-- Verificar resultados
SELECT '✅ Función de tickets actualizada con verificación de unicidad' as status;

-- Mostrar prefijos actuales (verificar que no hay duplicados)
SELECT 
  ts.prefix,
  COUNT(*) as usuarios,
  string_agg(COALESCE(p.full_name, p.email, 'Sin nombre'), ', ') as nombres
FROM ticket_sequences ts
LEFT JOIN profiles p ON p.id = ts.profile_id
GROUP BY ts.prefix
ORDER BY COUNT(*) DESC;
