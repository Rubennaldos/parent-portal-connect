import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Receipt, Clock, ShoppingBag, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface PurchaseItem {
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

interface Purchase {
  id: string;
  amount: number;
  description: string;
  created_at: string;
  ticket_code: string | null;
  payment_status: string;
  items: PurchaseItem[];
}

interface PurchaseHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  studentId: string;
  studentName: string;
}

export const PurchaseHistoryModal = ({ 
  isOpen, 
  onClose, 
  studentId, 
  studentName 
}: PurchaseHistoryModalProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [purchases, setPurchases] = useState<Purchase[]>([]);

  useEffect(() => {
    if (isOpen) {
      fetchPurchaseHistory();
    }
  }, [isOpen, studentId]);

  const fetchPurchaseHistory = async () => {
    try {
      setLoading(true);

      // ✅ Sin delay — se muestra en tiempo real
      const { data: transactions, error: transError } = await supabase
        .from('transactions')
        .select('*')
        .eq('student_id', studentId)
        .eq('type', 'purchase')
        .neq('payment_status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(50);

      if (transError) throw transError;

      if (!transactions || transactions.length === 0) {
        setPurchases([]);
        return;
      }

      // Para cada transacción, obtener sus items
      const purchasesWithItems: Purchase[] = [];

      for (const transaction of transactions) {
        const { data: items, error: itemsError } = await supabase
          .from('transaction_items')
          .select('product_name, quantity, unit_price, subtotal')
          .eq('transaction_id', transaction.id);

        if (itemsError) {
          console.error('Error fetching items:', itemsError);
          continue;
        }

        purchasesWithItems.push({
          id: transaction.id,
          amount: Math.abs(transaction.amount),
          description: transaction.description,
          created_at: transaction.created_at,
          ticket_code: transaction.ticket_code,
          payment_status: transaction.payment_status || 'paid',
          items: items || [],
        });
      }

      setPurchases(purchasesWithItems);
    } catch (error: any) {
      console.error('Error fetching purchase history:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo cargar el historial de compras',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl flex items-center gap-2">
            <ShoppingBag className="h-6 w-6 text-[#8B4513]" />
            Historial de Compras - {studentName}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#8B4513] mx-auto mb-4"></div>
              <p className="text-gray-500">Cargando historial...</p>
            </div>
          </div>
        ) : purchases.length === 0 ? (
          <div className="text-center py-12">
            <ShoppingBag className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-700 mb-2">
              No hay compras registradas
            </h3>
            <p className="text-gray-500">
              Cuando {studentName} realice compras en el kiosco, aparecerán aquí.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {purchases.map((purchase) => (
              <Card key={purchase.id} className="border-2 hover:shadow-lg transition-shadow">
                <CardContent className="p-4">
                  {/* Header de la compra */}
                  <div className="flex items-start justify-between mb-3 pb-3 border-b-2 border-gray-100">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-[#8B4513]/10 rounded-lg">
                        <Receipt className="h-5 w-5 text-[#8B4513]" />
                      </div>
                      <div>
                        <div className="font-bold text-gray-900 flex items-center gap-2">
                          {purchase.ticket_code || 'Sin ticket'}
                          {purchase.payment_status === 'pending' && (
                            <Badge variant="outline" className="text-xs border-amber-300 text-amber-700">
                              <Clock className="h-3 w-3 mr-1" />
                              Pendiente
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                          <Clock className="h-3 w-3" />
                          {format(new Date(purchase.created_at), "EEEE, d 'de' MMMM 'de' yyyy • HH:mm", { locale: es })}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-500">Total</p>
                      <p className="text-2xl font-black text-[#8B4513]">
                        S/ {purchase.amount.toFixed(2)}
                      </p>
                    </div>
                  </div>

                  {/* Lista de productos */}
                  {purchase.items.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs font-bold text-gray-500 uppercase mb-2">Productos Comprados:</p>
                      {purchase.items.map((item, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg"
                        >
                          <div className="flex-1">
                            <p className="font-semibold text-gray-900">{item.product_name}</p>
                            <p className="text-xs text-gray-500">
                              {item.quantity} x S/ {item.unit_price.toFixed(2)}
                            </p>
                          </div>
                          <p className="font-bold text-[#D2691E]">
                            S/ {item.subtotal.toFixed(2)}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-gray-500 bg-gray-50 p-3 rounded-lg">
                      <AlertCircle className="h-4 w-4" />
                      <span>{purchase.description}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

