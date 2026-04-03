// @ts-nocheck — archivo Deno (Edge Function de Supabase)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// UUID v4 regex — previene "invalid input syntax for type uuid" en PostgreSQL
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Métodos digitales que entran en el cierre automático
const TODOS_LOS_METODOS = [
  "yape_qr", "yape_numero", "plin_qr", "plin_numero",
  "yape", "plin", "transferencia", "tarjeta",
];

// Máximo de transacciones por boleta resumen (límite Nubefact/SUNAT es 1000 ítems)
const MAX_TX_PER_BOLETA = 900;

// Máximo de IDs por UPDATE de PostgREST (evita URL overflow ~8KB)
const BATCH_UPDATE_SIZE = 500;

// TTL anti-zombie: si una transacción lleva más de este tiempo en 'processing',
// se considera fallida y se regresa automáticamente a 'pending'
const PROCESSING_TTL_MINUTES = 30;

// ── Helpers matemáticos ───────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Suma segura en enteros (cents) para evitar errores IEEE 754
// 0.1 + 0.2 = 0.30000000000000004 en JS — con cents: 10 + 20 = 30 exacto
function sumAsCents(amounts: number[]): number {
  const totalCents = amounts.reduce((acc, a) => acc + Math.round(Math.abs(a) * 100), 0);
  return totalCents / 100;
}

function toLimaDate(utcStr: string): Date {
  return new Date(new Date(utcStr).getTime() - 5 * 60 * 60 * 1000);
}

function toLimaDayString(utcStr: string): string {
  return toLimaDate(utcStr).toISOString().split("T")[0];
}

// IGV seguro: siempre desde billing_config; warning explícito si no está configurado
function getIgvPct(cfg: { igv_porcentaje?: number | null }): number {
  const v = Number(cfg.igv_porcentaje);
  if (!isNaN(v) && v > 0) return v;
  console.warn("[auto-billing] ADVERTENCIA: igv_porcentaje no configurado. Usando 18% por defecto. Configure el IGV correcto en billing_config.");
  return 18;
}

// Construye el ítem de Nubefact garantizando que base + igv = total exacto (sin céntimo fantasma)
function buildItems(totalRedondeado: number, descripcion: string, igvPct: number) {
  const base = round2(totalRedondeado / (1 + igvPct / 100));
  // igv = total - base (no round2 extra para que base + igv = total exacto)
  const igv  = round2(totalRedondeado - base);
  return [{
    unidad_de_medida:        "NIU",
    codigo:                  "RESUMEN",
    descripcion,
    cantidad:                1,
    valor_unitario:          base,
    precio_unitario:         totalRedondeado,
    descuento:               "",
    subtotal:                base,
    tipo_de_igv:             1,   // Gravado – Operación Onerosa
    igv,
    total:                   totalRedondeado,
    anticipo_regularizacion: false,
  }];
}

// Divide un array en chunks de tamaño máximo
function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

// UPDATE atómico en lotes (evita URL overflow + soporta miles de IDs)
async function batchUpdate(
  supabase: any,
  ids: string[],
  data: Record<string, unknown>,
  extraFilter?: { column: string; value: string }
): Promise<{ error: Error | null; updatedCount: number }> {
  const realIds = ids.filter(id => UUID_RE.test(id));
  if (realIds.length === 0) return { error: null, updatedCount: 0 };

  let updatedCount = 0;
  for (const batch of chunks(realIds, BATCH_UPDATE_SIZE)) {
    let query = supabase.from("transactions").update(data).in("id", batch);
    if (extraFilter) query = query.eq(extraFilter.column, extraFilter.value);
    const { error } = await query;
    if (error) return { error, updatedCount };
    updatedCount += batch.length;
  }
  return { error: null, updatedCount };
}

