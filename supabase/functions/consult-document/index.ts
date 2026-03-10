import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { tipo, numero, school_id } = await req.json();

    if (!tipo || !numero) {
      return json({ success: false, error: "Faltan parámetros: tipo (dni|ruc) y numero" });
    }

    const tipoLimpio   = tipo.toLowerCase().trim();
    const numeroLimpio = numero.replace(/\D/g, "").trim();

    // ── Validaciones básicas ──────────────────────────────────────────────────
    if (tipoLimpio === "dni" && numeroLimpio.length !== 8) {
      return json({ success: false, error: "El DNI debe tener exactamente 8 dígitos." });
    }
    if (tipoLimpio === "ruc" && numeroLimpio.length !== 11) {
      return json({ success: false, error: "El RUC debe tener exactamente 11 dígitos." });
    }

    // ── Intentar con Nubefact primero (si hay configuración de sede) ──────────
    if (school_id) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      const { data: cfg } = await supabase
        .from("billing_config")
        .select("nubefact_ruta, nubefact_token")
        .eq("school_id", school_id)
        .maybeSingle();

      if (cfg?.nubefact_ruta && cfg?.nubefact_token) {
        const resultNubefact = await consultarNubefact(tipoLimpio, numeroLimpio, cfg.nubefact_ruta, cfg.nubefact_token);
        if (resultNubefact.success) {
          return json(resultNubefact);
        }
        // Si Nubefact falla → fallback a API pública
        console.warn("Nubefact falló, usando fallback público:", resultNubefact.error);
      }
    }

    // ── Fallback: APIs públicas gratuitas ─────────────────────────────────────
    const resultFallback = await consultarAPIPublica(tipoLimpio, numeroLimpio);
    return json(resultFallback);

  } catch (error) {
    console.error("consult-document ERROR:", error);
    return json({ success: false, error: String(error) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Consulta vía Nubefact (usa la misma ruta/token de facturación)
// ─────────────────────────────────────────────────────────────────────────────
async function consultarNubefact(
  tipo: string,
  numero: string,
  ruta: string,
  token: string
): Promise<Record<string, unknown>> {
  try {
    // Nubefact espera el mismo endpoint que usamos para generar comprobantes
    const body = tipo === "ruc"
      ? { operacion: "consultar_ruc",      ruc: numero }
      : { operacion: "consultar_dni", numero_documento: numero };

    const res = await fetch(ruta, {
      method: "POST",
      headers: {
        "Authorization": `Token token=${token}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok || data.errors) {
      return { success: false, error: data.errors || `Nubefact HTTP ${res.status}` };
    }

    // ── Normalizar respuesta Nubefact ──────────────────────────────────────
    if (tipo === "ruc") {
      return {
        success:       true,
        fuente:        "nubefact",
        tipo:          "ruc",
        numero:        numero,
        razon_social:  data.razon_social        || data.nombre             || "",
        nombre_comercial: data.nombre_comercial || "",
        direccion:     data.domicilio_fiscal     || data.direccion          || "",
        estado:        data.estado               || "",   // ACTIVO / BAJA
        condicion:     data.condicion            || "",   // HABIDO / NO HABIDO
        ubigeo:        data.ubigeo               || "",
        departamento:  data.departamento         || "",
        provincia:     data.provincia            || "",
        distrito:      data.distrito             || "",
        tipo_contribuyente: data.tipo_contribuyente || "",
        activo:        (data.estado as string || "").toUpperCase() === "ACTIVO",
      };
    } else {
      // DNI
      const nombre = [data.apellido_paterno, data.apellido_materno, data.nombres]
        .filter(Boolean).join(" ") || data.nombre_completo || "";
      return {
        success:          true,
        fuente:           "nubefact",
        tipo:             "dni",
        numero,
        razon_social:     nombre,
        nombre:           nombre,
        apellido_paterno: data.apellido_paterno || "",
        apellido_materno: data.apellido_materno || "",
        nombres:          data.nombres          || "",
        direccion:        "",
        codigo_verificacion: data.codigo_verificacion || "",
      };
    }
  } catch (err) {
    return { success: false, error: `Error conectando a Nubefact: ${String(err)}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallback: apis.net.pe (libre, sin autenticación)
// ─────────────────────────────────────────────────────────────────────────────
async function consultarAPIPublica(tipo: string, numero: string): Promise<Record<string, unknown>> {
  const url = tipo === "ruc"
    ? `https://api.apis.net.pe/v2/sunat/ruc?numero=${numero}`
    : `https://api.apis.net.pe/v2/reniec/dni?numero=${numero}`;

  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });

    if (!res.ok) {
      // Intentar v1
      const url1 = tipo === "ruc"
        ? `https://api.apis.net.pe/v1/ruc?numero=${numero}`
        : `https://api.apis.net.pe/v1/dni?numero=${numero}`;
      const res2 = await fetch(url1, { headers: { Accept: "application/json" } });
      if (!res2.ok) {
        return { success: false, error: `${tipo.toUpperCase()} no encontrado. Verifica que sea válido.` };
      }
      return normalizarAPIPublica(tipo, numero, await res2.json());
    }

    return normalizarAPIPublica(tipo, numero, await res.json());
  } catch (err) {
    return { success: false, error: `Sin conexión a la API pública: ${String(err)}` };
  }
}

function normalizarAPIPublica(tipo: string, numero: string, data: Record<string, unknown>): Record<string, unknown> {
  if (!data || data.error || (!data.razonSocial && !data.nombre && !data.nombreCompleto)) {
    return { success: false, error: `${tipo.toUpperCase()} no encontrado en los registros.` };
  }

  if (tipo === "ruc") {
    return {
      success:         true,
      fuente:          "apis.net.pe",
      tipo:            "ruc",
      numero:          data.ruc as string || numero,
      razon_social:    (data.razonSocial  || data.nombre || "") as string,
      nombre_comercial:(data.nombreComercial || "") as string,
      direccion:       buildDireccion(data),
      estado:          (data.estado     || "") as string,
      condicion:       (data.condicion  || "") as string,
      ubigeo:          (data.ubigeo     || data.codigoPostal || "") as string,
      departamento:    (data.departamento || "") as string,
      provincia:       (data.provincia  || "") as string,
      distrito:        (data.distrito   || "") as string,
      tipo_contribuyente: (data.tipoContribuyente || "") as string,
      activo:          (data.estado as string || "").toUpperCase() === "ACTIVO",
    };
  } else {
    const nombre = [data.apellidoPaterno, data.apellidoMaterno, data.nombres]
      .filter(Boolean).join(" ") || (data.nombre as string) || (data.nombreCompleto as string) || "";
    return {
      success:          true,
      fuente:           "apis.net.pe",
      tipo:             "dni",
      numero:           (data.dni as string) || numero,
      razon_social:     nombre,
      nombre,
      apellido_paterno: (data.apellidoPaterno || "") as string,
      apellido_materno: (data.apellidoMaterno || "") as string,
      nombres:          (data.nombres         || "") as string,
      direccion:        "",
      codigo_verificacion: (data.codigoVerificacion || "") as string,
    };
  }
}

function buildDireccion(data: Record<string, unknown>): string {
  if (data.direccion)        return data.direccion as string;
  if (data.domicilioFiscal)  return data.domicilioFiscal as string;
  const p: string[] = [];
  if (data.tipoVia)   p.push(`${data.tipoVia}`);
  if (data.nombreVia) p.push(`${data.nombreVia}`);
  if (data.numero)    p.push(`Nro. ${data.numero}`);
  if (data.interior)  p.push(`Int. ${data.interior}`);
  if (data.tipoZona)  p.push(`${data.tipoZona}`);
  if (data.codigoZona)p.push(`${data.codigoZona}`);
  return p.join(" ").trim();
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
