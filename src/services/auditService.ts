/**
 * ============================================================
 * SERVICIO DE AUDITORÍA — auditService.ts
 * ============================================================
 * Orquesta el flujo completo de análisis de vouchers con IA:
 *
 *   1. calcularHashImagen     → SHA-256 de la imagen (anti-duplicado por archivo)
 *   2. verificarDuplicado     → Busca en BD si el hash o nro_operacion ya existen
 *   3. obtenerDetallesTecnicos → Recoge IP, User-Agent, fingerprint del navegador
 *   4. procesarVoucherConIA   → Función principal que une todo el flujo
 *   5. registrarHuella        → Guarda un log en huella_digital_logs
 *
 * SEGURIDAD:
 *   - La API Key de OpenAI vive SOLO en el servidor (Edge Function)
 *   - El frontend nunca ve ni maneja la clave
 *   - Todos los intentos de duplicado se registran como INTENTO_FRAUDE_DUPLICADO
 * ============================================================
 */

import { supabase } from "@/lib/supabase";

// ──────────────────────────────────────────────────────────
// REGLAS DE NEGOCIO: Destinatarios autorizados
// ──────────────────────────────────────────────────────────
// Solo se aceptan pagos dirigidos a la empresa.
// Si la IA detecta un destinatario que NO contiene alguna de
// estas palabras clave, el voucher es bloqueado como FRAUDE.
//
// Para agregar un alias nuevo: añade una entrada en minúsculas.
// ──────────────────────────────────────────────────────────

const NOMBRES_AUTORIZADOS: string[] = [
  "ufrasac catering sac",
  "ufrasac catering",
  "empresa ufrasac",
  "ufrasac",
];

// Monedas aceptadas — solo Soles peruanos
const MONEDAS_ACEPTADAS = ["pen", "s/", "sol", "soles", "s/."];

/**
 * Normaliza un string para comparación:
 * minúsculas, remueve puntuación, colapsa espacios.
 */
