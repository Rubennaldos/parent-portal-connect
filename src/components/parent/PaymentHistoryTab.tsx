import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Ban,
  Loader2,
  Image as ImageIcon,
  Download,
  Hash,
  CreditCard,
  UtensilsCrossed,
  Wallet,
  RefreshCw,
  FileText,
  Ticket,
  Package,
  ShieldCheck,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import jsPDF from 'jspdf';

interface SaleItem {
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

interface TicketDetail {
  id: string;
  ticket_code: string | null;
  amount: number;
  description: string | null;
  created_at: string;
  items: SaleItem[];  // vacío si no hay detalle de productos
}

interface PaymentRecord {
  id: string;
  student_id: string;
  amount: number;
  payment_method: string;
  reference_code: string | null;
  voucher_url: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'voided';
  rejection_reason: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  request_type: 'recharge' | 'lunch_payment' | 'debt_payment' | null;
  description: string | null;
  paid_transaction_ids?: string[];
  studentName: string;
  approverName: string | null;
  // Comprobantes SUNAT individuales
  sunat_invoices?: { pdf_url: string | null; full_number: string | null; invoice_type: string | null }[];
}

// Cobro directo realizado por admin vía CXC (sin voucher del padre)
interface DirectPaymentGroup {
  groupKey: string;          // operationNumber + date + adminId
  operation_number: string | null;
  payment_method: string;
  paid_at: string;           // fecha del primer ticket del grupo
  admin_id: string | null;
  admin_name: string | null;
  school_name: string | null;
  tickets: {
    id: string;
    ticket_code: string | null;
    amount: number;
    description: string | null;
    student_name: string;
    is_lunch: boolean;
  }[];
  total_amount: number;
}

interface PaymentHistoryTabProps {
  userId: string;
  isActive?: boolean;
}

const REQUEST_TYPE_LABEL: Record<string, string> = {
  recharge: 'Recarga Kiosco',
  lunch_payment: 'Pago de Almuerzo',
  debt_payment: 'Pago de Deuda',
};

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  yape: 'Yape',
  plin: 'Plin',
  transferencia: 'Transferencia bancaria',
  efectivo: 'Efectivo en caja',
};

