import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Wallet, 
  CreditCard, 
  Smartphone, 
  History,
  Settings2,
  UtensilsCrossed,
  ChevronRight,
  Camera,
  Info,
  TrendingDown,
  RefreshCw
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  school?: { id: string; name: string } | null;
}

interface StudentCardProps {
  student: Student;
  totalDebt?: number;
  onRecharge: () => void;
  onViewHistory: () => void;
  onLunchFast: () => void;
  onViewMenu: () => void;
  onOpenSettings: () => void;
  onPhotoClick: () => void;
}

export function StudentCard({
  student,
  totalDebt = 0,
  onRecharge,
  onViewHistory,
  onLunchFast,
  onViewMenu,
  onOpenSettings,
  onPhotoClick,
}: StudentCardProps) {
  const isFreeAccount = student.free_account !== false;
  const isPrepaid = !isFreeAccount;
  
  // Para Cuenta Libre: deuda
  const hasDebt = isFreeAccount ? totalDebt > 0 : false;
  // Para Con Recargas: saldo
  const prepaidBalance = isPrepaid ? student.balance : 0;
  const hasLowBalance = isPrepaid && prepaidBalance < 5;

  // Spending stats for limit remaining
  const [spentPeriod, setSpentPeriod] = useState(0);
  const [loadingSpent, setLoadingSpent] = useState(false);

  const limitType = student.limit_type || 'none';
  const currentLimit = limitType === 'daily' ? student.daily_limit
    : limitType === 'weekly' ? student.weekly_limit
    : limitType === 'monthly' ? student.monthly_limit
    : 0;
  const limitRemaining = Math.max(0, currentLimit - spentPeriod);

  useEffect(() => {
    if (limitType !== 'none' && student.id) {
      fetchSpentInPeriod();
    }
  }, [student.id, limitType]);

  const fetchSpentInPeriod = async () => {
    setLoadingSpent(true);
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
        .select('amount')
        .eq('student_id', student.id)
        .eq('type', 'purchase')
        .neq('payment_status', 'cancelled')
        .gte('created_at', startDate);

      const total = data?.reduce((sum, t) => sum + Math.abs(t.amount), 0) || 0;
      setSpentPeriod(total);
    } catch (err) {
      console.error('Error fetching spent:', err);
    } finally {
      setLoadingSpent(false);
    }
  };

  const getLimitLabel = () => {
    if (limitType === 'daily') return 'hoy';
    if (limitType === 'weekly') return 'esta semana';
    if (limitType === 'monthly') return 'este mes';
    return '';
  };

  const getLimitTypeLabel = () => {
    if (limitType === 'daily') return 'Tope Diario';
    if (limitType === 'weekly') return 'Tope Semanal';
    if (limitType === 'monthly') return 'Tope Mensual';
    return '';
  };

  return (
    <Card className="overflow-hidden hover:shadow-lg transition-all duration-300 border border-stone-200/50 bg-white group">
      {/* Header bar */}
      <div className={`h-1.5 relative transition-colors duration-500 ${
        hasDebt ? 'bg-rose-400' 
        : hasLowBalance ? 'bg-amber-400'
        : 'bg-gradient-to-r from-emerald-500/70 via-[#8B7355] to-[#6B5744]'
      }`} />

      {/* Perfil */}
      <div className="px-6 pt-8 pb-4 relative">
        <div className="flex items-start gap-4">
          <div 
            className="w-20 h-20 rounded-2xl border border-stone-200/50 bg-gradient-to-br from-stone-50/50 to-emerald-50/20 overflow-hidden cursor-pointer hover:scale-105 transition-transform duration-300 shadow-sm flex-shrink-0"
            onClick={onPhotoClick}
          >
            {student.photo_url ? (
              <img 
                src={student.photo_url} 
                alt={student.full_name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-stone-100/50 to-emerald-50/30">
                <span className="text-2xl font-light text-stone-400">
                  {student.full_name.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </div>
          
          <div className="flex-1 pt-1">
            <h3 className="text-xl font-normal text-stone-800 leading-tight group-hover:text-emerald-700 transition-colors tracking-wide">
              {student.full_name}
            </h3>
            {student.school?.name && (
              <p className="text-xs font-semibold text-emerald-700 mt-1.5 tracking-wide">
                🏫 {student.school.name}
              </p>
            )}
            <p className="text-[10px] font-medium text-stone-400 uppercase tracking-[0.2em] mt-1">
              {student.grade} <span className="text-stone-300">·</span> {student.section}
            </p>
            
            <div className="flex gap-2 mt-3">
              {isFreeAccount ? (
                <Badge className="bg-emerald-50/80 text-emerald-700 hover:bg-emerald-100/80 border border-emerald-200/30 py-0.5 px-2.5 rounded-lg font-medium text-[9px] uppercase tracking-wider">
                  Cuenta Libre
                </Badge>
              ) : (
                <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200/30 py-0.5 px-2.5 rounded-lg font-medium text-[9px] uppercase tracking-wider">
                  Con Recargas
                </Badge>
              )}
              {limitType !== 'none' && (
                <Badge className="bg-purple-50 text-purple-600 border border-purple-200/30 py-0.5 px-2.5 rounded-lg font-medium text-[9px] uppercase tracking-wider">
                  {getLimitTypeLabel()}
                </Badge>
              )}
              {hasDebt && (
                <Badge className="bg-rose-50 text-rose-600 border-0 py-0.5 px-2.5 rounded-lg font-medium text-[9px] uppercase tracking-wider animate-pulse">
                  Deuda
                </Badge>
              )}
              {hasLowBalance && (
                <Badge className="bg-amber-50 text-amber-600 border-0 py-0.5 px-2.5 rounded-lg font-medium text-[9px] uppercase tracking-wider animate-pulse">
                  Saldo Bajo
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Icono de cámara */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPhotoClick();
          }}
          className="absolute top-20 left-20 w-8 h-8 bg-white rounded-xl shadow-sm border border-emerald-200/20 flex items-center justify-center hover:bg-emerald-50/30 transition-all active:scale-90"
        >
          <Camera className="h-4 w-4 text-stone-400 hover:text-emerald-600" />
        </button>
      </div>

      {/* Contenido */}
      <CardContent className="pb-6 px-6 pt-2">
        {/* ═══════════════════ SALDO / DEUDA DINÁMICO ═══════════════════ */}
        
        {/* ── CUENTA LIBRE ── */}
        {isFreeAccount && (
          <div className={`rounded-2xl p-5 mb-4 border transition-all duration-300 ${
            hasDebt ? 'bg-rose-50/30 border-rose-200/50' : 'bg-gradient-to-br from-stone-50/30 to-emerald-50/20 border-emerald-200/20'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`text-[9px] font-medium uppercase tracking-[0.2em] ${
                    hasDebt ? 'text-rose-500' : 'text-stone-400'
                  }`}>
                    {hasDebt ? 'Monto Adeudado' : 'Sin Deudas'}
                  </span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="text-stone-300 hover:text-emerald-500 transition-colors">
                        <Info className="h-3 w-3" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 shadow-lg border border-stone-200/50 rounded-2xl p-4" side="top" align="start">
                      <div className="space-y-2">
                        <h4 className="font-medium text-sm text-stone-800">
                          {hasDebt ? '💳 Cuenta Libre - Deuda' : '✅ Cuenta Libre'}
                        </h4>
                        <p className="text-xs text-stone-500 leading-relaxed">
                          {hasDebt 
                            ? `Consumos pendientes de pago. ${student.full_name} puede seguir consumiendo y pagas al final del mes.`
                            : `${student.full_name} no tiene consumos pendientes. Puede comprar libremente en la cafetería.`
                          }
                        </p>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <p className={`text-3xl font-light tracking-tight ${
                  hasDebt ? 'text-rose-600' : 'text-emerald-600'
                }`}>
                  {hasDebt ? `S/ ${totalDebt.toFixed(2)}` : '✓ Al día'}
                </p>
              </div>
              <div className={`p-3 rounded-xl ${
                hasDebt ? 'bg-rose-100/50 text-rose-500' : 'bg-emerald-100/60 text-emerald-600'
              }`}>
                <Wallet className="h-6 w-6" />
              </div>
            </div>
          </div>
        )}

        {/* ── CON RECARGAS ── */}
        {isPrepaid && (
          <div className={`rounded-2xl p-5 mb-4 border transition-all duration-300 ${
            hasLowBalance ? 'bg-amber-50/30 border-amber-200/50' : 'bg-gradient-to-br from-blue-50/20 to-emerald-50/20 border-blue-200/20'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`text-[9px] font-medium uppercase tracking-[0.2em] ${
                    hasLowBalance ? 'text-amber-500' : 'text-blue-500'
                  }`}>
                    Saldo Disponible
                  </span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="text-stone-300 hover:text-blue-500 transition-colors">
                        <Info className="h-3 w-3" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 shadow-lg border border-stone-200/50 rounded-2xl p-4" side="top" align="start">
                      <div className="space-y-2">
                        <h4 className="font-medium text-sm text-stone-800">💰 Saldo Recargado</h4>
                        <p className="text-xs text-stone-500 leading-relaxed">
                          Este es el saldo disponible de {student.full_name}. Se descuenta con cada compra. Cuando se agote, deberás recargar para que pueda seguir consumiendo.
                        </p>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <p className={`text-3xl font-light tracking-tight ${
                  hasLowBalance ? 'text-amber-600' : prepaidBalance > 0 ? 'text-blue-600' : 'text-stone-400'
                }`}>
                  S/ {prepaidBalance.toFixed(2)}
                </p>
                {hasLowBalance && (
                  <p className="text-[10px] text-amber-600 font-medium mt-1">
                    ⚠️ Saldo bajo — recarga pronto
                  </p>
                )}
              </div>
              <div className={`p-3 rounded-xl ${
                hasLowBalance ? 'bg-amber-100/50 text-amber-500' : 'bg-blue-100/50 text-blue-500'
              }`}>
                <CreditCard className="h-6 w-6" />
              </div>
            </div>
          </div>
        )}

        {/* ── INFO DE TOPE (si aplica) ── */}
        {limitType !== 'none' && (
          <div className="rounded-xl p-3 mb-4 border border-purple-100 bg-purple-50/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-3.5 w-3.5 text-purple-500" />
                <span className="text-[10px] font-medium text-purple-700 uppercase tracking-wider">
                  {getLimitTypeLabel()}
                </span>
              </div>
              <span className="text-xs font-bold text-purple-700">
                S/ {currentLimit.toFixed(2)}
              </span>
            </div>
            <div className="mt-2">
              {/* Barra de progreso */}
              <div className="h-2 bg-purple-100 rounded-full overflow-hidden">
                <div 
                  className={`h-full rounded-full transition-all ${
                    limitRemaining <= 0 ? 'bg-red-500' : 
                    limitRemaining < currentLimit * 0.3 ? 'bg-amber-500' : 'bg-purple-500'
                  }`}
                  style={{ width: `${currentLimit > 0 ? Math.min(100, (spentPeriod / currentLimit) * 100) : 0}%` }}
                />
              </div>
              <div className="flex justify-between mt-1.5">
                <span className="text-[10px] text-stone-500">
                  Usado {getLimitLabel()}: <span className="font-semibold text-stone-700">S/ {spentPeriod.toFixed(2)}</span>
                </span>
                <span className={`text-[10px] font-semibold ${
                  limitRemaining <= 0 ? 'text-red-600' : 'text-purple-700'
                }`}>
                  {limitRemaining <= 0 ? 'Tope alcanzado' : `Queda: S/ ${limitRemaining.toFixed(2)}`}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Botones */}
        <div className="space-y-3">
          <Button
            onClick={onLunchFast}
            className="w-full h-14 text-base font-medium bg-gradient-to-r from-emerald-600/90 via-[#8B7355] to-[#6B5744] hover:from-emerald-700/90 hover:via-[#6B5744] hover:to-[#5B4734] text-white shadow-md rounded-xl transition-all active:scale-95 tracking-wide"
          >
            <UtensilsCrossed className="h-5 w-5 mr-2" />
            LUNCH FAST!
          </Button>

          {/* Botón de Recargar / Pagar Deudas */}
          {(isPrepaid || hasDebt) && (
            <Button
              onClick={onRecharge}
              variant="outline"
              className={`w-full h-12 rounded-xl font-medium text-sm tracking-wide transition-all active:scale-95 ${
                hasDebt
                  ? 'border-rose-200 text-rose-600 hover:bg-rose-50 hover:border-rose-300'
                  : 'border-blue-200 text-blue-700 hover:bg-blue-50 hover:border-blue-300'
              }`}
            >
              {hasDebt ? (
                <>
                  <CreditCard className="h-4 w-4 mr-2" />
                  Pagar Deudas
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Recargar Saldo
                </>
              )}
            </Button>
          )}

          <div className="grid grid-cols-1 gap-3">
            <Button
              onClick={onViewHistory}
              variant="ghost"
              className="h-11 rounded-xl text-stone-500 font-normal hover:bg-emerald-50/30 hover:text-emerald-700 transition-all text-xs tracking-wide"
            >
              <History className="h-4 w-4 mr-1.5" />
              Historial
            </Button>
          </div>

          {/* ⚙️ Configuración de Topes */}
          <button
            onClick={onOpenSettings}
            className="w-full pt-2 flex items-center justify-center gap-2 text-stone-400 hover:text-emerald-600 transition-colors cursor-pointer group/btn"
          >
            <Settings2 className="h-5 w-5 group-hover/btn:rotate-90 transition-transform duration-300" />
            <span className="text-xs font-medium">Configuración de Topes</span>
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
