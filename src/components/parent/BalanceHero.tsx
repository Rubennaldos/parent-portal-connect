/**
 * BalanceHero — muestra la Deuda del padre.
 *
 * Tres modos de vista (toggle):
 *  - "consolidated": total grande + chips de desglose del hijo activo
 *  - "split":        dos tarjetas independientes del hijo activo
 *  - "family":       deuda combinada de todos los hijos (solo cuando hay >1 hijo)
 *
 * Regla de negocio:
 *  - Saldo positivo: NO se muestra.
 *  - Si total == 0 → chip verde "Sin deudas".
 */
import { useState } from 'react';
import { UtensilsCrossed, ShoppingBag, CircleCheck, LayoutList, PieChart, Users } from 'lucide-react';

interface BalanceHeroProps {
  studentId: string | null;
  studentName: string;
  photoUrl: string | null;
  /** Deuda de cafetería del hijo activo */
  kioskBalanceDebt: number;
  /** Deuda de almuerzos pendientes del hijo activo */
  lunchDebt: number;
  isLoading: boolean;
  /** Deuda de cafetería de TODOS los hijos sumada */
  familyKioskDebt?: number;
  /** Deuda de almuerzos de TODOS los hijos sumada */
  familyLunchDebt?: number;
  /** true si el padre tiene más de 1 hijo — habilita la vista Familia */
  multipleChildren?: boolean;
  // Props legadas
  balance?: number;
  kioskDebt?: number;
}

const Skeleton = ({ className }: { className?: string }) => (
  <div className={`animate-pulse bg-slate-200 rounded-xl ${className ?? ''}`} />
);

type ViewMode = 'consolidated' | 'split' | 'family';

