import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CreditCard, Check, Clock, Receipt } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

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

  useEffect(() => {
    fetchDebts();
  }, [userId]);

  const fetchDebts = async () => {
    try {
      setLoading(true);

      // Obtener todos los estudiantes activos del padre (incluye free_account y recarga)
      // para mostrar deudas tanto del kiosco como de almuerzos
      const { data: students, error: studentsError } = await supabase
        .from('students')
        .select('id, full_name, photo_url, free_account, school_id')
        .eq('parent_id', userId)
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
        console.log('🔍 Buscando delay para:', {
          studentName: student.full_name,
          schoolId: student.school_id
        });

        const { data: delayData, error: delayError } = await supabase
          .from('purchase_visibility_delay')
          .select('delay_days')
          .eq('school_id', student.school_id)
          .maybeSingle();

        console.log('📦 Resultado de búsqueda de delay:', {
          studentName: student.full_name,
          delayData,
          delayError,
          valorFinal: delayData?.delay_days ?? 2
        });

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

  const totalDebt = debts.reduce((sum, d) => sum + d.total_debt, 0);

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
      {/* 🔒 AVISO: Pagos presenciales */}
      <Card className="border-2 border-blue-300 bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardContent className="pt-6 pb-4">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-blue-100 rounded-full flex-shrink-0">
              <CreditCard className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-blue-800">💳 Los pagos se realizan presencialmente en caja</p>
              <p className="text-xs text-blue-600 mt-1">
                Para cancelar las deudas pendientes, acérquese a la cafetería del colegio. 
                El cajero registrará su pago en el sistema.
              </p>
              <p className="text-[10px] text-blue-400 mt-2 italic">
                Pronto habilitaremos pagos en línea (Yape, Plin, tarjeta).
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Resumen de Deuda Total */}
      <Card className="border-2 border-amber-300 bg-gradient-to-r from-amber-50 to-orange-50">
        <CardContent className="pt-6">
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
        </CardContent>
      </Card>

      {/* Deudas por Estudiante (SOLO LECTURA - sin botones de pago) */}
      {debts.map((debt) => (
        <Card key={debt.student_id} className="border-2">
          <CardHeader className="bg-gradient-to-r from-blue-50 to-purple-50">
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
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-2">
              {debt.pending_transactions.map((transaction) => (
                <div
                  key={transaction.id}
                  className="flex items-center gap-4 p-3 rounded-lg border-2 bg-white border-gray-200"
                >
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
    </div>
  );
};

