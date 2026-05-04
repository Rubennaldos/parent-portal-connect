import { supabase } from '@/lib/supabase';

type SystemErrorPayload = {
  errorMessage: string;
  stackTrace?: string | null;
  componentName?: string | null;
  metadata?: Record<string, unknown>;
};

async function getCurrentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

function buildBrowserMetadata(extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    url: window.location.href,
    path: window.location.pathname,
    userAgent: navigator.userAgent,
    language: navigator.language,
    timestamp_client: new Date().toISOString(),
    ...(extra ?? {}),
  };
}

export async function logSystemError(payload: SystemErrorPayload): Promise<void> {
  const userId = await getCurrentUserId();

  try {
    await supabase.from('system_error_logs').insert({
      user_id: userId,
      error_message: payload.errorMessage.slice(0, 4000),
      stack_trace: payload.stackTrace ?? null,
      component_name: payload.componentName ?? null,
      metadata: buildBrowserMetadata(payload.metadata),
    });
  } catch {
    // Silencioso por diseno: nunca bloquea al usuario
  }
}

export function logSystemErrorAsync(payload: SystemErrorPayload): void {
  logSystemError(payload).catch(() => {});
}
