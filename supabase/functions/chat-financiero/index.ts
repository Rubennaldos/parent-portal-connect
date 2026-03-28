// @ts-nocheck — archivo Deno (Edge Function de Supabase)
// ============================================================
// EDGE FUNCTION: chat-financiero — FioBot v3 (Direct SQL)
//
// Conexión directa a PostgreSQL vía SUPABASE_DB_URL.
// Sin PostgREST, sin RPC, sin problemas de permisos.
// Validación de solo lectura en el propio Edge Function.
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Pool } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Pool de conexiones PostgreSQL (singleton reutilizable entre llamadas)
let _pool: Pool | null = null;
function getPool(): Pool {
  if (!_pool) {
    const dbUrl = Deno.env.get("SUPABASE_DB_URL");
    if (!dbUrl) throw new Error("SUPABASE_DB_URL no disponible");
    _pool = new Pool(dbUrl, 2, true);
  }
  return _pool;
}

// ──────────────────────────────────────────────────────────
// Validación de solo lectura
// ──────────────────────────────────────────────────────────
function validarSQLSeguro(sql: string): string | null {
  const upper = sql.trim().replace(/\s+/g, " ").toUpperCase();

  if (!upper.startsWith("SELECT ") && !upper.startsWith("WITH ")) {
    return "Solo se permiten consultas SELECT o WITH.";
  }

  const peligrosas = [
    /\bINSERT\b/, /\bUPDATE\b/, /\bDELETE\b/, /\bTRUNCATE\b/,
    /\bDROP\b/, /\bCREATE\b/, /\bALTER\b/, /\bGRANT\b/, /\bREVOKE\b/,
    /\bCOPY\b/, /\bEXECUTE\b/, /\bDO\s/, /\bCALL\s/,
    /;\s*\S/,  // múltiples sentencias
  ];

  for (const re of peligrosas) {
    if (re.test(upper)) return "Operación no permitida (solo lectura).";
  }

  return null; // OK
}

// ──────────────────────────────────────────────────────────
// Ejecutor directo SQL (sin RPC, sin wrapper)
// ──────────────────────────────────────────────────────────
async function ejecutarSQL(sql: string): Promise<string> {
  const errorValidacion = validarSQLSeguro(sql);
  if (errorValidacion) {
    return JSON.stringify({ error: errorValidacion });
  }

  let client;
  try {
    client = await getPool().connect();
    // Ejecutar directamente — la IA se encarga del LIMIT
    const result = await client.queryObject(sql);
    const filas = (result.rows ?? []).slice(0, 200);
    // BigInt (ej: COUNT()) no es serializable por JSON.stringify por defecto
    return JSON.stringify(filas, (_, v) => typeof v === "bigint" ? Number(v) : v);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: msg, sql: sql.slice(0, 400) });
  } finally {
    try { client?.release(); } catch { /* ok */ }
  }
}