function _normalizar(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Verifica si la moneda detectada por la IA es Soles peruanos.
 * CUALQUIER otra moneda (USD, CLP, BOB, COP, EUR...) es señal de fraude.
 */
export function esMonedaAceptada(moneda: string | null): boolean {
  if (!moneda) return true; // Si la IA no detectó moneda, no bloqueamos (se manejará como SOSPECHOSO)
  const m = moneda.toLowerCase().trim();
  return MONEDAS_ACEPTADAS.some((aceptada) => m === aceptada || m.includes(aceptada));
}

/**
 * Verifica si el destinatario detectado es UFRASAC con matching estricto.
 *
 * PROTECCIÓN CONTRA CLON DE UFRASAC:
 * En lugar de un simple .includes() que aceptaría "Bodega Ufrasac Juan"
 * o "Ufrasac Fake", usamos estas reglas en orden:
 *
 * 1. Coincidencia exacta (después de normalizar) → autorizado
 * 2. La entrada EMPIEZA con un nombre autorizado Y el sufijo extra
 *    tiene ≤ 3 caracteres (ej: " S." para truncaciones como "Ufrasac Catering S.")
 * 3. Cualquier otro caso → rechazado, aunque contenga "ufrasac"
 */
export function esDestinatarioAutorizado(destinatario: string | null): boolean {
  if (!destinatario || destinatario.trim() === "") return false;

  const entrada = _normalizar(destinatario);

  for (const nombre of NOMBRES_AUTORIZADOS) {
    const nombreNorm = _normalizar(nombre);

    // Regla 1: coincidencia exacta
    if (entrada === nombreNorm) return true;

    // Regla 2: la entrada empieza con el nombre autorizado + sufijo corto
    // Esto cubre truncaciones bancarias como "Ufrasac Catering S." → " s" (2 chars)
    if (entrada.startsWith(nombreNorm)) {
      const sufijo = entrada.slice(nombreNorm.length).trim();
      if (sufijo.length <= 3) return true;
    }
  }

  // No coincidió con ninguna regla → rechazado
  // "Bodega Ufrasac Juan", "Ufrasac Fake SRL", etc. caen aquí
  return false;
}

// ──────────────────────────────────────────────────────────
// Tipos públicos del servicio
// ──────────────────────────────────────────────────────────

export type EstadoIA = "VALIDO" | "SOSPECHOSO" | "RECHAZADO";

export interface DetallesTecnicos {
  user_agent: string;
  idioma: string;
  timezone: string;
  pantalla: string;
  plataforma: string;
  /** IP detectada por el servidor (viene de la respuesta del Edge Function) */
  ip?: string;
  /** Fingerprint simple del dispositivo basado en características del navegador */
  fingerprint?: string;
}

export interface ResultadoAuditoria {
  ok: boolean;
  /** ID del registro creado en auditoria_vouchers */
  auditoriaId?: string;
  estado_ia: EstadoIA;
  banco_detectado: string | null;
  monto_detectado: number | null;
  /** Moneda detectada por la IA (debe ser "PEN" o "S/" para ser válido) */
  moneda_detectada?: string | null;
  nro_operacion: string | null;
  fecha_pago_detectada: string | null;
  /** Nombre exacto de quien recibió el dinero, según la IA */
  destinatario_detectado: string | null;
  analisis_ia: Record<string, unknown>;
  /** Si true, el voucher era un duplicado y fue bloqueado */
  es_duplicado: boolean;
  /** Si es_duplicado, explica por qué */
  motivo_duplicado?: string;
  /** Si true, el pago fue a un destinatario NO autorizado (desvío de fondos) */
  es_desvio_fondos?: boolean;
  /** Si autoAprobar=true y estado=VALIDO, indica si se actualizó la cobranza */
  cobranza_actualizada?: boolean;
  error?: string;
}

export interface OpcionesAuditoria {
  /** UUID del registro en recharge_requests vinculado a este voucher */
  idCobranza?: string;
  /** UUID de la sede */
  schoolId?: string;
  /** UUID del usuario que sube el voucher */
  usuarioId?: string;
  /**
   * Datos técnicos del dispositivo.
   * Si no se pasan, el servicio los recopila automáticamente.
   */
  detallesTecnicos?: Partial<DetallesTecnicos>;
  /**
   * Si true y el estado es VALIDO, actualiza la cobranza como aprobada.
   * ⚠️ USAR CON PRECAUCIÓN: toca el flujo de saldo.
   * Por defecto es FALSE para requerir confirmación humana.
   */
  autoAprobarSiValido?: boolean;
  /**
   * Monto esperado de la cobranza (para validar que la IA detectó el mismo valor).
   * Solo se usa si autoAprobarSiValido = true.
   */
  montoEsperado?: number;
}

// ──────────────────────────────────────────────────────────
// 1. Calcular SHA-256 de una imagen desde su URL
// ──────────────────────────────────────────────────────────

/**
 * Descarga la imagen y calcula su SHA-256 en hexadecimal.
 * Si se pasa un File directamente (desde un input), lo usa sin descarga.
 * Sirve para detectar el mismo archivo subido con diferente nombre.
 */
export async function calcularHashImagen(
  fuente: string | File
): Promise<string | null> {
  try {
    let buffer: ArrayBuffer;

    if (typeof fuente === "string") {
      // Descargar desde URL
      const response = await fetch(fuente);
      if (!response.ok) {
        console.warn("⚠️ No se pudo descargar la imagen para calcular hash:", fuente);
        return null;
      }
      buffer = await response.arrayBuffer();
    } else {
      // File del input del navegador
      buffer = await fuente.arrayBuffer();
    }

    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    return hashHex;
  } catch (err) {
    console.error("❌ Error calculando hash de imagen:", err);
    return null;
  }
}

// ──────────────────────────────────────────────────────────
// 2. Verificar duplicados antes de procesar
// ──────────────────────────────────────────────────────────

interface ResultadoDuplicado {
  esDuplicado: boolean;
  motivo?: string;
  registroExistenteId?: string;
}

export async function verificarDuplicado(
  nroOperacion: string | null,
  hashImagen: string | null
): Promise<ResultadoDuplicado> {
  if (!supabase) return { esDuplicado: false };

  // Verificar por número de operación (excluyendo rechazados — igual que el índice único)
  if (nroOperacion && nroOperacion.trim() !== "") {
    const { data: existenteNro } = await supabase
      .from("auditoria_vouchers")
      .select("id, estado_ia, creado_at")
      .eq("nro_operacion", nroOperacion.trim())
      .neq("estado_ia", "RECHAZADO")
      .maybeSingle();

    if (existenteNro) {
      return {
        esDuplicado: true,
        motivo: `El número de operación "${nroOperacion}" ya existe en el sistema (registrado el ${new Date(existenteNro.creado_at).toLocaleDateString("es-PE")}).`,
        registroExistenteId: existenteNro.id,
      };
    }
  }

  // Verificar por hash de imagen (mismo archivo, diferente nombre)
  if (hashImagen && hashImagen.trim() !== "") {
    const { data: existenteHash } = await supabase
      .from("auditoria_vouchers")
      .select("id, estado_ia, creado_at, nro_operacion")
      .eq("hash_imagen", hashImagen)
      .neq("estado_ia", "RECHAZADO")
      .maybeSingle();

    if (existenteHash) {
      return {
        esDuplicado: true,
        motivo: `Este archivo de imagen ya fue subido anteriormente (operación: ${existenteHash.nro_operacion ?? "sin código"}, registrado el ${new Date(existenteHash.creado_at).toLocaleDateString("es-PE")}).`,
        registroExistenteId: existenteHash.id,
      };
    }
  }

  return { esDuplicado: false };
}

// ──────────────────────────────────────────────────────────
// 3. Recopilar datos técnicos del navegador
// ──────────────────────────────────────────────────────────

/**
 * Genera un fingerprint simple basado en características del navegador.
 * No usa librerías externas. Para producción se puede reemplazar con FingerprintJS.
 */
function generarFingerprintSimple(): string {
  const datos = [
    navigator.userAgent,
    navigator.language,
    screen.colorDepth,
    screen.width + "x" + screen.height,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency ?? 0,
    typeof navigator.deviceMemory !== "undefined"
      ? (navigator as unknown as Record<string, unknown>).deviceMemory
      : "n/a",
  ].join("|");

  // Hash rápido (djb2) — no criptográfico, pero suficiente para fingerprinting básico
  let hash = 5381;
  for (let i = 0; i < datos.length; i++) {
    hash = (hash * 33) ^ datos.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function obtenerDetallesTecnicos(
  extra?: Partial<DetallesTecnicos>
): DetallesTecnicos {
  return {
    user_agent: navigator.userAgent,
    idioma: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    pantalla: `${screen.width}x${screen.height} (${screen.colorDepth}bit)`,
    plataforma: navigator.platform,
    fingerprint: generarFingerprintSimple(),
    ...extra,
  };
}

// ──────────────────────────────────────────────────────────
// 4. Función principal: procesar un voucher con IA
// ──────────────────────────────────────────────────────────

/**
 * Flujo completo:
 *  a) Calcula hash de la imagen
 *  b) Verifica que no sea duplicado
 *  c) Llama al Edge Function que consulta OpenAI GPT-4o Vision
 *  d) Guarda el resultado en auditoria_vouchers
 *  e) Registra la acción en huella_digital_logs
 *  f) Si autoAprobarSiValido=true y estado=VALIDO y monto coincide → aprueba la cobranza
 */
export async function procesarVoucherConIA(
  imageUrl: string,
  opciones: OpcionesAuditoria = {}
): Promise<ResultadoAuditoria> {
  const {
    idCobranza,
    schoolId,
    usuarioId,
    detallesTecnicos: detallesExtra,
    autoAprobarSiValido = false,
    montoEsperado,
  } = opciones;

  if (!supabase) {
    return _errorResult("Supabase no está configurado");
  }

  const detallesTec = obtenerDetallesTecnicos(detallesExtra);

  // ── a) Calcular hash de la imagen ──
  console.log("🔒 Calculando hash SHA-256 de la imagen...");
  const hashImagen = await calcularHashImagen(imageUrl);

  // ── b) Verificar duplicados ANTES de llamar a la IA (ahorra tokens y dinero) ──
  console.log("🔍 Verificando duplicados en la BD...");

  // Primera pasada: verificar hash (si el archivo es idéntico, no necesitamos analizar)
  if (hashImagen) {
    const checkHash = await verificarDuplicado(null, hashImagen);
    if (checkHash.esDuplicado) {
      console.warn("🚨 DUPLICADO DETECTADO (hash):", checkHash.motivo);
      await registrarHuella(
        "INTENTO_FRAUDE_DUPLICADO",
        "COBRANZAS",
        {
          tipo_duplicado: "hash_imagen",
          hash_detectado: hashImagen,
          url_imagen: imageUrl,
          id_cobranza: idCobranza,
          motivo: checkHash.motivo,
          registro_existente_id: checkHash.registroExistenteId,
        },
        detallesTec,
        schoolId
      );
      return {
        ok: false,
        estado_ia: "RECHAZADO",
        banco_detectado: null,
        monto_detectado: null,
        nro_operacion: null,
        fecha_pago_detectada: null,
        analisis_ia: { motivo: checkHash.motivo },
        es_duplicado: true,
        motivo_duplicado: checkHash.motivo,
        error: checkHash.motivo,
      };
    }
  }

  // ── c) Llamar al Edge Function (OpenAI GPT-4o Vision en el servidor) ──
  console.log("🤖 Enviando imagen a OpenAI para análisis...");

  let respuestaEdge: Record<string, unknown>;

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;

    if (!token) {
      return _errorResult("No hay sesión activa. Vuelve a iniciar sesión e intenta de nuevo.");
    }

    const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? "").toString().trim();
    const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? "").toString().trim();
    const edgeUrl = `${supabaseUrl}/functions/v1/analizar-voucher`;

    const response = await fetch(edgeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // El gateway de Supabase requiere AMBOS headers: apikey + Authorization
        "apikey": supabaseAnonKey,
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        imageUrl,
        idCobranza: idCobranza ?? null,
        schoolId: schoolId ?? null,
        hashImagen: hashImagen ?? null,
        usuarioId: usuarioId ?? null,
        // Hora exacta en que se subió el voucher (Lima, UTC-5)
        // La IA la usa para evaluar si la fecha del voucher es "futura" o normal
        fechaSubida: new Date().toISOString(),
      }),
    });

    respuestaEdge = await response.json();

    if (!response.ok || !respuestaEdge.ok) {
      const mensajeError = (respuestaEdge.error as string) ?? `Error HTTP ${response.status}`;
      console.error("❌ Error del Edge Function:", mensajeError);
      return _errorResult(`Error al analizar voucher: ${mensajeError}`);
    }
  } catch (fetchError: unknown) {
    const msg = fetchError instanceof Error ? fetchError.message : String(fetchError);
    console.error("❌ Error de red llamando al Edge Function:", msg);
    return _errorResult(`Error de conexión con el servidor de IA: ${msg}`);
  }

  // auditoriaId: el Edge Function ya guardó el registro en auditoria_vouchers con service_role
  // estadoIAOriginal: estado que la IA devolvió (antes de reglas de negocio del frontend)
  const auditoriaIdServidor = (respuestaEdge.auditoriaId as string) ?? null;
  const estadoIAOriginal = respuestaEdge.estado_ia as EstadoIA;

  if (respuestaEdge.errorGuardado) {
    console.warn("⚠️ El Edge Function no pudo guardar en auditoria_vouchers:", respuestaEdge.errorGuardado);
  } else if (auditoriaIdServidor) {
    console.log(`✅ Registro guardado por Edge Function: ID=${auditoriaIdServidor}`);
  }

  let estadoIA = estadoIAOriginal;
  const bancoDet = (respuestaEdge.banco_detectado as string) ?? null;
  const montoDet = (respuestaEdge.monto_detectado as number) ?? null;
  const monedaDet = (respuestaEdge.moneda_detectada as string) ?? null;
  const nroOp = (respuestaEdge.nro_operacion as string) ?? null;
  const fechaDet = (respuestaEdge.fecha_pago_detectada as string) ?? null;
  const destinatarioDet = (respuestaEdge.destinatario_detectado as string) ?? null;
  let analisisIA = (respuestaEdge.analisis_ia as Record<string, unknown>) ?? {};
  const ipDetectada = (respuestaEdge.ip_detectada as string) ?? undefined;

  // Enriquecer detalles técnicos con la IP detectada por el servidor
  detallesTec.ip = ipDetectada;

  // ── REGLA DE MONEDA: Solo se aceptan Soles peruanos (PEN / S/) ──
  // Si la IA detectó una moneda y NO es Soles, es un intento de pago con
  // moneda extranjera (Dólares, Bolivares, Pesos, etc.) → RECHAZADO automático.
  if (monedaDet && !esMonedaAceptada(monedaDet)) {
    const motivoMoneda = `MONEDA_INVALIDA: El voucher muestra "${monedaDet}" en lugar de Soles peruanos (S/ / PEN). Solo se aceptan pagos en Soles.`;
    console.warn(`🚨 MONEDA INVÁLIDA DETECTADA: ${monedaDet}`);
    estadoIA = "RECHAZADO";
    analisisIA = {
      ...analisisIA,
      motivo: motivoMoneda,
      alertas: [
        ...(Array.isArray(analisisIA.alertas) ? analisisIA.alertas : []),
        motivoMoneda,
      ],
      moneda_detectada: monedaDet,
      bloqueo_por_regla_negocio: "MONEDA_NO_ACEPTADA",
    };
    await registrarHuella(
      "FRAUDE_MONEDA_INVALIDA",
      "COBRANZAS",
      {
        moneda_detectada: monedaDet,
        motivo: motivoMoneda,
        url_imagen: imageUrl,
        id_cobranza: idCobranza ?? null,
        banco: bancoDet,
        monto: montoDet,
        nro_operacion: nroOp,
      },
      detallesTec,
      schoolId
    );
  }

  // ── REGLA #0: Voucher caducado (más de 30 días) ──
  // Un voucher legítimo se sube el mismo día o muy poco después del pago.
  // Si tiene más de 30 días es muy probable que sea reutilizado.
  if (fechaDet) {
    try {
      const fechaVoucher = new Date(fechaDet);
      const hoy = new Date();
      const diasAntiguedad = (hoy.getTime() - fechaVoucher.getTime()) / (1000 * 60 * 60 * 24);

      if (diasAntiguedad > 30) {
        const diasRedondeados = Math.floor(diasAntiguedad);
        const motivoCaducado = `Voucher caducado: el comprobante tiene ${diasRedondeados} días de antigüedad (límite: 30 días). Posible reutilización de comprobante viejo.`;
        console.warn(`⚠️ VOUCHER CADUCADO: ${motivoCaducado}`);
        estadoIA = "RECHAZADO";
        analisisIA = {
          ...analisisIA,
          motivo: motivoCaducado,
          alertas: [
            ...(Array.isArray(analisisIA.alertas) ? analisisIA.alertas : []),
            `VOUCHER_CADUCADO: ${diasRedondeados} días de antigüedad. Límite permitido: 30 días.`,
          ],
          bloqueo_por_regla_negocio: "VOUCHER_CADUCADO",
          dias_antiguedad: diasRedondeados,
        };
      }
    } catch {
      // Si la fecha es inválida, ignorar (no bloquear por error de parsing)
    }
  }

  // ── REGLA #0b: Número de operación no detectado → SOSPECHOSO ──
  // Sin código de operación no se puede verificar la unicidad del pago.
  if (!nroOp && estadoIA === "VALIDO") {
    estadoIA = "SOSPECHOSO";
    analisisIA = {
      ...analisisIA,
      motivo: ((analisisIA.motivo as string) ?? "") +
        " ALERTA: No se pudo extraer el número de operación del comprobante.",
      alertas: [
        ...(Array.isArray(analisisIA.alertas) ? analisisIA.alertas : []),
        "NRO_OPERACION_NO_LEGIBLE: Sin código de operación no se puede verificar unicidad. Requiere revisión manual.",
      ],
    };
  }

  // ── REGLA DE BLINDAJE: Verificar que el destinatario es UFRASAC ──
  // Si la IA detectó a quién fue el pago y NO es a la empresa autorizada,
  // forzamos RECHAZADO sin importar lo que diga la IA sobre autenticidad.
  let esDesvioFondos = false;
  const destinatarioAutorizado = esDestinatarioAutorizado(destinatarioDet);

  if (destinatarioDet && !destinatarioAutorizado) {
    // El dinero fue a otra persona o empresa — FRAUDE POR DESVÍO
    const motivoFraude = `FRAUDE_DESVIO_FONDOS: El pago se hizo a "${destinatarioDet}" y no a UFRASAC.`;
    console.warn(`🚨 DESVÍO DE FONDOS DETECTADO: ${motivoFraude}`);

    estadoIA = "RECHAZADO";
    esDesvioFondos = true;

    // Sobrescribir el análisis con el motivo real de rechazo
    analisisIA = {
      ...analisisIA,
      motivo: motivoFraude,
      alertas: [
        ...(Array.isArray(analisisIA.alertas) ? analisisIA.alertas : []),
        motivoFraude,
      ],
      destinatario_detectado: destinatarioDet,
      destinatario_autorizado: false,
      bloqueo_por_regla_negocio: "DESTINATARIO_NO_AUTORIZADO",
    };

    // Registrar como intento de fraude en los logs
    await registrarHuella(
      "FRAUDE_DESVIO_FONDOS",
      "COBRANZAS",
      {
        destinatario_detectado: destinatarioDet,
        motivo: motivoFraude,
        url_imagen: imageUrl,
        id_cobranza: idCobranza ?? null,
        banco: bancoDet,
        monto: montoDet,
        nro_operacion: nroOp,
      },
      detallesTec,
      schoolId
    );
  } else if (!destinatarioDet) {
    // La IA no pudo leer el destinatario → SOSPECHOSO (no bloqueamos, pero alertamos)
    if (estadoIA === "VALIDO") {
      estadoIA = "SOSPECHOSO";
      analisisIA = {
        ...analisisIA,
        motivo: (analisisIA.motivo as string ?? "") + " ALERTA: No se pudo verificar el destinatario del pago.",
        alertas: [
          ...(Array.isArray(analisisIA.alertas) ? analisisIA.alertas : []),
          "DESTINATARIO_NO_LEGIBLE: No se pudo leer a quién fue el pago. Requiere revisión manual.",
        ],
      };
    }
  }

  // ── Segunda pasada de duplicados: ahora tenemos el nro_operacion de la IA ──
  if (nroOp) {
    const checkNro = await verificarDuplicado(nroOp, null);
    if (checkNro.esDuplicado) {
      console.warn("🚨 DUPLICADO DETECTADO (nro_operacion):", checkNro.motivo);
      await registrarHuella(
        "INTENTO_FRAUDE_DUPLICADO",
        "COBRANZAS",
        {
          tipo_duplicado: "nro_operacion",
          nro_operacion: nroOp,
          hash_imagen: hashImagen,
          url_imagen: imageUrl,
          id_cobranza: idCobranza,
          motivo: checkNro.motivo,
          registro_existente_id: checkNro.registroExistenteId,
          analisis_ia: analisisIA,
        },
        detallesTec,
        schoolId
      );

      // Guardar el intento en auditoria_vouchers de todas formas (evidencia forense)
      await _guardarEnAuditoria({
        idCobranza: idCobranza ?? null,
        imageUrl,
        bancoDet,
        montoDet,
        nroOp,
        fechaDet,
        hashImagen,
        estadoIA: "RECHAZADO",
        analisisIA: {
          ...analisisIA,
          bloqueado_por: "DUPLICADO_NRO_OPERACION",
          motivo_bloqueo: checkNro.motivo,
        },
        schoolId: schoolId ?? null,
        usuarioId: usuarioId ?? null,
      });

      return {
        ok: false,
        estado_ia: "RECHAZADO",
        banco_detectado: bancoDet,
        monto_detectado: montoDet,
        nro_operacion: nroOp,
        fecha_pago_detectada: fechaDet,
        destinatario_detectado: destinatarioDet,
        analisis_ia: analisisIA,
        es_duplicado: true,
        motivo_duplicado: checkNro.motivo,
        error: checkNro.motivo,
      };
    }
  }

  // ── d) Actualizar registro si las reglas de negocio cambiaron el estado ──
  // El Edge Function ya insertó con el estado original de la IA.
  // Si nuestras reglas (moneda, destinatario, caducado) lo cambiaron, actualizamos el registro.
  const analisisIAFinal: Record<string, unknown> = {
    ...analisisIA,
    destinatario_detectado: destinatarioDet,
    destinatario_autorizado: destinatarioDet ? destinatarioAutorizado : null,
    es_desvio_fondos: esDesvioFondos,
  };

  let auditoriaId: string | null = auditoriaIdServidor;

  if (auditoriaIdServidor && estadoIA !== estadoIAOriginal) {
    // El estado fue modificado por reglas de negocio → actualizar el registro del servidor
    console.log(`🔄 Estado cambiado por regla de negocio: ${estadoIAOriginal} → ${estadoIA}. Actualizando registro...`);
    const { error: updateError } = await supabase
      .from("auditoria_vouchers")
      .update({
        estado_ia: estadoIA,
        analisis_ia: analisisIAFinal,
      })
      .eq("id", auditoriaIdServidor);

    if (updateError) {
      console.error("❌ Error actualizando estado en auditoria_vouchers:", updateError.message);
    }
  } else if (auditoriaIdServidor) {
    // El estado no cambió pero actualizamos el analisis_ia con los datos enriquecidos
    await supabase
      .from("auditoria_vouchers")
      .update({ analisis_ia: analisisIAFinal })
      .eq("id", auditoriaIdServidor);
  } else if (!auditoriaIdServidor) {
    // El Edge Function falló al guardar → intentar guardar desde el frontend como respaldo
    console.warn("⚠️ Guardando como respaldo desde el frontend...");
    auditoriaId = await _guardarEnAuditoria({
      idCobranza: idCobranza ?? null,
      imageUrl,
      bancoDet,
      montoDet,
      nroOp,
      fechaDet,
      hashImagen,
      estadoIA,
      analisisIA: analisisIAFinal,
      schoolId: schoolId ?? null,
      usuarioId: usuarioId ?? null,
    });
  }

  console.log(`💾 Registro auditoria_vouchers confirmado: ID=${auditoriaId}, estado=${estadoIA}`);

  // ── e) Registrar huella digital ──
  const accion =
    esDesvioFondos
      ? "FRAUDE_DESVIO_FONDOS"
      : estadoIA === "VALIDO"
      ? "SUBIDA_VOUCHER_VALIDO"
      : estadoIA === "SOSPECHOSO"
      ? "SUBIDA_VOUCHER_SOSPECHOSO"
      : "SUBIDA_VOUCHER_RECHAZADO";

  await registrarHuella(
    accion,
    "COBRANZAS",
    {
      auditoria_id: auditoriaId,
      id_cobranza: idCobranza ?? null,
      estado_ia: estadoIA,
      banco: bancoDet,
      monto: montoDet,
      nro_operacion: nroOp,
      destinatario_detectado: destinatarioDet,
      destinatario_autorizado: destinatarioAutorizado,
      es_desvio_fondos: esDesvioFondos,
    },
    detallesTec,
    schoolId
  );

  // ── f) Auto-aprobación opcional (DESACTIVADA por defecto) ──
  let cobranzaActualizada = false;

  if (autoAprobarSiValido && estadoIA === "VALIDO" && idCobranza) {
    cobranzaActualizada = await _autoAprobarCobranza(
      idCobranza,
      montoDet,
      montoEsperado,
      analisisIA,
      detallesTec
    );
  }

  console.log(`✅ Voucher procesado: ${estadoIA} | ID auditoría: ${auditoriaId ?? "no guardado"}`);

  const esMonedaInvalida = monedaDet ? !esMonedaAceptada(monedaDet) : false;

  return {
    ok: !esDesvioFondos && !esMonedaInvalida,
    auditoriaId: auditoriaId ?? undefined,
    estado_ia: estadoIA,
    banco_detectado: bancoDet,
    monto_detectado: montoDet,
    moneda_detectada: monedaDet,
    nro_operacion: nroOp,
    fecha_pago_detectada: fechaDet,
    destinatario_detectado: destinatarioDet,
    analisis_ia: analisisIAFinal,
    es_duplicado: false,
    es_desvio_fondos: esDesvioFondos,
    cobranza_actualizada: cobranzaActualizada,
    error: esDesvioFondos
      ? `FRAUDE_DESVIO_FONDOS: El pago se hizo a "${destinatarioDet}" y no a UFRASAC.`
      : esMonedaInvalida
      ? `MONEDA_INVALIDA: El voucher muestra "${monedaDet}" en lugar de Soles peruanos.`
      : undefined,
  };
}

