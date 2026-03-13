import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowDownCircle, ArrowUpCircle, Lock, RefreshCw, Send, Clock, DollarSign } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { CashSession, CashManualEntry, DailySalesTotals } from '@/types/cashRegisterV2';
import { CATEGORY_LABELS } from '@/types/cashRegisterV2';
import ManualCashEntryModal from './ManualCashEntryModal';

interface Props {
  session: CashSession;
  schoolId: string;
  onCloseRequested: () => void;
  onTreasuryRequested: () => void;
  onRefresh: () => void;
}

export default function CashDayDashboard({ session, schoolId, onCloseRequested, onTreasuryRequested, onRefresh }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [salesTotals, setSalesTotals] = useState<DailySalesTotals | null>(null);
  const [manualEntries, setManualEntries] = useState<CashManualEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [showIncomeModal, setShowIncomeModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showEntryDetail, setShowEntryDetail] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Ventas validadas del día (del RPC existente)
      const today = new Date().toISOString().split('T')[0];
      const { data: rpcData, error: rpcErr } = await supabase.rpc('calculate_daily_totals', {
        p_school_id: schoolId,
        p_date: today,
      });

      if (rpcErr) {
        console.error('[CashDayDashboard] RPC error:', rpcErr);
      }

      const d = rpcData || { pos: {}, lunch: {} };
      const pos = d.pos || {};
      const lunch = d.lunch || {};

      setSalesTotals({
        cash: (pos.cash || 0) + (lunch.cash || 0) + (pos.mixed_cash || 0),
        yape: (pos.yape || 0) + (pos.yape_qr || 0) + (lunch.yape || 0) + (pos.mixed_yape || 0),
        plin: (pos.plin || 0) + (lunch.plin || 0),
        transferencia: (pos.transferencia || 0) + (lunch.transferencia || 0),
        tarjeta: (pos.card || 0) + (lunch.card || 0) + (pos.mixed_card || 0),
        mixto: 0,
        total: (pos.total || 0) + (lunch.total || 0),
      });

      // 2. Ingresos/Egresos manuales
      const { data: entries } = await supabase
        .from('cash_manual_entries')
        .select('*, creator_profile:created_by(full_name)')
        .eq('cash_session_id', session.id)
        .order('created_at', { ascending: false });

      setManualEntries(entries || []);
    } catch (err) {
      console.error('[CashDayDashboard] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [schoolId, session.id]);

  useEffect(() => { load(); }, [load]);

  const totalIncome = manualEntries.filter(e => e.entry_type === 'income').reduce((s, e) => s + e.amount, 0);
  const totalExpense = manualEntries.filter(e => e.entry_type === 'expense').reduce((s, e) => s + e.amount, 0);

  if (loading && !salesTotals) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        <span className="ml-3 text-gray-500">Cargando estado de caja...</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Cabecera de sesión */}
      <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
        <CardContent className="p-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Clock className="h-5 w-5 text-blue-600" />
                Caja de Hoy
                <Badge className="bg-green-100 text-green-700 border-green-300">Abierta</Badge>
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                Abierta el {format(new Date(session.opened_at), "dd/MM/yyyy 'a las' HH:mm", { locale: es })}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => { load(); onRefresh(); }}>
              <RefreshCw className="h-4 w-4 mr-1" /> Actualizar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Estado de Caja Actual */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-blue-600" />
            Estado de Caja Actual (S/)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-green-50 rounded-lg p-3 border border-green-200 text-center">
              <p className="text-xs text-green-600 font-medium">💵 Efectivo Inicial</p>
              <p className="text-xl font-bold text-green-800">S/ {session.initial_cash.toFixed(2)}</p>
            </div>
            <div className="bg-purple-50 rounded-lg p-3 border border-purple-200 text-center">
              <p className="text-xs text-purple-600 font-medium">📱 Yape Inicial</p>
              <p className="text-xl font-bold text-purple-800">S/ {session.initial_yape.toFixed(2)}</p>
            </div>
            <div className="bg-blue-50 rounded-lg p-3 border border-blue-200 text-center">
              <p className="text-xs text-blue-600 font-medium">📲 Plin Inicial</p>
              <p className="text-xl font-bold text-blue-800">S/ {session.initial_plin.toFixed(2)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200 text-center">
              <p className="text-xs text-gray-600 font-medium">🏦 Otros Inicial</p>
              <p className="text-xl font-bold text-gray-800">S/ {session.initial_other.toFixed(2)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Ventas Validadas del Día */}
      {salesTotals && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              🛒 Ventas Validadas del Día (S/)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { label: '💵 Efectivo', value: salesTotals.cash },
                { label: '📱 Yape', value: salesTotals.yape },
                { label: '📲 Plin', value: salesTotals.plin },
                { label: '🏦 Transferencia', value: salesTotals.transferencia },
                { label: '💳 Tarjeta', value: salesTotals.tarjeta },
              ].map((item) => (
                <div key={item.label} className="bg-gray-50 rounded-lg p-3 border text-center">
                  <p className="text-xs text-gray-500">{item.label}</p>
                  <p className="text-lg font-bold text-gray-800">S/ {item.value.toFixed(2)}</p>
                </div>
              ))}
              <div className="bg-indigo-50 rounded-lg p-3 border-2 border-indigo-300 text-center">
                <p className="text-xs text-indigo-600 font-semibold">Total Ventas</p>
                <p className="text-xl font-bold text-indigo-800">S/ {salesTotals.total.toFixed(2)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Ingresos/Egresos Manuales */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-green-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">📥 Ingresos Manuales</span>
              <span className="text-green-700 font-bold">S/ {totalIncome.toFixed(2)}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {manualEntries.filter(e => e.entry_type === 'income').length === 0 ? (
              <p className="text-sm text-gray-400 py-3 text-center">Sin ingresos manuales</p>
            ) : (
              <ul className="space-y-1.5 max-h-40 overflow-y-auto">
                {manualEntries.filter(e => e.entry_type === 'income').map((e) => (
                  <li key={e.id} className="flex justify-between items-center text-sm bg-green-50 rounded px-2 py-1.5">
                    <span className="text-gray-700 truncate mr-2">{e.description}</span>
                    <span className="font-semibold text-green-700 whitespace-nowrap">+S/ {e.amount.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="border-red-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">📤 Egresos Manuales</span>
              <span className="text-red-700 font-bold">S/ {totalExpense.toFixed(2)}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {manualEntries.filter(e => e.entry_type === 'expense').length === 0 ? (
              <p className="text-sm text-gray-400 py-3 text-center">Sin egresos manuales</p>
            ) : (
              <ul className="space-y-1.5 max-h-40 overflow-y-auto">
                {manualEntries.filter(e => e.entry_type === 'expense').map((e) => (
                  <li key={e.id} className="flex justify-between items-center text-sm bg-red-50 rounded px-2 py-1.5">
                    <span className="text-gray-700 truncate mr-2">{e.description}</span>
                    <span className="font-semibold text-red-700 whitespace-nowrap">-S/ {e.amount.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Botones de acción */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Button
          onClick={() => setShowIncomeModal(true)}
          className="h-14 bg-green-600 hover:bg-green-700 text-base"
        >
          <ArrowDownCircle className="h-5 w-5 mr-2" />
          Registrar Ingreso
        </Button>

        <Button
          onClick={() => setShowExpenseModal(true)}
          className="h-14 bg-red-600 hover:bg-red-700 text-base"
        >
          <ArrowUpCircle className="h-5 w-5 mr-2" />
          Registrar Egreso
        </Button>

        <Button
          onClick={onTreasuryRequested}
          variant="outline"
          className="h-14 text-base border-indigo-300 text-indigo-700 hover:bg-indigo-50"
        >
          <Send className="h-5 w-5 mr-2" />
          Transferir a Tesorería
        </Button>

        <Button
          onClick={onCloseRequested}
          className="h-14 text-base bg-slate-800 hover:bg-slate-900"
        >
          <Lock className="h-5 w-5 mr-2" />
          Cerrar Caja del Día
        </Button>
      </div>

      {/* Modales */}
      <ManualCashEntryModal
        open={showIncomeModal}
        onClose={() => setShowIncomeModal(false)}
        entryType="income"
        cashSessionId={session.id}
        schoolId={schoolId}
        onCreated={load}
      />
      <ManualCashEntryModal
        open={showExpenseModal}
        onClose={() => setShowExpenseModal(false)}
        entryType="expense"
        cashSessionId={session.id}
        schoolId={schoolId}
        onCreated={load}
      />
    </div>
  );
}