// ──────────────────────────────────────────────────────────
// Esquema de la base de datos (contexto para la IA)
// ──────────────────────────────────────────────────────────
const SCHEMA_CONTEXT = `
## ESQUEMA DE BASE DE DATOS (PostgreSQL / Supabase — esquema "public")

### transactions
Compras del kiosco y deudas de almuerzo.
- id uuid PK
- student_id uuid → students.id
- teacher_id uuid → teacher_profiles.id
- school_id uuid → schools.id
- type text ('purchase' | 'recharge')
- amount numeric  (NEGATIVO=compra/deuda, POSITIVO=recarga)
- payment_status text ('pending' | 'paid' | 'cancelled')
- payment_method text
- description text
- metadata jsonb  ← metadata->>'lunch_order_id' NOT NULL = deuda de ALMUERZO
                    metadata->>'lunch_order_id' IS NULL  = compra KIOSCO
- created_at timestamptz
- is_deleted bool  ← siempre filtrar WHERE is_deleted = false

### students
- id uuid PK
- full_name text
- code text
- balance numeric  (negativo = debe al kiosco)
- school_id uuid → schools.id
- kiosk_disabled bool
- free_account bool
- parent_id uuid

### recharge_requests
Vouchers de recarga enviados por padres.
- id uuid PK
- student_id uuid → students.id
- amount numeric
- status text ('pending' | 'approved' | 'rejected')
- request_type text ('recharge' | 'lunch_payment' | 'debt_payment')
- payment_method text
- reference_code text
- school_id uuid → schools.id
- created_at timestamptz
- approved_at timestamptz
- approved_by uuid → profiles.id

### auditoria_vouchers
Análisis de IA sobre vouchers.
- id uuid PK
- id_cobranza uuid → recharge_requests.id
- banco_detectado text
- monto_detectado numeric
- nro_operacion text
- estado_ia text ('VALIDO' | 'SOSPECHOSO' | 'RECHAZADO')
- analisis_ia jsonb  (motivo, alertas, confianza)
- created_at timestamptz

### huella_digital_logs
Rastro de acciones críticas.
- id uuid PK
- usuario_id uuid → profiles.id
- accion text
- modulo text
- contexto jsonb
- school_id uuid
- creado_at timestamptz

### lunch_orders
Pedidos de almuerzo.
- id uuid PK
- student_id uuid → students.id
- order_date date
- status text ('pending' | 'confirmed' | 'delivered' | 'cancelled')
- payment_method text ('pagar_luego' = deuda)
- is_cancelled bool
- final_price numeric
- school_id uuid → schools.id
- created_at timestamptz

### schools
- id uuid PK, name text

### parent_profiles  (padres de familia — IMPORTANTE)
- id uuid PK
- user_id uuid  ← unión con students: students.parent_id = parent_profiles.user_id (NO .id)
- full_name text  (nombre completo del padre/madre)
- email text
- phone text
- school_id uuid → schools.id

### profiles  (admins/cajeros)
- id uuid PK, full_name text, role text, school_id uuid

### teacher_profiles
- id uuid PK, full_name text, school_id_1 uuid

## REGLAS CRÍTICAS (síguelas siempre)

FILTROS BASE para deudas (transactions):
  Deuda ALMUERZO pendiente: payment_status IN ('pending','partial') AND type='purchase' AND is_deleted=false AND metadata->>'lunch_order_id' IS NOT NULL
  Deuda KIOSCO pendiente:   payment_status IN ('pending','partial') AND type='purchase' AND is_deleted=false AND metadata->>'lunch_order_id' IS NULL
  SIEMPRE usa SUM(ABS(t.amount)) — los montos son negativos en la BD.
  NUNCA sumes almuerzo + kiosco en consultas separadas y luego operes manualmente.

QUERY CANÓNICA para deuda desglosada de un alumno (usar SIEMPRE para preguntas como "cuánto debe X" o "cuánto de almuerzo vs kiosco"):
  SELECT s.full_name,
    SUM(CASE WHEN t.metadata->>'lunch_order_id' IS NOT NULL THEN ABS(t.amount) ELSE 0 END) AS deuda_almuerzo,
    SUM(CASE WHEN t.metadata->>'lunch_order_id' IS NULL     THEN ABS(t.amount) ELSE 0 END) AS deuda_kiosco,
    SUM(ABS(t.amount)) AS deuda_total,
    MAX(t.created_at) AS ultima_transaccion
  FROM transactions t
  JOIN students s ON s.id = t.student_id
  WHERE t.payment_status IN ('pending','partial') AND t.type='purchase' AND t.is_deleted=false
    AND s.full_name ILIKE '%NOMBRE_ALUMNO%'
  GROUP BY s.id, s.full_name

QUERY CANÓNICA para top deudores:
  SELECT s.full_name,
    SUM(ABS(t.amount)) AS deuda_total,
    SUM(CASE WHEN t.metadata->>'lunch_order_id' IS NOT NULL THEN ABS(t.amount) ELSE 0 END) AS deuda_almuerzo,
    SUM(CASE WHEN t.metadata->>'lunch_order_id' IS NULL     THEN ABS(t.amount) ELSE 0 END) AS deuda_kiosco
  FROM transactions t
  JOIN students s ON s.id = t.student_id
  WHERE t.payment_status IN ('pending','partial') AND t.type='purchase' AND t.is_deleted=false
  GROUP BY s.id, s.full_name ORDER BY deuda_total DESC LIMIT 10

QUERY CANÓNICA para deuda total de almuerzos (todas sedes):
  SELECT SUM(ABS(amount)) AS total FROM transactions
  WHERE payment_status IN ('pending','partial') AND type='purchase' AND is_deleted=false
    AND metadata->>'lunch_order_id' IS NOT NULL

QUERY CANÓNICA para datos del padre de un alumno (por nombre parcial del alumno):
  SELECT s.full_name AS alumno, s.id AS alumno_id,
    pp.full_name AS padre_nombre, pp.email AS padre_email, pp.phone AS padre_telefono,
    sc.name AS sede
  FROM students s
  LEFT JOIN parent_profiles pp ON pp.user_id = s.parent_id
  LEFT JOIN schools sc ON sc.id = s.school_id
  WHERE s.full_name ILIKE '%NOMBRE_ALUMNO%'
  LIMIT 5

QUERY CANÓNICA para deuda + datos del padre en una sola consulta (usar cuando preguntan "cuánto debe X y cómo contactar al padre"):
  SELECT s.full_name AS alumno, s.id AS alumno_id,
    pp.full_name AS padre_nombre, pp.email AS padre_email, pp.phone AS padre_telefono,
    SUM(ABS(t.amount)) AS deuda_total,
    SUM(CASE WHEN t.metadata->>'lunch_order_id' IS NOT NULL THEN ABS(t.amount) ELSE 0 END) AS deuda_almuerzo,
    SUM(CASE WHEN t.metadata->>'lunch_order_id' IS NULL     THEN ABS(t.amount) ELSE 0 END) AS deuda_kiosco,
    COUNT(CASE WHEN t.metadata->>'lunch_order_id' IS NOT NULL THEN 1 END) AS cantidad_almuerzos,
    MAX(t.created_at) AS ultima_transaccion
  FROM transactions t
  JOIN students s ON s.id = t.student_id
  LEFT JOIN parent_profiles pp ON pp.user_id = s.parent_id
  WHERE t.payment_status IN ('pending','partial') AND t.type='purchase' AND t.is_deleted=false
    AND s.full_name ILIKE '%NOMBRE_ALUMNO%'
  GROUP BY s.id, s.full_name, pp.full_name, pp.email, pp.phone

QUERY CANÓNICA para contar almuerzos consumidos (pagados o pendientes):
  SELECT s.full_name, COUNT(lo.id) AS total_almuerzos,
    SUM(COALESCE(lo.final_price, 0)) AS monto_total_almuerzos
  FROM lunch_orders lo
  JOIN students s ON s.id = lo.student_id
  WHERE lo.is_cancelled = false
    AND s.full_name ILIKE '%NOMBRE_ALUMNO%'
  GROUP BY s.id, s.full_name

IMPORTANTE: Cuando en una pregunta de seguimiento el usuario ya mencionó un alumno (ej: "y cuál es el nombre de sus padres"), mantén el contexto del alumno anterior y usa su nombre para filtrar. Nunca respondas "no encontré datos" sin haber intentado el query.
`;

