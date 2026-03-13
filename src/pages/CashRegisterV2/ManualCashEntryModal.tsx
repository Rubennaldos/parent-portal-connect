import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { CATEGORY_LABELS, type ManualEntryType, type ManualEntryCategory } from '@/types/cashRegisterV2';

interface Props {
  open: boolean;
  onClose: () => void;
  entryType: ManualEntryType;
  cashSessionId: string;
  schoolId: string;
  onCreated: () => void;
}

export default function ManualCashEntryModal({
  open, onClose, entryType, cashSessionId, schoolId, onCreated,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ManualEntryCategory>('miscellaneous');
  const [description, setDescription] = useState('');

  const isIncome = entryType === 'income';
  const title = isIncome ? 'Registrar Ingreso Manual' : 'Registrar Egreso Manual';
  const color = isIncome ? 'green' : 'red';

  const handleSubmit = async () => {
    if (!user) return;
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      toast({ variant: 'destructive', title: 'Monto inválido', description: 'Ingresa un monto mayor a 0.' });
      return;
    }
    if (!description.trim()) {
      toast({ variant: 'destructive', title: 'Descripción requerida', description: 'Describe brevemente el motivo.' });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.from('cash_manual_entries').insert({
        cash_session_id: cashSessionId,
        school_id: schoolId,
        entry_type: entryType,
        amount: parsedAmount,
        entry_date: new Date().toISOString().split('T')[0],
        category,
        description: description.trim(),
        created_by: user.id,
      });

      if (error) throw error;

      toast({ title: `✅ ${isIncome ? 'Ingreso' : 'Egreso'} registrado`, description: `S/ ${parsedAmount.toFixed(2)} — ${description.trim()}` });
      setAmount('');
      setCategory('miscellaneous');
      setDescription('');
      onCreated();
      onClose();
    } catch (err: any) {
      console.error('[ManualCashEntryModal] Error:', err);
      toast({ variant: 'destructive', title: 'Error', description: err.message || 'No se pudo registrar.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className={`text-${color}-700 text-xl`}>
            {isIncome ? '📥' : '📤'} {title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label className="font-semibold">Monto (S/)</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="text-lg h-12"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label className="font-semibold">Categoría</Label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ManualEntryCategory)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label className="font-semibold">Descripción</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={isIncome ? 'Ej: Cambio devuelto de compra' : 'Ej: Compra de servilletas para kiosco'}
              className="h-10"
            />
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button
            onClick={handleSubmit}
            disabled={loading}
            className={isIncome ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {isIncome ? 'Registrar Ingreso' : 'Registrar Egreso'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
