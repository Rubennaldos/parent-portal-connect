import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CreditCard, Check, Clock, Receipt } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { PayDebtModal } from './PayDebtModal';

interface PendingTransaction {
  id: string;
  student_id: string;
  student_name: string;
  amount: number;
  description: string;
  created_at: string;
  ticket_code?: string;
}

interface StudentDebt {
  student_id: string;
  student_name: string;
  student_photo: string | null;
  total_debt: number;
  pending_transactions: PendingTransaction[];
}

interface PaymentsTabProps {
  userId: string;
}

export const PaymentsTab = ({ userId }: PaymentsTabProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [debts, setDebts] = useState<StudentDebt[]>([]);
  const [selectedTransactions, setSelectedTransactions] = useState<Set<string>>(new Set());
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [selectedStudentForPayment, setSelectedStudentForPayment] = useState<{ id: string, name: string } | null>(null);

  useEffect(() => {
    fetchDebts();
  }, [userId]);

  const fetchDebts = async () => {
    try {
      setLoading(true);

      // Obtener todos los estudiantes del padre con cuenta libre
      const { data: students, error: studentsError } = await supabase
        .from('students')
        .select('id, full_name, photo_url, free_account, school_id')
        .eq('parent_id', userId)
        .eq('free_account', true)
        .eq('is_active', true);

      if (studentsError) throw studentsError;

      if (!students || students.length === 0) {
        setDebts([]);
        return;
      }

      // Para cada estudiante, obtener sus transacciones pendientes
      const debtsData: StudentDebt[] = [];

      for (const student of students) {
        // ✅ Obtener delay configurado para la sede del estudiante
        const { data: delayData } = await supabase
          .from('purchase_visibility_delay')
          .select('delay_days')
          .eq('school_id', student.school_id)
          .maybeSingle();

        const delayDays = delayData?.delay_days ?? 2;
        
        // ✅ Construir query base
        let query = supabase
          .from('transactions')
          .select('*')
          .eq('student_id', student.id)
          .eq('type', 'purchase')
          .eq('payment_status', 'pending');

        // ✅ Solo aplicar filtro de fecha si delay > 0
        if (delayDays > 0) {
          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - delayDays);
          const cutoffDateISO = cutoffDate.toISOString();
          
          console.log('📅 Filtro de delay aplicado (Pagos):', {
            studentName: student.full_name,
            schoolId: student.school_id,
            delayDays,
            hoy: new Date().toLocaleString('es-PE'),
            cutoffDate: cutoffDate.toLocaleString('es-PE'),
            cutoffDateISO,
            message: `Solo compras HASTA ${cutoffDate.toLocaleDateString('es-PE')}`
          });

          query = query.lte('created_at', cutoffDateISO);
        } else {
          console.log('⚡ Modo EN VIVO (Pagos) - Sin filtro de delay:', {
            studentName: student.full_name,
            schoolId: student.school_id,
            message: 'Mostrando TODAS las compras pendientes'
          });
        }

        // ✅ Ejecutar query
        const { data: transactions, error: transError } = await query
          .order('created_at', { ascending: false });

        if (transError) throw transError;
        
        console.log('💰 Transacciones obtenidas:', {
          studentName: student.full_name,
          cantidadTransacciones: transactions?.length || 0,
          transacciones: transactions?.map(t => ({
            fecha: new Date(t.created_at).toLocaleString('es-PE'),
            monto: t.amount,
            descripcion: t.description
          }))
        });

        if (transactions && transactions.length > 0) {
          const totalDebt = transactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);

          debtsData.push({
            student_id: student.id,
            student_name: student.full_name,
            student_photo: student.photo_url,
            total_debt: totalDebt,
            pending_transactions: transactions.map(t => ({
              id: t.id,
              student_id: t.student_id,
              student_name: student.full_name,
              amount: Math.abs(t.amount),
              description: t.description,
              created_at: t.created_at,
              ticket_code: t.ticket_code,
            })),
          });
        }
      }

      setDebts(debtsData);
    } catch (error: any) {
      console.error('Error fetching debts:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar las deudas pendientes',
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleTransaction = (transactionId: string) => {
    setSelectedTransactions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(transactionId)) {
        newSet.delete(transactionId);
      } else {
        newSet.add(transactionId);
      }
      return newSet;
    });
  };

  const toggleSelectAll = (studentDebt: StudentDebt) => {
    const allSelected = studentDebt.pending_transactions.every(t => selectedTransactions.has(t.id));
    
    setSelectedTransactions(prev => {
      const newSet = new Set(prev);
      studentDebt.pending_transactions.forEach(t => {
        if (allSelected) {
          newSet.delete(t.id);
        } else {
          newSet.add(t.id);
        }
      });
      return newSet;
    });
  };

  const getSelectedAmount = () => {
    let total = 0;
    debts.forEach(debt => {
      debt.pending_transactions.forEach(t => {
        if (selectedTransactions.has(t.id)) {
          total += t.amount;
        }
      });
    });
    return total;
  };

  const handlePaySelected = () => {
    const amount = getSelectedAmount();
    if (amount <= 0) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Selecciona al menos una transacción para pagar',
      });
      return;
    }
    // Encontrar el primer estudiante con transacciones seleccionadas
    const firstDebt = debts.find(d => 
      d.pending_transactions.some(t => selectedTransactions.has(t.id))
    );
    if (firstDebt) {
      setSelectedStudentForPayment({ id: firstDebt.student_id, name: firstDebt.student_name });
    }
    setPaymentAmount(amount);
    setShowPaymentModal(true);
  };

  const handlePayAll = (studentDebt: StudentDebt) => {
    // Seleccionar todas las transacciones del estudiante
    const allTransactionIds = studentDebt.pending_transactions.map(t => t.id);
    setSelectedTransactions(new Set(allTransactionIds));
    setPaymentAmount(studentDebt.total_debt);
    setSelectedStudentForPayment({ id: studentDebt.student_id, name: studentDebt.student_name });
    setShowPaymentModal(true);
  };

  const processPayment = async (method: string) => {
    try {
      setProcessingPayment(true);

      // Actualizar cada transacción seleccionada a "paid"
      const transactionIds = Array.from(selectedTransactions);

      const { error } = await supabase
        .from('transactions')
        .update({ payment_status: 'paid', payment_method: method })
        .in('id', transactionIds);

      if (error) throw error;

      toast({
        title: '✅ Pago Realizado',
        description: `Se pagaron ${transactionIds.length} compra(s) por S/ ${(paymentAmount || 0).toFixed(2)}`,
      });

      // Limpiar selección y recargar
      setSelectedTransactions(new Set());
      setShowPaymentModal(false);
      await fetchDebts();
    } catch (error: any) {
      console.error('Error processing payment:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo procesar el pago',
      });
    } finally {
      setProcessingPayment(false);
    }
  };

  const totalDebt = debts.reduce((sum, d) => sum + d.total_debt, 0);
  const selectedAmount = getSelectedAmount();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-500">Cargando deudas...</p>
        </div>
      </div>
    );
  }

  if (debts.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <Check className="h-16 w-16 text-emerald-500 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-gray-900 mb-2">¡Todo al día!</h3>
            <p className="text-gray-500">
              No tienes deudas pendientes con el kiosco escolar.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Resumen de Deuda Total */}
      <Card className="border-2 border-amber-300 bg-gradient-to-r from-amber-50 to-orange-50">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-amber-100 rounded-full">
                <AlertCircle className="h-8 w-8 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-amber-700 font-semibold uppercase">Deuda Total Pendiente</p>
                <p className="text-4xl font-black text-amber-900">S/ {(totalDebt || 0).toFixed(2)}</p>
                <p className="text-xs text-amber-600 mt-1">
                  {debts.reduce((sum, d) => sum + d.pending_transactions.length, 0)} compra(s) pendientes
                </p>
              </div>
            </div>
            {selectedAmount > 0 && (
              <Button
                onClick={handlePaySelected}
                size="lg"
                className="bg-emerald-600 hover:bg-emerald-700 text-white h-14 px-8 text-lg font-bold"
              >
                <CreditCard className="mr-2 h-5 w-5" />
                Pagar Seleccionadas (S/ {(selectedAmount || 0).toFixed(2)})
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Deudas por Estudiante */}
      {debts.map((debt) => (
        <Card key={debt.student_id} className="border-2">
          <CardHeader className="bg-gradient-to-r from-blue-50 to-purple-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {debt.student_photo && (
                  <img
                    src={debt.student_photo}
                    alt={debt.student_name}
                    className="w-16 h-16 rounded-full object-cover border-2 border-white shadow-lg"
                  />
                )}
                <div>
                  <CardTitle className="text-xl">{debt.student_name}</CardTitle>
                  <CardDescription className="text-base">
                    Deuda: <span className="font-bold text-red-600">S/ {(debt.total_debt || 0).toFixed(2)}</span>
                    {' • '}
                    {debt.pending_transactions.length} compra(s)
                  </CardDescription>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => toggleSelectAll(debt)}
                >
                  {debt.pending_transactions.every(t => selectedTransactions.has(t.id)) ? 'Deseleccionar Todas' : 'Seleccionar Todas'}
                </Button>
                <Button
                  onClick={() => handlePayAll(debt)}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Pagar Todo
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-2">
              {debt.pending_transactions.map((transaction) => (
                <div
                  key={transaction.id}
                  className={`flex items-center gap-4 p-3 rounded-lg border-2 transition-colors ${
                    selectedTransactions.has(transaction.id)
                      ? 'bg-blue-50 border-blue-300'
                      : 'bg-white border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <Checkbox
                    checked={selectedTransactions.has(transaction.id)}
                    onCheckedChange={() => toggleTransaction(transaction.id)}
                  />
                  <Receipt className="h-5 w-5 text-gray-400" />
                  <div className="flex-1">
                    <p className="font-semibold text-sm">{transaction.description}</p>
                    <p className="text-xs text-gray-500">
                      {format(new Date(transaction.created_at), "d 'de' MMMM, yyyy • HH:mm", { locale: es })}
                      {transaction.ticket_code && ` • Ticket: ${transaction.ticket_code}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-red-600">S/ {(transaction.amount || 0).toFixed(2)}</p>
                    <Badge variant="outline" className="text-xs border-amber-300 text-amber-700">
                      <Clock className="h-3 w-3 mr-1" />
                      Pendiente
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Modal de Pago con Pasarela */}
      {showPaymentModal && selectedStudentForPayment && (
        <PayDebtModal
          isOpen={showPaymentModal}
          onClose={() => {
            setShowPaymentModal(false);
            setSelectedStudentForPayment(null);
          }}
          studentName={selectedStudentForPayment.name}
          studentId={selectedStudentForPayment.id}
          selectedTransactionIds={Array.from(selectedTransactions)}
          onPaymentComplete={async () => {
            await fetchDebts();
            setSelectedTransactions(new Set());
            setShowPaymentModal(false);
            setSelectedStudentForPayment(null);
          }}
        />
      )}
    </div>
  );
};

