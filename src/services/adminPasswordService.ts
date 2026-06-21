import { supabaseConfig } from '@/config/supabase.config';
import { supabase } from '@/lib/supabase';

export interface ResetUserPasswordInput {
  newPassword: string;
  userId?: string;
  userEmail?: string;
}

export interface ResetUserPasswordResult {
  success: true;
  message: string;
  userEmail?: string;
}

export class AdminPasswordServiceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AdminPasswordServiceError';
  }
}

async function getAccessTokenOrThrow(): Promise<string> {
  if (!supabase) {
    throw new AdminPasswordServiceError('Supabase no está configurado en el cliente.', 500);
  }

  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session?.access_token) {
    throw new AdminPasswordServiceError('Tu sesión expiró. Vuelve a iniciar sesión.', 401);
  }

  return data.session.access_token;
}

/**
 * Restablece la contraseña de un usuario vía Edge Function con service role.
 * Usa fetch directo (apikey + Authorization) — el patrón probado en este repo
 * para evitar fallos de relay del SDK cuando se pasan headers personalizados.
 */
export async function resetUserPassword(
  input: ResetUserPasswordInput,
): Promise<ResetUserPasswordResult> {
  const newPassword = input.newPassword?.trim();
  const userId = input.userId?.trim() || undefined;
  const userEmail = input.userEmail?.trim() || undefined;

  if (!newPassword || newPassword.length < 6) {
    throw new AdminPasswordServiceError('La contraseña debe tener al menos 6 caracteres.', 400);
  }

  if (!userId && !userEmail) {
    throw new AdminPasswordServiceError('Falta identidad del usuario (userId o correo).', 400);
  }

  const accessToken = await getAccessTokenOrThrow();
  const supabaseUrl = supabaseConfig.url.replace(/\/$/, '');

  const response = await fetch(`${supabaseUrl}/functions/v1/reset-user-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseConfig.anonKey,
    },
    body: JSON.stringify({
      userId,
      userEmail,
      newPassword,
    }),
  });

  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new AdminPasswordServiceError(
      `Respuesta inválida del servidor (${response.status || 'sin código'}).`,
      response.status || 500,
    );
  }

  const serverError = typeof body.error === 'string' ? body.error : null;

  if (!response.ok) {
    if (response.status === 404 || serverError?.toLowerCase().includes('not found')) {
      throw new AdminPasswordServiceError('Usuario no encontrado en el sistema.', 404);
    }
    if (response.status === 403) {
      throw new AdminPasswordServiceError(
        serverError || 'No tienes permiso para restablecer contraseñas.',
        403,
      );
    }
    if (response.status === 401) {
      throw new AdminPasswordServiceError(
        serverError || 'Sesión inválida. Vuelve a iniciar sesión.',
        401,
      );
    }
    throw new AdminPasswordServiceError(
      serverError || `No se pudo restablecer la contraseña (HTTP ${response.status}).`,
      response.status,
    );
  }

  if (serverError) {
    throw new AdminPasswordServiceError(serverError, response.status);
  }

  return {
    success: true,
    message: typeof body.message === 'string'
      ? body.message
      : 'Contraseña actualizada exitosamente',
    userEmail: typeof body.userEmail === 'string' ? body.userEmail : userEmail,
  };
}
