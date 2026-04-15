// api/cron/auto-invoice.ts
// ============================================================
// CRON JOB — Auto-Boleteo Mensual por Sede
// ============================================================
// Llamado por Vercel Cron (vercel.json) cada hora en punto.
// Vercel agrega automáticamente: Authorization: Bearer <CRON_SECRET>
//
// Lógica:
//   1. Verificar CRON_SECRET (seguridad)
//   2. Calcular hora actual en Lima (UTC-5)
//   3. Buscar sedes con auto_facturacion_activa=true cuya hora coincida
//   4. Por cada sede: verificar idempotencia, obtener pendientes, emitir
//   5. Registrar resultado en logs_auto_facturacion
//
// Variables de entorno requeridas:
//   CRON_SECRET               — Vercel lo genera automáticamente
//   SUPABASE_URL              — URL del proyecto Supabase
//   SUPABASE_SERVICE_ROLE_KEY — Clave de servicio (nunca exponer al frontend)
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// ── Constantes idénticas a CierreMensual.tsx ─────────────────────────────────
// IMPORTANTE: si cambias estos valores en el frontend, cámbialos aquí también.
const TODOS_LOS_METODOS = [
  'yape', 'yape_qr', 'yape_numero',
  'plin', 'plin_qr', 'plin_numero',
  'transferencia', 'transfer',
  'tarjeta', 'card',
];
const MAX_TX_PER_BOLETA  = 900;  // Límite SUNAT: 1000 ítems por comprobante
const SUNAT_AMOUNT_LIMIT = 650;  // Límite boleta sin identificación: S/ 700 (margen 7%)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAUSA_ENTRE_BOLETAS_MS = 1500; // No saturar Nubefact entre llamadas

// ── Helpers (misma lógica que CierreMensual.tsx) ────────────────────────────
function round2(n: number) { return Math.round(n * 100) / 100; }
function filterUUIDs(ids: string[]) { return ids.filter(id => UUID_RE.test(id)); }
function chunks<T>(arr: T[], size: number): T[][] {
  const r: T[][] = [];
  for (let i = 0; i < arr.length; i += size) r.push(arr.slice(i, i + size));
  return r;
}

function toLimaDayString(utcStr: string): string {
  // UTC-5 → Lima
  const limaDate = new Date(new Date(utcStr).getTime() - 5 * 60 * 60 * 1000);
  return limaDate.toISOString().split('T')[0];
}

