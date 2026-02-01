-- Agregar columna school_id a la tabla combos
-- Para permitir filtrado de combos por sede en el POS

ALTER TABLE public.combos
ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES public.schools(id);

-- Crear índice para mejorar performance
CREATE INDEX IF NOT EXISTS idx_combos_school_id ON public.combos(school_id);

-- Comentario
COMMENT ON COLUMN public.combos.school_id IS 'Sede a la que pertenece el combo para filtrado multisede';

-- Verificar que se agregó correctamente
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'combos' AND column_name = 'school_id';

-- Ver combos actuales
SELECT 
  id,
  name,
  school_id,
  created_at
FROM public.combos
ORDER BY created_at DESC
LIMIT 10;
