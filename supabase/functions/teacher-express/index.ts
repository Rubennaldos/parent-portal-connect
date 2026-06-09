// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Constantes de error ────────────────────────────────────────────────────────

const ERR_TEACHER_UNAUTHORIZED   = "ERR_TEACHER_UNAUTHORIZED";
const ERR_TEACHER_INVALID_INPUT  = "ERR_TEACHER_INVALID_INPUT";
const ERR_TEACHER_DUPLICATE_DNI  = "ERR_TEACHER_DUPLICATE_DNI";
const ERR_TEACHER_SCHOOL_MISMATCH = "ERR_TEACHER_SCHOOL_MISMATCH";
const ERR_TEACHER_DATABASE       = "ERR_TEACHER_DATABASE";

const ALLOWED_ROLES = new Set([
  "superadmin",
  "admin_general",
  "gestor_unidad",
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

// ── Helpers de respuesta ───────────────────────────────────────────────────────

function jsonOk(data: Record<string, unknown>, status = 200): Response {
  return new Response(
    JSON.stringify({ ok: true, data }),
    { status, headers: corsHeaders },
  );
}

function jsonErr(code: string, message: string, status = 400): Response {
  return new Response(
    JSON.stringify({ ok: false, error: { code, message } }),
    { status, headers: corsHeaders },
  );
}

// ── Normalización ──────────────────────────────────────────────────────────────

function digitsOnly(raw: unknown): string {
  return String(raw ?? "").replace(/\D/g, "");
}

function buildGhostEmail(dni: string): string {
  return `teacher_${dni}@kiosco.local`;
}

function buildRandomPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return "Px!" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") + "A1";
}

// ── Validación del body ────────────────────────────────────────────────────────

type TeacherExpressRequest = {
  name: string;
  dni: string;
  phone: string;
  school_id: string;
};

function validateBody(
  body: any,
): { ok: true; value: TeacherExpressRequest } | { ok: false; response: Response } {
  if (!body || typeof body !== "object") {
    return { ok: false, response: jsonErr(ERR_TEACHER_INVALID_INPUT, "Payload inválido.", 400) };
  }

  const name     = String(body.name ?? "").trim();
  const dniRaw   = digitsOnly(body.dni);
  const phoneRaw = digitsOnly(body.phone);
  const school_id = String(body.school_id ?? "").trim();

  if (name.length < 3) {
    return { ok: false, response: jsonErr(ERR_TEACHER_INVALID_INPUT, "El nombre debe tener al menos 3 caracteres.", 400) };
  }
  if (dniRaw.length !== 8) {
    return { ok: false, response: jsonErr(ERR_TEACHER_INVALID_INPUT, "El DNI debe tener exactamente 8 dígitos.", 400) };
  }
  if (phoneRaw.length < 9 || phoneRaw.length > 11) {
    return { ok: false, response: jsonErr(ERR_TEACHER_INVALID_INPUT, "El teléfono debe tener entre 9 y 11 dígitos.", 400) };
  }
  if (!school_id) {
    return { ok: false, response: jsonErr(ERR_TEACHER_INVALID_INPUT, "Sede requerida.", 400) };
  }

  return { ok: true, value: { name, dni: dniRaw, phone: phoneRaw, school_id } };
}

// ── Servidor ───────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonErr(ERR_TEACHER_DATABASE, "Método no permitido.", 405);
  }

  const supabaseUrl    = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey        = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonErr(ERR_TEACHER_DATABASE, "Variables de entorno de Supabase incompletas.", 500);
  }

  try {
    // 1) Extraer token del actor
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
      return jsonErr(ERR_TEACHER_UNAUTHORIZED, "Token faltante o inválido.", 401);
    }
    const rawToken = authHeader.split(" ")[1].trim();

    // 2) Cliente anon solo para validar el JWT del actor
    const supabaseAuthClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } = await supabaseAuthClient.auth.getUser(rawToken);
    if (authError || !authData?.user?.id) {
      return jsonErr(
        ERR_TEACHER_UNAUTHORIZED,
        `Sesión inválida: ${authError?.message ?? "Token no reconocido"}`,
        401,
      );
    }

    const actorUserId = authData.user.id;

    // 3) Cliente con service_role para todas las operaciones administrativas
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 4) Validar rol del actor en DB
    const { data: actorProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("role, school_id")
      .eq("id", actorUserId)
      .maybeSingle();

    if (profileError || !actorProfile?.role || !ALLOWED_ROLES.has(actorProfile.role)) {
      return jsonErr(ERR_TEACHER_UNAUTHORIZED, "No tienes permisos para registrar profesores.", 403);
    }

    // 5) Validar body
    const body = await req.json();
    const parsed = validateBody(body);
    if (!parsed.ok) return parsed.response;

    const input = parsed.value;

    // 6) Restricción de sede para gestor_unidad
    const isCrossSchool = actorProfile.role === "admin_general" || actorProfile.role === "superadmin";
    if (!isCrossSchool) {
      if (!actorProfile.school_id || actorProfile.school_id !== input.school_id) {
        return jsonErr(
          ERR_TEACHER_SCHOOL_MISMATCH,
          "Solo puedes registrar profesores de tu sede asignada.",
          403,
        );
      }
    }

    // 7) Crear el ghost user en Auth usando Admin API
    //    GoTrue asigna instance_id, identities y todo lo necesario — sin SQL manual.
    const ghostEmail = buildGhostEmail(input.dni);
    const { data: newAuthUser, error: createAuthError } = await supabaseAdmin.auth.admin.createUser({
      email: ghostEmail,
      password: buildRandomPassword(),
      email_confirm: true,
      user_metadata: {
        role: "teacher",
        full_name: input.name,
        dni: input.dni,
        express_teacher: true,
        ghost_identity: true,
      },
    });

    if (createAuthError) {
      // DNI ya registrado → ghost email ya existe en Auth
      if (
        createAuthError.message.toLowerCase().includes("already") ||
        createAuthError.message.toLowerCase().includes("duplicate") ||
        createAuthError.message.toLowerCase().includes("unique")
      ) {
        return jsonErr(ERR_TEACHER_DUPLICATE_DNI, "El DNI ya se encuentra registrado", 409);
      }
      return jsonErr(ERR_TEACHER_DATABASE, `Error al crear usuario Auth: ${createAuthError.message}`, 500);
    }

    const teacherUserId = newAuthUser.user?.id;
    if (!teacherUserId) {
      return jsonErr(ERR_TEACHER_DATABASE, "Auth no retornó un user_id válido.", 500);
    }

    // 8) RPC atómico: profiles + teacher_profiles + audit_logs (solo public.*)
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
      "provision_teacher_express_v1",
      {
        p_user_id:   teacherUserId,
        p_name:      input.name,
        p_dni:       input.dni,
        p_phone:     input.phone,
        p_school_id: input.school_id,
        p_actor_id:  actorUserId,
      },
    );

    if (rpcError) {
      // Si el RPC falla, eliminar el usuario Auth recién creado para no dejar huérfanos
      await supabaseAdmin.auth.admin.deleteUser(teacherUserId);

      const msg = rpcError.message ?? "";
      if (msg.includes("ERR_TEACHER_DUPLICATE_DNI")) {
        return jsonErr(ERR_TEACHER_DUPLICATE_DNI, "El DNI ya se encuentra registrado", 409);
      }
      if (msg.includes("ERR_TEACHER_UNAUTHORIZED")) {
        return jsonErr(ERR_TEACHER_UNAUTHORIZED, msg.split(": ").slice(1).join(": ") || msg, 403);
      }
      if (msg.includes("ERR_TEACHER_SCHOOL_MISMATCH")) {
        return jsonErr(ERR_TEACHER_SCHOOL_MISMATCH, msg.split(": ").slice(1).join(": ") || msg, 403);
      }
      if (msg.includes("ERR_TEACHER_INVALID_INPUT")) {
        return jsonErr(ERR_TEACHER_INVALID_INPUT, msg.split(": ").slice(1).join(": ") || msg, 400);
      }
      return jsonErr(ERR_TEACHER_DATABASE, `Error al provisionar perfil: ${msg}`, 500);
    }

    // RPC devuelve un objeto JSON directo (no array)
    const result = Array.isArray(rpcData) ? rpcData[0] : rpcData;

    return jsonOk({
      teacher_id: result.teacher_id,
      full_name:  result.full_name,
      dni:        result.dni,
      phone_1:    result.phone_1,
      school_id:  result.school_id,
      email:      result.email,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error inesperado";
    return jsonErr(ERR_TEACHER_DATABASE, `Fallo interno en registro express: ${message}`, 500);
  }
});
