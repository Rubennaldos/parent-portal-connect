// @ts-nocheck — archivo Deno (Edge Function de Supabase), no usar TypeScript de Node.js
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // ── Verificación de sesión (verify_jwt = false en config, la validamos aquí) ──
  // Cualquier usuario autenticado puede emitir comprobantes desde el POS.
  // El gateway de Supabase NO verifica el JWT automáticamente — lo hacemos nosotros.
  const authHeader = req.headers.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const serviceRoleKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  if (!bearerToken) {
    return new Response(
      JSON.stringify({ success: false, error: "No autorizado — inicia sesión primero" }),
      { status: 401, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
  // Decodificar el payload del JWT (solo lectura del sub; la firma ya fue firmada por Supabase Auth)
  // Permite llamadas con service_role (p.ej. desde izipay-webhook para billing en tiempo real).
  let callerUserId: string | null = null;

  // Permitir llamadas internas backend->backend con la service_role key.
  // Esto desbloquea process-billing-queue sin abrir la función al público.
  if (serviceRoleKey && bearerToken === serviceRoleKey) {
    callerUserId = "service_role_internal";
  } else {
    try {
      const parts = bearerToken.split(".");
      if (parts.length === 3) {
        const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const payload = JSON.parse(atob(padded.padEnd(padded.length + (4 - padded.length % 4) % 4, "=")));
        callerUserId = payload.sub ?? null;
        // Las Edge Functions internas usan service_role key (no tiene 'sub' pero tiene role='service_role')
        if (!callerUserId && payload.role === "service_role") {
          callerUserId = "service_role_internal";
        }
      }
    } catch { /* JWT malformado — callerUserId queda null */ }
  }

  if (!callerUserId) {
    return new Response(
      JSON.stringify({ success: false, error: "Token de sesión inválido — vuelve a iniciar sesión" }),
      { status: 401, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();

    // ========== MODO TEST: solo verificar credenciales ==========
    if (body.test === true) {
      const { data: cfg } = await supabase
        .from("billing_config")
        .select("nubefact_ruta, nubefact_token")
        .eq("school_id", body.school_id)
        .single();

      const ruta  = (cfg?.nubefact_ruta  || body.nubefact_ruta || "").trim();
      const token = (cfg?.nubefact_token || body.nubefact_token || "").trim();

      if (!ruta || !token) {
        return new Response(JSON.stringify({ ok: false, error: "Sin credenciales — verifica RUTA y TOKEN" }), {
          status: 200, headers: { ...cors, "Content-Type": "application/json" },
        });
      }

      try {
        const testRes = await fetch(ruta, {
          method: "GET",
          headers: { "Authorization": `Token token=${token}` },
        });
        const ok = testRes.status < 500;
        return new Response(JSON.stringify({ ok, status: testRes.status }), {
          status: 200, headers: { ...cors, "Content-Type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), {
          status: 200, headers: { ...cors, "Content-Type": "application/json" },
        });
      }
    }

    // ========== GENERACIÓN DE COMPROBANTE ==========
    const {
      school_id,
      transaction_id,
      sale_id,
      payment_id,
      cashier_id,
      created_by,
      tipo,           // 1=factura, 2=boleta, 7=NC-boleta, 8=NC-factura
      cliente,
      items,
      monto_total,
      doc_ref,
      demo_mode = false,
      payment_method,
      related_invoice_id,
      cancellation_reason,
      emission_date,   // 'YYYY-MM-DD' opcional — si se omite usa hoy
    } = body;

    // 1. Obtener configuración Nubefact de la sede
    const { data: cfg, error: cfgErr } = await supabase
      .from("billing_config")
      .select("*")
      .eq("school_id", school_id)
      .single();

    if (cfgErr || !cfg) {
      return new Response(
        JSON.stringify({ success: false, error: `Sin configuración Nubefact para school_id=${school_id}. Detalle: ${cfgErr?.message}` }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Si billing_config.demo_mode = true SIEMPRE es demo, sin importar lo que diga el body.
    // El body puede forzar demo=true pero NUNCA puede forzar demo=false si la sede está en demo.
    const effectiveDemoMode: boolean = demo_mode === true || cfg.demo_mode === true;

    // 2. Mapeo tipos internos → tipos Nubefact
    // Interno: 1=factura, 2=boleta, 7=NC-boleta, 8=NC-factura
    // Nubefact: 1=factura, 2=boleta, 3=nota_credito
    const nubefact_tipo = (tipo === 7 || tipo === 8) ? 3 : tipo;

    // 3. Determinar serie según tipo
    const serie = tipo === 1 ? cfg.serie_factura
                : tipo === 7 ? cfg.serie_nc_boleta
                : tipo === 8 ? cfg.serie_nc_factura
                : cfg.serie_boleta;

    // 4. Tipo de documento SUNAT
    const invoice_type_map: Record<number, string> = {
      1: "factura", 2: "boleta", 7: "nota_credito", 8: "nota_credito",
    };
    const document_type_code_map: Record<number, string> = {
      1: "01", 2: "03", 7: "07", 8: "07",
    };

    // 5. Número correlativo — ATÓMICO vía get_next_invoice_numero
    // Reemplaza el frágil SELECT MAX(numero)+1.
    // La función usa INSERT...ON CONFLICT...DO UPDATE RETURNING, lo que garantiza
    // que dos llamadas concurrentes NUNCA reciban el mismo número.
    const { data: nextNumero, error: seqErr } = await supabase
      .rpc("get_next_invoice_numero", { p_school_id: school_id, p_serie: serie });

    if (seqErr || nextNumero == null) {
      console.error(`[generate-document] Error obteniendo correlativo atómico:`, seqErr);
      return new Response(
        JSON.stringify({
          success: false,
          error: `No se pudo obtener el correlativo para ${serie}. ` +
                 `Detalle: ${seqErr?.message ?? "respuesta nula"}. ` +
                 `Verifica que la migración 20260404_invoice_sequences.sql fue ejecutada en Supabase.`,
        }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    let numero: number = nextNumero;
    console.log(`📋 Correlativo atómico: ${serie}-${String(numero).padStart(8, "0")}`);

    // 6. Calcular IGV — carga dinámica desde billing_config
    // Perú: 18% estándar, 10.5% para MYPES Restaurantes (Régimen Especial)
    // El valor SIEMPRE viene de billing_config; si no está configurado, se loga un warning.
    let igv_pct: number;
    if (cfg.igv_porcentaje != null && Number(cfg.igv_porcentaje) > 0) {
      igv_pct = Number(cfg.igv_porcentaje);
    } else {
      igv_pct = 18; // Fallback estándar
      console.warn(`[generate-document] ADVERTENCIA: igv_porcentaje no configurado para school_id=${school_id}. Usando 18% por defecto. Configure el IGV correcto en billing_config.`);
    }
    // Aritmética de enteros (céntimos) — garantiza baseCents + igvCents = totalCents
    // sin ruido IEEE 754. Misma fórmula que VoucherApproval, BillingCollection y CierreMensual.
    const totalCents    = Math.round(monto_total * 100);
    const divisorX100   = 100 + igv_pct;
    const baseCents     = Math.floor(totalCents * 100 / divisorX100);
    const igvCents      = totalCents - baseCents;
    const base_imponible = baseCents / 100;
    const igv_monto      = igvCents  / 100;

    // 7. Fecha — usa emission_date si viene del cuerpo (Cierre Mensual, 3 días de gracia)
    //    o hoy si no se especifica (POS en tiempo real)
    let fecha: string;
    if (emission_date && /^\d{4}-\d{2}-\d{2}$/.test(emission_date)) {
      const [y, m, d] = emission_date.split("-");
      fecha = `${d}-${m}-${y}`;  // Nubefact espera DD-MM-YYYY
    } else {
      // Lima = UTC-5. Usar hora Lima para que la fecha coincida con lo que Nubefact valida.
      const hoyLima = new Date(Date.now() - 5 * 60 * 60 * 1000);
      fecha = `${String(hoyLima.getUTCDate()).padStart(2, "0")}-${String(hoyLima.getUTCMonth() + 1).padStart(2, "0")}-${hoyLima.getUTCFullYear()}`;
    }

    // 8. Items del comprobante — SIEMPRE recalculados con igv_pct de billing_config.
    //
    // POR QUÉ recalculamos en lugar de usar los items enviados por el cliente:
    //   El POS puede enviar ítems calculados con 18 % (hardcodeado).
    //   Si billing_config.igv_porcentaje = 10.5 % (MYPE), la Edge Function
    //   pone total_igv = 0.81 en el encabezado, pero la suma de ítems da 1.30.
    //   Nubefact rechaza con "IGV TOTAL ≠ IGV DE LINEAS".
    //   Solución: recalcular ítems con la misma tasa que el encabezado.
    //
    // Técnica "último ítem absorbe residuo":
    //   Garantiza sum(item.igv) == total_igv y sum(item.subtotal) == base_imponible
    //   sin fugas de ±0.01 que SUNAT rechaza.
    let normalizedItems: any[] = Array.isArray(items) ? [...items] : [];

    // Enriquecimiento de detalle real para pagos IziPay:
    // si el item viene genérico (ej. "Recarga online ... ref:UUID"), intentamos reconstruir
    // conceptos reales desde payment_sessions.debt_tx_ids y transactions.
    const hasGenericGatewayItem = normalizedItems.some((it: any) => {
      const d = String(it?.descripcion ?? "").toLowerCase();
      return d.includes("recarga online") || d.includes("izipay") || d.includes(" ref:");
    });

    const relationTxId = transaction_id ?? sale_id ?? null;
    if ((normalizedItems.length === 0 || hasGenericGatewayItem) && relationTxId) {
      try {
        const { data: baseTx } = await supabase
          .from("transactions")
          .select("id, school_id, student_id, amount, description, created_at, payment_session_id, ticket_code")
          .eq("id", relationTxId)
          .eq("school_id", school_id)
          .maybeSingle();

        if (baseTx) {
          let rebuiltItems: any[] = [];
          let rebuiltTotal = 0;

          // 1) Si la sesión tiene deudas vinculadas, esos son los ítems reales pagados.
          const sessionId = (baseTx as any).payment_session_id as string | null;
          if (sessionId) {
            const { data: session } = await supabase
              .from("payment_sessions")
              .select("debt_tx_ids")
              .eq("id", sessionId)
              .maybeSingle();

            const debtTxIds = Array.isArray((session as any)?.debt_tx_ids)
              ? ((session as any).debt_tx_ids as string[])
              : [];

            if (debtTxIds.length > 0) {
              const { data: debtTxRows } = await supabase
                .from("transactions")
                .select("id, amount, description, created_at, ticket_code, metadata, student_id")
                .in("id", debtTxIds)
                .eq("school_id", school_id)
                .neq("is_deleted", true)
                .order("created_at", { ascending: true });

              const studentIds = Array.from(new Set((debtTxRows ?? []).map((r: any) => r.student_id).filter(Boolean)));
              const studentMap = new Map<string, string>();
              if (studentIds.length > 0) {
                const { data: sRows } = await supabase
                  .from("students")
                  .select("id, full_name")
                  .in("id", studentIds);
                for (const s of sRows ?? []) {
                  studentMap.set((s as any).id, (s as any).full_name ?? "Alumno");
                }
              }

              rebuiltItems = (debtTxRows ?? []).map((r: any, idx: number) => {
                const studentName = studentMap.get(r.student_id) ?? "Alumno";
                const hasLunch = !!(r.metadata?.lunch_order_id ?? r.metadata?.["lunch_order_id"]);
                const fallbackDate = new Date(r.created_at);
                const dd = String(fallbackDate.getUTCDate()).padStart(2, "0");
                const mm = String(fallbackDate.getUTCMonth() + 1).padStart(2, "0");
                const yyyy = String(fallbackDate.getUTCFullYear());
                const desc = hasLunch
                  ? `Almuerzo - ${studentName} - ${dd}/${mm}/${yyyy}`
                  : (r.description?.trim() || `Pago cafetería - ${studentName}`);
                const price = Math.abs(Number(r.amount ?? 0));
                rebuiltTotal += price;
                return {
                  unidad_de_medida: "NIU",
                  codigo: r.ticket_code || `TX-${String(r.id).slice(0, 8)}` || String(idx + 1).padStart(3, "0"),
                  descripcion: desc,
                  cantidad: 1,
                  precio_unitario: +price.toFixed(2),
                };
              });
            }
          }

          // 2) Si no hubo debt_tx_ids, al menos usar una descripción limpia (sin ref UUID).
          if (rebuiltItems.length === 0) {
            const baseDescRaw = String((baseTx as any).description ?? "").trim();
            const baseDesc = baseDescRaw
              .replace(/\s*ref:[a-f0-9-]{8,}/ig, "")
              .replace(/\s{2,}/g, " ")
              .trim();
            const cleanDesc = baseDesc || "Recarga en línea";
            const price = Math.abs(Number((baseTx as any).amount ?? 0));
            rebuiltItems = [{
              unidad_de_medida: "NIU",
              codigo: (baseTx as any).ticket_code || `TX-${String((baseTx as any).id).slice(0, 8)}`,
              descripcion: cleanDesc,
              cantidad: 1,
              precio_unitario: +price.toFixed(2),
            }];
            rebuiltTotal = price;
          }

          // 3) Si el monto total difiere (ej. recarga excedente), agregar línea de ajuste explícita.
          const delta = +(Number(monto_total) - rebuiltTotal).toFixed(2);
          if (Math.abs(delta) > 0.02) {
            rebuiltItems.push({
              unidad_de_medida: "NIU",
              codigo: "REC-SALDO",
              descripcion: "Recarga de saldo",
              cantidad: 1,
              precio_unitario: +delta.toFixed(2),
            });
          }

          if (rebuiltItems.length > 0) {
            normalizedItems = rebuiltItems;
            console.log(`[generate-document] items enriquecidos desde DB para tx=${relationTxId}: ${rebuiltItems.length} línea(s)`);
          }
        }
      } catch (enrichErr) {
        console.warn("[generate-document] No se pudo enriquecer items desde DB:", String(enrichErr));
      }
    }

    let itemsNubefact: Record<string, unknown>[];

    if (normalizedItems && normalizedItems.length > 0) {
      // Recalcular todos los ítems con la tasa correcta (billing_config)
      const divisorX100 = 100 + igv_pct;

      const rawCalcs = (normalizedItems as any[]).map((item: any) => {
        const qty          = Number(item.cantidad)        || 1;
        const precioUnit   = Number(item.precio_unitario) || 0;
        const itemTotalCents = Math.round(precioUnit * qty * 100);
        const itemBaseCents  = Math.floor(itemTotalCents * 100 / divisorX100);
        const itemIgvCents   = itemTotalCents - itemBaseCents;
        return { item, qty, precioUnit, itemTotalCents, itemBaseCents, itemIgvCents };
      });

      // Diferencia de redondeo: header vs suma de ítems
      const sumItemsBaseCents = rawCalcs.reduce((s, r) => s + r.itemBaseCents, 0);
      const sumItemsIgvCents  = rawCalcs.reduce((s, r) => s + r.itemIgvCents,  0);
      const baseAdj = baseCents - sumItemsBaseCents;
      const igvAdj  = igvCents  - sumItemsIgvCents;

      itemsNubefact = rawCalcs.map((r, i) => {
        const isLast   = i === rawCalcs.length - 1;
        const adjBase  = r.itemBaseCents + (isLast ? baseAdj : 0);
        const adjIgv   = r.itemIgvCents  + (isLast ? igvAdj  : 0);
        const itemBase = adjBase / 100;
        const itemIgv  = adjIgv  / 100;
        const itemTot  = r.itemTotalCents / 100;
        return {
          unidad_de_medida:        r.item.unidad_de_medida || "NIU",
          codigo:                  r.item.codigo           || String(i + 1).padStart(3, "0"),
          descripcion:             r.item.descripcion      || "Consumo",
          cantidad:                r.qty,
          valor_unitario:          +(itemBase / r.qty).toFixed(2),
          precio_unitario:         +r.precioUnit.toFixed(2),
          descuento:               r.item.descuento        || "",
          subtotal:                +itemBase.toFixed(2),
          tipo_de_igv:             r.item.tipo_de_igv ?? 1,
          igv:                     +itemIgv.toFixed(2),
          total:                   +itemTot.toFixed(2),
          anticipo_regularizacion: false,
        };
      });
    } else {
      // Un solo ítem resumen (cuando el cliente no envía detalle de ítems)
      itemsNubefact = [{
        unidad_de_medida: "NIU",
        codigo:           "001",
        descripcion:      "Consumo cafetería / almuerzo",
        cantidad:         1,
        valor_unitario:   +base_imponible.toFixed(2),
        precio_unitario:  +monto_total.toFixed(2),
        descuento:        "",
        subtotal:         +base_imponible.toFixed(2),
        tipo_de_igv:      1,
        igv:              +igv_monto.toFixed(2),
        total:            +monto_total.toFixed(2),
        anticipo_regularizacion: false,
      }];
    }

    // 9. Tipo de documento del cliente
    // Nubefact: 0=sin doc, 1=DNI, 6=RUC
    const clientDocTypeNubefact =
      cliente?.doc_type === "ruc"  ? 6 :
      cliente?.doc_type === "dni"  ? 1 :
      (cliente?.tipo_doc ?? 0);

    // 10. Payload para Nubefact
    const payload: Record<string, unknown> = {
      operacion:                      "generar_comprobante",
      tipo_de_comprobante:            nubefact_tipo,
      serie,
      numero,
      sunat_transaction:              1,
      cliente_tipo_de_documento:      clientDocTypeNubefact,
      cliente_numero_de_documento:    cliente?.doc_number || cliente?.numero_doc || (clientDocTypeNubefact === 0 ? "-" : ""),
      cliente_denominacion:           cliente?.razon_social || cliente?.nombre || "Consumidor Final",
      cliente_direccion:              cliente?.direccion || "",
      cliente_email:                  cliente?.email   || "",
      fecha_de_emision:               fecha,
      moneda:                         1,
      tipo_de_cambio:                 "",
      porcentaje_de_igv:              igv_pct,
      total_gravada:                  +base_imponible.toFixed(2),
      total_igv:                      +igv_monto.toFixed(2),
      total:                          +monto_total.toFixed(2),
      enviar_automaticamente_a_la_sunat:  !effectiveDemoMode,
      enviar_automaticamente_al_cliente:  !effectiveDemoMode && !!(cliente?.email),
      items: itemsNubefact,
    };

    // Campos extra para Nota de Crédito
    if ((tipo === 7 || tipo === 8) && doc_ref) {
      payload.tipo_de_nota_de_credito            = 1;
      payload.documento_que_se_modifica_tipo     = doc_ref.tipo;
      payload.documento_que_se_modifica_serie    = doc_ref.serie;
      payload.documento_que_se_modifica_numero   = doc_ref.numero;
    }

    // 11. Llamar a la API de Nubefact
    // Con la secuencia atómica, el correlativo es único y no debería existir en Nubefact.
    // Sin embargo, mantenemos UN único fallback de emergencia para el caso de desfase
    // en la migración de datos (ej. números en electronic_documents no cargados a invoice_sequences).
    // Si el fallback también falla con "ya existe", es una señal de que la secuencia está
    // desincronizada y debe corregirse manualmente en invoice_sequences.
    const nubefactHeaders = {
      "Authorization": `Token token=${cfg.nubefact_token.trim()}`,
      "Content-Type":  "application/json",
    };

    let nubefactData: any;

    // Primer intento — el número atómico debería ser siempre único
    const nubefactRes1 = await fetch(cfg.nubefact_ruta.trim(), {
      method:  "POST",
      headers: nubefactHeaders,
      body:    JSON.stringify({ ...payload, numero }),
    });
    nubefactData = await nubefactRes1.json();

    // Fallback de emergencia: si Nubefact dice "ya existe", avanzar la secuencia
    // hasta encontrar un número libre. Máximo MAX_SKIP intentos para no crear
    // huecos infinitos. Cada intento consume un número en invoice_sequences.
    //
    // CAUSA COMÚN: las boletas rechazadas por SUNAT (ej. error IGV) SÍ quedan
    // registradas en Nubefact con su número. Cuando se reintenta, invoice_sequences
    // da el mismo número ya ocupado. Este loop salta todos los fantasmas.
    const isYaExiste = (data: any): boolean => {
      const s = JSON.stringify(data?.errors ?? "").toLowerCase();
      return s.includes("ya existe") || s.includes("already exists") ||
             s.includes("duplicado") || s.includes("duplicate");
    };

    const MAX_SKIP = 5; // máximo de huecos consecutivos permitidos
    let skipCount  = 0;

    while (isYaExiste(nubefactData) && skipCount < MAX_SKIP) {
      skipCount++;
      console.error(
        `🚨 [generate-document] DESFASE SECUENCIA (intento ${skipCount}/${MAX_SKIP}): ` +
        `${serie}-${String(numero).padStart(8,"0")} ya existe en Nubefact. ` +
        `Avanzando a siguiente número. ` +
        `ACCIÓN RECOMENDADA: ejecutar migración 20260408_resync_invoice_sequences.sql`
      );

      const { data: nextFallback, error: seqErrFb } = await supabase
        .rpc("get_next_invoice_numero", { p_school_id: school_id, p_serie: serie });

      if (seqErrFb || nextFallback == null) {
        console.error(`[generate-document] No se pudo obtener correlativo de emergencia:`, seqErrFb);
        break;
      }

      numero         = nextFallback;
      payload.numero = numero;
      console.warn(`[generate-document] Reintentando con correlativo ${serie}-${String(numero).padStart(8,"0")}`);

      const nubefactRetry = await fetch(cfg.nubefact_ruta.trim(), {
        method:  "POST",
        headers: nubefactHeaders,
        body:    JSON.stringify({ ...payload, numero }),
      });
      nubefactData = await nubefactRetry.json();
    }

    if (skipCount > 0 && !isYaExiste(nubefactData)) {
      console.log(`✅ [generate-document] Correlativo válido encontrado en intento ${skipCount + 1}: ${serie}-${String(numero).padStart(8,"0")}`);
    }

    if (skipCount >= MAX_SKIP && isYaExiste(nubefactData)) {
      console.error(
        `🚫 [generate-document] Se alcanzó el límite de ${MAX_SKIP} saltos para la serie ${serie}. ` +
        `La secuencia está gravemente desfasada. ` +
        `Ejecutar URGENTE: SELECT set_invoice_sequence('${serie}', <numero_correcto>, 'AJUSTE_MANUAL_OK'); ` +
        `donde <numero_correcto> es el ÚLTIMO número real en el panel de Nubefact.`
      );
    }

    // 12. Estado SUNAT
    const sunat_status =
      nubefactData.aceptada_por_sunat ? "accepted" :
      nubefactData.errors             ? "rejected" :
      effectiveDemoMode               ? "pending"  : "processing";

    // Ticket de consulta asíncrona — Nubefact lo devuelve cuando SUNAT no confirma
    // en tiempo real (sunat_status = 'processing'). Lo guardamos para el futuro poller.
    // Campos documentados por Nubefact: ticket, numero_ticket, ticket_id (varía por versión).
    // El ticket de polling de Nubefact es un valor numérico/UUID devuelto por la API.
    // Nunca debe ser el serie-numero del comprobante (ej. "BMC3-00000518") — eso es basura.
    // Si Nubefact no devuelve ticket real, guardamos null para que el poller consulte por serie+numero.
    const rawTicket =
      nubefactData.ticket        ||
      nubefactData.numero_ticket ||
      nubefactData.ticket_id     ||
      null;
    const TICKET_BASURA_RE = /^[A-Z0-9]+-\d+$/;
    const nubefact_ticket: string | null =
      sunat_status === "processing" && rawTicket && !TICKET_BASURA_RE.test(String(rawTicket))
        ? String(rawTicket)
        : null;

    // 13. Guardar en tabla `invoices` (nueva, principal)
    let savedInvoice: any = null;
    try {
      // Items para tabla invoice_items
      const invoiceItemsDB = (normalizedItems ?? []).map((it: any) => ({
        description:         it.descripcion || "Consumo",
        quantity:            it.cantidad || 1,
        unit_price:          it.valor_unitario || base_imponible,
        subtotal:            it.subtotal || base_imponible,
        igv_amount:          it.igv || igv_monto,
        total:               it.total || monto_total,
        product_code:        it.codigo || null,
        unit_type:           it.unidad_de_medida || "NIU",
        tax_type:            "gravada",
        discount_percentage: 0,
        discount_amount:     0,
      }));

      // Compatibilidad multi-esquema:
      // - Esquema A (legacy): NO tiene invoice_type/items/sale_id y sí transaction_id.
      // - Esquema B (setup completo): exige invoice_type + items (NOT NULL), puede usar sale_id.
      // Intentamos varias formas de payload para evitar "emitido en Nubefact, no persistido local".
      const commonPayload = {
        school_id,
        payment_id:        payment_id ?? null,
        cashier_id:        cashier_id ?? null,
        created_by:        created_by ?? null,
        document_type_code: document_type_code_map[tipo] || "03",
        serie,
        numero,
        client_document_type:   cliente?.doc_type || (clientDocTypeNubefact === 6 ? "ruc" : clientDocTypeNubefact === 1 ? "dni" : "-"),
        client_document_number: cliente?.doc_number || cliente?.numero_doc || null,
        client_name:            cliente?.razon_social || cliente?.nombre || "Consumidor Final",
        client_address:         cliente?.direccion || null,
        client_email:           cliente?.email || null,
        subtotal:               +base_imponible.toFixed(2),
        igv_amount:             +igv_monto.toFixed(2),
        total_amount:           +monto_total.toFixed(2),
        sunat_status,
        sunat_response_code:    nubefactData.codigo_respuesta_sunat ?? null,
        sunat_response_message: nubefactData.respuesta_sunat ?? nubefactData.errors ?? null,
        nubefact_id:            nubefactData.enlace_del_pdf?.split("/").pop() ?? null,
        pdf_url:                nubefactData.enlace_del_pdf ?? null,
        xml_url:                nubefactData.enlace_del_xml ?? null,
        cdr_url:                nubefactData.enlace_del_cdr ?? null,
        hash_signature:         nubefactData.hash_cpe ?? null,
        qr_code:                nubefactData.codigo_qr ?? null,
        related_invoice_id:     related_invoice_id ?? null,
        cancellation_reason:    cancellation_reason ?? null,
        payment_method:         payment_method ?? null,
        emission_date:          emission_date ?? new Date().toISOString().split("T")[0],
        is_demo:                effectiveDemoMode,
        sent_to_sunat_at:       !effectiveDemoMode ? new Date().toISOString() : null,
        notes:                  effectiveDemoMode ? "MODO DEMO — no enviado a SUNAT" : null,
        nubefact_ticket,
      };

      const setupFieldsPayload = {
        invoice_type:   invoice_type_map[tipo] || "boleta",
        currency:       "PEN",
        igv_rate:       igv_pct / 100,
        discount_amount: 0,
        items:          invoiceItemsDB,
      };

      const relationId = transaction_id ?? sale_id ?? null;
      const insertAttempts = [
        // Setup completo con transaction_id (cuando existe)
        { ...commonPayload, ...setupFieldsPayload, transaction_id: relationId },
        // Setup completo con sale_id (si la instalación aún usa esa columna)
        { ...commonPayload, ...setupFieldsPayload, sale_id: relationId },
        // Legacy sin items/invoice_type con transaction_id
        { ...commonPayload, transaction_id: relationId },
        // Legacy sin items/invoice_type con sale_id
        { ...commonPayload, sale_id: relationId },
        // Último fallback: sin columna relacional
        { ...commonPayload, ...setupFieldsPayload },
      ];

      let inv: any = null;
      let invErr: any = null;
      const insertErrors: any[] = [];

      for (const [idx, payloadVariant] of insertAttempts.entries()) {
        const attempt = await supabase
          .from("invoices")
          .insert(payloadVariant)
          .select()
          .single();

        if (!attempt.error && attempt.data) {
          inv = attempt.data;
          invErr = null;
          if (idx > 0) {
            console.warn(`[generate-document] INSERT invoices recuperado en intento #${idx + 1}`);
          }
          break;
        }

        invErr = attempt.error;
        insertErrors.push({
          attempt: idx + 1,
          code: attempt.error?.code ?? null,
          message: attempt.error?.message ?? null,
          details: attempt.error?.details ?? null,
          hint: attempt.error?.hint ?? null,
        });
      }

      if (invErr) {
        console.error("[generate-document] Error INSERT invoices (último intento):", invErr.code, invErr.message, invErr.details);
        console.error("[generate-document] Error INSERT invoices JSON:", JSON.stringify(invErr));
        console.error("[generate-document] Historial intentos INSERT:", JSON.stringify(insertErrors));
        if (invErr.code === "42501") {
          console.error("[generate-document] POSIBLE RLS/PERMISO: revisar políticas INSERT en public.invoices para el rol activo.");
        }
        // Intentar recuperar siempre por serie+numero (cubre duplicado 23505 y otros errores de esquema)
        const { data: existing, error: recErr } = await supabase
          .from("invoices")
          .select()
          .eq("serie", serie)
          .eq("numero", numero)
          .eq("school_id", school_id)
          .maybeSingle();
        if (existing) {
          console.log("[generate-document] Invoice recuperado por serie+numero tras error INSERT:", existing.id);
          savedInvoice = existing;
        } else {
          console.error("[generate-document] No se pudo recuperar invoice tras error INSERT:", recErr?.message ?? "no encontrado");
          if (recErr) {
            console.error("[generate-document] Error recuperación JSON:", JSON.stringify(recErr));
          }
        }
      } else {
        savedInvoice = inv;

        // Guardar items en invoice_items
        if (invoiceItemsDB.length > 0 && inv?.id) {
          await supabase.from("invoice_items").insert(
            invoiceItemsDB.map((item) => ({ ...item, invoice_id: inv.id }))
          );
        }

        // Log del evento
        await supabase.from("invoicing_logs").insert({
          invoice_id:   inv.id,
          event_type:   "created",
          event_message: `Comprobante ${serie}-${String(numero).padStart(8,"0")} generado. Estado SUNAT: ${sunat_status}${nubefact_ticket ? ` | Ticket polling: ${nubefact_ticket}` : ""}`,
          request_payload:  payload,
          response_payload: nubefactData,
        });
      }
    } catch (dbErr) {
      console.error("Error guardando invoice:", dbErr);
    }

    // CRÍTICO DE TRAZABILIDAD:
    // Si Nubefact respondió pero no pudimos persistir/recuperar la fila en invoices,
    // NO debemos devolver success=true porque el historial del padre queda "en proceso".
    // Marcamos error explícito para que billing_queue quede en failed y se pueda reintentar.
    if (!savedInvoice) {
      const persistErr =
        `INVOICE_PERSIST_ERROR: Comprobante ${serie}-${String(numero).padStart(8, "0")} ` +
        `emitido en Nubefact pero no persistido en public.invoices. ` +
        `Revisar constraints/RLS/esquema de invoices antes de reintentar.`;
      console.error(`[generate-document] ${persistErr}`);
      return new Response(
        JSON.stringify({
          success: false,
          error: persistErr,
          serie,
          numero,
          nubefact: nubefactData,
        }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // 14. Fallback: guardar en electronic_documents (compatibilidad)
    try {
      await supabase.from("electronic_documents").insert({
        school_id,
        transaction_id: transaction_id ?? null,
        tipo_comprobante: tipo,
        serie,
        numero,
        enlace_pdf:   nubefactData.enlace_del_pdf ?? null,
        enlace_xml:   nubefactData.enlace_del_xml ?? null,
        enlace_cdr:   nubefactData.enlace_del_cdr ?? null,
        estado:       sunat_status === "accepted" ? "aceptado" : sunat_status === "rejected" ? "rechazado" : "pendiente",
        cliente_nombre:   cliente?.razon_social || cliente?.nombre || null,
        cliente_documento: cliente?.doc_number || null,
        monto_total:  +monto_total.toFixed(2),
        igv:          +igv_monto.toFixed(2),
        doc_ref_serie:  doc_ref?.serie ?? null,
        doc_ref_numero: doc_ref?.numero ?? null,
        respuesta_sunat: nubefactData,
      });
    } catch (_) {
      // No crítico si electronic_documents no existe
    }

    // Determina si Nubefact/SUNAT aceptó el comprobante.
    //
    // CASOS:
    //  - Factura (01): SUNAT responde síncrono → aceptada_por_sunat=true o enlace_del_pdf presente.
    //  - Boleta (03):  SUNAT procesa asíncrono → Nubefact devuelve ticket y ni aceptada_por_sunat
    //                  ni enlace_del_pdf están presentes todavía. Esto NO es un error.
    //                  El comprobante ya fue enviado a SUNAT; el poller confirmará el estado.
    //
    // REGLA: si hay nubefact_ticket y sunat_status='processing' → Nubefact recibió el envío
    //        → tratamos como éxito parcial para NO hacer rollback de las transacciones.
    const nubefactOk = !nubefactData.errors && (
      nubefactData.aceptada_por_sunat === true ||
      !!nubefactData.enlace_del_pdf   ||
      effectiveDemoMode               ||
      // Boleta asíncrona: Nubefact aceptó, SUNAT confirmará luego — NO es fallo.
      (sunat_status === "processing" && !!nubefact_ticket)
    );

    if (!nubefactOk) {
      const rawErr = typeof nubefactData.errors === "string"
        ? nubefactData.errors
        : JSON.stringify(nubefactData.errors ?? nubefactData);

      // Enriquecer el mensaje cuando el desfase persiste tras los reintentos
      const isSequenceError = isYaExiste(nubefactData);
      const errMsg = isSequenceError
        ? `Desfase de correlativo: ${rawErr}. ` +
          `Ejecuta en Supabase SQL Editor: ` +
          `SELECT set_invoice_sequence('${serie}', <ULTIMO_NUMERO_REAL_EN_NUBEFACT>, 'AJUSTE_MANUAL_OK');`
        : rawErr;

      console.error(`❌ Nubefact rechazó ${serie}-${numero}: ${errMsg}`);
      return new Response(
        JSON.stringify({
          success:        false,
          error:          errMsg,
          sequence_error: isSequenceError,
          serie,
          documento:      savedInvoice ?? null,
          nubefact:       nubefactData,
        }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success:      true,
        sunat_status,  // 'accepted' | 'processing' | 'pending' (demo) — útil para el frontend
        documento: savedInvoice ?? { id: null, serie, numero, sunat_status, enlace_pdf: nubefactData.enlace_del_pdf, enlace_xml: nubefactData.enlace_del_xml },
        nubefact:  nubefactData,
      }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("generate-document ERROR:", error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
