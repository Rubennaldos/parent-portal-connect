/**
 * BalanceSaldoModal — Monedero de Recargas
 *
 * SSOT: RPC get_student_recharge_ledger (basado en view_recharge_ledger)
 *
 * REGLA DE SINCERIDAD FINANCIERA (reglas-de-oro.mdc §11):
 *   - PROHIBICIÓN DE FALLBACK: si el Ledger devuelve 0, el modal muestra 0.
 *     alumnos.saldo_actual/students.balance es solo referencia para el log.
 *   - PRIORIDAD FIFO: "Recargado" y "Consumido" nacen de la misma vista.
 *   - DINERO EN EL AIRE: los pendientes se muestran aparte; NO se suman al saldo.
 *
 * LEY 7 (Espejo Pasivo): este componente solo pinta. No calcula. No escribe.
 */
import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { format, isToday, isYesterday } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Wallet,
  ArrowUpCircle,
  Clock,
  CheckCircle2,
  Banknote,
  Smartphone,
  CreditCard,
} from 'lucide-react';

// ── Tipos ──────────────────────────────────────────────────────────────────

interface RechargeRow {
  rec_code: string;
  recharge_request_id: string;
  recharge_amount: number;
  consumed: number;
  remaining: number;
  effective_at: string;
  status: string;
  nro_operacion: string | null;
  payment_method: string | null;
}

interface PendingRow {
  id: string;
  amount: number;
  payment_method: string | null;
  reference_code: string | null;
  created_at: string;
}

interface LedgerData {
  ledger: RechargeRow[];
  pending: PendingRow[];
  total_remaining: number;
}

export interface Props {
  isOpen: boolean;
  onClose: () => void;
  onAddRechargeToCart: (amount: number) => void;
  studentId: string;
  studentName: string;
  /** Solo para log de discrepancia — NO es fallback de UI */
  currentBalance?: number | null;
  isBalanceLoading?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  try {
    const d = new Date(iso);
    if (isToday(d))     return 'Hoy';
    if (isYesterday(d)) return 'Ayer';
    return format(d, "d 'de' MMM, yy", { locale: es });
  } catch { return '—'; }
}

const METHOD_LABEL: Record<string, string> = {
  yape:          'Yape',
  plin:          'Plin',
  transferencia: 'Transferencia',
  bank_transfer: 'Transferencia',
  efectivo:      'Efectivo',
  cash:          'Efectivo',
  tarjeta:       'Tarjeta',
};

