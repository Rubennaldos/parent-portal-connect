import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { 
  TrendingUp, 
  TrendingDown, 
  Plus, 
  Printer, 
  FileText,
  CheckCircle
} from 'lucide-react';
import { CashRegister, CashMovement } from '@/types/cashRegister';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';

interface Props {
  cashRegister: CashRegister;
  movements: CashMovement[];
  onMovementAdded: () => void;
}

export default function CashMovements({ cashRegister, movements, onMovementAdded }: Props) {
  const { user, profile } = useAuth();
  const [showDialog, setShowDialog] = useState(false);
  const [movementType, setMovementType] = useState<'ingreso' | 'egreso'>('ingreso');
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    amount: '',
    reason: '',
    responsible_name: profile?.full_name || '',
  });

  // Abrir dialog
  const openDialog = (type: 'ingreso' | 'egreso') => {
    setMovementType(type);
    setFormData({
      amount: '',
      reason: '',
      responsible_name: profile?.full_name || '',
    });
    setShowDialog(true);
  };

  // Registrar movimiento
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile?.school_id) return;

    const amount = parseFloat(formData.amount);
    if (isNaN(amount) || amount <= 0) {
      toast.error('Ingresa un monto válido');
      return;
    }

    if (!formData.reason.trim()) {
      toast.error('Ingresa el motivo');
      return;
    }

    if (!formData.responsible_name.trim()) {
      toast.error('Ingresa el nombre del responsable');
      return;
    }

    try {
      setLoading(true);

      const { error } = await supabase
        .from('cash_movements')
        .insert({
          cash_register_id: cashRegister.id,
          school_id: profile.school_id,
          type: movementType,
          amount,
          reason: formData.reason,
          responsible_name: formData.responsible_name,
          responsible_id: user.id,
          created_by: user.id,
          requires_signature: true,
          signature_validated: false,
          voucher_printed: false,
        });

      if (error) throw error;

      toast.success(`${movementType === 'ingreso' ? 'Ingreso' : 'Egreso'} registrado exitosamente`);
      setShowDialog(false);
      onMovementAdded();
    } catch (error) {
      console.error('Error al registrar movimiento:', error);
      toast.error('Error al registrar el movimiento');
    } finally {
      setLoading(false);
    }
  };

  // Imprimir comprobante
  const printVoucher = async (movement: CashMovement) => {
    try {
      // Generar contenido del comprobante
      const content = `
        ========================================
        ${movement.type === 'ingreso' ? '📥 COMPROBANTE DE INGRESO' : '📤 COMPROBANTE DE EGRESO'}
        ========================================
        
        Fecha: ${format(new Date(movement.created_at), "dd/MM/yyyy HH:mm", { locale: es })}
        
        Monto: S/ ${movement.amount.toFixed(2)}
        
        Motivo:
        ${movement.reason}
        
        Responsable:
        ${movement.responsible_name}
        
        ----------------------------------------
        
        Firma: _______________________________
        
        
        ========================================
        GUARDAR ESTE COMPROBANTE
        ========================================
      `;

      // Abrir ventana de impresión
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write('<html><head><title>Comprobante</title>');
        printWindow.document.write('<style>');
        printWindow.document.write('body { font-family: monospace; width: 80mm; margin: 0; padding: 10mm; }');
        printWindow.document.write('pre { white-space: pre-wrap; word-wrap: break-word; }');
        printWindow.document.write('</style></head><body>');
        printWindow.document.write('<pre>' + content + '</pre>');
        printWindow.document.write('</body></html>');
        printWindow.document.close();
        printWindow.print();
      }

      // Marcar como impreso
      await supabase
        .from('cash_movements')
        .update({ voucher_printed: true })
        .eq('id', movement.id);

      onMovementAdded();
      toast.success('Comprobante impreso');
    } catch (error) {
      console.error('Error al imprimir:', error);
      toast.error('Error al imprimir comprobante');
    }
  };

  const totalIngresos = movements
    .filter(m => m.type === 'ingreso')
    .reduce((sum, m) => sum + m.amount, 0);

  const totalEgresos = movements
    .filter(m => m.type === 'egreso')
    .reduce((sum, m) => sum + m.amount, 0);

  return (
    <div className="space-y-6">
      {/* Resumen */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Ingresos</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              S/ {totalIngresos.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {movements.filter(m => m.type === 'ingreso').length} registros
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Egresos</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              S/ {totalEgresos.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {movements.filter(m => m.type === 'egreso').length} registros
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Botones de acción */}
      <div className="flex gap-3">
        <Button
          onClick={() => openDialog('ingreso')}
          className="flex-1"
          variant="outline"
        >
          <TrendingUp className="h-4 w-4 mr-2" />
          Registrar Ingreso
        </Button>
        <Button
          onClick={() => openDialog('egreso')}
          className="flex-1"
          variant="outline"
        >
          <TrendingDown className="h-4 w-4 mr-2" />
          Registrar Egreso
        </Button>
      </div>

      {/* Lista de movimientos */}
      <Card>
        <CardHeader>
          <CardTitle>Movimientos del Día</CardTitle>
          <CardDescription>
            Registro completo de ingresos y egresos
          </CardDescription>
        </CardHeader>
        <CardContent>
          {movements.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No hay movimientos registrados</p>
            </div>
          ) : (
            <div className="space-y-3">
              {movements.map((movement) => (
                <div
                  key={movement.id}
                  className={`p-4 rounded-lg border ${
                    movement.type === 'ingreso'
                      ? 'bg-green-50 dark:bg-green-950/20 border-green-200'
                      : 'bg-red-50 dark:bg-red-950/20 border-red-200'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant={movement.type === 'ingreso' ? 'default' : 'destructive'}
                          className={movement.type === 'ingreso' ? 'bg-green-600' : ''}
                        >
                          {movement.type === 'ingreso' ? (
                            <TrendingUp className="h-3 w-3 mr-1" />
                          ) : (
                            <TrendingDown className="h-3 w-3 mr-1" />
                          )}
                          {movement.type === 'ingreso' ? 'INGRESO' : 'EGRESO'}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(movement.created_at), "dd MMM yyyy, HH:mm", { locale: es })}
                        </span>
                      </div>
                      <p className="font-semibold text-lg mb-1">
                        S/ {movement.amount.toFixed(2)}
                      </p>
                      <p className="text-sm text-muted-foreground mb-2">
                        <span className="font-medium">Motivo:</span> {movement.reason}
                      </p>
                      <p className="text-sm">
                        <span className="font-medium">Responsable:</span> {movement.responsible_name}
                      </p>
                      {movement.voucher_printed && (
                        <div className="mt-2 flex items-center gap-1 text-xs text-green-600">
                          <CheckCircle className="h-3 w-3" />
                          Comprobante impreso
                        </div>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => printVoucher(movement)}
                      className="ml-3"
                    >
                      <Printer className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog para registrar movimiento */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {movementType === 'ingreso' ? (
                <span className="flex items-center gap-2 text-green-600">
                  <TrendingUp className="h-5 w-5" />
                  Registrar Ingreso
                </span>
              ) : (
                <span className="flex items-center gap-2 text-red-600">
                  <TrendingDown className="h-5 w-5" />
                  Registrar Egreso
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              Completa la información del {movementType}. Se generará un comprobante para imprimir.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="amount">Monto (S/)</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                required
              />
            </div>

            <div>
              <Label htmlFor="reason">Motivo</Label>
              <Textarea
                id="reason"
                placeholder="Describe el motivo del movimiento..."
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                rows={3}
                required
              />
            </div>

            <div>
              <Label htmlFor="responsible">Nombre del Responsable</Label>
              <Input
                id="responsible"
                type="text"
                placeholder="Nombre completo"
                value={formData.responsible_name}
                onChange={(e) => setFormData({ ...formData, responsible_name: e.target.value })}
                required
              />
              <p className="text-xs text-muted-foreground mt-1">
                Persona que {movementType === 'ingreso' ? 'entrega' : 'recibe'} el dinero
              </p>
            </div>

            <div className="flex gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowDialog(false)}
                className="flex-1"
                disabled={loading}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={loading}
              >
                {loading ? (
                  'Registrando...'
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Registrar
                  </>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
