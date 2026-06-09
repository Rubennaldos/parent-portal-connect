import { supabaseConfig } from '@/config/supabase.config';
import { supabase } from '@/lib/supabase';
import {
  type CreateTeacherExpressPayload,
  type CreateTeacherExpressSuccess,
  TeacherExpressServiceError,
} from '../types';

// ── Token fresco (mismo patrón que expressEnrollmentService) ──────────────────
// getSession() puede devolver un token de caché que la Edge Function rechaza.
// refreshSession() fuerza un token validado contra el servidor Auth.

async function getAccessTokenOrThrow(): Promise<string> {
  if (!supabase) {
    throw new TeacherExpressServiceError(
      'ERR_TEACHER_DATABASE',
      'Supabase no está configurado en el cliente.',
      500,
    );
  }

  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session?.access_token) {
    throw new TeacherExpressServiceError(
      'ERR_TEACHER_UNAUTHORIZED',
      'Tu sesión expiró. Vuelve a iniciar sesión.',
      401,
    );
  }

  return data.session.access_token;
}

// ── Mapeo de códigos de error de la Edge Function ─────────────────────────────

const KNOWN_ERROR_CODES = [
  'ERR_TEACHER_UNAUTHORIZED',
  'ERR_TEACHER_INVALID_INPUT',
  'ERR_TEACHER_DUPLICATE_DNI',
  'ERR_TEACHER_SCHOOL_MISMATCH',
  'ERR_TEACHER_DATABASE',
] as const;

type KnownCode = (typeof KNOWN_ERROR_CODES)[number];

function isKnownCode(code: unknown): code is KnownCode {
  return typeof code === 'string' && (KNOWN_ERROR_CODES as readonly string[]).includes(code);
}

function statusFor(code: KnownCode): number {
  if (code === 'ERR_TEACHER_UNAUTHORIZED')   return 401;
  if (code === 'ERR_TEACHER_SCHOOL_MISMATCH') return 403;
  if (code === 'ERR_TEACHER_DUPLICATE_DNI')   return 409;
  if (code === 'ERR_TEACHER_INVALID_INPUT')   return 400;
  return 500;
}

// ── Función pública ───────────────────────────────────────────────────────────

export async function createTeacherExpress(
  payload: CreateTeacherExpressPayload,
): Promise<CreateTeacherExpressSuccess> {
  const accessToken = await getAccessTokenOrThrow();

  const response = await fetch(
    `${supabaseConfig.url}/functions/v1/teacher-express`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        apikey: supabaseConfig.anonKey,
      },
      body: JSON.stringify({
        name:      payload.full_name.trim(),
        dni:       payload.dni.replace(/\D/g, ''),
        phone:     payload.phone.replace(/\D/g, ''),
        school_id: payload.school_id,
      }),
    },
  );

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    throw new TeacherExpressServiceError(
      'ERR_TEACHER_DATABASE',
      'Respuesta inválida del servidor al registrar profesor.',
      response.status || 500,
    );
  }

  const b = body as Record<string, any>;

  if (response.ok && b?.ok === true && b?.data) {
    return b.data as CreateTeacherExpressSuccess;
  }

  const rawCode = b?.error?.code;
  const code = isKnownCode(rawCode) ? rawCode : 'ERR_TEACHER_DATABASE';
  const message: string =
    b?.error?.message || 'No se pudo registrar al profesor. Intenta de nuevo.';

  throw new TeacherExpressServiceError(code, message, statusFor(code));
}