function safeNum(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// ── Skeleton de fila ───────────────────────────────────────────────────────

const RowSkeleton = () => (
  <div className="animate-pulse rounded-2xl border border-slate-100 p-4 space-y-2.5">
    <div className="flex items-center justify-between">
      <div className="h-4 w-16 bg-slate-100 rounded-full" />
      <div className="h-3 w-12 bg-slate-100 rounded-full" />
    </div>
    <div className="h-8 w-28 bg-slate-100 rounded-lg" />
    <div className="h-2 w-full bg-slate-100 rounded-full" />
    <div className="h-3 w-20 bg-slate-100 rounded-full" />
  </div>
);

// ── Componente ─────────────────────────────────────────────────────────────

export function BalanceSaldoModal({
  isOpen,
  onClose,
  onAddRechargeToCart,
  studentId,
  studentName,
  currentBalance,
  isBalanceLoading = false,
}: Props) {
  const [loading,        setLoading]        = useState(false);
  const [totalRemaining, setTotalRemaining] = useState<number | null>(null);
  const [ledger,         setLedger]         = useState<RechargeRow[]>([]);
  const [pending,        setPending]        = useState<PendingRow[]>([]);
  const [showRechargeSelector, setShowRechargeSelector] = useState(false);
  const [selectedRechargeAmount, setSelectedRechargeAmount] = useState<number | null>(null);
  const [customRechargeAmount, setCustomRechargeAmount] = useState('');

  const fetchLedger = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc(
        'get_student_recharge_ledger',
        { p_student_id: studentId }
      );
      if (error) throw error;

      const result    = (data ?? {}) as LedgerData;
      const rows      = (result.ledger  ?? []) as RechargeRow[];
      const pRows     = (result.pending ?? []) as PendingRow[];
      const total     = safeNum(result.total_remaining);

      setLedger(rows);
      setPending(pRows);
      setTotalRemaining(total);

      // Log de discrepancia: si el saldo "legacy" difiere del ledger,
      // el admin debe auditarlo manualmente. El modal muestra el ledger; nunca el legacy.
      if (currentBalance !== null && currentBalance !== undefined) {
        const legacy = safeNum(currentBalance);
        if (Math.abs(total - legacy) > 0.009) {
          console.warn('[BalanceSaldoModal] Discrepancia detectada — auditar manualmente', {
            student_id:   studentId,
            saldo_tabla:  legacy,
            saldo_ledger: total,
          });
        }
      }
    } catch (err) {
      console.error('[BalanceSaldoModal] fetchLedger:', err);
      // En error de red/RPC → mostrar S/ 0.00 (nunca el saldo legacy)
      setTotalRemaining(0);
      setLedger([]);
      setPending([]);
    } finally {
      setLoading(false);
    }
  }, [studentId, currentBalance]);

  useEffect(() => {
    if (isOpen && studentId) {
      setLedger([]);
      setPending([]);
      setTotalRemaining(null);
      setShowRechargeSelector(false);
      setSelectedRechargeAmount(null);
      setCustomRechargeAmount('');
      fetchLedger();
    }
  }, [isOpen, studentId, fetchLedger]);

  // ── Render de tarjeta de recarga ───────────────────────────────────────

  const renderRechargeRow = (row: RechargeRow) => {
    const isVoided    = row.status === 'voided';
    const isExhausted = row.remaining < 0.01;
    const pct = row.recharge_amount > 0
      ? Math.min(100, (row.consumed / row.recharge_amount) * 100)
      : 0;
    const methodLabel = METHOD_LABEL[(row.payment_method ?? '').toLowerCase()]
      ?? (row.payment_method ?? '—');

    return (
      <div
        key={row.recharge_request_id}
        className={[
          'rounded-2xl border p-4 space-y-2.5 transition-all',
          isVoided    ? 'border-slate-100 bg-slate-50/60 opacity-50'   :
          isExhausted ? 'border-slate-200 bg-slate-50'                 :
                        'border-emerald-100 bg-emerald-50/40',
        ].join(' ')}
      >
        {/* Código + fecha + estado */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-lg">
              {row.rec_code}
            </span>
            <span className="text-[10px] text-slate-400">{fmtDate(row.effective_at)}</span>
          </div>
          {isVoided ? (
            <span className="text-[9px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full uppercase">Anulado</span>
          ) : isExhausted ? (
            <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full uppercase">Agotado</span>
          ) : (
            <span className="text-[9px] font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full uppercase flex items-center gap-1">
              <CheckCircle2 className="w-2.5 h-2.5" /> Activo
            </span>
          )}
        </div>

        {/* Montos: original ↔ restante */}
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[10px] text-slate-400 mb-0.5">Monto recargado</p>
            <p className="text-[22px] font-bold text-slate-800 leading-tight">
              S/ {row.recharge_amount.toFixed(2)}
            </p>
          </div>
          {!isVoided && (
            <div className="text-right">
              <p className="text-[10px] text-slate-400 mb-0.5">Saldo restante</p>
              <p className={[
                'text-[18px] font-bold leading-tight',
                isExhausted ? 'text-slate-300' : 'text-emerald-600',
              ].join(' ')}>
                S/ {row.remaining.toFixed(2)}
              </p>
            </div>
          )}
        </div>

        {/* Barra FIFO de consumo */}
        {!isVoided && (
          <div className="space-y-1">
            <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div
                className={[
                  'h-full rounded-full transition-all',
                  pct >= 100 ? 'bg-slate-400' :
                  pct >= 80  ? 'bg-amber-400'  :
                               'bg-emerald-400',
                ].join(' ')}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex justify-between text-[9px] text-slate-400">
              <span>Consumido: S/ {row.consumed.toFixed(2)}</span>
              <span>{pct.toFixed(0)}%</span>
            </div>
          </div>
        )}

        {/* Metadata: método + número de operación */}
        {(row.payment_method || row.nro_operacion) && (
          <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
            {row.payment_method && (
              <span className="text-[9px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                {row.payment_method.toLowerCase() === 'yape' || row.payment_method.toLowerCase() === 'plin'
                  ? <Smartphone className="w-2.5 h-2.5" />
                  : row.payment_method.toLowerCase() === 'tarjeta'
                  ? <CreditCard className="w-2.5 h-2.5" />
                  : <Banknote className="w-2.5 h-2.5" />
                }
                {methodLabel}
              </span>
            )}
            {row.nro_operacion && (
              <span className="text-[9px] font-mono text-slate-400 bg-slate-50 border border-slate-100 px-2 py-0.5 rounded-full">
                {row.nro_operacion}
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Render de fila pendiente ───────────────────────────────────────────

  const renderPendingRow = (row: PendingRow) => {
    const methodLabel = METHOD_LABEL[(row.payment_method ?? '').toLowerCase()]
      ?? (row.payment_method ?? '—');
    return (
      <div
        key={row.id}
        className="flex items-center justify-between gap-3 py-2.5 border-b border-amber-100 last:border-0"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-amber-800 truncate">
              {row.reference_code ? `Ref: ${row.reference_code}` : 'Sin referencia'}
            </p>
            <p className="text-[9px] text-amber-500">
              {fmtDate(row.created_at)} · {methodLabel}
            </p>
          </div>
        </div>
        <span className="text-[13px] font-bold text-amber-600 shrink-0">
          S/ {safeNum(row.amount).toFixed(2)}
        </span>
      </div>
    );
  };

  const pendingTotal = pending.reduce((s, r) => s + safeNum(r.amount), 0);
  const isEmpty      = !loading && ledger.length === 0 && pending.length === 0;
  const showSkeleton = loading && totalRemaining === null;
  // Bloqueo temporal "antimachucable": no permitir nuevas recargas manuales.
  const MANUAL_RECHARGES_DISABLED = true;
  const RECHARGE_MIN_AMOUNT = 10;
  const quickAmounts = [10, 20, 50, 100];
  const manualAmount = safeNum(customRechargeAmount);
  const rechargeAmount =
    selectedRechargeAmount !== null
      ? selectedRechargeAmount
      : manualAmount > 0
      ? manualAmount
      : 0;
  // Monto del input manual (sin botón rápido seleccionado)
  const isManualInput = selectedRechargeAmount === null && customRechargeAmount !== '';
  const isBelowMinimum = isManualInput && manualAmount < RECHARGE_MIN_AMOUNT;
  const canAddToCart = rechargeAmount >= RECHARGE_MIN_AMOUNT;

  // ── JSX ────────────────────────────────────────────────────────────────

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-sm w-full p-0 gap-0 overflow-hidden rounded-3xl shadow-2xl">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="relative bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700 px-6 pt-8 pb-7 text-center overflow-hidden">
          <div className="absolute -top-6 -right-6 w-28 h-28 rounded-full bg-white/5 pointer-events-none" />
          <div className="absolute -bottom-8 -left-4 w-20 h-20 rounded-full bg-white/5 pointer-events-none" />

          <DialogHeader className="mb-0">
            <DialogTitle className="sr-only">Monedero de Recargas</DialogTitle>
          </DialogHeader>

          <div className="flex justify-center mb-3">
            <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center ring-1 ring-white/30">
              <Wallet className="w-5 h-5 text-white" />
            </div>
          </div>

          <p className="text-white/60 text-[10px] font-bold uppercase tracking-[0.2em] mb-2">
            Saldo de Recargas
          </p>

          {isBalanceLoading || showSkeleton ? (
            <div className="flex items-center justify-center gap-2 my-1">
              <span className="text-xl font-light text-white/70">S/</span>
              <span className="h-12 w-28 rounded-xl bg-white/25 animate-pulse" />
            </div>
          ) : (
            <p className="text-white leading-none tracking-tight">
              <span className="text-xl font-light text-white/70 mr-1 align-middle">S/</span>
              <span className="text-[3rem] font-bold align-middle">
                {Math.max(0, totalRemaining ?? 0).toFixed(2)}
              </span>
            </p>
          )}

          <p className="text-white/50 text-[11px] mt-2 font-medium">{studentName}</p>
        </div>

        {/* ── Cuerpo ──────────────────────────────────────────────────────── */}
        <div className="max-h-[62vh] overflow-y-auto bg-white">

          {/* Pendientes: dinero en el aire — no disponible aún */}
          {pending.length > 0 && (
            <div className="mx-4 mt-4 rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-3">
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">
                    En revisión
                  </span>
                </div>
                <span className="text-[11px] font-bold text-amber-600">
                  S/ {pendingTotal.toFixed(2)} en espera
                </span>
              </div>

              {pending.map(renderPendingRow)}

              <p className="text-[9px] text-amber-500 mt-2 leading-snug">
                Este monto no se suma al saldo hasta que el administrador apruebe el voucher.
              </p>
            </div>
          )}

          {/* Historial de recargas identificadas */}
          <div className="px-4 pt-4 pb-5">
            <div className="mb-3.5">
              {!showRechargeSelector || MANUAL_RECHARGES_DISABLED ? (
                <Button
                  disabled={MANUAL_RECHARGES_DISABLED}
                  // Seguridad: aunque alguien intente disparar eventos, no abrimos selector.
                  onClick={() => {
                    if (MANUAL_RECHARGES_DISABLED) return;
                    setShowRechargeSelector(true);
                  }}
                  className={[
                    'w-full h-11 font-semibold shadow-sm transition-all',
                    MANUAL_RECHARGES_DISABLED
                      ? 'bg-slate-300 text-slate-600 grayscale opacity-40 cursor-not-allowed hover:bg-slate-300'
                      : (totalRemaining ?? 0) <= 0
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-emerald-500 hover:bg-emerald-600',
                  ].join(' ')}
                >
                  Nueva Recarga
                </Button>
              ) : (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3 space-y-3">
                  <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">
                    Selecciona monto de recarga
                  </p>

                  <div className="grid grid-cols-4 gap-1.5">
                    {quickAmounts.map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          setSelectedRechargeAmount(value);
                          setCustomRechargeAmount('');
                        }}
                        className={[
                          'h-9 rounded-lg text-xs font-bold transition-all border',
                          selectedRechargeAmount === value
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-100',
                        ].join(' ')}
                      >
                        S/ {value}
                      </button>
                    ))}
                  </div>

                  <div className="space-y-1">
                    <p className="text-[10px] text-emerald-700 font-semibold">Otro monto</p>
                    <Input
                      type="number"
                      min={RECHARGE_MIN_AMOUNT}
                      step="0.01"
                      value={customRechargeAmount}
                      onChange={(e) => {
                        setSelectedRechargeAmount(null);
                        setCustomRechargeAmount(e.target.value);
                      }}
                      placeholder="Ej. 35.00"
                      className={[
                        'h-9 bg-white',
                        isBelowMinimum
                          ? 'border-red-400 focus:border-red-500'
                          : 'border-emerald-200 focus:border-emerald-400',
                      ].join(' ')}
                    />
                    {isBelowMinimum && (
                      <p className="text-[11px] text-red-600 font-semibold flex items-center gap-1 pt-0.5">
                        ⚠️ El monto mínimo de recarga es S/ 10.00
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1 h-9 border-emerald-300 text-emerald-700"
                      onClick={() => {
                        setShowRechargeSelector(false);
                        setSelectedRechargeAmount(null);
                        setCustomRechargeAmount('');
                      }}
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="button"
                      className="flex-1 h-9 bg-emerald-600 hover:bg-emerald-700"
                      disabled={!canAddToCart}
                      onClick={() => {
                        onAddRechargeToCart(rechargeAmount);
                        setShowRechargeSelector(false);
                        setSelectedRechargeAmount(null);
                        setCustomRechargeAmount('');
                        onClose();
                      }}
                    >
                      Añadir al carrito
                    </Button>
                  </div>
                </div>
              )}
              {pending.length > 0 && (
                <p className="mt-1.5 text-[10px] text-amber-600 text-center">
                  Ya tienes una recarga pendiente de aprobación.
                </p>
              )}
            </div>

            <div className="flex items-center gap-1.5 mb-3">
              <ArrowUpCircle className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Recargas identificadas
              </span>
              {ledger.length > 0 && (
                <span className="ml-auto text-[10px] text-slate-400">
                  {ledger.length} recarga{ledger.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {showSkeleton ? (
              <div className="space-y-3">
                <RowSkeleton />
                <RowSkeleton />
                <RowSkeleton />
              </div>
            ) : isEmpty ? (
              <div className="text-center py-10">
                <Wallet className="w-10 h-10 mx-auto mb-2 text-slate-200" />
                <p className="text-sm font-medium text-slate-400">Sin recargas registradas</p>
                <p className="text-[10px] text-slate-300 mt-1 leading-snug">
                  Las recargas aprobadas aparecerán aquí<br />con su código de seguimiento REC.
                </p>
              </div>
            ) : ledger.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-[11px] text-slate-400">Sin recargas identificadas con voucher</p>
              </div>
            ) : (
              <div className="space-y-2">
                {ledger.map(renderRechargeRow)}
              </div>
            )}
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
