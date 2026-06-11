import type { ParentSupportChannel } from '@/config/support.config';

/** Solo dígitos para wa.me (código país incluido, ej. 51999999999). */
export function normalizeWhatsAppPhone(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '');
}

export interface SupportWhatsAppMessageInput {
  schoolName: string;
  parentName: string;
  studentName: string;
  subject: string;
  inquiry: string;
}

export function buildParentSupportWhatsAppBody(input: SupportWhatsAppMessageInput): string {
  const school = input.schoolName.trim() || 'Colegio no indicado';
  const parent = input.parentName.trim() || 'Padre de familia';
  const student = input.studentName.trim() || 'Sin alumno seleccionado';
  const subject = input.subject.trim();
  const inquiry = input.inquiry.trim();

  return (
    '¡Hola! Solicito soporte para la siguiente cuenta:\n' +
    `- **Colegio:** ${school}\n` +
    `- **Padre/Madre:** ${parent}\n` +
    `- **Alumno:** ${student}\n` +
    `- **Asunto:** ${subject}\n` +
    `- **Consulta:** ${inquiry}`
  );
}

export function buildParentSupportWhatsAppUrl(
  phoneDigits: string,
  body: string
): string {
  const phone = normalizeWhatsAppPhone(phoneDigits);
  return `https://wa.me/${phone}?text=${encodeURIComponent(body)}`;
}

export const SUPPORT_CHANNEL_COPY: Record<
  ParentSupportChannel,
  { title: string; description: string; badge: string }
> = {
  school_admin: {
    title: 'Gestión de Sede',
    description:
      'Para coordinar menús, justificar faltas de almuerzos, reclamos de deudas o problemas de entrega en el comedor.',
    badge: 'Administración del colegio',
  },
  technical: {
    title: 'Soporte Técnico',
    description:
      'Para reportar errores de cálculo, pantallas bloqueadas, fallas en la carga de billeteras o problemas con la aplicación.',
    badge: 'Equipo del sistema',
  },
};
