// @ts-nocheck — archivo Deno (Edge Function de Supabase), no usar TypeScript de Node.js
// ============================================================
// EDGE FUNCTION: analizar-voucher
// Llama a OpenAI GPT-4o Vision para analizar un comprobante
// de pago peruano y devuelve un veredicto estructurado.
//
// Corre en el servidor (Deno) — la API Key de OpenAI NUNCA
// llega al navegador del usuario.
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ──────────────────────────────────────────────────────────
// Tipos
// ──────────────────────────────────────────────────────────

interface AnalisisIA {
  monto: number | null;
  /** Código ISO de moneda: "PEN" para Soles, "USD" para dólares, etc. */
  moneda_detectada: string | null;
  banco: string | null;
  nro_operacion: string | null;
  fecha: string | null;
  /** Nombre exacto de la empresa o persona que RECIBIÓ el dinero */
  destinatario_detectado: string | null;
  estado: "VALIDO" | "SOSPECHOSO" | "RECHAZADO";
  confianza: number;         // 0.0 – 1.0
  motivo: string;            // Por qué se asignó ese estado
  alertas: string[];         // Lista de banderas rojas encontradas
  datos_extraidos: Record<string, string>; // Texto crudo extraído del comprobante
  /** Análisis visual de manipulación digital por zona */
  analisis_visual?: {
    zona_monto: string;
    zona_fecha: string;
    zona_destinatario: string;
    anomalias_detectadas: string[];
  };
}

// ──────────────────────────────────────────────────────────
// Prompt base para la IA
// ──────────────────────────────────────────────────────────

