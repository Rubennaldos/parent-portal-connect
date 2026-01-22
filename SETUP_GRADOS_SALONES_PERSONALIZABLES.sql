-- =============================================
-- SISTEMA DE GRADOS Y SALONES PERSONALIZABLES
-- =============================================

-- 1. TABLA: school_levels (Niveles/Grados por sede)
CREATE TABLE IF NOT EXISTS public.school_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL, -- Ej: "1er Grado", "Sala Azul", "Nivel A"
  order_index INTEGER NOT NULL DEFAULT 0, -- Para ordenar
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (school_id, name) -- No puede haber nombres duplicados en la misma sede
);

-- 2. TABLA: school_classrooms (Aulas/Secciones por nivel y sede)
CREATE TABLE IF NOT EXISTS public.school_classrooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  level_id UUID NOT NULL REFERENCES public.school_levels(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL, -- Ej: "Sección A", "Leones", "Amarillo"
  order_index INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (school_id, level_id, name) -- No puede haber nombres duplicados en el mismo nivel
);

-- 3. AGREGAR REFERENCIAS A TABLA STUDENTS
ALTER TABLE public.students 
ADD COLUMN IF NOT EXISTS level_id UUID REFERENCES public.school_levels(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS classroom_id UUID REFERENCES public.school_classrooms(id) ON DELETE SET NULL;

-- 4. ÍNDICES para rendimiento
CREATE INDEX IF NOT EXISTS idx_school_levels_school ON school_levels(school_id);
CREATE INDEX IF NOT EXISTS idx_school_levels_order ON school_levels(school_id, order_index);
CREATE INDEX IF NOT EXISTS idx_school_classrooms_school ON school_classrooms(school_id);
CREATE INDEX IF NOT EXISTS idx_school_classrooms_level ON school_classrooms(level_id);
CREATE INDEX IF NOT EXISTS idx_students_level ON students(level_id);
CREATE INDEX IF NOT EXISTS idx_students_classroom ON students(classroom_id);

-- 5. TRIGGERS para updated_at
CREATE OR REPLACE FUNCTION update_school_levels_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_school_levels_updated_at ON school_levels;
CREATE TRIGGER trigger_update_school_levels_updated_at
BEFORE UPDATE ON school_levels
FOR EACH ROW
EXECUTE FUNCTION update_school_levels_updated_at();

CREATE OR REPLACE FUNCTION update_school_classrooms_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_school_classrooms_updated_at ON school_classrooms;
CREATE TRIGGER trigger_update_school_classrooms_updated_at
BEFORE UPDATE ON school_classrooms
FOR EACH ROW
EXECUTE FUNCTION update_school_classrooms_updated_at();

-- 6. RLS (Row Level Security)
ALTER TABLE school_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_classrooms ENABLE ROW LEVEL SECURITY;

-- Políticas para school_levels
DROP POLICY IF EXISTS "users_view_own_school_levels" ON school_levels;
CREATE POLICY "users_view_own_school_levels"
ON school_levels FOR SELECT
TO authenticated
USING (
  school_id IN (
    SELECT school_id FROM profiles WHERE id = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role IN ('admin_general', 'supervisor_red')
  )
);

DROP POLICY IF EXISTS "admins_manage_school_levels" ON school_levels;
CREATE POLICY "admins_manage_school_levels"
ON school_levels FOR ALL
TO authenticated
USING (
  school_id IN (
    SELECT school_id FROM profiles WHERE id = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role IN ('admin_general', 'supervisor_red')
  )
);

-- Políticas para school_classrooms
DROP POLICY IF EXISTS "users_view_own_school_classrooms" ON school_classrooms;
CREATE POLICY "users_view_own_school_classrooms"
ON school_classrooms FOR SELECT
TO authenticated
USING (
  school_id IN (
    SELECT school_id FROM profiles WHERE id = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role IN ('admin_general', 'supervisor_red')
  )
);

DROP POLICY IF EXISTS "admins_manage_school_classrooms" ON school_classrooms;
CREATE POLICY "admins_manage_school_classrooms"
ON school_classrooms FOR ALL
TO authenticated
USING (
  school_id IN (
    SELECT school_id FROM profiles WHERE id = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role IN ('admin_general', 'supervisor_red')
  )
);

-- 7. FUNCIÓN: Migrar datos existentes de students
CREATE OR REPLACE FUNCTION migrate_student_grades_to_levels()
RETURNS void AS $$
DECLARE
  v_school RECORD;
  v_grade TEXT;
  v_section TEXT;
  v_level_id UUID;
  v_classroom_id UUID;
BEGIN
  -- Para cada sede
  FOR v_school IN SELECT id, name FROM schools WHERE is_active = true
  LOOP
    RAISE NOTICE 'Procesando sede: %', v_school.name;
    
    -- Obtener grados únicos de esta sede
    FOR v_grade IN 
      SELECT DISTINCT grade 
      FROM students 
      WHERE school_id = v_school.id 
      AND grade IS NOT NULL 
      AND level_id IS NULL
    LOOP
      -- Crear nivel si no existe
      INSERT INTO school_levels (school_id, name, order_index)
      VALUES (v_school.id, v_grade, 0)
      ON CONFLICT (school_id, name) DO NOTHING
      RETURNING id INTO v_level_id;
      
      -- Si no se insertó (ya existía), obtener el id
      IF v_level_id IS NULL THEN
        SELECT id INTO v_level_id 
        FROM school_levels 
        WHERE school_id = v_school.id AND name = v_grade;
      END IF;
      
      -- Para cada sección en este grado
      FOR v_section IN 
        SELECT DISTINCT section 
        FROM students 
        WHERE school_id = v_school.id 
        AND grade = v_grade 
        AND section IS NOT NULL
        AND classroom_id IS NULL
      LOOP
        -- Crear aula si no existe
        INSERT INTO school_classrooms (school_id, level_id, name, order_index)
        VALUES (v_school.id, v_level_id, v_section, 0)
        ON CONFLICT (school_id, level_id, name) DO NOTHING
        RETURNING id INTO v_classroom_id;
        
        IF v_classroom_id IS NULL THEN
          SELECT id INTO v_classroom_id 
          FROM school_classrooms 
          WHERE school_id = v_school.id 
          AND level_id = v_level_id 
          AND name = v_section;
        END IF;
        
        -- Actualizar estudiantes
        UPDATE students 
        SET level_id = v_level_id, classroom_id = v_classroom_id
        WHERE school_id = v_school.id 
        AND grade = v_grade 
        AND section = v_section
        AND level_id IS NULL;
        
        RAISE NOTICE '  - Migrado: % - % (% estudiantes)', v_grade, v_section, 
          (SELECT COUNT(*) FROM students WHERE classroom_id = v_classroom_id);
      END LOOP;
    END LOOP;
  END LOOP;
  
  RAISE NOTICE '✅ Migración completada';
END;
$$ LANGUAGE plpgsql;

-- 8. COMENTARIOS de documentación
COMMENT ON TABLE school_levels IS 'Niveles/Grados personalizables por cada sede (Ej: 1er Grado, Sala Azul, Nivel A)';
COMMENT ON TABLE school_classrooms IS 'Aulas/Secciones personalizables por nivel y sede (Ej: Sección A, Leones, Amarillo)';
COMMENT ON FUNCTION migrate_student_grades_to_levels IS 'Migra los datos existentes de grade/section a level_id/classroom_id';

-- 9. VERIFICACIÓN
SELECT '✅ Tablas de grados y salones creadas correctamente' AS status;
SELECT 'ℹ️  Para migrar datos existentes, ejecuta: SELECT migrate_student_grades_to_levels();' AS info;
