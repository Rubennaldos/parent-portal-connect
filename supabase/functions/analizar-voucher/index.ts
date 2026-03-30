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
- Montos con centavos extraños (ej: S/ 100.001)
- Logo o color del banco diferente al real
- Resolución inconsistente entre el fondo y el texto de los números
- Moneda que NO sea Soles peruanos (S/ o PEN)

NOTA IMPORTANTE SOBRE FECHAS: NO evalúes si la fecha del comprobante es anterior o posterior a la hora actual. La validación de fechas la realiza el sistema por separado con comparación UTC exacta. Tu trabajo es SOLO detectar si la fecha fue editada visualmente (píxeles inconsistentes, diferente tipografía, halos alrededor de los números de la fecha).

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

    const ROLES_AUTORIZADOS = [
      "admin_general", "superadmin", "gestor_unidad",
      "admin_sede", "supervisor_red"
    ];
    if (perfilError || !perfil || !ROLES_AUTORIZADOS.includes(perfil.role)) {
      return json({ error: "Acceso denegado — solo administradores autorizados pueden usar este módulo" }, 403);
    }

    // ── 2. Obtener datos del request ──
    const body = await req.json();
    const { imageUrl, idCobranza, schoolId, fechaSubida, hashImagen, usuarioId } = body;

    if (!imageUrl) {
      return json({ error: "Se requiere imageUrl para analizar el voucher" }, 400);
    }

    // Hora de subida para mostrar contexto al admin (solo informativa para la IA)
    // La comparación real de fechas se hace en código más abajo, con UTC puro
    const uploadTimeUTC = fechaSubida ? new Date(fechaSubida) : new Date();
    const horaSubida = uploadTimeUTC.toLocaleString("es-PE", { timeZone: "America/Lima" });

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

CONTEXTO: Este voucher fue enviado el ${horaSubida} (hora de Lima, Perú). El pago puede haberse realizado minutos u horas antes — eso es completamente normal.

