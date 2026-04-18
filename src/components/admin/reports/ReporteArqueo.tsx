/**
 * ReporteArqueo — Arqueo de Caja autónomo.
 * Genera PDF y Excel con datos frescos de la base de datos.
 * No depende del estado del SalesListGrid.
 */
import { useState } from 'react';
import { normalizePaymentMethodKey } from '@/lib/paymentMethodLabels';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { FileText, FileSpreadsheet, Download, Calendar, Building2, Info, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { supabase } from '@/lib/supabase';

// ── Select de transacciones ────────────────────────────────────────────────────
const TX_SELECT = `
  id, amount, created_at, type, payment_status, payment_method,
  ticket_code, description, is_deleted, invoice_client_name,
  created_by, school_id, student_id, teacher_id, metadata,
  student:students(id, full_name),
  teacher:teacher_profiles(id, full_name),
  school:schools(id, name, code)
`.trim();

interface TxRow {
  id: string;
  amount: number;
  created_at: string;
  created_by: string | null;
  payment_status: string | null;
  payment_method: string | null;
  ticket_code: string | null;
  description: string | null;
  invoice_client_name: string | null;
  student_id: string | null;
  teacher_id: string | null;
  metadata: Record<string, unknown> | null;
  student: { id: string; full_name: string } | null;
  teacher: { id: string; full_name: string } | null;
  school: { id: string; name: string; code: string } | null;
  profiles?: { full_name: string | null; email: string | null } | null;
}

function isLunch(t: TxRow): boolean {
  const m = t.metadata as any;
  return !!(m?.lunch_order_id);
}

function toMetadataRecord(metadata: TxRow['metadata']): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object') return {};
  return metadata;
}

function getReportPaymentMethodKey(method: string | null | undefined): string {
  const normalized = normalizePaymentMethodKey(method);
  if (normalized === 'yape' || normalized === 'plin') return 'yape_plin';
  return normalized;
}

function getReportPaymentMethodLabel(method: string | null | undefined): string {
  const key = getReportPaymentMethodKey(method);
  if (key === 'efectivo') return 'Efectivo';
  if (key === 'tarjeta') return 'Tarjeta';
  if (key === 'yape_plin') return 'Yape/Plin';
  if (key === 'transferencia') return 'Transferencia';
  if (key === 'mixto') return 'Mixto';
  if (key === 'saldo') return 'Saldo';
  if (key === 'pagar_luego') return 'Pagar después';
  if (key === 'teacher') return 'Profesor';
  if (key === 'credito') return 'Crédito';
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Efectivo';
}

type SummaryMethodKey = 'efectivo' | 'yape_plin' | 'transferencia' | 'tarjeta';

function toSummaryMethodKey(method: string | null | undefined): SummaryMethodKey | null {
  const key = getReportPaymentMethodKey(method);
  if (key === 'efectivo') return 'efectivo';
  if (key === 'yape_plin') return 'yape_plin';
  if (key === 'transferencia') return 'transferencia';
  if (key === 'tarjeta') return 'tarjeta';
  return null;
}

function getSummaryMethodLabel(method: SummaryMethodKey): string {
  if (method === 'efectivo') return 'Efectivo';
  if (method === 'yape_plin') return 'Yape/Plin';
  if (method === 'transferencia') return 'Transferencia';
  return 'Tarjeta';
}

