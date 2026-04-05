// @ts-nocheck — archivo Deno (Edge Function de Supabase)
/**
 * admin-impersonate
 * ─────────────────────────────────────────────────────────────────
 * Permite a un Administrador autenticado obtener un enlace de acceso
 * temporal para ingresar como cualquier otro usuario del sistema.
 *
 * SEGURIDAD (capas en orden):
 *  1. El llamante DEBE tener un JWT válido de Supabase Auth.
 *  2. El llamante DEBE tener rol superadmin o admin_general en la tabla profiles.
 *  3. No se puede impersonar a otro superadmin (protección cruzada).
 *  4. El enlace generado expira en 1 hora y solo sirve para UN inicio de sesión.
 *  5. Cada uso queda registrado en la tabla audit_logs.
 *
 * Request body:
 *  { "target_email": "padre@colegio.com" }
 *
 * Response exitosa:
 *  { "success": true, "access_token": "...", "refresh_token": "...", "expires_at": "..." }
 *
 * Uso en el frontend (solo llamar desde el panel de SuperAdmin):
 *  const { data } = await supabase.functions.invoke('admin-impersonate', {
 *    body: { target_email: 'usuario@ejemplo.com' }
 *  });
 *  // Luego: supabase.auth.setSession({ access_token, refresh_token })
 */

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Roles que pueden usar esta función (en orden de privilegio)
const ALLOWED_CALLER_ROLES = new Set(["superadmin", "admin_general"]);

// Roles que NO pueden ser impersonados (protección cruzada de administradores)
const PROTECTED_TARGET_ROLES = new Set(["superadmin"]);

serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true }, 200);
  if (req.method !== "POST") return json({ success: false, error: "Método no permitido" }, 405);

  // ── 1. Extraer y validar el JWT del llamante ──────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!bearerToken) {
    return json({ success: false, error: "No autorizado — se requiere sesión activa" }, 401);
  }

  // Decodificar el sub (user_id) del JWT sin verificar firma
  // (Supabase Auth ya firmó el token; solo necesitamos el user_id para consultar el perfil)
  let callerUserId: string | null = null;
  try {
    const parts  = bearerToken.split(".");
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(padded.padEnd(padded.length + (4 - padded.length % 4) % 4, "="));
    callerUserId = JSON.parse(decoded).sub ?? null;
  } catch {
    return json({ success: false, error: "Token JWT inválido o malformado" }, 401);
  }

  if (!callerUserId) {
    return json({ success: false, error: "No se pudo identificar al usuario en el token" }, 401);
  }

  // ── 2. Crear clientes Supabase ────────────────────────────────────────────
  const supabaseUrl         = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const superadminEmail     = Deno.env.get("VITE_SUPERADMIN_EMAIL") ?? "superadmin@limacafe28.com";

  // Cliente con service_role para operaciones admin (leer perfiles, generar links)
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── 3. Verificar rol del llamante en la tabla profiles ────────────────────
  // También aceptamos el email de superadmin configurado via env (igual que useRole.ts)
  let callerRole: string | null = null;

  // Obtener el email del llamante desde Supabase Auth
  const { data: callerAuthData, error: callerAuthErr } = await adminClient.auth.admin.getUserById(callerUserId);
  if (callerAuthErr || !callerAuthData?.user) {
    return json({ success: false, error: "No se pudo verificar la identidad del llamante" }, 401);
  }

  const callerEmail = callerAuthData.user.email ?? "";

  // Superadmin hardcodeado (igual que useRole.ts) siempre tiene acceso
  if (callerEmail === superadminEmail) {
    callerRole = "superadmin";
  } else {
    const { data: callerProfile, error: profileErr } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", callerUserId)
      .single();

    if (profileErr || !callerProfile) {
      return json({ success: false, error: "No se encontró el perfil del llamante" }, 403);
    }
    callerRole = callerProfile.role ?? null;
  }

  if (!callerRole || !ALLOWED_CALLER_ROLES.has(callerRole)) {
    // Registrar intento no autorizado para auditoría
    await logAudit(adminClient, {
      action:      "impersonate_attempt_denied",
      actor_id:    callerUserId,
      actor_email: callerEmail,
      actor_role:  callerRole ?? "unknown",
      details:     { reason: "role_not_allowed" },
    });
    return json({
      success: false,
      error:   `Acceso denegado. Se requiere rol superadmin o admin_general (tienes: ${callerRole ?? "ninguno"})`,
    }, 403);
  }

  // ── 4. Parsear y validar el body ──────────────────────────────────────────
  let body: { target_email?: string };
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Body JSON inválido" }, 400);
  }

  const targetEmail = (body.target_email ?? "").trim().toLowerCase();
  if (!targetEmail || !targetEmail.includes("@")) {
    return json({ success: false, error: "El campo 'target_email' es requerido y debe ser un email válido" }, 400);
  }

  // No se puede impersonar a sí mismo (no tiene sentido y podría ser un error)
  if (targetEmail === callerEmail) {
    return json({ success: false, error: "No puedes impersonar tu propia cuenta" }, 400);
  }

  // ── 5. Buscar al usuario objetivo en Supabase Auth ────────────────────────
  const { data: usersResult, error: listErr } = await adminClient.auth.admin.listUsers();
  if (listErr) {
    return json({ success: false, error: "Error al buscar usuarios en el sistema" }, 500);
  }

  const targetAuthUser = usersResult?.users?.find(
    (u) => u.email?.toLowerCase() === targetEmail
  );

  if (!targetAuthUser) {
    return json({
      success: false,
      error:   `No existe ningún usuario con el email '${targetEmail}' en el sistema`,
    }, 404);
  }

  // ── 6. Protección cruzada: no impersonar otros administradores ────────────
  const { data: targetProfile } = await adminClient
    .from("profiles")
    .select("role, full_name, is_active")
    .eq("id", targetAuthUser.id)
    .single();

  const targetRole = targetProfile?.role ?? "parent";

  // Solo superadmin puede impersonar admin_general; nadie puede impersonar superadmin
  if (PROTECTED_TARGET_ROLES.has(targetRole)) {
    await logAudit(adminClient, {
      action:        "impersonate_attempt_denied",
      actor_id:      callerUserId,
      actor_email:   callerEmail,
      actor_role:    callerRole,
      target_email:  targetEmail,
      target_role:   targetRole,
      details:       { reason: "target_role_protected" },
    });
    return json({
      success: false,
      error:   "No está permitido impersonar cuentas de superadmin",
    }, 403);
  }

  if (targetRole === "admin_general" && callerRole !== "superadmin") {
    await logAudit(adminClient, {
      action:        "impersonate_attempt_denied",
      actor_id:      callerUserId,
      actor_email:   callerEmail,
      actor_role:    callerRole,
      target_email:  targetEmail,
      target_role:   targetRole,
      details:       { reason: "insufficient_role_to_impersonate_admin" },
    });
    return json({
      success: false,
      error:   "Solo el superadmin puede impersonar cuentas de admin_general",
    }, 403);
  }

  if (targetProfile?.is_active === false) {
    return json({
      success: false,
      error:   `La cuenta de '${targetEmail}' está desactivada`,
    }, 403);
  }

  // ── 7. Generar enlace de acceso temporal con service_role ─────────────────
  // generateLink tipo 'magiclink' crea un token OTP de un solo uso
  // que el frontend puede canjear con verifyOtp() o usar el access_token directo
  const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
    type:  "magiclink",
    email: targetEmail,
    options: {
      // El enlace expira en 1 hora
      expiresIn: 3600,
    },
  });

  if (linkErr || !linkData) {
    console.error("[admin-impersonate] Error generando enlace:", linkErr);
    return json({
      success: false,
      error:   "Error al generar el enlace de acceso. Intente de nuevo.",
    }, 500);
  }

  // ── 8. Registrar el uso exitoso en auditoría ──────────────────────────────
  await logAudit(adminClient, {
    action:       "impersonate_success",
    actor_id:     callerUserId,
    actor_email:  callerEmail,
    actor_role:   callerRole,
    target_id:    targetAuthUser.id,
    target_email: targetEmail,
    target_role:  targetRole,
    target_name:  targetProfile?.full_name ?? null,
    details:      {
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      ip:         req.headers.get("x-forwarded-for") ?? "unknown",
    },
  });

  // ── 9. Devolver los tokens al frontend ────────────────────────────────────
  // El frontend usará:
  //   await supabase.auth.setSession({
  //     access_token: data.access_token,
  //     refresh_token: data.refresh_token
  //   });
  return json({
    success:       true,
    access_token:  linkData.properties?.access_token  ?? null,
    refresh_token: linkData.properties?.refresh_token ?? null,
    hashed_token:  linkData.properties?.hashed_token  ?? null,
    action_link:   linkData.properties?.action_link   ?? null,
    target: {
      id:    targetAuthUser.id,
      email: targetEmail,
      role:  targetRole,
      name:  targetProfile?.full_name ?? null,
    },
    expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    warning:    "Esta sesión impersonada expira en 1 hora. Úsala con responsabilidad.",
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function logAudit(client: any, data: Record<string, unknown>) {
  try {
    await client.from("audit_logs").insert({
      ...data,
      created_at: new Date().toISOString(),
    });
  } catch {
    // La tabla audit_logs es opcional — no bloquear la operación si no existe
    console.warn("[admin-impersonate] No se pudo escribir en audit_logs:", data.action);
  }
}
