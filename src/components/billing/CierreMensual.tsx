import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { logErrorAsync } from '@/lib/logError';
import { useRole } from '@/hooks/useRole';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Loader2, Receipt, Smartphone, RefreshCw,
  CheckCircle2, CalendarDays, Building2, Info,
  AlertTriangle, ShieldCheck, ChevronDown, ChevronUp,
  Clock, XCircle,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

// ── Métodos de pago digitales que entran al cierre mensual ────────────────────
// Regla contable (Art. 4 Ley IGV): se boletean cuando ingresa el dinero al banco.
// Incluye: compras directas (type=purchase) Y recargas (type=recharge) con pago digital.
// Excluido: 'saldo' — ese dinero ya se boleteó cuando entró como recarga.
// El POS mapea: 'tarjeta' → 'card', 'transferencia' → 'transfer' antes de guardar en BD.
const TODOS_LOS_METODOS = [
  'yape', 'yape_qr', 'yape_numero',
  'plin', 'plin_qr', 'plin_numero',
  'transferencia', 'transfer',
  'tarjeta',       'card',
];

// Máximo de transacciones por boleta resumen (límite Nubefact/SUNAT = 1000 ítems)
const MAX_TX_PER_BOLETA = 900;

// ── Límite de monto por boleta (SUNAT: boletas sin DNI/RUC deben ser < S/ 700) ──
// S/ 650 = margen del 7% bajo el límite legal. La variación natural de los montos
// de transacción (~S/ 14 promedio) produce totales orgánicamente distintos por boleta.
const SUNAT_AMOUNT_LIMIT = 650;