function DebtChips({ kiosk, lunch }: { kiosk: number; lunch: number }) {
  return (
    <div className="flex justify-center gap-2 flex-wrap">
      {kiosk > 0 && (
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-full shadow-sm">
          <ShoppingBag className="w-3.5 h-3.5 text-rose-500" />
          <span className="text-xs font-semibold text-rose-600">Cafetería: S/ {kiosk.toFixed(2)}</span>
        </div>
      )}
      {lunch > 0 && (
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-full shadow-sm">
          <UtensilsCrossed className="w-3.5 h-3.5 text-amber-500" />
          <span className="text-xs font-semibold text-amber-600">Almuerzos: S/ {lunch.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}

function DebtCards({ kiosk, lunch }: { kiosk: number; lunch: number }) {
  return (
    <div className="flex justify-center gap-3 flex-wrap">
      {kiosk > 0 && (
        <div className="flex flex-col items-center gap-1 px-5 py-3 bg-rose-50 border border-rose-200 rounded-2xl shadow-sm min-w-[110px]">
          <ShoppingBag className="w-5 h-5 text-rose-500" />
          <span className="text-[10px] font-semibold text-rose-400 uppercase tracking-wider">Cafetería</span>
          <span className="text-2xl font-bold text-rose-500 leading-none">S/ {kiosk.toFixed(2)}</span>
          <span className="text-[9px] text-rose-300 font-medium">pendiente</span>
        </div>
      )}
      {lunch > 0 && (
        <div className="flex flex-col items-center gap-1 px-5 py-3 bg-amber-50 border border-amber-200 rounded-2xl shadow-sm min-w-[110px]">
          <UtensilsCrossed className="w-5 h-5 text-amber-500" />
          <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">Almuerzos</span>
          <span className="text-2xl font-bold text-amber-500 leading-none">S/ {lunch.toFixed(2)}</span>
          <span className="text-[9px] text-amber-300 font-medium">pendiente</span>
        </div>
      )}
    </div>
  );
}

export function BalanceHero({
  kioskBalanceDebt = 0,
  lunchDebt = 0,
  familyKioskDebt = 0,
  familyLunchDebt = 0,
  multipleChildren = false,
  isLoading,
}: BalanceHeroProps) {
  const totalDebt       = kioskBalanceDebt + lunchDebt;
  const familyTotalDebt = familyKioskDebt + familyLunchDebt;

  const [viewMode, setViewMode] = useState<ViewMode>('consolidated');

  // El toggle aparece si: hay ambos tipos de deuda del activo  O  hay más de 1 hijo
  const hasBothTypes    = kioskBalanceDebt > 0 && lunchDebt > 0;
  const showToggle      = (hasBothTypes || multipleChildren) && totalDebt > 0;
  const showFamilyTab   = multipleChildren;

  return (
    <div className="text-center py-4 px-4">
      {isLoading ? (
        <div className="space-y-2 flex flex-col items-center">
          <Skeleton className="h-4 w-24 rounded-full" />
          <Skeleton className="h-12 w-40" />
        </div>
      ) : totalDebt > 0 || familyTotalDebt > 0 ? (
        <>
          {/* ── Toggle de vista ── */}
          {showToggle && (
            <div className="flex justify-center mb-3">
              <div className="inline-flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-full">
                <button
                  onClick={() => setViewMode('consolidated')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all ${
                    viewMode === 'consolidated'
                      ? 'bg-white text-slate-700 shadow-sm'
                      : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <PieChart className="w-2.5 h-2.5" />
                  Total
                </button>
                {hasBothTypes && (
                  <button
                    onClick={() => setViewMode('split')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all ${
                      viewMode === 'split'
                        ? 'bg-white text-slate-700 shadow-sm'
                        : 'text-slate-400 hover:text-slate-600'
                    }`}
                  >
                    <LayoutList className="w-2.5 h-2.5" />
                    Por tipo
                  </button>
                )}
                {showFamilyTab && (
                  <button
                    onClick={() => setViewMode('family')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all ${
                      viewMode === 'family'
                        ? 'bg-white text-indigo-700 shadow-sm'
                        : 'text-slate-400 hover:text-slate-600'
                    }`}
                  >
                    <Users className="w-2.5 h-2.5" />
                    Familia
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Vista: Consolidada (hijo activo) ── */}
          {viewMode === 'consolidated' && (
            <>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                Deuda pendiente
              </p>
              <h1 className="text-[3rem] font-light tracking-tight leading-none text-rose-500 mb-3">
                <span className="text-xl font-normal text-rose-300 mr-1">S/</span>
                <span className="font-semibold">{totalDebt.toFixed(2)}</span>
              </h1>
              <DebtChips kiosk={kioskBalanceDebt} lunch={lunchDebt} />
            </>
          )}

          {/* ── Vista: Por tipo (hijo activo) ── */}
          {viewMode === 'split' && (
            <DebtCards kiosk={kioskBalanceDebt} lunch={lunchDebt} />
          )}

          {/* ── Vista: Familia (todos los hijos) ── */}
          {viewMode === 'family' && (
            <>
              <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-1">
                Deuda total familia
              </p>
              <h1 className="text-[3rem] font-light tracking-tight leading-none text-indigo-500 mb-3">
                <span className="text-xl font-normal text-indigo-300 mr-1">S/</span>
                <span className="font-semibold">{familyTotalDebt.toFixed(2)}</span>
              </h1>
              <div className="flex justify-center gap-2 flex-wrap">
                {familyKioskDebt > 0 && (
                  <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 border border-rose-200 rounded-full shadow-sm">
                    <ShoppingBag className="w-3.5 h-3.5 text-rose-500" />
                    <span className="text-xs font-semibold text-rose-600">Cafetería: S/ {familyKioskDebt.toFixed(2)}</span>
                  </div>
                )}
                {familyLunchDebt > 0 && (
                  <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-full shadow-sm">
                    <UtensilsCrossed className="w-3.5 h-3.5 text-amber-500" />
                    <span className="text-xs font-semibold text-amber-600">Almuerzos: S/ {familyLunchDebt.toFixed(2)}</span>
                  </div>
                )}
              </div>
              <p className="text-[10px] text-indigo-300 mt-2">suma de todos tus hijos</p>
            </>
          )}
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
