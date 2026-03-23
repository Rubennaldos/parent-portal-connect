-- ============================================================
-- AUDITORÍA: Ema Noguerol — Descuadre saldo vs Total Ingresado
-- students.balance = 246.50 pero Total Ingresado (recharge_requests) = 0.00
-- ============================================================

-- 0) Identificar a la alumna
SELECT id AS student_id, full_name, balance, school_id, parent_id
FROM students
WHERE full_name ILIKE '%Ema%Noguerol%';

-- 1) Transacciones contables: cómo llegó el saldo a 246.50
-- (Reemplaza [ID_DE_EMA] por el id del resultado anterior o ejecuta en un bloque con el nombre)
SELECT amount, type, metadata, created_at, payment_status
FROM transactions
WHERE student_id = (SELECT id FROM students WHERE full_name ILIKE '%Ema%Noguerol%' LIMIT 1)
ORDER BY created_at ASC;

-- 2) Recargas (recharge_requests): si hay algo que el frontend no muestra
SELECT id, amount, status, request_type, reference_code, created_at
FROM recharge_requests
WHERE student_id = (SELECT id FROM students WHERE full_name ILIKE '%Ema%Noguerol%' LIMIT 1)
ORDER BY created_at ASC;