// ──────────────────────────────────────────────────────────
// System Prompt
// ──────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres FioBot, el auditor financiero experto y amigable de UFRASAC.

Tienes acceso DIRECTO a la base de datos. Para cada pregunta financiera, usa la herramienta \`consultar_base_de_datos\` generando el SQL SELECT que necesites. Si el primer SQL da error, analiza el error y corrígelo.

${SCHEMA_CONTEXT}

## INSTRUCCIONES
- Consulta la base de datos antes de responder. Nunca inventes cifras.
- Si hay un error SQL, léelo, corrige el query y reintenta.
- Presenta resultados con montos en S/ (soles), nombres completos y totales claros.
- Lenguaje coloquial está bien: "¿quién me debe?", "¿cuánto me deben en almuerzos?" → convierte a SQL correcto.

## BLOQUEO
Solo niégate si te piden algo ajeno al negocio (recetas, clima, chistes).`;

// ──────────────────────────────────────────────────────────
// Herramienta única Text-to-SQL
// ──────────────────────────────────────────────────────────
const TOOLS = [
  {
    type: "function",
    function: {
      name: "consultar_base_de_datos",
      description:
        "Ejecuta un SQL SELECT directo en la base de datos de UFRASAC. Úsala para CUALQUIER pregunta sobre deudas, saldos, vouchers, alumnos, fraudes o estadísticas.",
      parameters: {
        type: "object",
        properties: {
          sql: {
            type: "string",
            description: "Consulta SQL SELECT válida. Solo lectura. Usa JOINs, GROUP BY, SUM, COUNT según necesites.",
          },
        },
        required: ["sql"],
      },
    },
  },
];

