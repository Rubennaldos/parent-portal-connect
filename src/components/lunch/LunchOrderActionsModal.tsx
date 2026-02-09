import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle2, XCircle, Clock, Loader2, AlertCircle } from 'lucide-react';

interface LunchOrderActionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: any;
  onSuccess: () => void;
  canModify: boolean;
}

type ActionType = 'deliver' | 'cancel' | 'postpone' | null;

export function LunchOrderActionsModal({ 
  isOpen, 
  onClose, 
  order, 
  onSuccess, 
  canModify 
}: LunchOrderActionsModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [selectedAction, setSelectedAction] = useState<ActionType>(null);
  const [reason, setReason] = useState('');

  const handleAction = async () => {
    if (!selectedAction) return;

    // Validar que se ingrese razón para cancelar o postergar
    if ((selectedAction === 'cancel' || selectedAction === 'postpone') && !reason.trim()) {
      toast({
        variant: 'destructive',
        title: 'Campo requerido',
        description: 'Debes ingresar una justificación.',
      });
      return;
    }

    // 🔔 ADVERTENCIA 2: Si se marca como entregado fuera de la fecha del pedido
    if (selectedAction === 'deliver') {
      const orderDate = new Date(order.order_date);
      const today = new Date();
      
      // Normalizar fechas (solo comparar día/mes/año, sin hora)
      orderDate.setHours(0, 0, 0, 0);
      today.setHours(0, 0, 0, 0);
      
      if (orderDate.getTime() !== today.getTime()) {
        const orderFormatted = orderDate.toLocaleDateString('es-PE', { 
          weekday: 'long', 
          day: '2-digit', 
          month: 'long', 
          year: 'numeric' 
        });
        const todayFormatted = today.toLocaleDateString('es-PE', { 
          weekday: 'long', 
          day: '2-digit', 
          month: 'long', 
          year: 'numeric' 
        });
        
        const confirmDeliver = window.confirm(
          `⚠️ ADVERTENCIA: El pedido es para el ${orderFormatted}, pero hoy es ${todayFormatted}.\n\n¿Está seguro que desea entregar este pedido fuera de su fecha?`
        );
        
        if (!confirmDeliver) {
          return; // Usuario canceló
        }
      }
    }

    setLoading(true);

    try {
      console.log(`📦 Ejecutando acción: ${selectedAction}`);

      let updateData: any = {};
      
      switch (selectedAction) {
        case 'deliver':
          updateData = {
            status: 'delivered',
            delivered_at: new Date().toISOString(),
            delivered_by: user?.id
          };
          break;
        
        case 'cancel':
          updateData = {
            status: 'cancelled',
            cancelled_at: new Date().toISOString(),
            cancelled_by: user?.id,
            cancellation_reason: reason.trim()
          };
          break;
        
        case 'postpone':
          updateData = {
            status: 'postponed',
            postponed_at: new Date().toISOString(),
            postponed_by: user?.id,
            postponement_reason: reason.trim()
          };
          break;
      }

      const { error } = await supabase
        .from('lunch_orders')
        .update(updateData)
        .eq('id', order.id);

      if (error) throw error;

      // Si se cancela, revertir la transacción asociada
      if (selectedAction === 'cancel') {
        console.log('💰 Revirtiendo transacción del pedido cancelado...');
        
        // Buscar la transacción original del pedido
        const { data: originalTransaction, error: searchError } = await supabase
          .from('transactions')
          .select('amount')
          .eq(order.student_id ? 'student_id' : 'teacher_id', order.student_id || order.teacher_id)
          .eq('type', 'purchase')
          .ilike('description', `%${order.order_date}%`)
          .maybeSingle();

        if (searchError) {
          console.error('⚠️ Error buscando transacción original:', searchError);
        }

        if (originalTransaction) {
          // Crear transacción de reversión (monto positivo)
          const refundAmount = Math.abs(originalTransaction.amount);
          
          const { error: transactionError } = await supabase
            .from('transactions')
            .insert({
              student_id: order.student_id,
              teacher_id: order.teacher_id,
              type: 'refund',
              amount: refundAmount, // Monto positivo (devolución)
              description: `Anulación de almuerzo - ${order.order_date}`,
              payment_method: 'adjustment',
              school_id: order.student?.school_id || order.school_id
            });

          if (transactionError) {
            console.error('⚠️ Error creando transacción de reversión:', transactionError);
          } else {
            console.log('✅ Transacción revertida correctamente');
          }
        } else {
          console.warn('⚠️ No se encontró transacción original para revertir');
        }
      }

      const actionMessages = {
        deliver: '✅ Almuerzo entregado',
        cancel: '❌ Pedido anulado',
        postpone: '⏰ Pedido postergado'
      };

      toast({
        title: actionMessages[selectedAction],
        description: 'La acción se completó exitosamente.',
      });

      onSuccess();
    } catch (error: any) {
      console.error('❌ Error ejecutando acción:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo completar la acción.',
      });
    } finally {
      setLoading(false);
    }
  };

  const getActionColor = (action: ActionType) => {
    switch (action) {
      case 'deliver':
        return 'bg-green-600 hover:bg-green-700';
      case 'cancel':
        return 'bg-red-600 hover:bg-red-700';
      case 'postpone':
        return 'bg-yellow-600 hover:bg-yellow-700';
      default:
        return 'bg-gray-600 hover:bg-gray-700';
    }
  };

  const getActionIcon = (action: ActionType) => {
    switch (action) {
      case 'deliver':
        return <CheckCircle2 className="h-4 w-4" />;
      case 'cancel':
        return <XCircle className="h-4 w-4" />;
      case 'postpone':
        return <Clock className="h-4 w-4" />;
      default:
        return null;
    }
  };

  const getActionLabel = (action: ActionType) => {
    switch (action) {
      case 'deliver':
        return 'Marcar como Entregado';
      case 'cancel':
        return 'Anular Pedido';
      case 'postpone':
        return 'Postergar Pedido';
      default:
        return '';
    }
  };

  const canCancelOrPostpone = canModify && order.status !== 'delivered' && order.status !== 'cancelled';
  const canDeliver = order.status === 'confirmed' || order.status === 'postponed';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Acciones del Pedido</DialogTitle>
          <DialogDescription>
            {order.student?.full_name || order.teacher?.full_name} - {order.order_date}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Estado actual */}
          <div className="bg-gray-50 p-3 rounded-lg space-y-3">
            <div>
              <p className="text-sm text-gray-600 mb-1">Estado actual:</p>
              <p className="font-semibold text-gray-900">
                {order.status === 'confirmed' && '✅ Confirmado'}
                {order.status === 'delivered' && '📦 Entregado'}
                {order.status === 'cancelled' && '❌ Anulado'}
                {order.status === 'postponed' && '⏰ Postergado'}
                {order.status === 'pending_payment' && '💳 Pendiente de pago'}
              </p>
              {order.is_no_order_delivery && (
                <p className="text-sm text-orange-600 mt-1">
                  ⚠️ Entrega sin pedido previo (con deuda)
                </p>
              )}
            </div>

            {/* Mostrar agregados si existen */}
            {order.lunch_order_addons && order.lunch_order_addons.length > 0 && (
              <div className="pt-2 border-t">
                <p className="text-sm text-gray-600 mb-1">Agregados:</p>
                <ul className="space-y-1">
                  {order.lunch_order_addons.map((addon: any) => (
                    <li key={addon.id} className="text-sm flex justify-between">
                      <span>• {addon.addon_name} {addon.quantity > 1 ? `x${addon.quantity}` : ''}</span>
                      <span className="font-semibold text-green-600">S/ {addon.addon_price.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Mostrar precios si están disponibles */}
            {order.final_price !== null && order.final_price !== undefined && (
              <div className="pt-2 border-t space-y-1">
                {order.base_price !== null && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Precio base:</span>
                    <span>S/ {order.base_price.toFixed(2)}</span>
                  </div>
                )}
                {order.addons_total !== null && order.addons_total > 0 && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Agregados:</span>
                    <span>+ S/ {order.addons_total.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold pt-1 border-t">
                  <span>Total:</span>
                  <span className="text-green-600">S/ {order.final_price.toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Restricción horaria */}
          {!canModify && (
            <div className="bg-red-50 p-3 rounded-lg flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-red-800">
                <p className="font-semibold">Restricción horaria</p>
                <p>
                  Ya pasaron las 9:00 AM. Solo puedes marcar como entregado, 
                  pero no puedes postergar ni anular.
                </p>
              </div>
            </div>
          )}

          {/* Selección de acción */}
          {!selectedAction ? (
            <div className="space-y-2">
              <Label>Selecciona una acción:</Label>
              
              {/* Entregar */}
              {canDeliver && (
                <Button
                  onClick={() => setSelectedAction('deliver')}
                  className="w-full justify-start bg-green-600 hover:bg-green-700"
                  disabled={loading}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Marcar como Entregado
                </Button>
              )}

              {/* Postergar */}
              {canCancelOrPostpone && (
                <Button
                  onClick={() => setSelectedAction('postpone')}
                  className="w-full justify-start bg-yellow-600 hover:bg-yellow-700"
                  disabled={loading}
                >
                  <Clock className="h-4 w-4 mr-2" />
                  Postergar Pedido
                </Button>
              )}

              {/* Anular */}
              {canCancelOrPostpone && (
                <Button
                  onClick={() => setSelectedAction('cancel')}
                  className="w-full justify-start bg-red-600 hover:bg-red-700"
                  disabled={loading}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Anular Pedido
                </Button>
              )}
            </div>
          ) : (
            /* Formulario de confirmación */
            <div className="space-y-4">
              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-sm text-gray-600 mb-1">Acción seleccionada:</p>
                <p className="font-semibold text-gray-900">
                  {getActionLabel(selectedAction)}
                </p>
              </div>

              {/* Justificación (solo para cancelar o postergar) */}
              {(selectedAction === 'cancel' || selectedAction === 'postpone') && (
                <div>
                  <Label htmlFor="reason">
                    Justificación <span className="text-red-500">*</span>
                  </Label>
                  <Textarea
                    id="reason"
                    placeholder="Explica el motivo..."
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    disabled={loading}
                    rows={3}
                  />
                </div>
              )}

              {/* Botones */}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSelectedAction(null);
                    setReason('');
                  }}
                  disabled={loading}
                >
                  Atrás
                </Button>
                <Button
                  onClick={handleAction}
                  disabled={loading}
                  className={getActionColor(selectedAction)}
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Procesando...
                    </>
                  ) : (
                    <>
                      {getActionIcon(selectedAction)}
                      <span className="ml-2">Confirmar</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Botón cerrar */}
          {!selectedAction && (
            <div className="flex justify-end pt-2">
              <Button variant="outline" onClick={onClose} disabled={loading}>
                Cerrar
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
