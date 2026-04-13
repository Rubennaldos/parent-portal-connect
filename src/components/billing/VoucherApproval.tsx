import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { BILLING_EXCLUDED } from '@/lib/billingUtils';
import { logErrorAsync } from '@/lib/logError';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { useToast } from '@/hooks/use-toast';
import { useBillingSync } from '@/stores/billingSync';
import { procesarVoucherConIA } from '@/services/auditService';
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
  ShieldCheck,
  ZoomIn,
  CalendarDays,
  BadgeCheck,
  BadgeX,
  Power,
  PowerOff,
  BrainCircuit,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import jsPDF from 'jspdf';

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
  /** S/ que se descuentan de la billetera interna del alumno (0 = sin billetera) */
  wallet_amount?: number | null;
  // Joins
  students?: { full_name: string; balance: number; wallet_balance?: number };
  profiles?: { full_name: string; email: string };
  schools?: { name: string };
  // Computed
  _ticket_codes?: string[];
  _approver_name?: string; // Nombre de quien aprobó/rechazó
}

interface AuditTransaction {
  id: string;
  created_at: string;
  amount: number;
  payment_method: string;
  ticket_code: string | null;
  payment_status: string;
  operation_number: string | null;
  source: string | null;
  lunch_order_id: string | null;
  student_name: string | null;
  school_name: string | null;
  created_by_name: string | null;
  created_by_email: string | null;
  detail_description: string | null;
}

interface AuditRechargeRequest {
  id: string;
  created_at: string;
  amount: number;
  payment_method: string;
  reference_code: string | null;
  status: string;
  request_type: string | null;
  voucher_url: string | null;
  notes: string | null;
  description: string | null;
  approved_at: string | null;
  student_name: string | null;
  parent_name: string | null;
  parent_email: string | null;
  approved_by_name: string | null;
  school_name: string | null;
  detail_description: string | null;
}

interface AuditResult {
  transactions: AuditTransaction[];
  recharge_requests: AuditRechargeRequest[];
}