export const PaymentHistoryTab = ({ userId, isActive }: PaymentHistoryTabProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<PaymentRecord[]>([]);
  const [directPayments, setDirectPayments] = useState<DirectPaymentGroup[]>([]);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [ticketDetailsMap, setTicketDetailsMap] = useState<Map<string, TicketDetail[]>>(new Map());
  const [loadingTickets, setLoadingTickets] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchHistory();
  }, [userId]);

  useEffect(() => {
    if (isActive) fetchHistory();
  }, [isActive]);

  // ── Cobros directos realizados por admin vía módulo CXC ───────────────────
  // Estos cobros no crean recharge_requests — el padre nunca los ve sin esto.
  const fetchDirectPayments = async () => {
    try {
      // 1. Obtener los IDs de los alumnos del padre
      const { data: students } = await supabase
        .from('students')
        .select('id, full_name')
        .eq('parent_id', userId)
        .eq('is_active', true);

      if (!students || students.length === 0) return;

      const studentIds = students.map(s => s.id);
      const studentNameMap = new Map<string, string>(students.map(s => [s.id, s.full_name]));

      // 2. Obtener transacciones pagadas por admin (source: CXC manual)
      //    Criterio: payment_status = paid, payment_method IS NOT NULL, is_deleted = false
      //    Solo mostramos los últimos 90 días para no sobrecargar
      const since = new Date();
      since.setDate(since.getDate() - 90);

      const { data: txData } = await supabase
        .from('transactions')
        .select('id, student_id, ticket_code, amount, description, created_at, payment_method, operation_number, created_by, school_id, metadata')
        .in('student_id', studentIds)
        .eq('payment_status', 'paid')
        .eq('type', 'purchase')
        .eq('is_deleted', false)
        .not('payment_method', 'is', null)
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false })
        .limit(200);

      if (!txData || txData.length === 0) return;

      // 3. Excluir transacciones ya cubiertas por un recharge_request
      //    (esas se muestran en la sección de vouchers del padre)
      const { data: rrData } = await supabase
        .from('recharge_requests')
        .select('paid_transaction_ids')
        .eq('parent_id', userId)
        .not('paid_transaction_ids', 'is', null);

      const coveredByVoucher = new Set<string>();
      if (rrData) {
        rrData.forEach((rr: any) => {
          if (Array.isArray(rr.paid_transaction_ids)) {
            rr.paid_transaction_ids.forEach((id: string) => coveredByVoucher.add(id));
          }
        });
      }

      const directTxs = txData.filter(tx => !coveredByVoucher.has(tx.id));
      if (directTxs.length === 0) return;

      // 4. Obtener nombres de admins en bulk
      const adminIds = [...new Set(directTxs.filter(t => t.created_by).map(t => t.created_by as string))];
      let adminMap: Record<string, string> = {};
      if (adminIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', adminIds);
        if (profiles) profiles.forEach(p => { adminMap[p.id] = p.full_name; });
      }

      // 5. Obtener nombres de sedes
      const schoolIds = [...new Set(directTxs.filter(t => t.school_id).map(t => t.school_id as string))];
      let schoolMap: Record<string, string> = {};
      if (schoolIds.length > 0) {
        const { data: schools } = await supabase
          .from('schools')
          .select('id, name')
          .in('id', schoolIds);
        if (schools) schools.forEach(s => { schoolMap[s.id] = s.name; });
      }

      // 6. Agrupar por (student_id + operation_number + admin + fecha-día) para mostrar como "evento de cobro"
      //    El student_id es OBLIGATORIO para evitar que tickets de distintos alumnos
      //    (o de distintos padres) se fusionen en un mismo grupo contable.
      const groupMap = new Map<string, DirectPaymentGroup>();
      directTxs.forEach(tx => {
        const dayKey = tx.created_at ? tx.created_at.slice(0, 10) : 'unknown';
        const groupKey = `${tx.student_id ?? 'unk'}_${tx.operation_number ?? 'cash'}_${tx.created_by ?? 'unk'}_${dayKey}`;

        if (!groupMap.has(groupKey)) {
          groupMap.set(groupKey, {
            groupKey,
            operation_number: tx.operation_number ?? null,
            payment_method:   tx.payment_method ?? 'efectivo',
            paid_at:          tx.created_at,
            admin_id:         tx.created_by ?? null,
            admin_name:       tx.created_by ? (adminMap[tx.created_by] ?? 'Administrador') : null,
            school_name:      tx.school_id ? (schoolMap[tx.school_id] ?? null) : null,
            tickets:          [],
            total_amount:     0,
          });
        }

        const grp = groupMap.get(groupKey)!;
        const isLunch = !!(tx.metadata?.lunch_order_id);
        grp.tickets.push({
          id:           tx.id,
          ticket_code:  tx.ticket_code ?? null,
          amount:       Math.abs(Number(tx.amount)),
          description:  tx.description ?? null,
          student_name: studentNameMap.get(tx.student_id ?? '') ?? 'Alumno',
          is_lunch:     isLunch,
        });
        grp.total_amount += Math.abs(Number(tx.amount));
      });

      setDirectPayments(Array.from(groupMap.values()));
    } catch (err) {
      console.error('Error fetching direct payments:', err);
    }
  };

  const fetchHistory = async () => {
    setLoading(true);
    try {
      // Cargar cobros directos en paralelo
      fetchDirectPayments();

      const { data, error } = await supabase
        .from('recharge_requests')
        .select(`
          id, student_id, amount, payment_method, reference_code,
          voucher_url, status, rejection_reason, approved_at, approved_by,
          created_at, request_type, description, paid_transaction_ids,
          students(full_name)
        `)
        .eq('parent_id', userId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      const raw = data || [];

      // Fetch approver names in bulk if any were approved/rejected by an admin
      const approvedByIds = [...new Set(
        raw.filter(r => r.approved_by).map(r => r.approved_by as string)
      )];

      let approverMap: Record<string, string> = {};
      if (approvedByIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', approvedByIds);
        if (profiles) {
          profiles.forEach(p => { approverMap[p.id] = p.full_name; });
        }
      }

      const mapped: PaymentRecord[] = raw.map(r => {
        const student = r.students as { full_name: string } | { full_name: string }[] | null;
        const studentName = Array.isArray(student)
          ? (student[0]?.full_name ?? 'Alumno')
          : (student?.full_name ?? 'Alumno');

        return {
          id: r.id,
          student_id: r.student_id,
          amount: r.amount,
          payment_method: r.payment_method,
          reference_code: r.reference_code,
          voucher_url: r.voucher_url,
          status: r.status as 'pending' | 'approved' | 'rejected' | 'voided',
          rejection_reason: r.rejection_reason,
          approved_at: r.approved_at,
          approved_by: r.approved_by,
          created_at: r.created_at,
          request_type: r.request_type as 'recharge' | 'lunch_payment' | 'debt_payment' | null,
          description: r.description,
          paid_transaction_ids: Array.isArray(r.paid_transaction_ids) ? r.paid_transaction_ids : [],
          studentName,
          approverName: r.approved_by ? (approverMap[r.approved_by] ?? 'Administrador') : null,
        };
      });

      // ── Buscar comprobante SUNAT individual para vouchers aprobados ───────────
      // Ruta: recharge_requests.paid_transaction_ids → transactions.invoice_id → invoices.pdf_url
      const approvedWithTxIds = raw.filter(
        r => r.status === 'approved' && Array.isArray(r.paid_transaction_ids) && r.paid_transaction_ids.length > 0
      );

      if (approvedWithTxIds.length > 0) {
        const allTxIds = [...new Set(approvedWithTxIds.flatMap((r: any) => r.paid_transaction_ids as string[]))];

        const { data: txWithInvoice } = await supabase
          .from('transactions')
          .select('id, invoice_id')
          .in('id', allTxIds)
          .not('invoice_id', 'is', null);

        if (txWithInvoice && txWithInvoice.length > 0) {
          const invoiceIds = [...new Set(txWithInvoice.map((t: any) => t.invoice_id as string))];

          // Cargar TODOS los comprobantes cuyo ID proviene de las transacciones del padre.
          // Ya están filtrados por invoice_id desde las transacciones propias del padre,
          // por lo que incluimos boletas "Consumidor Final" (padre pagó sin DNI → su boleta igual).
          const { data: invoicesData } = await supabase
            .from('invoices')
            .select('id, pdf_url, full_number, invoice_type, client_name, client_document_number')
            .in('id', invoiceIds);

          if (invoicesData) {
            // Mapas para lookup rápido
            const txToInvoiceId = new Map<string, string>(
              txWithInvoice.map((t: any) => [t.id, t.invoice_id])
            );
            const invoiceMap = new Map(invoicesData.map((inv: any) => [inv.id, inv]));

            // Enriquecer cada registro con TODOS los comprobantes únicos
            // (un voucher puede cubrir varias deudas → varias facturas distintas)
            mapped.forEach(rec => {
              const rawRec = raw.find(r => r.id === rec.id) as any;
              if (!rawRec?.paid_transaction_ids) return;

              // Recolectar todos los invoice_ids únicos para este voucher
              const seenInvoiceIds = new Set<string>();
              const invoices: { pdf_url: string | null; full_number: string | null; invoice_type: string | null }[] = [];

              (rawRec.paid_transaction_ids as string[])
                .filter(id => txToInvoiceId.has(id))
                .forEach(txId => {
                  const invoiceId = txToInvoiceId.get(txId)!;
                  if (seenInvoiceIds.has(invoiceId)) return; // deduplicar
                  seenInvoiceIds.add(invoiceId);
                  const inv = invoiceMap.get(invoiceId);
                  if (inv) {
                    invoices.push({
                      pdf_url:      inv.pdf_url ?? null,
                      full_number:  inv.full_number ?? null,
                      invoice_type: inv.invoice_type ?? null,
                    });
                  }
                });

              if (invoices.length > 0) rec.sunat_invoices = invoices;
            });
          }
        }
      }

      setRecords(mapped);
    } catch (err) {
      console.error('Error fetching payment history:', err);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo cargar el historial de pagos.',
      });
    } finally {
      setLoading(false);
    }
  };

  // ── Carga lazy de tickets al expandir ──────────────────────────────────────
  const loadTicketDetails = async (record: PaymentRecord) => {
    const txIds = record.paid_transaction_ids ?? [];
    if (txIds.length === 0) return;
    if (ticketDetailsMap.has(record.id)) return; // ya cargado

    setLoadingTickets(prev => new Set(prev).add(record.id));
    try {
      // 1. Datos básicos de cada transacción
      const { data: txData } = await supabase
        .from('transactions')
        .select('id, ticket_code, amount, description, created_at, metadata')
        .in('id', txIds)
        .order('created_at', { ascending: true });

      if (!txData || txData.length === 0) {
        setTicketDetailsMap(prev => new Map(prev).set(record.id, []));
        return;
      }

      // 2. Intentar obtener ítems de productos desde la tabla sales
      //    (transaction_id en sales es TEXT, txIds son UUIDs-como-string → compatibles)
      const { data: salesData } = await supabase
        .from('sales')
        .select('transaction_id, items')
        .in('transaction_id', txIds);

      const salesMap = new Map<string, SaleItem[]>();
      if (salesData) {
        salesData.forEach((s: any) => {
          const items: SaleItem[] = Array.isArray(s.items)
            ? s.items.map((it: any) => ({
                product_id:   it.product_id ?? null,
                product_name: it.product_name ?? 'Producto',
                quantity:     Number(it.quantity ?? 1),
                unit_price:   Number(it.unit_price ?? 0),
                subtotal:     Number(it.subtotal ?? 0),
              }))
            : [];
          salesMap.set(s.transaction_id, items);
        });
      }

      const details: TicketDetail[] = txData.map((tx: any) => ({
        id:          tx.id,
        ticket_code: tx.ticket_code ?? null,
        amount:      Math.abs(Number(tx.amount)),
        description: tx.description ?? null,
        created_at:  tx.created_at,
        items:       salesMap.get(tx.id) ?? [],
      }));

      setTicketDetailsMap(prev => new Map(prev).set(record.id, details));
    } catch (err) {
      console.error('Error cargando detalles de tickets:', err);
    } finally {
      setLoadingTickets(prev => {
        const next = new Set(prev);
        next.delete(record.id);
        return next;
      });
    }
  };

  // ── Generación de PDF profesional ──────────────────────────────────────────
  const downloadPDF = async (record: PaymentRecord) => {
    setDownloadingId(record.id);
    try {
      const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 18;
      let y = 0;

      // ── Encabezado ────────────────────────────────────────────────────────
      doc.setFillColor(30, 41, 59);
      doc.rect(0, 0, pageW, 33, 'F');
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text('Lima Café 28 — Kiosco Escolar', pageW / 2, 12, { align: 'center' });
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text('RECIBO DE COMPROBANTE DE PAGO', pageW / 2, 21, { align: 'center' });
      doc.setFontSize(8);
      doc.setTextColor(203, 213, 225);
      doc.text(
        `Generado el ${format(new Date(), "d 'de' MMMM yyyy 'a las' HH:mm", { locale: es })}`,
        pageW / 2, 28, { align: 'center' }
      );
      y = 42;

      // ── Sello de estado ────────────────────────────────────────────────────
      const statusColor: Record<string, [number, number, number]> = {
        approved: [22, 163, 74],
        pending:  [37, 99, 235],
        rejected: [220, 38, 38],
      };
      const statusLabel: Record<string, string> = {
        approved: '✓  PAGO APROBADO',
        pending:  '⏳  EN REVISIÓN',
        rejected: '✕  PAGO RECHAZADO',
      };
      const sc = statusColor[record.status] ?? [100, 100, 100];
      doc.setFillColor(...sc);
      doc.roundedRect(margin, y, pageW - margin * 2, 13, 2, 2, 'F');
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text(statusLabel[record.status] ?? record.status.toUpperCase(), pageW / 2, y + 9, { align: 'center' });
      y += 20;

      // ── Datos del pago ─────────────────────────────────────────────────────
      const addRow = (label: string, value: string, highlight = false) => {
        if (y > pageH - 40) { doc.addPage(); y = 20; }
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(100, 116, 139);
        doc.text(label, margin + 2, y);
        doc.setFont('helvetica', highlight ? 'bold' : 'normal');
        doc.setTextColor(highlight ? 22 : 20, highlight ? 163 : 20, highlight ? 74 : 20);
        const lines = doc.splitTextToSize(value, pageW - margin - 74);
        doc.text(lines, 74, y);
        y += Math.max(6, lines.length * 5);
      };

      doc.setFillColor(248, 250, 252);
      const boxH = record.status === 'approved' ? 82 : record.status === 'rejected' ? 82 : 70;
      doc.roundedRect(margin, y - 2, pageW - margin * 2, boxH, 2, 2, 'F');
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(margin, y - 2, pageW - margin * 2, boxH, 2, 2, 'S');
      y += 3;

      addRow('Alumno:', record.studentName);
      addRow('Tipo de pago:', REQUEST_TYPE_LABEL[record.request_type ?? ''] ?? 'Pago');
      if (record.description) addRow('Concepto:', record.description);
      addRow('Monto pagado:', `S/ ${record.amount.toFixed(2)}`, true);
      addRow('Método de pago:', PAYMENT_METHOD_LABEL[record.payment_method] ?? record.payment_method);
      addRow('Cód. referencia:', record.reference_code ?? 'No especificado');
      addRow('Enviado el:', format(new Date(record.created_at), "d 'de' MMMM yyyy 'a las' HH:mm", { locale: es }));

      if (record.status === 'approved' && record.approved_at) {
        addRow('Aprobado el:', format(new Date(record.approved_at), "d 'de' MMMM yyyy 'a las' HH:mm", { locale: es }));
        if (record.approverName) addRow('Aprobado por:', record.approverName);
      }
      if (record.status === 'rejected' && record.rejection_reason) {
        addRow('Motivo rechazo:', record.rejection_reason);
      }
      y += 8;

      // ── Imagen del comprobante ─────────────────────────────────────────────
      if (record.voucher_url) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 30, 30);
        doc.text('Foto del comprobante adjunta:', margin, y);
        y += 6;

        try {
          const response = await fetch(record.voucher_url);
          const blob = await response.blob();
          const imgDataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });

          const fmt = blob.type.includes('png') ? 'PNG' : 'JPEG';
          const maxW = pageW - margin * 2;
          const maxH = 110;

          if (y + maxH > pageH - 25) { doc.addPage(); y = 20; }

          doc.addImage(imgDataUrl, fmt, margin, y, maxW, maxH, undefined, 'MEDIUM');
          y += maxH + 6;
        } catch {
          doc.setFontSize(9);
          doc.setFont('helvetica', 'italic');
          doc.setTextColor(150, 150, 150);
          doc.text('(No se pudo cargar la imagen del comprobante)', margin, y);
          y += 8;
        }
      }

      // ── Pie de página ──────────────────────────────────────────────────────
      const totalPages = (doc as any).internal.pages.length - 1;
      for (let pg = 1; pg <= totalPages; pg++) {
        doc.setPage(pg);
        const h = doc.internal.pageSize.getHeight();
        doc.setFillColor(248, 250, 252);
        doc.rect(0, h - 15, pageW, 15, 'F');
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 116, 139);
        doc.text('Lima Café 28 — ERP Kiosco Escolar · Documento generado automáticamente', margin, h - 6);
        doc.text(`ID: ${record.id.slice(0, 8).toUpperCase()} · Pág. ${pg}/${totalPages}`, pageW - margin, h - 6, { align: 'right' });
      }

      doc.save(`recibo-${record.id.slice(0, 8)}-${format(new Date(), 'yyyyMMdd')}.pdf`);
    } catch {
      toast({
        variant: 'destructive',
        title: 'Error al generar PDF',
        description: 'No se pudo generar el recibo. Intenta de nuevo.',
      });
    } finally {
      setDownloadingId(null);
    }
  };

  // ── Helpers de UI ──────────────────────────────────────────────────────────
  const getStatusBadge = (status: string) => {
    if (status === 'approved') {
      return (
        <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700 text-[10px] gap-0.5">
          <CheckCircle2 className="h-3 w-3" /> Aprobado
        </Badge>
      );
    }
    if (status === 'rejected') {
      return (
        <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700 text-[10px] gap-0.5">
          <XCircle className="h-3 w-3" /> Rechazado
        </Badge>
      );
    }
    if (status === 'voided') {
      return (
        <Badge variant="outline" className="border-gray-300 bg-gray-50 text-gray-500 text-[10px] gap-0.5">
          <Ban className="h-3 w-3" /> Anulado
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700 text-[10px] gap-0.5">
        <Clock className="h-3 w-3" /> En revisión
      </Badge>
    );
  };

  const getTypeIcon = (type: string | null) => {
    if (type === 'lunch_payment') return <UtensilsCrossed className="h-4 w-4 text-orange-500 flex-shrink-0" />;
    if (type === 'recharge') return <Wallet className="h-4 w-4 text-emerald-600 flex-shrink-0" />;
    return <CreditCard className="h-4 w-4 text-blue-500 flex-shrink-0" />;
  };

  const borderColor = (status: string) => {
    if (status === 'approved') return 'border-l-emerald-500';
    if (status === 'rejected') return 'border-l-red-500';
    if (status === 'voided')   return 'border-l-gray-300';
    return 'border-l-blue-500';
  };

  // ── Render principal ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-7 w-7 animate-spin text-emerald-500 mr-2" />
        <span className="text-slate-400 text-sm">Cargando historial...</span>
      </div>
    );
  }

  if (records.length === 0 && directPayments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-4">
          <FileText className="h-7 w-7 text-slate-400" />
        </div>
        <h3 className="text-base font-bold text-slate-700 mb-1">Sin registros</h3>
        <p className="text-sm text-slate-400 text-center">Aún no tienes pagos registrados.</p>
      </div>
    );
  }

  return (
    <>
      {/* Encabezado */}
      <div className="flex items-center justify-between mb-3 px-0.5">
        <p className="text-xs text-slate-400">
          {records.length + directPayments.length} registro{(records.length + directPayments.length) !== 1 ? 's' : ''} en tu historial
        </p>
        <button
          onClick={fetchHistory}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 active:scale-95 transition-all"
        >
          <RefreshCw className="h-3 w-3" />
          Actualizar
        </button>
      </div>

      {/* ── Cobros directos por administración (CXC) ── */}
      {directPayments.length > 0 && (
        <div className="mb-4 space-y-2">
          <div className="flex items-center gap-1.5 px-0.5 mb-1">
            <ShieldCheck className="h-3.5 w-3.5 text-violet-500" />
            <p className="text-[11px] font-semibold text-violet-700 uppercase tracking-wide">
              Cobros confirmados por administración
            </p>
          </div>
          {directPayments.map((grp) => {
            const isExpanded = expandedId === grp.groupKey;
            return (
              <div
                key={grp.groupKey}
                className="bg-white rounded-2xl shadow-sm border-l-4 border-l-violet-400 border border-slate-100 overflow-hidden"
              >
                <button
                  onClick={() => setExpandedId(isExpanded ? null : grp.groupKey)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50/60 active:bg-slate-100/60 transition-colors"
                >
                  <div className="shrink-0 w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center">
                    <ShieldCheck className="h-4 w-4 text-violet-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-slate-800 truncate">
                      Cobro directo — {grp.tickets.length} ticket{grp.tickets.length !== 1 ? 's' : ''}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {PAYMENT_METHOD_LABEL[grp.payment_method] ?? grp.payment_method}
                      {grp.operation_number && ` · Op# ${grp.operation_number}`}
                      {' · '}
                      {format(new Date(grp.paid_at), "d MMM yyyy", { locale: es })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right">
                      <Badge variant="outline" className="border-violet-300 bg-violet-50 text-violet-700 text-[10px] gap-0.5">
                        <CheckCircle2 className="h-3 w-3" /> Cobrado
                      </Badge>
                      <p className="text-sm font-black text-slate-800 mt-0.5">S/ {grp.total_amount.toFixed(2)}</p>
                    </div>
                    <svg
                      className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 pt-2 border-t border-slate-100 bg-slate-50/60 space-y-3">
                    {/* Detalles del cobro */}
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                      <div>
                        <span className="text-slate-400">Método: </span>
                        <span className="font-semibold text-slate-700">
                          {PAYMENT_METHOD_LABEL[grp.payment_method] ?? grp.payment_method}
                        </span>
                      </div>
                      {grp.operation_number && (
                        <div className="flex items-center gap-0.5 min-w-0">
                          <Hash className="h-3 w-3 text-slate-400 shrink-0" />
                          <span className="font-mono truncate text-slate-700">{grp.operation_number}</span>
                        </div>
                      )}
                    </div>

                    {/* Banner admin que cobró */}
                    <div className="flex items-center gap-2 bg-violet-50 border border-violet-100 rounded-xl px-3 py-2">
                      <ShieldCheck className="h-3.5 w-3.5 text-violet-500 shrink-0" />
                      <p className="text-[11px] text-violet-700">
                        Cobrado el {format(new Date(grp.paid_at), "d 'de' MMMM yyyy · HH:mm", { locale: es })}
                        {grp.admin_name && ` · por ${grp.admin_name}`}
                      </p>
                    </div>

                    {/* Lista de tickets incluidos */}
                    <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-100">
                        <Ticket className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                        <span className="text-[11px] font-semibold text-slate-600">
                          {grp.tickets.length} ticket{grp.tickets.length !== 1 ? 's' : ''} en este cobro
                        </span>
                      </div>
                      {grp.tickets.map((tk, idx) => (
                        <div key={tk.id} className={`px-3 py-2.5 ${idx > 0 ? 'border-t border-slate-100' : ''}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                                {tk.ticket_code && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-mono bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">
                                    <Hash className="h-2.5 w-2.5" />
                                    {tk.ticket_code}
                                  </span>
                                )}
                                {tk.is_lunch && (
                                  <span className="inline-flex items-center gap-0.5 text-[10px] bg-orange-100 text-orange-600 rounded px-1.5 py-0.5">
                                    <UtensilsCrossed className="h-2.5 w-2.5" /> Almuerzo
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-slate-500 truncate">{tk.description ?? tk.student_name}</p>
                            </div>
                            <span className="text-xs font-bold text-slate-800 shrink-0">S/ {tk.amount.toFixed(2)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Comprobantes enviados por el padre (vouchers) ── */}
      {records.length > 0 && (
        <div className="flex items-center gap-1.5 px-0.5 mb-2">
          <Wallet className="h-3.5 w-3.5 text-emerald-600" />
          <p className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide">
            Comprobantes enviados por ti
          </p>
        </div>
      )}

      {/* Lista compacta de comprobantes */}
      <div className="space-y-2">
        {records.map((record) => {
          const isExpanded = expandedId === record.id;
          const leftAccent = record.status === 'approved'
            ? 'border-l-emerald-400'
            : record.status === 'rejected'
              ? 'border-l-rose-400'
              : 'border-l-blue-400';

          return (
            <div
              key={record.id}
              className={`bg-white rounded-2xl shadow-sm border-l-4 border border-slate-100 overflow-hidden ${leftAccent}`}
            >
              {/* ── Fila compacta siempre visible ── */}
              <button
                onClick={() => {
                  const next = isExpanded ? null : record.id;
                  setExpandedId(next);
                  if (next) loadTicketDetails(record);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50/60 active:bg-slate-100/60 transition-colors"
              >
                {/* Ícono tipo */}
                <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${
                  record.request_type === 'lunch_payment' ? 'bg-orange-100' :
                  record.request_type === 'recharge' ? 'bg-emerald-100' : 'bg-blue-100'
                }`}>
                  {getTypeIcon(record.request_type)}
                </div>

                {/* Nombre + tipo */}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-slate-800 truncate">{record.studentName}</p>
                  <p className="text-[11px] text-slate-400">
                    {REQUEST_TYPE_LABEL[record.request_type ?? ''] ?? 'Pago'} · {format(new Date(record.created_at), "d MMM yyyy", { locale: es })}
                  </p>
                </div>

                {/* Monto + badge + chevron */}
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    {getStatusBadge(record.status)}
                    <p className="text-sm font-black text-slate-800 mt-0.5">S/ {record.amount.toFixed(2)}</p>
                  </div>
                  <svg
                    className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {/* ── Detalle expandible ── */}
              {isExpanded && (
                <div className="px-4 pb-4 pt-2 border-t border-slate-100 bg-slate-50/60 space-y-3">

                  {/* Concepto */}
                  {record.description && (
                    <p className="text-[11px] text-slate-600 bg-white rounded-xl px-3 py-2 leading-snug border border-slate-100">
                      {record.description}
                    </p>
                  )}

                  {/* ── Detalles de tickets pagados ── */}
                  {record.request_type !== 'recharge' && (record.paid_transaction_ids ?? []).length > 0 && (
                    <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
                      {/* Encabezado tickets */}
                      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-100">
                        <Ticket className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                        <span className="text-[11px] font-semibold text-slate-600">
                          {(record.paid_transaction_ids ?? []).length} ticket{(record.paid_transaction_ids ?? []).length !== 1 ? 's' : ''} incluido{(record.paid_transaction_ids ?? []).length !== 1 ? 's' : ''} en este pago
                        </span>
                      </div>

                      {/* Estado de carga */}
                      {loadingTickets.has(record.id) && (
                        <div className="flex items-center justify-center gap-2 py-4">
                          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                          <span className="text-[11px] text-slate-400">Cargando tickets...</span>
                        </div>
                      )}

                      {/* Lista de tickets */}
                      {!loadingTickets.has(record.id) && (ticketDetailsMap.get(record.id) ?? []).map((ticket, idx) => (
                        <div
                          key={ticket.id}
                          className={`px-3 py-2.5 ${idx > 0 ? 'border-t border-slate-100' : ''}`}
                        >
                          {/* Fila principal del ticket */}
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <div className="flex-1 min-w-0">
                              {ticket.ticket_code && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-mono bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 mb-1">
                                  <Hash className="h-2.5 w-2.5" />
                                  {ticket.ticket_code}
                                </span>
                              )}
                              <p className="text-[10px] text-slate-400">
                                {format(new Date(ticket.created_at), "d MMM yyyy · HH:mm", { locale: es })}
                              </p>
                            </div>
                            <span className="text-xs font-bold text-slate-800 shrink-0">
                              S/ {ticket.amount.toFixed(2)}
                            </span>
                          </div>

                          {/* Ítems de productos */}
                          {ticket.items.length > 0 ? (
                            <div className="space-y-1 pl-1">
                              {ticket.items.map((item, i) => (
                                <div key={i} className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <Package className="h-3 w-3 text-slate-300 shrink-0" />
                                    <span className="text-[10px] text-slate-600 truncate">
                                      {item.quantity > 1 && (
                                        <span className="font-semibold text-slate-800">{item.quantity}× </span>
                                      )}
                                      {item.product_name}
                                    </span>
                                  </div>
                                  <span className="text-[10px] text-slate-400 shrink-0">
                                    S/ {item.subtotal.toFixed(2)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[10px] text-slate-300 pl-1 italic">
                              Detalle no disponible
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Detalles del pago */}
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                    <div>
                      <span className="text-slate-400">Método: </span>
                      <span className="font-semibold text-slate-700">
                        {PAYMENT_METHOD_LABEL[record.payment_method] ?? record.payment_method}
                      </span>
                    </div>
                    {record.reference_code && (
                      <div className="flex items-center gap-0.5 min-w-0">
                        <Hash className="h-3 w-3 text-slate-400 shrink-0" />
                        <span className="font-mono truncate text-slate-700">{record.reference_code}</span>
                      </div>
                    )}
                    <div className="col-span-2 text-slate-400">
                      {format(new Date(record.created_at), "d 'de' MMMM yyyy · HH:mm", { locale: es })}
                    </div>
                  </div>

                  {/* Banner aprobado */}
                  {record.status === 'approved' && record.approved_at && (
                    <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      <p className="text-[11px] text-emerald-700">
                        Aprobado el {format(new Date(record.approved_at), "d 'de' MMMM yyyy", { locale: es })}
                        {record.approverName && ` · por ${record.approverName}`}
                      </p>
                    </div>
                  )}

                  {/* Comprobantes SUNAT */}
                  {record.status === 'approved' && record.sunat_invoices && record.sunat_invoices.length > 0 && (
                    <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2.5 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                        <p className="text-[11px] text-indigo-700 font-semibold">
                          {record.sunat_invoices.length === 1 ? 'Comprobante SUNAT' : `${record.sunat_invoices.length} comprobantes SUNAT`}
                        </p>
                      </div>
                      {record.sunat_invoices.map((inv, idx) => (
                        <div key={idx} className="flex items-center justify-between gap-2">
                          <p className="text-[10px] text-indigo-600 min-w-0 truncate">
                            {inv.invoice_type === 'factura' ? 'Factura' : 'Boleta'}
                            {inv.full_number && ` ${inv.full_number}`}
                          </p>
                          {inv.pdf_url ? (
                            <a href={inv.pdf_url} target="_blank" rel="noopener noreferrer"
                              className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 text-white text-[10px] font-bold hover:bg-indigo-700 active:scale-95 transition-all"
                            >
                              <Download className="h-3 w-3" />PDF
                            </a>
                          ) : (
                            <span className="text-[10px] text-indigo-400 shrink-0">Sin PDF</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Banner rechazado */}
                  {record.status === 'rejected' && record.rejection_reason && (
                    <div className="flex items-start gap-2 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">
                      <XCircle className="h-3.5 w-3.5 text-rose-500 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-rose-700 leading-snug">
                        <span className="font-semibold">Motivo de rechazo: </span>
                        {record.rejection_reason}
                      </p>
                    </div>
                  )}

                  {/* Botones acción */}
                  <div className="flex gap-2 pt-1">
                    {record.voucher_url && (
                      <button
                        onClick={() => setViewingImage(record.voucher_url!)}
                        className="flex-1 h-9 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-600 flex items-center justify-center gap-1.5 hover:bg-slate-50 active:scale-[0.98] transition-all"
                      >
                        <ImageIcon className="h-3.5 w-3.5" />
                        Ver comprobante
                      </button>
                    )}
                    <button
                      onClick={() => downloadPDF(record)}
                      disabled={downloadingId === record.id}
                      className="flex-1 h-9 rounded-xl bg-slate-800 text-white text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-slate-700 active:scale-[0.98] transition-all disabled:opacity-50"
                    >
                      {downloadingId === record.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      {downloadingId === record.id ? 'Generando...' : 'Descargar recibo'}
                    </button>
                  </div>

                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Modal para ver la foto del comprobante */}
      <Dialog open={!!viewingImage} onOpenChange={() => setViewingImage(null)}>
        <DialogContent className="max-w-md p-4" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Foto del comprobante</DialogTitle>
          </DialogHeader>
          {viewingImage && (
            <div className="flex flex-col gap-3">
              <img
                src={viewingImage}
                alt="Comprobante de pago"
                className="w-full rounded-lg object-contain max-h-[68vh] border border-gray-200"
              />
              <a
                href={viewingImage}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-center text-blue-600 underline underline-offset-2"
              >
                Abrir en pantalla completa
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
