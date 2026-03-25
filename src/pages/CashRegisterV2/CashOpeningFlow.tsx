import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, DollarSign, Wallet, CheckCircle2 } from 'lucide-react';
import type { CashSession } from '@/types/cashRegisterV2';

interface Props {
  schoolId: string;
  onOpened: (session: CashSession) => void;
}

export default function CashOpeningFlow({ schoolId, onOpened }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const handleOpen = async () => {
    if (!user) return;
    setLoading(true);

    try {
      // EC-TZ: usar hora Lima para que el cajero abra la caja del día correcto
      // new Date().toISOString() retorna UTC — a las 8 PM Lima ya sería el día siguiente
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });

      const { data, error } = await supabase
        .from('cash_sessions')
        .insert({
          school_id: schoolId,
          session_date: today,
          opened_by: user.id,
          status: 'open',
          initial_cash: 0,
          initial_yape: 0,
          initial_plin: 0,
          initial_other: 0,
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          // Ya existe la fila del día (p. ej. cerrada): reabrir en lugar de fallar
          const { data: row } = await supabase
            .from('cash_sessions')
            .select('*')
            .eq('school_id', schoolId)
            .eq('session_date', today)
            .maybeSingle();
          if (row?.status === 'closed') {
            const { error: up } = await supabase
              .from('cash_sessions')
              .update({ status: 'open', closed_at: null, closed_by: null })
              .eq('id', row.id);
            if (up) throw up;
            const { data: fresh } = await supabase.from('cash_sessions').select('*').eq('id', row.id).single();
            toast({ title: '✅ Caja reabierta', description: 'Puedes seguir operando el día de hoy.' });
            if (fresh) onOpened(fresh as CashSession);
            return;
          }
          toast({ variant: 'destructive', title: 'Ya existe sesión de hoy', description: 'Recarga la página o entra al módulo de caja.' });
          return;
        }
        throw error;
      }

      toast({ title: '✅ Caja abierta', description: 'La caja del día ha sido abierta en S/ 0.00.' });
      onOpened(data);
    } catch (err: any) {
      console.error('[CashOpeningFlow] Error:', err);
      toast({ variant: 'destructive', title: 'Error', description: err.message || 'No se pudo abrir la caja.' });
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
          <CardTitle className="text-2xl">Apertura de Caja</CardTitle>
          <p className="text-sm text-gray-500 mt-1">
            La caja abre con S/ 0.00. Todos los ingresos del día se registrarán durante la jornada.
          </p>
        </CardHeader>
        <CardContent className="p-6 space-y-5">
          {/* Monto inicial fijo */}
          <div className="bg-blue-50 rounded-xl p-6 text-center border-2 border-blue-200 space-y-2">
            <p className="text-sm text-blue-600 font-semibold uppercase tracking-wide">Monto Inicial de Caja</p>
            <p className="text-5xl font-black text-blue-800">S/ 0.00</p>
            <div className="flex items-center justify-center gap-1.5 text-green-600 mt-2">
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-xs font-medium">Apertura estandarizada en cero</span>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 leading-relaxed">
            <strong>¿Por qué S/ 0.00?</strong> La política de caja establece apertura en cero. Cualquier ingreso
            (ventas POS, cobros, pagos de padres) se registrará durante el día con su medio de pago y motivo.
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
