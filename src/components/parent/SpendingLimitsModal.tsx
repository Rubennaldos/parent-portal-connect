import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
  ShieldAlert,
  Check,
  Wallet,
  CreditCard
} from 'lucide-react';

interface SpendingLimitsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  studentName: string;
  onSuccess: () => void;
}

type LimitType = 'none' | 'daily' | 'weekly' | 'monthly';

interface LimitConfig {
  limit_type: LimitType;
  daily_limit: number;
  weekly_limit: number;
  monthly_limit: number;
}

export function SpendingLimitsModal({
  open,
  onOpenChange,
  studentId,
  studentName,
  onSuccess
}: SpendingLimitsModalProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedType, setSelectedType] = useState<LimitType>('none'); // Por defecto: Compra Inteligente
  const [limitAmount, setLimitAmount] = useState('');
  const [currentConfig, setCurrentConfig] = useState<LimitConfig | null>(null);
  const [spentToday, setSpentToday] = useState(0);
  const [spentThisWeek, setSpentThisWeek] = useState(0);
  const [spentThisMonth, setSpentThisMonth] = useState(0);
  const [showWarning, setShowWarning] = useState(false);
  const [pendingType, setPendingType] = useState<LimitType | null>(null);
  const [accountMode, setAccountMode] = useState<'free' | 'prepaid'>('free'); // Por defecto: Cuenta Libre
  const [showModeChangeWarning, setShowModeChangeWarning] = useState(false);
  const [pendingMode, setPendingMode] = useState<'free' | 'prepaid' | null>(null);

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
        .select('limit_type, daily_limit, weekly_limit, monthly_limit, free_account')
        .eq('id', studentId)
        .single();

      if (error) throw error;

      setCurrentConfig(data);
      // Cargar la configuración actual del alumno
      setSelectedType(data.limit_type || 'none');
      setAccountMode(data.free_account ? 'free' : 'prepaid');
      // Cargar el monto del tope actual
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
      // Gasto hoy
      const { data: todayData } = await supabase
        .from('transactions')
        .select('amount')
        .eq('student_id', studentId)
        .eq('type', 'purchase')
        .gte('created_at', new Date().toISOString().split('T')[0]);

      const today = todayData?.reduce((sum, t) => sum + Math.abs(t.amount), 0) || 0;
      setSpentToday(today);

      // Gasto esta semana
      const startOfWeek = new Date();
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      
      const { data: weekData } = await supabase
        .from('transactions')
        .select('amount')
        .eq('student_id', studentId)
        .eq('type', 'purchase')
        .gte('created_at', startOfWeek.toISOString());

      const week = weekData?.reduce((sum, t) => sum + Math.abs(t.amount), 0) || 0;
      setSpentThisWeek(week);

      // Gasto este mes
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      
      const { data: monthData } = await supabase
        .from('transactions')
        .select('amount')
        .eq('student_id', studentId)
        .eq('type', 'purchase')
        .gte('created_at', startOfMonth.toISOString());

      const month = monthData?.reduce((sum, t) => sum + Math.abs(t.amount), 0) || 0;
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
        free_account: accountMode === 'free', // true = Cuenta Libre, false = Con Recargas
      };

      const { error } = await supabase
        .from('students')
        .update(updateData)
        .eq('id', studentId);

      if (error) throw error;

      toast({
        title: '✅ Configuración actualizada',
        description: `${accountMode === 'free' ? 'Cuenta Libre' : 'Con Recargas'} - ${getLimitMessage()}`,
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

  const handleModeChange = (newMode: 'free' | 'prepaid') => {
    // Si intenta salir de cuenta libre, mostrar advertencia
    if (accountMode === 'free' && newMode === 'prepaid') {
      setPendingMode(newMode);
      setShowModeChangeWarning(true);
    } else {
      setAccountMode(newMode);
    }
  };

  const confirmModeChange = () => {
    if (pendingMode) {
      setAccountMode(pendingMode);
      setShowModeChangeWarning(false);
      setPendingMode(null);
    }
  };

  const cancelModeChange = () => {
    setShowModeChangeWarning(false);
    setPendingMode(null);
  };

  const handleTypeChange = (newType: LimitType) => {
    // Si está en "Compra Inteligente" (none) y quiere cambiar a un tope, mostrar advertencia
    if (selectedType === 'none' && newType !== 'none') {
      setPendingType(newType);
      setShowWarning(true);
    } else {
      setSelectedType(newType);
      if (newType === 'none') {
        setLimitAmount('0');
      }
    }
  };

  const confirmTypeChange = () => {
    if (pendingType) {
      setSelectedType(pendingType);
      setShowWarning(false);
      setPendingType(null);
    }
  };

  const cancelTypeChange = () => {
    setShowWarning(false);
    setPendingType(null);
  };

  const getLimitMessage = () => {
    if (selectedType === 'none') return 'Modo Compra Inteligente activado';
    if (selectedType === 'daily') return `Tope diario: S/ ${limitAmount}`;
    if (selectedType === 'weekly') return `Tope semanal: S/ ${limitAmount}`;
    if (selectedType === 'monthly') return `Tope mensual: S/ ${limitAmount}`;
    return '';
  };

  const limitOptions = [
    { 
      value: 'none', 
      label: '🎯 Compra Inteligente', 
      icon: Infinity,
      description: 'Sin restricciones (Recomendado)',
      color: 'text-emerald-500'
    },
    { 
      value: 'daily', 
      label: 'Tope Diario', 
      icon: Calendar,
      description: 'Control día a día',
      color: 'text-blue-600',
      spent: spentToday
    },
    { 
      value: 'weekly', 
      label: 'Tope Semanal', 
      icon: CalendarDays,
      description: 'Control por semana',
      color: 'text-purple-600',
      spent: spentThisWeek
    },
    { 
      value: 'monthly', 
      label: 'Tope Mensual', 
      icon: TrendingUp,
      description: 'Control por mes',
      color: 'text-orange-600',
      spent: spentThisMonth
    },
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
          <div className="flex flex-col items-center text-center space-y-2 sm:space-y-3">
            <div className="w-14 h-14 sm:w-16 sm:h-16 bg-gradient-to-br from-emerald-50/50 to-[#8B7355]/5 rounded-xl sm:rounded-2xl flex items-center justify-center border border-emerald-100/30 shadow-sm">
              <DollarSign className="h-7 w-7 sm:h-8 sm:w-8 text-emerald-600/80" />
            </div>
            <div>
              <DialogTitle className="text-xl sm:text-2xl font-light text-stone-800 tracking-wide">
                Límites de Gasto
              </DialogTitle>
              <DialogDescription className="text-xs sm:text-sm text-stone-500 mt-1.5 sm:mt-2 font-normal px-2">
                Configura topes para {studentName}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 sm:space-y-6 px-4 sm:px-6 pb-6">
          {/* Selector de Método de Trabajo */}
          {/* Selector de Método de Trabajo */}
          <div>
            <Label className="font-medium text-[10px] sm:text-xs text-stone-600 uppercase tracking-wider mb-2 sm:mb-3 block">
              Método de Trabajo
            </Label>
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              {/* Cuenta Libre */}
              <button
                onClick={() => setAccountMode('free')}
                className={`p-3 sm:p-4 rounded-xl border transition-all text-left ${
                  accountMode === 'free'
                    ? 'border-emerald-500/50 bg-emerald-50/30 shadow-sm'
                    : 'border-stone-200 hover:border-stone-300 bg-white'
                }`}
              >
                <div className="flex items-center gap-1.5 sm:gap-2 mb-1 sm:mb-1.5">
                  <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center ${
                    accountMode === 'free' ? 'bg-emerald-100/60' : 'bg-stone-100'
                  }`}>
                    <Wallet className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${
                      accountMode === 'free' ? 'text-emerald-600' : 'text-stone-400'
                    }`} />
                  </div>
                  {accountMode === 'free' && (
                    <Badge className="bg-emerald-600 text-white text-[9px] sm:text-xs px-1.5 sm:px-2 py-0">ACTIVO</Badge>
                  )}
                </div>
                <h4 className={`font-medium text-xs sm:text-sm ${
                  accountMode === 'free' ? 'text-emerald-700' : 'text-stone-600'
                }`}>
                  Cuenta Libre
                </h4>
                <p className="text-[10px] sm:text-xs text-stone-500 mt-0.5">Pagas al final del mes</p>
              </button>

              {/* Con Recargas - Habilitado */}
              <button
                onClick={() => handleModeChange('prepaid')}
                className={`p-3 sm:p-4 rounded-xl border transition-all text-left ${
                  accountMode === 'prepaid'
                    ? 'border-blue-500/50 bg-blue-50/30 shadow-sm'
                    : 'border-stone-200 hover:border-stone-300 bg-white'
                }`}
              >
                <div className="flex items-center gap-1.5 sm:gap-2 mb-1 sm:mb-1.5">
                  <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center ${
                    accountMode === 'prepaid' ? 'bg-blue-100/60' : 'bg-stone-100'
                  }`}>
                    <CreditCard className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${
                      accountMode === 'prepaid' ? 'text-blue-600' : 'text-stone-400'
                    }`} />
                  </div>
                  {accountMode === 'prepaid' && (
                    <Badge className="bg-blue-600 text-white text-[9px] sm:text-xs px-1.5 sm:px-2 py-0">ACTIVO</Badge>
                  )}
                </div>
                <h4 className={`font-medium text-xs sm:text-sm ${
                  accountMode === 'prepaid' ? 'text-blue-700' : 'text-stone-600'
                }`}>
                  Con Recargas
                </h4>
                <p className="text-[10px] sm:text-xs text-stone-500 mt-0.5">Recargas anticipadas</p>
              </button>
            </div>
          </div>

          {/* Selector de Tipo de Límite */}
          <div>
            <Label className="font-medium text-[10px] sm:text-xs text-stone-600 uppercase tracking-wider mb-2 sm:mb-3 block">
              Tipo de Límite
            </Label>
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              {limitOptions.map((option) => {
                const Icon = option.icon;
                const isSelected = selectedType === option.value;
                
                return (
                  <button
                    key={option.value}
                    onClick={() => handleTypeChange(option.value as LimitType)}
                    className={`p-3 sm:p-4 rounded-xl border transition-all text-left ${
                      isSelected
                        ? 'border-emerald-500/50 bg-emerald-50/30 shadow-sm'
                        : 'border-stone-200 hover:border-stone-300 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-1.5 sm:mb-2">
                      <Icon className={`h-4 w-4 sm:h-5 sm:w-5 ${isSelected ? 'text-emerald-600' : option.color}`} />
                      {option.spent !== undefined && (
                        <Badge variant="outline" className="text-[9px] sm:text-xs font-medium border-stone-200">
                          S/ {option.spent.toFixed(2)}
                        </Badge>
                      )}
                    </div>
                    <h4 className={`font-medium text-xs sm:text-sm ${isSelected ? 'text-emerald-700' : 'text-stone-700'}`}>
                      {option.label.replace('🎯 ', '')}
                    </h4>
                    <p className="text-[10px] sm:text-xs text-stone-500 mt-0.5">{option.description}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Input de Monto */}
          {selectedType !== 'none' && (
            <div className="bg-stone-50/50 border border-stone-200/50 rounded-xl p-4 sm:p-5">
              <Label htmlFor="limit-amount" className="font-medium text-[10px] sm:text-xs text-stone-600 uppercase tracking-wider mb-2 block">
                Monto del Tope {selectedType === 'daily' ? 'Diario' : selectedType === 'weekly' ? 'Semanal' : 'Mensual'}
              </Label>
              <div className="relative">
                <span className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 text-xl sm:text-2xl font-medium text-stone-400">
                  S/
                </span>
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
              <p className="text-[10px] sm:text-xs text-stone-500 mt-2 flex items-center gap-1">
                <Info className="h-3 w-3" />
                Este será el máximo que {studentName} podrá gastar {selectedType === 'daily' ? 'por día' : selectedType === 'weekly' ? 'por semana' : 'por mes'}
              </p>
            </div>
          )}

          {/* Advertencia si hay gasto actual */}
          {selectedType !== 'none' && parseFloat(limitAmount) > 0 && (
            <div className="bg-amber-50/50 border border-amber-200/30 rounded-xl p-3 sm:p-4 flex gap-2 sm:gap-3">
              <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-medium text-amber-900 text-xs sm:text-sm mb-1">Gasto Actual:</h4>
                <p className="text-xs sm:text-sm text-amber-800">
                  {selectedType === 'daily' && `Hoy: S/ ${spentToday.toFixed(2)}`}
                  {selectedType === 'weekly' && `Esta semana: S/ ${spentThisWeek.toFixed(2)}`}
                  {selectedType === 'monthly' && `Este mes: S/ ${spentThisMonth.toFixed(2)}`}
                </p>
                {((selectedType === 'daily' && spentToday > parseFloat(limitAmount)) ||
                  (selectedType === 'weekly' && spentThisWeek > parseFloat(limitAmount)) ||
                  (selectedType === 'monthly' && spentThisMonth > parseFloat(limitAmount))) && (
                  <p className="text-[10px] sm:text-xs text-amber-700 mt-1 font-medium">
                    ⚠️ El gasto actual ya excede el nuevo límite
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Botones */}
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="h-11 sm:h-12 rounded-xl border text-sm sm:text-base font-normal"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="h-11 sm:h-12 font-medium bg-gradient-to-r from-emerald-600/90 to-[#8B7355]/80 hover:from-emerald-700/90 hover:to-[#6B5744]/80 rounded-xl text-sm sm:text-base"
            >
              {saving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-2 animate-spin" />
                  Guardando...
                </>
              ) : (
                'Guardar Configuración'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>

      {/* Modal de Advertencia - Cambio de Modo (Cuenta Libre → Con Recargas) */}
      <Dialog open={showModeChangeWarning} onOpenChange={setShowModeChangeWarning}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto border border-stone-200/50 bg-white shadow-2xl">
          <DialogHeader className="pb-4">
            <div className="flex flex-col items-center text-center space-y-2 sm:space-y-3">
              <div className="w-14 h-14 sm:w-16 sm:h-16 bg-gradient-to-br from-blue-50/50 to-blue-100/30 rounded-xl sm:rounded-2xl flex items-center justify-center border border-blue-200/30 shadow-sm">
                <CreditCard className="h-7 w-7 sm:h-8 sm:w-8 text-blue-600/80" />
              </div>
              <div>
                <DialogTitle className="text-xl sm:text-2xl font-light text-stone-800 tracking-wide">
                  Cambiar a Con Recargas
                </DialogTitle>
                <DialogDescription className="text-xs sm:text-sm text-stone-500 mt-1.5 font-normal px-2">
                  ¿Deseas cambiar el método de trabajo?
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 py-2 px-6">
            <Alert className="bg-emerald-50/50 border-emerald-200/30">
              <Info className="h-4 w-4 text-emerald-600" />
              <AlertDescription className="text-sm text-emerald-800 leading-relaxed font-normal">
                <strong className="font-medium">Cuenta Libre</strong> es el modo más cómodo y seguro para tu familia. Con este modo:
              </AlertDescription>
            </Alert>

            <ul className="space-y-2 text-sm text-stone-600">
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 font-medium">✓</span>
                <span>{studentName} <strong>nunca se queda sin comer</strong>, aunque olvides recargar</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 font-medium">✓</span>
                <span>Pagas cómodamente <strong>al final del mes</strong></span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 font-medium">✓</span>
                <span>Ves <strong>todo el consumo en tiempo real</strong> desde la app</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 font-medium">✓</span>
                <span>Sin estrés de recargas diarias ni saldos insuficientes</span>
              </li>
            </ul>

            <Alert className="bg-amber-50/50 border-amber-200/30">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-xs text-amber-800 leading-relaxed">
                <strong className="font-medium">Con Recargas:</strong> Si no hay saldo, {studentName} no podrá comprar en la cafetería. Tendrás que estar pendiente de recargar constantemente.
              </AlertDescription>
            </Alert>

            <div className="flex flex-col gap-3 pt-2">
              <Button
                onClick={cancelModeChange}
                className="h-12 sm:h-14 text-sm sm:text-base font-medium bg-gradient-to-r from-emerald-600/90 to-[#8B7355]/80 hover:from-emerald-700/90 hover:to-[#6B5744]/80 text-white shadow-lg rounded-xl transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2"
              >
                <Check className="h-5 w-5" />
                CONTINUAR CON CUENTA LIBRE (RECOMENDADO)
              </Button>
              
              <Button
                variant="ghost"
                onClick={confirmModeChange}
                className="h-9 sm:h-10 text-xs font-normal text-stone-400 hover:text-stone-600 hover:bg-stone-50/30 rounded-xl transition-all"
              >
                Prefiero cambiar a Con Recargas
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de Advertencia - Cambio de Tope */}
      <Dialog open={showWarning} onOpenChange={setShowWarning}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto border border-stone-200/50 bg-white shadow-2xl">
          <DialogHeader className="pb-4">
            <div className="flex flex-col items-center text-center space-y-2 sm:space-y-3">
              <div className="w-14 h-14 sm:w-16 sm:h-16 bg-gradient-to-br from-amber-50/50 to-amber-100/30 rounded-xl sm:rounded-2xl flex items-center justify-center border border-amber-200/30 shadow-sm">
                <ShieldAlert className="h-7 w-7 sm:h-8 sm:w-8 text-amber-600/80" />
              </div>
              <div>
                <DialogTitle className="text-xl sm:text-2xl font-light text-stone-800 tracking-wide">
                  ¿Estás seguro?
                </DialogTitle>
                <DialogDescription className="text-xs sm:text-sm text-stone-500 mt-1.5 font-normal px-2">
                  Cambiar a modo con tope
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 py-2 px-6">
            <Alert className="bg-emerald-50/50 border-emerald-200/30">
              <Info className="h-4 w-4 text-emerald-600" />
              <AlertDescription className="text-sm text-emerald-800 leading-relaxed font-normal">
                <strong className="font-medium">Compra Inteligente</strong> es el modo <strong className="font-medium">más flexible</strong> y está pensado para que tus hijos puedan acceder a alimentos saludables sin preocupaciones. Con este modo:
              </AlertDescription>
            </Alert>

            <ul className="space-y-2 text-sm text-stone-600">
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 font-medium">✓</span>
                <span>Tus hijos no se quedan sin comer si olvidas recargar</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 font-medium">✓</span>
                <span>Pagas cómodamente al final del mes</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 font-medium">✓</span>
                <span>Ves todo el historial de consumo en tiempo real</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 font-medium">✓</span>
                <span>Puedes establecer topes si lo necesitas después</span>
              </li>
            </ul>

            <Alert className="bg-amber-50/50 border-amber-200/30">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-xs text-amber-800 leading-relaxed">
                <strong className="font-medium">Nota:</strong> Los topes pueden bloquear compras si tu hijo ya gastó el límite, incluso si es para alimentos nutritivos. ¿Seguro quieres activar un tope?
              </AlertDescription>
            </Alert>

            <div className="flex flex-col gap-3 pt-2">
              <Button
                onClick={cancelTypeChange}
                className="h-12 sm:h-14 text-sm sm:text-base font-medium bg-gradient-to-r from-emerald-600/90 to-[#8B7355]/80 hover:from-emerald-700/90 hover:to-[#6B5744]/80 text-white shadow-lg rounded-xl transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2"
              >
                <Check className="h-5 w-5 sm:h-6 sm:w-6" />
                MANTENER COMPRA INTELIGENTE (RECOMENDADO)
              </Button>
              
              <Button
                variant="ghost"
                onClick={confirmTypeChange}
                className="h-9 sm:h-10 text-xs font-normal text-stone-400 hover:text-amber-700 hover:bg-amber-50/30 rounded-xl transition-all"
              >
                Sí, prefiero activar un tope de gasto
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