function extractSummaryContributions(tx: TxRow): Array<{ method: SummaryMethodKey; amount: number }> {
  const amount = Math.abs(tx.amount || 0);
  if (amount <= 0) return [];

  const metadata = toMetadataRecord(tx.metadata);

  // Si es pago mixto y tiene desglose, repartimos por split.
  if (normalizePaymentMethodKey(tx.payment_method) === 'mixto') {
    const rawSplits = metadata['payment_splits'];
    if (Array.isArray(rawSplits) && rawSplits.length > 0) {
      const result: Array<{ method: SummaryMethodKey; amount: number }> = [];
      for (const split of rawSplits) {
        if (!split || typeof split !== 'object') continue;
        const splitObj = split as Record<string, unknown>;
        const splitMethodRaw = typeof splitObj['method'] === 'string' ? splitObj['method'] : null;
        const splitAmountRaw = Number(splitObj['amount']);
        if (!Number.isFinite(splitAmountRaw) || splitAmountRaw <= 0) continue;
        const method = toSummaryMethodKey(splitMethodRaw);
        if (!method) continue;
        result.push({ method, amount: splitAmountRaw });
      }
      if (result.length > 0) return result;
    }
  }

  // No mixto (o mixto sin splits): clasifica por método principal.
  const directMethod = toSummaryMethodKey(tx.payment_method);
  if (directMethod) return [{ method: directMethod, amount }];

  // Fallback usando metadata.payment_method_detail cuando exista.
  const detailMethodRaw = typeof metadata['payment_method_detail'] === 'string'
    ? metadata['payment_method_detail']
    : null;
  const detailMethod = toSummaryMethodKey(detailMethodRaw);
  if (detailMethod) return [{ method: detailMethod, amount }];

  return [];
}

function getReportPaymentMethodLabelWithIcon(method: string | null | undefined): string {
  const key = getReportPaymentMethodKey(method);
  if (key === 'efectivo') return '💵 Efectivo';
  if (key === 'tarjeta') return '💳 Tarjeta';
  if (key === 'yape_plin') return '📱 Yape/Plin';
  if (key === 'transferencia') return '🏦 Transferencia';
  if (key === 'mixto') return '🔀 Mixto';
  if (key === 'saldo') return '💰 Saldo';
  return getReportPaymentMethodLabel(method);
}

function getPaymentStatusLabel(status: string | null | undefined): string {
  const normalized = (status || '').trim().toLowerCase();
  if (normalized === 'paid') return 'Pagado';
  if (normalized === 'pending') return 'Pendiente';
  if (normalized === 'partial') return 'Parcial';
  if (normalized === 'cancelled') return 'Cancelado';
  return status ? status : 'Sin estado';
}

function resolvePaymentDateTime(tx: TxRow): Date | null {
  const metadata = toMetadataRecord(tx.metadata);
  const candidates = [
    metadata['paid_at'],
    metadata['approved_at'],
    metadata['payment_date'],
    metadata['fecha_pago'],
    metadata['date_paid'],
  ];

  for (const value of candidates) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  // Si no existe timestamp específico, para transacciones pagadas usamos created_at.
  if ((tx.payment_status || '').toLowerCase() === 'paid') {
    const createdAt = new Date(tx.created_at);
    if (!Number.isNaN(createdAt.getTime())) return createdAt;
  }

  return null;
}

