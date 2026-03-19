import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { useToast } from '@/hooks/use-toast';
import { useBillingSync } from '@/stores/billingSync';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  RefreshCw,
  Wallet,
  User,
  School,
  Image as ImageIcon,
  Hash,
  FileText,
  AlertCircle,
  Check,
  X,
  Ticket,
  AlertTriangle,
  Search,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface RechargeRequest {
  id: string;
  student_id: string;
  parent_id: string;
  school_id: string | null;
  amount: number;
  payment_method: string;
  reference_code: string | null;
  voucher_url: string | null;
  notes: string | null;
  status: 'pending' | 'approved' | 'rejected';
  rejection_reason: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  expires_at: string;
  request_type?: 'recharge' | 'lunch_payment' | 'debt_payment';
  description?: string | null;
  lunch_order_ids?: string[] | null;
  paid_transaction_ids?: string[] | null;
  // Joins
  students?: { full_name: string; balance: number };
  profiles?: { full_name: string; email: string };
  schools?: { name: string };
  // Computed
  _ticket_codes?: string[];
  _approver_name?: string; // Nombre de quien aprobó/rechazó
}

const METHOD_LABELS: Record<string, string> = {
  yape: '💜 Yape',
  plin: '💚 Plin',
  transferencia: '🏦 Transferencia',
};

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pendiente', className: 'bg-amber-100 text-amber-800 border-amber-300' },
  approved: { label: 'Aprobado', className: 'bg-green-100 text-green-800 border-green-300' },
  rejected: { label: 'Rechazado', className: 'bg-red-100 text-red-800 border-red-300' },
};

