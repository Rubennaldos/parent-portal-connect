-- Verificar configuración de pagos de la sede Nordic (Alessandra Díaz Ridia)
-- school_id: ba6219dd-05ce-43a4-b91b-47ca94744f97

SELECT
  school_id,
  yape_number,
  yape_enabled,
  plin_number,
  plin_enabled,
  transferencia_enabled,
  bank_name,
  bank_account_number,
  bank_cci,
  bank_account_info,
  bank_account_holder,
  show_payment_info
FROM billing_config
WHERE school_id = 'ba6219dd-05ce-43a4-b91b-47ca94744f97';
