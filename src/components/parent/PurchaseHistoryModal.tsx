import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ShoppingBag, Clock, UtensilsCrossed, ChevronDown } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const PAGE_SIZE = 20;

interface Purchase {
  id: string;
  amount: number;
  description: string;
  created_at: string;
  ticket_code: string | null;
  payment_status: string;
  db_type: string;
  is_lunch: boolean;
  consumption_label: string;
}

interface PurchaseHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  studentId: string;
  studentName: string;
}

// ─── Skeleton card ────────────────────────────────────────────────────────────
const PurchaseCardSkeleton = () => (
  <div className="bg-white rounded-2xl border border-slate-100 p-4 animate-pulse">
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 bg-slate-200 rounded-xl shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-3/4 bg-slate-200 rounded-full" />
        <div className="h-2.5 w-1/2 bg-slate-100 rounded-full" />
        <div className="h-2 w-1/4 bg-slate-100 rounded-full" />
      </div>
      <div className="text-right space-y-1.5 shrink-0">
        <div className="h-2 w-8 bg-slate-100 rounded-full" />
        <div className="h-5 w-14 bg-slate-200 rounded-full" />
      </div>
    </div>
    <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
      <div className="h-7 w-full bg-slate-100 rounded-xl" />
    </div>
  </div>
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Purchase Card ────────────────────────────────────────────────────────────
function PurchaseCard({ purchase }: { purchase: Purchase }) {
  const isLunch = purchase.is_lunch;
  const title = purchase.description || 'Consumo';

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-4 hover:shadow-sm transition-shadow">
      {/* Fila principal */}
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
          isLunch ? 'bg-orange-100' : 'bg-slate-100'
        }`}>
          {isLunch
            ? <UtensilsCrossed className="w-5 h-5 text-orange-500" />
            : <ShoppingBag className="w-5 h-5 text-slate-500" />
          }
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm text-slate-800 leading-snug">{title}</p>

          <p className="text-[11px] text-slate-400 mt-0.5 capitalize">
            {format(new Date(purchase.created_at), "EEEE d 'de' MMMM · HH:mm", { locale: es })}
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5 uppercase tracking-wide">
            {purchase.consumption_label} · DB: {purchase.db_type}
          </p>

          {purchase.ticket_code && (
            <p className="text-[10px] text-slate-300 mt-0.5 font-mono">{purchase.ticket_code}</p>
          )}

          {purchase.payment_status === 'pending' && (
            <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] text-amber-600 font-semibold bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
              <Clock className="w-2.5 h-2.5" />
              Pendiente de pago
            </span>
          )}
        </div>

        <div className="text-right shrink-0">
          <p className="text-[10px] text-slate-400 font-medium">Total</p>
          <p className="text-lg font-black text-[#8B4513]">S/ {Number(purchase.amount).toFixed(2)}</p>
        </div>
      </div>

      {/* Chip almuerzo escolar */}
      {isLunch && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-orange-600 bg-orange-50 rounded-xl px-3 py-1.5">
          <UtensilsCrossed className="w-3 h-3 shrink-0" />
          <span>Almuerzo escolar</span>
        </div>
      )}
    </div>
  );
}

// ─── Modal principal ──────────────────────────────────────────────────────────
export const PurchaseHistoryModal = ({
  isOpen,
  onClose,
  studentId,
  studentName,
}: PurchaseHistoryModalProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);

  const firstName = studentName.split(' ')[0];

  const fetchPage = useCallback(async (currentPage: number, isReset: boolean) => {
    try {
      if (isReset) setLoading(true); else setLoadingMore(true);

      const from = currentPage * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      // Regla de Oro: clasificación resuelta en backend (RPC), frontend solo renderiza.
      const { data, error } = await supabase.rpc('get_student_purchase_history', {
        p_student_id: studentId,
        p_limit: PAGE_SIZE,
        p_offset: from,
      });

      if (error) throw error;

      const newPurchases: Purchase[] = (data ?? []).map((tx: any) => ({
        id: tx.id,
        amount: Number(tx.amount ?? 0),
        description: tx.description || '',
        created_at: tx.created_at,
        ticket_code: tx.ticket_code ?? null,
        payment_status: tx.payment_status || 'paid',
        db_type: tx.db_type ?? 'purchase',
        is_lunch: Boolean(tx.is_lunch),
        consumption_label: tx.consumption_label ?? 'Consumo',
      }));

      if (isReset) {
        setPurchases(newPurchases);
      } else {
        setPurchases(prev => [...prev, ...newPurchases]);
      }
      setHasMore(newPurchases.length === PAGE_SIZE);
    } catch (err: any) {
      console.error('Error fetching purchase history:', err);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo cargar el historial de compras' });
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [studentId, toast]);

  useEffect(() => {
    if (isOpen) {
      setPurchases([]);
      setPage(0);
      setHasMore(false);
      fetchPage(0, true);
    }
  }, [isOpen, studentId]);

  const handleLoadMore = () => {
    const next = page + 1;
    setPage(next);
    fetchPage(next, false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg w-full max-h-[88vh] overflow-y-auto p-0 rounded-3xl" aria-describedby={undefined}>

        {/* Header fijo */}
        <DialogHeader className="sticky top-0 bg-white z-10 px-5 pt-5 pb-3 border-b border-slate-100">
          <DialogTitle className="flex items-center gap-2.5 text-base font-bold text-slate-800">
            <div className="w-9 h-9 rounded-xl bg-orange-100 flex items-center justify-center shrink-0">
              <ShoppingBag className="h-5 w-5 text-orange-500" />
            </div>
            Historial de Compras
            <span className="text-sm font-normal text-slate-400 ml-0.5">· {firstName}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="px-4 py-4 space-y-3">
          {/* Skeleton */}
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <PurchaseCardSkeleton key={i} />)}
            </div>
          ) : purchases.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <ShoppingBag className="h-14 w-14 text-slate-200 mb-4" />
              <p className="text-base font-semibold text-slate-600 mb-1">Sin compras registradas</p>
              <p className="text-sm text-slate-400 text-center px-4">
                Cuando {firstName} compre en el kiosco o pida almuerzos, aparecerá aquí.
              </p>
            </div>
          ) : (
            <>
              {purchases.map(p => <PurchaseCard key={p.id} purchase={p} />)}

              {/* Botón cargar más */}
              {hasMore && (
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="w-full py-3 rounded-2xl border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-50 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {loadingMore ? (
                    <>
                      <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-500 rounded-full animate-spin" />
                      Cargando...
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-4 h-4" />
                      Cargar más
                    </>
                  )}
                </button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
