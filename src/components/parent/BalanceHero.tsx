/**
 * BalanceHero — Módulo de saldo estilo v0/Yape
 *
 * Diseño centrado, limpio: sin tarjeta oscura.
 * - Botón ojo para mostrar/ocultar el monto
 * - Skeleton animado mientras los datos cargan
 * - Badge verde "Sin deudas" o chips rojos con los montos de deuda
 * - Persistencia del show/hide en localStorage por estudiante
 *
 * Props recibidas desde Index.tsx — sin acceso directo a Supabase.
 */
import { useState } from 'react';
import { Eye, EyeOff, UtensilsCrossed, ShoppingBag, CircleCheck } from 'lucide-react';

interface BalanceHeroProps {
  studentId: string | null;
  studentName: string;
  photoUrl: string | null;
  balance: number;
  lunchDebt: number;
  kioskDebt: number;
  isLoading: boolean;
}

const Skeleton = ({ className }: { className?: string }) => (
  <div className={`animate-pulse bg-slate-200 rounded-xl ${className ?? ''}`} />
);

export function BalanceHero({
  studentId,
  balance,
  lunchDebt,
  kioskDebt,
  isLoading,
}: BalanceHeroProps) {
  const storageKey = `balanceHero_show_${studentId ?? 'default'}`;
  const [showBalance, setShowBalance] = useState<boolean>(() => {
    try { return localStorage.getItem(storageKey) !== 'false'; }
    catch { return true; }
  });

  const toggleBalance = () => {
    const next = !showBalance;
    setShowBalance(next);
    try { localStorage.setItem(storageKey, String(next)); } catch { /* noop */ }
  };

  const totalDebt = lunchDebt + kioskDebt;
  const isNegative = balance < 0;

  return (
    <div className="text-center py-4 px-4">
      {/* Toggle ojo + label */}
      <button
        onClick={toggleBalance}
        className="inline-flex items-center gap-2 mb-3 px-3 py-1.5 rounded-full bg-slate-100/80 hover:bg-slate-200/80 active:scale-95 transition-all"
        aria-label={showBalance ? 'Ocultar saldo' : 'Mostrar saldo'}
      >
        <span className="text-sm text-slate-500 font-medium">Saldo disponible</span>
        {showBalance
          ? <Eye className="w-4 h-4 text-slate-400" />
          : <EyeOff className="w-4 h-4 text-slate-400" />
        }
      </button>

      {/* Monto */}
      <div className="relative mb-4">
        {isLoading ? (
          <Skeleton className="h-12 w-40 mx-auto" />
        ) : showBalance ? (
          <h1 className={`text-[3rem] font-light tracking-tight leading-none ${
            isNegative ? 'text-red-500' : 'text-slate-700'
          }`}>
            <span className="text-xl font-normal text-slate-400 mr-1">S/</span>
            <span className="font-semibold">{Math.abs(balance).toFixed(2)}</span>
            {isNegative && <span className="text-base ml-2 font-normal text-red-400">deuda</span>}
          </h1>
        ) : (
          <h1 className="text-[3rem] font-light text-slate-200 tracking-tight leading-none select-none">
            S/ ***.**
          </h1>
        )}
      </div>

      {/* Estado de deudas — muestra el total de TODOS los hijos para coincidir con módulo Pagos */}
      {isLoading ? (
        <Skeleton className="h-8 w-48 mx-auto rounded-full" />
      ) : totalDebt > 0 ? (
        <div className="flex justify-center gap-2 flex-wrap">
          {lunchDebt > 0 && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-full shadow-sm">
              <UtensilsCrossed className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-xs font-semibold text-amber-600">
                Almuerzos pendientes: {showBalance ? `S/ ${lunchDebt.toFixed(2)}` : 'S/ ••'}
              </span>
            </div>
          )}
          {kioskDebt > 0 && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-full shadow-sm">
              <ShoppingBag className="w-3.5 h-3.5 text-rose-500" />
              <span className="text-xs font-semibold text-rose-600">
                Kiosco: {showBalance ? `S/ ${kioskDebt.toFixed(2)}` : 'S/ ••'}
              </span>
            </div>
          )}
        </div>
      ) : !isNegative ? (
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-50 to-teal-50 rounded-full border border-emerald-100/80 shadow-sm">
          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center">
            <CircleCheck className="w-3 h-3 text-white" strokeWidth={3} />
          </div>
          <span className="text-sm font-semibold text-emerald-600">Sin deudas pendientes</span>
        </div>
      ) : null}
    </div>
  );
}
