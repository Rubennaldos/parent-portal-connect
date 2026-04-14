/**
 * Normalización de métodos de pago para reportes y UI.
 *
 * La BD tiene mezcla histórica de inglés/español ('cash'/'efectivo', 'card'/'tarjeta').
 * Estas funciones unifican el display SIN modificar los datos en memoria.
 *
 * Para datos nuevos ya existe la migración SQL 20260414_zzzzzz que normaliza
 * los registros históricos. Esta capa es la defensa permanente contra
 * cualquier valor inesperado que pudiera entrar en el futuro.
 */

/** Clave canónica en español (para agrupar totales). */
export function normalizePaymentMethodKey(method: string | null | undefined): string {
  const m = method?.trim().toLowerCase();
  if (!m) return 'efectivo';
  if (m === 'cash' || m === 'money' || m === 'dinero') return 'efectivo';
  if (m === 'card' || m === 'visa' || m === 'mastercard' || m === 'debit') return 'tarjeta';
  if (m === 'transfer') return 'transferencia';
  if (m === 'yape_qr' || m === 'yape_numero') return 'yape';
  if (m === 'plin_qr' || m === 'plin_numero') return 'plin';
  return m;
}

const DISPLAY_LABELS: Record<string, string> = {
  efectivo:      'Efectivo',
  tarjeta:       'Tarjeta',
  yape:          'Yape',
  plin:          'Plin',
  transferencia: 'Transferencia',
  mixto:         'Mixto',
  saldo:         'Saldo',
  teacher:       'Profesor',
  pagar_luego:   'Pagar después',
  adjustment:    'Ajuste',
  credito:       'Crédito',
};

const ICON_LABELS: Record<string, string> = {
  efectivo:      '💵 Efectivo',
  tarjeta:       '💳 Tarjeta',
  yape:          '📱 Yape',
  plin:          '📱 Plin',
  transferencia: '🏦 Transferencia',
  mixto:         '🔀 Mixto',
  saldo:         '💰 Saldo',
  teacher:       '👤 Profesor',
  pagar_luego:   '⏳ Pagar después',
  adjustment:    '🔧 Ajuste',
};

/** Etiqueta legible en español (sin emoji). Usada en tablas y exportaciones. */
export function getPaymentMethodLabel(method: string | null | undefined): string {
  const key = normalizePaymentMethodKey(method);
  return DISPLAY_LABELS[key] ?? (method ? method.charAt(0).toUpperCase() + method.slice(1) : 'Efectivo');
}

/** Etiqueta con emoji. Usada en resúmenes visuales y previews. */
export function getPaymentMethodLabelWithIcon(method: string | null | undefined): string {
  const key = normalizePaymentMethodKey(method);
  return ICON_LABELS[key] ?? getPaymentMethodLabel(method);
}
