/**
 * InventoryAuditModal
 * Auditoría de Consumo Diario — detalle y consolidado por producto.
 * Cálculos 100% en PostgreSQL (RPC get_inventory_movement_report).
 */
import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Download, FileSpreadsheet, ShieldAlert, PackageSearch, Printer, LayoutGrid, List } from 'lucide-react';
import {
  type ReportData,
  formatDateLabel,
  exportDetailPDF,
  exportDetailExcel,
  exportConsolidatedExcel,
  printConsolidatedWincha,
} from './inventoryAuditExport';

type AuditView = 'consolidado' | 'detalle';

interface Props {
  open: boolean;
  onClose: () => void;
  schoolId: string;
  date: string;
  schoolName?: string;
}

function formatMoney(n: number): string {
  return `S/ ${Number(n).toFixed(2)}`;
}

function SummaryCards({ resumen }: { resumen: ReportData['resumen'] }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="bg-slate-800 text-white rounded-xl p-4 text-center">
        <p className="text-xs text-slate-300 uppercase tracking-wide font-semibold">Tickets / Boletas</p>
        <p className="text-3xl font-black mt-1">{resumen.total_tickets}</p>
      </div>
      <div className="bg-amber-600 text-white rounded-xl p-4 text-center">
        <p className="text-xs text-amber-100 uppercase tracking-wide font-semibold">Total Unidades Vendidas</p>
        <p className="text-3xl font-black mt-1">{resumen.total_unidades}</p>
      </div>
      <div className="bg-emerald-700 text-white rounded-xl p-4 text-center">
        <p className="text-xs text-emerald-100 uppercase tracking-wide font-semibold">Valor Total Mercancía</p>
        <p className="text-3xl font-black mt-1">{formatMoney(resumen.valor_total)}</p>
      </div>
    </div>
  );
}