const METHOD_LABELS: Record<string, string> = {
  yape: '💜 Yape',
  plin: '💚 Plin',
  transferencia: '🏦 Transferencia',
};

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  pending:  { label: 'Pendiente', className: 'bg-amber-100 text-amber-800 border-amber-300' },
  approved: { label: 'Aprobado',  className: 'bg-green-100 text-green-800 border-green-300' },
  rejected: { label: 'Rechazado', className: 'bg-red-100 text-red-800 border-red-300'   },
  voided:   { label: 'Anulado',   className: 'bg-gray-100 text-gray-500 border-gray-300'  },
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
  // Fase de auditoría IA — mientras está en esta fase, el botón dice "Auditando IA..."
  const [auditandoIAId, setAuditandoIAId] = useState<string | null>(null);
  // IDs retenidos por la IA — el botón verde pasa a gris "Retenido por IA"
  const [retenidoIds, setRetenidoIds] = useState<Set<string>>(new Set());
  const [rejectionReason, setRejectionReason] = useState<Record<string, string>>({});
  const [showRejectInput, setShowRejectInput] = useState<Record<string, boolean>>({});
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  // undefined = no cargado aún | null = admin_general (sin filtro) | string = school_id
  const [userSchoolId, setUserSchoolId] = useState<string | null | undefined>(undefined);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  // Códigos de operación ingresados manualmente por el admin cuando el padre no los puso
  const [overrideRefCodes, setOverrideRefCodes] = useState<Record<string, string>>({});

  // ── Auditoría Anti-Fraude ──
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [auditCode, setAuditCode] = useState('');
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);
  const [auditZoomImage, setAuditZoomImage] = useState<string | null>(null);

  // ── Filtro de sedes para admin_general ──
  const [allSchools, setAllSchools] = useState<{ id: string; name: string }[]>([]);
  const [selectedSchoolFilter, setSelectedSchoolFilter] = useState<string>('all');

  const canViewAll = role === 'admin_general' || role === 'supervisor_red';

  // ── Kill Switch: Motor IA de Auditoría ────────────────────────────────────
  // true = IA apagada (Modo Manual), false = IA activa
  const [voucherAiDisabled, setVoucherAiDisabled] = useState<boolean>(true);
  const [aiToggleLoading, setAiToggleLoading] = useState(false);
  // ── Función de auditoría Anti-Fraude ─────────────────────────────────────
  const runAudit = async () => {
    const normalized = auditCode.trim().toUpperCase();
    if (!normalized) {
      toast({ variant: 'destructive', title: 'Ingresa un código', description: 'El campo no puede estar vacío.' });
      return;
    }
    setAuditLoading(true);
    setAuditResult(null);
    try {
      const { data, error } = await supabase.rpc('check_voucher_usage', { p_operation_number: normalized });
      if (error) throw error;
      setAuditResult(data as AuditResult);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error en auditoría', description: err.message });
    } finally {
      setAuditLoading(false);
    }
  };

  const auditTotalHits = (auditResult?.transactions.length ?? 0) + (auditResult?.recharge_requests.length ?? 0);

  // ── Generación de Constancia PDF ─────────────────────────────────────────
  const downloadAuditPDF = () => {
    if (!auditResult) return;
    const code = auditCode.trim().toUpperCase();
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 18;
    let y = 20;

    const addLine = (text: string, size = 10, bold = false, color: [number, number, number] = [30, 30, 30]) => {
      doc.setFontSize(size);
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setTextColor(...color);
      const lines = doc.splitTextToSize(text, pageW - margin * 2);
      doc.text(lines, margin, y);
      y += (lines.length * size * 0.45) + 2;
    };

    const addDivider = (color: [number, number, number] = [200, 200, 200]) => {
      doc.setDrawColor(...color);
      doc.line(margin, y, pageW - margin, y);
      y += 5;
    };

    // ── Encabezado ──────────────────────────────────────────────────────────
    doc.setFillColor(30, 41, 59);
    doc.rect(0, 0, pageW, 28, 'F');
    doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
    doc.text('CONSTANCIA DE USO DE COMPROBANTE', pageW / 2, 12, { align: 'center' });
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    doc.text('Sistema de Auditoría Anti-Fraude', pageW / 2, 20, { align: 'center' });
    y = 36;

    // ── Código auditado ─────────────────────────────────────────────────────
    doc.setFillColor(239, 246, 255);
    doc.roundedRect(margin, y - 4, pageW - margin * 2, 14, 2, 2, 'F');
    doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 64, 175);
    doc.text('N° de Operación Auditado:', margin + 4, y + 3);
    doc.setFontSize(13); doc.setFont('courier', 'bold');
    doc.text(code, margin + 60, y + 3);
    y += 18;

    // ── Estado ──────────────────────────────────────────────────────────────
    const hasHits = auditTotalHits > 0;
    doc.setFillColor(hasHits ? 254 : 240, hasHits ? 226 : 253, hasHits ? 226 : 244);
    doc.roundedRect(margin, y - 2, pageW - margin * 2, 10, 2, 2, 'F');
    doc.setFontSize(10); doc.setFont('helvetica', 'bold');
    doc.setTextColor(hasHits ? 153 : 22, hasHits ? 27 : 163, hasHits ? 27 : 74);
    doc.text(
      hasHits
        ? `⚠  ALERTA: Este código ya fue utilizado (${auditTotalHits} registro${auditTotalHits !== 1 ? 's' : ''})`
        : '✓  Código NO encontrado — puede usarse con seguridad',
      margin + 4, y + 5
    );
    y += 16;

    // ── Registros de transacciones ───────────────────────────────────────────
    if (auditResult.transactions.length > 0) {
      addLine('VENTAS POS / KIOSCO', 11, true, [30, 64, 175]);
      addDivider([147, 197, 253]);

      auditResult.transactions.forEach((tx, i) => {
        if (y > 250) { doc.addPage(); y = 20; }
        addLine(`Registro ${i + 1}`, 9, true, [30, 64, 175]);
        addLine(`Alumno / Cliente: ${tx.student_name ?? 'Cliente genérico'}`, 9);
        addLine(`Sede: ${tx.school_name ?? '—'}`, 9);
        addLine(`Monto: S/ ${Math.abs(tx.amount).toFixed(2)}   |   Estado: ${tx.payment_status === 'paid' ? 'Pagado' : tx.payment_status}`, 9);
        if (tx.ticket_code) addLine(`Ticket: ${tx.ticket_code}`, 9);
        addLine(`Fecha: ${format(new Date(tx.created_at), "d 'de' MMMM yyyy 'a las' HH:mm", { locale: es })}`, 9);
        addLine(`Cajero: ${tx.created_by_name ?? tx.created_by_email ?? 'Desconocido'}`, 9);
        if (tx.detail_description) {
          addLine(`Detalle: ${tx.detail_description}`, 9, false, [80, 80, 80]);
        }
        y += 3;
      });
      y += 4;
    }

    // ── Registros de vouchers de padres ──────────────────────────────────────
    if (auditResult.recharge_requests.length > 0) {
      if (y > 220) { doc.addPage(); y = 20; }
      addLine('VOUCHERS DE PADRES / RECARGAS', 11, true, [88, 28, 135]);
      addDivider([196, 181, 253]);

      auditResult.recharge_requests.forEach((rr, i) => {
        if (y > 250) { doc.addPage(); y = 20; }
        const tipo = rr.request_type === 'recharge' ? 'Recarga kiosco' : rr.request_type === 'lunch_payment' ? 'Pago almuerzo' : 'Pago deuda';
        addLine(`Registro ${i + 1} — ${tipo}`, 9, true, [88, 28, 135]);
        addLine(`Alumno: ${rr.student_name ?? '—'}   |   Padre: ${rr.parent_name ?? '—'}`, 9);
        addLine(`Sede: ${rr.school_name ?? '—'}`, 9);
        addLine(`Monto: S/ ${rr.amount.toFixed(2)}   |   Estado: ${rr.status === 'approved' ? 'Aprobado' : rr.status === 'rejected' ? 'Rechazado' : 'Pendiente'}`, 9);
        addLine(`Enviado: ${format(new Date(rr.created_at), "d 'de' MMMM yyyy 'a las' HH:mm", { locale: es })}`, 9);
        if (rr.approved_at) {
          addLine(`Aprobado: ${format(new Date(rr.approved_at), "d 'de' MMMM yyyy 'a las' HH:mm", { locale: es })} por ${rr.approved_by_name ?? '—'}`, 9);
        }
        if (rr.detail_description) {
          addLine(`Detalle: ${rr.detail_description}`, 9, false, [80, 80, 80]);
        }
        y += 3;
      });
    }

    // ── Pie de página ────────────────────────────────────────────────────────
    const totalPages = (doc as any).internal.pages.length - 1;
    for (let pg = 1; pg <= totalPages; pg++) {
      doc.setPage(pg);
      const h = doc.internal.pageSize.getHeight();
      doc.setFillColor(248, 250, 252);
      doc.rect(0, h - 16, pageW, 16, 'F');
      doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 116, 139);
      doc.text(
        `Documento generado automáticamente el ${format(new Date(), "d 'de' MMMM yyyy 'a las' HH:mm", { locale: es })}`,
        margin, h - 7
      );
      doc.text(`Pág. ${pg} / ${totalPages}`, pageW - margin, h - 7, { align: 'right' });
    }

    doc.save(`constancia-operacion-${code}-${format(new Date(), 'yyyyMMdd')}.pdf`);
  };

  useEffect(() => {
    fetchUserSchool();
    // Carga inicial sin school_id — se refinará en el segundo effect
    loadAiConfig();
  }, [user, role]);

  // Solo cargar vouchers cuando el school_id ya está resuelto (no undefined).
  // También re-carga la config IA con el school_id correcto para que el filtro
  // por sede sea preciso (evita leer la fila incorrecta en entornos multi-sede).
  useEffect(() => {
    if (userSchoolId !== undefined) {
      fetchRequests();
      loadAiConfig(userSchoolId); // refresca con la sede correcta
    }
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

  // ── Kill Switch: cargar y guardar estado de la IA ──────────────────────────
  // schoolId opcional: si se pasa, filtra por esa sede (más preciso).
  // Si no se pasa (admin_general sin contexto), toma el primer registro activo.
  // DEFAULT → true (desactivada) para evitar activar la IA por error de config.
  const loadAiConfig = async (schoolId?: string | null) => {
    try {
      let query = supabase
        .from('billing_config')
        .select('disable_voucher_ai');

      if (schoolId) {
        // Filtrar por sede específica: el resultado es determinista y correcto
        query = query.eq('school_id', schoolId) as typeof query;
      } else {
        // Sin sede conocida: ordenar por creado/id para ser deterministas
        query = query.order('id', { ascending: true }) as typeof query;
      }

      const { data } = await (query as any).limit(1).maybeSingle();
      const flag = data?.disable_voucher_ai;
      setVoucherAiDisabled(flag !== false); // false explícito = IA activa, cualquier otra cosa = apagada
    } catch {
      setVoucherAiDisabled(true); // Error cargando → seguro por defecto
    }
  };

  const toggleVoucherAi = async () => {
    const nuevoEstado = !voucherAiDisabled;
    setAiToggleLoading(true);
    try {
      const { error } = await supabase
        .from('billing_config')
        .update({ disable_voucher_ai: nuevoEstado })
        .not('id', 'is', null);

      if (error) throw error;
      setVoucherAiDisabled(nuevoEstado);
      toast({
        title: nuevoEstado ? '🔴 IA de Auditoría desactivada' : '🟢 IA de Auditoría reactivada',
        description: nuevoEstado
          ? 'Modo Manual activo. Los montos del padre se usan sin verificación automática.'
          : 'GPT-4o Vision analizará cada voucher antes de aprobar.',
      });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error al cambiar el estado de la IA', description: err.message });
    } finally {
      setAiToggleLoading(false);
    }
  };

  const fetchRequests = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('recharge_requests')
        .select(`
          *,
          students(full_name, balance, wallet_balance),
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
      // ✅ Filtramos por student_id (evita el filtro JSONB .cs.{} que genera 400)
      //    y cruzamos los lunch_order_ids en cliente.
      const ticketByOrderId = new Map<string, string>();
      if (allLunchOrderIds.length > 0) {
        try {
          const uniqueOrderIds = new Set(allLunchOrderIds);
          // Recoger los student_ids de los vouchers que tienen lunch_order_ids
          const studentIdsForLunch = [...new Set(
            enriched
              .filter(r => r.lunch_order_ids?.length)
              .map((r: any) => r.student_id as string)
          )];

          if (studentIdsForLunch.length > 0) {
            const { data: txRows, error: txErr } = await supabase
              .from('transactions')
              .select('ticket_code, metadata')
              .eq('type', 'purchase')
              .not('ticket_code', 'is', null)
              .not('metadata', 'is', null)
              .in('student_id', studentIdsForLunch);

            if (txErr) {
              console.warn('Error al obtener tickets de lunch_orders:', txErr.message);
            } else {
              for (const tx of txRows || []) {
                const orderId = (tx.metadata as any)?.lunch_order_id;
                if (orderId && uniqueOrderIds.has(orderId) && tx.ticket_code) {
                  ticketByOrderId.set(orderId, tx.ticket_code);
                }
              }
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

      // ── Pre-poblar retenidoIds desde auditoria_vouchers ──
      // Si la IA marcó un voucher como RECHAZADO en una sesión anterior, el botón verde
      // no debe reaparecer al refrescar. Consultamos la BD para restaurar el estado.
      const pendingIds = enriched
        .filter(r => r.status === 'pending')
        .map(r => r.id as string);

      if (pendingIds.length > 0) {
        try {
          // Chunk de 120 para evitar URLs demasiado largas con .in()
          const chunkSize = 120;
          const retenidosFromDB = new Set<string>();
          for (let i = 0; i < pendingIds.length; i += chunkSize) {
            const chunk = pendingIds.slice(i, i + chunkSize);
            const { data: auditRows } = await supabase
              .from('auditoria_vouchers')
              .select('id_cobranza, estado_ia')
              .in('id_cobranza', chunk)
              .eq('estado_ia', 'RECHAZADO');
            for (const row of auditRows ?? []) {
              if (row.id_cobranza) retenidosFromDB.add(row.id_cobranza);
            }
          }
          if (retenidosFromDB.size > 0) {
            setRetenidoIds(prev => new Set([...prev, ...retenidosFromDB]));
          }
        } catch {
          // No bloquear la carga si esta consulta falla
        }
      }
    } catch (err: any) {
      console.error('Error al cargar solicitudes:', err);
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // ──────────────────────────────────────────────────────────
  // PUERTA DE ENTRADA: Auditar con IA ANTES de aprobar
  // ──────────────────────────────────────────────────────────
  const handleApproveConIA = async (req: RechargeRequest, overrideCode?: string) => {
    // ── Kill Switch: DOBLE CANDADO — React state + BD fresca por sede ──
    // La IA solo corre si AMBAS fuentes dicen que está activa:
    //   1. El estado React (cargado en mounté/useEffect) dice "activa" (false)
    //   2. La BD fresca para esta sede también dice "activa" (false explícito)
    // Si CUALQUIERA dice "desactivada", se salta la IA.
    // DEFAULT → siempre desactivada ante cualquier error o dato ausente.

    // Candado 1: estado React (rápido, sin red)
    if (voucherAiDisabled) {
      toast({
        title: '📋 Modo Manual — IA desactivada',
        description: `Voucher de S/ ${req.amount.toFixed(2)} procesado con los datos del padre. Sin verificación automática.`,
      });
      return handleApprove(req, overrideCode);
    }

    // Candado 2: BD fresca por sede (fuente de verdad, evita estado cacheado incorrecto)
    let iaActivaEnBD = false; // default: desactivada
    try {
      const schoolIdParaBuscar = req.school_id ?? userSchoolId ?? null;
      let cfgQuery = supabase
        .from('billing_config')
        .select('disable_voucher_ai');
      if (schoolIdParaBuscar) {
        cfgQuery = cfgQuery.eq('school_id', schoolIdParaBuscar) as typeof cfgQuery;
      } else {
        cfgQuery = cfgQuery.order('id', { ascending: true }) as typeof cfgQuery;
      }
      const { data: cfgFresh } = await (cfgQuery as any).limit(1).maybeSingle();
      // IA activa SOLO si disable_voucher_ai es explícitamente FALSE
      iaActivaEnBD = cfgFresh?.disable_voucher_ai === false;
      // Sincronizar el estado visual si la BD discrepa
      if (!iaActivaEnBD && !voucherAiDisabled) {
        setVoucherAiDisabled(true);
      }
    } catch {
      // Error (columna no existe, red, etc.) → tratar como desactivada
      iaActivaEnBD = false;
      setVoucherAiDisabled(true);
    }

    if (!iaActivaEnBD) {
      toast({
        title: '📋 Modo Manual — IA desactivada',
        description: `Voucher de S/ ${req.amount.toFixed(2)} procesado con los datos del padre. Sin verificación automática.`,
      });
      return handleApprove(req, overrideCode);
    }

    // Si el voucher no tiene imagen, saltar la auditoría IA y aprobar directo
    if (!req.voucher_url) {
      toast({
        title: '⚠️ Sin imagen de comprobante',
        description: 'No se puede auditar con IA porque no hay foto. Revisando manualmente...',
      });
      return handleApprove(req, overrideCode);
    }

    setAuditandoIAId(req.id);
    try {
      const { data: estadoFresco } = await supabase
        .from('recharge_requests')
        .select('status')
        .eq('id', req.id)
        .maybeSingle();
      if (estadoFresco?.status === 'cancelled' || estadoFresco?.status === 'approved') {
        toast({
          title: estadoFresco.status === 'cancelled' ? 'Solicitud anulada' : 'Ya estaba aprobada',
          description:
            estadoFresco.status === 'cancelled'
              ? 'Esta cobranza fue anulada. No se enviará a la IA ni aparecerá como nueva en Auditoría.'
              : 'Esta cobranza ya fue aprobada. Actualiza la lista.',
        });
        setAuditandoIAId(null);
        fetchRequests();
        return;
      }

      const resultado = await procesarVoucherConIA(req.voucher_url, {
        idCobranza: req.id,
        schoolId: req.school_id ?? undefined,
        usuarioId: user?.id,
        montoEsperado: req.amount,
        autoAprobarSiValido: false,
      });

      if (resultado.skip_analisis) {
        toast({
          title: 'Análisis no necesario',
          description: resultado.skip_motivo ?? 'La cobranza ya no requiere análisis de IA.',
        });
        setAuditandoIAId(null);
        fetchRequests();
        return;
      }

      // ── CASO 1: RECHAZADO (fraude, duplicado, desvío de fondos) ──
      if (resultado.estado_ia === 'RECHAZADO' || resultado.es_duplicado || resultado.es_desvio_fondos) {
        setAuditandoIAId(null);
        // Marcar como retenido → botón verde pasa a gris
        setRetenidoIds(prev => new Set([...prev, req.id]));
        const motivoCorto = resultado.es_desvio_fondos
          ? `Pago a "${resultado.destinatario_detectado}" — destinatario no autorizado`
          : resultado.es_duplicado
          ? resultado.motivo_duplicado ?? 'Voucher duplicado'
          : (resultado.analisis_ia?.motivo as string) ?? 'Comprobante retenido';
        toast({
          variant: 'destructive',
          title: '🔒 Voucher retenido — revisión requerida',
          description: `${motivoCorto}. Ve al módulo de Auditoría para ver el análisis completo y decidir si aprobar.`,
          duration: 8000,
        });
        fetchRequests();
        return;
      }

      // ── CASO 2: SOSPECHOSO — no aprobar, pedir revisión manual ──
      if (resultado.estado_ia === 'SOSPECHOSO') {
        const motivo = (resultado.analisis_ia?.motivo as string) ?? 'La IA no pudo verificar el comprobante con certeza.';
        const alertas = resultado.analisis_ia?.alertas as string[] | undefined;
        const sinDestinatario = !resultado.destinatario_detectado;

        toast({
          title: '⚠️ Voucher sospechoso — revisión manual requerida',
          description: sinDestinatario
            ? `La IA no pudo leer el nombre del destinatario en la imagen. El registro quedó guardado en Auditoría para revisión manual.`
            : `${motivo}${alertas?.length ? ` • ${alertas[0]}` : ''} — Registro guardado en Auditoría para revisión.`,
        });
        setAuditandoIAId(null);
        fetchRequests(); // Refrescar lista de cobranzas
        return;
      }

      // ── CASO 3: VÁLIDO — verificar monto antes de aprobar ──
      // Aunque la IA diga VÁLIDO, debemos confirmar que el monto del voucher
      // coincide con el monto esperado de la cobranza (tolerancia ±5%).
      if (resultado.monto_detectado !== null && resultado.monto_detectado !== undefined) {
        const montoVoucher = resultado.monto_detectado;
        const montoEsperado = req.amount;
        const tolerancia = montoEsperado * 0.05; // ±5%

        if (montoVoucher > montoEsperado + tolerancia) {
          // ── SOBREPAGO: el voucher es mayor a la deuda ──
          // No se puede auto-aprobar porque la diferencia debería ser saldo a favor.
          // Requiere que el admin decida qué hacer con el excedente.
          setAuditandoIAId(null);
          setRetenidoIds(prev => new Set([...prev, req.id]));
          toast({
            variant: 'destructive',
            title: '💸 Sobrepago detectado — revisión manual requerida',
            description: `El voucher muestra S/ ${montoVoucher.toFixed(2)} pero la deuda es S/ ${montoEsperado.toFixed(2)}. Diferencia de S/ ${(montoVoucher - montoEsperado).toFixed(2)} a favor del padre. Ve a Auditoría para decidir cómo asignar el excedente.`,
            duration: 10000,
          });
          fetchRequests();
          return;
        }

        if (montoVoucher < montoEsperado - tolerancia) {
          // ── ABONO INCOMPLETO: el voucher es menor a la deuda ──
          setAuditandoIAId(null);
          setRetenidoIds(prev => new Set([...prev, req.id]));
          toast({
            variant: 'destructive',
            title: '💰 Abono incompleto — aprobación bloqueada',
            description: `El voucher muestra S/ ${montoVoucher.toFixed(2)} pero la deuda es S/ ${montoEsperado.toFixed(2)}. Faltan S/ ${(montoEsperado - montoVoucher).toFixed(2)}. Ve a Auditoría para revisar.`,
            duration: 10000,
          });
          fetchRequests();
          return;
        }
      }

      const destinatario = resultado.destinatario_detectado
        ? ` · Destinatario: ${resultado.destinatario_detectado}`
        : '';
      const confianza = resultado.analisis_ia?.confianza
        ? ` (${Math.round((resultado.analisis_ia.confianza as number) * 100)}% confianza)`
        : '';

      toast({
        title: `✅ IA verificó el voucher${confianza}`,
        description: `Banco: ${resultado.banco_detectado ?? '?'} · S/ ${resultado.monto_detectado?.toFixed(2) ?? '?'}${destinatario}. Procesando aprobación...`,
      });

    } catch (iaError: any) {
      console.error('⚠️ Error en auditoría IA:', iaError);
      const esError401 = iaError?.message?.includes('401') || iaError?.message?.includes('Unauthorized');
      toast({
        variant: 'destructive',
        title: '🔌 Error de conexión con el servidor IA',
        description: esError401
          ? 'El servidor rechazó la solicitud (401). Recarga la página para renovar tu sesión e intenta de nuevo.'
          : `Error técnico: ${iaError?.message ?? 'desconocido'}. Intenta de nuevo o contacta soporte.`,
      });
      setAuditandoIAId(null);
      return;
    } finally {
      setAuditandoIAId(null);
    }

    // Si llegamos aquí, la IA dijo VÁLIDO → ejecutar aprobación real
    return handleApprove(req, overrideCode);
  };

  const handleApprove = async (req: RechargeRequest, overrideCode?: string) => {
    if (!user) return;

    // ── Guardia 1: Verificar que el monto sea válido (> 0) ──
    // Si el registro tiene amount = null, undefined o <= 0 en la BD,
    // el UPDATE a Supabase fallaría con check constraint 'recharge_requests_amount_check'.
    // Lo detectamos aquí antes de llegar a la BD.
    const parsedAmount = Number(req.amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      toast({
        variant: 'destructive',
        title: '⚠️ Monto inválido — no se puede aprobar',
        description: `Este comprobante tiene monto S/ ${req.amount ?? '0'}, lo cual no es válido. Edita el monto en el panel de Supabase (o contacta soporte) y vuelve a intentarlo.`,
      });
      return;
    }

    // ── Guardia 2: Verificar que haya número de operación (obligatorio) ──
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

      const walletAmt = Number(req.wallet_amount || 0);
      const isSplitPayment = isDebtPayment && walletAmt > 0;

      // ══════════════════════════════════════════════════════════════
      // ── CAMINO B: PAGO TRADICIONAL (RPC atómico sin billetera) ───
      // Reemplaza el bucle multi-paso previo. El RPC hace todo en una
      // sola transacción DB: bloqueo FOR UPDATE, update de transacciones
      // en batch, confirmación de lunch_orders y auditoría.
      // ══════════════════════════════════════════════════════════════
      if ((isLunchPayment || isDebtPayment) && !isSplitPayment) {
        const { data: rpcRaw, error: rpcErr } = await supabase.rpc(
          'process_traditional_voucher_approval',
          { p_request_id: req.id, p_admin_id: user.id }
        );

        if (rpcErr) {
          const msg = rpcErr.message || rpcErr.details || '';
          // Log completo para diagnóstico — no se muestra al usuario
          console.error('[VoucherApproval] Error al aprobar voucher:', {
            request_id: req.id,
            student: req.students?.full_name,
            amount: req.amount,
            error_message: rpcErr.message,
            error_details: rpcErr.details,
            error_hint: rpcErr.hint,
            error_code: rpcErr.code,
          });

          if (msg.includes('ALREADY_PROCESSED') || msg.includes('RACE_CONDITION')) {
            toast({
              title: '⚠️ Ya fue procesado',
              description: 'Este comprobante ya fue aprobado o rechazado por otro administrador.',
              variant: 'destructive',
            });
            fetchRequests();
          } else if (msg.includes('NO_DEBTS_FOUND')) {
            toast({
              variant: 'destructive',
              title: '⚠️ Alumno sin deuda activa',
              description:
                `${req.students?.full_name || 'El alumno'} no tiene transacciones pendientes ` +
                'ni saldo negativo en kiosco. Es posible que la deuda ya fue saldada por otro pago. ' +
                'Recarga la lista de deudores y verifica antes de proceder.',
              duration: 12000,
            });
          } else if (msg.includes('NOT_FOUND')) {
            toast({
              variant: 'destructive',
              title: '⚠️ Solicitud no encontrada',
              description: 'No se encontró la solicitud en la base de datos. Recarga la lista e intenta de nuevo.',
            });
            fetchRequests();
          } else if (
            msg.toLowerCase().includes('coalesce') ||
            msg.toLowerCase().includes('cannot be matched') ||
            msg.toLowerCase().includes('type') ||
            msg.toLowerCase().includes('uuid')
          ) {
            // Error de tipo SQL — indica un bug en el RPC, no en los datos
            toast({
              variant: 'destructive',
              title: '🔧 Error técnico en el servidor',
              description:
                'Hubo un problema interno al procesar la aprobación. ' +
                'El comprobante NO fue aprobado. ' +
                'Contacta a soporte con este ID: ' + req.id.slice(0, 8),
              duration: 15000,
            });
          } else {
            // Error desconocido — mostrar mensaje genérico sin el SQL crudo
            toast({
              variant: 'destructive',
              title: '❌ Error al aprobar',
              description:
                `No se pudo aprobar el comprobante de ${req.students?.full_name || 'el alumno'}. ` +
                `Intenta de nuevo. Si el error persiste, anota el ID ${req.id.slice(0, 8)} y contacta soporte.`,
              duration: 12000,
            });
          }
          return;
        }

        const rpcData = rpcRaw as any;
        const isPartial = Boolean(rpcData?.is_partial);

        if (isPartial) {
          const falta = Math.max(0, Number(rpcData?.shortage ?? 0));
          toast({
            title: '✅ Comprobante parcial aprobado',
            description:
              `S/ ${Number(rpcData?.total_approved ?? 0).toFixed(2)} de ` +
              `S/ ${Number(rpcData?.total_debt ?? 0).toFixed(2)} recibidos de ` +
              `${req.students?.full_name || 'el alumno'}. ` +
              `Falta S/ ${falta.toFixed(2)} para confirmar el almuerzo.`,
          });
          fetchRequests();
          emitSync(['debtors', 'transactions', 'balances', 'dashboard']);
          return;
        }

        // ── Pago completo ──
        const updatedTxIds: string[] = Array.isArray(rpcData?.updated_tx_ids)
          ? rpcData.updated_tx_ids
          : [];
        const approvedAmount  = Number(rpcData?.amount ?? req.amount);
        const fifoUsed        = Boolean(rpcData?.fifo_used);
        const balanceCredit   = Number(rpcData?.balance_credit_applied ?? 0);

        // Descripción del resultado según el camino tomado
        const studentName = req.students?.full_name || 'el alumno';
        let resultDesc = `Se confirmó el pago de S/ ${approvedAmount.toFixed(2)} de ${studentName}. `;
        if (fifoUsed && updatedTxIds.length === 0 && balanceCredit > 0.01) {
          // Camino kiosco puro: ajuste de balance sin transacciones pendientes
          resultDesc += `Saldo kiosco recuperado: S/ ${balanceCredit.toFixed(2)}.`;
        } else if (fifoUsed && balanceCredit > 0.01) {
          // Camino mixto: transacciones + ajuste de balance
          resultDesc += `${updatedTxIds.length} deuda(s) liquidada(s) + saldo kiosco ajustado S/ ${balanceCredit.toFixed(2)}.`;
        } else {
          resultDesc += `${updatedTxIds.length} deuda(s) liquidada(s).`;
        }

        const label = isDebtPayment ? '✅ Pago de deuda aprobado' : '✅ Pago de almuerzo aprobado';
        toast({
          title: label,
          description: resultDesc,
        });

        // ── Emisión automática de Boleta/Factura si el padre lo solicitó ──
        const rInvType   = (rpcData?.invoice_type   ?? (req as any).invoice_type)   as string | null;
        const rInvClient = (rpcData?.invoice_client_data ?? (req as any).invoice_client_data) as Record<string, string> | null;
        const schoolIdForEmit = rpcData?.school_id ?? req.school_id;

        if (rInvType && (rInvType === 'boleta' || rInvType === 'factura') && updatedTxIds.length > 0) {
          try {
            const round2 = (n: number) => Math.round(n * 100) / 100;
            const totalForInvoice = round2(approvedAmount);

            let igvPct = 18;
            try {
              const { data: cfg } = await supabase
                .from('billing_config')
                .select('igv_porcentaje')
                .eq('school_id', schoolIdForEmit || req.school_id)
                .maybeSingle();
              if (cfg?.igv_porcentaje != null) igvPct = Number(cfg.igv_porcentaje);
            } catch { /* usa 18% de fallback */ }

            const totalCents  = Math.round(totalForInvoice * 100);
            const divisorX100 = 100 + igvPct;
            const baseCents   = Math.floor(totalCents * 100 / divisorX100);
            const igvCents    = totalCents - baseCents;
            const base        = baseCents / 100;
            const igv         = igvCents  / 100;

            const { data: emitResult, error: emitErr } = await supabase.functions.invoke('generate-document', {
              body: {
                school_id:      schoolIdForEmit || req.school_id,
                // Pasar la primera transacción actualizada para que invoices.transaction_id
                // quede registrado. Esto permite que get_payment_history y void_payment
                // encuentren la boleta desde cualquier dirección del JOIN.
                transaction_id: updatedTxIds[0] ?? null,
                tipo: rInvType === 'factura' ? 1 : 2,
                cliente: {
                  doc_type:     rInvClient?.doc_type     || '-',
                  doc_number:   rInvClient?.doc_number   || '-',
                  razon_social: rInvClient?.razon_social || req.students?.full_name || 'Consumidor Final',
                  direccion:    rInvClient?.direccion    || '-',
                },
                items: [{
                  unidad_de_medida: 'NIU',
                  codigo:           'PAGO',
                  descripcion:      `Pago ${isDebtPayment ? 'deuda' : 'almuerzo'} - ${req.students?.full_name || 'Alumno'}`,
                  cantidad:         1,
                  valor_unitario:   base,
                  precio_unitario:  totalForInvoice,
                  descuento:        '',
                  subtotal:         base,
                  tipo_de_igv:      1,
                  igv,
                  total:            totalForInvoice,
                  anticipo_regularizacion: false,
                }],
                monto_total:    totalForInvoice,
                payment_method: req.payment_method,
              },
            });

            if (!emitErr && emitResult?.success && emitResult.documento?.id) {
              await supabase
                .from('transactions')
                .update({ billing_status: 'sent', invoice_id: emitResult.documento.id })
                .in('id', updatedTxIds);
              toast({
                title: '✅ Comprobante emitido',
                description: `${rInvType === 'factura' ? 'Factura' : 'Boleta'} generada automáticamente con IGV ${igvPct}%.`,
              });
            } else {
              const nubefactError = emitResult?.error || emitResult?.nubefact?.errors || emitErr?.message || 'Error desconocido';
              await supabase
                .from('transactions')
                .update({ billing_status: 'failed' })
                .in('id', updatedTxIds)
                .eq('billing_status', 'pending');
              toast({
                variant: 'destructive',
                title: '⚠️ Pago aprobado — Error SUNAT',
                description:
                  `El pago se registró correctamente, pero Nubefact no pudo emitir el comprobante. ` +
                  `Las transacciones fueron marcadas como "Error SUNAT" para reintento. ` +
                  `Encuéntralas en Facturación → Cierre Mensual → "Reintentar Fallidas". Error: ${nubefactError}`,
                duration: 12000,
              });
            }
          } catch (invoiceErr: any) {
            logErrorAsync('nubefact', `Emisión automática falló con excepción: ${invoiceErr?.message ?? 'Desconocido'}`, {
              schoolId: req.school_id,
              context: { req_id: req.id, amount: approvedAmount, tx_ids: updatedTxIds, error: invoiceErr?.message },
            });
            await supabase
              .from('transactions')
              .update({ billing_status: 'failed' })
              .in('id', updatedTxIds)
              .eq('billing_status', 'pending');
            toast({
              variant: 'destructive',
              title: '⚠️ Pago aprobado — Error SUNAT (excepción)',
              description:
                `El pago de S/ ${approvedAmount.toFixed(2)} fue aprobado, pero ocurrió un error inesperado al generar el comprobante. ` +
                `Marcado como "Error SUNAT" para reintento en Cierre Mensual. Error: ${invoiceErr?.message || 'Desconocido'}`,
              duration: 12000,
            });
          }
        }

        fetchRequests();
        emitSync(['debtors', 'transactions', 'balances', 'dashboard']);
        return;
      }

      // ══════════════════════════════════════════════════════════════
      // ── GUARD COMPARTIDO: split payment y recarga ─────────────────
      // Solo corre si el camino NO es el tradicional (ya manejado arriba).
      // ══════════════════════════════════════════════════════════════
      const { data: approveResult, error: reqErr } = await supabase
        .from('recharge_requests')
        .update({
          status:      'approved',
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

      // ══════════════════════════════════════════════════════════════
      // ── CAMINO A: PAGO DIVIDIDO CON BILLETERA INTERNA ────────────
      // ══════════════════════════════════════════════════════════════
      if (isSplitPayment) {
        const { data: rpcResult, error: rpcErr } = await supabase.rpc(
          'approve_split_payment_voucher',
          {
            p_request_id:       req.id,
            p_operation_number: req.reference_code || effectiveRefCode || null,
            p_admin_notes:      null,
          }
        );

        if (rpcErr) {
          const msg = rpcErr.message || '';
          // Mensajes de error conocidos del RPC
          if (msg.includes('ALREADY_PROCESSED') || msg.includes('RACE_CONDITION')) {
            toast({
              title: '⚠️ Ya fue procesado',
              description: 'Otro administrador aprobó este voucher en el mismo instante.',
              variant: 'destructive',
            });
            fetchRequests();
          } else if (msg.includes('INSUFFICIENT_WALLET')) {
            toast({
              title: '⚠️ Saldo insuficiente — billetera consumida',
              description:
                'El saldo a favor del alumno ya fue usado en otra aprobación anterior. ' +
                'Esta solicitud quedó sin respaldo de billetera. ' +
                'Coordina con la dueña: o se rechaza esta solicitud o el padre paga el monto completo con nuevo voucher.',
              variant: 'destructive',
              duration: 10000,
            });
            fetchRequests(); // ← refrescar para que el admin vea el estado real
          } else if (msg.includes('CONFLICT')) {
            toast({
              title: '⚠️ Conflicto de datos',
              description: 'Algunas deudas ya fueron cobradas por otro proceso. Recarga la lista.',
              variant: 'destructive',
            });
            fetchRequests();
          } else {
            throw rpcErr;
          }
          return;
        }

        const result = rpcResult as any;
        const fiscalTxId   = result?.fiscal_tx_id   ?? null;
        const walletUsed   = result?.wallet_amount_used ?? 0;
        const fiscalAmount = result?.fiscal_amount   ?? 0;
        const shouldInvoice = result?.should_invoice ?? false;

        toast({
          title: '✅ Pago con billetera aprobado',
          description: result?.message ||
            `S/ ${walletUsed.toFixed(2)} de billetera + S/ ${fiscalAmount.toFixed(2)} de voucher procesados.`,
        });

        // ── Generar boleta por el monto REAL del voucher (si lo hay) ─────────────
        // El generate-document necesita el payload COMPLETO, no solo transaction_id.
        // Reutilizamos la misma lógica de construcción del flujo normal (líneas ~1200-1258).
        if (shouldInvoice && fiscalTxId) {
          try {
            const splitInvType   = (req as any).invoice_type as string | null;
            const splitInvClient = (req as any).invoice_client_data as Record<string, string> | null;

            // Solo emitir si el padre eligió boleta/factura con datos completos
            if (splitInvType && (splitInvType === 'boleta' || splitInvType === 'factura')) {
              // ── IGV dinámico (igual que en el flujo normal) ───────────────────
              let igvPct = 18;
              try {
                const { data: cfg } = await supabase
                  .from('billing_config')
                  .select('igv_porcentaje')
                  .eq('school_id', req.school_id)
                  .maybeSingle();
                if (cfg?.igv_porcentaje != null) igvPct = Number(cfg.igv_porcentaje);
              } catch { /* usa 18% de fallback */ }

              // ── Matemática de centavos sin ruido IEEE 754 ─────────────────────
              const totalCents  = Math.round(fiscalAmount * 100);
              const divisorX100 = 100 + igvPct;
              const baseCents   = Math.floor(totalCents * 100 / divisorX100);
              const igvCents    = totalCents - baseCents;
              const base        = baseCents / 100;
              const igv         = igvCents  / 100;

              const { data: emitResult, error: emitErr } = await supabase.functions.invoke(
                'generate-document',
                {
                  body: {
                    school_id:      req.school_id,
                    transaction_id: fiscalTxId,
                    tipo: splitInvType === 'factura' ? 1 : 2,
                    cliente: {
                      doc_type:     splitInvClient?.doc_type || '-',
                      doc_number:   splitInvClient?.doc_number || '-',
                      razon_social: splitInvClient?.razon_social || req.students?.full_name || 'Consumidor Final',
                      direccion:    splitInvClient?.direccion || '-',
                    },
                    items: [{
                      unidad_de_medida: 'NIU',
                      codigo:           'PAGO',
                      descripcion:      `Pago deuda (billetera+voucher) — ${req.students?.full_name || 'Alumno'}`,
                      cantidad:         1,
                      valor_unitario:   base,
                      precio_unitario:  fiscalAmount,
                      descuento:        '',
                      subtotal:         base,
                      tipo_de_igv:      1,
                      igv,
                      total:            fiscalAmount,
                      anticipo_regularizacion: false,
                    }],
                    monto_total:    fiscalAmount,
                    payment_method: req.payment_method,
                  },
                }
              );

              if (!emitErr && emitResult?.success && emitResult.documento?.id) {
                // Marcar la transacción fiscal como enviada a SUNAT
                await supabase
                  .from('transactions')
                  .update({ billing_status: 'sent', invoice_id: emitResult.documento.id })
                  .eq('id', fiscalTxId);
                toast({
                  title: '✅ Boleta emitida',
                  description: `${splitInvType === 'factura' ? 'Factura' : 'Boleta'} de S/ ${fiscalAmount.toFixed(2)} generada con IGV ${igvPct}%.`,
                });
              } else {
                // Nubefact falló: marcar la transacción fiscal como 'failed' para
                // que el CierreMensual la detecte y el admin pueda reintentarla.
                const nubefactError = emitResult?.error || emitErr?.message || 'Error desconocido';
                console.warn('[split] Nubefact falló:', nubefactError);
                if (fiscalTxId) {
                  await supabase
                    .from('transactions')
                    .update({ billing_status: 'failed' })
                    .eq('id', fiscalTxId)
                    .eq('billing_status', 'pending');
                }
                toast({
                  variant: 'destructive',
                  title: '⚠️ Cobro exitoso — Error SUNAT',
                  description:
                    `El pago de S/ ${fiscalAmount.toFixed(2)} se procesó correctamente ` +
                    `pero la boleta no se pudo emitir. Fue marcada como "Error SUNAT" para reintento manual. ` +
                    `Revisa en Facturación → Cierre Mensual → "Reintentar Fallidas". Error: ${nubefactError}`,
                  duration: 12000,
                });
              }
            } else {
              // Sin tipo de comprobante elegido: el pago quedó registrado sin boleta
              // La transacción fiscal queda en 'pending' para emisión manual posterior
              toast({
                title: '✅ Pago aprobado',
                description:
                  `S/ ${walletUsed.toFixed(2)} de billetera + S/ ${fiscalAmount.toFixed(2)} de voucher ` +
                  `procesados. Sin comprobante SUNAT (el padre no solicitó boleta).`,
              });
            }
          } catch (invEx: any) {
            console.warn('Error al generar boleta split:', invEx.message);
            if (fiscalTxId) {
              await supabase
                .from('transactions')
                .update({ billing_status: 'failed' })
                .eq('id', fiscalTxId)
                .eq('billing_status', 'pending');
            }
            toast({
              variant: 'destructive',
              title: '⚠️ Cobro exitoso — Error SUNAT (excepción)',
              description: `El cobro se procesó pero la emisión de boleta falló con excepción. Marcada como "Error SUNAT". Reintenta desde Cierre Mensual. Detalle: ${invEx.message}`,
              duration: 10000,
            });
          }
        }

        fetchRequests();
        return;
      }

      // ── CAMINO C: RECARGA DE SALDO ──
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
            source_channel: 'parent_web',
            recharge_request_id: req.id,
            reference_code: req.reference_code,
            approved_by: user.id,
            voucher_url: req.voucher_url,
          },
          ...BILLING_EXCLUDED,
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

      fetchRequests();
      emitSync(['debtors', 'transactions', 'balances', 'dashboard']);
    } catch (err: any) {
      logErrorAsync('voucher_approval', `Error al aprobar voucher: ${err?.message ?? 'Desconocido'}`, {
        schoolId: req.school_id,
        context: { req_id: req.id, amount: req.amount, error: err?.message, code: err?.code },
      });
      // Mensaje especial para el error del trigger ANTIFRAUDE NIVEL 5
      const esAntifraude = (err.message ?? '').includes('ANTIFRAUDE') ||
        (err.message ?? '').includes('auditoria_vouchers') ||
        (err.message ?? '').includes('revision de IA');
      if (esAntifraude) {
        toast({
          title: '🔐 Aprobación bloqueada por seguridad',
          description: 'Este comprobante no tiene revisión de IA válida. Ve al módulo de Auditoría → busca el comprobante → haz clic en "Aprobar" desde ahí para poder aprobarlo manualmente.',
          variant: 'destructive',
          duration: 10000,
        });
      } else {
        toast({ title: 'Error al aprobar', description: err.message, variant: 'destructive' });
      }
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (req: RechargeRequest) => {
    if (!user) return;
    const reason = rejectionReason[req.id]?.trim();
    // Guard: el botón ya está deshabilitado sin motivo, pero defensa en profundidad
    if (!reason) {
      toast({ variant: 'destructive', title: 'Motivo requerido', description: 'Debes escribir el motivo del rechazo antes de continuar.' });
      return;
    }
    setProcessingId(req.id);
    try {
      const { data: rejectResult, error } = await supabase
        .from('recharge_requests')
        .update({
          status: 'rejected',
          rejection_reason: reason,
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
        rejection_reason: reason,
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

      // Sincronizar estado en auditoria_vouchers → RECHAZADO
      // Así el módulo de Auditoría queda coherente y no muestra el voucher como pendiente de revisión.
      try {
        const { data: auditRow } = await supabase
          .from('auditoria_vouchers')
          .select('id, analisis_ia')
          .eq('id_cobranza', req.id)
          .order('creado_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (auditRow) {
          await supabase
            .from('auditoria_vouchers')
            .update({
              estado_ia: 'RECHAZADO',
              analisis_ia: {
                ...(auditRow.analisis_ia ?? {}),
                estado: 'RECHAZADO',
                motivo: `[RECHAZADO POR ADMIN] ${reason || 'Comprobante no válido'}`,
                rechazo_manual: true,
                rechazado_por: user.id,
                rechazado_at: new Date().toISOString(),
              },
            })
            .eq('id', auditRow.id);
        }
      } catch {
        // No interrumpir el flujo principal si falla la sincronización con auditoría
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

      {/* Barra de búsqueda inteligente + botón auditoría */}
      <div className="flex gap-2 items-start">
        <div className="relative flex-1">
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
        <Button
          variant="outline"
          className="h-11 gap-2 border-indigo-300 text-indigo-700 hover:bg-indigo-50 whitespace-nowrap shrink-0"
          onClick={() => { setAuditCode(''); setAuditResult(null); setShowAuditModal(true); }}
        >
          <ShieldCheck className="h-4 w-4" />
          Verificar N° Op.
        </Button>
      </div>

      {/* ── Kill Switch: Estado del Motor IA — SOLO visible para admin_general ── */}
      {role === 'admin_general' && (
        <div className={`flex items-center justify-between rounded-xl border px-4 py-3 gap-3 ${
          voucherAiDisabled
            ? 'bg-amber-50 border-amber-300'
            : 'bg-emerald-50 border-emerald-300'
        }`}>
          <div className="flex items-center gap-3 min-w-0">
            <div className={`shrink-0 flex items-center justify-center w-9 h-9 rounded-full ${
              voucherAiDisabled ? 'bg-amber-100' : 'bg-emerald-100'
            }`}>
              {voucherAiDisabled
                ? <PowerOff className="h-4 w-4 text-amber-600" />
                : <BrainCircuit className="h-4 w-4 text-emerald-600" />
              }
            </div>
            <div className="min-w-0">
              <p className={`text-sm font-semibold ${voucherAiDisabled ? 'text-amber-800' : 'text-emerald-800'}`}>
                Motor IA de Auditoría:{' '}
                <span className="font-bold">
                  {voucherAiDisabled ? '🔴 DESACTIVADO — Modo Manual' : '🟢 ACTIVO'}
                </span>
              </p>
              <p className={`text-xs mt-0.5 ${voucherAiDisabled ? 'text-amber-700' : 'text-emerald-700'}`}>
                {voucherAiDisabled
                  ? 'Los montos y N° de operación del padre se usan sin verificación por OpenAI.'
                  : 'GPT-4o Vision analiza cada voucher antes de aprobar. Consume créditos de OpenAI.'}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={aiToggleLoading}
            className={`shrink-0 gap-1.5 font-semibold ${
              voucherAiDisabled
                ? 'border-emerald-400 text-emerald-700 hover:bg-emerald-100'
                : 'border-red-300 text-red-700 hover:bg-red-50'
            }`}
            onClick={toggleVoucherAi}
          >
            {aiToggleLoading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : voucherAiDisabled
                ? <><Power className="h-3.5 w-3.5" /> Reactivar IA</>
                : <><PowerOff className="h-3.5 w-3.5" /> Desactivar IA</>
            }
          </Button>
        </div>
      )}

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
            const statusInfo = STATUS_BADGES[req.status] ?? { label: req.status, className: 'bg-gray-100 text-gray-500 border-gray-300' };
            const isProcessing = processingId === req.id;
            const isAuditandoIA = auditandoIAId === req.id;
            const isRetenido = retenidoIds.has(req.id);
            const isOccupied = isProcessing || isAuditandoIA;

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

                      {/* ── Badge de pago dividido con billetera ── */}
                      {Number(req.wallet_amount || 0) > 0 && (
                        <div className="mt-1 bg-emerald-50 border border-emerald-300 rounded-lg px-3 py-2 space-y-1">
                          <p className="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
                            <Wallet className="h-3.5 w-3.5" />
                            Pago dividido — Billetera interna aplicada
                          </p>
                          <div className="grid grid-cols-3 gap-1 text-xs">
                            <div className="text-center bg-white rounded p-1.5 border border-emerald-100">
                              <p className="text-gray-500">Deuda total</p>
                              <p className="font-bold text-gray-800">
                                S/ {(Number(req.wallet_amount || 0) + Number(req.amount || 0)).toFixed(2)}
                              </p>
                            </div>
                            <div className="text-center bg-emerald-100 rounded p-1.5 border border-emerald-200">
                              <p className="text-emerald-700">De billetera</p>
                              <p className="font-bold text-emerald-800">
                                − S/ {Number(req.wallet_amount).toFixed(2)}
                              </p>
                            </div>
                            <div className="text-center bg-blue-50 rounded p-1.5 border border-blue-200">
                              <p className="text-blue-700">Voucher (fiscal)</p>
                              <p className="font-bold text-blue-800">
                                S/ {Number(req.amount || 0).toFixed(2)}
                              </p>
                            </div>
                          </div>
                          <p className="text-[10px] text-emerald-700">
                            ✅ Al aprobar, el sistema debitará S/ {Number(req.wallet_amount).toFixed(2)} de
                            la billetera del alumno y generará una boleta por S/ {Number(req.amount || 0).toFixed(2)}.
                          </p>
                          <div className="mt-1 bg-amber-50 border border-amber-300 rounded px-2 py-1.5">
                            <p className="text-[10px] font-semibold text-amber-800 flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                              ¿Necesitas anular este pago después?
                            </p>
                            <p className="text-[10px] text-amber-700 mt-0.5">
                              Si después hay que devolverlo, deberás hacer DOS pasos manualmente:
                              (1) Nota de Crédito a SUNAT por S/ {Number(req.amount || 0).toFixed(2)} y
                              (2) recargar S/ {Number(req.wallet_amount).toFixed(2)} en la billetera del alumno.
                              El sistema no puede revertir un pago dividido de forma automática.
                            </p>
                          </div>
                        </div>
                      )}

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

                      {/* ── Badge: Monto declarado por usuario ──────────────────────── */}
                      {voucherAiDisabled && req.status === 'pending' && (
                        <div className="flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">
                          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs font-semibold text-amber-800">
                              Monto declarado por usuario — Validación manual requerida
                            </p>
                            <p className="text-[11px] text-amber-700 mt-0.5">
                              La IA está desactivada. El monto S/ {req.amount.toFixed(2)} y el N° de operación fueron ingresados por el padre sin verificación automática.
                            </p>
                          </div>
                        </div>
                      )}

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
                                  disabled={isOccupied || !(rejectionReason[req.id]?.trim())}
                                  title={!(rejectionReason[req.id]?.trim()) ? 'Debes escribir el motivo del rechazo' : ''}
                                >
                                  {isOccupied ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
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
                          ) : isRetenido ? (
                            /* ── Retenido por IA: botón gris, enlace a Auditoría ── */
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center gap-1.5 bg-gray-100 border border-gray-300 rounded-md px-3 py-2">
                                <ShieldCheck className="h-4 w-4 text-gray-400 shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-gray-500">Voucher retenido — en revisión IA</p>
                                  <a
                                    href="/auditoria"
                                    className="text-[10px] text-indigo-500 hover:underline"
                                  >
                                    Ir a Auditoría para revisar y aprobar →
                                  </a>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1.5">
                              <Button
                                size="sm"
                                className={`h-9 gap-1.5 font-semibold w-full text-xs sm:text-sm disabled:cursor-not-allowed transition-all ${
                                  isAuditandoIA
                                    ? 'bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400'
                                    : isProcessing
                                    ? 'bg-green-600 hover:bg-green-700 disabled:bg-green-400'
                                    : 'bg-green-600 hover:bg-green-700 disabled:bg-gray-300'
                                }`}
                                onClick={() => handleApproveConIA(req, overrideRefCodes[req.id])}
                                disabled={isOccupied || (!req.reference_code && !(overrideRefCodes[req.id] || '').trim())}
                                title={!req.reference_code && !(overrideRefCodes[req.id] || '').trim() ? 'Debes ingresar el N° de operación antes de aprobar' : ''}
                              >
                                <Loader2 className={`h-4 w-4 ${isOccupied ? 'animate-spin' : 'hidden'}`} />
                                <Check className={`h-4 w-4 ${isOccupied ? 'hidden' : ''}`} />
                                {isAuditandoIA
                                  ? 'Auditando IA...'
                                  : isProcessing
                                  ? 'Aprobando...'
                                  : req.request_type === 'debt_payment'
                                  ? `Aprobar pago S/ ${req.amount.toFixed(0)}`
                                  : `Aprobar +S/ ${req.amount.toFixed(0)}`}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50 gap-1 w-full"
                                onClick={() => setShowRejectInput((prev) => ({ ...prev, [req.id]: true }))}
                                disabled={isOccupied}
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

      {/* ── MODAL AUDITORÍA ANTI-FRAUDE ─────────────────────────────── */}
      <Dialog open={showAuditModal} onOpenChange={setShowAuditModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <ShieldCheck className="h-6 w-6 text-indigo-600" />
              Verificar Número de Operación
            </DialogTitle>
            <DialogDescription>
              Busca si un código de operación ya fue utilizado anteriormente en ventas POS o en vouchers de recargas / pagos de almuerzo.
            </DialogDescription>
          </DialogHeader>

          {/* Input + buscar */}
          <div className="flex gap-2 mt-2">
            <div className="flex-1">
              <Label className="text-xs text-gray-500 mb-1 block">Número de Operación</Label>
              <Input
                placeholder="Ej: 02510242 o YAPE-999"
                value={auditCode}
                onChange={(e) => setAuditCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') runAudit(); }}
                className="uppercase h-11"
                autoFocus
              />
            </div>
            <div className="flex items-end gap-2">
              <Button
                onClick={runAudit}
                disabled={auditLoading || !auditCode.trim()}
                className="h-11 bg-indigo-600 hover:bg-indigo-700 gap-2"
              >
                {auditLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Buscar
              </Button>
              {auditResult && auditTotalHits > 0 && (
                <Button
                  onClick={downloadAuditPDF}
                  variant="outline"
                  className="h-11 gap-2 border-gray-300 text-gray-700 hover:bg-gray-50"
                  title="Descargar constancia en PDF"
                >
                  <FileText className="h-4 w-4" />
                  PDF
                </Button>
              )}
            </div>
          </div>

          {/* Resultados */}
          {auditResult && (
            <div className="mt-4 space-y-4">

              {/* Banner resultado */}
              {auditTotalHits === 0 ? (
                <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl p-4">
                  <BadgeCheck className="h-8 w-8 text-green-500 shrink-0" />
                  <div>
                    <p className="font-bold text-green-800">Código no encontrado</p>
                    <p className="text-sm text-green-600">
                      El código <span className="font-mono font-bold">{auditCode.trim().toUpperCase()}</span> no aparece en ningún registro del sistema. Puede ser usado con seguridad.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <BadgeX className="h-8 w-8 text-red-500 shrink-0" />
                    <div>
                      <p className="font-bold text-red-800">⚠️ Código ya utilizado — {auditTotalHits} registro{auditTotalHits !== 1 ? 's' : ''}</p>
                      <p className="text-sm text-red-600">
                        El código <span className="font-mono font-bold">{auditCode.trim().toUpperCase()}</span> ya aparece en el sistema. Verifica los detalles abajo.
                      </p>
                    </div>
                  </div>
                  <Button
                    onClick={downloadAuditPDF}
                    size="sm"
                    variant="outline"
                    className="shrink-0 gap-1.5 border-red-300 text-red-700 hover:bg-red-50"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Descargar Constancia
                  </Button>
                </div>
              )}

              {/* Registros en transactions (ventas POS) */}
              {auditResult.transactions.length > 0 && (
                <div>
                  <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <Hash className="h-4 w-4 text-blue-500" /> Ventas POS ({auditResult.transactions.length})
                  </h3>
                  <div className="space-y-2">
                    {auditResult.transactions.map((tx) => (
                      <div key={tx.id} className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-1 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-blue-900 text-sm">
                                {tx.student_name ?? 'Cliente genérico'}
                              </span>
                              {tx.ticket_code && (
                                <span className="font-mono text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                                  🎫 {tx.ticket_code}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 flex-wrap text-xs text-gray-600">
                              <span className="flex items-center gap-1">
                                <CalendarDays className="h-3 w-3" />
                                {format(new Date(tx.created_at), "d 'de' MMMM yyyy 'a las' HH:mm", { locale: es })}
                              </span>
                              {tx.school_name && (
                                <span className="flex items-center gap-1">
                                  <School className="h-3 w-3" /> {tx.school_name}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500">
                              Cajero: {tx.created_by_name ?? tx.created_by_email ?? 'Desconocido'}
                              {tx.source === 'pos' ? ' · Venta POS' : tx.lunch_order_id ? ' · Pago Almuerzo' : ''}
                            </p>
                            {tx.detail_description && (
                              <p className="text-xs text-blue-800 bg-blue-100 rounded-lg px-2 py-1 mt-1 flex items-start gap-1.5">
                                <FileText className="h-3 w-3 shrink-0 mt-0.5" />
                                {tx.detail_description}
                              </p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-lg font-black text-blue-700">S/ {Math.abs(tx.amount).toFixed(2)}</p>
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tx.payment_status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                              {tx.payment_status === 'paid' ? 'Pagado' : tx.payment_status}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Registros en recharge_requests (vouchers de padres) */}
              {auditResult.recharge_requests.length > 0 && (
                <div>
                  <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <Wallet className="h-4 w-4 text-purple-500" /> Vouchers de Padres ({auditResult.recharge_requests.length})
                  </h3>
                  <div className="space-y-2">
                    {auditResult.recharge_requests.map((rr) => (
                      <div key={rr.id} className="bg-purple-50 border border-purple-200 rounded-xl p-4">
                        <div className="flex items-start gap-3">
                          {/* Miniatura imagen */}
                          {rr.voucher_url ? (
                            <button
                              onClick={() => setAuditZoomImage(rr.voucher_url)}
                              className="shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 border-purple-300 hover:border-purple-500 transition-colors relative group"
                              title="Clic para ampliar"
                            >
                              <img src={rr.voucher_url} alt="Voucher" className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 flex items-center justify-center transition-all">
                                <ZoomIn className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                              </div>
                            </button>
                          ) : (
                            <div className="shrink-0 w-16 h-16 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center">
                              <ImageIcon className="h-6 w-6 text-gray-300" />
                            </div>
                          )}

                          <div className="flex-1 space-y-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="font-bold text-purple-900 text-sm">
                                  {rr.student_name ?? rr.parent_name ?? 'Desconocido'}
                                </p>
                                {rr.parent_name && rr.student_name && (
                                  <p className="text-xs text-gray-500">Padre: {rr.parent_name}</p>
                                )}
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-lg font-black text-purple-700">S/ {rr.amount.toFixed(2)}</p>
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                                  rr.status === 'approved' ? 'bg-green-100 text-green-700' :
                                  rr.status === 'rejected' ? 'bg-red-100 text-red-700' :
                                  'bg-amber-100 text-amber-700'
                                }`}>
                                  {rr.status === 'approved' ? 'Aprobado' : rr.status === 'rejected' ? 'Rechazado' : 'Pendiente'}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 flex-wrap text-xs text-gray-600">
                              <span className="flex items-center gap-1">
                                <CalendarDays className="h-3 w-3" />
                                {format(new Date(rr.created_at), "d 'de' MMMM yyyy 'a las' HH:mm", { locale: es })}
                              </span>
                              {rr.school_name && (
                                <span className="flex items-center gap-1">
                                  <School className="h-3 w-3" /> {rr.school_name}
                                </span>
                              )}
                            </div>

                            {/* Texto descriptivo */}
                            <p className="text-xs text-purple-700 bg-purple-100 rounded-lg px-2 py-1 mt-1">
                              {rr.status === 'approved'
                                ? `✅ Este voucher fue aprobado el ${format(new Date(rr.approved_at!), "d MMM yyyy 'a las' HH:mm", { locale: es })}${rr.approved_by_name ? ` por ${rr.approved_by_name}` : ''} para ${rr.request_type === 'recharge' ? 'recarga de kiosco' : rr.request_type === 'lunch_payment' ? 'pago de almuerzos' : 'pago de deuda'}.`
                                : rr.status === 'rejected'
                                ? `❌ Este voucher fue rechazado.`
                                : `⏳ Este voucher está pendiente de revisión. Fue enviado por ${rr.parent_name ?? 'el padre'} el ${format(new Date(rr.created_at), "d MMM yyyy", { locale: es })}.`
                              }
                            </p>
                            {/* Detalle específico (tickets, fechas de almuerzo, etc.) */}
                            {rr.detail_description && (
                              <p className="text-xs text-gray-700 bg-gray-100 rounded-lg px-2 py-1 mt-1 flex items-start gap-1.5">
                                <FileText className="h-3 w-3 shrink-0 mt-0.5 text-gray-400" />
                                {rr.detail_description}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal imagen ampliada desde auditoría */}
      {auditZoomImage && (
        <div
          className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4"
          onClick={() => setAuditZoomImage(null)}
        >
          <div className="relative max-w-lg w-full">
            <button className="absolute -top-10 right-0 text-white hover:text-gray-300" onClick={() => setAuditZoomImage(null)}>
              <X className="h-6 w-6" />
            </button>
            <img src={auditZoomImage} alt="Voucher ampliado" className="w-full rounded-xl shadow-2xl" />
          </div>
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

      {/* El override de aprobación se hace en el módulo de Auditoría, no aquí */}
    </div>
  );
};
