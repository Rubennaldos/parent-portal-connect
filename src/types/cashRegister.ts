// 💰 TIPOS: Sistema de Cierre de Caja

export type CashRegisterStatus = 'open' | 'closed';
export type CashMovementType = 'ingreso' | 'egreso' | 'ajuste';

export interface CashRegister {
  id: string;
  school_id: string;
  opened_by: string;
  opened_at: string;
  initial_amount: number;
  expected_amount: number;
  actual_amount: number | null;
  difference: number | null;
  status: CashRegisterStatus;
  closed_by: string | null;
  closed_at: string | null;
  admin_password_validated: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CashMovement {
  id: string;
  cash_register_id: string;
  school_id: string;
  type: CashMovementType;
  amount: number;
  reason: string;
  responsible_name: string;
  responsible_id: string | null;
  created_by: string;
  requires_signature: boolean;
  signature_validated: boolean;
  voucher_printed: boolean;
  created_at: string;
}

export interface CashClosure {
  id: string;
  cash_register_id: string;
  school_id: string;
  closure_date: string;
  
  // POS - Punto de Venta
  pos_cash: number;
  pos_card: number;
  pos_yape: number;
  pos_yape_qr: number;
  pos_credit: number;
  pos_mixed_cash: number;
  pos_mixed_card: number;
  pos_mixed_yape: number;
  pos_total: number;
  
  // ALMUERZOS - Lunch Orders
  lunch_cash: number;
  lunch_credit: number;
  lunch_card: number;
  lunch_yape: number;
  lunch_total: number;
  
  // TOTALES GENERALES
  total_cash: number;
  total_card: number;
  total_yape: number;
  total_yape_qr: number;
  total_credit: number;
  total_sales: number;
  
  // MOVIMIENTOS
  total_ingresos: number;
  total_egresos: number;
  
  // CAJA
  initial_amount: number;
  expected_final: number;
  actual_final: number;
  difference: number;
  
  // METADATOS
  closed_by: string;
  admin_validated_by: string | null;
  exported_to_excel: boolean;
  exported_to_pdf: boolean;
  sent_to_whatsapp: boolean;
  whatsapp_phone: string | null;
  printed: boolean;
  
  created_at: string;
}

export interface CashRegisterConfig {
  id: string;
  school_id: string;
  auto_close_enabled: boolean;
  auto_close_time: string; // HH:MM:SS
  whatsapp_phone: string;
  require_admin_password: boolean;
  alert_on_difference: boolean;
  difference_threshold: number;
  created_at: string;
  updated_at: string;
}

export interface DailyTotals {
  pos: {
    cash: number;
    card: number;
    yape: number;
    yape_qr: number;
    credit: number;
    mixed_cash: number;
    mixed_card: number;
    mixed_yape: number;
    total: number;
  };
  lunch: {
    cash: number;
    card: number;
    yape: number;
    credit: number;
    total: number;
  };
}

export interface CashClosureSummary {
  expected: number;
  actual: number;
  difference: number;
  totalCash: number;
  totalCard: number;
  totalYape: number;
  totalCredit: number;
  totalSales: number;
  totalIngresos: number;
  totalEgresos: number;
}

export interface PaymentMethodBreakdown {
  method: string;
  amount: number;
  percentage: number;
  color: string;
}
