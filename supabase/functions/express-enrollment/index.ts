// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  resolveParentByDni,
  ERR_EXPRESS_CONFLICT_DNI_AMBIGUOUS,
} from "./parent.resolve.ts";
import { createGhostParentIfNeeded } from "./parent.ghost-create.ts";
import {
  enrollStudentViaRpc,
  ExpressRpcError,
  ERR_EXPRESS_DATABASE_ROLLBACK,
  type AccountMode,
} from "./rpc.enroll.ts";
import { corsHeadersJson as corsHeaders } from "../_shared/cors.ts";

const ERR_EXPRESS_UNAUTHORIZED = "ERR_EXPRESS_UNAUTHORIZED";
const ERR_EXPRESS_INVALID_DNI = "ERR_EXPRESS_INVALID_DNI";

const ALLOWED_ADMIN_ROLES = new Set([
  "admin_general",
  "admin_sede",
  "gestor_unidad",
  "operador_caja",
  "supervisor_red",
  "superadmin",
]);

type ExpressRequest = {
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

function jsonOk(data: Record<string, unknown>, status = 200): Response {
  return new Response(
    JSON.stringify({ ok: true, data }),
    { status, headers: corsHeaders },
  );
}

function jsonErr(
  code: string,
  message: string,
  status = 400,
  meta?: Record<string, unknown>,
): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: { code, message, ...(meta ? { meta } : {}) },
    }),
    { status, headers: corsHeaders },
  );
}

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!auth) return null;
  const [scheme, token] = auth.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") return null;
  return token.trim();
}

function normalizeDni(raw: unknown): string {
  return String(raw ?? "").replace(/\D/g, "");
}

