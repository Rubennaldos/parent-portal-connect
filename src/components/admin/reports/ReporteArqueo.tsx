/**
 * ReporteArqueo — Arqueo de Caja autónomo.
 * Genera PDF y Excel con datos frescos de la base de datos.
 * No depende del estado del SalesListGrid.
 */
import { useState } from 'react';
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
          t.payment_method || '—',
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

    const label        = rangeLabel();
    const totalVentas  = data.reduce((s, t) => s + Math.abs(t.amount || 0), 0);
    const cantidadTx   = data.length;
    const promedio     = cantidadTx > 0 ? totalVentas / cantidadTx : 0;

    const wb = XLSX.utils.book_new();

    // ── Sheet 1: Transactions (filterable) ────────────────────────────────
    const txHeaders = [
      'Ticket ID', 'Client', 'School', 'Date', 'Time', 'Hour',
      'Category', 'Cashier', 'Payment Method', 'Amount (S/)',
    ];
    const txRows: (string | number)[][] = [txHeaders];
    data.forEach(t => {
      const dt         = new Date(t.created_at);
      const clientName = t.invoice_client_name || t.student?.full_name || t.teacher?.full_name || 'General Sale';
      const category   = isLunch(t) ? 'Lunch' : 'Cafeteria/Kiosk';
      const cashier    = (t as any).profiles?.full_name || (t as any).profiles?.email || 'System';
      const method     = t.payment_method
        ? t.payment_method.charAt(0).toUpperCase() + t.payment_method.slice(1)
        : 'Cash';
      txRows.push([
        t.ticket_code || '',
        clientName,
        t.school?.name ?? '',
        format(dt, 'yyyy-MM-dd'),         // Date separado — filtreable
        format(dt, 'HH:mm:ss'),           // Time separado — filtreable
        dt.getHours(),                    // Hour (número) — filtreable
        category,
        cashier,
        method,
        Math.abs(t.amount || 0),
      ]);
    });
    // Fila de total
    txRows.push(['TOTAL', '', '', '', '', '', '', '', '', totalVentas]);

    const wsTx = XLSX.utils.aoa_to_sheet(txRows);
    wsTx['!cols'] = [
      { wch: 16 }, { wch: 28 }, { wch: 22 }, { wch: 12 }, { wch: 10 }, { wch: 6 },
      { wch: 16 }, { wch: 24 }, { wch: 16 }, { wch: 12 },
    ];
    // AutoFilter en todas las columnas de datos
    wsTx['!autofilter'] = { ref: `A1:J${txRows.length}` };
    XLSX.utils.book_append_sheet(wb, wsTx, 'Transactions');

    // ── Sheet 2: Summary by Payment Method ────────────────────────────────
    const byMethod: Record<string, { total: number; count: number }> = {};
    data.forEach(t => {
      const m = (t.payment_method || 'cash').toLowerCase();
      if (!byMethod[m]) byMethod[m] = { total: 0, count: 0 };
      byMethod[m].total += Math.abs(t.amount || 0);
      byMethod[m].count += 1;
    });
    const summaryRows: (string | number)[][] = [
      ['Payment Method', 'Total (S/)', 'Transactions', '% of Total'],
      ...Object.entries(byMethod)
        .sort((a, b) => b[1].total - a[1].total)
        .map(([m, v]) => [
          m.charAt(0).toUpperCase() + m.slice(1),
          v.total,
          v.count,
          totalVentas > 0 ? Math.round((v.total / totalVentas) * 10000) / 100 : 0,
        ]),
      ['TOTAL', totalVentas, cantidadTx, 100],
    ];
    const wsSum = XLSX.utils.aoa_to_sheet(summaryRows);
    wsSum['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 16 }, { wch: 14 }];
    wsSum['!autofilter'] = { ref: `A1:D${summaryRows.length}` };
    XLSX.utils.book_append_sheet(wb, wsSum, 'Summary by Method');

    const timeRange = timeFrom === '00:00' && timeTo === '23:59' ? '' : `_${timeFrom.replace(':', '')}h-${timeTo.replace(':', '')}h`;
    XLSX.writeFile(wb, `cash_register_${dateFrom}_${dateTo}${timeRange}_${format(new Date(), 'HHmm')}.xlsx`);
    toast({ title: '✅ Excel generado', description: `${cantidadTx} ventas exportadas. Hoja "Transactions" tiene AutoFilter activado.` });
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
    const byMethod: Record<string, { method: string; total: number; count: number }> = {};
    data.forEach(t => {
      const m = t.payment_method || 'efectivo';
      if (!byMethod[m]) byMethod[m] = { method: m, total: 0, count: 0 };
      byMethod[m].total += Math.abs(t.amount || 0);
      byMethod[m].count += 1;
    });
    setPreview({
      total: data.reduce((s, t) => s + Math.abs(t.amount || 0), 0),
      count: data.length,
      byMethod: Object.values(byMethod).sort((a, b) => b.total - a.total),
    });
  };

  const methodLabel: Record<string, string> = {
    efectivo: '💵 Efectivo', yape: '📱 Yape', plin: '📱 Plin',
    tarjeta: '💳 Tarjeta', transferencia: '🏦 Transferencia', mixto: '🔀 Mixto',
  };

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
                      <span className="text-slate-700">{methodLabel[m.method] ?? m.method}</span>
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
