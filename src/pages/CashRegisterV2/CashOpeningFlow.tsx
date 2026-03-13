import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, DollarSign, Wallet } from 'lucide-react';
import type { CashSession } from '@/types/cashRegisterV2';

interface Props {
  schoolId: string;
  onOpened: (session: CashSession) => void;
}

export default function CashOpeningFlow({ schoolId, onOpened }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const [initialCash, setInitialCash] = useState<string>('0');
  const [initialYape, setInitialYape] = useState<string>('0');
  const [initialPlin, setInitialPlin] = useState<string>('0');
  const [initialOther, setInitialOther] = useState<string>('0');

  const handleOpen = async () => {
    if (!user) return;
    setLoading(true);

    try {
      const today = new Date().toISOString().split('T')[0];

      const { data, error } = await supabase
        .from('cash_sessions')
        .insert({
          school_id: schoolId,
          session_date: today,
          opened_by: user.id,
          initial_cash: parseFloat(initialCash) || 0,
          initial_yape: parseFloat(initialYape) || 0,
          initial_plin: parseFloat(initialPlin) || 0,
          initial_other: parseFloat(initialOther) || 0,
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          toast({ variant: 'destructive', title: 'Ya existe una caja abierta hoy', description: 'Solo puedes tener una sesión de caja por día por sede.' });
          return;
        }
        throw error;
      }

      toast({ title: '✅ Caja abierta', description: 'La caja del día ha sido abierta exitosamente.' });
      onOpened(data);
    } catch (err: any) {
      console.error('[CashOpeningFlow] Error:', err);
      toast({ variant: 'destructive', title: 'Error', description: err.message || 'No se pudo abrir la caja.' });
    } finally {
      setLoading(false);
    }
  };

  const total = (parseFloat(initialCash) || 0) + (parseFloat(initialYape) || 0) + (parseFloat(initialPlin) || 0) + (parseFloat(initialOther) || 0);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <Card className="w-full max-w-lg shadow-xl border-2 border-blue-200">
        <CardHeader className="text-center bg-gradient-to-r from-blue-50 to-indigo-50 rounded-t-lg">
          <div className="w-16 h-16 mx-auto bg-blue-100 rounded-full flex items-center justify-center mb-3">
            <Wallet className="h-8 w-8 text-blue-600" />
          </div>
          <CardTitle className="text-2xl">Apertura de Caja</CardTitle>
          <p className="text-sm text-gray-500 mt-1">
            Cuenta físicamente el efectivo y los balances digitales e ingresa los montos iniciales.
          </p>
        </CardHeader>
        <CardContent className="p-6 space-y-5">
          {/* Efectivo */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-2 font-semibold">
              💵 Efectivo Inicial (S/)
            </Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={initialCash}
              onChange={(e) => setInitialCash(e.target.value)}
              className="text-lg h-12"
              placeholder="0.00"
            />
          </div>

          {/* Yape */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-2 font-semibold">
              📱 Balance Yape (S/)
            </Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={initialYape}
              onChange={(e) => setInitialYape(e.target.value)}
              className="h-10"
              placeholder="0.00"
            />
          </div>

          {/* Plin */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-2 font-semibold">
              📲 Balance Plin (S/)
            </Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={initialPlin}
              onChange={(e) => setInitialPlin(e.target.value)}
              className="h-10"
              placeholder="0.00"
            />
          </div>

          {/* Otros */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-2 font-semibold">
              🏦 Otros Digitales (S/)
            </Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={initialOther}
              onChange={(e) => setInitialOther(e.target.value)}
              className="h-10"
              placeholder="0.00"
            />
          </div>

          {/* Total */}
          <div className="bg-blue-50 rounded-lg p-4 text-center border border-blue-200">
            <p className="text-sm text-blue-600 font-medium">Total Inicial Declarado</p>
            <p className="text-3xl font-bold text-blue-800">S/ {total.toFixed(2)}</p>
          </div>

          <Button
            onClick={handleOpen}
            disabled={loading}
            className="w-full h-14 text-lg bg-blue-600 hover:bg-blue-700"
          >
            {loading ? (
              <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Abriendo caja...</>
            ) : (
              <><DollarSign className="h-5 w-5 mr-2" /> Abrir Caja del Día</>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