// ──────────────────────────────────────────────────────────
// Handler principal
// ──────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    // ── Validar JWT ──────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    let userId: string | null = null;
    try {
      const parts = token.split(".");
      const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      userId = payload.sub ?? null;
    } catch {
      return new Response(JSON.stringify({ error: "Token inválido" }), {
        status: 401, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // ── Verificar rol ─────────────────────────────────────
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: profile } = await db
      .from("profiles").select("role").eq("id", userId).single();

    if (!profile || !["admin_general", "superadmin"].includes(profile.role)) {
      return new Response(
        JSON.stringify({ error: "Acceso denegado. Solo para administradores generales." }),
        { status: 403, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // ── Parsear body ─────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const messages: Array<{ role: string; content: string }> = Array.isArray(body.messages)
      ? body.messages : [];

    if (messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages es requerido" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) throw new Error("OPENAI_API_KEY no configurada");

    // ── Bucle de conversación ────────────────────────────
    const historial: unknown[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages.slice(-10),
    ];

    let respuestaFinal = "";
    let ultimoError = "";
    const MAX_ROUNDS = 6;

    for (let ronda = 0; ronda < MAX_ROUNDS; ronda++) {
      const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: historial,
          tools: TOOLS,
          tool_choice: "auto",
          max_tokens: 1200,
          temperature: 0.1,
        }),
      });

      const resultado = await openaiRes.json();
      if (!openaiRes.ok) throw new Error(`OpenAI: ${resultado.error?.message ?? "error"}`);

      const message = resultado.choices?.[0]?.message;
      if (!message) break;

      // Sin tool_calls → respuesta final en texto
      if (!message.tool_calls || message.tool_calls.length === 0) {
        respuestaFinal = message.content ?? "";
        break;
      }

      historial.push(message);

      for (const toolCall of message.tool_calls) {
        let fnArgs: Record<string, unknown> = {};
        try { fnArgs = JSON.parse(toolCall.function.arguments); } catch { /* ok */ }

        const sql = typeof fnArgs.sql === "string" ? fnArgs.sql : "";
        const resultadoSQL = sql
          ? await ejecutarSQL(sql)
          : JSON.stringify({ error: "SQL vacío" });

        // Guardar el último error para diagnóstico
        try {
          const parsed = JSON.parse(resultadoSQL);
          if (parsed?.error) ultimoError = `${parsed.error} | SQL: ${(parsed.sql ?? sql).slice(0, 200)}`;
        } catch { /* ok */ }

        historial.push({ role: "tool", tool_call_id: toolCall.id, content: resultadoSQL });
      }
    }

    // Si la IA agotó los intentos sin responder en texto, mostrar el error real
    if (!respuestaFinal) {
      respuestaFinal = ultimoError
        ? `⚠️ No pude obtener los datos. Error de base de datos:\n\`${ultimoError}\``
        : "No pude generar una respuesta. Intenta reformular tu pregunta.";
    }

    return new Response(JSON.stringify({ respuesta: respuestaFinal }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
