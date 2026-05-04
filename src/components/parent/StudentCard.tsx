import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { 
  Wallet, 
  CreditCard, 
  History,
  Settings2,
  Camera,
  TrendingDown,
  Pencil,
  Clock,
  ShieldCheck,
  AlertCircle,
  Wrench,
  Phone,
  Info,
  ChevronDown,
  ChevronUp,
  UtensilsCrossed,
  ShoppingBag,
  Settings,
} from 'lucide-react';

interface Student {
  id: string;
  full_name: string;
  photo_url: string | null;
  balance: number;
  daily_limit: number;
  weekly_limit: number;
  monthly_limit: number;
  limit_type: string;
  grade: string;
  section: string;
  is_active: boolean;
  free_account?: boolean;
  recharge_enabled?: boolean;
  kiosk_disabled?: boolean;
  school?: { id: string; name: string } | null;
}

interface StudentCardProps {
  student: Student;
  totalDebt?: number;
  lunchDebt?: number;
  kioskDebt?: number;
  pendingRechargeAmount?: number;
  onRecharge?: () => void;
  onViewHistory: () => void;
  onViewMenu?: () => void;
  onOpenSettings: () => void;
  onPhotoClick: () => void;
  onEdit?: () => void;
}

export function StudentCard({
  student,
  totalDebt = 0,
  lunchDebt = 0,
  kioskDebt = 0,
  pendingRechargeAmount = 0,
  onViewHistory,
  onOpenSettings,
  onPhotoClick,
  onEdit,
}: StudentCardProps) {
  const RECHARGES_MAINTENANCE = true;

  const isPrepaid = false;
  const isSaldoAFavorMode = false;
  const [showMaintenanceInfo, setShowMaintenanceInfo] = useState(false);
  const [showDebtDetail, setShowDebtDetail] = useState(false);
  const hasKioskDebt = kioskDebt > 0;
  const displayBalance = Math.max(0, student.balance ?? 0);
  const isActivePrepaid = false;
  // hasDebt = hay deuda de almuerzo (independiente del saldo del kiosco)
  const hasLunchDebt = lunchDebt > 0;
  const hasDebt = hasKioskDebt || hasLunchDebt;

  const [spentPeriod] = useState(0);

  // Topes de consumo — datos reales del alumno
  const limitType = student.limit_type || 'none';
  const currentLimit = limitType === 'daily'   ? (student.daily_limit   ?? 0)
                     : limitType === 'weekly'  ? (student.weekly_limit  ?? 0)
                     : limitType === 'monthly' ? (student.monthly_limit ?? 0)
                     : 0;
  const limitRemaining = Math.max(0, currentLimit - spentPeriod);
  const getLimitLabel = () =>
    limitType === 'daily' ? 'Diario' : limitType === 'weekly' ? 'Semanal' : limitType === 'monthly' ? 'Mensual' : '';

  return (
    <>
    <Card className="student-card-tutorial overflow-hidden border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow">
      {/* Top accent */}
      <div className={`h-1 ${hasDebt ? 'bg-red-400' : 'bg-gray-200'}`} />

      {/* Profile header */}
      <div className="p-4 pb-3">
        <div className="flex items-center gap-3">
          {/* Photo */}
          <div 
            className="w-14 h-14 rounded-full border border-gray-200 bg-gray-50 overflow-hidden cursor-pointer hover:opacity-80 transition-opacity flex-shrink-0 relative"
            onClick={onPhotoClick}
          >
            {student.photo_url ? (
              <img src={student.photo_url} alt={student.full_name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <span className="text-xl font-medium text-gray-400">{student.full_name.charAt(0).toUpperCase()}</span>
              </div>
            )}
            <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 bg-white rounded-full border border-gray-200 flex items-center justify-center">
              <Camera className="h-2.5 w-2.5 text-gray-400" />
            </div>
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <h3 className="text-base font-semibold text-gray-900 truncate">{student.full_name}</h3>
              {onEdit && (
                <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="flex-shrink-0 p-1 hover:bg-gray-100 rounded transition-colors">
                  <Pencil className="h-3 w-3 text-gray-400" />
                </button>
              )}
              <button
                id={`student-settings-btn-${student.id}`}
                onClick={(e) => { e.stopPropagation(); onOpenSettings(); }}
                className="flex-shrink-0 p-1 hover:bg-gray-100 rounded transition-colors"
                title="Configuración de topes"
              >
                <Settings className="h-3.5 w-3.5 text-gray-500 hover:text-gray-700 transition-colors" />
              </button>
            </div>
            {student.school?.name && (
              <p className="text-xs text-gray-500 mt-0.5">{student.school.name}</p>
            )}
            <p className="text-[10px] text-gray-400 uppercase tracking-wider mt-0.5">
              {student.grade} · {student.section}
            </p>
            {/* Badge de tope o kiosco desactivado */}
            {student.kiosk_disabled ? (
              <span className="inline-flex items-center gap-1 mt-1 text-[9px] font-semibold bg-red-100 text-red-700 border border-red-200 rounded-full px-2 py-0.5">
                🚫 Kiosco desactivado
              </span>
            ) : limitType !== 'none' && currentLimit > 0 ? (
              <span className="inline-flex items-center gap-1 mt-1 text-[9px] font-semibold bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
                🟠 Tope {getLimitLabel()}: S/ {currentLimit.toFixed(2)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <CardContent className="px-4 pb-4 pt-0 space-y-3">

        {/* Pending recharge notice (compact) */}
        {pendingRechargeAmount > 0 && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <Clock className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
            <p className="text-[11px] text-amber-700">
              Recarga en revisión: <strong>S/ {pendingRechargeAmount.toFixed(2)}</strong>
            </p>
          </div>
        )}

        {/* Financial info */}
        {!student.kiosk_disabled && (
          <div className={`rounded-lg p-3 border ${
            hasDebt ? 'bg-red-50 border-red-200' : isActivePrepaid ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'
          }`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">
                  {hasDebt
                    ? hasKioskDebt && hasLunchDebt
                      ? 'Deuda Total'
                      : hasLunchDebt
                      ? 'Deuda Almuerzos'
                      : 'Deuda Kiosco'
                    : isSaldoAFavorMode
                    ? 'Mi saldo a favor'
                    : isActivePrepaid
                    ? 'Recargas activas'
                    : 'Estado'}
                </p>
                <p className={`text-2xl font-bold mt-0.5 ${
                  hasDebt ? 'text-red-600' : isActivePrepaid ? 'text-blue-600' : 'text-green-600'
                }`}>
                  {hasDebt
                    ? `S/ ${(lunchDebt + (hasKioskDebt ? kioskDebt : 0)).toFixed(2)}`
                    : isActivePrepaid
                    ? `S/ ${displayBalance.toFixed(2)}`
                    : 'Al día'}
                </p>
                {hasDebt && (
                  <button
                    onClick={() => setShowDebtDetail(v => !v)}
                    className="flex items-center gap-1 text-[10px] text-red-500 mt-1 hover:text-red-700 font-medium"
                  >
                    {showDebtDetail ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    Ver desglose
                  </button>
                )}
                {isSaldoAFavorMode && !hasKioskDebt && (
                  <p className="text-[9px] text-blue-400 mt-0.5">Se sigue descontando hasta agotarse</p>
                )}
                {isActivePrepaid && !isSaldoAFavorMode && !hasKioskDebt && (
                  <p className="text-[9px] text-blue-400 mt-0.5">Solo para snacks y recreo</p>
                )}
              </div>
              <div className={`p-2 rounded-lg ${
                hasDebt ? 'bg-red-100' : isActivePrepaid ? 'bg-blue-100' : 'bg-green-100'
              }`}>
                {hasDebt
                  ? <AlertCircle className="h-5 w-5 text-red-500" />
                  : isActivePrepaid
                  ? <CreditCard className="h-5 w-5 text-blue-500" />
                  : <Wallet className="h-5 w-5 text-gray-500" />}
              </div>
            </div>

            {/* Desglose de deuda (expandible) */}
            {hasDebt && showDebtDetail && (
              <div className="mt-2 pt-2 border-t border-red-200 space-y-1.5">
                {hasKioskDebt && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <ShoppingBag className="h-3 w-3 text-red-400" />
                      <span className="text-[10px] text-red-700">Deuda Kiosco</span>
                    </div>
                    <span className="text-[10px] font-semibold text-red-700">S/ {kioskDebt.toFixed(2)}</span>
                  </div>
                )}
                {hasLunchDebt && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <UtensilsCrossed className="h-3 w-3 text-red-400" />
                      <span className="text-[10px] text-red-700">Deuda Almuerzos</span>
                    </div>
                    <span className="text-[10px] font-semibold text-red-700">S/ {lunchDebt.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between pt-1 border-t border-red-200">
                  <span className="text-[10px] font-bold text-red-800">Total</span>
                  <span className="text-[10px] font-bold text-red-800">
                    S/ {(lunchDebt + (hasKioskDebt ? kioskDebt : 0)).toFixed(2)}
                  </span>
                </div>
              </div>
            )}

            {/* Balance bar for prepaid (only if positive) */}
            {isActivePrepaid && !hasKioskDebt && (
              <div className="mt-2">
                <div className="h-1.5 bg-blue-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${displayBalance < 10 ? 'bg-amber-400' : 'bg-blue-500'}`}
                    style={{ width: `${Math.min(100, (displayBalance / Math.max(displayBalance, spentPeriod + displayBalance)) * 100)}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-gray-500">Consumido: S/ {spentPeriod.toFixed(2)}</span>
                  <span className="text-[10px] text-blue-600 font-medium">Queda: S/ {displayBalance.toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Kiosk disabled */}
        {student.kiosk_disabled && (
          <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
            <ShieldCheck className="h-3.5 w-3.5 text-orange-500 flex-shrink-0" />
            <p className="text-[11px] text-orange-700">Solo almuerzo — kiosco desactivado</p>
          </div>
        )}

        {/* Limit info - visible siempre que haya un tope configurado */}
        {limitType !== 'none' && currentLimit > 0 && (
          <div className="rounded-lg p-3 border border-gray-200 bg-gray-50">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <TrendingDown className="h-3 w-3 text-purple-500" />
                <span className="text-[10px] font-semibold text-gray-700">Tope {getLimitLabel()}</span>
              </div>
              <span className="text-xs font-bold text-purple-600">S/ {currentLimit.toFixed(2)}</span>
            </div>
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full ${
                  limitRemaining <= 0 ? 'bg-red-500' : limitRemaining < currentLimit * 0.3 ? 'bg-amber-500' : 'bg-purple-500'
                }`}
                style={{ width: `${currentLimit > 0 ? Math.min(100, (spentPeriod / currentLimit) * 100) : 0}%` }}
              />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-gray-500">Usado: S/ {spentPeriod.toFixed(2)}</span>
              <span className={`text-[10px] font-medium ${limitRemaining <= 0 ? 'text-red-600' : 'text-purple-600'}`}>
                {limitRemaining <= 0 ? 'Agotado' : `Queda: S/ ${limitRemaining.toFixed(2)}`}
              </span>
            </div>
          </div>
        )}

        {/* Status badges (compact row) */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="outline" className="text-[9px] py-0 px-2 border-gray-200 text-gray-500 bg-gray-50">
            Cuenta libre
          </Badge>
          {/* Badge de tope */}
          {limitType !== 'none' && currentLimit > 0 && !student.kiosk_disabled && (
            <Badge variant="outline" className="text-[9px] py-0 px-2 border-amber-200 text-amber-600 bg-amber-50">
              Tope {getLimitLabel()}: S/ {currentLimit.toFixed(2)}
            </Badge>
          )}
          {student.kiosk_disabled && (
            <Badge variant="outline" className="text-[9px] py-0 px-2 border-orange-200 text-orange-600 bg-orange-50">Solo Almuerzo</Badge>
          )}
        </div>

        {/* Info Modo Recargas (solo informativo, sin botón de recarga) */}
        {isPrepaid && !student.kiosk_disabled && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">
                {isSaldoAFavorMode ? 'Mi saldo a favor' : 'Monto recargado'}
              </span>
              <CreditCard className="h-3.5 w-3.5 text-gray-400" />
            </div>
            <p className="text-base font-semibold text-gray-700 mt-0.5">
              S/ {Math.max(0, student.balance ?? 0).toFixed(2)}
            </p>
            <p className="text-[9px] text-gray-400 mt-0.5">
              {isSaldoAFavorMode
                ? 'Te queda este saldo para seguir comprando en kiosco'
                : 'Solo para compras en el kiosco (snacks y recreo)'}
            </p>
          </div>
        )}

        {/* Nota aclaratoria recargas vs almuerzos */}
        {isPrepaid && !student.kiosk_disabled && !RECHARGES_MAINTENANCE && (
          <div className="bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
            <p className="text-[10px] text-sky-700 leading-relaxed">
              💡 <strong>Recargar</strong> = saldo para kiosco (snacks, recreo). Los <strong>almuerzos</strong> se pagan aparte desde la pestaña <strong>Pagos</strong>.
            </p>
          </div>
        )}

        {/* Banner de mantenimiento recargas/topes */}
        {RECHARGES_MAINTENANCE && isPrepaid && !student.kiosk_disabled && (
          <div className="bg-amber-50 border border-amber-300 rounded-lg px-3 py-2.5">
            <div className="flex items-start gap-2">
              <Wrench className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-amber-800 font-semibold leading-snug">
                  {isSaldoAFavorMode
                    ? 'Tus recargas están apagadas, pero tu saldo a favor sigue activo.'
                    : 'El módulo de Recargas y Topes está en mantenimiento para mejorarlo.'}
                </p>
                <p className="text-[10px] text-amber-700 mt-1 leading-relaxed">
                  {isSaldoAFavorMode ? (
                    <>Tu saldo a favor (<strong>S/ {displayBalance.toFixed(2)}</strong>) se sigue descontando normalmente en el kiosco.</>
                  ) : (
                    <>Su saldo actual (<strong>S/ {displayBalance.toFixed(2)}</strong>) sigue activo y se descuenta normalmente en el kiosco.</>
                  )}
                </p>
                <button
                  onClick={() => setShowMaintenanceInfo(true)}
                  className="text-[10px] text-amber-900 font-bold underline mt-1 hover:text-amber-700 flex items-center gap-1"
                >
                  <Info className="h-3 w-3" />
                  Más información
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="space-y-2 pt-1">
          {/* Bottom row: History + Settings (Settings siempre visible — topes independientes de recargas) */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={onViewHistory}
              variant="ghost"
              size="sm"
              className="h-9 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            >
              <History className="h-3.5 w-3.5 mr-1" />
              Historial
            </Button>
            <Button
              onClick={onOpenSettings}
              variant="ghost"
              size="sm"
              className="h-9 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            >
              <Settings2 className="h-3.5 w-3.5 mr-1" />
              Topes
            </Button>
          </div>
        </div>

      </CardContent>
    </Card>

    {/* ── Modales fuera de Card para evitar conflictos de z-index/portal ── */}

    {/* Modal informativo de mantenimiento */}
    <Dialog open={showMaintenanceInfo} onOpenChange={setShowMaintenanceInfo}>
      <DialogContent className="max-w-sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Wrench className="h-5 w-5 text-amber-600" />
            Mantenimiento del módulo de Recargas
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <p className="text-sm text-green-800 font-semibold">
              Su dinero se encuentra a salvo
            </p>
            <p className="text-xs text-green-700 mt-1 leading-relaxed">
              El saldo de su hijo/a será guardado y estará disponible una vez finalice el mantenimiento. No se planea que esta actualización tome más de tres días.
            </p>
          </div>

          {isPrepaid && displayBalance > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-xs text-blue-700">
                Saldo actual: <strong className="text-blue-900 text-sm">S/ {displayBalance.toFixed(2)}</strong>
              </p>
              <p className="text-[10px] text-blue-600 mt-0.5">
                Este saldo sigue activo para compras en el kiosco.
              </p>
            </div>
          )}

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <p className="text-xs text-gray-700 font-semibold flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5" />
              ¿Desea la devolución?
            </p>
            <p className="text-[11px] text-gray-600 mt-1 leading-relaxed">
              Contacte al <strong>991 236 870</strong> con el área de sistemas indicando su correo y pidiendo la devolución. Por <strong>WhatsApp</strong> únicamente.
            </p>
          </div>

          <Button
            onClick={() => setShowMaintenanceInfo(false)}
            className="w-full h-10 bg-amber-600 hover:bg-amber-700 text-white font-semibold"
          >
            Entendido
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  </>
  );
}
