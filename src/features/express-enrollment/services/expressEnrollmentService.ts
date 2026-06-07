import { supabaseConfig } from "@/config/supabase.config";
import { supabase } from "@/lib/supabase";

export type AccountMode = "concession_only" | "kiosk_free";

export type ExpressEnrollmentRequest = {
  school_id: string;
  student_full_name: string;
  level_id: string;
  classroom_id: string;
  account_mode: AccountMode;
  parent: {
    full_name: string;
    dni: string;
    phone_1: string;
    phone_2?: string | null;
    responsible_2_full_name?: string | null;
    responsible_2_dni?: string | null;
    responsible_2_phone_1?: string | null;
  };
};

export type ExpressEnrollmentSuccess = {
  student_id: string;
  parent_user_id: string;
  school_id: string;
  level_id: string;
  classroom_id: string;
  grade: string;
  section: string;
  created_at: string;
};

export type ExpressEnrollmentErrorCode =
  | "ERR_EXPRESS_UNAUTHORIZED"
  | "ERR_EXPRESS_INVALID_DNI"
  | "ERR_EXPRESS_CONFLICT_DNI_AMBIGUOUS"
  | "ERR_EXPRESS_INVALID_HIERARCHY"
  | "ERR_EXPRESS_DATABASE_ROLLBACK";

export class ExpressEnrollmentServiceError extends Error {
  code: ExpressEnrollmentErrorCode;
  status: number;
  meta?: Record<string, unknown>;

  constructor(
    code: ExpressEnrollmentErrorCode,
    message: string,
    status = 500,
    meta?: Record<string, unknown>,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.meta = meta;
  }
}

const FALLBACK_ERROR_CODE: ExpressEnrollmentErrorCode =
  "ERR_EXPRESS_DATABASE_ROLLBACK";

function isKnownErrorCode(code: unknown): code is ExpressEnrollmentErrorCode {
  if (typeof code !== "string") return false;
  return code.startsWith("ERR_EXPRESS_");
}

async function getAccessTokenOrThrow(): Promise<string> {
  if (!supabase) {
    throw new ExpressEnrollmentServiceError(
      FALLBACK_ERROR_CODE,
      "Supabase no está configurado en el cliente.",
      500,
    );
  }

  // getSession() puede devolver un token de caché local que Edge Functions rechaza.
  // refreshSession() fuerza un token fresco validado por el servidor Auth.
  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session?.access_token) {
    throw new ExpressEnrollmentServiceError(
      "ERR_EXPRESS_UNAUTHORIZED",
      "Tu sesión expiró. Vuelve a iniciar sesión.",
      401,
    );
  }

  return data.session.access_token;
}

export async function enrollStudentExpress(
  payload: ExpressEnrollmentRequest,
): Promise<ExpressEnrollmentSuccess> {
  const accessToken = await getAccessTokenOrThrow();

  const response = await fetch(
    `${supabaseConfig.url}/functions/v1/express-enrollment`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        apikey: supabaseConfig.anonKey,
      },
      body: JSON.stringify(payload),
    },
  );

  let body: any = null;
  try {
    body = await response.json();
  } catch {
    throw new ExpressEnrollmentServiceError(
      FALLBACK_ERROR_CODE,
      "Respuesta inválida del servidor de matrícula express.",
      response.status || 500,
    );
  }

  if (response.ok && body?.ok === true && body?.data) {
    return body.data as ExpressEnrollmentSuccess;
  }

  const rawCode = body?.error?.code;
  const code = isKnownErrorCode(rawCode) ? rawCode : FALLBACK_ERROR_CODE;
  const message =
    body?.error?.message ||
    "No se pudo completar la matrícula express. Intenta de nuevo.";

  throw new ExpressEnrollmentServiceError(
    code,
    message,
    response.status || 500,
    body?.error?.meta,
  );
}