function resolveCashierName(t: TxRow): string {
  const profileName = t.profiles?.full_name?.trim();
  if (profileName) return profileName;

  const profileEmail = t.profiles?.email?.trim();
  if (profileEmail) return profileEmail;

  const metadata = toMetadataRecord(t.metadata);
  const metadataCandidates = [
    metadata['cashier_name'],
    metadata['cajero'],
    metadata['cashier_email'],
    metadata['cashier'],
    metadata['created_by_name'],
  ];
  for (const candidate of metadataCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  if (t.created_by) return `Usuario ${t.created_by.slice(0, 8)}`;
  return 'Sistema';
}

function getWeekCycleAnchor(year: number): Date {
  const jan1 = new Date(year, 0, 1);
  const anchor = new Date(year, 0, 1);
  anchor.setDate(jan1.getDate() - jan1.getDay());
  anchor.setHours(0, 0, 0, 0);
  return anchor;
}

function getWeekNumberForDate(dateInput: Date): number {
  const date = new Date(dateInput.getFullYear(), dateInput.getMonth(), dateInput.getDate());
  date.setHours(0, 0, 0, 0);

  const currentYear = date.getFullYear();
  const currentAnchor = getWeekCycleAnchor(currentYear);
  const nextAnchor = getWeekCycleAnchor(currentYear + 1);
  const prevAnchor = getWeekCycleAnchor(currentYear - 1);

  let cycleAnchor = currentAnchor;
  if (date >= nextAnchor) cycleAnchor = nextAnchor;
  else if (date < currentAnchor) cycleAnchor = prevAnchor;

  const msPerDay = 24 * 60 * 60 * 1000;
  const daysDiff = Math.floor((date.getTime() - cycleAnchor.getTime()) / msPerDay);
  return Math.floor(daysDiff / 7) + 1;
}

function formatWeekLabel(date: Date): string {
  const weekNumber = getWeekNumberForDate(date);
  return `Semana ${String(weekNumber).padStart(2, '0')}`;
}

interface ReporteArqueoProps {
  schoolId?: string | null;
}

export function ReporteArqueo({ schoolId }: ReporteArqueoProps) {
  const { user }                         = useAuth();
  const { canViewAllSchools }            = useRole();
  const { toast }                        = useToast();

  const today = new Date();
  const [dateFrom,  setDateFrom]  = useState<string>(format(today, 'yyyy-MM-dd'));
  const [dateTo,    setDateTo]    = useState<string>(format(today, 'yyyy-MM-dd'));
  const [timeFrom,  setTimeFrom]  = useState<string>('00:00');
  const [timeTo,    setTimeTo]    = useState<string>('23:59');
  const [loading,   setLoading]   = useState(false);

  // ── Fetch fresco de la BD ──────────────────────────────────────────────────
  const fetchData = async (): Promise<TxRow[]> => {
    // Lima = UTC-5 → para convertir hora Lima a UTC, sumar 5 horas
    const limaOffsetMs = 5 * 60 * 60 * 1000;
    const [fY, fM, fD] = dateFrom.split('-').map(Number);
    const [tY, tM, tD] = dateTo.split('-').map(Number);
    const [fromH, fromMin] = timeFrom.split(':').map(Number);
    const [toH,   toMin]   = timeTo.split(':').map(Number);

    // Inicio: fecha inicio a hora inicio Lima → UTC
    const startUTC = new Date(
      Date.UTC(fY, fM - 1, fD, fromH, fromMin, 0) + limaOffsetMs
    );
    // Fin: fecha fin a hora fin Lima → UTC (incluye el minuto completo)
    const endUTC = new Date(
      Date.UTC(tY, tM - 1, tD, toH, toMin, 59) + limaOffsetMs
    );

    const PAGE = 1000;
    let allData: TxRow[] = [];
    let from = 0;
    let hasMore = true;

    while (hasMore) {
      let q = supabase
        .from('transactions')
        .select(TX_SELECT)
        .in('type', ['purchase', 'sale'])
        .eq('is_deleted', false)
        .neq('payment_status', 'cancelled')
        .gte('created_at', startUTC.toISOString())
        .lte('created_at', endUTC.toISOString())
        .order('created_at', { ascending: false })
        .range(from, from + PAGE - 1);

      if (schoolId) {
        q = q.eq('school_id', schoolId);
      } else if (!canViewAllSchools) {
        const { data: prof } = await supabase
          .from('profiles').select('school_id').eq('id', user!.id).single();
        if (prof?.school_id) q = q.eq('school_id', prof.school_id);
      }

      const { data, error } = await q;
      if (error) throw error;
      allData = allData.concat((data ?? []) as TxRow[]);
      hasMore = (data?.length ?? 0) === PAGE;
      from += PAGE;
    }

    // Enriquecer con cajero
    if (allData.length > 0) {
      const ids = [...new Set(allData.map((t: any) => t.created_by).filter(Boolean))];
      if (ids.length > 0) {
        const { data: profs } = await supabase
          .from('profiles').select('id, email, full_name').in('id', ids as string[]);
        if (profs) {
          const map = new Map(profs.map(p => [p.id, p]));
          allData.forEach((t: any) => { if (t.created_by) t.profiles = map.get(t.created_by); });
        }
      }
    }
    return allData;
  };

  const rangeLabel = () =>
    dateFrom === dateTo
      ? format(new Date(dateFrom + 'T12:00:00'), "dd/MM/yyyy")
      : `${format(new Date(dateFrom + 'T12:00:00'), "dd/MM/yyyy")} — ${format(new Date(dateTo + 'T12:00:00'), "dd/MM/yyyy")}`;

  // ── Exportar PDF ──────────────────────────────────────────────────────────
  const handlePDF = async () => {
    setLoading(true);
    let data: TxRow[];
    try { data = await fetchData(); }
    catch (err: any) {
      toast({ variant: 'destructive', title: 'Error al exportar PDF', description: err.message });
      setLoading(false); return;
    } finally { setLoading(false); }

    if (data.length === 0) {
      toast({ variant: 'destructive', title: 'Sin datos', description: 'No hay ventas para el rango seleccionado.' });
      return;
    }

    // Agrupar por cliente
    const groups: Record<string, { name: string; txs: TxRow[]; total: number }> = {};
    data.forEach(t => {
      const name = t.student?.full_name || t.teacher?.full_name || t.invoice_client_name || 'Venta General';
      const key  = t.student_id || t.teacher_id || t.invoice_client_name || 'generic';
      if (!groups[key]) groups[key] = { name, txs: [], total: 0 };
      groups[key].txs.push(t);
      groups[key].total += Math.abs(t.amount || 0);
    });
    const groupList  = Object.values(groups).sort((a, b) => b.total - a.total);
    const grandTotal = data.reduce((s, t) => s + Math.abs(t.amount || 0), 0);

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const label = rangeLabel();

    doc.setFillColor(139, 69, 19);
    doc.rect(0, 0, 210, 30, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('LIMA CAFE', 14, 13);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('Reporte de Ventas — Comprobante de Arqueo', 14, 21);
    doc.text(label, 196, 21, { align: 'right' });

    doc.setTextColor(50, 50, 50);
    doc.setFontSize(9);
    doc.text(`Generado: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 14, 38);
    doc.text(`Total transacciones: ${data.length}`, 14, 44);
    doc.text(`Total ventas: S/ ${grandTotal.toFixed(2)}`, 14, 50);

    const rows: (string | { content: string; styles?: Record<string, unknown> })[][] = [];
    groupList.forEach(g => {
      g.txs.forEach((t, i) => {
        rows.push([
          i === 0 ? g.name : '',
          format(new Date(t.created_at), 'dd/MM HH:mm'),
          t.ticket_code || '—',
          t.payment_method ? getReportPaymentMethodLabel(t.payment_method) : '—',
          isLunch(t) ? 'Almuerzo' : (t.description || 'Cafetería'),
          `S/ ${Math.abs(t.amount || 0).toFixed(2)}`,
        ]);
      });
      rows.push([
        { content: `Subtotal ${g.name}`, styles: { fontStyle: 'bold', fillColor: [245, 245, 245] } },
        { content: '', styles: { fillColor: [245, 245, 245] } },
        { content: '', styles: { fillColor: [245, 245, 245] } },
        { content: '', styles: { fillColor: [245, 245, 245] } },
        { content: '', styles: { fillColor: [245, 245, 245] } },
        { content: `S/ ${g.total.toFixed(2)}`, styles: { fontStyle: 'bold', halign: 'right', fillColor: [245, 245, 245] } },
      ]);
    });
    rows.push([
      { content: 'TOTAL GENERAL', styles: { fontStyle: 'bold', fillColor: [139, 69, 19], textColor: [255, 255, 255] } },
      { content: '', styles: { fillColor: [139, 69, 19] } },
      { content: '', styles: { fillColor: [139, 69, 19] } },
      { content: '', styles: { fillColor: [139, 69, 19] } },
      { content: '', styles: { fillColor: [139, 69, 19] } },
      { content: `S/ ${grandTotal.toFixed(2)}`, styles: { fontStyle: 'bold', halign: 'right', fillColor: [139, 69, 19], textColor: [255, 255, 255] } },
    ]);

    autoTable(doc, {
      startY: 58,
      head: [['Alumno / Cliente', 'Fecha y Hora', 'Ticket', 'Método de Pago', 'Detalle', 'Monto']],
      body: rows,
      theme: 'striped',
      headStyles: { fillColor: [139, 69, 19], textColor: 255, fontStyle: 'bold', fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 38 },
        1: { cellWidth: 24 },
        2: { cellWidth: 24 },
        3: { cellWidth: 22 },
        4: { cellWidth: 'auto' },
        5: { halign: 'right', cellWidth: 22 },
      },
      didDrawCell: (cellData) => {
        if (cellData.section === 'body' && cellData.column.index === 0 && cellData.cell.raw !== '') {
          doc.setDrawColor(139, 69, 19);
          doc.setLineWidth(0.3);
          doc.line(cellData.cell.x, cellData.cell.y, 210 - 14, cellData.cell.y);
        }
      },
    });

    const finalY = (doc as any).lastAutoTable?.finalY || 200;
    doc.setDrawColor(139, 69, 19);
    doc.setLineWidth(0.5);
    doc.line(14, finalY + 8, 196, finalY + 8);
    doc.setFontSize(8);
    doc.setTextColor(100);
    doc.text('Este documento es un comprobante interno de arqueo. No tiene validez tributaria.', 105, finalY + 14, { align: 'center' });
    doc.text('Lima Cafe — Sistema de Gestión Escolar', 105, finalY + 19, { align: 'center' });

    doc.save(`arqueo_ventas_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`);
    toast({ title: '✅ PDF generado', description: 'El comprobante de arqueo se descargó correctamente.' });
  };

  // ── Exportar Excel ────────────────────────────────────────────────────────
  const handleExcel = async () => {
    setLoading(true);
    let data: TxRow[];
    try { data = await fetchData(); }
    catch (err: any) {
      toast({ variant: 'destructive', title: 'Error al exportar Excel', description: err.message });
      setLoading(false); return;
    } finally { setLoading(false); }

    if (data.length === 0) {
      toast({ variant: 'destructive', title: 'Sin datos', description: 'No hay ventas para el rango seleccionado.' });
      return;
    }

    const totalVentas  = data.reduce((s, t) => s + Math.abs(t.amount || 0), 0);
    const cantidadTx   = data.length;

    const wb = XLSX.utils.book_new();

    // ── Hoja 1: Transacciones (filtrable) ─────────────────────────────────
    const txHeaders = [
      'ID Ticket', 'Cliente', 'Sede', 'Semana', 'Fecha', 'Hora', 'Hora (0-23)',
      'Categoría', 'Cajero', 'Método de pago', 'Monto (S/)',
    ];
    const txRows: (string | number)[][] = [
      ['USO: Esta pestaña sirve para revisar cada venta individual del período seleccionado.'],
      ['DATOS RELEVANTES: Fecha, semana, cajero, método de pago y monto por ticket.'],
      [],
      txHeaders,
    ];
    data.forEach(t => {
      const dt         = new Date(t.created_at);
      const clientName = t.invoice_client_name || t.student?.full_name || t.teacher?.full_name || 'Venta general';
      const category   = isLunch(t) ? 'Almuerzo' : 'Cafetería/Kiosco';
      const cashier    = resolveCashierName(t);
      const method     = getReportPaymentMethodLabel(t.payment_method);
      txRows.push([
        t.ticket_code || '',
        clientName,
        t.school?.name ?? '',
        formatWeekLabel(dt),
        format(dt, 'yyyy-MM-dd'),         // Fecha separado — filtrable
        format(dt, 'HH:mm:ss'),           // Hora separado — filtrable
        dt.getHours(),                    // Hora (número) — filtrable
        category,
        cashier,
        method,
        Math.abs(t.amount || 0),
      ]);
    });
    // Fila de total
    txRows.push(['TOTAL', '', '', '', '', '', '', '', '', '', totalVentas]);

    const wsTx = XLSX.utils.aoa_to_sheet(txRows);
    wsTx['!cols'] = [
      { wch: 16 }, { wch: 28 }, { wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 },
      { wch: 16 }, { wch: 24 }, { wch: 18 }, { wch: 12 },
    ];
    // AutoFilter en todas las columnas de datos
    wsTx['!autofilter'] = { ref: `A4:K${txRows.length}` };
    XLSX.utils.book_append_sheet(wb, wsTx, 'Transacciones');

    // ── Hoja 2: Resumen por método de pago ────────────────────────────────
    const byMethod: Record<SummaryMethodKey, { total: number; count: number }> = {
      efectivo: { total: 0, count: 0 },
      yape_plin: { total: 0, count: 0 },
      transferencia: { total: 0, count: 0 },
      tarjeta: { total: 0, count: 0 },
    };
    data.forEach(t => {
      const contributions = extractSummaryContributions(t);
      contributions.forEach(c => {
        byMethod[c.method].total += c.amount;
      });
      if (contributions.length > 0) {
        const uniqueMethods = new Set(contributions.map(c => c.method));
        uniqueMethods.forEach((method) => {
          byMethod[method].count += 1;
        });
      }
    });
    const summaryTotal = Object.values(byMethod).reduce((sum, v) => sum + v.total, 0);
    const orderedMethods: SummaryMethodKey[] = ['efectivo', 'yape_plin', 'transferencia', 'tarjeta'];
    const summaryRows: (string | number)[][] = [
      ['USO: Esta pestaña resume cuánto ingresó por cada método de pago.'],
      ['DATOS RELEVANTES: Total por método, número de transacciones y porcentaje sobre el total del período filtrado.'],
      [`PERÍODO APLICADO: ${rangeLabel()} | Hora: ${timeFrom} - ${timeTo}`],
      [],
      ['Método de pago', 'Total (S/)', 'Transacciones', '% del período'],
      ...orderedMethods.map((m) => [
        getSummaryMethodLabel(m),
        byMethod[m].total,
        byMethod[m].count,
        summaryTotal > 0 ? Math.round((byMethod[m].total / summaryTotal) * 10000) / 100 : 0,
      ]),
      ['TOTAL', summaryTotal, cantidadTx, 100],
    ];
    const wsSum = XLSX.utils.aoa_to_sheet(summaryRows);
    wsSum['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 16 }, { wch: 14 }];
    wsSum['!autofilter'] = { ref: `A4:D${summaryRows.length}` };
    XLSX.utils.book_append_sheet(wb, wsSum, 'Resumen Métodos');

    // ── Hoja 3: Plantilla R.G.G ─────────────────────────────────────────────
    const rggHeaders = [
      'Ticket',
      'Nombre del cliente',
      'Sede (abreviación)',
      'Día',
      'Mes',
      'Hora',
      'Semana',
      'Categoría del producto',
      'Método de pago',
      'Monto total',
      'Estado del pago actual',
      'Fecha de pago',
      'Hora de pago',
    ];

    const rggRows: (string | number)[][] = [
      ['PLANTILLA R.G.G: Reporte operativo en formato solicitado por dirección.'],
      ['DATOS RELEVANTES: estado de pago al momento del reporte + fecha/hora asociada al pago.'],
      [`PERÍODO APLICADO: ${rangeLabel()} | Hora: ${timeFrom} - ${timeTo}`],
      [],
      rggHeaders,
    ];

    data.forEach((t) => {
      const txDate = new Date(t.created_at);
      const paymentDate = resolvePaymentDateTime(t);
      const clientName = t.invoice_client_name || t.student?.full_name || t.teacher?.full_name || 'Venta general';
      const schoolAbbr = (t.school?.code || '').trim() || (t.school?.name || '').trim();
      const category = isLunch(t) ? 'Almuerzo' : (t.description?.trim() || 'Cafetería/Kiosco');
      const method = getReportPaymentMethodLabel(t.payment_method);
      const paymentStatus = getPaymentStatusLabel(t.payment_status);

      rggRows.push([
        t.ticket_code || '',
        clientName,
        schoolAbbr,
        format(txDate, 'dd'),
        format(txDate, 'MMMM', { locale: es }),
        format(txDate, 'HH:mm:ss'),
        formatWeekLabel(txDate),
        category,
        method,
        Math.abs(t.amount || 0),
        paymentStatus,
        paymentDate ? format(paymentDate, 'yyyy-MM-dd') : '',
        paymentDate ? format(paymentDate, 'HH:mm:ss') : '',
      ]);
    });

    const wsRgg = XLSX.utils.aoa_to_sheet(rggRows);
    wsRgg['!cols'] = [
      { wch: 16 }, // Ticket
      { wch: 28 }, // Nombre del cliente
      { wch: 16 }, // Sede abreviación
      { wch: 8 },  // Día
      { wch: 14 }, // Mes
      { wch: 10 }, // Hora
      { wch: 12 }, // Semana
      { wch: 24 }, // Categoría del producto
      { wch: 18 }, // Método de pago
      { wch: 12 }, // Monto total
      { wch: 20 }, // Estado del pago actual
      { wch: 14 }, // Fecha de pago
      { wch: 10 }, // Hora de pago
    ];
    wsRgg['!autofilter'] = { ref: `A5:M${rggRows.length}` };
    XLSX.utils.book_append_sheet(wb, wsRgg, 'R.G.G');

    const timeRange = timeFrom === '00:00' && timeTo === '23:59' ? '' : `_${timeFrom.replace(':', '')}h-${timeTo.replace(':', '')}h`;
    XLSX.writeFile(wb, `arqueo_caja_${dateFrom}_${dateTo}${timeRange}_${format(new Date(), 'HHmm')}.xlsx`);
    toast({ title: '✅ Excel generado', description: `${cantidadTx} ventas exportadas. Hojas: "Transacciones", "Resumen Métodos" y "R.G.G".` });
  };

  // ── Resumen por método de pago (previa al export) ──────────────────────────
  const [preview, setPreview] = useState<{
    total: number; count: number;
    byMethod: { method: string; total: number; count: number }[];
  } | null>(null);

  const handlePreview = async () => {
    setLoading(true);
    let data: TxRow[];
    try { data = await fetchData(); }
    catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
      setLoading(false); return;
    } finally { setLoading(false); }

    if (data.length === 0) {
      setPreview({ total: 0, count: 0, byMethod: [] });
      return;
    }
    const byMethod: Record<SummaryMethodKey, { method: SummaryMethodKey; total: number; count: number }> = {
      efectivo: { method: 'efectivo', total: 0, count: 0 },
      yape_plin: { method: 'yape_plin', total: 0, count: 0 },
      transferencia: { method: 'transferencia', total: 0, count: 0 },
      tarjeta: { method: 'tarjeta', total: 0, count: 0 },
    };
    data.forEach(t => {
      const contributions = extractSummaryContributions(t);
      contributions.forEach(c => {
        byMethod[c.method].total += c.amount;
      });
      if (contributions.length > 0) {
        const uniqueMethods = new Set(contributions.map(c => c.method));
        uniqueMethods.forEach((method) => {
          byMethod[method].count += 1;
        });
      }
    });
    const previewTotal = Object.values(byMethod).reduce((sum, v) => sum + v.total, 0);
    setPreview({
      total: previewTotal,
      count: data.length,
      byMethod: Object.values(byMethod).sort((a, b) => b.total - a.total),
    });
  };

  const methodLabel = (m: string) => getReportPaymentMethodLabelWithIcon(m);

  return (
    <div className="space-y-6">

      {/* Selector de fechas */}
      <Card className="border shadow-sm">
        <CardContent className="pt-5 pb-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="flex items-center gap-2 shrink-0">
              <Calendar className="h-5 w-5 text-violet-600" />
              <span className="font-semibold text-slate-700">Período del Arqueo</span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Rango de fechas */}
              <div className="flex items-center gap-2 bg-slate-50 border rounded-lg px-3 py-2">
                <span className="text-xs text-slate-500 font-medium">Desde</span>
                <input
                  type="date"
                  value={dateFrom}
                  max={dateTo}
                  onChange={e => { setDateFrom(e.target.value); setPreview(null); }}
                  className="text-sm font-semibold text-slate-800 bg-transparent focus:outline-none"
                />
              </div>
              <span className="text-slate-400 text-sm">→</span>
              <div className="flex items-center gap-2 bg-slate-50 border rounded-lg px-3 py-2">
                <span className="text-xs text-slate-500 font-medium">Hasta</span>
                <input
                  type="date"
                  value={dateTo}
                  min={dateFrom}
                  max={format(new Date(), 'yyyy-MM-dd')}
                  onChange={e => { setDateTo(e.target.value); setPreview(null); }}
                  className="text-sm font-semibold text-slate-800 bg-transparent focus:outline-none"
                />
              </div>

              {/* Filtro de hora */}
              <div className="flex items-center gap-2 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">
                <Clock className="h-3.5 w-3.5 text-violet-500 shrink-0" />
                <span className="text-xs text-violet-600 font-medium">Hora</span>
                <input
                  type="time"
                  value={timeFrom}
                  onChange={e => { setTimeFrom(e.target.value); setPreview(null); }}
                  className="text-sm font-semibold text-slate-800 bg-transparent focus:outline-none w-20"
                />
                <span className="text-slate-400 text-xs">—</span>
                <input
                  type="time"
                  value={timeTo}
                  onChange={e => { setTimeTo(e.target.value); setPreview(null); }}
                  className="text-sm font-semibold text-slate-800 bg-transparent focus:outline-none w-20"
                />
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-blue-600 hover:bg-blue-50"
                onClick={() => {
                  const t = format(new Date(), 'yyyy-MM-dd');
                  setDateFrom(t); setDateTo(t); setTimeFrom('00:00'); setTimeTo('23:59'); setPreview(null);
                }}
              >
                Hoy
              </Button>
            </div>

            {schoolId && (
              <div className="flex items-center gap-1.5 ml-auto text-xs text-slate-500">
                <Building2 className="h-3.5 w-3.5" />
                <span>Tu sede</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Botón de previsualización */}
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          onClick={handlePreview}
          disabled={loading}
          className="gap-2"
        >
          <Info className="h-4 w-4 text-slate-500" />
          {loading ? 'Cargando...' : 'Ver resumen del período'}
        </Button>
      </div>

      {/* Previsualización */}
      {preview && (
        <Card className="border shadow-sm bg-gradient-to-br from-violet-50 to-purple-50 border-violet-200">
          <CardContent className="pt-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs font-semibold text-violet-600 uppercase tracking-wide">Resumen del Período</p>
                <p className="text-sm text-slate-600 mt-0.5">{rangeLabel()}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-black text-violet-900">S/ {preview.total.toFixed(2)}</p>
                <p className="text-xs text-slate-500">{preview.count} transacciones</p>
              </div>
            </div>

            {preview.count === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">
                No hay ventas registradas en este período.
              </p>
            ) : (
              <>
                <div className="space-y-2 mb-5">
                  {preview.byMethod.map(m => (
                    <div key={m.method} className="flex items-center justify-between text-sm">
                      <span className="text-slate-700">{methodLabel(m.method)}</span>
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="text-xs">{m.count} tx</Badge>
                        <span className="font-bold text-slate-800 w-24 text-right">S/ {m.total.toFixed(2)}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-3 border-t pt-4">
                  <Button
                    onClick={handlePDF}
                    disabled={loading}
                    className="gap-2 bg-orange-600 hover:bg-orange-700 text-white"
                  >
                    <FileText className="h-4 w-4" />
                    {loading ? 'Generando...' : 'Descargar PDF'}
                  </Button>
                  <Button
                    onClick={handleExcel}
                    disabled={loading}
                    variant="outline"
                    className="gap-2 border-emerald-500 text-emerald-700 hover:bg-emerald-50"
                  >
                    <FileSpreadsheet className="h-4 w-4" />
                    {loading ? 'Generando...' : 'Descargar Excel'}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Instrucciones cuando no hay previsualización */}
      {!preview && (
        <Card className="border border-dashed border-slate-200 bg-slate-50">
          <CardContent className="py-12 flex flex-col items-center gap-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-white shadow-sm border flex items-center justify-center">
              <Download className="h-7 w-7 text-violet-500" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-700 mb-1">Cierre de Caja por Período</h3>
              <p className="text-xs text-slate-400 max-w-sm">
                Selecciona el rango de fechas y presiona "Ver resumen del período" para previsualizar
                los totales. Luego podrás exportar a PDF o Excel.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center">
              <Badge variant="outline" className="text-xs gap-1">
                <FileText className="h-3 w-3" /> PDF con detalle por cliente
              </Badge>
              <Badge variant="outline" className="text-xs gap-1">
                <FileSpreadsheet className="h-3 w-3" /> Excel completo (todos los tickets)
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