// Divide transacciones en sub-lotes donde la suma de cada lote <= maxSoles.
// Usa aritmética entera (centavos) para evitar errores de redondeo IEEE 754.
function splitByAmountLimit(
  pairs: { id: string; amount: number }[],
  maxSoles: number
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

// Clave localStorage para lock optimista por sede
const uiLockKey = (schoolId: string) => `billing_lock_${schoolId}`;
interface UiLock { schoolId: string; startedAt: number; expiresAt: number; groupKey?: string }

function getUiLock(schoolId: string): UiLock | null {
  try {
    const raw = localStorage.getItem(uiLockKey(schoolId));
    if (!raw) return null;
    const lock: UiLock = JSON.parse(raw);
    if (Date.now() > lock.expiresAt) {
      localStorage.removeItem(uiLockKey(schoolId));
      return null;
    }
    return lock;
  } catch { return null; }
}

function setUiLock(schoolId: string, groupKey?: string) {
  // 45 min: días con muchas boletas (split por S/ 499) pueden tomar ~30 min
  const lock: UiLock = { schoolId, startedAt: Date.now(), expiresAt: Date.now() + 5 * 60 * 1000, groupKey };
  localStorage.setItem(uiLockKey(schoolId), JSON.stringify(lock));
}

function clearUiLock(schoolId: string) {
  localStorage.removeItem(uiLockKey(schoolId));
}

interface BillingGroup {
  key: string;              // 'YYYY-MM-DD'
  day: string;              // 'YYYY-MM-DD' (hora Lima)
  dayLabel: string;         // 'Martes 15/03'
  total: number;
  totalCents: number;       // suma en centavos (entero) — inmune a IEEE 754
  transactionIds: string[];
  amounts: number[];        // monto redondeado por transacción (paralelo a transactionIds)
  negativeCount: number;
  count: number;
  estimatedBoletas: number; // ceil(total / SUNAT_AMOUNT_LIMIT) — para mostrar en UI
  schoolId: string;
}

interface School {
  id: string;
  name: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Filtra solo UUIDs válidos antes de cualquier UPDATE — previene "invalid input syntax for type uuid"
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function filterUUIDs(ids: string[]): string[] {
  return ids.filter(id => UUID_RE.test(id));
}

// Divide un array en chunks para evitar URL overflow en PostgREST (>500 IDs)
function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

function toLimaDate(utcStr: string): Date {
  return new Date(new Date(utcStr).getTime() - 5 * 60 * 60 * 1000);
}

function toLimaDayString(utcStr: string): string {
  return toLimaDate(utcStr).toISOString().split('T')[0];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Construye el array de items para Nubefact asegurando que base + igv = total exacto.
// Usa aritmética de centavos (enteros) para evitar ruido IEEE 754.
function buildItems(totalRedondeado: number, descripcion: string, igvPct = 18) {
  const totalCents  = Math.round(totalRedondeado * 100);
  const divisorX100 = 100 + igvPct;                          // ej. 110.5 para 10.5%
  const baseCents   = Math.floor(totalCents * 100 / divisorX100);
  const igvCents    = totalCents - baseCents;
  const base        = baseCents / 100;
  const igv         = igvCents  / 100;
  return [{
    unidad_de_medida:        'NIU',
    codigo:                  'RESUMEN',
    descripcion,
    cantidad:                1,
    valor_unitario:          base,
    precio_unitario:         totalRedondeado,
    descuento:               '',
    subtotal:                base,
    tipo_de_igv:             1,        // 1 = Gravado – Operación Onerosa (Nubefact API)
    igv,
    total:                   totalRedondeado,
    anticipo_regularizacion: false,
  }];
}

// ── Componente principal ──────────────────────────────────────────────────────
export const CierreMensual = () => {
  const { user }  = useAuth();
  const { role }  = useRole();
  const { toast } = useToast();

  const isAdmin = role === 'admin_general' || role === 'superadmin';

  const [selectedMonth, setSelectedMonth]         = useState('2026-03');
  // Fecha de emisión que figurará en todas las boletas del cierre.
  // Default = último día del mes seleccionado (contadora puede retrofechar hasta 7 días → SUNAT).
  const [emissionDateOverride, setEmissionDateOverride] = useState<string>(() => {
    const saved = localStorage.getItem('cierre_emission_date');
    if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved)) return saved;
    // Default: hoy en hora Lima (UTC-5)
    const hoyLima = new Date(Date.now() - 5 * 60 * 60 * 1000);
    const y = hoyLima.getUTCFullYear();
    const m = String(hoyLima.getUTCMonth() + 1).padStart(2, '0');
    const d = String(hoyLima.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  });
  const [schoolId, setSchoolId]           = useState<string | null>(null);
  const [schools, setSchools]             = useState<School[]>([]);
  const [loadingSchool, setLoadingSchool] = useState(true);
  const [igvPct, setIgvPct]              = useState<number>(18);
  const [groups, setGroups]               = useState<BillingGroup[]>([]);
  const [loading, setLoading]             = useState(false);
  const [boletearing, setBoletearing]     = useState<Set<string>>(new Set());
  const [sentKeys, setSentKeys]           = useState<Set<string>>(new Set());
  const [boletearingAll, setBoletearingAll] = useState(false);
  const [allProgress, setAllProgress]      = useState<{ done: number; total: number } | null>(null);

  // FIX 5: Optimistic UI Lock — detecta proceso en marcha al recargar la página
  const [uiLockActive, setUiLockActive]     = useState<UiLock | null>(null);
  // FIX 1: Zombies detectados al cargar el componente
  const [zombieCount, setZombieCount]       = useState(0);
  const [resettingZombies, setResettingZombies] = useState(false);
  // FIX 4: Alertas de transacciones negativas
  const [negativeAlerts, setNegativeAlerts] = useState<{ count: number; total: number } | null>(null);

  // Panel de rescate (huérfanas sent/processing sin invoice_id)
  const [showRescue, setShowRescue]   = useState(false);
  const [rescuing, setRescuing]       = useState(false);
  const [scanned, setScanned]         = useState(false);
  const [orphanRows, setOrphanRows]   = useState<{
    id: string; created_at: string; amount: number; payment_method: string | null;
  }[]>([]);
  const orphanCount = orphanRows.length;
  const orphanTotal = round2(orphanRows.reduce((s, r) => s + Math.abs(r.amount), 0));

  // Panel de excluded (transacciones is_taxable=true que Nubefact rechazó al aprobar voucher)
  const [showExcluded, setShowExcluded]         = useState(false);
  const [excludedRows, setExcludedRows]         = useState<{
    id: string; created_at: string; amount: number; payment_method: string | null;
  }[]>([]);
  const [excludedScanned, setExcludedScanned]   = useState(false);
  const [scanningExcluded, setScanningExcluded] = useState(false);
  const [retryingExcluded, setRetryingExcluded] = useState(false);
  const excludedCount = excludedRows.length;
  const excludedTotal = round2(excludedRows.reduce((s, r) => s + Math.abs(r.amount), 0));

  // ── Cargar school_id del usuario ─────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      if (!user) return;
      setLoadingSchool(true);
      try {
        if (isAdmin) {
          const { data } = await supabase.from('schools').select('id, name').order('name');
          const list = data ?? [];
          setSchools(list);
          if (list.length > 0) setSchoolId(list[0].id);
        } else {
          const { data: profile } = await supabase
            .from('profiles').select('school_id').eq('id', user.id).single();
          if (profile?.school_id) setSchoolId(profile.school_id);
        }
      } finally {
        setLoadingSchool(false);
      }
    };
    init();
  }, [user, isAdmin]);

  // Auto-actualizar fecha de emisión cuando cambia el mes → último día del mes
  useEffect(() => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    setEmissionDateOverride(`${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`);
  }, [selectedMonth]);

  // ── Cargar IGV + detectar zombies y locks al cambiar de sede ────────────────
  useEffect(() => {
    if (!schoolId) return;

    // IGV dinámico
    supabase
      .from('billing_config')
      .select('igv_porcentaje')
      .eq('school_id', schoolId)
      .single()
      .then(({ data }) => {
        if (data?.igv_porcentaje) setIgvPct(Number(data.igv_porcentaje));
        else setIgvPct(18);
      });

    // FIX 5: Revisar si hay un lock activo en localStorage (detecta F5 durante proceso)
    const existingLock = getUiLock(schoolId);
    setUiLockActive(existingLock);

    // FIX 1: Detectar zombies (processing > 30 min) para mostrar alerta
    const ttlCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', schoolId)
      .eq('billing_status', 'processing')
      .lt('billing_processing_at', ttlCutoff)
      .then(({ count }) => setZombieCount(count ?? 0));

    // Las transacciones de kiosco se guardan con amount negativo (débitos),
    // por eso se usa Math.abs() al mostrar. La alerta de "negativos" no aplica aquí.
    setNegativeAlerts(null);
  }, [schoolId, selectedMonth]);

  // ── Calcular rango UTC del mes seleccionado ───────────────────────────────────
  const getMonthRange = () => {
    const [year, month] = selectedMonth.split('-').map(Number);
    return {
      start: new Date(Date.UTC(year, month - 1, 1, 5, 0, 0)),
      end:   new Date(Date.UTC(year, month,     1, 5, 0, 0)),
    };
  };

  // ── Cargar grupos pendientes ─────────────────────────────────────────────────
  const fetchGroups = useCallback(async () => {
    if (!schoolId || !selectedMonth) return;
    setLoading(true);
    setGroups([]);
    setSentKeys(new Set());
    setScanned(false);
    setOrphanRows([]);

    try {
      const { start, end } = getMonthRange();
      const PAGE_SIZE = 1000;
      let allRows: {
        id: string; created_at: string; amount: number;
        payment_method: string | null; school_id: string;
        metadata?: { lunch_order_id?: string } | null;
      }[] = [];
      let from = 0, hasMore = true;

      // ── DOBLE CHECK: traer lunch_orders cancelados del mes en paralelo ────────
      // Si por algún error manual una transacción dice 'paid' pero su pedido
      // de almuerzo dice 'cancelled', NO debe sumarse al total de la boleta.
      const cancelledLunchOrdersPromise = supabase
        .from('lunch_orders')
        .select('id')
        .eq('school_id', schoolId)
        .eq('status', 'cancelled')
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString());

      while (hasMore) {
        const { data: page, error } = await supabase
          .from('transactions')
          .select('id, created_at, amount, payment_method, school_id, metadata')
          .eq('school_id', schoolId)
          .eq('is_taxable', true)
          .eq('billing_status', 'pending')
          .eq('document_type', 'ticket')
          .eq('payment_status', 'paid')
          .neq('amount', 0)                        // excluir transacciones en cero (compras negativas son válidas)
          .in('payment_method', TODOS_LOS_METODOS)
          .gte('created_at', start.toISOString())
          .lt('created_at', end.toISOString())
          .order('created_at', { ascending: true })
          .range(from, from + PAGE_SIZE - 1);

        if (error) throw error;
        const pageRows = page ?? [];
        allRows.push(...pageRows);
        hasMore = pageRows.length === PAGE_SIZE;
        from   += PAGE_SIZE;
      }

      // Resolver la query paralela de cancelados y construir el Set de IDs
      const { data: cancelledOrders } = await cancelledLunchOrdersPromise;
      const cancelledLunchOrderIds = new Set<string>(
        (cancelledOrders ?? []).map((o: { id: string }) => o.id)
      );

      const map = new Map<string, BillingGroup>();
      allRows.forEach(row => {
        const day = toLimaDayString(row.created_at);
        if (!day.startsWith(selectedMonth)) return;
        if (!TODOS_LOS_METODOS.includes(row.payment_method ?? '')) return;

        // ── FILTRO DOBLE CHECK ─────────────────────────────────────────────
        // Si la transacción tiene lunch_order_id y ese pedido está cancelado,
        // excluirla aunque payment_status = 'paid' (inconsistencia de datos).
        const lunchOrderId = (row.metadata as any)?.lunch_order_id;
        if (lunchOrderId && cancelledLunchOrderIds.has(lunchOrderId)) return;

        if (!map.has(day)) {
          map.set(day, {
            key:              day,
            day,
            dayLabel:         format(parseISO(day), 'EEE dd/MM', { locale: es })
                                .replace(/^\w/, c => c.toUpperCase()),
            total:            0,
            totalCents:       0,
            transactionIds:   [],
            amounts:          [],
            negativeCount:    0,
            count:            0,
            estimatedBoletas: 0,
            schoolId:         row.school_id ?? schoolId,
          });
        }
        const g = map.get(day)!;
        const amtRounded = round2(Math.abs(row.amount));
        g.transactionIds.push(row.id);
        g.amounts.push(amtRounded);
        g.totalCents += Math.round(amtRounded * 100);
        g.count      += 1;
      });

      // Total desde enteros; estimado de boletas = ceil(total / límite)
      map.forEach(g => {
        g.total          = g.totalCents / 100;
        g.estimatedBoletas = Math.ceil(g.total / SUNAT_AMOUNT_LIMIT);
      });

      setGroups(
        Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day))
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      toast({ variant: 'destructive', title: 'Error al cargar datos', description: msg });
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId, selectedMonth, toast]);

  useEffect(() => {
    if (schoolId) fetchGroups();
  }, [fetchGroups, schoolId]);

  // ── FIX 1: Reset manual de zombies (TTL) ─────────────────────────────────────
  const handleResetZombies = async () => {
    if (!schoolId || resettingZombies) return;
    setResettingZombies(true);
    try {
      const ttlCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { data: zombieRows } = await supabase
        .from('transactions')
        .select('id')
        .eq('school_id', schoolId)
        .eq('billing_status', 'processing')
        .lt('billing_processing_at', ttlCutoff);

      if (!zombieRows || zombieRows.length === 0) {
        toast({ title: 'Sin zombies', description: 'No hay transacciones bloqueadas para recuperar.' });
        setZombieCount(0);
        return;
      }
      const zombieIds = filterUUIDs(zombieRows.map(r => r.id));
      let rescued = 0;
      for (const batch of chunks(zombieIds, 500)) {
        const { error } = await supabase
          .from('transactions')
          .update({ billing_status: 'pending', billing_processing_at: null })
          .in('id', batch);
        if (!error) rescued += batch.length;
      }
      setZombieCount(0);
      toast({ title: `${rescued} transacciones recuperadas`, description: 'Volvieron a "pending" y ya aparecen en la tabla.' });
      fetchGroups();
    } catch (err: unknown) {
      toast({ variant: 'destructive', title: 'Error', description: String(err) });
    } finally {
      setResettingZombies(false);
    }
  };

  // ── Emitir boleta(s) resumen ──────────────────────────────────────────────────
  const handleBoletear = async (group: BillingGroup) => {
    if (boletearing.has(group.key)) return;

    // FIX 5: OPTIMISTIC UI LOCK — verificar si hay proceso activo para esta sede
    if (schoolId) {
      const existingLock = getUiLock(schoolId);
      if (existingLock) {
        toast({
          title: 'Proceso en marcha',
          description: `Ya hay un proceso de facturación activo para esta sede (iniciado hace ${Math.floor((Date.now() - existingLock.startedAt) / 60000)} min). Espera a que termine o usa el panel de Rescate si quedó bloqueado.`,
        });
        return;
      }
      setUiLock(schoolId, group.key);
      setUiLockActive({ schoolId, startedAt: Date.now(), expiresAt: Date.now() + 45 * 60 * 1000, groupKey: group.key });
    }

    setBoletearing(prev => new Set([...prev, group.key]));

    // Solo trabajar con UUIDs válidos — previene errores PG con IDs virtuales
    const realIds = filterUUIDs(group.transactionIds);
    if (realIds.length === 0) {
      if (schoolId) clearUiLock(schoolId);
      setUiLockActive(null);
      toast({ variant: 'destructive', title: 'Error', description: 'El grupo no tiene IDs de transacción válidos.' });
      setBoletearing(prev => { const n = new Set(prev); n.delete(group.key); return n; });
      return;
    }

    const dayFmt       = format(parseISO(group.day), 'dd/MM/yyyy');
    const emissionDate = emissionDateOverride;

    // ── SPLIT POR MONTO (Art. 4 Ley IGV + SUNAT < S/ 700 sin identificación) ───
    // Se combinan todas las transacciones del día (recargas + compras directas con
    // pago digital). Se acumula hasta S/ 650 y se corta → nueva boleta.
    // La variación natural de montos (~S/ 14 promedio) produce totales orgánicos distintos.
    const orderedPairs = realIds.map((id) => {
      const idx = group.transactionIds.indexOf(id);
      return { id, amount: idx >= 0 ? group.amounts[idx] : 0 };
    });

    const amountBatches = splitByAmountLimit(orderedPairs, SUNAT_AMOUNT_LIMIT);
    const finalBatches: { pairs: typeof orderedPairs }[] = [];
    for (const ab of amountBatches) {
      for (const itemBatch of chunks(ab, MAX_TX_PER_BOLETA)) {
        finalBatches.push({ pairs: itemBatch });
      }
    }

    const totalParts = finalBatches.length;

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session?.access_token) throw new Error('Sesión expirada. Recarga la página.');

      for (let partIdx = 0; partIdx < finalBatches.length; partIdx++) {
        const { pairs: subBatch } = finalBatches[partIdx];
        const subIds        = subBatch.map(p => p.id);
        const subTotalCents = subBatch.reduce((acc, p) => acc + Math.round(p.amount * 100), 0);
        const subTotal      = subTotalCents / 100;
        const partLabel     = totalParts > 1 ? ` (${partIdx + 1}/${totalParts})` : '';
        const descripcion   = `Resumen Ventas Diarias ${dayFmt}${partLabel}`;

        // ── BLOQUEO ATÓMICO ──────────────────────────────────────────────────
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

        if (lockedCount === 0) {
          toast({
            title: `Parte ${partIdx + 1}/${totalParts} ya procesada`,
            description: 'Estas transacciones ya fueron tomadas por otro proceso.',
          });
          continue;
        }

        try {
          const totalFinal = round2(subTotal);
          const items      = buildItems(totalFinal, descripcion, igvPct);

          const { data: result, error: fnErr } = await supabase.functions.invoke(
            'generate-document',
            {
              body: {
                school_id:      group.schoolId,
                tipo:           2,
                emission_date:  emissionDate,
                cliente: { doc_type: '-', doc_number: '-', razon_social: 'Consumidor Final', direccion: '-' },
                items,
                monto_total:    totalFinal,
                payment_method: 'digital',
              },
            }
          );

          if (fnErr) throw fnErr;
          if (!result?.success) throw new Error(result?.error || result?.nubefact?.errors || 'Error en Nubefact');
          if (!result.documento?.serie || !result.documento?.numero) {
            throw new Error('Nubefact respondió OK pero sin datos del comprobante. Intenta de nuevo en unos minutos.');
          }

          // ── UPDATE ATÓMICO: billing_status + invoice_id en un solo query ──
          // CRÍTICO: si hacemos billing_status primero y luego invoice_id y falla el segundo,
          // el TTL puede resetear a 'pending' y se genera una segunda boleta duplicada en SUNAT.
          const invoiceId: string | null = result.documento?.id ?? null;
          let updateError: Error | null = null;

          for (const batch of chunks(subIds, 500)) {
            const { error: updErr } = await supabase
              .from('transactions')
              .update({
                billing_status:        'sent',
                billing_processing_at: null,
                invoice_id:            invoiceId,
              })
              .in('id', batch);
            if (updErr) { updateError = updErr; break; }
          }

          if (updateError) {
            // Boleta YA existe en SUNAT. NO hacer rollback — dejar en 'processing'.
            // El TTL NO reseteará porque invoice_id ya está seteado en los que sí se actualizaron.
            logErrorAsync('cierre_mensual', `CRÍTICO — boleta en SUNAT pero BD sin actualizar. invoice_id: ${invoiceId} — ${updateError.message}`, {
              schoolId: group.schoolId,
              context: { invoice_id: invoiceId, day: group.day, part: partIdx + 1, total_parts: totalParts, error: updateError.message },
            });
            toast({
              variant: 'destructive',
              title: '⚠️ Boleta en SUNAT — error de sincronización BD',
              description: `Parte ${partIdx + 1}/${totalParts}: comprobante emitido. Usar Panel de Rescate para verificar.`,
            });
            continue;
          }

          const serie = `${result.documento.serie}-${String(result.documento.numero).padStart(8, '0')}`;
          toast({
            title: `✅ ${totalParts > 1 ? `(${partIdx + 1}/${totalParts}) ` : ''}Boleta emitida`,
            description: `${descripcion} → ${serie} | S/ ${totalFinal.toFixed(2)}`,
          });

        } catch (partErr: unknown) {
          const msg = partErr instanceof Error ? partErr.message : String(partErr);
          logErrorAsync('cierre_mensual', `Error en parte ${partIdx + 1}/${totalParts}: ${msg}`, {
            schoolId: group.schoolId,
            context: { day: group.day, part: partIdx + 1, total_parts: totalParts, sub_ids: subIds, error: msg },
          });
          // Rollback SOLO si no tiene invoice_id (nunca llegó a SUNAT)
          try {
            for (const batch of chunks(subIds, 500)) {
              await supabase.from('transactions')
                .update({ billing_status: 'pending', billing_processing_at: null })
                .in('id', batch)
                .eq('billing_status', 'processing')
                .is('invoice_id', null);
            }
          } catch { /* best-effort */ }
          toast({ variant: 'destructive', title: `Error parte ${partIdx + 1}/${totalParts}`, description: msg });
        }
      } // end for finalBatches

      setSentKeys(prev => new Set([...prev, group.key]));

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      logErrorAsync('cierre_mensual', `Error general emitiendo boleta resumen: ${msg}`, {
        schoolId: group.schoolId,
        context: { day: group.day, error: msg },
      });
      try {
        for (const batch of chunks(realIds, 500)) {
          await supabase.from('transactions')
            .update({ billing_status: 'pending', billing_processing_at: null })
            .in('id', batch)
            .eq('billing_status', 'processing')
            .is('invoice_id', null);
        }
      } catch { /* best-effort */ }
      toast({ variant: 'destructive', title: 'Error al emitir boleta', description: msg });
    } finally {
      if (schoolId) { clearUiLock(schoolId); setUiLockActive(null); }
      setBoletearing(prev => {
        const next = new Set(prev);
        next.delete(group.key);
        return next;
      });
    }
  };

  // ── Boletear Todo automáticamente (secuencial, un día a la vez) ──────────────
  const handleBoletearAll = async () => {
    const pending = groups.filter(g => !sentKeys.has(g.key));
    if (pending.length === 0) {
      toast({ title: 'Sin días pendientes', description: 'Todos los días ya fueron emitidos.' });
      return;
    }
    setBoletearingAll(true);
    setAllProgress({ done: 0, total: pending.length });
    for (let i = 0; i < pending.length; i++) {
      const g = pending[i];
      setAllProgress({ done: i, total: pending.length });
      await handleBoletear(g);
      // Pequeña pausa entre días para no saturar Nubefact
      await new Promise(res => setTimeout(res, 1500));
    }
    setAllProgress(null);
    setBoletearingAll(false);
    toast({ title: '✅ Cierre completo', description: `${pending.length} días emitidos para esta sede.` });
  };

  // ── Panel de Rescate ──────────────────────────────────────────────────────────
  // Busca transacciones con billing_status='sent'/'processing' + document_type='ticket'
  // + invoice_id IS NULL. Esas son las verdaderas huérfanas de CierreMensual.
  // 'processing' puede quedar si la Edge Function murió antes de completar el rollback.
  const fetchOrphans = async () => {
    const { start, end } = getMonthRange();
    const { data } = await supabase
      .from('transactions')
      .select('id, created_at, amount, payment_method')
      .eq('school_id', schoolId!)
      .in('billing_status', ['sent', 'processing'])  // ambos estados huérfanos
      .eq('payment_status', 'paid')
      .eq('is_taxable', true)
      .eq('document_type', 'ticket')
      .is('invoice_id', null)
      .neq('amount', 0)
      .in('payment_method', TODOS_LOS_METODOS)
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())
      .order('created_at', { ascending: true });
    return data ?? [];
  };

  const handleScanOrphans = async () => {
    if (!schoolId) return;
    setRescuing(true);
    try {
      const orphaned = await fetchOrphans();
      setOrphanRows(orphaned);
      setScanned(true);

      if (orphaned.length === 0) {
        toast({
          title: '✅ Sin transacciones huérfanas',
          description: 'Todas las transacciones de CierreMensual marcadas como "sent" tienen su boleta vinculada.',
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      toast({ variant: 'destructive', title: 'Error al escanear', description: msg });
    } finally {
      setRescuing(false);
    }
  };

  const handleRescue = async () => {
    if (!schoolId || !scanned) return;
    setRescuing(true);
    try {
      const orphaned = await fetchOrphans();

      if (orphaned.length === 0) {
        toast({ title: 'Sin huérfanas para rescatar', description: 'No hay nada que rescatar.' });
        return;
      }

      const rescueIds = filterUUIDs(orphaned.map(r => r.id));
      let rescueError: Error | null = null;
      for (const batch of chunks(rescueIds, 500)) {
        const { error } = await supabase
          .from('transactions')
          .update({ billing_status: 'pending' })
          .in('id', batch);
        if (error) { rescueError = error; break; }
      }
      if (rescueError) throw rescueError;

      const total = round2(orphaned.reduce((s, r) => s + Math.abs(r.amount), 0));
      toast({
        title: '✅ Rescate completado',
        description: `${orphaned.length} transacciones (S/ ${total.toFixed(2)}) vueltas a "pending". Ya aparecen en la tabla.`,
      });

      setOrphanRows([]);
      setScanned(false);
      fetchGroups();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      toast({ variant: 'destructive', title: 'Error en rescate', description: msg });
    } finally {
      setRescuing(false);
    }
  };

  // ── Panel de Excluidas (Nubefact falló al aprobar voucher) ───────────────────
  // Busca transacciones is_taxable=true con billing_status='excluded'.
  // Estas son ventas que SÍ deben facturarse pero Nubefact rechazó la emisión individual.
  // El botón "Reintentar" las vuelve a 'pending' para que aparezcan en la tabla del Cierre.
  const handleScanExcluded = async () => {
    if (!schoolId) return;
    setScanningExcluded(true);
    try {
      const { start, end } = getMonthRange();
      const { data, error } = await supabase
        .from('transactions')
        .select('id, created_at, amount, payment_method')
        .eq('school_id', schoolId)
        .eq('billing_status', 'excluded')
        .eq('is_taxable', true)         // solo las que SÍ deben facturarse
        .eq('payment_status', 'paid')
        .neq('amount', 0)
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString())
        .order('created_at', { ascending: true });
      if (error) throw error;
      setExcludedRows(data ?? []);
      setExcludedScanned(true);
      if ((data ?? []).length === 0) {
        toast({ title: '✅ Sin excluidas pendientes', description: 'No hay transacciones facturables marcadas como "excluded" este mes.' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      toast({ variant: 'destructive', title: 'Error al escanear', description: msg });
    } finally {
      setScanningExcluded(false);
    }
  };

  const handleRetryExcluded = async () => {
    if (!schoolId || !excludedScanned || excludedRows.length === 0) return;
    setRetryingExcluded(true);
    try {
      const ids = filterUUIDs(excludedRows.map(r => r.id));
      let retryError: Error | null = null;
      for (const batch of chunks(ids, 500)) {
        const { error } = await supabase
          .from('transactions')
          .update({ billing_status: 'pending' })
          .in('id', batch)
          .eq('billing_status', 'excluded')  // guard: solo si siguen excluded
          .eq('is_taxable', true);
        if (error) { retryError = error; break; }
      }
      if (retryError) throw retryError;
      toast({
        title: '✅ Listas para boletear',
        description: `${ids.length} transacciones (S/ ${excludedTotal.toFixed(2)}) restablecidas a "pending". Ya aparecen en la tabla de Cierre Mensual.`,
      });
      setExcludedRows([]);
      setExcludedScanned(false);
      fetchGroups();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      toast({ variant: 'destructive', title: 'Error al reintentar', description: msg });
    } finally {
      setRetryingExcluded(false);
    }
  };

  // ── KPIs ─────────────────────────────────────────────────────────────────────
  const pendingGroups  = groups.filter(g => !sentKeys.has(g.key));
  const totalPendiente = round2(pendingGroups.reduce((s, g) => s + g.total, 0));
  const pendienteCount = pendingGroups.length;

  if (loadingSchool) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-7 w-7 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* ── Controles ── */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-gray-800">Cierre Mensual — Boletas Resumen</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Una boleta por día (Yape + Plin + Transferencia + Tarjeta). Efectivo excluido.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-gray-500 shrink-0" />
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="h-9 rounded-md border border-input px-3 text-sm bg-white"
            />
          </div>
          <div className="flex items-center gap-2" title="Fecha que figurará en todas las boletas (la contadora puede retrofechar)">
            <Receipt className="h-4 w-4 text-indigo-500 shrink-0" />
            <input
              type="date"
              value={emissionDateOverride}
              onChange={(e) => {
                setEmissionDateOverride(e.target.value);
                localStorage.setItem('cierre_emission_date', e.target.value);
              }}
              className="h-9 rounded-md border border-indigo-300 px-3 text-sm bg-white text-indigo-700 font-medium"
            />
            <span className="text-xs text-indigo-600 hidden sm:inline">fecha emisión</span>
          </div>
          {isAdmin && schools.length > 0 && (
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-gray-500 shrink-0" />
              <select
                value={schoolId ?? ''}
                onChange={(e) => setSchoolId(e.target.value)}
                className="h-9 rounded-md border border-input px-3 text-sm bg-white"
              >
                {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={fetchGroups} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* ── KPIs ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl p-4 bg-gradient-to-br from-indigo-500 to-blue-600 shadow">
          <div className="flex items-center gap-2 mb-1">
            <Smartphone className="h-5 w-5 text-white" />
            <p className="text-xs font-medium text-white opacity-80">Total Pendiente</p>
          </div>
          <p className="text-2xl font-black text-white">S/ {totalPendiente.toFixed(2)}</p>
        </div>
        <div className={`rounded-xl p-4 bg-gradient-to-br shadow ${
          pendienteCount === 0 ? 'from-green-500 to-emerald-600' : 'from-orange-500 to-amber-600'
        }`}>
          <div className="flex items-center gap-2 mb-1">
            <Receipt className="h-5 w-5 text-white" />
            <p className="text-xs font-medium text-white opacity-80">Días Pendientes</p>
          </div>
          <p className="text-2xl font-black text-white">{pendienteCount} días</p>
        </div>
      </div>

      {/* FIX 5: Banner de Lock activo (proceso en marcha o F5 durante proceso) */}
      {uiLockActive && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="p-3 flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <Clock className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-amber-800">Proceso de facturación en marcha</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Iniciado hace {Math.floor((Date.now() - uiLockActive.startedAt) / 60000)} min.
                  Si recargaste la página y el proceso ya terminó, puedes limpiar este aviso.
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" className="shrink-0 text-amber-700 border-amber-400 bg-amber-100 hover:bg-amber-200 font-semibold"
              onClick={() => { if (schoolId) clearUiLock(schoolId); setUiLockActive(null); }}>
              <XCircle className="h-4 w-4 mr-1" /> Desbloquear
            </Button>
          </CardContent>
        </Card>
      )}

      {/* FIX 1: Banner de zombies detectados */}
      {zombieCount > 0 && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="p-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
              <p className="text-xs text-red-800">
                <strong>{zombieCount} transacciones bloqueadas</strong> en estado "processing" por más de 30 min.
                Un proceso anterior no terminó. Recupéralas para poder boletearlas.
              </p>
            </div>
            <Button size="sm" variant="outline" className="shrink-0 border-red-400 text-red-700 hover:bg-red-100"
              disabled={resettingZombies} onClick={handleResetZombies}>
              {resettingZombies ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              <span className="ml-1.5 text-xs">Recuperar</span>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Info general */}
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="p-3 flex items-start gap-3">
          <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700">
            Cada fila = un día de ventas digitales (Yape, Plin, Transferencia, Tarjeta). Al presionar <strong>Boletear</strong>,
            se verifica que Nubefact devuelva serie y número antes de marcar las transacciones.
            Todas las boletas se emiten con la <strong>fecha de emisión</strong> configurada arriba (por defecto = último día del mes).
            Si hay más de 900 ventas en un día, se emiten múltiples boletas automáticamente.
            Si algo falla, las transacciones <strong>se revierten automáticamente</strong> a "pending".
          </p>
        </CardContent>
      </Card>

      {/* ── Tabla ── */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-7 w-7 animate-spin text-indigo-600" />
        </div>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-3" />
            <p className="text-base font-bold text-gray-700">No hay ventas pendientes de boletear</p>
            <p className="text-sm text-gray-500 mt-1">
              Todas las ventas digitales de este período ya tienen comprobante.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-hidden">
            {/* Botón Boletear Todo */}
            <div className="px-4 pt-4 pb-2 flex items-center justify-between gap-3">
              <div className="text-sm text-gray-500">
                {allProgress
                  ? `⏳ Procesando día ${allProgress.done + 1} de ${allProgress.total}...`
                  : `${groups.filter(g => !sentKeys.has(g.key)).length} días pendientes`}
              </div>
              <Button
                onClick={handleBoletearAll}
                disabled={boletearingAll || groups.filter(g => !sentKeys.has(g.key)).length === 0}
                className="bg-green-600 hover:bg-green-700 text-white gap-2 font-semibold"
              >
                {boletearingAll
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Emitiendo {allProgress?.done}/{allProgress?.total}...</>
                  : <><Receipt className="h-4 w-4" /> Boletear Todo ({groups.filter(g => !sentKeys.has(g.key)).length} días)</>}
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Día</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Tipo</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide"># Ventas</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Total S/</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Estado</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {groups.map((group) => {
                    const isSent = sentKeys.has(group.key);
                    const isBusy = boletearing.has(group.key);
                    return (
                      <tr
                        key={group.key}
                        className={`transition-colors ${isSent ? 'bg-green-50' : 'hover:bg-gray-50'}`}
                      >
                        <td className="px-4 py-3">
                          <span className="font-semibold text-gray-800">{group.dayLabel}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <Smartphone className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                            <span className="text-indigo-700 font-medium text-xs">Pagos Digitales Mixtos</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant="secondary" className="text-xs">{group.count}</Badge>
                          {group.estimatedBoletas > 1 && (
                            <span className="block text-[10px] text-indigo-500 mt-0.5">
                              ~{group.estimatedBoletas} boletas
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-bold text-gray-900">S/ {group.total.toFixed(2)}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {isSent ? (
                            <Badge className="bg-green-100 text-green-700 border-green-300 text-xs">
                              <CheckCircle2 className="h-3 w-3 mr-1" /> Emitida
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-amber-600 border-amber-300 text-xs">
                              Pendiente
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {isSent ? (
                            <span className="text-xs text-gray-400">—</span>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => handleBoletear(group)}
                              disabled={isBusy}
                              className="text-xs gap-1.5 bg-indigo-600 hover:bg-indigo-700"
                            >
                              {isBusy
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Receipt  className="h-3.5 w-3.5" />}
                              {isBusy ? 'Emitiendo...' : 'Boletear'}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {groups.length > 0 && (
                  <tfoot className="border-t-2 border-gray-200 bg-gray-50">
                    <tr>
                      <td colSpan={3} className="px-4 py-3 text-sm font-semibold text-gray-600">
                        Total Pendiente ({pendienteCount} días)
                      </td>
                      <td className="px-4 py-3 text-right font-black text-gray-900">
                        S/ {totalPendiente.toFixed(2)}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Panel de Rescate ── */}
      <div className="border border-amber-300 rounded-xl overflow-hidden">
        {/* Header colapsable */}
        <button
          onClick={() => setShowRescue(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-amber-50 hover:bg-amber-100 transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <span className="text-sm font-semibold text-amber-800">
              Herramientas de Rescate
            </span>
            <span className="text-xs text-amber-600 hidden sm:inline">
              — Transacciones marcadas como "sent" sin boleta real
            </span>
          </div>
          {showRescue
            ? <ChevronUp   className="h-4 w-4 text-amber-600 shrink-0" />
            : <ChevronDown className="h-4 w-4 text-amber-600 shrink-0" />}
        </button>

        {showRescue && (
          <div className="p-4 bg-white space-y-4">
            <p className="text-xs text-gray-600">
              Busca transacciones con <code>billing_status='sent'</code>,{' '}
              <code>document_type='ticket'</code> e <code>invoice_id IS NULL</code>.
              Estas son ventas marcadas como enviadas pero <strong>sin boleta vinculada</strong>.
            </p>

            {/* Botones de acción */}
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={handleScanOrphans}
                disabled={rescuing || !schoolId}
                className="gap-2 border-amber-400 text-amber-700 hover:bg-amber-50"
              >
                {rescuing && !scanned
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <AlertTriangle className="h-4 w-4" />}
                Escanear huérfanas
              </Button>

              {scanned && orphanCount > 0 && (
                <Button
                  size="sm"
                  onClick={handleRescue}
                  disabled={rescuing}
                  className="gap-2 bg-red-600 hover:bg-red-700 text-white"
                >
                  {rescuing
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <ShieldCheck className="h-4 w-4" />}
                  Rescatar {orphanCount} (S/ {orphanTotal.toFixed(2)})
                </Button>
              )}
            </div>

            {/* Tabla de resultados con IDs reales */}
            {scanned && orphanCount === 0 && (
              <div className="flex items-center gap-2 rounded-lg p-3 bg-green-50 border border-green-200">
                <ShieldCheck className="h-5 w-5 text-green-600 shrink-0" />
                <p className="text-sm text-green-700 font-medium">
                  Sin huérfanas — todas las transacciones "sent" tienen su boleta vinculada.
                </p>
              </div>
            )}

            {scanned && orphanCount > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-red-700">
                  {orphanCount} transacciones detectadas (S/ {orphanTotal.toFixed(2)}):
                </p>
                <div className="overflow-x-auto rounded-lg border border-red-200">
                  <table className="w-full text-xs">
                    <thead className="bg-red-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-red-700 font-semibold">UUID (últimos 12)</th>
                        <th className="px-3 py-2 text-left text-red-700 font-semibold">UUID completo</th>
                        <th className="px-3 py-2 text-left text-red-700 font-semibold">Fecha (Lima)</th>
                        <th className="px-3 py-2 text-left text-red-700 font-semibold">Método</th>
                        <th className="px-3 py-2 text-right text-red-700 font-semibold">Monto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-red-100">
                      {orphanRows.map(row => (
                        <tr key={row.id} className="bg-white hover:bg-red-50">
                          <td className="px-3 py-2 font-mono text-gray-500">
                            …{row.id.slice(-12)}
                          </td>
                          <td className="px-3 py-2 font-mono text-gray-400 text-[10px] break-all">
                            {row.id}
                          </td>
                          <td className="px-3 py-2 text-gray-700">
                            {format(toLimaDate(row.created_at), 'dd/MM/yyyy HH:mm', { locale: es })}
                          </td>
                          <td className="px-3 py-2 text-gray-600">{row.payment_method ?? '—'}</td>
                          <td className="px-3 py-2 text-right font-bold text-gray-900">
                            S/ {Math.abs(row.amount).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-gray-400">
                  Copia el UUID completo y búscalo en Supabase o Nubefact para verificar.
                </p>
              </div>
            )}

            <p className="text-xs text-gray-400">
              ⚠️ El rescate solo afecta el mes y sede actualmente seleccionados.
            </p>
          </div>
        )}
      </div>

      {/* ── Panel de Excluidas (Nubefact falló) ── */}
      <div className="border border-orange-300 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowExcluded(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-orange-50 hover:bg-orange-100 transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            <XCircle className="h-4 w-4 text-orange-600 shrink-0" />
            <span className="text-sm font-semibold text-orange-800">
              Rescate de Excluidas por Fallo de Nubefact
            </span>
            <span className="text-xs text-orange-600 hidden sm:inline">
              — Transacciones facturables marcadas como "excluded"
            </span>
          </div>
          {showExcluded
            ? <ChevronUp   className="h-4 w-4 text-orange-600 shrink-0" />
            : <ChevronDown className="h-4 w-4 text-orange-600 shrink-0" />}
        </button>

        {showExcluded && (
          <div className="p-4 bg-white space-y-4">
            <p className="text-xs text-gray-600">
              Busca transacciones con <code>billing_status='excluded'</code> e{' '}
              <code>is_taxable=true</code>. Estas son ventas digitales cuyo comprobante
              individual <strong>no se pudo emitir en Nubefact</strong> al aprobar el voucher del padre
              (red caída, serie inválida, error de API). Al presionar{' '}
              <strong>"Reintentar"</strong>, se restablecen a "pending" y aparecen en la tabla
              del Cierre Mensual para boletearlas como resumen.
            </p>

            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={handleScanExcluded}
                disabled={scanningExcluded || !schoolId}
                className="gap-2 border-orange-400 text-orange-700 hover:bg-orange-50"
              >
                {scanningExcluded
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <AlertTriangle className="h-4 w-4" />}
                Escanear excluidas
              </Button>

              {excludedScanned && excludedCount > 0 && (
                <Button
                  size="sm"
                  onClick={handleRetryExcluded}
                  disabled={retryingExcluded}
                  className="gap-2 bg-orange-600 hover:bg-orange-700 text-white"
                >
                  {retryingExcluded
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <RefreshCw className="h-4 w-4" />}
                  Reintentar {excludedCount} (S/ {excludedTotal.toFixed(2)})
                </Button>
              )}
            </div>

            {excludedScanned && excludedCount === 0 && (
              <div className="flex items-center gap-2 rounded-lg p-3 bg-green-50 border border-green-200">
                <ShieldCheck className="h-5 w-5 text-green-600 shrink-0" />
                <p className="text-sm text-green-700 font-medium">
                  Sin excluidas pendientes — ninguna transacción facturable quedó bloqueada por Nubefact este mes.
                </p>
              </div>
            )}

            {excludedScanned && excludedCount > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-orange-700">
                  {excludedCount} transacciones detectadas (S/ {excludedTotal.toFixed(2)}):
                </p>
                <div className="overflow-x-auto rounded-lg border border-orange-200">
                  <table className="w-full text-xs">
                    <thead className="bg-orange-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-orange-700 font-semibold">UUID (últimos 12)</th>
                        <th className="px-3 py-2 text-left text-orange-700 font-semibold">Fecha (Lima)</th>
                        <th className="px-3 py-2 text-left text-orange-700 font-semibold">Método</th>
                        <th className="px-3 py-2 text-right text-orange-700 font-semibold">Monto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-orange-100">
                      {excludedRows.map(row => (
                        <tr key={row.id} className="bg-white hover:bg-orange-50">
                          <td className="px-3 py-2 font-mono text-gray-500">…{row.id.slice(-12)}</td>
                          <td className="px-3 py-2 text-gray-700">
                            {format(toLimaDate(row.created_at), 'dd/MM/yyyy HH:mm', { locale: es })}
                          </td>
                          <td className="px-3 py-2 text-gray-600">{row.payment_method ?? '—'}</td>
                          <td className="px-3 py-2 text-right font-bold text-gray-900">
                            S/ {Math.abs(row.amount).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded p-2">
                  ⚠️ Nota: al reintentar, estas transacciones pasan a "Resumen de Ventas Diarias" (Consumidor Final).
                  Si el padre había solicitado una boleta/factura individual a su nombre, comunícate con él para confirmar.
                </p>
              </div>
            )}

            <p className="text-xs text-gray-400">
              ⚠️ El rescate solo afecta el mes y sede actualmente seleccionados.
            </p>
          </div>
        )}
      </div>

    </div>
  );
};