IMPORTANTE: NO evalúes si la fecha del voucher es anterior o posterior al envío. El sistema valida eso automáticamente con UTC. Tu única tarea con la fecha es: ¿fue editada visualmente? Extrae la fecha tal como aparece en la imagen (campo "fecha" del JSON).`,
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
      console.error("❌ GPT no devolvió JSON válido:", contenidoRaw.substring(0, 200));

      // ── Intento de extracción parcial por regex como fallback ──
      // Si GPT devolvió texto plano (no JSON), intentamos rescatar datos básicos.
      const extractMonto = (t: string) => {
        const m = t.match(/S\/\s*([\d,]+\.?\d*)/i);
        return m ? parseFloat(m[1].replace(",", "")) : null;
      };
      const extractNroOp = (t: string) => {
        const m = t.match(/\b(\d{6,15})\b/);
        return m ? m[1] : null;
      };

      const montoExtraido = extractMonto(contenidoRaw);
      const nroExtraido   = extractNroOp(contenidoRaw);

      // Detectar si GPT rechazó analizar por política (imagen de contenido)
      const esPoliticaGPT = contenidoRaw.toLowerCase().includes("i'm sorry") ||
        contenidoRaw.toLowerCase().includes("i cannot") ||
        contenidoRaw.toLowerCase().includes("lo siento") ||
        contenidoRaw.toLowerCase().includes("no puedo");

      const motivoFallback = esPoliticaGPT
        ? "GPT rechazó analizar la imagen (política de contenido). Revisar manualmente si la imagen es legible."
        : "La IA devolvió una respuesta que no se pudo procesar (error de parseo). Intentar re-analizar o revisar manualmente.";

      analisis = {
        monto: montoExtraido,
        moneda_detectada: null,
        banco: null,
        nro_operacion: nroExtraido,
        fecha: null,
        destinatario_detectado: null,
        estado: "SOSPECHOSO",
        confianza: 0,
        motivo: motivoFallback,
        alertas: [
          esPoliticaGPT
            ? "GPT rechazó analizar por política de contenido — re-intentar o revisar manual"
            : "Respuesta de IA no parseada — re-intentar el análisis puede resolver esto",
        ],
        datos_extraidos: {
          respuesta_cruda: contenidoRaw.substring(0, 500),
          extraccion_fallback: (montoExtraido || nroExtraido)
            ? `Monto rescatado: ${montoExtraido ?? "—"} | N° rescatado: ${nroExtraido ?? "—"}`
            : "No se pudo extraer datos parciales",
        },
      };
    }

    // ── 5b. Comparación N° operación cliente vs IA ──────────────────────
    // El padre ingresa manualmente su N° de operación al enviar la recarga.
    // La IA extrae el N° del comprobante de la imagen.
    // Si NO coinciden → alerta de posible discrepancia.
    // Normalizamos eliminando espacios, guiones y puntos antes de comparar.
    if (idCobranza && analisis.nro_operacion) {
      try {
        const { data: cobranza } = await supabase
          .from("recharge_requests")
          .select("reference_code")
          .eq("id", idCobranza)
          .maybeSingle();

        if (cobranza?.reference_code) {
          const normalizar = (s: string) =>
            s.replace(/[\s\-\.\(\)]/g, "").toUpperCase();

          const refCliente = normalizar(cobranza.reference_code);
          const refIA      = normalizar(analisis.nro_operacion);

          if (refCliente && refIA && refCliente !== refIA) {
            const alertaNro = `N° del padre (${cobranza.reference_code}) ≠ N° en imagen (${analisis.nro_operacion}) — verificar`;
            analisis.alertas = [...(analisis.alertas ?? []), alertaNro];

            if (analisis.estado === "VALIDO") {
              analisis.estado = "SOSPECHOSO";
              analisis.motivo =
                `Discrepancia en N° de operación: el padre ingresó "${cobranza.reference_code}" ` +
                `pero el voucher muestra "${analisis.nro_operacion}". Revisar si es un error de tipeo.`;
            }
            console.warn(`⚠️ N° discrepante: cliente=${refCliente}, voucher=${refIA}`);
          } else if (refCliente && refIA && refCliente === refIA) {
            console.log(`✅ N° operación coincide: ${refIA}`);
          }
        }
      } catch (nroErr) {
        console.warn("⚠️ No se pudo comparar N° de operación:", nroErr);
      }
    }
    // ── Fin comparación N° operación ────────────────────────────────────

    // ── 5d. Validación de fecha en código puro (UTC vs UTC) ─────────────
    // La IA NO hace esta comparación — nosotros sí, con math exacto.
    // Si el voucher tiene una fecha genuinamente futura (>15 min después del envío),
    // lo marcamos SOSPECHOSO sin depender de que GPT interprete timezones.
    if (analisis.fecha) {
      try {
        let voucherMs: number;
        const fechaStr = analisis.fecha.trim();

        // GPT devuelve ISO 8601. Si no trae timezone, asumimos Lima (UTC-5)
        const tieneZona = fechaStr.endsWith("Z") ||
          /[+-]\d{2}:\d{2}$/.test(fechaStr);

        if (tieneZona) {
          voucherMs = new Date(fechaStr).getTime();
        } else {
          // Sin zona horaria → asumir hora de Lima (UTC-5) para parsear correctamente
          voucherMs = new Date(fechaStr + "-05:00").getTime();
        }

        const uploadMs = uploadTimeUTC.getTime();
        // 4 horas de tolerancia: cubre transferencias bancarias programadas para más tarde
        // (BCP, Interbank, BBVA permiten agendar pagos y el voucher muestra la hora futura)
        const MARGEN_MS = 4 * 60 * 60 * 1000;
        // Cap de 36 horas: más allá de eso es casi seguro un error de parseo del formato de fecha
        const CAP_MAX_MS = 36 * 60 * 60 * 1000;

        const desfaseMs = voucherMs - uploadMs;

        if (!isNaN(voucherMs) && desfaseMs > MARGEN_MS && desfaseMs < CAP_MAX_MS) {
          // El voucher muestra una fecha notablemente posterior al envío — sospechoso
          const minutosDesfase = Math.round(desfaseMs / 60000);
          analisis.alertas = analisis.alertas ?? [];
          analisis.alertas.push(
            `Fecha del comprobante posterior a la hora de subida (${minutosDesfase} min de desfase)`
          );
          if (analisis.estado === "VALIDO") {
            analisis.estado = "SOSPECHOSO";
            analisis.motivo = `Datos visuales válidos, pero la fecha del comprobante (${fechaStr}) es ${minutosDesfase} min posterior al envío. Si agendaste una transferencia para más tarde, puede ignorarse.`;
          }
          console.warn(
            `⚠️ Fecha futura detectada: voucher=${fechaStr}, upload=${uploadTimeUTC.toISOString()}, desfase=${minutosDesfase}min`
          );
        } else if (!isNaN(voucherMs)) {
          console.log(
            `✅ Fecha del voucher OK: voucher=${fechaStr}, upload=${uploadTimeUTC.toISOString()}, desfase=${Math.round(desfaseMs / 60000)}min`
          );
        }
      } catch (dateErr) {
        console.warn("⚠️ No se pudo comparar fecha del voucher:", dateErr);
      }
    }
    // ── Fin validación de fecha ──────────────────────────────────────────

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
    // ESTRATEGIA ANTI-DUPLICADOS:
    //   1. ANTES de insertar, buscar si ya existe un registro con el mismo nro_operacion
    //      (incluyendo RECHAZADO — antes este caso creaba duplicados).
    //   2. Si existe → ACTUALIZAR ese registro (nunca crear otro).
    //   3. Si NO existe → INSERTAR nuevo.
    // Esto garantiza 1 registro por nro_operacion, sin importar cuántas veces se analice.
    let auditoriaId: string | null = null;
    let errorGuardado: string | null = null;

    try {
      // ── Paso 7a: Buscar registro previo por nro_operacion (TODOS los estados) ──
      let registroPrevioId: string | null = null;
      if (analisis.nro_operacion) {
        const { data: previo } = await supabase
          .from("auditoria_vouchers")
          .select("id")
          .eq("nro_operacion", analisis.nro_operacion)
          .order("creado_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        registroPrevioId = previo?.id ?? null;
      }

      // También buscar por id_cobranza si está disponible y no encontramos por nro_operacion
      if (!registroPrevioId && idCobranza) {
        const { data: previoCobranza } = await supabase
          .from("auditoria_vouchers")
          .select("id")
          .eq("id_cobranza", idCobranza)
          .order("creado_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        registroPrevioId = previoCobranza?.id ?? null;
      }

      if (registroPrevioId) {
        // ── Paso 7b: Actualizar registro existente (anti-duplicado) ──
        console.log(`🔄 Registro previo encontrado (ID=${registroPrevioId}) — actualizando en lugar de insertar`);
        const { error: updateErr } = await supabase
          .from("auditoria_vouchers")
          .update({
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
          .eq("id", registroPrevioId);

        if (updateErr) {
          console.error("❌ Error actualizando registro previo:", JSON.stringify(updateErr));
          errorGuardado = updateErr.message;
        } else {
          auditoriaId = registroPrevioId;
          console.log(`✅ Registro actualizado (sin duplicado): ID=${auditoriaId}, estado=${analisis.estado}`);
        }
      } else {
        // ── Paso 7c: Insertar nuevo registro ──
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
          console.error("❌ Error insertando en auditoria_vouchers:", JSON.stringify(insertError));
          errorGuardado = insertError.message;
        } else {
          auditoriaId = inserted?.id ?? null;
          console.log(`💾 Nuevo registro guardado: ID=${auditoriaId}, estado=${analisis.estado}`);
        }
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
