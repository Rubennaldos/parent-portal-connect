-- ============================================
-- FIX COMPLETO: ASIGNAR COLEGIOS Y CREAR SECUENCIAS
-- ============================================

-- PASO 1: ASIGNAR UN COLEGIO POR DEFECTO A TODOS LOS PADRES SIN COLEGIO
-- (Usaremos el primer colegio disponible como default)

DO $$
DECLARE
  v_default_school_id UUID;
BEGIN
  -- Obtener el ID del primer colegio (Naciones Unidas - Sede Principal)
  SELECT id INTO v_default_school_id
  FROM schools
  WHERE code = 'NRD'
  LIMIT 1;
  
  -- Si no existe, usar el primer colegio que encuentre
  IF v_default_school_id IS NULL THEN
    SELECT id INTO v_default_school_id
    FROM schools
    LIMIT 1;
  END IF;
  
  -- Actualizar padres sin colegio
  UPDATE profiles
  SET school_id = v_default_school_id
  WHERE role = 'parent' 
    AND school_id IS NULL;
    
  RAISE NOTICE 'Padres actualizados con school_id: %', v_default_school_id;
END $$;

-- PASO 2: ASIGNAR COLEGIO A ESTUDIANTES BASÁNDOSE EN EL COLEGIO DE SU PADRE

UPDATE students st
SET school_id = pr.school_id
FROM profiles pr
WHERE st.parent_id = pr.id
  AND st.school_id IS NULL
  AND pr.school_id IS NOT NULL;

-- PASO 3: SI AÚN HAY ESTUDIANTES SIN COLEGIO, ASIGNARLES EL DEFAULT

DO $$
DECLARE
  v_default_school_id UUID;
BEGIN
  SELECT id INTO v_default_school_id
  FROM schools
  WHERE code = 'NRD'
  LIMIT 1;
  
  IF v_default_school_id IS NULL THEN
    SELECT id INTO v_default_school_id
    FROM schools
    LIMIT 1;
  END IF;
  
  UPDATE students
  SET school_id = v_default_school_id
  WHERE school_id IS NULL;
END $$;

-- PASO 4: VERIFICAR Y ARREGLAR USUARIOS POS SIN SCHOOL_ID

DO $$
DECLARE
  v_default_school_id UUID;
BEGIN
  SELECT id INTO v_default_school_id
  FROM schools
  WHERE code = 'NRD'
  LIMIT 1;
  
  IF v_default_school_id IS NULL THEN
    SELECT id INTO v_default_school_id
    FROM schools
    LIMIT 1;
  END IF;
  
  UPDATE profiles
  SET school_id = v_default_school_id
  WHERE role = 'pos' 
    AND school_id IS NULL;
END $$;

-- PASO 5: ASIGNAR POS_NUMBER Y TICKET_PREFIX A USUARIOS POS QUE NO LO TIENEN

DO $$
DECLARE
  pos_record RECORD;
  v_prefix_base TEXT;
  v_pos_number INTEGER;
  v_ticket_prefix TEXT;
BEGIN
  FOR pos_record IN 
    SELECT p.id, p.school_id
    FROM profiles p
    WHERE p.role = 'pos' 
      AND (p.pos_number IS NULL OR p.ticket_prefix IS NULL)
      AND p.school_id IS NOT NULL
  LOOP
    -- Obtener el siguiente número POS para esta sede
    SELECT COALESCE(MAX(pos_number), 0) + 1
    INTO v_pos_number
    FROM profiles
    WHERE school_id = pos_record.school_id
      AND role = 'pos'
      AND pos_number IS NOT NULL;
    
    -- Si excede 3, usar 1
    IF v_pos_number > 3 THEN
      v_pos_number := 1;
    END IF;
    
    -- Obtener prefijo base de la sede
    SELECT prefix_base INTO v_prefix_base
    FROM school_prefixes
    WHERE school_id = pos_record.school_id;
    
    -- Si no hay prefijo, usar 'F'
    IF v_prefix_base IS NULL THEN
      v_prefix_base := 'F';
    END IF;
    
    -- Generar ticket_prefix completo
    v_ticket_prefix := v_prefix_base || v_pos_number;
    
    -- Actualizar el usuario POS
    UPDATE profiles
    SET pos_number = v_pos_number,
        ticket_prefix = v_ticket_prefix
    WHERE id = pos_record.id;
    
    RAISE NOTICE 'POS actualizado: % - pos_number: %, ticket_prefix: %', 
      pos_record.id, v_pos_number, v_ticket_prefix;
  END LOOP;
END $$;

-- PASO 6: CREAR SECUENCIAS DE TICKETS PARA USUARIOS POS QUE NO LAS TIENEN

INSERT INTO ticket_sequences (school_id, pos_user_id, prefix, current_number, last_reset_date)
SELECT 
  p.school_id,
  p.id,
  p.ticket_prefix,
  0,
  CURRENT_DATE
FROM profiles p
WHERE p.role = 'pos'
  AND p.school_id IS NOT NULL
  AND p.ticket_prefix IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM ticket_sequences ts
    WHERE ts.pos_user_id = p.id
  );

-- ============================================
-- VERIFICACIÓN FINAL
-- ============================================

-- Ver estado de usuarios POS
SELECT 
  p.email,
  p.full_name,
  s.name as "Colegio",
  p.pos_number,
  p.ticket_prefix,
  CASE 
    WHEN ts.id IS NOT NULL THEN '✅ Con Secuencia'
    ELSE '❌ Sin Secuencia'
  END as "Estado Secuencia"
FROM profiles p
LEFT JOIN schools s ON s.id = p.school_id
LEFT JOIN ticket_sequences ts ON ts.pos_user_id = p.id
WHERE p.role = 'pos';

-- Ver estado de estudiantes
SELECT 
  COUNT(*) as "Total Estudiantes",
  COUNT(school_id) as "Con Colegio",
  COUNT(*) - COUNT(school_id) as "Sin Colegio",
  CASE 
    WHEN COUNT(*) - COUNT(school_id) = 0 THEN '✅ TODOS CON COLEGIO'
    ELSE '❌ HAY ESTUDIANTES SIN COLEGIO'
  END as "Estado"
FROM students;

-- Ver estado de padres
SELECT 
  COUNT(*) as "Total Padres",
  COUNT(school_id) as "Con Colegio",
  COUNT(*) - COUNT(school_id) as "Sin Colegio",
  CASE 
    WHEN COUNT(*) - COUNT(school_id) = 0 THEN '✅ TODOS CON COLEGIO'
    ELSE '❌ HAY PADRES SIN COLEGIO'
  END as "Estado"
FROM profiles
WHERE role = 'parent';

-- ============================================
-- ✅ SCRIPT COMPLETADO
-- ============================================

/*
ESTE SCRIPT HACE LO SIGUIENTE:

1. Asigna un colegio por defecto a todos los padres sin colegio
2. Asigna el colegio del padre a sus hijos estudiantes
3. Asigna colegio a estudiantes huérfanos que no tengan
4. Asigna colegio a usuarios POS que no tengan
5. Asigna pos_number y ticket_prefix a usuarios POS que no tengan
6. Crea las secuencias de tickets faltantes
7. Verifica que todo quedó correcto

DESPUÉS DE EJECUTAR ESTE SCRIPT:
- Todos los usuarios tendrán school_id
- Todos los usuarios POS tendrán pos_number y ticket_prefix
- Todos los usuarios POS tendrán su secuencia en ticket_sequences
- El módulo POS debería funcionar correctamente
*/

