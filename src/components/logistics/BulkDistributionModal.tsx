import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, LayoutGrid, AlertTriangle } from 'lucide-react';

interface School {
  id: string;
  name: string;
  currentStock: number;
}

interface Props {
  open:         boolean;
  onClose:      () => void;
  onSuccess?:   () => void;
  productId:    string;
  productName:  string;
  schoolId?:    string | null; // sede del usuario que distribuye (pre-registra como origen si se desea)
}

export function BulkDistributionModal({
  open, onClose, onSuccess, productId, productName, schoolId,
}: Props) {
  const { toast } = useToast();

  const [schools, setSchools]   = useState<School[]>([]);
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [reason, setReason]     = useState('');

  // Cantidades a distribuir por sede
  const [quantities, setQuantities] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) loadSchools();
  }, [open, productId]);

  const loadSchools = async () => {
    setLoading(true);
    try {
      const { data: schoolsData, error: schoolsErr } = await supabase
        .from('schools')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      if (schoolsErr) throw schoolsErr;

      const schoolIds = (schoolsData || []).map(s => s.id);

      const { data: stockData } = await supabase
        .from('product_stock')
        .select('school_id, current_stock')
        .eq('product_id', productId)
        .in('school_id', schoolIds);

      const stockMap = new Map(
        (stockData || []).map(r => [r.school_id, r.current_stock])
      );

      const rows: School[] = (schoolsData || []).map(s => ({
        id:           s.id,
        name:         s.name,
        currentStock: stockMap.get(s.id) ?? 0,
      }));

      setSchools(rows);
      setQuantities(Object.fromEntries(rows.map(s => [s.id, ''])));
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error cargando sedes', description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const totalToDistribute = schools.reduce((sum, s) => {
    const q = parseInt(quantities[s.id] || '0') || 0;
    return sum + q;
  }, 0);

  const hasAtLeastOne = schools.some(s => (parseInt(quantities[s.id] || '0') || 0) > 0);

  const handleSave = async () => {
    if (!hasAtLeastOne) {
      toast({ variant: 'destructive', title: 'Ingresa al menos una cantidad' });
      return;
    }

    setSaving(true);
    try {
      const targets = schools.filter(s => (parseInt(quantities[s.id] || '0') || 0) > 0);

      for (const s of targets) {
        const qty = parseInt(quantities[s.id]) || 0;
        const { error } = await supabase.rpc('increment_product_stock', {
          p_product_id: productId,
          p_school_id:  s.id,
          p_quantity:   qty,
          p_entry_id:   null,
          p_reason:     reason.trim() || `Distribución masiva de ${productName}`,
        });
        if (error) throw error;
      }

      toast({
        title: '✅ Stock distribuido',
        description: `${totalToDistribute} unidades de "${productName}" repartidas entre ${targets.length} sede(s).`,
      });
      onSuccess?.();
      onClose();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error al distribuir', description: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setQuantities({});
    setReason('');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 text-emerald-700" />
            Distribución Masiva
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-slate-50 rounded-lg px-4 py-3">
            <p className="text-sm font-semibold text-slate-700">{productName}</p>
            <p className="text-xs text-slate-400">
              Indica cuántas unidades quieres sumar al stock de cada sede.
            </p>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : (
            <div className="space-y-2">
              {schools.map(s => {
                const qty = parseInt(quantities[s.id] || '0') || 0;
                const projectedStock = s.currentStock + qty;
                return (
                  <div key={s.id} className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{s.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-[10px]">
                          Stock actual: {s.currentStock}
                        </Badge>
                        {qty > 0 && (
                          <Badge className="text-[10px] bg-emerald-100 text-emerald-800 border-emerald-200">
                            Quedará: {projectedStock}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Label className="text-xs text-slate-400 whitespace-nowrap">+ Unid.</Label>
                      <Input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={quantities[s.id] || ''}
                        onChange={e => setQuantities(prev => ({ ...prev, [s.id]: e.target.value }))}
                        className="w-20 text-center"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Total */}
          {totalToDistribute > 0 && (
            <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2">
              <span className="text-sm font-semibold text-emerald-800">Total a distribuir</span>
              <span className="text-xl font-black text-emerald-700">{totalToDistribute} unid.</span>
            </div>
          )}

          {!hasAtLeastOne && !loading && (
            <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Ingresa al menos una cantidad mayor a 0 para continuar.
            </div>
          )}

          {/* Motivo opcional */}
          <div className="space-y-1">
            <Label className="text-xs">Motivo de la distribución (opcional)</Label>
            <Input
              placeholder="Ej: Recepción de pedido mensual, redistribución de almacén..."
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={handleClose} disabled={saving}>
              Cancelar
            </Button>
            <Button
              className="flex-1 bg-emerald-700 hover:bg-emerald-800"
              onClick={handleSave}
              disabled={saving || !hasAtLeastOne}
            >
              {saving
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Distribuyendo...</>
                : <><CheckCircle2 className="h-4 w-4 mr-2" />Confirmar Distribución</>
              }
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
