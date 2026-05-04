/**
 * InventoryAuditModal
 * Reporte de Auditoría de Consumo Diario — detecta fugas de inventario.
 *
 * ACCESO: solo admin_general, gestor_unidad y superadmin.
 * El botón que abre este modal NUNCA se muestra al operador_caja.
 *
 * CÁLCULOS: 100% en PostgreSQL via RPC get_inventory_movement_report.
 * Este componente NO suma, NO resta, NO compara montos — solo muestra.
 */
import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Download, FileSpreadsheet, ShieldAlert, PackageSearch } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface Movimiento {
  hora_exacta:    string;
  ticket_id:      string;
  ticket_code:    string;
  categoria:      string;
  producto:       string;
  vendedor:       string;
  precio_unitario:number;
  cantidad:       number;
  monto_linea:    number;
}

interface Resumen {
  total_unidades: number;
  valor_total:    number;
  total_tickets:  number;
}

interface ReportData {
  fecha:       string;
  generado_en: string;
  movimientos: Movimiento[];
  resumen:     Resumen;
}

interface Props {
  open:     boolean;
  onClose:  () => void;
  schoolId: string;
  date:     string;        // 'YYYY-MM-DD'
  schoolName?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMoney(n: number): string {
  return `S/ ${Number(n).toFixed(2)}`;
}

function formatDateLabel(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "EEEE d 'de' MMMM yyyy", { locale: es });
  } catch { return dateStr; }
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function InventoryAuditModal({ open, onClose, schoolId, date, schoolName }: Props) {
  const [report, setReport]   = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // ── Cargar datos desde la BD ─────────────────────────────────────────────
  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('get_inventory_movement_report', {
        p_school_id: schoolId,
        p_date:      date,
      });
      if (rpcErr) throw rpcErr;
      setReport(data as ReportData);
    } catch (err: any) {
      console.error('[InventoryAudit] RPC error:', err);
      setError(err?.message ?? 'Error al cargar el reporte de auditoría.');
    } finally {
      setLoading(false);
    }
  }, [schoolId, date]);

  // Cargar automáticamente cuando el modal se abre (useEffect porque
  // onOpenChange de Radix NO dispara cuando el padre cambia open a true).
  useEffect(() => {
    if (open) {
      loadReport();
    }
  }, [open, loadReport]);

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) onClose();
  };

  // ── Exportar PDF ─────────────────────────────────────────────────────────
  const exportPDF = () => {
    if (!report) return;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    // Cabecera
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('AUDITORÍA DE CONSUMO DIARIO', 14, 16);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Sede: ${schoolName ?? schoolId}`, 14, 24);
    doc.text(`Fecha: ${formatDateLabel(report.fecha)}`, 14, 30);
    doc.text(`Generado: ${report.generado_en} (hora Lima)`, 14, 36);

    // Tabla de movimientos
    const rows = report.movimientos.map((m, i) => [
      String(i + 1),
      m.hora_exacta,
      m.ticket_code,
      m.categoria,
      m.producto,
      m.vendedor,
      formatMoney(m.precio_unitario),
      String(m.cantidad),
      formatMoney(m.monto_linea),
    ]);

    autoTable(doc, {
      startY: 42,
      head: [['#', 'Hora', 'Ticket', 'Tipo', 'Producto', 'Vendedor', 'P.Unit.', 'Cant.', 'Total Línea']],
      body: rows,
      styles:      { fontSize: 7.5, cellPadding: 2 },
      headStyles:  { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 8,  halign: 'center' },
        1: { cellWidth: 18, halign: 'center' },
        2: { cellWidth: 22, halign: 'center' },
        3: { cellWidth: 22 },
        4: { cellWidth: 55 },
        5: { cellWidth: 35 },
        6: { cellWidth: 18, halign: 'right' },
        7: { cellWidth: 13, halign: 'center' },
        8: { cellWidth: 22, halign: 'right' },
      },
      foot: [[
        '', '', '', '', '', 'TOTALES',
        '',
        String(report.resumen.total_unidades),
        formatMoney(report.resumen.valor_total),
      ]],
      footStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold' },
    });

    // Resumen al pie de la última página
    const finalY = (doc as any).lastAutoTable?.finalY ?? 180;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(`Tickets / boletas: ${report.resumen.total_tickets}`, 14, finalY + 8);
    doc.text(`Total unidades salientes: ${report.resumen.total_unidades}`, 14, finalY + 14);
    doc.text(`Valor total de mercancía registrada: ${formatMoney(report.resumen.valor_total)}`, 14, finalY + 20);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    doc.text('Documento de uso interno — auditoría de inventario. Confidencial.', 14, finalY + 28);

    doc.save(`auditoria_inventario_${date}.pdf`);
  };

  // ── Exportar Excel ────────────────────────────────────────────────────────
  const exportExcel = () => {
    if (!report) return;

    const rows = report.movimientos.map((m, i) => ({
      '#':              i + 1,
      'Hora Exacta':    m.hora_exacta,
      'Ticket':         m.ticket_code,
      'Tipo':           m.categoria,
      'Producto':       m.producto,
      'Vendedor':       m.vendedor,
      'Precio Unitario':m.precio_unitario,
      'Cantidad':       m.cantidad,
      'Total Línea':    m.monto_linea,
    }));

    // Fila de resumen al final
    rows.push({
      '#':               '' as any,
      'Hora Exacta':     '',
      'Ticket':          '',
      'Tipo':            '',
      'Producto':        '',
      'Vendedor':        'TOTALES',
      'Precio Unitario': '' as any,
      'Cantidad':        report.resumen.total_unidades,
      'Total Línea':     report.resumen.valor_total,
    });

    const ws = XLSX.utils.json_to_sheet(rows);

    // Ancho de columnas
    ws['!cols'] = [
      { wch: 5 }, { wch: 12 }, { wch: 16 }, { wch: 14 },
      { wch: 40 }, { wch: 28 }, { wch: 15 }, { wch: 10 }, { wch: 14 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Auditoría Inventario');

    // Hoja de metadatos
    const meta = XLSX.utils.aoa_to_sheet([
      ['Campo',         'Valor'],
      ['Sede',          schoolName ?? schoolId],
      ['Fecha',         report.fecha],
      ['Generado (Lima)', report.generado_en],
      ['Total Tickets', report.resumen.total_tickets],
      ['Total Unidades', report.resumen.total_unidades],
      ['Valor Total (S/)', report.resumen.valor_total],
    ]);
    XLSX.utils.book_append_sheet(wb, meta, 'Resumen');

    XLSX.writeFile(wb, `auditoria_inventario_${date}.xlsx`);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-5xl max-h-[90vh] flex flex-col"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-800 text-base">
            <ShieldAlert className="h-5 w-5 text-amber-600" />
            Auditoría de Consumo Diario
            <Badge className="bg-amber-100 text-amber-700 text-xs font-semibold ml-1">
              Solo admin
            </Badge>
          </DialogTitle>
          <p className="text-xs text-gray-500 mt-0.5">
            {formatDateLabel(date)}
            {schoolName ? ` · ${schoolName}` : ''}
            {' · Todos los productos registrados como vendidos/consumidos'}
          </p>
        </DialogHeader>

        {/* ── Botones de exportación ──────────────────────────────────── */}
        {report && !loading && report.movimientos.length > 0 && (
          <div className="flex gap-2 flex-wrap pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={exportPDF}
              className="border-red-300 text-red-700 hover:bg-red-50 font-semibold"
            >
              <Download className="h-4 w-4 mr-1.5" />
              PDF (Auditoría rígida)
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={exportExcel}
              className="border-green-400 text-green-700 hover:bg-green-50 font-semibold"
            >
              <FileSpreadsheet className="h-4 w-4 mr-1.5" />
              Excel (Filtrable)
            </Button>
          </div>
        )}

        {/* ── Cuerpo ─────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto min-h-0 mt-2">

          {/* Loading */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
              <p className="text-sm text-gray-500">Consultando base de datos…</p>
            </div>
          )}

          {/* Error */}
          {error && !loading && (
            <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
              <ShieldAlert className="h-5 w-5 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {/* Sin movimientos */}
          {report && !loading && report.movimientos.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
              <PackageSearch className="h-12 w-12" />
              <p className="font-medium text-gray-500">Sin movimientos de inventario en esta fecha</p>
              <p className="text-sm">No se registraron ventas o consumos en el sistema.</p>
            </div>
          )}

          {/* Tabla de movimientos */}
          {report && !loading && report.movimientos.length > 0 && (
            <div className="space-y-4">

              {/* Resumen final — siempre visible arriba del listado */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-800 text-white rounded-xl p-4 text-center">
                  <p className="text-xs text-slate-300 uppercase tracking-wide font-semibold">Tickets / Boletas</p>
                  <p className="text-3xl font-black mt-1">{report.resumen.total_tickets}</p>
                </div>
                <div className="bg-amber-600 text-white rounded-xl p-4 text-center">
                  <p className="text-xs text-amber-100 uppercase tracking-wide font-semibold">Total Unidades Vendidas</p>
                  <p className="text-3xl font-black mt-1">{report.resumen.total_unidades}</p>
                </div>
                <div className="bg-emerald-700 text-white rounded-xl p-4 text-center">
                  <p className="text-xs text-emerald-100 uppercase tracking-wide font-semibold">Valor Total Mercancía</p>
                  <p className="text-3xl font-black mt-1">{formatMoney(report.resumen.valor_total)}</p>
                </div>
              </div>

              {/* Aviso de uso */}
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-amber-800 text-xs">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                <span>
                  <strong>Auditoría de inventario:</strong> Estos registros representan todo lo que el sistema
                  marcó como vendido o consumido. Cruza la columna "Hora Exacta" con las cámaras de seguridad
                  para detectar diferencias. El método de pago no afecta este reporte.
                </span>
              </div>

              {/* Tabla */}
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full text-xs border-collapse min-w-[720px]">
                  <thead className="bg-slate-800 text-white">
                    <tr>
                      <th className="px-3 py-2.5 text-left font-semibold tracking-wide">#</th>
                      <th className="px-3 py-2.5 text-left font-semibold tracking-wide">Hora Exacta</th>
                      <th className="px-3 py-2.5 text-left font-semibold tracking-wide">Ticket</th>
                      <th className="px-3 py-2.5 text-left font-semibold tracking-wide">Tipo</th>
                      <th className="px-3 py-2.5 text-left font-semibold tracking-wide">Producto</th>
                      <th className="px-3 py-2.5 text-left font-semibold tracking-wide">Vendedor</th>
                      <th className="px-3 py-2.5 text-right font-semibold tracking-wide">P. Unit.</th>
                      <th className="px-3 py-2.5 text-center font-semibold tracking-wide">Cant.</th>
                      <th className="px-3 py-2.5 text-right font-semibold tracking-wide">Total Línea</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.movimientos.map((m, i) => (
                      <tr
                        key={`${m.ticket_id}-${i}`}
                        className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50'} hover:bg-amber-50 transition-colors`}
                      >
                        <td className="px-3 py-2 text-gray-400 font-mono">{i + 1}</td>
                        <td className="px-3 py-2 font-mono font-bold text-slate-700">{m.hora_exacta}</td>
                        <td className="px-3 py-2 text-gray-500 font-mono text-[10px]">{m.ticket_code}</td>
                        <td className="px-3 py-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            m.categoria === 'Almuerzo'
                              ? 'bg-orange-100 text-orange-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}>
                            {m.categoria}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-medium text-gray-800 max-w-[200px] truncate" title={m.producto}>
                          {m.producto}
                        </td>
                        <td className="px-3 py-2 text-gray-600 max-w-[140px] truncate" title={m.vendedor}>
                          {m.vendedor}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-700">
                          {formatMoney(m.precio_unitario)}
                        </td>
                        <td className="px-3 py-2 text-center font-bold text-gray-800">
                          {m.cantidad}
                        </td>
                        <td className="px-3 py-2 text-right font-black text-slate-800">
                          {formatMoney(m.monto_linea)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-800 text-white">
                    <tr>
                      <td colSpan={6} className="px-3 py-2.5 font-bold text-right text-sm tracking-wide uppercase">
                        TOTALES
                      </td>
                      <td className="px-3 py-2.5 text-right text-sm">—</td>
                      <td className="px-3 py-2.5 text-center font-black text-lg">
                        {report.resumen.total_unidades}
                      </td>
                      <td className="px-3 py-2.5 text-right font-black text-lg">
                        {formatMoney(report.resumen.valor_total)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <p className="text-[10px] text-gray-400 text-right">
                Generado: {report.generado_en} · Zona horaria: America/Lima (UTC-5)
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
