-- ═══════════════════════════════════════════════
-- CORREGIR SALDO FINAL: Julieta Neyra Lamas
-- ═══════════════════════════════════════════════

-- DIAGNÓSTICO:
-- ✅ Recarga: 50.00 soles
-- ✅ Consumido kiosco: 13.50 soles
-- ✅ Saldo que debería tener: 36.50 (50 - 13.50)
-- ❌ Saldo actual en BD: 39.00 (tiene 2.50 de más)

-- CORREGIR: Restar los 2.50 que están de más
UPDATE students
SET balance = 36.50
WHERE id = 'cd5fb741-72fd-445d-9f16-1a11ba92ca88';

-- VERIFICAR saldo después de corregir
SELECT 
  id,
  full_name,
  balance AS saldo_corregido,
  'Debería ser: 36.50' AS saldo_esperado,
  CASE 
    WHEN balance = 36.50 THEN '✅ CORRECTO'
    ELSE '❌ Aún incorrecto'
  END AS estado
FROM students
WHERE id = 'cd5fb741-72fd-445d-9f16-1a11ba92ca88';

-- NOTA SOBRE "CONSUMIDO":
-- El "Consumido" en la app muestra 0.00 porque el código solo cuenta compras
-- del período actual (día/semana/mes según el tope configurado).
-- La compra de 13.50 fue el 3 de marzo, así que si el período actual es diferente,
-- no la cuenta. Esto es correcto según el diseño del sistema (muestra consumo del período).
