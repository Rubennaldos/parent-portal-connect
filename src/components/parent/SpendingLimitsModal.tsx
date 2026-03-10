import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { 
  AlertCircle, 
  TrendingUp, 
  Calendar, 
  CalendarDays,
  Infinity,
  Loader2,
  DollarSign,
  Info,
  UtensilsCrossed,
  PowerOff,
  Wallet,
  CreditCard,
  RefreshCw
} from 'lucide-react';

interface SpendingLimitsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  studentName: string;
  onSuccess: () => void;
  onRequestRecharge?: (suggestedAmount?: number) => void;
}

type LimitType = 'none' | 'daily' | 'weekly' | 'monthly';
type AccountMode = 'free' | 'prepaid';

interface LimitConfig {
  limit_type: LimitType;
  daily_limit: number;
  weekly_limit: number;
  monthly_limit: number;
  free_account?: boolean;
}

export function SpendingLimitsModal({
  open,
  onOpenChange,
  studentId,
  studentName,
  onSuccess,
  onRequestRecharge
}: SpendingLimitsModalProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedType, setSelectedType] = useState<LimitType>('none');
  const [limitAmount, setLimitAmount] = useState('');
  const [currentConfig, setCurrentConfig] = useState<LimitConfig | null>(null);
  const [spentToday, setSpentToday] = useState(0);
  const [spentThisWeek, setSpentThisWeek] = useState(0);
  const [spentThisMonth, setSpentThisMonth] = useState(0);
  const [kioskDisabled, setKioskDisabled] = useState(false);
  const [accountMode, setAccountMode] = useState<AccountMode>('free');
  const [currentBalance, setCurrentBalance] = useState(0);

  useEffect(() => {
    if (open) {
      fetchCurrentConfig();
      fetchSpendingStats();
    }
  }, [open, studentId]);

  const fetchCurrentConfig = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('students')
        .select('limit_type, daily_limit, weekly_limit, monthly_limit, free_account, kiosk_disabled, balance')
        .eq('id', studentId)
        .single();

      if (error) throw error;

      setCurrentConfig(data);
      setSelectedType(data.limit_type || 'none');
      setKioskDisabled(data.kiosk_disabled ?? false);
      setAccountMode(data.free_account === false ? 'prepaid' : 'free');
      setCurrentBalance(data.balance || 0);
      if (data.limit_type === 'daily') setLimitAmount(String(data.daily_limit || 0));
      else if (data.limit_type === 'weekly') setLimitAmount(String(data.weekly_limit || 0));
      else if (data.limit_type === 'monthly') setLimitAmount(String(data.monthly_limit || 0));
      else setLimitAmount('0');
    } catch (error: any) {
      console.error('Error fetching limit config:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSpendingStats = async () => {
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const { data: todayData } = await supabase
        .from('transactions')
        .select('amount, metadata')
        .eq('student_id', studentId)
        .eq('type', 'purchase')
        .gte('created_at', todayStr);
      // Excluir almuerzos del cálculo de topes
      const today = (todayData || [])
        .filter(t => !(t.metadata as any)?.lunch_order_id)
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);
      setSpentToday(today);

      const startOfWeek = new Date();
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      const { data: weekData } = await supabase
        .from('transactions')
        .select('amount, metadata')
        .eq('student_id', studentId)
        .eq('type', 'purchase')
        .gte('created_at', startOfWeek.toISOString());
      const week = (weekData || [])
        .filter(t => !(t.metadata as any)?.lunch_order_id)
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);
      setSpentThisWeek(week);

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const { data: monthData } = await supabase
        .from('transactions')
        .select('amount, metadata')
        .eq('student_id', studentId)
        .eq('type', 'purchase')
        .gte('created_at', startOfMonth.toISOString());
      const month = (monthData || [])
        .filter(t => !(t.metadata as any)?.lunch_order_id)
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);
      setSpentThisMonth(month);
    } catch (error: any) {
      console.error('Error fetching spending stats:', error);
    }
  };

  const handleSave = async () => {
    const amount = parseFloat(limitAmount) || 0;

    if (selectedType !== 'none' && amount <= 0) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'El monto del tope debe ser mayor a 0',
      });
      return;
    }

    setSaving(true);
    try {
      const updateData: any = {
        limit_type: selectedType,
        daily_limit: selectedType === 'daily' ? amount : (currentConfig?.daily_limit || 0),
        weekly_limit: selectedType === 'weekly' ? amount : (currentConfig?.weekly_limit || 0),
        monthly_limit: selectedType === 'monthly' ? amount : (currentConfig?.monthly_limit || 0),
        kiosk_disabled: kioskDisabled,
        free_account: accountMode === 'free',
      };

      const { error } = await supabase
        .from('students')
        .update(updateData)
        .eq('id', studentId);

      if (error) throw error;

      const modeMsg = accountMode === 'free' ? 'Cuenta Libre' : 'Con Recargas';
      const limitMsg = selectedType === 'none'
        ? 'Sin tope'
        : `Tope ${selectedType === 'daily' ? 'diario' : selectedType === 'weekly' ? 'semanal' : 'mensual'}: S/ ${amount}`;

      toast({
        title: '✅ Configuración guardada',
        description: `${modeMsg} · ${limitMsg}`,
      });

      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error updating limits:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron actualizar los topes',
      });
    } finally {
      setSaving(false);
    }
  };

  const getLimitTypeLabel = () => {
    if (selectedType === 'daily') return 'Tope Diario';
    if (selectedType === 'weekly') return 'Tope Semanal';
    if (selectedType === 'monthly') return 'Tope Mensual';
    return 'Sin tope';
  };

  const limitOptions = [
    { value: 'none',    label: 'Sin tope',      icon: Infinity,     description: 'Compra libre (Recomendado)', color: 'text-emerald-500', spent: undefined },
    { value: 'daily',   label: 'Tope Diario',   icon: Calendar,     description: 'Control día a día',         color: 'text-blue-600',    spent: spentToday },
    { value: 'weekly',  label: 'Tope Semanal',  icon: CalendarDays, description: 'Control por semana',        color: 'text-purple-600',  spent: spentThisWeek },
    { value: 'monthly', label: 'Tope Mensual',  icon: TrendingUp,   description: 'Control por mes',           color: 'text-orange-600',  spent: spentThisMonth },
  ];

  if (loading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-[#8B4513]" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto border border-stone-200/50 bg-white shadow-2xl">
        <DialogHeader className="pb-4 sm:pb-6 px-4 sm:px-6">
          <div className="flex flex-col items-center text-center space-y-2">
            <div className="w-14 h-14 bg-gradient-to-br from-emerald-50/50 to-[#8B7355]/5 rounded-xl flex items-center justify-center border border-emerald-100/30 shadow-sm">
              <DollarSign className="h-7 w-7 text-emerald-600/80" />
            </div>
            <div>
              <DialogTitle className="text-xl sm:text-2xl font-light text-stone-800 tracking-wide">
                Configuración de Cuenta
              </DialogTitle>
              <DialogDescription className="text-xs sm:text-sm text-stone-500 mt-1.5 font-normal px-2">
                {studentName}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 px-4 sm:px-6 pb-6">

          {/* ═══════════════ SECCIÓN 1: MÉTODO DE TRABAJO ═══════════════ */}
          <div className="rounded-xl border-2 border-stone-200 bg-gradient-to-br from-stone-50/30 to-blue-50/10 p-4">
            <Label className="font-semibold text-[10px] sm:text-xs text-stone-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Wallet className="h-3.5 w-3.5" />
              Método de Trabajo
            </Label>
            <div className="grid grid-cols-2 gap-3">
              {/* Opción: Cuenta Libre */}
              <button
                type="button"
                onClick={() => setAccountMode('free')}
                className={`p-3 sm:p-4 rounded-xl border-2 transition-all text-left ${
                  accountMode === 'free'
                    ? 'border-emerald-500 bg-emerald-50/50 shadow-sm ring-1 ring-emerald-200'
                    : 'border-stone-200 hover:border-stone-300 bg-white'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    accountMode === 'free' ? 'bg-emerald-100' : 'bg-stone-100'
                  }`}>
                    <Wallet className={`h-4 w-4 ${accountMode === 'free' ? 'text-emerald-600' : 'text-stone-400'}`} />
                  </div>
                </div>
                <h4 className={`font-semibold text-xs sm:text-sm ${accountMode === 'free' ? 'text-emerald-700' : 'text-stone-600'}`}>
                  Cuenta Libre
                </h4>
                <p className="text-[10px] text-stone-500 mt-0.5 leading-relaxed">
                  Consume y paga al final del periodo
                </p>
                {accountMode === 'free' && (
                  <Badge className="mt-2 bg-emerald-100 text-emerald-700 border-emerald-200 text-[9px]">
                    ✓ Activo
                  </Badge>
                )}
              </button>

              {/* Opción: Con Recargas */}
              <button
                type="button"
                onClick={() => setAccountMode('prepaid')}
                className={`p-3 sm:p-4 rounded-xl border-2 transition-all text-left ${
                  accountMode === 'prepaid'
                    ? 'border-blue-500 bg-blue-50/50 shadow-sm ring-1 ring-blue-200'
                    : 'border-stone-200 hover:border-stone-300 bg-white'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    accountMode === 'prepaid' ? 'bg-blue-100' : 'bg-stone-100'
                  }`}>
                    <CreditCard className={`h-4 w-4 ${accountMode === 'prepaid' ? 'text-blue-600' : 'text-stone-400'}`} />
                  </div>
                </div>
                <h4 className={`font-semibold text-xs sm:text-sm ${accountMode === 'prepaid' ? 'text-blue-700' : 'text-stone-600'}`}>
                  Con Recargas
                </h4>
                <p className="text-[10px] text-stone-500 mt-0.5 leading-relaxed">
                  Recarga saldo y consume del saldo
                </p>
                {accountMode === 'prepaid' && (
                  <Badge className="mt-2 bg-blue-100 text-blue-700 border-blue-200 text-[9px]">
                    ✓ Activo
                  </Badge>
                )}
              </button>
            </div>

            {/* Info breve */}
            {accountMode === 'prepaid' && currentBalance > 0 && (
              <p className="mt-2 text-[11px] text-blue-600 px-1">Saldo actual: S/ {currentBalance.toFixed(2)}</p>
            )}
          </div>

          {/* ═══════════════ SECCIÓN 2: TOPES DE GASTO ═══════════════ */}
          {/* ── Tipo de Tope ── */}
          <div className="rounded-xl border-2 border-stone-200 bg-gradient-to-br from-stone-50/30 to-purple-50/10 p-4">
            <Label className="font-semibold text-[10px] sm:text-xs text-stone-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" />
              Tope de Gasto en el Kiosco
            </Label>
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              {limitOptions.map((option) => {
                const Icon = option.icon;
                const isSelected = selectedType === option.value;
                return (
                  <button
                    key={option.value}
                    onClick={() => {
                      setSelectedType(option.value as LimitType);
                      if (option.value === 'none') setLimitAmount('0');
                    }}
                    className={`p-3 sm:p-4 rounded-xl border transition-all text-left ${
                      isSelected
                        ? 'border-emerald-500/50 bg-emerald-50/30 shadow-sm'
                        : 'border-stone-200 hover:border-stone-300 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-1.5">
                      <Icon className={`h-4 w-4 sm:h-5 sm:w-5 ${isSelected ? 'text-emerald-600' : option.color}`} />
                      {option.spent !== undefined && (
                        <Badge variant="outline" className="text-[9px] font-medium border-stone-200">
                          S/ {option.spent.toFixed(2)}
                        </Badge>
                      )}
                    </div>
                    <h4 className={`font-medium text-xs sm:text-sm ${isSelected ? 'text-emerald-700' : 'text-stone-700'}`}>
                      {option.label}
                    </h4>
                    <p className="text-[10px] text-stone-500 mt-0.5">{option.description}</p>
                  </button>
                );
              })}
            </div>

            {/* ── Monto del Tope ── */}
            {selectedType !== 'none' && (
              <div className="mt-3 bg-white border border-stone-200 rounded-xl p-4">
                <Label htmlFor="limit-amount" className="font-medium text-[10px] sm:text-xs text-stone-600 uppercase tracking-wider mb-2 block">
                  Monto del {getLimitTypeLabel()}
                </Label>
                <div className="relative">
                  <span className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 text-xl font-medium text-stone-400">S/</span>
                  <Input
                    id="limit-amount"
                    type="number"
                    step="0.50"
                    value={limitAmount}
                    onChange={(e) => setLimitAmount(e.target.value)}
                    className="text-2xl sm:text-3xl font-medium h-14 sm:h-16 pl-12 sm:pl-14 border rounded-xl focus:border-emerald-500/50"
                    placeholder="0.00"
                  />
                </div>
                {/* Alerta si ya excede */}
                {((selectedType === 'daily' && spentToday > parseFloat(limitAmount || '0')) ||
                  (selectedType === 'weekly' && spentThisWeek > parseFloat(limitAmount || '0')) ||
                  (selectedType === 'monthly' && spentThisMonth > parseFloat(limitAmount || '0'))) && (
                  <p className="text-[11px] text-amber-700 mt-2 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    El gasto actual ya excede este tope
                  </p>
                )}
                <p className="text-[10px] text-stone-500 mt-2 flex items-center gap-1">
                  <Info className="h-3 w-3" />
                  Máximo que {studentName} puede gastar {selectedType === 'daily' ? 'por día' : selectedType === 'weekly' ? 'por semana' : 'por mes'} en el kiosco
                </p>
              </div>
            )}
          </div>

          {/* ── Kiosco ── */}
          <div className={`rounded-xl border-2 p-4 transition-all ${
            kioskDisabled ? 'border-red-300 bg-red-50' : 'border-stone-200 bg-stone-50/50'
          }`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 flex-1">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${kioskDisabled ? 'bg-red-100' : 'bg-stone-100'}`}>
                  {kioskDisabled
                    ? <PowerOff className="h-4 w-4 text-red-500" />
                    : <UtensilsCrossed className="h-4 w-4 text-stone-400" />
                  }
                </div>
                <div>
                  <p className={`font-semibold text-sm ${kioskDisabled ? 'text-red-700' : 'text-stone-700'}`}>
                    {kioskDisabled ? '🚫 Kiosco desactivado' : 'Desactivar kiosco'}
                  </p>
                  <p className="text-[11px] text-stone-500 mt-0.5 leading-relaxed">
                    {kioskDisabled
                      ? `${studentName} solo puede pedir almuerzo desde el calendario.`
                      : `${studentName} tiene acceso al kiosco. Desactiva si solo quieres almuerzos.`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setKioskDisabled(!kioskDisabled)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                  kioskDisabled ? 'bg-red-500' : 'bg-stone-200'
                }`}
                role="switch"
                aria-checked={kioskDisabled}
              >
                <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition ease-in-out duration-200 ${
                  kioskDisabled ? 'translate-x-5' : 'translate-x-0'
                }`} />
              </button>
            </div>
          </div>

          {/* ── Botones ── */}
          <div className="grid grid-cols-2 gap-2 sm:gap-3 pt-1">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="h-11 sm:h-12 rounded-xl border text-sm font-normal"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="h-11 sm:h-12 font-medium bg-gradient-to-r from-emerald-600/90 to-[#8B7355]/80 hover:from-emerald-700/90 hover:to-[#6B5744]/80 rounded-xl text-sm"
            >
              {saving ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Guardando...</>
              ) : (
                'Guardar Configuración'
              )}
            </Button>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
