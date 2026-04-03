/**
 * BalanceHero — Módulo de saldo estilo Yape
 *
 * Muestra el saldo del hijo actualmente seleccionado en el carrusel.
 * - Botón ojo para mostrar/ocultar el monto
 * - Skeleton animado mientras los datos cargan (evita mostrar S/ 0.00 falso)
 * - Deuda de almuerzo y kiosco con colores de alerta
 * - Persistencia del show/hide en localStorage por usuario
 *
 * Props recibidas desde Index.tsx — usa SOLO variables ya existentes,
 * no crea queries nuevas ni accede directamente a Supabase.
 */
import { useState } from 'react';
import { Eye, EyeOff, AlertTriangle, UtensilsCrossed, ShoppingBag } from 'lucide-react';

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
  <div className={`animate-pulse bg-white/25 rounded-lg ${className ?? ''}`} />
);

export function BalanceHero({
  studentId,
  studentName,
  photoUrl,
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
    <div className="mx-3 sm:mx-0 rounded-2xl bg-gradient-to-br from-emerald-600 via-emerald-700 to-[#6B5744] p-5 sm:p-6 shadow-xl text-white">

      {/* Cabecera: nombre del alumno */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          {isLoading ? (
            <Skeleton className="w-10 h-10 rounded-full" />
          ) : photoUrl ? (
            <img
              src={photoUrl}
              alt={studentName}
              className="w-10 h-10 rounded-full object-cover border-2 border-white/40"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white font-semibold text-base">
              {studentName.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            {isLoading ? (
              <Skeleton className="h-4 w-32 mb-1" />
            ) : (
              <p className="font-semibold text-sm sm:text-base leading-tight">{studentName}</p>
            )}
            <p className="text-white/60 text-[10px] sm:text-xs uppercase tracking-wider">Saldo disponible</p>
          </div>
        </div>

        {/* Botón ojo */}
        <button
          onClick={toggleBalance}
          className="p-2 rounded-full bg-white/15 hover:bg-white/25 active:scale-95 transition-all"
          aria-label={showBalance ? 'Ocultar saldo' : 'Mostrar saldo'}
        >
          {showBalance
            ? <Eye className="h-4 w-4 text-white/80" />
            : <EyeOff className="h-4 w-4 text-white/80" />
          }
        </button>
      </div>

      {/* Monto principal */}
      <div className="mb-5">
        {isLoading ? (
          <Skeleton className="h-10 w-36 mb-1" />
        ) : showBalance ? (
          <p className={`text-4xl sm:text-5xl font-light tracking-tight tabular-nums transition-all duration-300 ${isNegative ? 'text-red-300' : 'text-white'}`}>
            <span className="text-xl sm:text-2xl align-top mt-2 inline-block mr-0.5 font-normal opacity-80">S/</span>
            {Math.abs(balance).toFixed(2)}
            {isNegative && <span className="text-base ml-1 text-red-300 font-normal">deuda</span>}
          </p>
        ) : (
          <p className="text-4xl sm:text-5xl font-light tracking-tight text-white/40 select-none">
            <span className="text-xl align-top mt-2 inline-block mr-0.5 opacity-60">S/</span>
            ••••
          </p>
        )}
      </div>

      {/* Deudas — solo si hay */}
      {!isLoading && totalDebt > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {lunchDebt > 0 && (
            <div className="flex items-center gap-1.5 bg-red-500/25 border border-red-400/30 rounded-xl px-3 py-2">
              <UtensilsCrossed className="h-3.5 w-3.5 text-red-300 shrink-0" />
              <div>
                <p className="text-[9px] text-red-300 uppercase tracking-wider leading-none mb-0.5">Almuerzo</p>
                <p className="text-sm font-semibold text-red-200">
                  {showBalance ? `S/ ${lunchDebt.toFixed(2)}` : 'S/ ••'}
                </p>
              </div>
            </div>
          )}
          {kioskDebt > 0 && (
            <div className="flex items-center gap-1.5 bg-amber-500/25 border border-amber-400/30 rounded-xl px-3 py-2">
              <ShoppingBag className="h-3.5 w-3.5 text-amber-300 shrink-0" />
              <div>
                <p className="text-[9px] text-amber-300 uppercase tracking-wider leading-none mb-0.5">Kiosco</p>
                <p className="text-sm font-semibold text-amber-200">
                  {showBalance ? `S/ ${kioskDebt.toFixed(2)}` : 'S/ ••'}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sin deudas */}
      {!isLoading && totalDebt === 0 && !isNegative && (
        <div className="flex items-center gap-1.5 bg-white/10 rounded-xl px-3 py-2">
          <div className="w-2 h-2 rounded-full bg-emerald-300" />
          <p className="text-xs text-white/70">Sin deudas pendientes</p>
        </div>
      )}

      {/* Skeleton deudas */}
      {isLoading && (
        <div className="flex gap-2">
          <Skeleton className="h-10 flex-1" />
          <Skeleton className="h-10 flex-1" />
        </div>
      )}
    </div>
  );
}
