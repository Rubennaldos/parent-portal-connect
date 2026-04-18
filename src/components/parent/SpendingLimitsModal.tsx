import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import {
  AlertCircle,
  CalendarDays,
  Infinity,
  Loader2,
  Info,
  UtensilsCrossed,
  PowerOff,
  ShieldCheck,
  CheckCircle2,
  Clock,
  ChevronDown,
} from 'lucide-react';

// ─── Tipos ────────────────────────────────────────────────────────────────────

// Solo semanal (Regla #11: un único período, reinicio los lunes 00:00 Lima)
type LimitType = 'none' | 'weekly';

interface StudentOption {
  id: string;
  full_name: string;
  photo_url?: string | null;
}

interface LimitConfig {
  limit_type: LimitType;
  weekly_limit: number;
  kiosk_disabled?: boolean;
}

export interface SpendingLimitsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  studentName: string;
  onSuccess: () => void;
  onRequestRecharge?: (suggestedAmount?: number) => void;
  students?: StudentOption[];
}

// Mínimo semanal
const MIN_WEEKLY = 10;

// ─── Componente ───────────────────────────────────────────────────────────────
export function SpendingLimitsModal({
  open,
  onOpenChange,
  studentId,
  studentName,
  onSuccess,
  students = [],
}: SpendingLimitsModalProps) {
  const { toast } = useToast();

  const [loading,        setLoading]        = useState(false);
  const [saving,         setSaving]         = useState(false);
  const [activeId,       setActiveId]       = useState(studentId);
  const [activeName,     setActiveName]     = useState(studentName);
  const [selectedType,   setSelectedType]   = useState<LimitType>('none');
  const [limitAmount,    setLimitAmount]    = useState('');
  const [amountError,    setAmountError]    = useState('');
  const [currentConfig,  setCurrentConfig]  = useState<LimitConfig | null>(null);
  const [kioskDisabled,  setKioskDisabled]  = useState(false);
  // Datos del servidor — cero cálculos en el cliente (Regla #11.A y #11.C)
  const [spentWeek,      setSpentWeek]      = useState(0);
  const [nextResetAt,    setNextResetAt]    = useState<string | null>(null);
  const [showTerms,      setShowTerms]      = useState(false);

  useEffect(() => {
    if (open) { setActiveId(studentId); setActiveName(studentName); }
  }, [open, studentId, studentName]);

  useEffect(() => {
    if (open && activeId) { fetchConfig(activeId); fetchSpending(activeId); }
  }, [open, activeId]);

  // ── Carga config desde BD ──────────────────────────────────────────────────
  const fetchConfig = async (sid: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('students')
        .select('limit_type, weekly_limit, kiosk_disabled')
        .eq('id', sid)
        .single();
      if (error) throw error;

      // Mapear tipos heredados (daily/monthly) a 'none' — ya no se soportan
      const rawType = data.limit_type as string;
      const mappedType: LimitType = rawType === 'weekly' ? 'weekly' : 'none';

      const cfg: LimitConfig = {
        limit_type:     mappedType,
        weekly_limit:   data.weekly_limit || 0,
        kiosk_disabled: data.kiosk_disabled ?? false,
      };
      setCurrentConfig(cfg);
      setSelectedType(mappedType);
      setKioskDisabled(cfg.kiosk_disabled ?? false);
      setAmountError('');
      setLimitAmount(mappedType === 'weekly' && cfg.weekly_limit > 0 ? String(cfg.weekly_limit) : '');
    } catch (err) {
      console.error('Error cargando topes:', err);
    } finally {
      setLoading(false);
    }
  };

  // ── Gasto real desde el servidor (Regla #11.A + #11.C) ───────────────────
  const fetchSpending = async (sid: string) => {
    try {
      // SSOT: el RPC calcula el gasto en BD con reloj Lima (no new Date() en cliente)
      const { data, error } = await supabase.rpc('get_student_spending_summary', {
        p_student_id: sid,
      });
      if (error) throw error;
      setSpentWeek(Number(data?.spent_week   ?? 0));
      setNextResetAt(data?.next_reset_at ?? null);
    } catch (err) {
      console.error('Error gastos:', err);
    }
  };

  // ── Validación ─────────────────────────────────────────────────────────────
  const validate = (type: LimitType, raw: string): string => {
    if (type === 'none') return '';
    const v = parseFloat(raw);
    if (!raw || isNaN(v) || v <= 0) return 'Ingresa un monto válido.';
    if (v < MIN_WEEKLY) return `Mínimo S/ ${MIN_WEEKLY} para el tope semanal.`;
    return '';
  };

  // ── Guardar ────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    const err = validate(selectedType, limitAmount);
    if (err) { setAmountError(err); return; }

    const amount = parseFloat(limitAmount) || 0;
    setSaving(true);
    try {
      const { error: dbErr } = await supabase.from('students').update({
        limit_type:    selectedType,
        weekly_limit:  selectedType === 'weekly' ? amount : 0,
        kiosk_disabled: kioskDisabled,
      }).eq('id', activeId);
      if (dbErr) throw dbErr;

      toast({
        title: '✅ Tope guardado',
        description: `${activeName} · ${selectedType === 'none' ? 'Sin tope' : `S/ ${amount} semanal`}`,
      });
      onSuccess();
      onOpenChange(false);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err?.message || 'No se pudo actualizar el tope.' });
    } finally {
      setSaving(false);
    }
  };

  // ── Datos derivados ────────────────────────────────────────────────────────
  const tope = parseFloat(limitAmount) || 0;
  const pct  = tope > 0 ? Math.min(100, (spentWeek / tope) * 100) : 0;

  // Formatear fecha de reinicio que viene del servidor (solo presentación)
  const nextResetLabel = nextResetAt
    ? (() => {
        const d = new Date(nextResetAt);
        return d.toLocaleDateString('es-PE', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
          hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima',
        });
      })()
    : null;

  // ── Cargando ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle className="sr-only">Topes de Consumo</DialogTitle>
          <div className="flex items-center justify-center py-10 gap-3">
            <Loader2 className="h-7 w-7 animate-spin text-amber-500" />
            <p className="text-sm text-slate-400">Cargando…</p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md w-full rounded-3xl border border-slate-200/60 bg-white shadow-2xl p-0 max-h-[90vh] overflow-y-auto">

        {/* ── CABECERA ── */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center">
              <ShieldCheck className="text-amber-600" style={{ width: 18, height: 18 }} />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-slate-800 leading-tight">Topes de Consumo</DialogTitle>
              <DialogDescription className="text-[11px] text-slate-400 mt-0">Solo aplican al kiosco · Reinicio semanal (lunes)</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-5 py-4 space-y-3.5">

          {/* ── SELECTOR DE HIJO ── */}
          {students.length > 1 && (
            <div className="overflow-x-auto pb-1 -mx-1 px-1">
              <div className="flex gap-2 w-max">
                {students.map(s => {
                  const isActive = s.id === activeId;
                  return (
                    <button
                      key={s.id}
                      onClick={() => { setActiveId(s.id); setActiveName(s.full_name); }}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border-2 text-xs font-semibold transition-all whitespace-nowrap ${
                        isActive
                          ? 'border-amber-400 bg-amber-50 text-amber-800'
                          : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                      }`}
                    >
                      {s.photo_url
                        ? <img src={s.photo_url} alt="" className="w-5 h-5 rounded-full object-cover" />
                        : <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${isActive ? 'bg-amber-200 text-amber-700' : 'bg-slate-100 text-slate-400'}`}>
                            {s.full_name.charAt(0)}
                          </div>
                      }
                      {s.full_name.split(' ')[0]}
                      {isActive && <CheckCircle2 className="h-3 w-3 text-amber-500" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Nombre cuando hay 1 solo hijo */}
          {students.length <= 1 && (
            <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">
              <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center text-xs font-bold text-amber-700">
                {activeName.charAt(0)}
              </div>
              <span className="text-sm font-semibold text-slate-700">{activeName}</span>
            </div>
          )}

          {/* ── TIPO DE LÍMITE: 2 opciones (Libre / Semanal) ── */}
          <div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Tipo de Límite</p>
            <div className="grid grid-cols-2 gap-2">

              {/* Sin tope */}
              <button
                onClick={() => { setSelectedType('none'); setLimitAmount(''); setAmountError(''); }}
                className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-2xl border-2 transition-all ${
                  selectedType === 'none'
                    ? 'border-emerald-400 bg-emerald-50'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${selectedType === 'none' ? 'bg-emerald-100' : 'bg-emerald-50'}`}>
                  <Infinity className={`h-4 w-4 ${selectedType === 'none' ? 'text-emerald-600' : 'text-emerald-400'}`} />
                </div>
                <span className={`text-xs font-semibold ${selectedType === 'none' ? 'text-emerald-800' : 'text-slate-600'}`}>Libre</span>
                <span className="text-[9px] text-slate-400 leading-none">Sin restricción</span>
                {selectedType === 'none' && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
              </button>

              {/* Tope semanal */}
              <button
                onClick={() => {
                  setSelectedType('weekly');
                  setAmountError('');
                  setLimitAmount(currentConfig?.weekly_limit ? String(currentConfig.weekly_limit) : '');
                }}
                className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-2xl border-2 transition-all ${
                  selectedType === 'weekly'
                    ? 'border-amber-400 bg-amber-50'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${selectedType === 'weekly' ? 'bg-amber-100' : 'bg-blue-50'}`}>
                  <CalendarDays className={`h-4 w-4 ${selectedType === 'weekly' ? 'text-amber-600' : 'text-blue-400'}`} />
                </div>
                <span className={`text-xs font-semibold ${selectedType === 'weekly' ? 'text-amber-800' : 'text-slate-600'}`}>Semanal</span>
                {spentWeek > 0
                  ? <span className="text-[9px] text-slate-400 leading-none">S/{spentWeek.toFixed(0)} gastado</span>
                  : <span className="text-[9px] text-slate-400 leading-none">Lun → Dom</span>
                }
                {selectedType === 'weekly' && <CheckCircle2 className="h-3 w-3 text-amber-500" />}
              </button>

            </div>
          </div>

          {/* ── MONTO (solo si tipo = weekly) ── */}
          {selectedType === 'weekly' && (
            <div className="bg-slate-50 rounded-2xl border border-slate-200 p-3 space-y-2">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                Monto del Tope Semanal · mín. S/ {MIN_WEEKLY}
              </p>

              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-base font-medium text-slate-400 pointer-events-none">S/</span>
                <Input
                  type="number"
                  step="0.50"
                  min={MIN_WEEKLY}
                  value={limitAmount}
                  onChange={e => {
                    setLimitAmount(e.target.value);
                    setAmountError(validate('weekly', e.target.value));
                  }}
                  className={`text-xl font-bold h-11 pl-9 rounded-xl border-2 focus-visible:ring-0 ${
                    amountError ? 'border-red-300 bg-red-50/50' : 'border-slate-200 bg-white focus:border-amber-400'
                  }`}
                  placeholder={String(MIN_WEEKLY)}
                />
              </div>

              {amountError && (
                <div className="flex items-center gap-1.5 text-xs text-red-600">
                  <AlertCircle className="h-3 w-3 shrink-0" />{amountError}
                </div>
              )}

              {/* ── Barra de progreso + reinicio — datos del servidor ── */}
              {tope > 0 && (
                <div className="space-y-1.5 pt-0.5">
                  {spentWeek > 0 && (
                    <>
                      <div className="flex justify-between text-[9px] text-slate-400">
                        <span>Gastado: S/ {spentWeek.toFixed(2)}</span>
                        <span>Tope: S/ {tope.toFixed(2)}</span>
                      </div>
                      <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${pct >= 90 ? 'bg-red-400' : pct >= 70 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </>
                  )}
                  {/* Fecha de reinicio dictada por el servidor (Regla #11.C) */}
                  {nextResetLabel && (
                    <div className="flex items-center gap-1.5 text-[10px] text-blue-600">
                      <Clock className="h-3 w-3 shrink-0" />
                      <span>Reinicia: <span className="font-semibold">{nextResetLabel}</span></span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── KIOSCO TOGGLE ── */}
          <div className={`flex items-center justify-between gap-3 rounded-2xl border px-3 py-2.5 ${
            kioskDisabled ? 'border-red-200 bg-red-50/60' : 'border-slate-200 bg-slate-50/40'
          }`}>
            <div className="flex items-center gap-2 min-w-0">
              <div className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${kioskDisabled ? 'bg-red-100' : 'bg-slate-100'}`}>
                {kioskDisabled
                  ? <PowerOff className="h-3.5 w-3.5 text-red-500" />
                  : <UtensilsCrossed className="h-3.5 w-3.5 text-slate-400" />
                }
              </div>
              <div className="min-w-0">
                <p className={`text-xs font-semibold ${kioskDisabled ? 'text-red-700' : 'text-slate-600'}`}>
                  {kioskDisabled ? 'Kiosco desactivado' : 'Acceso al kiosco'}
                </p>
                <p className="text-[10px] text-slate-400 truncate">
                  {kioskDisabled ? 'Solo puede pedir almuerzos' : 'Activo — puede comprar en kiosco'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setKioskDisabled(p => !p)}
              role="switch"
              aria-checked={kioskDisabled}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                kioskDisabled ? 'bg-red-500' : 'bg-slate-200'
              }`}
            >
              <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform ring-0 transition ease-in-out duration-200 ${kioskDisabled ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
          </div>

          {/* ── TÉRMINOS: colapsable ── */}
          <div className="rounded-xl border border-slate-200/70 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowTerms(p => !p)}
              className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider hover:bg-slate-50/60 transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <Info className="h-3 w-3" />
                Información importante
              </div>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showTerms ? 'rotate-180' : ''}`} />
            </button>
            {showTerms && (
              <div className="px-3 pb-3 pt-1 text-[10px] text-slate-500 leading-relaxed border-t border-slate-100">
                El tope semanal controla cuánto puede gastar el estudiante en el kiosco de{' '}
                <strong className="text-slate-600">lunes a domingo</strong>. Una vez alcanzado el límite, el kiosco
                no permitirá compras adicionales hasta el próximo lunes a las{' '}
                <strong className="text-slate-600">00:00 hrs (hora Lima)</strong>. El reinicio es automático y lo
                calcula el servidor — no depende del reloj del dispositivo.
              </div>
            )}
          </div>

          {/* ── BOTONES ── */}
          <div className="grid grid-cols-2 gap-2.5">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="h-11 rounded-2xl border-slate-200 text-slate-600 text-sm font-medium"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || (selectedType === 'weekly' && !!amountError)}
              className="h-11 rounded-2xl font-semibold bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white border-0 shadow-md shadow-amber-200/60"
            >
              {saving ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Guardando…</> : 'Guardar Tope'}
            </Button>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