// ── Edge Function principal ────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase    = createClient(supabaseUrl, serviceKey);

  try {
    // 1. Sedes con auto-billing habilitado y en producción
    const { data: configs, error: cfgErr } = await supabase
      .from("billing_config")
      .select("school_id, igv_porcentaje, serie_boleta, demo_mode")
      .eq("auto_billing_enabled", true)
      .eq("activo", true)
      .eq("demo_mode", false);

    if (cfgErr) throw cfgErr;
    if (!configs || configs.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No hay sedes con auto-billing habilitado", processed: 0 }),
        { headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const results: { school_id: string; groups: number; total: number; errors: string[]; zombies_reset?: number }[] = [];

    // 2. Procesar cada sede
    for (const cfg of configs) {
      const schoolId = cfg.school_id;
      const igvPct   = getIgvPct(cfg);
      const errors: string[] = [];
      let groupsProcessed = 0;
      let totalAmount = 0;
      let zombiesReset = 0;

      try {
        // ── FIX 1: RESET TTL — limpiar zombies antes de procesar ─────────────
        // Cualquier transacción en 'processing' desde hace >30 min es un zombie.
        // La regresamos a 'pending' para que este cron la procese normalmente.
        const ttlCutoff = new Date(Date.now() - PROCESSING_TTL_MINUTES * 60 * 1000).toISOString();

        const { data: zombieRows } = await supabase
          .from("transactions")
          .select("id")
          .eq("school_id", schoolId)
          .eq("billing_status", "processing")
          .lt("billing_processing_at", ttlCutoff);

        if (zombieRows && zombieRows.length > 0) {
          const zombieIds = zombieRows.map((r: { id: string }) => r.id).filter((id: string) => UUID_RE.test(id));
          const { updatedCount } = await batchUpdate(supabase, zombieIds, {
            billing_status: "pending",
            billing_processing_at: null,
          });
          zombiesReset = updatedCount;
          if (zombiesReset > 0) {
            console.log(`[auto-billing] ${schoolId}: ${zombiesReset} zombies reseteados a pending (TTL ${PROCESSING_TTL_MINUTES} min)`);
          }
        }

        // ── Calcular rango del día anterior Lima ──────────────────────────────
        const now = new Date();
        const limaOffset = -5 * 60 * 60 * 1000;
        const limaTime = new Date(now.getTime() + limaOffset);
        const todayLima = limaTime.toISOString().split("T")[0];
        const [y, m, d] = todayLima.split("-").map(Number);
        const start = new Date(Date.UTC(y, m - 1, d, 5, 0, 0));
        const end   = new Date(Date.UTC(y, m - 1, d + 1, 5, 0, 0));

        // ── FIX 4: FETCH con filtro amount > 0 — excluir negativos ───────────
        const PAGE_SIZE = 1000;
        const allRows: { id: string; created_at: string; amount: number }[] = [];
        let from = 0, hasMore = true;

        while (hasMore) {
          const { data: page, error } = await supabase
            .from("transactions")
            .select("id, created_at, amount")
            .eq("school_id", schoolId)
            .eq("is_taxable", true)
            .eq("billing_status", "pending")
            .eq("document_type", "ticket")
            .eq("payment_status", "paid")
            .neq("amount", 0)                          // excluir ceros; negativos son ventas válidas (débitos)
            .in("payment_method", TODOS_LOS_METODOS)
            .gte("created_at", start.toISOString())
            .lt("created_at", end.toISOString())
            .order("created_at", { ascending: true })
            .range(from, from + PAGE_SIZE - 1);

          if (error) throw error;
          const pageRows = (page ?? []).filter((r: { id: string }) => UUID_RE.test(r.id));
          allRows.push(...pageRows);
          from += PAGE_SIZE;
          hasMore = (page ?? []).length === PAGE_SIZE;
        }

        if (allRows.length === 0) {
          console.log(`[auto-billing] ${schoolId}: sin transacciones pendientes`);
          results.push({ school_id: schoolId, groups: 0, total: 0, errors, zombies_reset: zombiesReset });
          continue;
        }

        console.log(`[auto-billing] ${schoolId}: ${allRows.length} transacciones, IGV ${igvPct}%`);

        // ── FIX 3: AGRUPACIÓN con suma de enteros para evitar IEEE 754 ────────
        const map = new Map<string, {
          day: string;
          transactionIds: string[];
          amounts: number[];       // monto redondeado por transacción
          totalCents: number;      // suma en centavos (int) → inmune a floating point
        }>();

        for (const row of allRows) {
          const day = toLimaDayString(row.created_at);
          if (!map.has(day)) map.set(day, { day, transactionIds: [], amounts: [], totalCents: 0 });
          const g = map.get(day)!;
          const amtRounded = round2(Math.abs(row.amount));
          g.transactionIds.push(row.id);
          g.amounts.push(amtRounded);
          g.totalCents += Math.round(amtRounded * 100);  // FIX 3: aritmética entera
        }

        // ── FIX 2 + procesamiento con bloqueo atómico ─────────────────────────
        for (const [, group] of map) {
          const dayParts = group.day.split("-");
          const dayFmt   = `${dayParts[2]}/${dayParts[1]}/${dayParts[0]}`;
          const total    = group.totalCents / 100;       // FIX 3: desde enteros

          // FIX 2: SPLIT en sub-boletas de máx 900 si el grupo es muy grande
          const subBatches = chunks(
            group.transactionIds.map((id, i) => ({ id, amount: group.amounts[i] })),
            MAX_TX_PER_BOLETA
          );
          const totalParts = subBatches.length;

          for (let partIdx = 0; partIdx < subBatches.length; partIdx++) {
            const subBatch = subBatches[partIdx];
            const subIds    = subBatch.map(r => r.id);
            const subTotal  = subBatch.reduce((acc, r) => acc + Math.round(r.amount * 100), 0) / 100;

            const partLabel = totalParts > 1 ? ` (Parte ${partIdx + 1}/${totalParts})` : "";
            const descripcion = `Resumen ventas ${dayFmt} - Pagos Digitales${partLabel}`;

            try {
              // ── BLOQUEO ATÓMICO: marca como 'processing' con timestamp TTL ──
              const now_iso = new Date().toISOString();
              const lockResult = await batchUpdate(
                supabase, subIds,
                { billing_status: "processing", billing_processing_at: now_iso },
                { column: "billing_status", value: "pending" }
              );

              if (lockResult.error) {
                errors.push(`${dayFmt}${partLabel}: Error al adquirir lock: ${lockResult.error.message}`);
                continue;
              }

              if (lockResult.updatedCount === 0) {
                console.warn(`[auto-billing] ${dayFmt}${partLabel}: ya procesado por otro proceso — saltando`);
                continue;
              }

              // ── CONSTRUIR PAYLOAD y llamar a Nubefact ──
              const totalFinal  = round2(subTotal);
              const items       = buildItems(totalFinal, descripcion, igvPct);
              const hoy = new Date();
              const emissionDate = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;

              const genRes = await fetch(`${supabaseUrl}/functions/v1/generate-document`, {
                method:  "POST",
                headers: { "Authorization": `Bearer ${serviceKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  school_id:      schoolId,
                  tipo:           2,
                  emission_date:  emissionDate,
                  cliente: { doc_type: "-", doc_number: "-", razon_social: "Consumidor Final", direccion: "-" },
                  items,
                  monto_total:    totalFinal,
                  payment_method: "transferencia",
                }),
              });

              let result: any = null;
              try { result = await genRes.json(); } catch (_) {}

              if (!result?.success) {
                // ROLLBACK: volver a pending, limpiar timestamp
                await batchUpdate(supabase, subIds, { billing_status: "pending", billing_processing_at: null });
                const errMsg = result?.error || result?.nubefact?.errors || `HTTP ${genRes.status}`;
                errors.push(`${dayFmt}${partLabel}: Nubefact falló → rollback. Error: ${errMsg}`);
                continue;
              }

              if (!result.documento?.serie || !result.documento?.numero) {
                await batchUpdate(supabase, subIds, { billing_status: "pending", billing_processing_at: null });
                errors.push(`${dayFmt}${partLabel}: Nubefact OK pero sin datos → rollback`);
                continue;
              }

              // ── ÉXITO: marcar 'sent', limpiar timestamp TTL ──
              const sentResult = await batchUpdate(supabase, subIds, {
                billing_status: "sent",
                billing_processing_at: null,
              });

              if (sentResult.error) {
                errors.push(`${dayFmt}${partLabel}: Boleta emitida pero error al marcar sent: ${sentResult.error.message}`);
                continue;
              }

              // Vincular invoice_id (no crítico)
              const invoiceId = result.documento?.id ?? null;
              if (invoiceId) {
                await batchUpdate(supabase, subIds, { invoice_id: invoiceId });
              }

              const serie = `${result.documento.serie}-${String(result.documento.numero).padStart(8, "0")}`;
              console.log(`[auto-billing] ✅ ${dayFmt}${partLabel} → ${serie} | S/ ${totalFinal} | ${subIds.length} txs`);
              groupsProcessed++;
              totalAmount += totalFinal;

            } catch (groupErr) {
              // Rollback best-effort si hay excepción inesperada
              try {
                await batchUpdate(supabase, subIds, { billing_status: "pending", billing_processing_at: null });
              } catch (_) {}
              errors.push(`${dayFmt}${partLabel}: Excepción → rollback. ${String(groupErr)}`);
            }
          } // end for subBatches
        } // end for map

      } catch (sedeErr) {
        errors.push(`Error general sede ${schoolId}: ${String(sedeErr)}`);
      }

      // Log de auditoría
      await supabase.from("auto_billing_logs").insert({
        school_id:        schoolId,
        groups_processed: groupsProcessed,
        total_amount:     totalAmount,
        errors:           errors.length > 0 ? errors : null,
        status:           errors.length === 0 ? "success" : groupsProcessed > 0 ? "partial" : "error",
      });

      results.push({ school_id: schoolId, groups: groupsProcessed, total: totalAmount, errors, zombies_reset: zombiesReset });
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("auto-billing ERROR FATAL:", error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
