import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { initiatePayment } from '@/services/paymentService';
import { YapeLogo } from '@/components/ui/YapeLogo';
import { PlinLogo } from '@/components/ui/PlinLogo';
import { 
  CreditCard, 
  Building2, 
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Calendar
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface PayDebtModalProps {
  isOpen: boolean;
  onClose: () => void;
  studentName: string;
  studentId: string;
  onPaymentComplete: () => void;
  selectedTransactionIds?: string[]; // IDs de transacciones seleccionadas
}

interface Transaction {
  id: string;
  created_at: string;
  amount: number;
  description: string;
  ticket_number: string;
}

export function PayDebtModal({
  isOpen,
  onClose,
  studentName,
  studentId,
  onPaymentComplete,
  selectedTransactionIds
}: PayDebtModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [totalDebt, setTotalDebt] = useState(0);
  const [selectedMethod, setSelectedMethod] = useState<'card' | 'yape' | 'plin'>('card');

  useEffect(() => {
    if (isOpen && studentId) {
      fetchDebtData();
    }
  }, [isOpen, studentId, selectedTransactionIds]);

  const fetchDebtData = async () => {
    try {
      setLoading(true);
      
      // Si hay transacciones seleccionadas, solo cargar esas
      if (selectedTransactionIds && selectedTransactionIds.length > 0) {
        const { data, error } = await supabase
          .from('transactions')
          .select('*')
          .in('id', selectedTransactionIds)
          .eq('student_id', studentId)
          .eq('payment_status', 'pending')
          .eq('type', 'purchase')
          .order('created_at', { ascending: false });

        if (error) throw error;

        const trans = data || [];
        setTransactions(trans);
        
        // Calcular deuda total
        const total = trans.reduce((sum, t) => sum + Math.abs(t.amount), 0);
        setTotalDebt(total);
      } else {
        // Si no hay selección, cargar todas las transacciones pendientes (comportamiento anterior)
        const { data, error } = await supabase
          .from('transactions')
          .select('*')
          .eq('student_id', studentId)
          .eq('payment_status', 'pending')
          .eq('type', 'purchase')
          .order('created_at', { ascending: false });

        if (error) throw error;

        const trans = data || [];
        setTransactions(trans);
        
        // Calcular deuda total
        const total = trans.reduce((sum, t) => sum + Math.abs(t.amount), 0);
        setTotalDebt(total);
      }

    } catch (error: any) {
      console.error('Error fetching debt:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo cargar la información de deudas',
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePayment = async () => {
    if (!user) return;

    setProcessing(true);

    try {
      // Iniciar pago con la pasarela
      const result = await initiatePayment({
        amount: totalDebt,
        currency: 'PEN',
        description: `Pago de deudas - ${studentName}`,
        student_id: studentId,
        parent_id: user.id,
        payment_method: selectedMethod,
      });

      if (result.success && result.payment_url) {
        // Redirigir a la pasarela de pagos
        window.location.href = result.payment_url;
      } else {
        throw new Error(result.error || 'Error al procesar el pago');
      }

    } catch (error: any) {
      console.error('Error processing payment:', error);
      toast({
        variant: 'destructive',
        title: 'Error al procesar pago',
        description: error.message || 'Intente nuevamente',
      });
    } finally {
      setProcessing(false);
    }
  };

  const paymentMethods = [
    {
      id: 'card',
      name: 'Tarjeta de Crédito/Débito',
      icon: CreditCard,
      customIcon: null,
      color: 'blue',
      description: 'Visa, Mastercard, Amex',
      gateway: 'niubiz'
    },
    {
      id: 'yape',
      name: 'Yape',
      icon: null,
      customIcon: YapeLogo,
      color: 'purple',
      description: 'Pago instantáneo',
      gateway: 'izipay'
    },
    {
      id: 'plin',
      name: 'Plin',
      icon: null,
      customIcon: PlinLogo,
      color: 'green',
      description: 'Pago instantáneo',
      gateway: 'izipay'
    }
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Pagar Deudas</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            <p className="ml-3 text-gray-600">Cargando información...</p>
          </div>
        ) : (
          <>
            {/* Información del estudiante */}
            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Estudiante</p>
                    <p className="font-bold text-lg">{studentName}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-600">Total a Pagar</p>
                    <p className="text-3xl font-bold text-red-600">
                      S/ {totalDebt.toFixed(2)}
                    </p>
                    <Badge variant="destructive">
                      {transactions.length} consumo(s)
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Desglose de consumos */}
            {transactions.length > 0 && (
              <div className="space-y-2">
                <h3 className="font-semibold flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Detalles de Consumos
                </h3>
                <div className="max-h-40 overflow-y-auto space-y-2">
                  {transactions.map((t, idx) => (
                    <Card key={t.id} className="border-l-4 border-l-red-500">
                      <CardContent className="p-3">
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-sm font-semibold">#{idx + 1} - {t.description || 'Consumo'}</p>
                            <p className="text-xs text-gray-500">
                              {format(new Date(t.created_at), "dd/MM/yyyy 'a las' HH:mm", { locale: es })}
                            </p>
                          </div>
                          <p className="font-bold text-red-600">
                            S/ {Math.abs(t.amount).toFixed(2)}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {transactions.length === 0 ? (
              <Card className="bg-green-50 border-green-200">
                <CardContent className="py-12 text-center">
                  <CheckCircle2 className="h-16 w-16 mx-auto mb-4 text-green-500" />
                  <h3 className="text-lg font-semibold text-gray-700 mb-2">
                    ¡Sin deudas pendientes!
                  </h3>
                  <p className="text-gray-500">
                    Todos los consumos están al día
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Métodos de pago */}
                <div className="space-y-3">
                  <h3 className="font-semibold flex items-center gap-2">
                    <CreditCard className="h-4 w-4" />
                    Método de Pago
                  </h3>
                  <div className="grid grid-cols-1 gap-3">
                    {paymentMethods.map((method) => {
                      const Icon = method.icon;
                      const CustomIcon = method.customIcon;
                      const isSelected = selectedMethod === method.id;

                      return (
                        <button
                          key={method.id}
                          onClick={() => setSelectedMethod(method.id as any)}
                          className={`
                            w-full p-4 rounded-xl border-2 transition-all text-left
                            ${isSelected ? 'border-blue-500 bg-blue-50 shadow-lg' : 'border-gray-200 hover:border-gray-300'}
                          `}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className={`w-12 h-12 rounded-lg bg-white flex items-center justify-center`}>
                                {CustomIcon ? (
                                  <CustomIcon className="w-10 h-10" />
                                ) : Icon ? (
                                  <Icon className={`h-6 w-6 text-${method.color}-600`} />
                                ) : null}
                              </div>
                              <div>
                                <p className="font-semibold text-gray-900">{method.name}</p>
                                <p className="text-xs text-gray-500">{method.description}</p>
                              </div>
                            </div>
                            {isSelected && (
                              <CheckCircle2 className="h-6 w-6 text-blue-600" />
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Botón de pago */}
                <div className="space-y-3">
                  <Button
                    onClick={handlePayment}
                    disabled={processing}
                    className="w-full h-14 text-lg bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                  >
                    {processing ? (
                      <>
                        <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                        Procesando...
                      </>
                    ) : (
                      <>
                        <ExternalLink className="h-5 w-5 mr-2" />
                        Proceder al Pago (S/ {totalDebt.toFixed(2)})
                      </>
                    )}
                  </Button>
                  
                  <p className="text-xs text-center text-gray-500">
                    🔒 Pago seguro procesado por {paymentMethods.find(m => m.id === selectedMethod)?.gateway.toUpperCase()}. 
                    Serás redirigido a la pasarela de pagos.
                  </p>
                </div>
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
