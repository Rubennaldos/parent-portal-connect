import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useMaintenanceGuard } from '@/hooks/useMaintenanceGuard';
import { Button } from '@/components/ui/button';
import { Loader2, AlertTriangle, ArrowLeft, Lock, Building2 } from 'lucide-react';
import type { CashSession } from '@/types/cashRegisterV2';
import CashOpeningFlow from './CashOpeningFlow';
import CashDayDashboard from './CashDayDashboard';
import CashReconciliationDialog from './CashReconciliationDialog';
import TreasuryTransferFlow from './TreasuryTransferFlow';

interface School { id: string; name: string; }

export default function CashRegisterV2Page() {
  const { user } = useAuth();
  const { role } = useRole();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [schools, setSchools] = useState<School[]>([]);
  const [todaySession, setTodaySession] = useState<CashSession | null>(null);
  const [allSchoolIds, setAllSchoolIds] = useState<string[] | null>(null);

  const [showReconciliation, setShowReconciliation] = useState(false);
  const [showTreasury, setShowTreasury] = useState(false);

  const isAdminGeneral = role === 'admin_general' || role === 'superadmin';
  // gestor_unidad = "admin de sede": puede operar la caja de su sede
  const isAdminSede = role === 'gestor_unidad';
  // Cualquier tipo de admin: nunca es bloqueado por "Caja no abierta"
  const isAnyAdmin = isAdminGeneral || isAdminSede;

  const maintenance = useMaintenanceGuard('caja_admin', schoolId || undefined);

  // ── Cargar perfil / sedes ──────────────────────────────────────────────────

  useEffect(() => {
    if (!user) return;

    const init = async () => {
      setLoading(true);
      try {
        if (isAdminGeneral) {
          // Admin general: cargar todas las sedes para que elija
          const { data } = await supabase
            .from('schools')
            .select('id, name')
            .order('name');
          setSchools(data || []);
          // Si solo hay una sede, seleccionarla automáticamente
          if (data && data.length === 1) setSchoolId(data[0].id);
        } else {
          // Cajero / gestor: usa la sede de su perfil
          const { data: profile } = await supabase
            .from('profiles')
            .select('school_id')
            .eq('id', user.id)
            .single();
          setSchoolId(profile?.school_id || null);
        }
      } catch (err) {
        console.error('[CashRegisterV2] init error:', err);
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [user, isAdminGeneral]);

  // ── Cargar sesión del día cuando ya tenemos school_id ──────────────────────

  const loadSession = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    try {
      // EC-TZ: usar hora Lima para buscar la sesión del día correcto
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
      const { data: sessionData, error } = await supabase
        .from('cash_sessions')
        .select('*')
        .eq('school_id', schoolId)
        .eq('session_date', today)
        .maybeSingle();
      if (error) throw error;
      setTodaySession(sessionData || null);
    } catch (err) {
      console.error('[CashRegisterV2] loadSession error:', err);
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => { if (schoolId) loadSession(); }, [schoolId, loadSession]);

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

  // ── Cargando ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
      </div>
    );
  }

  // ── Admin general sin sede seleccionada → elegir sede ─────────────────────

  if (isAdminGeneral && !schoolId) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto p-4 sm:p-6">
          <div className="flex items-center gap-3 mb-8">
            <Button variant="ghost" size="icon" onClick={() => navigate('/dashboard')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Módulo de Cierre de Caja</h1>
              <p className="text-sm text-gray-500">Selecciona una sede para ver su caja</p>
            </div>
          </div>
          <div className="max-w-lg mx-auto space-y-3">
            {schools.length === 0 ? (
              <p className="text-center text-gray-400 py-10">No hay sedes registradas.</p>
            ) : (
              <>
                {/* Botón consolidado: todas las sedes */}
                {schools.length > 1 && (
                  <button
                    onClick={() => {
                      setAllSchoolIds(schools.map(s => s.id));
                      setSchoolId(schools[0].id);
                    }}
                    className="w-full flex items-center gap-4 bg-gradient-to-r from-indigo-600 to-blue-700 rounded-xl border-2 border-indigo-500 hover:from-indigo-700 hover:to-blue-800 p-5 transition-all text-left shadow-md hover:shadow-lg"
                  >
                    <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center shrink-0 text-2xl">
                      🌎
                    </div>
                    <div>
                      <p className="font-bold text-white text-lg">Ver Todas las Sedes</p>
                      <p className="text-sm text-indigo-200">Consolidado de {schools.length} sedes</p>
                    </div>
                  </button>
                )}

                <div className="border-t border-gray-200 pt-2 mt-1">
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-2 pl-1">O elige una sede</p>
                </div>

                {schools.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => { setSchoolId(s.id); setAllSchoolIds(null); }}
                    className="w-full flex items-center gap-4 bg-white rounded-xl border-2 border-gray-200 hover:border-blue-400 p-5 transition-all text-left shadow-sm hover:shadow-md"
                  >
                    <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
                      <Building2 className="h-6 w-6 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900 text-lg">{s.name}</p>
                      <p className="text-sm text-gray-500">Ver caja del día</p>
                    </div>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Sin sede asignada (cajero sin perfil configurado) ──────────────────────

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

  // ── Sin sesión / sesión cerrada ──────────────────────────────────────────
  // Cajeros normales: ven la pantalla de bloqueo.
  // Admins (general o sede): bypass — caen directo al dashboard con valores en 0.

  if (!todaySession || todaySession.status === 'closed') {
    if (!isAnyAdmin) {
      // ── CAJEROS: pantallas de bloqueo ──────────────────────────────────
      const schoolName = schools.find(s => s.id === schoolId)?.name;
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
                  {schoolName && <span className="font-medium text-blue-600">{schoolName} — </span>}
                  {todaySession?.status === 'closed' ? (
                    <span className="inline-flex items-center gap-1">
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
                <p className="text-gray-500">La caja de hoy fue cerrada. Puedes reabrirla si necesitas seguir operando.</p>
                <div className="flex gap-2 justify-center flex-wrap">
                  <Button
                    className="bg-emerald-600 hover:bg-emerald-700"
                    onClick={async () => {
                      if (!todaySession?.id) return;
                      const { error } = await supabase
                        .from('cash_sessions')
                        .update({ status: 'open', closed_at: null })
                        .eq('id', todaySession.id);
                      if (!error) loadSession();
                    }}
                  >
                    🔓 Reabrir Caja
                  </Button>
                  <Button variant="outline" onClick={() => navigate('/dashboard')}>Volver al Panel</Button>
                </div>
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
    // Admins: no se bloquean — caen al dashboard con bypass ↓
  }

  // ── Dashboard principal ────────────────────────────────────────────────────
  // Visible para: todos cuando sesión abierta; admins con bypass cuando no hay sesión.

  const schoolName = allSchoolIds
    ? '🌎 Todas las Sedes'
    : schools.find(s => s.id === schoolId)?.name;

  // Admin general: siempre solo lectura.
  // Admin sede: solo lectura si no hay sesión activa o está cerrada.
  // Cajero: nunca llega aquí sin sesión abierta (bloqueado arriba).
  const dashIsReadOnly = isAdminGeneral
    || !!allSchoolIds
    || !todaySession
    || todaySession?.status === 'closed';

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-6">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (isAdminGeneral) {
                setSchoolId(null);
                setAllSchoolIds(null);
              } else {
                navigate('/dashboard');
              }
            }}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Módulo de Cierre de Caja</h1>
            <p className="text-sm text-gray-500">
              {schoolName && <span className="font-medium text-blue-600">{schoolName} — </span>}
              Gestión del flujo de caja diario
            </p>
          </div>
        </div>

        <CashDayDashboard
          session={todaySession}
          schoolId={schoolId!}
          allSchoolIds={allSchoolIds ?? undefined}
          onCloseRequested={() => setShowReconciliation(true)}
          onTreasuryRequested={() => setShowTreasury(true)}
          onRefresh={loadSession}
          isReadOnly={dashIsReadOnly}
          isAdmin={isAnyAdmin}
        />

        {/* Diálogos de cierre y tesorería: solo cuando hay sesión activa */}
        {todaySession && (
          <>
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

            <TreasuryTransferFlow
              open={showTreasury}
              onClose={() => setShowTreasury(false)}
              session={todaySession}
              schoolId={schoolId}
            />
          </>
        )}
      </div>
    </div>
  );
}
