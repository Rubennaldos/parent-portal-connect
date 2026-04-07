/**
 * Utilidades de fecha para zona horaria Lima/Perú (UTC-5, sin cambio de horario).
 *
 * Perú NO observa horario de verano (DST), por lo que el offset es
 * permanentemente UTC-5. La "medianoche de Lima" equivale a las 05:00 UTC.
 */

const PERU_OFFSET_MS = -5 * 60 * 60 * 1000; // UTC-5 en milisegundos

/**
 * Calcula la próxima fecha/hora de reinicio del tope en Perú.
 *
 * - Diario  → próximo día a las 00:00 Lima (05:00 UTC)
 * - Semanal → próximo Lunes a las 00:00 Lima
 * - Mensual → día 1 del próximo mes a las 00:00 Lima
 *
 * Siempre retorna la PRÓXIMA ocurrencia (nunca "ahora mismo").
 */
export function calculateNextResetDate(type: 'daily' | 'weekly' | 'monthly'): Date {
  const nowUtc = new Date();

  // Desplazar "ahora" al horario de Lima para hacer los cálculos en hora local peruana
  const nowPeru = new Date(nowUtc.getTime() + PERU_OFFSET_MS);

  // Construir la fecha de próximo reinicio en "hora peruana virtual"
  const resetPeru = new Date(nowPeru);

  if (type === 'daily') {
    // Mañana a medianoche Lima
    resetPeru.setUTCDate(resetPeru.getUTCDate() + 1);
    resetPeru.setUTCHours(0, 0, 0, 0);
  } else if (type === 'weekly') {
    // Próximo Lunes a medianoche Lima
    const dayOfWeek = resetPeru.getUTCDay(); // 0=Dom, 1=Lun … 6=Sáb
    const daysToAdd = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
    resetPeru.setUTCDate(resetPeru.getUTCDate() + daysToAdd);
    resetPeru.setUTCHours(0, 0, 0, 0);
  } else {
    // Día 1 del próximo mes a medianoche Lima
    resetPeru.setUTCMonth(resetPeru.getUTCMonth() + 1);
    resetPeru.setUTCDate(1);
    resetPeru.setUTCHours(0, 0, 0, 0);
  }

  // Revertir al UTC real (quitar el offset peruano que habíamos sumado)
  return new Date(resetPeru.getTime() - PERU_OFFSET_MS);
}

/**
 * Formatea una fecha de reinicio para mostrar al padre en el modal.
 * Ej: "Lunes 14 de abril · 00:00 (Lima)"
 */
export function formatResetDate(date: Date): string {
  const DAYS_ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  // Convertir la fecha UTC a hora Lima para mostrarla
  const limaDate = new Date(date.getTime() + PERU_OFFSET_MS);

  const dayName  = DAYS_ES[limaDate.getUTCDay()];
  const day      = limaDate.getUTCDate();
  const month    = MONTHS_ES[limaDate.getUTCMonth()];
  const year     = limaDate.getUTCFullYear();

  return `${dayName} ${day} de ${month} ${year} · 00:00 (Lima)`;
}