export const VoucherApproval = () => {
  const { user } = useAuth();
  const { role } = useRole();
  const { toast } = useToast();
  const emitSync = useBillingSync((s) => s.emit);

  const [requests, setRequests] = useState<RechargeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState<Record<string, string>>({});
  const [showRejectInput, setShowRejectInput] = useState<Record<string, boolean>>({});
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  // undefined = no cargado aún | null = admin_general (sin filtro) | string = school_id
  const [userSchoolId, setUserSchoolId] = useState<string | null | undefined>(undefined);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  // Códigos de operación ingresados manualmente por el admin cuando el padre no los puso
  const [overrideRefCodes, setOverrideRefCodes] = useState<Record<string, string>>({});

  // ── Filtro de sedes para admin_general ──
  const [allSchools, setAllSchools] = useState<{ id: string; name: string }[]>([]);
  const [selectedSchoolFilter, setSelectedSchoolFilter] = useState<string>('all');

  const canViewAll = role === 'admin_general' || role === 'supervisor_red';

  useEffect(() => {
    fetchUserSchool();
  }, [user, role]);

  // Solo cargar vouchers cuando el school_id ya está resuelto (no undefined)
  useEffect(() => {
    if (userSchoolId !== undefined) fetchRequests();
  }, [filter, userSchoolId, selectedSchoolFilter]);

  // Búsqueda global con debounce: cuando hay término de búsqueda, busca en TODA la BD
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!searchTerm.trim() || searchTerm.trim().length < 2) return;
    searchTimerRef.current = setTimeout(() => {
      fetchGlobalSearch(searchTerm.trim());
    }, 400);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchTerm]);

  const fetchGlobalSearch = async (term: string) => {
    setSearchLoading(true);
    try {
      const schoolFilter = !canViewAll ? userSchoolId : (selectedSchoolFilter !== 'all' ? selectedSchoolFilter : null);

      // 1) Buscar parent_ids cuyo email o nombre coincidan
      const { data: matchingProfiles } = await supabase
        .from('profiles')
        .select('id')
        .or(`full_name.ilike.%${term}%,email.ilike.%${term}%`)
        .limit(50);
      const parentIds = (matchingProfiles || []).map((p: any) => p.id);

      // 2) Buscar student_ids cuyo nombre coincida
      const { data: matchingStudents } = await supabase
        .from('students')
        .select('id')
        .ilike('full_name', `%${term}%`)
        .limit(50);
      const studentIds = (matchingStudents || []).map((s: any) => s.id);

      // 3) Construir filtro OR para recharge_requests
      const orParts: string[] = [`reference_code.ilike.%${term}%`];
      if (parentIds.length > 0) orParts.push(`parent_id.in.(${parentIds.join(',')})`);
      if (studentIds.length > 0) orParts.push(`student_id.in.(${studentIds.join(',')})`);

      let query = supabase
        .from('recharge_requests')
        .select('*, students(full_name, balance), profiles!recharge_requests_parent_id_fkey(full_name, email), schools(name)')
        .or(orParts.join(','))
        .order('created_at', { ascending: false })
        .limit(150);

      if (schoolFilter) query = query.eq('school_id', schoolFilter);
      if (filter !== 'all') query = query.eq('status', filter);

      const { data, error } = await query;
      if (error) throw error;

      setRequests((data || []) as any);
    } catch (e) {
      console.error('Error en búsqueda global:', e);
    }
    setSearchLoading(false);
  };

  const fetchUserSchool = async () => {
    if (!user) return;
    if (canViewAll) {
      // Admin general: cargar lista de sedes para el filtro
      setUserSchoolId(null);
      const { data: schools } = await supabase
        .from('schools')
        .select('id, name')
        .order('name');
      setAllSchools(schools || []);
      return;
    }
    const { data } = await supabase.from('profiles').select('school_id').eq('id', user.id).single();
    if (data?.school_id) {
      setUserSchoolId(data.school_id);
    } else {
      // Si no tiene school_id asignado, marcar como resuelto pero sin filtro
      setUserSchoolId(null);
    }
  };

  const fetchRequests = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('recharge_requests')
        .select(`
          *,
          students(full_name, balance),
          profiles!recharge_requests_parent_id_fkey(full_name, email),
          schools(name)
        `)
        .order('created_at', { ascending: false })
        .limit(200); // Limitar para performance

      if (filter !== 'all') query = query.eq('status', filter);

      // ── Filtro por sede ──
      if (canViewAll) {
        // Admin general: filtrar si seleccionó una sede específica
        if (selectedSchoolFilter && selectedSchoolFilter !== 'all') {
          query = query.eq('school_id', selectedSchoolFilter);
        }
      } else if (userSchoolId) {
        // Admin de sede: SIEMPRE filtrar por su sede
        query = query.eq('school_id', userSchoolId);
      }

      const { data, error } = await query;
      if (error) throw error;

      // ── Enriquecer con ticket_codes de las transacciones asociadas ──
      // ✅ OPTIMIZADO: en vez de 1 query por pedido, se hace 1 sola query con todos los IDs
      const enriched = (data || []) as any[];

      // --- 1. Recoger todos los lunch_order_ids de golpe ---
      const allLunchOrderIds = enriched
        .filter(r => (r.request_type === 'lunch_payment' || r.request_type === 'debt_payment') && r.lunch_order_ids?.length)
        .flatMap((r: any) => r.lunch_order_ids as string[]);

      // Mapa: lunch_order_id → ticket_code
      // ✅ JSONB: Supabase no soporta .in() con metadata->>key,
      //    así que usamos .or() con contains para batches pequeños
      const ticketByOrderId = new Map<string, string>();
      if (allLunchOrderIds.length > 0) {
        try {
          // Dividir en lotes de 30 para evitar queries muy largas
          const uniqueIds = [...new Set(allLunchOrderIds)];
          const batchSize = 30;
          for (let i = 0; i < uniqueIds.length; i += batchSize) {
            const batch = uniqueIds.slice(i, i + batchSize);
            const orFilter = batch.map(id => `metadata.cs.{"lunch_order_id":"${id}"}`).join(',');
            const { data: txRows } = await supabase
              .from('transactions')
              .select('ticket_code, metadata')
              .eq('type', 'purchase')
              .not('ticket_code', 'is', null)
              .or(orFilter);

            for (const tx of txRows || []) {
              const orderId = (tx.metadata as any)?.lunch_order_id;
              if (orderId && tx.ticket_code) ticketByOrderId.set(orderId, tx.ticket_code);
            }
          }
        } catch (e) {
          console.warn('No se pudieron obtener tickets de lunch_orders en batch:', e);
        }
      }

      // Asignar _ticket_codes usando el mapa
      for (const req of enriched) {
        if ((req.request_type === 'lunch_payment' || req.request_type === 'debt_payment') && req.lunch_order_ids?.length) {
          req._ticket_codes = (req.lunch_order_ids as string[])
            .map((id: string) => ticketByOrderId.get(id))
            .filter(Boolean) as string[];
        }
      }

      // --- 2. Recoger todos los paid_transaction_ids de golpe ---
      const allTxIds = enriched
        .filter(r => r.request_type === 'debt_payment' && r.paid_transaction_ids?.length)
        .flatMap((r: any) => r.paid_transaction_ids as string[]);

      // Mapa: tx_id → ticket_code
      const ticketByTxId = new Map<string, string>();
      if (allTxIds.length > 0) {
        try {
          const { data: txRows2 } = await supabase
            .from('transactions')
            .select('id, ticket_code')
            .not('ticket_code', 'is', null)
            .in('id', allTxIds);

          for (const tx of txRows2 || []) {
            if (tx.id && tx.ticket_code) ticketByTxId.set(tx.id, tx.ticket_code);
          }
        } catch (e) {
          console.warn('No se pudieron obtener tickets de paid_transaction_ids en batch:', e);
        }
      }

      // Completar _ticket_codes con paid_transaction_ids
      for (const req of enriched) {
        if (req.request_type === 'debt_payment' && req.paid_transaction_ids?.length) {
          const existing: string[] = req._ticket_codes || [];
          for (const txId of req.paid_transaction_ids as string[]) {
            const code = ticketByTxId.get(txId);
            if (code && !existing.includes(code)) existing.push(code);
          }
          req._ticket_codes = existing;
        }
      }

      // ── 3. Lookup de nombres de aprobadores/rechazadores ──
      const approverIds = [...new Set(
        enriched
          .filter(r => r.approved_by && (r.status === 'approved' || r.status === 'rejected'))
          .map((r: any) => r.approved_by as string)
      )];

      if (approverIds.length > 0) {
        const { data: approverProfiles } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', approverIds);

        const approverMap = new Map<string, string>();
        for (const p of approverProfiles || []) {
          approverMap.set(p.id, p.full_name || p.email || 'Desconocido');
        }

        for (const req of enriched) {
          if (req.approved_by && approverMap.has(req.approved_by)) {
            req._approver_name = approverMap.get(req.approved_by);
          }
        }
      }

      setRequests(enriched);
    } catch (err: any) {
      console.error('Error al cargar solicitudes:', err);
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (req: RechargeRequest, overrideCode?: string) => {
    if (!user) return;

    // ── Verificar que haya número de operación (obligatorio) ──
    const effectiveRefCode = req.reference_code || (overrideCode || '').trim();
    if (!effectiveRefCode) {
      toast({
        variant: 'destructive',
        title: '🚫 Número de operación requerido',
        description: 'No se puede aprobar sin un número de operación. Ingrésalo en el campo que aparece debajo del voucher.',
      });
      return;
    }

    // Si el admin ingresó un código override, guardarlo en la BD antes de aprobar
    if (!req.reference_code && effectiveRefCode) {
      await supabase
        .from('recharge_requests')
        .update({ reference_code: effectiveRefCode })
        .eq('id', req.id);
      // Actualizar el objeto local para que el resto del flujo lo use
      req = { ...req, reference_code: effectiveRefCode };
    }

    setProcessingId(req.id);
    try {
      const isLunchPayment = req.request_type === 'lunch_payment';
      const isDebtPayment = req.request_type === 'debt_payment';

      // ── INFORMAR sobre pedidos cancelados (sin bloquear) ──
      // El admin puede aprobar igual; los pedidos cancelados simplemente no se confirman
      if ((isLunchPayment || isDebtPayment) && req.lunch_order_ids && req.lunch_order_ids.length > 0) {
        const { data: orders } = await supabase
          .from('lunch_orders')
          .select('id, status, is_cancelled')
          .in('id', req.lunch_order_ids);

        const cancelledOrders = orders?.filter(o => o.is_cancelled || o.status === 'cancelled') || [];
        const activeOrders = orders?.filter(o => !o.is_cancelled && o.status !== 'cancelled') || [];

        if (cancelledOrders.length > 0 && activeOrders.length === 0) {
          // TODOS los pedidos están cancelados — avisar pero aprobar igual (el pago sigue siendo válido)
          toast({
            title: '⚠️ Pedidos cancelados — aprobando de todas formas',
            description: `${cancelledOrders.length} pedido(s) ya estaban cancelados. Se aprueba el comprobante y se libera la deuda pendiente.`,
          });
        } else if (cancelledOrders.length > 0) {
          // Algunos cancelados, algunos activos — avisar y continuar
          toast({
            title: '⚠️ Atención',
            description: `${cancelledOrders.length} pedido(s) cancelado(s). Se aprobará el pago de los ${activeOrders.length} pedido(s) activos.`,
          });
        }
      }

      // 1. Actualizar estado — GUARD: solo si aún está pendiente (evita double-approve)
      const { data: approveResult, error: reqErr } = await supabase
        .from('recharge_requests')
        .update({
          status: 'approved',
          approved_by: user.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', req.id)
        .eq('status', 'pending')
        .select('id');

      if (reqErr) throw reqErr;
      if (!approveResult || approveResult.length === 0) {
        toast({
          title: '⚠️ Ya fue procesado',
          description: 'Este comprobante ya fue aprobado o rechazado por otro administrador.',
          variant: 'destructive',
        });
        fetchRequests();
        return;
      }

      if (isLunchPayment || isDebtPayment) {
        // ══════════════════════════════════════════════════════════════
        // ── PAGO DE ALMUERZO / DEUDA ──
        // ══════════════════════════════════════════════════════════════
        const paymentMeta = {
          payment_approved: true,
          payment_source: isDebtPayment ? 'debt_voucher_payment' : 'lunch_voucher_payment',
          recharge_request_id: req.id,
          reference_code: req.reference_code,
          approved_by: user.id,
          approved_at: new Date().toISOString(),
          voucher_url: req.voucher_url,
        };

        // ── VERIFICACIÓN DE PAGO PARCIAL (solo para lunch_payment con lunch_order_ids) ──
        let fullyPaid = true;
        let totalDebt = 0;
        let totalApproved = 0;

        if (isLunchPayment && req.lunch_order_ids && req.lunch_order_ids.length > 0) {
          // 1. Calcular deuda total de órdenes activas
          const { data: ordersForDebt } = await supabase
            .from('lunch_orders')
            .select('id, final_price')
            .in('id', req.lunch_order_ids)
            .eq('is_cancelled', false);

          totalDebt = (ordersForDebt || []).reduce((sum, o) => sum + ((o as any).final_price || 0), 0);

          // 2. Sumar todos los vouchers APROBADOS (lunch_payment + debt_payment) del mismo alumno
          const { data: relatedVouchers } = await supabase
            .from('recharge_requests')
            .select('id, amount, lunch_order_ids')
            .eq('student_id', req.student_id)
            .in('request_type', ['lunch_payment', 'debt_payment'])
            .eq('status', 'approved');

          const orderIdSet = new Set(req.lunch_order_ids);
          const relatedApproved = (relatedVouchers || []).filter((v: any) =>
            (v.lunch_order_ids || []).some((id: string) => orderIdSet.has(id))
          );
          totalApproved = relatedApproved.reduce((sum, v: any) => sum + (v.amount || 0), 0);

          // Asegurar que el voucher actual esté contado (por consistencia read-after-write)
          if (!relatedApproved.some((v: any) => v.id === req.id)) {
            totalApproved += req.amount;
          }

          // 3. ¿El total acumulado cubre la deuda? (tolerancia de S/0.50 por redondeos)
          fullyPaid = totalApproved >= totalDebt - 0.50;
        }

        if (fullyPaid) {
          // ══════════════════════════════════════════════════════════
          // ── PAGO COMPLETO: marcar órdenes y transacciones como pagadas ──
          // ══════════════════════════════════════════════════════════

          // 🔑 PASO 1: Recopilar TODOS los IDs de transacciones a marcar como pagadas
          const txIdsToUpdate = new Set<string>();
          let updatedCount = 0;
          let failedCount = 0;

          // A) Buscar transacciones por lunch_order_ids (sin maybeSingle — soporta duplicados)
          if (req.lunch_order_ids && req.lunch_order_ids.length > 0) {
            for (const orderId of req.lunch_order_ids) {
              const { data: matchingTxs, error: searchErr } = await supabase
                .from('transactions')
                .select('id')
                .eq('type', 'purchase')
                .in('payment_status', ['pending', 'partial'])
                .contains('metadata', { lunch_order_id: orderId });

              if (searchErr) {
                console.error(`❌ Error buscando tx para order ${orderId}:`, searchErr);
              }
              (matchingTxs || []).forEach(tx => txIdsToUpdate.add(tx.id));
            }
          }

          // B) Agregar paid_transaction_ids directamente
          if (req.paid_transaction_ids && req.paid_transaction_ids.length > 0) {
            req.paid_transaction_ids.forEach(id => txIdsToUpdate.add(id));
          }

          // C) Fallback: si no encontramos transacciones por A ni B, buscar por student_id
          if (txIdsToUpdate.size === 0 && req.student_id) {
            console.log(`🔄 [VoucherApproval] Fallback: buscando tx pendientes por student_id ${req.student_id}`);
            const { data: fallbackTxs } = await supabase
              .from('transactions')
              .select('id, amount')
              .eq('student_id', req.student_id)
              .eq('type', 'purchase')
              .in('payment_status', ['pending', 'partial'])
              .order('created_at', { ascending: true });

            if (fallbackTxs && fallbackTxs.length > 0) {
              let remaining = req.amount;
              for (const tx of fallbackTxs) {
                if (remaining <= 0.01) break;
                txIdsToUpdate.add(tx.id);
                remaining -= Math.abs(tx.amount);
              }
              console.log(`🔄 [VoucherApproval] Fallback encontró ${txIdsToUpdate.size} transacciones a cubrir`);
            }
          }

          console.log(`📋 [VoucherApproval] Transacciones a actualizar: ${txIdsToUpdate.size}`, Array.from(txIdsToUpdate));

          // 🔑 PASO 2: Leer metadata actual de todas las transacciones (para merge)
          if (txIdsToUpdate.size > 0) {
            const { data: currentTxs, error: readErr } = await supabase
              .from('transactions')
              .select('id, metadata, payment_status')
              .in('id', Array.from(txIdsToUpdate));

            if (readErr) {
              console.error('❌ Error leyendo transacciones:', readErr);
            }

            // 🔑 PASO 3: Actualizar cada transacción con metadata mergeada
            const successfullyUpdatedIds: string[] = [];
            for (const tx of (currentTxs || [])) {
              if (tx.payment_status === 'paid') {
                console.log(`⏭️ Tx ${tx.id} ya está pagada, saltando`);
                continue;
              }
              const { error: updateErr } = await supabase
                .from('transactions')
                .update({
                  payment_status: 'paid',
                  payment_method: req.payment_method,
                  metadata: { ...(tx.metadata || {}), ...paymentMeta, last_payment_rejected: false },
                })
                .eq('id', tx.id)
                .eq('payment_status', 'pending');

              if (updateErr) {
                console.error(`❌ Error actualizando tx ${tx.id}:`, updateErr);
                failedCount++;
                // ROLLBACK: revertir transacciones ya marcadas como pagadas
                if (successfullyUpdatedIds.length > 0) {
                  console.warn(`⚠️ ROLLBACK: revirtiendo ${successfullyUpdatedIds.length} transacciones`);
                  await supabase
                    .from('transactions')
                    .update({ payment_status: 'pending', payment_method: null })
                    .in('id', successfullyUpdatedIds);
                }
                throw new Error(`Fallo al actualizar transacción ${tx.id}. Se revirtieron ${successfullyUpdatedIds.length} transacciones previas.`);
              } else {
                updatedCount++;
                successfullyUpdatedIds.push(tx.id);
              }
            }
          }

          // 🔑 PASO 4: Confirmar lunch_orders activas
          // Recopilar IDs de órdenes desde req.lunch_order_ids + metadata de transacciones actualizadas
          const orderIdsToConfirm = new Set<string>(req.lunch_order_ids || []);

          // Fallback: extraer lunch_order_id de las transacciones que acabamos de marcar como pagadas
          if (txIdsToUpdate.size > 0) {
            const { data: updatedTxMeta } = await supabase
              .from('transactions')
              .select('metadata')
              .in('id', Array.from(txIdsToUpdate));

            (updatedTxMeta || []).forEach(tx => {
              if (tx.metadata?.lunch_order_id) {
                orderIdsToConfirm.add(tx.metadata.lunch_order_id);
              }
            });
          }

          if (orderIdsToConfirm.size > 0) {
            const { data: activeOrders } = await supabase
              .from('lunch_orders')
              .select('id')
              .in('id', Array.from(orderIdsToConfirm))
              .eq('is_cancelled', false)
              .neq('status', 'cancelled');

            const activeIds = (activeOrders || []).map(o => o.id);
            if (activeIds.length > 0) {
              const { error: orderErr } = await supabase
                .from('lunch_orders')
                .update({ status: 'confirmed' })
                .in('id', activeIds);

              if (orderErr) console.error('❌ Error confirmando orders:', orderErr);
              else console.log(`✅ [VoucherApproval] ${activeIds.length} lunch_orders confirmadas`);
            }
          }

          console.log(`✅ [VoucherApproval] Aprobación completa: ${updatedCount} tx actualizadas, ${failedCount} errores`);

          const label = isDebtPayment ? 'Pago de deuda aprobado' : 'Pago de almuerzo aprobado ✔';
          toast({
            title: `✅ ${label}`,
            description: failedCount > 0
              ? `Se confirmó el pago de S/ ${req.amount.toFixed(2)} pero ${failedCount} transacción(es) no se pudieron actualizar. Contacta soporte.`
              : `Se confirmó el pago total de S/ ${req.amount.toFixed(2)} de ${req.students?.full_name || 'el alumno'}. ${updatedCount} deuda(s) liquidadas.`,
          });

        } else {
          // ── PAGO PARCIAL: voucher aprobado, órdenes siguen pendientes hasta cubrir el total ──
          const falta = Math.max(0, totalDebt - totalApproved);
          toast({
            title: '✅ Comprobante parcial aprobado',
            description: `S/ ${totalApproved.toFixed(2)} de S/ ${totalDebt.toFixed(2)} recibidos de ${req.students?.full_name || 'el alumno'}. Falta S/ ${falta.toFixed(2)} para confirmar el almuerzo.`,
          });
        }
      } else {
        // ── RECARGA DE SALDO ──
        // Obtener school_id del estudiante si no viene en la request
        let schoolId = req.school_id;
        if (!schoolId) {
          const { data: studentData } = await supabase
            .from('students')
            .select('school_id')
            .eq('id', req.student_id)
            .single();
          schoolId = studentData?.school_id || null;
        }

        // 🔒 PASO 1: Sumar saldo PRIMERO (si falla, no queda transacción huérfana)
        const { data: balanceAfterRecharge, error: rpcErr } = await supabase
          .rpc('adjust_student_balance', {
            p_student_id: req.student_id,
            p_amount: req.amount,
          });

        if (rpcErr) throw rpcErr;

        const currentBalance = balanceAfterRecharge ?? 0;

        // 🔒 PASO 2: Insertar transacción DESPUÉS del balance
        const { error: txErr } = await supabase.from('transactions').insert({
          student_id: req.student_id,
          school_id: schoolId,
          type: 'recharge',
          amount: req.amount,
          description: `Recarga aprobada — ${METHOD_LABELS[req.payment_method] || req.payment_method}${req.reference_code ? ` (Ref: ${req.reference_code})` : ''}`,
          payment_status: 'paid',
          payment_method: req.payment_method,
          created_by: user.id,
          metadata: {
            source: 'voucher_recharge',
            recharge_request_id: req.id,
            reference_code: req.reference_code,
            approved_by: user.id,
            voucher_url: req.voucher_url,
          },
        });

        if (txErr) {
          // ROLLBACK: Revertir el saldo porque la transacción no se pudo crear
          await supabase.rpc('adjust_student_balance', {
            p_student_id: req.student_id,
            p_amount: -req.amount,
          });
          throw txErr;
        }

        // Activar modo "Con Recargas"
        await supabase
          .from('students')
          .update({ free_account: false })
          .eq('id', req.student_id);

        // ══════════════════════════════════════════════════════════
        // 💳 AUTO-SALDAR deudas pendientes del kiosco con el nuevo saldo
        // ══════════════════════════════════════════════════════════
        const { data: allPendingTxs } = await supabase
          .from('transactions')
          .select('id, amount, metadata, ticket_code')
          .eq('student_id', req.student_id)
          .eq('type', 'purchase')
          .eq('payment_status', 'pending')
          .order('created_at', { ascending: true });

        const kioskDebts = (allPendingTxs || []).filter(
          (t: any) => !(t.metadata as any)?.lunch_order_id
        );

        let finalBalance = currentBalance;
        let totalSaldado = 0;
        const txsToSettle: string[] = [];

        for (const debt of kioskDebts) {
          const debtAmount = Math.abs(debt.amount);
          if (finalBalance >= debtAmount) {
            txsToSettle.push(debt.id);
            finalBalance -= debtAmount;
            totalSaldado += debtAmount;
          }
        }

        if (txsToSettle.length > 0) {
          // Primero descontar saldo (si falla, las deudas quedan pendientes = seguro)
          const { error: adjErr } = await supabase
            .rpc('adjust_student_balance', {
              p_student_id: req.student_id,
              p_amount: -totalSaldado,
            });
          
          if (adjErr) {
            console.error('❌ Error ajustando balance por auto-saldo:', adjErr);
          } else {
            // Solo si el descuento fue exitoso, marcar deudas como pagadas
            // El .eq('payment_status', 'pending') evita marcar deudas ya saldadas por otra aprobación concurrente
            const { data: settledRows, error: settleErr } = await supabase
              .from('transactions')
              .update({
                payment_status: 'paid',
                payment_method: 'saldo',
              })
              .in('id', txsToSettle)
              .eq('payment_status', 'pending')
              .select('id, amount');

            if (settleErr) {
              console.error('❌ Error auto-saldando deudas:', settleErr);
              // Revertir el descuento completo porque no se pudieron marcar las deudas
              await supabase.rpc('adjust_student_balance', {
                p_student_id: req.student_id,
                p_amount: totalSaldado,
              });
            } else {
              // Verificar cuántas deudas se saldaron REALMENTE (protección contra race condition)
              const realSettledAmount = (settledRows || []).reduce(
                (sum: number, tx: any) => sum + Math.abs(tx.amount), 0
              );
              const overpaid = totalSaldado - realSettledAmount;

              if (overpaid > 0.01) {
                // Otra aprobación concurrente ya saldó algunas deudas → devolver el exceso
                console.warn(`⚠️ Race condition detectada: se descontaron S/ ${totalSaldado} pero solo se saldaron S/ ${realSettledAmount}. Devolviendo S/ ${overpaid.toFixed(2)}`);
                await supabase.rpc('adjust_student_balance', {
                  p_student_id: req.student_id,
                  p_amount: overpaid,
                });
                totalSaldado = realSettledAmount;
              }

              console.log(`✅ Auto-saldado: ${(settledRows || []).length} deuda(s) por S/ ${totalSaldado.toFixed(2)}`);
            }
          }

          finalBalance = currentBalance - totalSaldado;
        }

        // Toast informativo según si se saldaron deudas
        if (totalSaldado > 0) {
          toast({
            title: '✅ Recarga aprobada y deudas saldadas',
            description: `+S/ ${req.amount.toFixed(2)} acreditados a ${req.students?.full_name || 'el alumno'}. Se saldaron automáticamente S/ ${totalSaldado.toFixed(2)} en deudas anteriores. Saldo disponible: S/ ${finalBalance.toFixed(2)}.`,
          });
        } else {
          toast({
            title: '✅ Recarga aprobada',
            description: `Se acreditaron S/ ${req.amount.toFixed(2)} a ${req.students?.full_name || 'el alumno'}. Saldo disponible: S/ ${finalBalance.toFixed(2)}.`,
          });
        }
      }

      fetchRequests();
      emitSync(['debtors', 'transactions', 'balances', 'dashboard']);
    } catch (err: any) {
      console.error('Error al aprobar:', err);
      toast({ title: 'Error al aprobar', description: err.message, variant: 'destructive' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (req: RechargeRequest) => {
    if (!user) return;
    const reason = rejectionReason[req.id]?.trim();
    setProcessingId(req.id);
    try {
      const { data: rejectResult, error } = await supabase
        .from('recharge_requests')
        .update({
          status: 'rejected',
          rejection_reason: reason || 'Comprobante no válido',
          approved_by: user.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', req.id)
        .eq('status', 'pending')
        .select('id');

      if (!rejectResult || rejectResult.length === 0) {
        toast({
          title: 'Ya fue procesado',
          description: 'Este comprobante ya fue aprobado o rechazado por otro administrador.',
        });
        fetchRequests();
        setProcessingId(null);
        return;
      }

      if (error) throw error;

      // 2. Marcar rechazo en metadata de transacciones (lunch y debt)
      const rejectionMeta = {
        last_payment_rejected: true,
        rejection_reason: reason || 'Comprobante no válido',
        rejected_at: new Date().toISOString(),
        rejected_request_id: req.id,
      };

      // A) Lunch orders
      if ((req.request_type === 'lunch_payment' || req.request_type === 'debt_payment') && req.lunch_order_ids?.length) {
        for (const orderId of req.lunch_order_ids) {
          const { data: existingTx } = await supabase
            .from('transactions')
            .select('id, metadata')
            .eq('type', 'purchase')
            .contains('metadata', { lunch_order_id: orderId })
            .maybeSingle();

          if (existingTx) {
            await supabase
              .from('transactions')
              .update({ metadata: { ...(existingTx.metadata || {}), ...rejectionMeta } })
              .eq('id', existingTx.id);
          }
        }
      }

      // B) Transacciones directas (debt_payment)
      if (req.request_type === 'debt_payment' && req.paid_transaction_ids?.length) {
        const handledByLunch = new Set<string>();
        if (req.lunch_order_ids) {
          for (const orderId of req.lunch_order_ids) {
            const { data: ltx } = await supabase
              .from('transactions').select('id').contains('metadata', { lunch_order_id: orderId }).maybeSingle();
            if (ltx) handledByLunch.add(ltx.id);
          }
        }
        const remaining = req.paid_transaction_ids.filter(id => !handledByLunch.has(id));
        for (const txId of remaining) {
          const { data: existingTx } = await supabase
            .from('transactions').select('id, metadata').eq('id', txId).maybeSingle();
          if (existingTx) {
            await supabase
              .from('transactions')
              .update({ metadata: { ...(existingTx.metadata || {}), ...rejectionMeta } })
              .eq('id', txId);
          }
        }
      }

      const isDebtOrLunch = req.request_type === 'lunch_payment' || req.request_type === 'debt_payment';
      toast({
        title: '❌ Solicitud rechazada',
        description: isDebtOrLunch
          ? `Pago rechazado. Las deudas de ${req.students?.full_name || 'el alumno'} siguen pendientes.`
          : `Se notificará al padre/madre de ${req.students?.full_name || 'el alumno'}.`,
        variant: 'destructive',
      });

      setShowRejectInput((prev) => ({ ...prev, [req.id]: false }));
      fetchRequests();
      emitSync(['debtors', 'dashboard']);
    } catch (err: any) {
      toast({ title: 'Error al rechazar', description: err.message, variant: 'destructive' });
    } finally {
      setProcessingId(null);
    }
  };

  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  // Filtrar por búsqueda inteligente
  const filteredRequests = requests.filter((req) => {
    if (!searchTerm.trim()) return true;
    const search = searchTerm.toLowerCase().trim();
    return (
      (req.students?.full_name || '').toLowerCase().includes(search) ||
      (req.profiles?.full_name || '').toLowerCase().includes(search) ||
      (req.profiles?.email || '').toLowerCase().includes(search) ||
      (req.schools?.name || '').toLowerCase().includes(search) ||
      (req.reference_code || '').toLowerCase().includes(search) ||
      (req.description || '').toLowerCase().includes(search) ||
      (req.notes || '').toLowerCase().includes(search) ||
      (req.amount?.toFixed(2) || '').includes(search) ||
      ((req as any)._ticket_codes || []).some((tc: string) => tc.toLowerCase().includes(search))
    );
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Wallet className="h-5 w-5 text-blue-600" />
            Vouchers de Pago
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Revisa los comprobantes enviados por los padres (recargas, almuerzos y deudas).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchRequests} className="gap-2 self-start">
          <RefreshCw className="h-4 w-4" />
          Actualizar
        </Button>
      </div>

      {/* Barra de búsqueda inteligente */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          placeholder="Buscar por alumno, padre, email, sede, monto, N° operación..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10 h-11"
        />
        {searchLoading && (
          <div className="absolute right-8 top-1/2 -translate-y-1/2">
            <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
          </div>
        )}
        {searchTerm && (
          <button
            onClick={() => { setSearchTerm(''); fetchRequests(); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Filtro de sede — solo para admin_general */}
      {canViewAll && allSchools.length > 0 && (
        <div className="flex items-center gap-2">
          <School className="h-4 w-4 text-gray-400" />
          <select
            value={selectedSchoolFilter}
            onChange={(e) => setSelectedSchoolFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          >
            <option value="all">📍 Todas las sedes</option>
            {allSchools.map(s => (
              <option key={s.id} value={s.id}>📍 {s.name}</option>
            ))}
          </select>
          {selectedSchoolFilter !== 'all' && (
            <button
              onClick={() => setSelectedSchoolFilter('all')}
              className="text-xs text-blue-600 hover:underline"
            >
              Limpiar filtro
            </button>
          )}
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        {([
          { key: 'pending', label: 'Pendientes', color: 'amber' },
          { key: 'approved', label: 'Aprobados', color: 'green' },
          { key: 'rejected', label: 'Rechazados', color: 'red' },
          { key: 'all', label: 'Todos', color: 'gray' },
        ] as const).map(({ key, label, color }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-4 py-2 rounded-full text-sm font-medium border transition-all
              ${filter === key
                ? `bg-${color}-100 text-${color}-800 border-${color}-300 shadow-sm`
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
              }`}
          >
            {label}
            {key === 'pending' && pendingCount > 0 && (
              <span className="ml-1.5 bg-amber-500 text-white text-xs rounded-full px-1.5 py-0.5">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
        {searchTerm && (
          <span className="px-3 py-2 text-xs text-gray-500 italic">
            {searchLoading
              ? 'Buscando en toda la base de datos...'
              : `${filteredRequests.length} resultado(s) para "${searchTerm}" — búsqueda global (sin límite de fecha)`}
          </span>
        )}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : filteredRequests.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Wallet className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">
            {searchTerm ? `Sin resultados para "${searchTerm}"` : `Sin solicitudes ${filter !== 'all' ? `"${filter}"` : ''}`}
          </p>
          <p className="text-sm">
            {searchTerm ? 'Intenta con otro término de búsqueda.' : 'Cuando los padres envíen comprobantes aparecerán aquí.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredRequests.map((req) => {
            const statusInfo = STATUS_BADGES[req.status];
            const isProcessing = processingId === req.id;

            return (
              <Card key={req.id} className={`border-l-4 ${
                req.status === 'pending' ? 'border-l-amber-400' :
                req.status === 'approved' ? 'border-l-green-400' : 'border-l-red-400'
              }`}>
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    {/* Info principal */}
                    <div className="flex-1 min-w-0 space-y-2">
                      {/* Cabecera */}
                      <div className="flex items-center flex-wrap gap-2">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${statusInfo.className}`}>
                          {statusInfo.label}
                        </span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                          req.request_type === 'lunch_payment'
                            ? 'bg-orange-100 text-orange-800 border-orange-300'
                            : req.request_type === 'debt_payment'
                            ? 'bg-red-100 text-red-800 border-red-300'
                            : 'bg-blue-100 text-blue-800 border-blue-300'
                        }`}>
                          {req.request_type === 'lunch_payment' ? '🍽️ Almuerzo' : req.request_type === 'debt_payment' ? '📋 Deuda' : '💰 Recarga'}
                        </span>
                        <span className="text-xs text-gray-400">
                          {format(new Date(req.created_at), "d 'de' MMM · HH:mm", { locale: es })}
                        </span>
                        {req.status === 'pending' && req.expires_at && new Date(req.expires_at) < new Date() && (
                          <span className="text-xs text-red-500 font-medium">⚠️ Expirado</span>
                        )}
                      </div>

                      {/* Descripción del pago */}
                      {req.description && (
                        <p className={`text-xs rounded px-2 py-1 mt-1 ${
                          req.description.toLowerCase().includes('combinado')
                            ? 'text-emerald-700 bg-emerald-50 border border-emerald-200 font-semibold'
                            : 'text-gray-600 bg-gray-50'
                        }`}>
                          {req.description.toLowerCase().includes('combinado') ? '👨‍👧‍👦' : '📋'} {req.description}
                        </p>
                      )}

                      {/* Datos principales */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
                        <div className="flex items-start gap-1.5">
                          <User className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-xs text-gray-400">
                              {req.description?.toLowerCase().includes('combinado') ? 'Alumnos (combinado)' : 'Alumno'}
                            </p>
                            <p className="text-sm font-semibold text-gray-800">
                              {req.description?.toLowerCase().includes('combinado') && req.notes?.includes('Pago combinado:')
                                ? req.notes.split('Pago combinado: ').pop()
                                : req.students?.full_name || '—'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-start gap-1.5">
                          <Wallet className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-xs text-gray-400">Monto</p>
                            <p className="text-lg font-bold text-blue-700">S/ {req.amount.toFixed(2)}</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-1.5">
                          <FileText className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-xs text-gray-400">Método</p>
                            <p className="text-sm font-medium">{METHOD_LABELS[req.payment_method] || req.payment_method}</p>
                          </div>
                        </div>
                        {req.schools?.name && (
                          <div className="flex items-start gap-1.5">
                            <School className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="text-xs text-gray-400">Sede</p>
                              <p className="text-sm font-medium text-gray-700">{req.schools.name}</p>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Tickets asociados (para pagos de almuerzo) */}
                      {(req as any)._ticket_codes && (req as any)._ticket_codes.length > 0 && (
                        <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
                          <Ticket className="h-4 w-4 text-indigo-500" />
                          <span className="text-xs text-indigo-600">Ticket(s):</span>
                          <span className="text-sm font-mono font-bold text-indigo-800">
                            {(req as any)._ticket_codes.join(', ')}
                          </span>
                        </div>
                      )}

                      {/* Código de referencia */}
                      {req.reference_code ? (
                        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                          <Hash className="h-4 w-4 text-gray-400" />
                          <span className="text-xs text-gray-500">N° Operación:</span>
                          <span className="text-sm font-mono font-semibold text-gray-800">{req.reference_code}</span>
                        </div>
                      ) : req.status === 'pending' ? (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2 bg-red-50 border border-red-300 rounded-lg px-3 py-2">
                            <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />
                            <span className="text-xs font-semibold text-red-700">⚠️ El padre NO ingresó número de operación</span>
                          </div>
                          <div className="space-y-1">
                            <p className="text-[11px] text-red-600 font-medium">Para aprobar, debes ingresar el N° de operación:</p>
                            <input
                              type="text"
                              placeholder="Ej: 123456789"
                              value={overrideRefCodes[req.id] || ''}
                              onChange={(e) => setOverrideRefCodes(prev => ({ ...prev, [req.id]: e.target.value }))}
                              className="w-full border-2 border-red-300 focus:border-red-500 rounded-lg px-3 py-1.5 text-sm font-mono outline-none bg-white"
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                          <AlertTriangle className="h-4 w-4 text-red-400" />
                          <span className="text-xs text-red-600">Sin número de operación registrado</span>
                        </div>
                      )}

                      {/* Padre */}
                      {req.profiles?.email && (
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                          <User className="h-3 w-3" />
                          <span>Enviado por: {req.profiles.full_name || req.profiles.email}</span>
                        </div>
                      )}

                      {/* Nota */}
                      {req.notes && (
                        <p className="text-xs text-gray-500 italic bg-gray-50 rounded px-2 py-1">
                          💬 {req.notes}
                        </p>
                      )}

                      {/* Razón de rechazo + quién rechazó */}
                      {req.status === 'rejected' && (
                        <div className="bg-red-50 border border-red-200 rounded px-3 py-2 text-xs text-red-700 space-y-1">
                          {req.rejection_reason && (
                            <p><strong>Motivo:</strong> {req.rejection_reason}</p>
                          )}
                          {req._approver_name && (
                            <div className="flex items-center gap-1">
                              <User className="h-3 w-3 shrink-0" />
                              <span>Rechazado por: <strong>{req._approver_name}</strong></span>
                            </div>
                          )}
                          {req.approved_at && (
                            <p className="text-red-400 text-[10px]">
                              {format(new Date(req.approved_at), "d MMM yyyy · HH:mm", { locale: es })}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Columna derecha: imagen + acciones */}
                    <div className="flex sm:flex-col items-start sm:items-end gap-3 sm:shrink-0 sm:w-[140px]">
                      {/* Voucher imagen */}
                      {req.voucher_url ? (
                        <button
                          onClick={() => setSelectedImage(req.voucher_url)}
                          className="border-2 border-dashed border-blue-300 rounded-lg overflow-hidden hover:border-blue-500 transition-colors w-20 h-16 sm:w-24 sm:h-20 shrink-0"
                          title="Ver comprobante"
                        >
                          <img
                            src={req.voucher_url}
                            alt="Voucher"
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ) : (
                        <div className="border-2 border-dashed border-red-300 bg-red-50 rounded-lg w-20 h-16 sm:w-24 sm:h-20 shrink-0 flex flex-col items-center justify-center gap-0.5"
                          title="Este comprobante llegó sin foto — contactar al padre">
                          <AlertTriangle className="h-4 w-4 sm:h-5 sm:w-5 text-red-400" />
                          <span className="text-[9px] sm:text-[10px] text-red-500 font-semibold text-center leading-tight px-1">Sin foto</span>
                        </div>
                      )}

                      {/* Acciones (solo para pending) */}
                      {req.status === 'pending' && (
                        <div className="flex-1 sm:flex-none sm:w-full space-y-2">
                          {showRejectInput[req.id] ? (
                            <div className="space-y-1">
                              <Input
                                placeholder="Motivo del rechazo..."
                                value={rejectionReason[req.id] || ''}
                                onChange={(e) =>
                                  setRejectionReason((prev) => ({ ...prev, [req.id]: e.target.value }))
                                }
                                className="text-xs h-8"
                              />
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="flex-1 h-7 text-xs gap-1"
                                  onClick={() => handleReject(req)}
                                  disabled={isProcessing}
                                >
                                  {isProcessing ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                                  Rechazar
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs px-2"
                                  onClick={() => setShowRejectInput((prev) => ({ ...prev, [req.id]: false }))}
                                >
                                  Cancelar
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1.5">
                              <Button
                                size="sm"
                                className="h-9 bg-green-600 hover:bg-green-700 gap-1.5 font-semibold w-full text-xs sm:text-sm disabled:bg-gray-300 disabled:cursor-not-allowed"
                                onClick={() => handleApprove(req, overrideRefCodes[req.id])}
                                disabled={isProcessing || (!req.reference_code && !(overrideRefCodes[req.id] || '').trim())}
                                title={!req.reference_code && !(overrideRefCodes[req.id] || '').trim() ? 'Debes ingresar el N° de operación antes de aprobar' : ''}
                              >
                                {isProcessing ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Check className="h-4 w-4" />
                                )}
                                {req.request_type === 'debt_payment' ? `Aprobar pago S/ ${req.amount.toFixed(0)}` : `Aprobar +S/ ${req.amount.toFixed(0)}`}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50 gap-1 w-full"
                                onClick={() => setShowRejectInput((prev) => ({ ...prev, [req.id]: true }))}
                                disabled={isProcessing}
                              >
                                <XCircle className="h-3 w-3" />
                                Rechazar
                              </Button>
                            </div>
                          )}
                        </div>
                      )}

                      {req.status === 'approved' && (
                        <div className="space-y-1 text-xs text-green-700">
                          <div className="flex items-center gap-1 font-semibold">
                            <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                            <span>{req.request_type === 'lunch_payment' ? 'Pedido confirmado' : req.request_type === 'debt_payment' ? 'Deuda cancelada' : 'Saldo acreditado'}</span>
                          </div>
                          {req._approver_name && (
                            <div className="flex items-center gap-1 text-green-600 bg-green-50 border border-green-200 rounded px-2 py-1">
                              <User className="h-3 w-3 shrink-0" />
                              <span className="font-medium">Aprobado por: <strong>{req._approver_name}</strong></span>
                            </div>
                          )}
                          {req.approved_at && (
                            <div className="text-green-500 text-[10px] pl-1">
                              {format(new Date(req.approved_at), "d MMM yyyy · HH:mm", { locale: es })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal imagen ampliada */}
      {selectedImage && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedImage(null)}
        >
          <div className="relative max-w-lg w-full">
            <button
              className="absolute -top-10 right-0 text-white hover:text-gray-300"
              onClick={() => setSelectedImage(null)}
            >
              <X className="h-6 w-6" />
            </button>
            <img src={selectedImage} alt="Comprobante" className="w-full rounded-xl shadow-2xl" />
          </div>
        </div>
      )}
    </div>
  );
};
