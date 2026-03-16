import { useState, useRef } from 'react';
import { AlertTriangle, Lock, ArrowRight, Banknote, KeyRound, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface Props {
  schoolId: string;
  // Última caja cerrada (para referencia de monto)
  lastClosedAmount?: number | null;
  // Caja sin cerrar de día anterior
  hasUnclosedPrevious?: boolean;
  previousUnclosed?: any | null;
  onOpened: () => void; // callback cuando se abre exitosamente
}

export function CashOpeningModal({
  schoolId,
  lastClosedAmount,
  hasUnclosedPrevious,
  previousUnclosed,
  onOpened,
}: Props) {
  const { user } = useAuth();
  const [step, setStep] = useState<'unclosed_warning' | 'admin_password' | 'declaration'>(
    hasUnclosedPrevious ? 'unclosed_warning' : 'declaration'
  );
  const [loading, setLoading] = useState(false);
  const [closingPrevious, setClosingPrevious] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [validatingPassword, setValidatingPassword] = useState(false);
  const isSubmittingRef = useRef(false);

  const handleRequestForceClose = () => {
    setAdminPassword('');
    setPasswordError('');
    setStep('admin_password');
  };

  const [authorizedAdminId, setAuthorizedAdminId] = useState<string | null>(null);

  const handleValidateAdminPassword = async () => {
    if (!adminPassword.trim()) {
      setPasswordError('Ingresa la contraseña del administrador');
      return;
    }
    setValidatingPassword(true);
    setPasswordError('');
    try {
      const { data: adminUser, error } = await supabase.rpc('validate_admin_password', {
        p_password: adminPassword
      });
      if (error || !adminUser) {
        setPasswordError('Contraseña incorrecta. Usa la contraseña del administrador general o de sede.');
        return;
      }
      setAuthorizedAdminId(typeof adminUser === 'string' ? adminUser : adminUser?.id || null);
      await forceClosePrevious(typeof adminUser === 'string' ? adminUser : adminUser?.id || null);
    } catch {
      setPasswordError('Error al validar la contraseña');
    } finally {
      setValidatingPassword(false);
    }
  };

  const forceClosePrevious = async (adminId?: string | null) => {
    if (!previousUnclosed || !user?.id) return;
    setClosingPrevious(true);
    try {
      const closureDate = format(new Date(previousUnclosed.opened_at), 'yyyy-MM-dd');

      // Crear registro de cierre forzado en cash_closures para que quede en historial
      await supabase.from('cash_closures').insert({
        cash_register_id: previousUnclosed.id,
        school_id: schoolId,
        closure_date: closureDate,
        initial_amount: previousUnclosed.initial_amount || 0,
        expected_final: previousUnclosed.initial_amount || 0,
        actual_final: 0,
        difference: -(previousUnclosed.initial_amount || 0),
        total_sales: 0,
        total_cash: 0,
        total_card: 0,
        total_yape: 0,
        total_yape_qr: 0,
        total_credit: 0,
        total_ingresos: 0,
        total_egresos: 0,
        pos_cash: 0, pos_card: 0, pos_yape: 0, pos_yape_qr: 0, pos_credit: 0,
        pos_mixed_cash: 0, pos_mixed_card: 0, pos_mixed_yape: 0, pos_total: 0,
        lunch_cash: 0, lunch_credit: 0, lunch_card: 0, lunch_yape: 0, lunch_total: 0,
        closed_by: user.id,
      });

      await supabase
        .from('cash_registers')
        .update({
          status: 'closed',
          closed_at: new Date().toISOString(),
          closed_by: user.id,
          admin_password_validated: true,
          notes: `Cierre forzado autorizado por admin (${adminId || 'unknown'}) — ${new Date().toISOString()}`,
        })
        .eq('id', previousUnclosed.id);

      toast.warning('⚠️ Caja anterior cerrada de forma forzada. Revisa el historial.');
      setStep('declaration');
    } catch (error) {
      toast.error('Error al cerrar caja anterior');
    } finally {
      setClosingPrevious(false);
    }
  };

  const handleOpen = async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setLoading(true);
    try {
      // Usar hora Lima para la fecha de sesión
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });

      // Verificar que no exista ya una sesión abierta hoy (doble clic / doble envío)
      const { data: existing } = await supabase
        .from('cash_sessions')
        .select('id')
        .eq('school_id', schoolId)
        .eq('session_date', today)
        .maybeSingle();

      if (existing) {
        // Ya existe — simplemente notificar y continuar
        toast.success('✅ Caja ya estaba abierta para hoy');
        onOpened();
        return;
      }

      const { error } = await supabase
        .from('cash_sessions')
        .insert({
          school_id: schoolId,
          session_date: today,
          opened_by: user?.id,
          initial_cash: 0,
          initial_yape: 0,
          initial_plin: 0,
          initial_other: 0,
          status: 'open',
        });

      if (error) throw error;

      toast.success('✅ Caja abierta — ¡Buena jornada!');
      onOpened();
    } catch (error: any) {
      isSubmittingRef.current = false;
      toast.error('Error al abrir caja: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── PANTALLA: CAJA ANTERIOR SIN CERRAR ────────────────────────────
  if (step === 'unclosed_warning') {
    const prevDate = previousUnclosed?.opened_at
      ? format(new Date(previousUnclosed.opened_at), "EEEE dd 'de' MMMM", { locale: es })
      : 'día anterior';

    return (
      <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
          {/* Header rojo */}
          <div className="bg-red-600 text-white p-6 text-center">
            <AlertTriangle className="h-14 w-14 mx-auto mb-3" />
            <h2 className="text-2xl font-black uppercase tracking-wide">
              ¡Caja sin cerrar!
            </h2>
            <p className="text-red-100 text-sm mt-1">
              Tienes una caja del {prevDate} que no fue cerrada
            </p>
          </div>

          {/* Cuerpo */}
          <div className="p-6 space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800 space-y-1">
              <p className="font-bold">📅 Fecha de apertura: {prevDate}</p>
              <p>💰 Monto inicial: S/ {previousUnclosed?.initial_amount?.toFixed(2) ?? '0.00'}</p>
              <p className="text-xs text-red-600 mt-2">
                No puedes abrir una nueva caja sin cerrar la anterior. Esto ayuda a mantener
                el registro correcto de todas las operaciones.
              </p>
            </div>

            <p className="text-sm text-gray-600 text-center">
              Si no puedes hacer el cierre completo ahora, puedes forzar el cierre
              de la caja anterior. <strong>Esto quedará registrado.</strong>
            </p>

            <div className="space-y-2">
              <Button
                onClick={() => window.location.href = '/#/cash-register'}
                className="w-full bg-red-600 hover:bg-red-700"
              >
                <Lock className="h-4 w-4 mr-2" />
                Ir a Cerrar Caja del {prevDate}
              </Button>
              <Button
                variant="outline"
                onClick={handleRequestForceClose}
                className="w-full border-red-300 text-red-700 hover:bg-red-50"
              >
                ⚠️ Forzar cierre y continuar (requiere contraseña admin)
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── PANTALLA: CONTRASEÑA ADMIN PARA FORZAR CIERRE ────────────────
  if (step === 'admin_password') {
    return (
      <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
          <div className="bg-amber-600 text-white p-6 text-center">
            <KeyRound className="h-14 w-14 mx-auto mb-3" />
            <h2 className="text-2xl font-black uppercase tracking-wide">
              Autorización Requerida
            </h2>
            <p className="text-amber-100 text-sm mt-1">
              Ingresa la contraseña del administrador general o de sede
            </p>
          </div>

          <div className="p-6 space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
              <p className="font-bold">Esta acción queda registrada</p>
              <p className="text-xs mt-1">
                El cierre forzado de la caja anterior será registrado con la fecha, hora y usuario que lo autorizó.
              </p>
            </div>

            <div>
              <label className="text-sm font-semibold text-gray-700 block mb-1">
                Contraseña del Administrador *
              </label>
              <Input
                type="password"
                value={adminPassword}
                onChange={(e) => { setAdminPassword(e.target.value); setPasswordError(''); }}
                placeholder="Ingresa la contraseña"
                className="h-12 text-center border-2 border-amber-300 focus:border-amber-500"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleValidateAdminPassword()}
              />
              {passwordError && (
                <p className="text-red-600 text-xs mt-1 font-semibold">{passwordError}</p>
              )}
            </div>

            <div className="space-y-2">
              <Button
                onClick={handleValidateAdminPassword}
                disabled={validatingPassword || !adminPassword.trim()}
                className="w-full bg-amber-600 hover:bg-amber-700 h-12 font-bold"
              >
                {validatingPassword ? 'Validando...' : '🔓 Autorizar y Forzar Cierre'}
              </Button>
              <Button
                variant="outline"
                onClick={() => setStep('unclosed_warning')}
                className="w-full"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Volver
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── PANTALLA: DECLARACIÓN DE APERTURA ─────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header verde */}
        <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 text-white p-6 text-center">
          <Banknote className="h-14 w-14 mx-auto mb-3" />
          <h2 className="text-2xl font-black uppercase tracking-wide">
            Apertura de Caja
          </h2>
          <p className="text-emerald-100 text-sm mt-1">
            {format(new Date(), "EEEE dd 'de' MMMM yyyy", { locale: es })}
          </p>
        </div>

        {/* Cuerpo */}
        <div className="p-6 space-y-5">
          <div className="text-center">
            <p className="text-gray-700 font-medium text-lg">
              ¿Listo para iniciar la jornada?
            </p>
            <p className="text-gray-500 text-sm mt-1">
              Al confirmar, la caja quedará abierta y podrás registrar ventas.
            </p>
          </div>

          {lastClosedAmount != null && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center text-sm text-emerald-800">
              💰 Último cierre registrado: <strong>S/ {lastClosedAmount.toFixed(2)}</strong>
            </div>
          )}

          {/* Botón principal */}
          <Button
            onClick={handleOpen}
            disabled={loading}
            className="w-full h-14 text-lg font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40"
          >
            {loading ? (
              'Abriendo caja...'
            ) : (
              <>
                <ArrowRight className="h-5 w-5 mr-2" />
                Iniciar Jornada
              </>
            )}
          </Button>

          <p className="text-xs text-gray-400 text-center">
            El monto de apertura se gestiona desde el módulo de Cierre de Caja.
          </p>
        </div>
      </div>
    </div>
  );
}