// Divide en sub-lotes por monto (mismo algoritmo que CierreMensual)
function splitByAmountLimit(
  pairs: { id: string; amount: number }[],
  maxSoles: number,
): { id: string; amount: number }[][] {
  const batches: typeof pairs[] = [];
  let current: typeof pairs = [];
  let currentCents = 0;
  const maxCents = Math.round(maxSoles * 100);
  for (const p of pairs) {
    const pCents = Math.round(p.amount * 100);
    if (currentCents + pCents > maxCents && current.length > 0) {
      batches.push(current);
      current = [p];
      currentCents = pCents;
    } else {
      current.push(p);
      currentCents += pCents;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

// Construye array de ítems para Nubefact (centavos → evita IEEE 754)
function buildItems(totalRedondeado: number, descripcion: string, igvPct = 18) {
  const totalCents  = Math.round(totalRedondeado * 100);
  const divisorX100 = 100 + igvPct;
  const baseCents   = Math.floor(totalCents * 100 / divisorX100);
  const igvCents    = totalCents - baseCents;
  return [{
    unidad_de_medida:        'NIU',
    codigo:                  'RESUMEN',
    descripcion,
    cantidad:                1,
    valor_unitario:          baseCents / 100,
    precio_unitario:         totalRedondeado,
    descuento:               '',
    subtotal:                baseCents / 100,
    tipo_de_igv:             1,
    igv:                     igvCents / 100,
    total:                   totalRedondeado,
    anticipo_regularizacion: false,
  }];
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Handler principal ─────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel Cron usa GET; también permitimos POST para pruebas manuales
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  // ── Seguridad: verificar CRON_SECRET ────────────────────────────────────────
  // Vercel inyecta automáticamente "Authorization: Bearer <CRON_SECRET>"
  // en cada llamada del cron job. Cualquier llamada externa sin este header
  // recibirá 401.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(500).json({
      error: 'CRON_SECRET no está configurado en las variables de entorno de Vercel.',
    });
  }
  const authHeader = req.headers['authorization'] ?? '';
  if (authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'No autorizado.' });
  }

  // ── Cliente Supabase con service role ────────────────────────────────────────
  // Service role bypassa RLS → puede leer y escribir en todas las tablas.
  // NUNCA exponer SUPABASE_SERVICE_ROLE_KEY al frontend (sin prefijo VITE_).
  const supabaseUrl     = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({
      error: 'Faltan variables de entorno: SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.',
    });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Calcular fecha y hora actual en Lima (UTC-5) ─────────────────────────────
  const nowUtc   = new Date();
  const nowLima  = new Date(nowUtc.getTime() - 5 * 60 * 60 * 1000);
  const horaHH   = String(nowLima.getUTCHours()).padStart(2, '0');
  const horaMM   = String(nowLima.getUTCMinutes()).padStart(2, '0');
  const horaLima = `${horaHH}:${horaMM}`;

  // Fecha Lima en formato YYYY-MM-DD (para idempotencia y logs)
  const y  = nowLima.getUTCFullYear();
  const mo = String(nowLima.getUTCMonth() + 1).padStart(2, '0');
  const d  = String(nowLima.getUTCDate()).padStart(2, '0');
  const fechaHoy  = `${y}-${mo}-${d}`;
  const mesActual = `${y}-${mo}`;

  // Fecha de emisión = hoy Lima (misma lógica que emissionDateOverride en el frontend)
  const emissionDate = fechaHoy;

  // Rango UTC del mes en Lima (start = día 1 a las 05:00 UTC = medianoche Lima)
  const [anio, mes] = mesActual.split('-').map(Number);
  const rangeStart  = new Date(Date.UTC(anio, mes - 1, 1, 5, 0, 0)).toISOString();
  const rangeEnd    = new Date(Date.UTC(anio, mes,     1, 5, 0, 0)).toISOString();

  // ── Buscar sedes activas ────────────────────────────────────────────────────
  const { data: allSchools, error: schoolsErr } = await supabase
    .from('schools')
    .select('id, name, hora_cierre_diario')
    .eq('auto_facturacion_activa', true)
    .eq('is_active', true);

  if (schoolsErr) {
    return res.status(500).json({
      error: 'Error consultando sedes',
      details: schoolsErr.message,
    });
  }

  // Filtrar sedes cuya hora configurada coincida con la hora actual (comparar HH)
  // El cron corre cada hora en punto → comparamos solo la hora entera.
  const sedesDeLaHora = (allSchools ?? []).filter(s => {
    const hh = (s.hora_cierre_diario as string | null)?.slice(0, 2) ?? '23';
    return hh === horaHH;
  });

  if (sedesDeLaHora.length === 0) {
    return res.status(200).json({
      ok:               true,
      hora_lima:        horaLima,
      fecha:            fechaHoy,
      sedes_procesadas: [],
      message:          'No hay sedes configuradas para esta hora.',
    });
  }

  // ── Procesar cada sede ────────────────────────────────────────────────────────
  const resultados: Record<string, unknown>[] = [];

  for (const school of sedesDeLaHora) {
    const schoolId   = school.id as string;
    const schoolName = school.name as string;

    try {
      // ── CANDADO DE IDEMPOTENCIA ────────────────────────────────────────────
      // Si ya hay un log 'ok' para esta sede y hoy, no volvemos a procesar.
      // Previene que el cron emita boletas duplicadas si se dispara dos veces.
      const { data: logExistente } = await supabase
        .from('logs_auto_facturacion')
        .select('id')
        .eq('school_id', schoolId)
        .eq('fecha_proceso', fechaHoy)
        .eq('estado', 'ok')
        .maybeSingle();

      if (logExistente) {
        resultados.push({ school: schoolName, estado: 'ya_procesado', fecha: fechaHoy });
        continue;
      }

      // ── PFC-03: Recuperar zombies antes de emitir ──────────────────────────
      // Transacciones en billing_status='processing' con más de 30 min y sin invoice_id
      // son procesos fallidos de ejecuciones anteriores. Las devolvemos a 'pending'
      // para que este cron las retome. Sin este paso quedan atascadas para siempre.
      const ttlCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { data: zombieRows } = await supabase
        .from('transactions')
        .select('id')
        .eq('school_id', schoolId)
        .eq('billing_status', 'processing')
        .lt('billing_processing_at', ttlCutoff)
        .is('invoice_id', null);

      if (zombieRows && zombieRows.length > 0) {
        const zombieIds = zombieRows.map((r: { id: string }) => r.id);
        let zombiesRecovered = 0;
        for (const batch of chunks(zombieIds, 500)) {
          const { data: recovered } = await supabase
            .from('transactions')
            .update({ billing_status: 'pending', billing_processing_at: null })
            .in('id', batch)
            .eq('billing_status', 'processing')
            .is('invoice_id', null)
            .select('id');
          zombiesRecovered += (recovered ?? []).length;
        }
        console.log(`[auto-invoice] ${schoolName}: ${zombiesRecovered} zombies recuperados a 'pending'.`);
      }

      // ── Obtener % IGV de la sede ───────────────────────────────────────────
      const { data: billingCfg } = await supabase
        .from('billing_config')
        .select('igv_porcentaje')
        .eq('school_id', schoolId)
        .single();
      const igvPct = Number(billingCfg?.igv_porcentaje ?? 18);

      // ── Traer pedidos de almuerzo cancelados (para excluirlos) ─────────────
      const { data: cancelledOrders } = await supabase
        .from('lunch_orders')
        .select('id')
        .eq('school_id', schoolId)
        .eq('status', 'cancelled')
        .gte('created_at', rangeStart)
        .lt('created_at', rangeEnd);
      const cancelledLunchIds = new Set<string>(
        (cancelledOrders ?? []).map((o: { id: string }) => o.id),
      );

      // ── Obtener transacciones pendientes del mes (paginado) ─────────────────
      const PAGE_SIZE = 1000;
      const allRows: {
        id: string; created_at: string; amount: number;
        payment_method: string | null; school_id: string;
        metadata?: Record<string, unknown> | null;
      }[] = [];
      let from = 0;
      let hasMore = true;

      while (hasMore) {
        const { data: page, error: pageErr } = await supabase
          .from('transactions')
          .select('id, created_at, amount, payment_method, school_id, metadata')
          .eq('school_id', schoolId)
          .eq('is_taxable', true)
          .eq('billing_status', 'pending')
          .eq('document_type', 'ticket')
          .eq('payment_status', 'paid')
          .neq('amount', 0)
          .in('payment_method', TODOS_LOS_METODOS)
          .gte('created_at', rangeStart)
          .lt('created_at', rangeEnd)
          .order('created_at', { ascending: true })
          .range(from, from + PAGE_SIZE - 1);

        if (pageErr) throw pageErr;
        const rows = page ?? [];
        allRows.push(...rows);
        hasMore = rows.length === PAGE_SIZE;
        from   += PAGE_SIZE;
      }

      // ── Agrupar por día Lima ───────────────────────────────────────────────
      const map = new Map<string, {
        day: string;
        txIds: string[];
        amounts: number[];
        totalCents: number;
        schoolId: string;
      }>();

      for (const row of allRows) {
        const day = toLimaDayString(row.created_at);
        if (!day.startsWith(mesActual)) continue;
        if (!TODOS_LOS_METODOS.includes(row.payment_method ?? '')) continue;

        // Excluir si el lunch_order asociado está cancelado
        const lunchOrderId = (row.metadata as any)?.lunch_order_id as string | undefined;
        if (lunchOrderId && cancelledLunchIds.has(lunchOrderId)) continue;

        if (!map.has(day)) {
          map.set(day, {
            day, txIds: [], amounts: [], totalCents: 0,
            schoolId: row.school_id ?? schoolId,
          });
        }
        const g   = map.get(day)!;
        const amt = round2(Math.abs(row.amount));
        g.txIds.push(row.id);
        g.amounts.push(amt);
        g.totalCents += Math.round(amt * 100);
      }

      const groups = Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day));

      if (groups.length === 0) {
        await supabase.from('logs_auto_facturacion').insert({
          school_id:     schoolId,
          fecha_proceso: fechaHoy,
          estado:        'sin_pendientes',
          dias_emitidos: 0,
          monto_total:   0,
          detalle:       { hora_lima: horaLima, mes: mesActual },
        });
        resultados.push({ school: schoolName, estado: 'sin_pendientes' });
        continue;
      }

      // ── Emitir boletas día a día (misma lógica que handleBoletear) ─────────
      let diasEmitidos = 0;
      let montoTotal   = 0;
      const errores: string[] = [];

      for (const group of groups) {
        const realIds = filterUUIDs(group.txIds);
        if (realIds.length === 0) continue;

        // Formato DD/MM/YYYY (sin date-fns en Node)
        const [yyyy, mm, dd] = group.day.split('-');
        const dayFmt = `${dd}/${mm}/${yyyy}`;

        const orderedPairs = realIds.map((id, i) => ({
          id,
          amount: group.amounts[i] ?? 0,
        }));

        // Split por monto + split por cantidad
        const amountBatches = splitByAmountLimit(orderedPairs, SUNAT_AMOUNT_LIMIT);
        const finalBatches: { pairs: typeof orderedPairs }[] = [];
        for (const ab of amountBatches) {
          for (const batch of chunks(ab, MAX_TX_PER_BOLETA)) {
            finalBatches.push({ pairs: batch });
          }
        }

        for (let partIdx = 0; partIdx < finalBatches.length; partIdx++) {
          const { pairs: subBatch } = finalBatches[partIdx];
          const subIds        = subBatch.map(p => p.id);
          const subTotalCents = subBatch.reduce((acc, p) => acc + Math.round(p.amount * 100), 0);
          const subTotal      = subTotalCents / 100;
          const partLabel     = finalBatches.length > 1 ? ` (${partIdx + 1}/${finalBatches.length})` : '';
          const descripcion   = `Resumen Ventas Diarias ${dayFmt}${partLabel}`;

          // ── BLOQUEO ATÓMICO ─────────────────────────────────────────────────
          // Marca como 'processing' solo si siguen en 'pending'.
          // Si otro proceso ya las tomó, lockedCount = 0 y saltamos.
          const processingAt = new Date().toISOString();
          let lockedCount = 0;
          for (const batch of chunks(subIds, 500)) {
            const { data: lockRows } = await supabase
              .from('transactions')
              .update({ billing_status: 'processing', billing_processing_at: processingAt })
              .in('id', batch)
              .eq('billing_status', 'pending')
              .select('id');
            lockedCount += (lockRows ?? []).length;
          }

          if (lockedCount === 0) continue; // ya procesado por otro proceso o usuario

          try {
            const totalFinal = round2(subTotal);
            const items      = buildItems(totalFinal, descripcion, igvPct);

            // ── Llamar Edge Function generate-document ──────────────────────
            // El cliente service-role pasa "Authorization: Bearer <service-role-key>"
            // que la Edge Function acepta en lugar del JWT de usuario.
            const { data: result, error: fnErr } = await supabase.functions.invoke(
              'generate-document',
              {
                body: {
                  school_id:      group.schoolId,
                  tipo:           2,              // 2 = Boleta de Venta
                  emission_date:  emissionDate,
                  cliente: {
                    doc_type:    '-',
                    doc_number:  '-',
                    razon_social: 'Consumidor Final',
                    direccion:   '-',
                  },
                  items,
                  monto_total:    totalFinal,
                  payment_method: 'digital',
                },
              },
            );

            if (fnErr) throw fnErr;
            if (!result?.success) {
              throw new Error(result?.error || result?.nubefact?.errors || 'Error en Nubefact');
            }
            if (!result.documento?.serie || !result.documento?.numero) {
              throw new Error('Nubefact respondió OK pero sin datos del comprobante.');
            }

            // ── PFC-02: UPDATE ATÓMICO con verificación de error ──────────────
            // Si Nubefact responde 'processing' (boleta asíncrona), igualmente
            // marcamos como 'sent' + guardamos invoice_id. El poller actualiza después.
            // CRÍTICO: verificar el error del UPDATE. Si falla silenciosamente,
            // las transacciones quedan en 'processing' → zombie → duplicate en SUNAT.
            const invoiceId: string | null = result.documento?.id ?? null;
            const isSunatProcessing = result.sunat_status === 'processing' ||
                                      (result.documento as any)?.sunat_status === 'processing';
            let updateBillingError: string | null = null;

            for (const batch of chunks(subIds, 500)) {
              const { error: updErr } = await supabase
                .from('transactions')
                .update({
                  billing_status:        'sent',
                  billing_processing_at: null,
                  invoice_id:            invoiceId,
                })
                .in('id', batch);
              if (updErr) {
                updateBillingError = updErr.message;
                break;
              }
            }

            if (updateBillingError) {
              // BOLETA YA EXISTE EN SUNAT. No hacer rollback — dejar en 'processing'.
              // El zombie-recovery de la próxima ejecución intentará re-vincular.
              // Es CRÍTICO NO crear una segunda boleta con otro número correlativo.
              const critMsg = `CRÍTICO [${schoolName}] Boleta ${result.documento?.serie}-${result.documento?.numero} enviada a SUNAT (invoice_id: ${invoiceId}) pero BD no se actualizó. Error: ${updateBillingError}. Verificar manualmente.`;
              console.error(`[auto-invoice] ${critMsg}`);
              errores.push(critMsg);
              // No incrementar diasEmitidos — necesita verificación manual
              continue;
            }

            diasEmitidos++;
            montoTotal = round2(montoTotal + totalFinal);
            if (isSunatProcessing) {
              console.log(`[auto-invoice] ${descripcion} → en cola SUNAT (ticket: ${result.nubefact?.ticket ?? '?'})`);
            }

          } catch (partErr: unknown) {
            const msg = partErr instanceof Error ? partErr.message : String(partErr);
            errores.push(`${group.day} parte ${partIdx + 1}: ${msg}`);

            // PFC-07: Rollback SOLO si la boleta NO llegó a SUNAT (invoice_id nulo).
            // Nunca revertir si invoice_id ya fue asignado (boleta existe en SUNAT).
            // Filtramos por 'processing' + IS NULL invoice_id para seguridad doble.
            try {
              let rolledBack = 0;
              for (const batch of chunks(subIds, 500)) {
                const { data: reverted } = await supabase
                  .from('transactions')
                  .update({ billing_status: 'pending', billing_processing_at: null })
                  .in('id', batch)
                  .eq('billing_status', 'processing')
                  .is('invoice_id', null)
                  .select('id');
                rolledBack += (reverted ?? []).length;
              }
              if (rolledBack > 0) {
                console.warn(`[auto-invoice] Rollback: ${rolledBack} txns devueltas a 'pending' tras error en ${group.day} parte ${partIdx + 1}. Error: ${msg}`);
              }
            } catch { /* best-effort */ }
          }

          // Pausa entre boletas para no saturar Nubefact
          await sleep(PAUSA_ENTRE_BOLETAS_MS);
        }
      }

      // ── Registrar resultado en logs ────────────────────────────────────────
      const estadoFinal = errores.length === 0
        ? 'ok'
        : diasEmitidos > 0 ? 'ok' : 'error'; // 'ok' parcial si al menos un día salió bien

      await supabase.from('logs_auto_facturacion').insert({
        school_id:     schoolId,
        fecha_proceso: fechaHoy,
        estado:        estadoFinal,
        dias_emitidos: diasEmitidos,
        monto_total:   montoTotal,
        detalle: {
          hora_lima: horaLima,
          mes:       mesActual,
          errores:   errores.length > 0 ? errores : undefined,
        },
      });

      resultados.push({
        school:        schoolName,
        estado:        estadoFinal,
        dias_emitidos: diasEmitidos,
        monto_total:   montoTotal,
        errores:       errores.length > 0 ? errores : [],
      });

    } catch (err: unknown) {
      // Error fatal de la sede (BD caída, configuración rota, etc.)
      const msg = err instanceof Error ? err.message : String(err);

      // Intentar guardar el error en logs; si esto también falla, solo lo ignoramos
      await supabase.from('logs_auto_facturacion').insert({
        school_id:     schoolId,
        fecha_proceso: fechaHoy,
        estado:        'error',
        dias_emitidos: 0,
        monto_total:   0,
        detalle:       { hora_lima: horaLima, error: msg },
      }).catch(() => undefined);

      resultados.push({ school: schoolName, estado: 'error', error: msg });
    }
  }

  return res.status(200).json({
    ok:               true,
    hora_lima:        horaLima,
    fecha:            fechaHoy,
    sedes_procesadas: resultados,
  });
}
