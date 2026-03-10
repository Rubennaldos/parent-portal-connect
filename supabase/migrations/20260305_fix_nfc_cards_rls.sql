-- ═══════════════════════════════════════════════════════════
-- FIX: RLS de nfc_cards — admin_general sin school_id
--
-- Problema: admin_general no tiene school_id en su perfil,
-- por lo que p.school_id = nfc_cards.school_id falla (NULL ≠ UUID).
-- Fix: admin_general accede a TODAS las sedes.
-- ═══════════════════════════════════════════════════════════

-- Eliminar políticas actuales
DROP POLICY IF EXISTS "nfc_superadmin_all" ON nfc_cards;
DROP POLICY IF EXISTS "nfc_admin_manage"   ON nfc_cards;
DROP POLICY IF EXISTS "nfc_cajero_read"    ON nfc_cards;

-- 1. Superadmin: acceso total
CREATE POLICY "nfc_superadmin_all" ON nfc_cards
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'superadmin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'superadmin'
    )
  );

-- 2. Admin General: gestión completa de TODAS las sedes
--    Gestor de Unidad: gestión completa solo de SU sede
CREATE POLICY "nfc_admin_manage" ON nfc_cards
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role = 'admin_general'
          OR (p.role = 'gestor_unidad' AND p.school_id = nfc_cards.school_id)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role = 'admin_general'
          OR (p.role = 'gestor_unidad' AND p.school_id = nfc_cards.school_id)
        )
    )
  );

-- 3. Operador de Caja: solo lectura de tarjetas de su sede
CREATE POLICY "nfc_cajero_read" ON nfc_cards
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'operador_caja'
        AND p.school_id = nfc_cards.school_id
    )
  );
