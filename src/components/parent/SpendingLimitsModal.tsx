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
  const [selectedType, setSelectedType] = useState<LimitType>('none');
  const [limitAmount, setLimitAmount] = useState('');
  const [currentConfig, setCurrentConfig] = useState<LimitConfig | null>(null);
  const [spentToday, setSpentToday] = useState(0);
  const [spentThisWeek, setSpentThisWeek] = useState(0);
  const [spentThisMonth, setSpentThisMonth] = useState(0);
  const [showWarning, setShowWarning] = useState(false);
  const [pendingType, setPendingType] = useState<LimitType | null>(null);
  const [accountMode, setAccountMode] = useState<'free' | 'prepaid'>('free'); // Nuevo: modo de cuenta
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
      setSelectedType(data.limit_type || 'none');
      setAccountMode(data.free_account !== false ? 'free' : 'prepaid'); // Cargar modo de cuenta
      
      // Establecer el monto según el tipo activo
      if (data.limit_type === 'daily') {
        setLimitAmount(data.daily_limit?.toString() || '0');
      } else if (data.limit_type === 'weekly') {
        setLimitAmount(data.weekly_limit?.toString() || '0');
      } else if (data.limit_type === 'monthly') {
        setLimitAmount(data.monthly_limit?.toString() || '0');
      }
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
        free_account: accountMode === 'free', // Guardar modo de cuenta
      };

      const { error } = await supabase
        .from('students')
        .update(updateData)
        .eq('id', studentId);

      if (error) throw error;

      toast({
        title: '✅ Configuración actualizada',
        description: `${accountMode === 'free' ? 'Cuenta Libre' : 'Cuenta de Recargas'} - ${getLimitMessage()}`,
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
      <DialogContent className="sm:max-w-2xl p-0 gap-0">
        <div className="max-h-[90vh] overflow-y-auto">
          <DialogHeader className="px-6 pt-6 pb-4 sticky top-0 bg-white z-10 border-b">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-[#8B4513]/10 rounded-2xl flex items-center justify-center">
                <DollarSign className="h-6 w-6 text-[#8B4513]" />
              </div>
              <div>
                <DialogTitle className="text-2xl font-black text-slate-800">
                  Límites de Gasto
                </DialogTitle>
                <DialogDescription className="text-sm text-slate-500 mt-1">
                  Configura topes para {studentName}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-6 px-6 py-4">
            {/* Selector de Método de Trabajo */}
            <div>
              <Label className="text-sm font-bold text-slate-700 mb-3 block">
                Método de Trabajo
              </Label>
              <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleModeChange('free')}
                className={`p-4 rounded-xl border-2 transition-all text-left ${
                  accountMode === 'free'
                    ? 'border-emerald-500 bg-emerald-50'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    accountMode === 'free' ? 'bg-emerald-100' : 'bg-slate-100'
                  }`}>
                    <Wallet className={`h-4 w-4 ${accountMode === 'free' ? 'text-emerald-600' : 'text-slate-400'}`} />
                  </div>
                  {accountMode === 'free' && (
                    <Badge className="bg-emerald-600 text-white text-xs">ACTIVO</Badge>
                  )}
                </div>
                <h4 className={`font-black text-sm ${accountMode === 'free' ? 'text-emerald-900' : 'text-slate-700'}`}>
                  🆓 Cuenta Libre
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">Pagas al final del mes</p>
              </button>

              <button
                onClick={() => handleModeChange('prepaid')}
                className={`p-4 rounded-xl border-2 transition-all text-left ${
                  accountMode === 'prepaid'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    accountMode === 'prepaid' ? 'bg-blue-100' : 'bg-slate-100'
                  }`}>
                    <CreditCard className={`h-4 w-4 ${accountMode === 'prepaid' ? 'text-blue-600' : 'text-slate-400'}`} />
                  </div>
                  {accountMode === 'prepaid' && (
                    <Badge className="bg-blue-600 text-white text-xs">ACTIVO</Badge>
                  )}
                </div>
                <h4 className={`font-black text-sm ${accountMode === 'prepaid' ? 'text-blue-900' : 'text-slate-700'}`}>
                  💳 Con Recargas
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">Recargas anticipadas</p>
              </button>
            </div>

            {/* Info adicional según el modo */}
            {accountMode === 'prepaid' && (
              <Alert className="mt-3 bg-blue-50 border-blue-200">
                <CreditCard className="h-4 w-4 text-blue-600" />
                <AlertDescription className="text-xs text-blue-800">
                  <strong>Modo Recargas:</strong> Debes recargar saldo antes de que tu hijo pueda comprar. Puedes hacerlo desde el botón "Recargar Saldo" en la tarjeta del estudiante.
                </AlertDescription>
              </Alert>
            )}
          </div>

          {/* Selector de Tipo de Límite */}
          <div>
            <Label className="text-sm font-bold text-slate-700 mb-3 block">
              Tipo de Límite
            </Label>
            <div className="grid grid-cols-2 gap-3">
              {limitOptions.map((option) => {
                const Icon = option.icon;
                const isSelected = selectedType === option.value;
                
                return (
                  <button
                    key={option.value}
                    onClick={() => handleTypeChange(option.value as LimitType)}
                    className={`p-4 rounded-xl border-2 transition-all text-left ${
                      isSelected
                        ? 'border-[#8B4513] bg-[#FFF8E7]'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <Icon className={`h-5 w-5 ${isSelected ? 'text-[#8B4513]' : option.color}`} />
                      {option.spent !== undefined && (
                        <Badge variant="outline" className="text-xs font-bold">
                          S/ {option.spent.toFixed(2)}
                        </Badge>
                      )}
                    </div>
                    <h4 className={`font-bold text-sm ${isSelected ? 'text-[#8B4513]' : 'text-slate-700'}`}>
                      {option.label}
                    </h4>
                    <p className="text-xs text-slate-500 mt-1">{option.description}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Input de Monto */}
          {selectedType !== 'none' && (
            <div className="bg-slate-50 border-2 border-slate-200 rounded-2xl p-5">
              <Label htmlFor="limit-amount" className="text-sm font-bold text-slate-700 mb-2 block">
                Monto del Tope {selectedType === 'daily' ? 'Diario' : selectedType === 'weekly' ? 'Semanal' : 'Mensual'}
              </Label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-black text-slate-400">
                  S/
                </span>
                <Input
                  id="limit-amount"
                  type="number"
                  step="0.50"
                  value={limitAmount}
                  onChange={(e) => setLimitAmount(e.target.value)}
                  className="text-3xl font-black h-16 pl-14 border-2 rounded-xl"
                  placeholder="0.00"
                />
              </div>
              <p className="text-xs text-slate-500 mt-2 flex items-center gap-1">
                <Info className="h-3 w-3" />
                Este será el máximo que {studentName} podrá gastar {selectedType === 'daily' ? 'por día' : selectedType === 'weekly' ? 'por semana' : 'por mes'}
              </p>
            </div>
          )}

          {/* Advertencia si hay gasto actual */}
          {selectedType !== 'none' && parseFloat(limitAmount) > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-amber-900 text-sm mb-1">Gasto Actual:</h4>
                <p className="text-sm text-amber-800">
                  {selectedType === 'daily' && `Hoy: S/ ${spentToday.toFixed(2)}`}
                  {selectedType === 'weekly' && `Esta semana: S/ ${spentThisWeek.toFixed(2)}`}
                  {selectedType === 'monthly' && `Este mes: S/ ${spentThisMonth.toFixed(2)}`}
                </p>
                {((selectedType === 'daily' && spentToday > parseFloat(limitAmount)) ||
                  (selectedType === 'weekly' && spentThisWeek > parseFloat(limitAmount)) ||
                  (selectedType === 'monthly' && spentThisMonth > parseFloat(limitAmount))) && (
                  <p className="text-xs text-amber-700 mt-1 font-semibold">
                    ⚠️ El gasto actual ya excede el nuevo límite
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Botones */}
          <div className="grid grid-cols-2 gap-3 pb-6">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="h-12 rounded-xl border-2"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="h-12 font-black bg-[#8B4513] hover:bg-[#6F370F] rounded-xl"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Guardando...
                </>
              ) : (
                'Guardar Configuración'
              )}
            </Button>
          </div>
        </div>
      </div>
      </DialogContent>

      {/* Modal de Advertencia - Cambio de Modo de Cuenta */}
      <Dialog open={showModeChangeWarning} onOpenChange={setShowModeChangeWarning}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto z-[60]">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center">
                <ShieldAlert className="h-6 w-6 text-amber-600" />
              </div>
              <div>
                <DialogTitle className="text-xl font-black text-slate-800">
                  ⚠️ Cambiar a Recargas
                </DialogTitle>
                <DialogDescription className="text-sm text-slate-500">
                  ¿Seguro quieres cambiar el método?
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <Alert className="bg-emerald-50 border-emerald-200">
              <Info className="h-4 w-4 text-emerald-600" />
              <AlertDescription className="text-sm text-emerald-800 leading-relaxed">
                <strong>Cuenta Libre</strong> es más conveniente porque:
              </AlertDescription>
            </Alert>

            <ul className="space-y-2 text-sm text-slate-600">
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 font-bold">✓</span>
                <span>No necesitas estar recargando constantemente</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 font-bold">✓</span>
                <span>Tu hijo nunca se queda sin poder comprar</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 font-bold">✓</span>
                <span>Pagas todo junto al final del mes</span>
              </li>
            </ul>

            <Alert className="bg-amber-50 border-amber-200">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-xs text-amber-800">
                <strong>Con Recargas:</strong> Deberás recargar saldo antes de cada compra. Si se acaba el saldo, tu hijo no podrá comprar hasta que recargues.
              </AlertDescription>
            </Alert>

            <div className="flex flex-col gap-3 pt-2">
              <Button
                onClick={cancelModeChange}
                className="h-14 text-base font-black bg-emerald-600 hover:bg-emerald-700 text-white shadow-xl rounded-2xl transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2 border-b-4 border-emerald-800"
              >
                <Check className="h-6 w-6" />
                MANTENER CUENTA LIBRE (RECOMENDADO)
              </Button>
              
              <Button
                variant="ghost"
                onClick={confirmModeChange}
                className="h-10 text-xs font-bold text-slate-400 hover:text-blue-700 hover:bg-blue-50 rounded-xl transition-all"
              >
                Sí, cambiar a modo con recargas
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de Advertencia - Cambio de Tope */}
      <Dialog open={showWarning} onOpenChange={setShowWarning}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto z-[60]">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center">
                <ShieldAlert className="h-6 w-6 text-amber-600" />
              </div>
              <div>
                <DialogTitle className="text-xl font-black text-slate-800">
                  ⚠️ ¿Estás seguro?
                </DialogTitle>
                <DialogDescription className="text-sm text-slate-500">
                  Cambiar a modo con tope
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <Alert className="bg-emerald-50 border-emerald-200">
              <Info className="h-4 w-4 text-emerald-600" />
              <AlertDescription className="text-sm text-emerald-800 leading-relaxed">
                <strong>🎯 Compra Inteligente</strong> es el modo <strong>más flexible</strong> y está pensado para que tus hijos puedan acceder a alimentos saludables sin preocupaciones. Con este modo:
              </AlertDescription>
            </Alert>

            <ul className="space-y-2 text-sm text-slate-600">
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 font-bold">✓</span>
                <span>Tus hijos no se quedan sin comer si olvidas recargar</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 font-bold">✓</span>
                <span>Pagas cómodamente al final del mes</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 font-bold">✓</span>
                <span>Ves todo el historial de consumo en tiempo real</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-600 font-bold">✓</span>
                <span>Puedes establecer topes si lo necesitas después</span>
              </li>
            </ul>

            <Alert className="bg-amber-50 border-amber-200">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-xs text-amber-800">
                <strong>Nota:</strong> Los topes pueden bloquear compras si tu hijo ya gastó el límite, incluso si es para alimentos nutritivos. ¿Seguro quieres activar un tope?
              </AlertDescription>
            </Alert>

            <div className="flex flex-col gap-3 pt-2">
              <Button
                onClick={cancelTypeChange}
                className="h-14 text-base font-black bg-emerald-600 hover:bg-emerald-700 text-white shadow-xl rounded-2xl transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2 border-b-4 border-emerald-800"
              >
                <Check className="h-6 w-6" />
                MANTENER COMPRA INTELIGENTE (RECOMENDADO)
              </Button>
              
              <Button
                variant="ghost"
                onClick={confirmTypeChange}
                className="h-10 text-xs font-bold text-slate-400 hover:text-amber-700 hover:bg-amber-50 rounded-xl transition-all"
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
