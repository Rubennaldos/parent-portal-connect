-- ============================================
-- SISTEMA COMPLETO DE REGISTRO DE PADRES
-- Base de datos para multisede con onboarding
-- ============================================

-- TABLA 1: schools (Colegios/Sedes)
-- ============================================
CREATE TABLE IF NOT EXISTS public.schools (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  code VARCHAR(50) UNIQUE NOT NULL,
  address TEXT,
  phone VARCHAR(20),
  email VARCHAR(200),
  warehouse_id UUID,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Insertar sedes de ejemplo
INSERT INTO public.schools (name, code, address, phone) VALUES
  ('Colegio A', 'colegio-a', 'Av. Ejemplo 123, Lima', '999888777'),
  ('Colegio B', 'colegio-b', 'Jr. Prueba 456, Lima', '999888666'),
  ('Colegio C', 'colegio-c', 'Calle Demo 789, Lima', '999888555')
ON CONFLICT (code) DO NOTHING;

-- TABLA 2: parent_profiles (Datos completos del padre)
-- ============================================
CREATE TABLE IF NOT EXISTS public.parent_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  school_id UUID REFERENCES public.schools(id),
  full_name VARCHAR(200) NOT NULL,
  dni VARCHAR(8) NOT NULL,
  address TEXT,
  phone_1 VARCHAR(15) NOT NULL,
  phone_2 VARCHAR(15),
  phone_1_verified BOOLEAN DEFAULT false,
  phone_2_verified BOOLEAN DEFAULT false,
  payment_responsible BOOLEAN DEFAULT true,
  terms_accepted_at TIMESTAMP,
  terms_version VARCHAR(20),
  onboarding_completed BOOLEAN DEFAULT false,
  approved_by_admin BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id),
  UNIQUE(dni)
);

-- TABLA 3: student_relationships (Relación familiar)
-- ============================================
CREATE TABLE IF NOT EXISTS public.student_relationships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.parent_profiles(user_id) ON DELETE CASCADE,
  relationship VARCHAR(50) NOT NULL,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(student_id, parent_id)
);

-- TABLA 4: allergies (Alergias)
-- ============================================
CREATE TABLE IF NOT EXISTS public.allergies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
  allergy_type VARCHAR(100) NOT NULL,
  severity VARCHAR(50),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- TABLA 5: daily_menu (Menú del día)
-- ============================================
CREATE TABLE IF NOT EXISTS public.daily_menu (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID REFERENCES public.schools(id),
  menu_date DATE NOT NULL,
  meal_type VARCHAR(50) NOT NULL,
  entry_dish VARCHAR(200),
  main_dish VARCHAR(200),
  dessert_or_drink VARCHAR(200),
  calories INTEGER,
  protein DECIMAL(5,2),
  carbs DECIMAL(5,2),
  fats DECIMAL(5,2),
  ingredients TEXT,
  allergen_warnings TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(school_id, menu_date, meal_type)
);

-- TABLA 6: terms_and_conditions (Términos firmados)
-- ============================================
CREATE TABLE IF NOT EXISTS public.terms_and_conditions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  version VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  accepted_at TIMESTAMP NOT NULL,
  ip_address VARCHAR(50),
  signature_data JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- TABLA 7: nutritional_tips (Tips nutricionales)
-- ============================================
CREATE TABLE IF NOT EXISTS public.nutritional_tips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  category VARCHAR(50),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Insertar tips de ejemplo
INSERT INTO public.nutritional_tips (title, content, category) VALUES
  ('Importancia del desayuno', 'El desayuno es la comida más importante del día. Ayuda a los niños a tener energía para sus actividades escolares.', 'general'),
  ('Hidratación adecuada', 'Los niños deben tomar al menos 6-8 vasos de agua al día para mantenerse hidratados.', 'hidratacion'),
  ('Consumo de frutas', 'Se recomienda que los niños consuman al menos 3 porciones de frutas al día.', 'frutas')
ON CONFLICT DO NOTHING;

-- ============================================
-- POLÍTICAS RLS
-- ============================================

