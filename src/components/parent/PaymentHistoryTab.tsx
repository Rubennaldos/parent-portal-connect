import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Image as ImageIcon,
  Download,
  Hash,
  CreditCard,
  UtensilsCrossed,
  Wallet,
  RefreshCw,
  FileText,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import jsPDF from 'jspdf';

interface PaymentRecord {
  id: string;
  student_id: string;
  amount: number;
  payment_method: string;
  reference_code: string | null;
  voucher_url: string | null;
  status: 'pending' | 'approved' | 'rejected';
  rejection_reason: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  request_type: 'recharge' | 'lunch_payment' | 'debt_payment' | null;
  description: string | null;
  studentName: string;
  approverName: string | null;
  // Comprobantes SUNAT individuales (puede haber más de uno si el voucher cubrió varias deudas)
  sunat_invoices?: { pdf_url: string | null; full_number: string | null; invoice_type: string | null }[];
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
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetchHistory();
  }, [userId]);

  useEffect(() => {
    if (isActive) fetchHistory();
  }, [isActive]);

  const fetchHistory = async () => {
    setLoading(true);
    try {
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
          status: r.status as 'pending' | 'approved' | 'rejected',
          rejection_reason: r.rejection_reason,
          approved_at: r.approved_at,
          approved_by: r.approved_by,
          created_at: r.created_at,
          request_type: r.request_type as 'recharge' | 'lunch_payment' | 'debt_payment' | null,
          description: r.description,
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

          const { data: invoicesData } = await supabase
            .from('invoices')
            .select('id, pdf_url, full_number, invoice_type')
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

  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-4">
          <FileText className="h-7 w-7 text-slate-400" />
        </div>
        <h3 className="text-base font-bold text-slate-700 mb-1">Sin registros</h3>
        <p className="text-sm text-slate-400 text-center">Aún no has enviado ningún comprobante de pago.</p>
      </div>
    );
  }

  return (
    <>
      {/* Encabezado */}
      <div className="flex items-center justify-between mb-3 px-0.5">
        <p className="text-xs text-slate-400">
          {records.length} comprobante{records.length !== 1 ? 's' : ''} en tu historial
        </p>
        <button
          onClick={fetchHistory}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 active:scale-95 transition-all"
        >
          <RefreshCw className="h-3 w-3" />
          Actualizar
        </button>
      </div>

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
                onClick={() => setExpandedId(isExpanded ? null : record.id)}
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
        <DialogContent className="max-w-md p-4">
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
