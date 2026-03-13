import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useMaintenanceGuard } from '@/hooks/useMaintenanceGuard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle, ArrowLeft, Lock } from 'lucide-react';
import type { CashSession } from '@/types/cashRegisterV2';
import CashOpeningFlow from './CashOpeningFlow';
import CashDayDashboard from './CashDayDashboard';
import CashReconciliationDialog from './CashReconciliationDialog';
import TreasuryTransferFlow from './TreasuryTransferFlow';

export default function CashRegisterV2Page() {
  const { user } = useAuth();
  const { role } = useRole();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [todaySession, setTodaySession] = useState<CashSession | null>(null);

  const [showReconciliation, setShowReconciliation] = useState(false);
  const [showTreasury, setShowTreasury] = useState(false);

  const maintenance = useMaintenanceGuard('caja_admin', schoolId || undefined);

  // ── Cargar perfil y sesión del día ─────────────────────────────────────────

  const loadSession = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    try {
      // 1. Obtener school_id del perfil del usuario
      const { data: profile } = await supabase
        .from('profiles')
        .select('school_id')
        .eq('id', user.id)
        .single();

      const sid = profile?.school_id;
      if (!sid) {
        setSchoolId(null);
        setLoading(false);
        return;
      }
      setSchoolId(sid);

      // 2. Buscar sesión de caja de hoy
      const today = new Date().toISOString().split('T')[0];
      const { data: sessionData, error } = await supabase
        .from('cash_sessions')
        .select('*')
        .eq('school_id', sid)
        .eq('session_date', today)
        .maybeSingle();

      if (error) throw error;
      setTodaySession(sessionData || null);
    } catch (err) {
      console.error('[CashRegisterV2] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { loadSession(); }, [loadSession]);

  // ── Bloqueo por mantenimiento ──────────────────────────────────────────────

  if (maintenance.blocked) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-6">
          <div className="w-20 h-20 mx-auto bg-red-100 rounded-full flex items-center justify-center">
            <AlertTriangle className="h-10 w-10 text-red-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{maintenance.title}</h1>
          <p className="text-gray-600">{maintenance.message}</p>
          <Button variant="outline" onClick={() => navigate('/dashboard')}>Volver al Panel</Button>
        </div>
      </div>
    );
  }

  // ── Estados de carga ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!schoolId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <AlertTriangle className="h-12 w-12 mx-auto text-amber-500" />
          <h2 className="text-xl font-bold">Sin sede asignada</h2>
          <p className="text-gray-500">Tu perfil no tiene una sede asignada. Contacta al administrador.</p>
          <Button variant="outline" onClick={() => navigate('/dashboard')}>Volver al Panel</Button>
        </div>
      </div>
    );
  }

  // ── Sin sesión abierta → mostrar apertura ──────────────────────────────────

  if (!todaySession || todaySession.status === 'closed') {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto p-4 sm:p-6">
          <div className="flex items-center gap-3 mb-6">
            <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Módulo de Cierre de Caja</h1>
              <p className="text-sm text-gray-500">
                {todaySession?.status === 'closed' ? (
                  <span className="flex items-center gap-1">
                    <Lock className="h-3.5 w-3.5" />
                    La caja de hoy ya fue cerrada
                  </span>
                ) : (
                  'No hay caja abierta para hoy'
                )}
              </p>
            </div>
          </div>

          {todaySession?.status === 'closed' ? (
            <div className="max-w-lg mx-auto text-center py-20 space-y-4">
              <div className="w-20 h-20 mx-auto bg-green-100 rounded-full flex items-center justify-center">
                <Lock className="h-10 w-10 text-green-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-800">Caja Cerrada</h2>
              <p className="text-gray-500">La caja de hoy ya fue cerrada y reconciliada. Vuelve mañana para abrir una nueva.</p>
              <Button variant="outline" onClick={() => navigate('/dashboard')}>Volver al Panel</Button>
            </div>
          ) : (
            <CashOpeningFlow
              schoolId={schoolId}
              onOpened={(session) => setTodaySession(session)}
            />
          )}
        </div>
      </div>
    );
  }

  // ── Sesión abierta → dashboard del día ─────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto p-4 sm:p-6">
        {/* Cabecera */}
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Módulo de Cierre de Caja</h1>
            <p className="text-sm text-gray-500">Gestión del flujo de caja diario</p>
          </div>
        </div>

        <CashDayDashboard
          session={todaySession}
          schoolId={schoolId}
          onCloseRequested={() => setShowReconciliation(true)}
          onTreasuryRequested={() => setShowTreasury(true)}
          onRefresh={loadSession}
        />

        {/* Diálogo de reconciliación */}
        <CashReconciliationDialog
          open={showReconciliation}
          onClose={() => setShowReconciliation(false)}
          session={todaySession}
          schoolId={schoolId}
          onClosed={() => {
            setShowReconciliation(false);
            loadSession();
          }}
        />

        {/* Flujo de transferencias a tesorería */}
        <TreasuryTransferFlow
          open={showTreasury}
          onClose={() => setShowTreasury(false)}
          session={todaySession}
          schoolId={schoolId}
        />
      </div>
    </div>
  );
}
