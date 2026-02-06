import { useState, useEffect } from 'react';
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  History, 
  Printer, 
  Download,
  Send,
  Calendar,
  Search
} from 'lucide-react';
import { CashClosure } from '@/types/cashRegister';
import { supabase } from '@/lib/supabase';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';

interface Props {
  schoolId: string;
  onClose: () => void;
}

export default function CashHistoryDialog({ schoolId, onClose }: Props) {
  const [closures, setClosures] = useState<CashClosure[]>([]);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));

  const loadClosures = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('cash_closures')
        .select('*, closed_by:profiles!cash_closures_closed_by_fkey(full_name)')
        .eq('school_id', schoolId)
        .gte('closure_date', startDate)
        .lte('closure_date', endDate)
        .order('closure_date', { ascending: false });

      if (error) throw error;

      setClosures(data || []);
    } catch (error) {
      console.error('Error al cargar historial:', error);
      toast.error('Error al cargar el historial');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClosures();
  }, [schoolId, startDate, endDate]);

  const printClosure = (closure: CashClosure) => {
    const content = `
========================================
         REPORTE DE CIERRE DE CAJA
========================================

Fecha: ${format(new Date(closure.closure_date), "dd/MM/yyyy", { locale: es })}
Hora: ${format(new Date(closure.created_at), "HH:mm", { locale: es })}

----------------------------------------
           RESUMEN EJECUTIVO
----------------------------------------
Caja Inicial:       S/ ${closure.initial_amount.toFixed(2)}
Caja Esperada:      S/ ${closure.expected_final.toFixed(2)}
Caja Real:          S/ ${closure.actual_final.toFixed(2)}
Diferencia:         S/ ${closure.difference.toFixed(2)}

----------------------------------------
         VENTAS - PUNTO DE VENTA
----------------------------------------
Efectivo:           S/ ${closure.pos_cash.toFixed(2)}
Tarjeta:            S/ ${closure.pos_card.toFixed(2)}
Yape:               S/ ${closure.pos_yape.toFixed(2)}
Yape QR:            S/ ${closure.pos_yape_qr.toFixed(2)}
Crédito:            S/ ${closure.pos_credit.toFixed(2)}
              ─────────────────────
TOTAL POS:          S/ ${closure.pos_total.toFixed(2)}

----------------------------------------
             VENTAS - ALMUERZOS
----------------------------------------
Efectivo:           S/ ${closure.lunch_cash.toFixed(2)}
Tarjeta:            S/ ${closure.lunch_card.toFixed(2)}
Yape:               S/ ${closure.lunch_yape.toFixed(2)}
Crédito:            S/ ${closure.lunch_credit.toFixed(2)}
              ─────────────────────
TOTAL ALMUERZOS:    S/ ${closure.lunch_total.toFixed(2)}

----------------------------------------
           RESUMEN POR MÉTODO
----------------------------------------
Efectivo Total:     S/ ${closure.total_cash.toFixed(2)}
Tarjeta Total:      S/ ${closure.total_card.toFixed(2)}
Yape Total:         S/ ${closure.total_yape.toFixed(2)}
Yape QR:            S/ ${closure.total_yape_qr.toFixed(2)}
Crédito Total:      S/ ${closure.total_credit.toFixed(2)}

----------------------------------------
             MOVIMIENTOS
----------------------------------------
Ingresos:           S/ ${closure.total_ingresos.toFixed(2)}
Egresos:            S/ ${closure.total_egresos.toFixed(2)}

========================================
TOTAL VENTAS:       S/ ${closure.total_sales.toFixed(2)}
========================================

Responsable del Cierre: ${(closure as any).closed_by?.full_name || 'N/A'}

========================================
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write('<html><head><title>Cierre de Caja</title>');
      printWindow.document.write('<style>');
      printWindow.document.write('body { font-family: monospace; width: 80mm; margin: 0; padding: 10mm; }');
      printWindow.document.write('pre { white-space: pre-wrap; word-wrap: break-word; font-size: 12px; }');
      printWindow.document.write('</style></head><body>');
      printWindow.document.write('<pre>' + content + '</pre>');
      printWindow.document.write('</body></html>');
      printWindow.document.close();
      printWindow.print();
    }
  };

  const exportToExcel = async (closure: CashClosure) => {
    // Implementación simplificada - en producción usar una librería como xlsx
    const csvContent = `
Reporte de Cierre de Caja
Fecha,${format(new Date(closure.closure_date), "dd/MM/yyyy", { locale: es })}

Concepto,Monto
Caja Inicial,${closure.initial_amount}
Efectivo Recibido,${closure.total_cash}
Ingresos,${closure.total_ingresos}
Egresos,${closure.total_egresos}
Caja Esperada,${closure.expected_final}
Caja Real,${closure.actual_final}
Diferencia,${closure.difference}

Punto de Venta
Efectivo,${closure.pos_cash}
Tarjeta,${closure.pos_card}
Yape,${closure.pos_yape}
Yape QR,${closure.pos_yape_qr}
Crédito,${closure.pos_credit}
Total POS,${closure.pos_total}

Almuerzos
Efectivo,${closure.lunch_cash}
Tarjeta,${closure.lunch_card}
Yape,${closure.lunch_yape}
Crédito,${closure.lunch_credit}
Total Almuerzos,${closure.lunch_total}

TOTAL VENTAS,${closure.total_sales}
    `;

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `cierre_${format(new Date(closure.closure_date), 'yyyy-MM-dd')}.csv`;
    link.click();

    toast.success('Archivo exportado exitosamente');
  };

  const sendToWhatsApp = (closure: CashClosure) => {
    const phone = closure.whatsapp_phone || '991236870';
    const message = `
*CIERRE DE CAJA* 📊
*Fecha:* ${format(new Date(closure.closure_date), "dd/MM/yyyy", { locale: es })}

*RESUMEN:*
💰 Caja Esperada: S/ ${closure.expected_final.toFixed(2)}
💵 Caja Real: S/ ${closure.actual_final.toFixed(2)}
${closure.difference !== 0 ? `⚠️ Diferencia: S/ ${closure.difference.toFixed(2)}` : '✅ Sin diferencias'}

*VENTAS:*
📦 POS: S/ ${closure.pos_total.toFixed(2)}
🍽️ Almuerzos: S/ ${closure.lunch_total.toFixed(2)}
💰 TOTAL: S/ ${closure.total_sales.toFixed(2)}

*MÉTODOS DE PAGO:*
💵 Efectivo: S/ ${closure.total_cash.toFixed(2)}
💳 Tarjeta: S/ ${closure.total_card.toFixed(2)}
📱 Yape: S/ ${closure.total_yape.toFixed(2)}
    `.trim();

    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/${phone}?text=${encodedMessage}`;
    window.open(whatsappUrl, '_blank');

    toast.success('Abriendo WhatsApp...');
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Historial de Cierres
          </DialogTitle>
          <DialogDescription>
            Consulta los cierres de caja realizados
          </DialogDescription>
        </DialogHeader>

        {/* Filtros */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <Label htmlFor="start">Fecha Inicio</Label>
            <Input
              id="start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="end">Fecha Fin</Label>
            <Input
              id="end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button onClick={loadClosures} className="w-full">
              <Search className="h-4 w-4 mr-2" />
              Buscar
            </Button>
          </div>
        </div>

        {/* Lista de cierres */}
        {loading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Cargando historial...</p>
          </div>
        ) : closures.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Calendar className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No hay cierres en el rango seleccionado</p>
          </div>
        ) : (
          <div className="space-y-3">
            {closures.map((closure) => (
              <Card key={closure.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-bold text-lg">
                          {format(new Date(closure.closure_date), "dd MMM yyyy", { locale: es })}
                        </span>
                        {Math.abs(closure.difference) < 0.01 ? (
                          <Badge className="bg-green-600">Sin diferencias</Badge>
                        ) : (
                          <Badge variant="destructive">
                            Ajuste: S/ {Math.abs(closure.difference).toFixed(2)}
                          </Badge>
                        )}
                      </div>
                      
                      <div className="grid grid-cols-3 gap-4 text-sm mb-2">
                        <div>
                          <p className="text-muted-foreground">Ventas POS</p>
                          <p className="font-semibold">S/ {closure.pos_total.toFixed(2)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Almuerzos</p>
                          <p className="font-semibold">S/ {closure.lunch_total.toFixed(2)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Total</p>
                          <p className="font-semibold text-primary">S/ {closure.total_sales.toFixed(2)}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <div>Efectivo: S/ {closure.total_cash.toFixed(2)}</div>
                        <div>Tarjeta: S/ {closure.total_card.toFixed(2)}</div>
                        <div>Yape: S/ {closure.total_yape.toFixed(2)}</div>
                        <div>Crédito: S/ {closure.total_credit.toFixed(2)}</div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 ml-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => printClosure(closure)}
                      >
                        <Printer className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => exportToExcel(closure)}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => sendToWhatsApp(closure)}
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