const PROMPT_SISTEMA = `Eres un auditor forense experto en comprobantes de pago bancarios peruanos y en detección de fraude digital.
Tu trabajo es analizar imágenes de vouchers de transferencia (Yape, Plin, BCP, Interbank, BBVA, Scotiabank, etc.) y detectar si son auténticos o han sido editados con software de edición de imágenes (Photoshop, GIMP, aplicaciones móviles de edición, etc.).

RESPONDE ÚNICAMENTE con un JSON válido, sin texto adicional, sin markdown, sin comentarios.

El JSON debe tener exactamente esta estructura:
{
  "monto": <número decimal o null>,
  "moneda_detectada": <código ISO de la moneda tal como aparece en el comprobante. En Perú siempre debe ser "PEN" o mostrar el símbolo "S/". Si ves "$", "USD", "CLP", "BOB", "COP" u otra moneda extranjera, devuélvela tal cual. Si no se puede determinar, devuelve null>,
  "banco": <nombre del banco/app como string o null>,
  "nro_operacion": <código único de la operación como string o null>,
  "fecha": <fecha y hora en formato ISO 8601 o null>,
  "destinatario_detectado": <nombre EXACTO de la empresa o persona que RECIBIÓ el dinero, tal como aparece en el comprobante. En Yape aparece como el nombre en grande sobre el monto o debajo de "Enviaste a". En Plin aparece como "Destino". En transferencias bancarias aparece como "Beneficiario" o "Nombre". Devuelve el texto tal cual, sin modificar. Si no se puede leer con claridad, devuelve null>,
  "estado": <"VALIDO" | "SOSPECHOSO" | "RECHAZADO">,
  "confianza": <número entre 0.0 y 1.0>,
  "motivo": <explicación breve del estado asignado>,
  "alertas": [<lista de señales de alerta encontradas, puede ser vacía []>],
  "datos_extraidos": {<todos los textos relevantes extraídos del comprobante>},
  "analisis_visual": {
    "zona_monto": <describe lo que ves en la zona del monto: tipografía, consistencia de píxeles, si el texto parece pegado sobre el fondo>,
    "zona_fecha": <describe lo que ves en la zona de la fecha: consistencia con el resto del comprobante, bordes alrededor del texto>,
    "zona_destinatario": <describe lo que ves en la zona del nombre del destinatario>,
    "anomalias_detectadas": [<lista de anomalías visuales específicas: artefactos de compresión JPEG inconsistentes, halos alrededor de texto, diferencia de resolución entre fondo y texto superpuesto, sombras artificiales, etc.>]
  }
}

═══════════════════════════════════════════════════════
ANÁLISIS FORENSE VISUAL OBLIGATORIO — LEE CON ATENCIÓN
═══════════════════════════════════════════════════════
Antes de evaluar los datos, DEBES inspeccionar visualmente estas zonas críticas con máxima atención:

ZONA DEL MONTO (el número más grande del comprobante):
- ¿La tipografía del monto coincide exactamente con la del resto de números del comprobante?
- ¿Hay artefactos de compresión JPEG diferentes entre el fondo y el texto del monto?
- ¿Hay bordes o halos alrededor de los dígitos que indiquen que fueron pegados?
- ¿El espaciado entre dígitos es consistente con el estilo del banco?

ZONA DE LA FECHA:
- ¿La fecha muestra el mismo estilo tipográfico que el resto del comprobante?
- ¿Los píxeles alrededor de los números de la fecha son homogéneos?
- ¿Hay diferencia de nitidez entre la fecha y los otros campos?

ZONA DEL DESTINATARIO:
- ¿El nombre del destinatario tiene la misma fuente que los demás campos de texto?

REGLA FORENSE PRINCIPAL:
Si detectas CUALQUIER inconsistencia visual (diferente compresión JPEG, halo de píxeles, tipografía distinta, cambio de resolución en alguna zona), marca el estado como RECHAZADO y detalla las anomalías en "anomalias_detectadas" y en "alertas".

═══════════════════════════════════════════════════════
CRITERIOS DE ESTADO
═══════════════════════════════════════════════════════
- VALIDO: imagen clara, moneda en Soles (S/), datos consistentes, sin signos de edición, número de operación presente
- SOSPECHOSO: moneda no identificable, datos inconsistentes, imagen borrosa, falta información clave
- RECHAZADO: moneda extranjera detectada, signos de edición visual, fechas imposibles, duplicado

SEÑALES DE FRAUDE ADICIONALES:
- Texto con diferentes tipografías o tamaños en el mismo campo
- Bordes o sombras alrededor de números (indican pegado de texto)
- Fecha en el voucher POSTERIOR a la hora en que fue subido
- Montos con centavos extraños (ej: S/ 100.001)
- Logo o color del banco diferente al real
- Resolución inconsistente entre el fondo y el texto de los números
- Moneda que NO sea Soles peruanos (S/ o PEN)

IMPORTANTE sobre destinatario_detectado:
- En Yape: busca el nombre grande que aparece sobre o cerca del monto (ej: "UFRASAC CATERING SAC")
- En Plin: busca el campo "Destino:" o el nombre resaltado
- En BCP/Interbank/BBVA: busca "Beneficiario:" o "A nombre de:"
- Copia el nombre EXACTAMENTE como aparece
- Si el comprobante no muestra a quién se le pagó, es una señal SOSPECHOSA`;