// ──────────────────────────────────────────────────────────
// 5. Registrar huella digital
// ──────────────────────────────────────────────────────────

/**
 * Guarda un registro en huella_digital_logs con toda la info técnica.
 * Se puede llamar desde cualquier parte del sistema para loggear acciones.
 */
export async function registrarHuella(
  accion: string,
  modulo: string,
  contexto: Record<string, unknown>,
  detalles?: Partial<DetallesTecnicos>,
  schoolId?: string
): Promise<void> {
  if (!supabase) return;

  try {
    const det = detalles ?? obtenerDetallesTecnicos();
    await supabase.from("huella_digital_logs").insert({
      accion,
      modulo,
      detalles_tecnicos: {
        ip: det.ip ?? null,
        user_agent: det.user_agent,
        fingerprint: det.fingerprint ?? null,
        idioma: det.idioma,
        timezone: det.timezone,
        pantalla: det.pantalla,
        plataforma: det.plataforma,
      },
      contexto,
      school_id: schoolId ?? null,
      creado_at: new Date().toISOString(),
    });
  } catch (err) {
    // Los logs NO deben interrumpir el flujo principal
    console.error("⚠️ Error registrando huella (no crítico):", err);
  }
}

// ──────────────────────────────────────────────────────────
// Helpers internos
// ──────────────────────────────────────────────────────────

