-- =====================================================
-- ELIMINAR TRANSACCIÓN SOSPECHOSA HUÉRFANA
-- =====================================================
-- Fecha: 2026-02-11
-- Resultado del análisis DETECT_REAL_VS_FAKE_TRANSACTIONS.sql:
-- - 184 transacciones REALES (tienen pedido de almuerzo)
-- - 1 transacción REAL (creada por el profesor)
-- - 43 transacciones de VENTA DE COCINA (creadas por admin/cajero) = REALES
-- - Solo 1 transacción SOSPECHOSA confirmada
-- =====================================================

-- VERIFICAR ANTES DE ELIMINAR
SELECT 
    t.id,
    p.full_name as profesor,
    s.name as sede,
    t.created_at,
    t.amount,
    t.description,
    t.created_by,
    t.payment_status
FROM transactions t
JOIN profiles p ON t.teacher_id = p.id
JOIN schools s ON p.school_id = s.id
WHERE t.id = 'a5f454f7-721e-47bd-b618-e65d5df429f3';

-- ELIMINAR LA TRANSACCIÓN SOSPECHOSA
-- Andrea Chávez - Nordic - "Almuerzo - 3 de febrero" - S/15.00
-- Sin created_by, sin lunch_order asociado
DELETE FROM transactions 
WHERE id = 'a5f454f7-721e-47bd-b618-e65d5df429f3';

-- VERIFICAR: También buscar la segunda sospechosa que apareció en el resumen
-- (la diferencia entre 2 en PASO 2 y 1 en PASO 3)
SELECT 
    t.id,
    p.full_name as profesor,
    s.name as sede,
    t.created_at,
    t.amount,
    t.description,
    t.created_by
FROM transactions t
JOIN profiles p ON t.teacher_id = p.id
JOIN schools s ON p.school_id = s.id
WHERE t.payment_status = 'pending'
  AND t.type = 'purchase'
  AND t.teacher_id IS NOT NULL
  AND t.created_by IS NULL
  AND t.description ILIKE '%almuerzo%'
  AND NOT EXISTS (
      SELECT 1 FROM lunch_orders lo
      WHERE lo.teacher_id = t.teacher_id
        AND ABS(EXTRACT(EPOCH FROM (lo.created_at - t.created_at))) < 86400
  );

-- RESUMEN FINAL: Contar transacciones pendientes restantes por sede
SELECT 
    s.name as sede,
    COUNT(*) as transacciones_pendientes,
    SUM(ABS(t.amount)) as deuda_total
FROM transactions t
JOIN profiles p ON t.teacher_id = p.id
JOIN schools s ON p.school_id = s.id
WHERE t.payment_status = 'pending'
  AND t.type = 'purchase'
  AND t.teacher_id IS NOT NULL
GROUP BY s.name
ORDER BY s.name;
