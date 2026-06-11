/** WhatsApp central de soporte técnico del sistema (portal padres). */
export const SUPPORT_TECH_WHATSAPP =
  (import.meta.env.VITE_SUPPORT_TECH_WHATSAPP ?? '51991236870').toString().trim();

export type ParentSupportChannel = 'school_admin' | 'technical';