interface DatosAuditoria {
  idCobranza: string | null;
  imageUrl: string;
  bancoDet: string | null;
  montoDet: number | null;
  nroOp: string | null;
  fechaDet: string | null;
  hashImagen: string | null;
  estadoIA: EstadoIA;
  analisisIA: Record<string, unknown>;
  schoolId: string | null;
  usuarioId: string | null;
}

async function _guardarEnAuditoria(d: DatosAuditoria): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("auditoria_vouchers")
      .insert({
        id_cobranza: d.idCobranza,
        url_imagen: d.imageUrl,
        banco_detectado: d.bancoDet,
        monto_detectado: d.montoDet,
        nro_operacion: d.nroOp,
        fecha_pago_detectada: d.fechaDet,
        hash_imagen: d.hashImagen,
        estado_ia: d.estadoIA,
        analisis_ia: d.analisisIA,
        school_id: d.schoolId,
        subido_por: d.usuarioId,
      })
      .select("id")
      .single();

    if (error) {
      console.error("❌ Error guardando en auditoria_vouchers:", error);
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    console.error("❌ Error inesperado al guardar auditoría:", err);
    return null;
  }
}

/**
 * Auto-aprueba una cobranza (recharge_request) si:
 * - El estado IA es VALIDO
 * - El monto detectado coincide con el esperado (±5% de tolerancia)
 *
 * ⚠️ ADVERTENCIA: Esta función actualiza el estado de una cobranza.
 * La actualización de saldo (adjust_student_balance) aún requiere
 * que el flujo normal de VoucherApproval sea invocado.
 * Esta función solo cambia el status a 'approved' para que el trigger
 * de la BD o el job de aprobación lo procese.
 */
