import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Wallet, CheckCircle2 } from 'lucide-react';
import type { CashSession } from '@/types/cashRegisterV2';
import { ensureCashSessionOpen } from '@/features/cash/services/cashSessionService';

interface Props {
  schoolId: string;
  onOpened: (session: CashSession) => void;
}

export default function CashOpeningFlow({ schoolId, onOpened }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const handleOpen = async () => {
    setLoading(true);
    try {
      const { data, action, error } = await ensureCashSessionOpen(schoolId);
      if (error) throw new Error(error);
      if (!data) throw new Error('No se pudo abrir la sesión de caja.');

      if (action === 'already_open') {
        toast({ title: '✅ Caja ya estaba abierta', description: 'Puedes operar el día de hoy.' });
      } else if (action === 'reopened') {
        toast({ title: '✅ Caja reabierta', description: 'Puedes seguir operando el día de hoy.' });
      } else {
        toast({ title: '✅ Caja abierta', description: 'La caja del día ha sido abierta en S/ 0.00.' });
      }

      onOpened(data as unknown as CashSession);
    } catch (err: unknown) {
      console.error('[CashOpeningFlow] Error:', err);
      const msg = err instanceof Error ? err.message : 'No se pudo abrir la caja.';
      toast({ variant: 'destructive', title: 'Error', description: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <Card className="w-full max-w-lg shadow-xl border-2 border-blue-200">
        <CardHeader className="text-center bg-gradient-to-r from-blue-50 to-indigo-50 rounded-t-lg">
          <div className="w-16 h-16 mx-auto bg-blue-100 rounded-full flex items-center justify-center mb-3">
            <Wallet className="h-8 w-8 text-blue-600" />
          </div>
          <CardTitle className="text-2xl font-bold text-gray-900">Apertura de Caja</CardTitle>
          <p className="text-sm text-gray-500 mt-1">Inicia la jornada del día</p>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-800 flex items-start gap-2">
            <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
            <p>Al abrir, la caja queda lista para ventas POS. El fondo inicial es S/ 0.00.</p>
          </div>
          <Button
            onClick={handleOpen}
            disabled={loading}
            className="w-full h-14 text-lg font-bold bg-blue-600 hover:bg-blue-700"
          >
            {loading ? (
              <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Abriendo...</>
            ) : (
              'Abrir Caja del Día'
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