export default function InventoryAuditModal({ open, onClose, schoolId, date, schoolName }: Props) {
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<AuditView>('consolidado');

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const { data, error: rpcErr } = await supabase.rpc('get_inventory_movement_report', {
        p_school_id: schoolId,
        p_date: date,
      });
      if (rpcErr) throw rpcErr;
      const raw = data as ReportData;
      setReport({
        ...raw,
        consolidado: raw.consolidado ?? [],
        movimientos: raw.movimientos ?? [],
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error al cargar el reporte de auditoría.';
      console.error('[InventoryAudit] RPC error:', err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [schoolId, date]);

  useEffect(() => {
    if (open) {
      setActiveView('consolidado');
      loadReport();
    }
  }, [open, loadReport]);

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) onClose();
  };

  const hasData =
    report &&
    (report.consolidado.length > 0 || report.movimientos.length > 0 || report.resumen.total_unidades > 0);

  const exportPDF = () => {
    if (!report) return;
    exportDetailPDF(report, date, schoolName, schoolId);
  };

  const exportExcel = () => {
    if (!report) return;
    if (activeView === 'consolidado') {
      exportConsolidatedExcel(report, date, schoolName, schoolId);
    } else {
      exportDetailExcel(report, date, schoolName, schoolId);
    }
  };

  const handlePrintWincha = () => {
    if (!report) return;
    printConsolidatedWincha(report, schoolName, schoolId);
  };

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
            {' · Productos registrados como vendidos/consumidos'}
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 mt-2">
          {loading && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
              <p className="text-sm text-gray-500">Consultando base de datos…</p>
            </div>
          )}

          {error && !loading && (
            <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
              <ShieldAlert className="h-5 w-5 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {report && !loading && !hasData && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
              <PackageSearch className="h-12 w-12" />
              <p className="font-medium text-gray-500">Sin movimientos de inventario en esta fecha</p>
              <p className="text-sm">No se registraron ventas o consumos en el sistema.</p>
            </div>
          )}

          {report && !loading && hasData && (
            <Tabs
              value={activeView}
              onValueChange={(v) => setActiveView(v as AuditView)}
              className="space-y-4"
            >
              <TabsList className="grid w-full grid-cols-2 h-10 bg-slate-100 p-1">
                <TabsTrigger
                  value="consolidado"
                  className="gap-1.5 text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-slate-800"
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  Totales Consolidados
                </TabsTrigger>
                <TabsTrigger
                  value="detalle"
                  className="gap-1.5 text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-slate-800"
                >
                  <List className="h-3.5 w-3.5" />
                  Detalle de Tickets
                </TabsTrigger>
              </TabsList>

              <div className="flex gap-2 flex-wrap">
                {activeView === 'consolidado' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handlePrintWincha}
                    className="border-slate-400 text-slate-800 hover:bg-slate-50 font-semibold"
                  >
                    <Printer className="h-4 w-4 mr-1.5" />
                    Imprimir Wincha de Totales
                  </Button>
                )}
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
                  {activeView === 'consolidado' ? 'Excel (Consolidado)' : 'Excel (Filtrable)'}
                </Button>
              </div>

              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-amber-800 text-xs">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                <span>
                  {activeView === 'consolidado' ? (
                    <>
                      <strong>Totales por producto:</strong> agrupación calculada en el servidor.
                      Cruza con inventario físico al cierre del día.
                    </>
                  ) : (
                    <>
                      <strong>Detalle ticket a ticket:</strong> cruza la columna &quot;Hora Exacta&quot; con
                      cámaras de seguridad. El método de pago no afecta este reporte.
                    </>
                  )}
                </span>
              </div>

              <TabsContent value="consolidado" className="mt-0">
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full text-xs border-collapse min-w-[520px]">
                    <thead className="bg-slate-800 text-white">
                      <tr>
                        <th className="px-3 py-2.5 text-left font-semibold">#</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Producto</th>
                        <th className="px-3 py-2.5 text-center font-semibold">Unidades</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Total (S/)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.consolidado.map((line, i) => (
                        <tr
                          key={`${line.producto}-${line.precio_unitario}-${i}`}
                          className={`border-b border-gray-100 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}
                        >
                          <td className="px-3 py-2 text-gray-400 font-mono">{i + 1}</td>
                          <td className="px-3 py-2 font-medium text-gray-800 max-w-[240px] truncate" title={line.producto}>
                            {line.producto}
                          </td>
                          <td className="px-3 py-2 text-center font-bold text-gray-800">{line.cantidad_total}</td>
                          <td className="px-3 py-2 text-right font-black text-slate-800">
                            {formatMoney(line.total_recaudado)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-800 text-white">
                      <tr>
                        <td colSpan={3} className="px-3 py-2.5 font-bold text-right text-sm uppercase">
                          Total general
                        </td>
                        <td className="px-3 py-2.5 text-right font-black text-lg">
                          {formatMoney(report.resumen.valor_total)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </TabsContent>

              <TabsContent value="detalle" className="mt-0">
                <SummaryCards resumen={report.resumen} />
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full text-xs border-collapse min-w-[720px]">
                    <thead className="bg-slate-800 text-white">
                      <tr>
                        <th className="px-3 py-2.5 text-left font-semibold">#</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Hora Exacta</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Ticket</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Tipo</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Producto</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Vendedor</th>
                        <th className="px-3 py-2.5 text-right font-semibold">P. Unit.</th>
                        <th className="px-3 py-2.5 text-center font-semibold">Cant.</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Total Línea</th>
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
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                m.categoria === 'Almuerzo'
                                  ? 'bg-orange-100 text-orange-700'
                                  : 'bg-blue-100 text-blue-700'
                              }`}
                            >
                              {m.categoria}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-medium text-gray-800 max-w-[200px] truncate" title={m.producto}>
                            {m.producto}
                          </td>
                          <td className="px-3 py-2 text-gray-600 max-w-[140px] truncate" title={m.vendedor}>
                            {m.vendedor}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-700">{formatMoney(m.precio_unitario)}</td>
                          <td className="px-3 py-2 text-center font-bold text-gray-800">{m.cantidad}</td>
                          <td className="px-3 py-2 text-right font-black text-slate-800">
                            {formatMoney(m.monto_linea)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-800 text-white">
                      <tr>
                        <td colSpan={6} className="px-3 py-2.5 font-bold text-right text-sm uppercase">
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
              </TabsContent>

              <p className="text-[10px] text-gray-400 text-right">
                Generado: {report.generado_en} · Zona horaria: America/Lima (UTC-5)
              </p>
            </Tabs>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