async function _autoAprobarCobranza(
  idCobranza: string,
  montoDetectado: number | null,
  montoEsperado: number | undefined,
  analisisIA: Record<string, unknown>,
  detallesTec: DetallesTecnicos
): Promise<boolean> {
  if (!supabase) return false;

  // Validar que el monto coincide (±5% de tolerancia)
  if (montoDetectado !== null && montoEsperado !== undefined) {
    const diferencia = Math.abs(montoDetectado - montoEsperado);
    const tolerancia = montoEsperado * 0.05;

    if (diferencia > tolerancia) {
      console.warn(
        `⚠️ Auto-aprobación CANCELADA: monto IA (${montoDetectado}) difiere del esperado (${montoEsperado}). Diferencia: ${diferencia.toFixed(2)}`
      );
      await registrarHuella(
        "ALERTA_MONTO_DIFERENTE",
        "COBRANZAS",
        {
          id_cobranza: idCobranza,
          monto_ia: montoDetectado,
          monto_esperado: montoEsperado,
          diferencia,
          analisis_ia: analisisIA,
        },
        detallesTec
      );
      return false;
    }
  }

  // Verificar que la confianza de la IA sea alta (>= 0.85)
  const confianza = (analisisIA?.confianza as number) ?? 0;
  if (confianza < 0.85) {
    console.warn(`⚠️ Auto-aprobación CANCELADA: confianza IA baja (${confianza})`);
    return false;
  }

  // Actualizar el estado de la cobranza
  const { error } = await supabase
    .from("recharge_requests")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      notes: `Auto-aprobado por IA (confianza: ${(confianza * 100).toFixed(0)}%). Verificar manualmente si es necesario.`,
    })
    .eq("id", idCobranza)
    .eq("status", "pending"); // Guard: solo si sigue en pending

  if (error) {
    console.error("❌ Error al auto-aprobar cobranza:", error);
    await registrarHuella(
      "ERROR_AUTO_APROBACION",
      "COBRANZAS",
      { id_cobranza: idCobranza, error: error.message },
      detallesTec
    );
    return false;
  }

  await registrarHuella(
    "AUTO_APROBACION_IA",
    "COBRANZAS",
    {
      id_cobranza: idCobranza,
      monto_aprobado: montoDetectado,
      confianza_ia: confianza,
    },
    detallesTec
  );

  console.log(`✅ Cobranza ${idCobranza} marcada como aprobada por IA`);
  return true;
}

function _errorResult(error: string): ResultadoAuditoria {
  return {
    ok: false,
    estado_ia: "SOSPECHOSO",
    banco_detectado: null,
    monto_detectado: null,
    nro_operacion: null,
    fecha_pago_detectada: null,
    destinatario_detectado: null,
    analisis_ia: {},
    es_duplicado: false,
    error,
  };
}