function validateBody(body: any): { ok: true; value: ExpressRequest } | { ok: false; response: Response } {
  if (!body || typeof body !== "object") {
    return { ok: false, response: jsonErr(ERR_EXPRESS_DATABASE_ROLLBACK, "Payload inv├ílido.", 400) };
  }

  const school_id = String(body.school_id ?? "");
  const student_full_name = String(body.student_full_name ?? "").trim();
  const level_id = String(body.level_id ?? "");
  const classroom_id = String(body.classroom_id ?? "");
  const rawMode = String(body.account_mode ?? "concession_only");
  const account_mode: AccountMode =
    rawMode === "kiosk_free" ? "kiosk_free" : "concession_only";
  const parent = body.parent;

  if (!school_id || !student_full_name || !level_id || !classroom_id || !parent) {
    return { ok: false, response: jsonErr(ERR_EXPRESS_DATABASE_ROLLBACK, "Faltan campos obligatorios.", 400) };
  }

  const parent_full_name = String(parent.full_name ?? "").trim();
  const parent_dni = String(parent.dni ?? "");
  const parent_phone_1 = String(parent.phone_1 ?? "").trim();

  if (!parent_full_name || !parent_dni || !parent_phone_1) {
    return { ok: false, response: jsonErr(ERR_EXPRESS_DATABASE_ROLLBACK, "Datos del padre incompletos.", 400) };
  }

  return {
    ok: true,
    value: {
      school_id,
      student_full_name,
      level_id,
      classroom_id,
      account_mode,
      parent: {
        full_name: parent_full_name,
        dni: parent_dni,
        phone_1: parent_phone_1,
        phone_2: parent.phone_2 ?? null,
        responsible_2_full_name: parent.responsible_2_full_name ?? null,
        responsible_2_dni: parent.responsible_2_dni ?? null,
        responsible_2_phone_1: parent.responsible_2_phone_1 ?? null,
      },
    },
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonErr(ERR_EXPRESS_DATABASE_ROLLBACK, "M├®todo no permitido.", 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonErr(
      ERR_EXPRESS_DATABASE_ROLLBACK,
      "Variables de entorno de Supabase incompletas.",
      500,
    );
  }

  try {
    // 1) Extraer token crudo (limpiando la palabra "Bearer ")
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
      return jsonErr(ERR_EXPRESS_UNAUTHORIZED, "Token faltante o inv├ílido.", 401);
    }
    const rawToken = authHeader.split(" ")[1].trim();

    // 2) Cliente Auth (ANON_KEY pura, sin headers globales inyectados)
    // persistSession: false en Deno hace que getUser() sin args devuelva
    // "Auth session missing!" porque no hay sesi├│n local. La ├║nica forma de
    // validar el JWT directamente contra el servidor Auth es pasarlo como argumento.
    const supabaseAuthClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // 3) Validaci├│n directa: rawToken como argumento bypasea el check de sesi├│n local
    const { data: authData, error: authError } = await supabaseAuthClient.auth.getUser(rawToken);
    if (authError || !authData?.user?.id) {
      return jsonErr(
        ERR_EXPRESS_UNAUTHORIZED,
        `Fallo al validar sesi├│n: ${authError?.message || "Token inv├ílido"}`,
        401,
      );
    }

    const actorUserId = authData.user.id;

    // 4) CLIENTE ADMINISTRADOR (Para operar la DB con service role)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // 5) Validaci├│n de rol en DB
    const { data: actorProfile, error: actorProfileError } = await supabaseAdmin
      .from("profiles")
      .select("role, school_id")
      .eq("id", actorUserId)
      .maybeSingle();

    if (actorProfileError || !actorProfile?.role || !ALLOWED_ADMIN_ROLES.has(actorProfile.role)) {
      return jsonErr(
        ERR_EXPRESS_UNAUTHORIZED,
        "No tienes permisos para matr├¡cula express.",
        403,
      );
    }

    const payload = await req.json();
    const parsed = validateBody(payload);
    if (!parsed.ok) return parsed.response;

    const input = parsed.value;
    const canCrossSchool =
      actorProfile.role === "admin_general" || actorProfile.role === "superadmin";

    if (!canCrossSchool) {
      if (!actorProfile.school_id || actorProfile.school_id !== input.school_id) {
        return jsonErr(
          ERR_EXPRESS_UNAUTHORIZED,
          "No puedes matricular alumnos fuera de tu sede asignada.",
          403,
        );
      }
    }

    const dniNormalized = normalizeDni(input.parent.dni);
    if (dniNormalized.length !== 8) {
      return jsonErr(
        ERR_EXPRESS_INVALID_DNI,
        "El DNI del padre es inv├ílido.",
        400,
        { dni_normalized: dniNormalized },
      );
    }

    let parentUserId: string;
    const resolved = await resolveParentByDni({
      supabaseAdmin,
      dniNormalized,
      schoolId: input.school_id,
    });

    if (!resolved.ok) {
      if (resolved.errorCode === ERR_EXPRESS_CONFLICT_DNI_AMBIGUOUS) {
        return jsonErr(
          ERR_EXPRESS_CONFLICT_DNI_AMBIGUOUS,
          resolved.message,
          409,
        );
      }

      return jsonErr(
        ERR_EXPRESS_DATABASE_ROLLBACK,
        "No se pudo resolver el padre por DNI.",
        500,
      );
    }

    if (resolved.status === "resolved") {
      parentUserId = resolved.parentUserId;
    } else {
      const ghost = await createGhostParentIfNeeded({
        supabaseAdmin,
        schoolId: input.school_id,
        dniNormalized,
        parentFullName: input.parent.full_name,
        phone1: input.parent.phone_1,
        phone2: input.parent.phone_2 ?? null,
        responsible2FullName: input.parent.responsible_2_full_name ?? null,
        responsible2Dni: input.parent.responsible_2_dni ?? null,
        responsible2Phone1: input.parent.responsible_2_phone_1 ?? null,
      });

      parentUserId = ghost.parentUserId;
    }

    const enrolled = await enrollStudentViaRpc({
      supabaseAdmin,
      schoolId: input.school_id,
      parentUserId,
      studentFullName: input.student_full_name,
      levelId: input.level_id,
      classroomId: input.classroom_id,
      actorUserId,
      accountMode: input.account_mode,
    });

    return jsonOk({
      student_id: enrolled.student_id,
      parent_user_id: enrolled.parent_user_id,
      school_id: enrolled.school_id,
      level_id: enrolled.level_id,
      classroom_id: enrolled.classroom_id,
      grade: enrolled.grade,
      section: enrolled.section,
      created_at: enrolled.created_at,
    });
  } catch (err) {
    if (err instanceof ExpressRpcError) {
      const status = err.code === "ERR_EXPRESS_INVALID_HIERARCHY" ? 422 : 500;
      return jsonErr(err.code, err.message, status, err.meta);
    }

    const message = err instanceof Error ? err.message : "Error inesperado";
    return jsonErr(
      ERR_EXPRESS_DATABASE_ROLLBACK,
      "Fallo interno en matr├¡cula express. Operaci├│n revertida.",
      500,
      { detail: message },
    );
  }
});
