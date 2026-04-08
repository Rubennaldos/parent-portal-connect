-- ============================================================
-- ÍNDICES B-TREE — Optimización de consultas en transactions
-- Ejecutar con CONCURRENTLY para no bloquear la tabla en producción.
-- ============================================================

-- 1. student_id — búsqueda de transacciones por alumno (la más frecuente)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_student_id
  ON transactions(student_id);

-- 2. Índice compuesto parcial: la query exacta del portal de padres y la vista.
--    Solo indexa las filas "activas con deuda" → mucho más pequeño y rápido.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_active_debts
  ON transactions(student_id, created_at DESC)
  WHERE type           = 'purchase'
    AND is_deleted     = false
    AND payment_status IN ('pending', 'partial');

-- 3. payment_status — para filtrar por estado en el módulo de cobranzas
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_payment_status
  ON transactions(payment_status)
  WHERE is_deleted = false;

-- 4. is_deleted — presente en casi todas las queries de consulta
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_is_deleted
  ON transactions(is_deleted)
  WHERE is_deleted = false;

-- 5. school_id + created_at — para reportes de cobranzas por sede y rango de fechas
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_school_date
  ON transactions(school_id, created_at DESC)
  WHERE is_deleted = false;

-- 6. metadata -> lunch_order_id — para detectar almuerzos virtuales
--    (usado en el NOT EXISTS de la vista y en el admin RPC)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_lunch_order_id
  ON transactions((metadata->>'lunch_order_id'))
  WHERE is_deleted = false
    AND (metadata->>'lunch_order_id') IS NOT NULL;

-- ── lunch_orders ──────────────────────────────────────────────────────────────

-- 7. student_id + payment_method — para el tramo de almuerzos virtuales
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lunch_orders_student_payment
  ON lunch_orders(student_id, payment_method)
  WHERE is_cancelled = false;

-- ── students ─────────────────────────────────────────────────────────────────

-- 8. parent_id — para que get_parent_debts encuentre los hijos del padre rápido
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_students_parent_id
  ON students(parent_id)
  WHERE is_active = true;

-- 9. balance < 0 — para detectar saldos negativos (Tramo 3 de la vista)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_students_negative_balance
  ON students(id)
  WHERE balance < 0
    AND is_active = true;
