/**
 * BalanceHero — muestra únicamente la Deuda Total del padre.
 *
 * Regla de negocio:
 *  - Saldo positivo: NO se muestra (oculto completamente).
 *  - Deuda de Kiosco = |balance| si balance < 0, si no 0.
 *  - Deuda Total = Deuda de Kiosco + Almuerzos pendientes (ya excluye "en revisión").
 *  - Si total == 0 → chip verde "Sin deudas".
 */
import { UtensilsCrossed, ShoppingBag, CircleCheck } from 'lucide-react';

interface BalanceHeroProps {
  studentId: string | null;
  studentName: string;
  photoUrl: string | null;
  /** Suma de |balance| de todos los hijos con balance negativo */
  kioskBalanceDebt: number;
  /** Suma de deudas de almuerzo pendientes (excluye "en revisión") */
  lunchDebt: number;
  isLoading: boolean;
  // Props legadas — se mantienen para no romper el llamador
  balance?: number;
  kioskDebt?: number;
}

const Skeleton = ({ className }: { className?: string }) => (
  <div className={`animate-pulse bg-slate-200 rounded-xl ${className ?? ''}`} />
);

export function BalanceHero({
  kioskBalanceDebt = 0,
  lunchDebt = 0,
  isLoading,
}: BalanceHeroProps) {
  const totalDebt = kioskBalanceDebt + lunchDebt;

  return (
    <div className="text-center py-4 px-4">
      {isLoading ? (
        <div className="space-y-2 flex flex-col items-center">
          <Skeleton className="h-4 w-24 rounded-full" />
          <Skeleton className="h-12 w-40" />
        </div>
      ) : totalDebt > 0 ? (
        <>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
            Deuda pendiente
          </p>
          <h1 className="text-[3rem] font-light tracking-tight leading-none text-rose-500 mb-3">
            <span className="text-xl font-normal text-rose-300 mr-1">S/</span>
            <span className="font-semibold">{totalDebt.toFixed(2)}</span>
          </h1>

          {/* Chips de desglose */}
          <div className="flex justify-center gap-2 flex-wrap">
            {kioskBalanceDebt > 0 && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-full shadow-sm">
                <ShoppingBag className="w-3.5 h-3.5 text-rose-500" />
                <span className="text-xs font-semibold text-rose-600">
                  Cafetería: S/ {kioskBalanceDebt.toFixed(2)}
                </span>
              </div>
            )}
            {lunchDebt > 0 && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-full shadow-sm">
                <UtensilsCrossed className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-xs font-semibold text-amber-600">
                  Almuerzos: S/ {lunchDebt.toFixed(2)}
                </span>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-50 to-teal-50 rounded-full border border-emerald-100/80 shadow-sm">
          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center">
            <CircleCheck className="w-3 h-3 text-white" strokeWidth={3} />
          </div>
          <span className="text-sm font-semibold text-emerald-600">Sin deudas pendientes</span>
        </div>
      )}
    </div>
  );
}
