import { CircleCheck, UtensilsCrossed } from 'lucide-react';
import { useStudentCartDebt } from '@/hooks/useStudentCartDebt';

interface BalanceHeroProps {
  parentId: string | null;
  studentId: string | null;
  isLoading?: boolean;
}

const Skeleton = ({ className }: { className?: string }) => (
  <div className={`animate-pulse bg-slate-200 rounded-xl ${className ?? ''}`} />
);

export function BalanceHero({
  parentId,
  studentId,
  isLoading,
}: BalanceHeroProps) {
  const {
    totalDebt,
    inReviewDebt,
    isLoading: isDebtLoading,
    error,
  } = useStudentCartDebt(parentId, studentId);
  const shouldShowLoading = Boolean(isLoading) || isDebtLoading;
  const currentDebt = totalDebt;

  return (
    <div className="text-center py-4 px-4">
      {shouldShowLoading ? (
        <div className="space-y-2 flex flex-col items-center">
          <Skeleton className="h-4 w-24 rounded-full" />
          <Skeleton className="h-12 w-40" />
          <Skeleton className="h-7 w-36 rounded-full" />
        </div>
      ) : error ? (
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-amber-50 rounded-full border border-amber-200 shadow-sm">
          <span className="text-sm font-semibold text-amber-700">No se pudo cargar el saldo actual</span>
        </div>
      ) : currentDebt > 0 ? (
        <>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
            Deuda pendiente
          </p>
          <h1 className="text-[3rem] font-light tracking-tight leading-none text-rose-500 mb-3">
            <span className="text-xl font-normal text-rose-300 mr-1">S/</span>
            <span className="font-semibold">{currentDebt.toFixed(2)}</span>
          </h1>
          <div className="flex justify-center gap-2 flex-wrap">
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-full shadow-sm">
              <UtensilsCrossed className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-xs font-semibold text-amber-600">Deuda: S/ {currentDebt.toFixed(2)}</span>
            </div>
            {inReviewDebt > 0 && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-full shadow-sm">
                <span className="text-xs font-semibold text-blue-600">En revisión: S/ {inReviewDebt.toFixed(2)}</span>
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
