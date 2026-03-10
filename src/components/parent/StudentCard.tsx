import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Wallet, 
  CreditCard, 
  History,
  Settings2,
  Camera,
  TrendingDown,
  RefreshCw,
  Pencil,
  Clock,
  ShieldCheck,
  ArrowRight
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

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
  kiosk_disabled?: boolean;
  school?: { id: string; name: string } | null;
}

interface StudentCardProps {
  student: Student;
  totalDebt?: number;
  pendingRechargeAmount?: number;
  onRecharge: () => void;
  onViewHistory: () => void;
  onViewMenu: () => void;
  onOpenSettings: () => void;
  onPhotoClick: () => void;
  onEdit?: () => void;
}

export function StudentCard({
  student,
  totalDebt = 0,
  pendingRechargeAmount = 0,
  onRecharge,
  onViewHistory,
  onViewMenu,
  onOpenSettings,
  onPhotoClick,
  onEdit,
}: StudentCardProps) {
  const isFreeAccount = student.free_account !== false;
  const isPrepaid = !isFreeAccount;
  const prepaidBalance = isPrepaid ? student.balance : 0;
  const displayBalance = Math.max(0, prepaidBalance);
  const isActivePrepaid = isPrepaid && displayBalance > 0;
  const hasDebt = !isActivePrepaid ? totalDebt > 0 : false;

  const [spentPeriod, setSpentPeriod] = useState(0);

  const limitType = student.limit_type || 'none';
  const currentLimit = limitType === 'daily' ? student.daily_limit
    : limitType === 'weekly' ? student.weekly_limit
    : limitType === 'monthly' ? student.monthly_limit
    : 0;
  const limitRemaining = Math.max(0, currentLimit - spentPeriod);

  useEffect(() => {
    if (student.id && (limitType !== 'none' || isPrepaid)) {
      fetchSpentInPeriod();
    }
  }, [student.id, limitType, isPrepaid]);

  const fetchSpentInPeriod = async () => {
    try {
      let startDate: string;
      const now = new Date();

      if (limitType === 'daily') {
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      } else if (limitType === 'weekly') {
        const start = new Date(now);
        start.setDate(start.getDate() - start.getDay());
        start.setHours(0, 0, 0, 0);
        startDate = start.toISOString();
      } else {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        startDate = start.toISOString();
      }

      const { data } = await supabase
        .from('transactions')
        .select('amount, metadata')
        .eq('student_id', student.id)
        .eq('type', 'purchase')
        .neq('payment_status', 'cancelled')
        .gte('created_at', startDate);

      const kioscoOnly = data?.filter(t => !(t.metadata as any)?.lunch_order_id) || [];
      const total = kioscoOnly.reduce((sum, t) => sum + Math.abs(t.amount), 0);
      setSpentPeriod(total);
    } catch (err) {
      console.error('Error fetching spent:', err);
    }
  };

  const getLimitLabel = () => {
    if (limitType === 'daily') return 'Diario';
    if (limitType === 'weekly') return 'Semanal';
    if (limitType === 'monthly') return 'Mensual';
    return '';
  };

  return (
    <Card className="overflow-hidden border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow">
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
            </div>
            {student.school?.name && (
              <p className="text-xs text-gray-500 mt-0.5">{student.school.name}</p>
            )}
            <p className="text-[10px] text-gray-400 uppercase tracking-wider mt-0.5">
              {student.grade} · {student.section}
            </p>
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
                  {hasDebt ? 'Deuda' : isActivePrepaid ? 'Saldo' : 'Estado'}
                </p>
                <p className={`text-2xl font-bold mt-0.5 ${
                  hasDebt ? 'text-red-600' : isActivePrepaid ? 'text-blue-600' : 'text-green-600'
                }`}>
                  {hasDebt ? `S/ ${totalDebt.toFixed(2)}` : isActivePrepaid ? `S/ ${displayBalance.toFixed(2)}` : 'Al día'}
                </p>
              </div>
              <div className={`p-2 rounded-lg ${
                hasDebt ? 'bg-red-100' : isActivePrepaid ? 'bg-blue-100' : 'bg-green-100'
              }`}>
                {isActivePrepaid ? <CreditCard className="h-5 w-5 text-blue-500" /> : <Wallet className="h-5 w-5 text-gray-500" />}
              </div>
            </div>

            {/* Balance bar for prepaid */}
            {isActivePrepaid && (
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

        {/* Limit info (compact) */}
        {!isActivePrepaid && limitType !== 'none' && (
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
          {isActivePrepaid ? (
            <Badge variant="outline" className="text-[9px] py-0 px-2 border-blue-200 text-blue-600 bg-blue-50">Con Recargas</Badge>
          ) : (
            <Badge variant="outline" className="text-[9px] py-0 px-2 border-green-200 text-green-600 bg-green-50">Cuenta Libre</Badge>
          )}
          {limitType !== 'none' && !student.kiosk_disabled && (
            <Badge variant="outline" className="text-[9px] py-0 px-2 border-purple-200 text-purple-600 bg-purple-50">Tope {getLimitLabel()}</Badge>
          )}
          {student.kiosk_disabled && (
            <Badge variant="outline" className="text-[9px] py-0 px-2 border-orange-200 text-orange-600 bg-orange-50">Solo Almuerzo</Badge>
          )}
        </div>

        {/* Action buttons */}
        <div className="space-y-2 pt-1">
          {/* Recharge button (only for prepaid mode) */}
          {isPrepaid && !student.kiosk_disabled && (
            <Button
              onClick={onRecharge}
              variant="outline"
              size="sm"
              className="w-full h-9 text-xs border-blue-200 text-blue-700 hover:bg-blue-50"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              {displayBalance === 0 ? 'Cargar Saldo' : 'Recargar'}
            </Button>
          )}

          {/* Bottom row: History + Settings */}
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
              Configurar
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
