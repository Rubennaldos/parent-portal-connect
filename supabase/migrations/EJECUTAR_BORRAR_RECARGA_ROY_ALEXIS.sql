-- Roy Alexis Vilchez Vargas - Eliminar recarga S/ 240.00
-- student_id: 6dc80780-9c59-41fe-856e-90461ff7613b

-- 1) Poner saldo en 0
UPDATE students
SET balance = 0
WHERE id = '6dc80780-9c59-41fe-856e-90461ff7613b';

-- 2) Registrar devolución
INSERT INTO transactions (student_id, type, amount, payment_method, description, payment_status, created_at)
VALUES (
  '6dc80780-9c59-41fe-856e-90461ff7613b',
  'refund',
  240.00,
  'cash',
  'Devolución recarga kiosco — error de concepto (sede sin kiosco)',
  'paid',
  NOW()
);