// ──────────────────────────────────────────────────────────
// Handler principal
// ──────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  // Capturar IP real del cliente (para el log de huella digital)
  const ipCliente =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "desconocida";

  try {
    // ── 1. Validar autenticación ──
    // Como verify_jwt = true en config.toml, el gateway de Supabase YA validó
    // la firma del JWT antes de que llegue aquí. Solo decodificamos el payload
    // para obtener el user_id sin una llamada extra a auth.getUser().
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return json({ error: "No autorizado — falta token de sesión" }, 401);
    }

    const token = authHeader.replace("Bearer ", "").trim();
    let userId: string;
    try {
      const payloadBase64 = token.split(".")[1];
      // Decodificar Base64URL → JSON
      const payloadJson = atob(payloadBase64.replace(/-/g, "+").replace(/_/g, "/"));
      const payload = JSON.parse(payloadJson);
      userId = payload.sub;
      if (!userId) throw new Error("sub vacío");
    } catch {
      return json({ error: "Token malformado — vuelve a iniciar sesión" }, 401);
    }

    // Crear cliente con service_role para leer perfiles y escribir resultados
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verificar que el usuario tiene rol autorizado para auditar vouchers
    const { data: perfil, error: perfilError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();

    const ROLES_AUTORIZADOS = ["admin_general", "superadmin", "gestor_unidad"];
    if (perfilError || !perfil || !ROLES_AUTORIZADOS.includes(perfil.role)) {
      return json({ error: "Acceso denegado — solo administradores autorizados pueden usar este módulo" }, 403);
    }

    // ── 2. Obtener datos del request ──
    const body = await req.json();
    const { imageUrl, idCobranza, schoolId, fechaSubida, hashImagen, usuarioId } = body;

    if (!imageUrl) {
      return json({ error: "Se requiere imageUrl para analizar el voucher" }, 400);
    }

    // Hora de subida para que la IA evalúe correctamente fechas "futuras"
    const horaSubida = fechaSubida
      ? new Date(fechaSubida).toLocaleString("es-PE", { timeZone: "America/Lima" })
      : new Date().toLocaleString("es-PE", { timeZone: "America/Lima" });

    // ── 3. Obtener la API Key de OpenAI ──
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return json({ error: "OPENAI_API_KEY no configurada en los secretos de Supabase" }, 500);
    }

    // ── 4. Llamar a OpenAI GPT-4o Vision ──
    console.log(`🔍 Analizando voucher: ${imageUrl.substring(0, 60)}...`);

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 1000,
        temperature: 0.1, // Baja temperatura = respuestas más consistentes y precisas
        messages: [
          {
            role: "system",
            content: PROMPT_SISTEMA,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Analiza este comprobante de pago peruano y responde SOLO con el JSON solicitado.

HORA DE SUBIDA DEL COMPROBANTE (hora de Lima, Perú): ${horaSubida}

REGLA CRÍTICA SOBRE FECHAS:
- Es completamente NORMAL que el voucher muestre una hora ANTERIOR a la hora de subida. El padre paga y luego sube el comprobante, pueden pasar minutos o hasta horas.
- Solo es sospechoso si la fecha/hora en el voucher es POSTERIOR a la hora de subida (por ejemplo: hora de subida 11:10 p.m. y el voucher dice 11:15 p.m. — eso es imposible porque no puedes subir un comprobante antes de que ocurra el pago).
- Una diferencia de minutos o horas donde el voucher es MÁS ANTIGUO que la hora de subida es totalmente normal. NO lo marques como fecha futura.`,
              },
              {
                type: "image_url",
                image_url: {
                  url: imageUrl,
                  detail: "high", // Alta resolución para detectar ediciones
                },
              },
            ],
          },
        ],
      }),
    });

    if (!openaiResponse.ok) {
      const errorBody = await openaiResponse.text();
      console.error("❌ Error de OpenAI:", errorBody);
      return json({ error: `Error de OpenAI: ${openaiResponse.status} — ${errorBody}` }, 502);
    }

    const openaiData = await openaiResponse.json();
    const contenidoRaw = openaiData.choices?.[0]?.message?.content ?? "";

    console.log("📋 Respuesta cruda de OpenAI:", contenidoRaw.substring(0, 200));

    // ── 5. Parsear el JSON devuelto por la IA ──
    let analisis: AnalisisIA;
    try {
      // Limpiar posibles bloques de markdown que GPT a veces añade
      const jsonLimpio = contenidoRaw
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/gi, "")
        .trim();
      analisis = JSON.parse(jsonLimpio);
    } catch (parseError) {
      console.error("❌ GPT no devolvió JSON válido:", contenidoRaw);
      // Si no se puede parsear, marcar como SOSPECHOSO para revisión manual
      analisis = {
        monto: null,
        moneda_detectada: null,
        banco: null,
        nro_operacion: null,
        fecha: null,
        destinatario_detectado: null,
        estado: "SOSPECHOSO",
        confianza: 0,
        motivo: "La IA no pudo procesar el comprobante correctamente. Requiere revisión manual.",
        alertas: ["Error al parsear respuesta de IA — requiere revisión manual"],
        datos_extraidos: { respuesta_cruda: contenidoRaw.substring(0, 500) },
      };
    }

    // ── 6. Enriquecer el analisis_ia con metadatos de auditoría ──
    const analisisCompleto = {
      ...analisis,
      procesado_en: new Date().toISOString(),
      modelo_ia: "gpt-4o",
      ip_solicitante: ipCliente,
      tokens_usados: openaiData.usage?.total_tokens ?? null,
      id_cobranza_procesada: idCobranza ?? null,
    };

    console.log(`✅ Análisis completado: estado=${analisis.estado}, confianza=${analisis.confianza}`);

    // ── 7. Guardar en auditoria_vouchers con service_role (sin RLS) ──
    // Se guarda SIEMPRE: VALIDO, SOSPECHOSO y RECHAZADO quedan registrados.
    // Si el nro_operacion ya existe (análisis previo), se ACTUALIZA el registro
    // existente con el nuevo id_cobranza para que el trigger de aprobación lo encuentre.
    let auditoriaId: string | null = null;
    let errorGuardado: string | null = null;

    try {
      const { data: inserted, error: insertError } = await supabase
        .from("auditoria_vouchers")
        .insert({
          id_cobranza: idCobranza ?? null,
          url_imagen: imageUrl,
          banco_detectado: analisis.banco ?? null,
          monto_detectado: analisis.monto ?? null,
          nro_operacion: analisis.nro_operacion ?? null,
          fecha_pago_detectada: analisis.fecha ?? null,
          hash_imagen: hashImagen ?? null,
          estado_ia: analisis.estado,
          analisis_ia: analisisCompleto,
          school_id: schoolId ?? null,
          subido_por: usuarioId ?? null,
        })
        .select("id")
        .single();

      if (insertError) {
        // Código 23505 = unique_violation en PostgreSQL
        const esConflictoUnico =
          insertError.code === "23505" ||
          (insertError.message ?? "").includes("duplicate") ||
          (insertError.message ?? "").includes("unique");

        if (esConflictoUnico && analisis.nro_operacion) {
          // El nro_operacion ya existe de un análisis previo.
          // Actualizamos ese registro para vincular el id_cobranza actual.
          console.log(`🔄 nro_operacion duplicado — actualizando registro existente con id_cobranza=${idCobranza}`);

          // Buscar el registro existente (excluyendo RECHAZADO, que no tiene índice único)
          const { data: existente } = await supabase
            .from("auditoria_vouchers")
            .select("id")
            .eq("nro_operacion", analisis.nro_operacion)
            .neq("estado_ia", "RECHAZADO")
            .order("creado_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (existente) {
            const { error: updateErr } = await supabase
              .from("auditoria_vouchers")
              .update({
                id_cobranza: idCobranza ?? null,
                estado_ia: analisis.estado,
                analisis_ia: analisisCompleto,
                url_imagen: imageUrl,
              })
              .eq("id", existente.id);

            if (updateErr) {
              console.error("❌ Error actualizando registro existente:", JSON.stringify(updateErr));
              errorGuardado = updateErr.message;
            } else {
              auditoriaId = existente.id;
              console.log(`✅ Registro existente actualizado: ID=${auditoriaId}`);
            }
          } else {
            console.error("❌ No se encontró registro previo para actualizar");
            errorGuardado = insertError.message;
          }
        } else {
          console.error("❌ Error al guardar en auditoria_vouchers:", JSON.stringify(insertError));
          errorGuardado = insertError.message;
        }
      } else {
        auditoriaId = inserted?.id ?? null;
        console.log(`💾 Registro guardado en auditoria_vouchers: ID=${auditoriaId}, estado=${analisis.estado}`);
      }
    } catch (dbErr) {
      const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
      console.error("❌ Excepción al guardar en auditoria_vouchers:", msg);
      errorGuardado = msg;
    }

    // ── 8. Devolver resultado al cliente ──
    return json({
      ok: true,
      auditoriaId,
      errorGuardado,
      estado_ia: analisis.estado,
      banco_detectado: analisis.banco,
      monto_detectado: analisis.monto,
      moneda_detectada: analisis.moneda_detectada ?? null,
      nro_operacion: analisis.nro_operacion,
      fecha_pago_detectada: analisis.fecha,
      destinatario_detectado: analisis.destinatario_detectado ?? null,
      analisis_ia: analisisCompleto,
      ip_detectada: ipCliente,
    });

  } catch (err: unknown) {
    const mensaje = err instanceof Error ? err.message : String(err);
    console.error("❌ Error inesperado en analizar-voucher:", mensaje);
    return json({ error: `Error interno: ${mensaje}` }, 500);
  }
});

// ── Helper ──
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