-- Schools (públicas, todos pueden ver)
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Todos pueden ver colegios"
  ON public.schools FOR SELECT
  USING (true);

-- Parent profiles (solo el padre ve su propio perfil)
ALTER TABLE public.parent_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Padres ven su propio perfil"
  ON public.parent_profiles FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Padres crean su propio perfil"
  ON public.parent_profiles FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Padres actualizan su propio perfil"
  ON public.parent_profiles FOR UPDATE
  USING (user_id = auth.uid());

-- Staff ve todos los perfiles de padres
CREATE POLICY "Staff ve todos los padres"
  ON public.parent_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() 
      AND role IN ('superadmin', 'admin_general')
    )
  );

-- Relationships (solo el padre ve sus relaciones)
ALTER TABLE public.student_relationships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Padres ven sus relaciones"
  ON public.student_relationships FOR SELECT
  USING (parent_id = auth.uid());

CREATE POLICY "Padres crean sus relaciones"
  ON public.student_relationships FOR INSERT
  WITH CHECK (parent_id = auth.uid());

-- Allergies (padre ve alergias de sus hijos)
ALTER TABLE public.allergies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Padres ven alergias de sus hijos"
  ON public.allergies FOR SELECT
  USING (
    student_id IN (
      SELECT id FROM public.students WHERE parent_id = auth.uid()
    )
  );

CREATE POLICY "Padres crean alergias de sus hijos"
  ON public.allergies FOR INSERT
  WITH CHECK (
    student_id IN (
      SELECT id FROM public.students WHERE parent_id = auth.uid()
    )
  );

-- Daily menu (todos pueden ver)
ALTER TABLE public.daily_menu ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Todos pueden ver menú"
  ON public.daily_menu FOR SELECT
  USING (true);

CREATE POLICY "Staff crea menú"
  ON public.daily_menu FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() 
      AND role IN ('superadmin', 'admin_general')
    )
  );

-- Nutritional tips (todos pueden ver)
ALTER TABLE public.nutritional_tips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Todos pueden ver tips"
  ON public.nutritional_tips FOR SELECT
  USING (is_active = true);

-- Terms and conditions (cada usuario ve sus propios términos)
ALTER TABLE public.terms_and_conditions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Usuarios ven sus términos"
  ON public.terms_and_conditions FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Usuarios crean sus términos"
  ON public.terms_and_conditions FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- ============================================
-- ÍNDICES PARA PERFORMANCE
-- ============================================
CREATE INDEX IF NOT EXISTS idx_parent_profiles_user ON parent_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_parent_profiles_school ON parent_profiles(school_id);
CREATE INDEX IF NOT EXISTS idx_student_relationships_student ON student_relationships(student_id);
CREATE INDEX IF NOT EXISTS idx_student_relationships_parent ON student_relationships(parent_id);
CREATE INDEX IF NOT EXISTS idx_allergies_student ON allergies(student_id);
CREATE INDEX IF NOT EXISTS idx_daily_menu_date ON daily_menu(menu_date);
CREATE INDEX IF NOT EXISTS idx_daily_menu_school ON daily_menu(school_id);

-- ============================================
-- FUNCIÓN: Verificar onboarding completado
-- ============================================
CREATE OR REPLACE FUNCTION check_onboarding_status(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_onboarding_completed BOOLEAN;
BEGIN
  SELECT onboarding_completed INTO v_onboarding_completed
  FROM public.parent_profiles
  WHERE user_id = p_user_id;
  
  RETURN COALESCE(v_onboarding_completed, false);
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- VERIFICAR INSTALACIÓN
-- ============================================
SELECT 
  'Tablas creadas:' as info,
  COUNT(*) as total
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN (
    'schools', 
    'parent_profiles', 
    'student_relationships', 
    'allergies', 
    'daily_menu', 
    'terms_and_conditions',
    'nutritional_tips'
  );

-- Ver colegios creados
SELECT '=== COLEGIOS ===' as info, id, name, code FROM public.schools;

-- ✅ Si ves 7 tablas y 3 colegios, está todo listo!


