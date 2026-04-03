/**
 * HeroActions — Botones de acción principales estilo v0/Yape
 *
 * Dos botones horizontales (ícono + texto) lado a lado.
 * · Almuerzos → gradiente verde esmeralda
 * · Pagos     → gradiente violeta/índigo + badge rojo animado
 *
 * Toda lógica viene de Index.tsx a través de props.
 */
import { Utensils, ShoppingCart, Wrench } from 'lucide-react';

interface HeroActionsProps {
  activeStudentName: string;
  schoolName?: string;
  onAlmuerzos: () => void;
  onPagos: () => void;
  pendingPaymentsCount: number;
  almuerzosEnMantenimiento: boolean;
  isTransitioning: boolean;
}

/** Colores personalizados por sede */
const SCHOOL_COLORS: Record<string, string> = {
  'jean lebouch': 'from-blue-700 via-blue-600 to-blue-500',
};

function getLunchGradient(schoolName?: string): string {
  if (!schoolName) return 'from-emerald-400 via-emerald-500 to-teal-600';
  const key = schoolName.toLowerCase();
  for (const [pattern, gradient] of Object.entries(SCHOOL_COLORS)) {
    if (key.includes(pattern)) return gradient;
  }
  return 'from-emerald-400 via-emerald-500 to-teal-600';
}

export function HeroActions({
  activeStudentName,
  schoolName,
  onAlmuerzos,
  onPagos,
  pendingPaymentsCount,
  almuerzosEnMantenimiento,
  isTransitioning,
}: HeroActionsProps) {
  const lunchGradient = getLunchGradient(schoolName);

  return (
    <div className="flex gap-3">

      {/* ── ALMUERZOS ─────────────────────────────────────────── */}
      <button
        onClick={() => { if (!isTransitioning && !almuerzosEnMantenimiento) onAlmuerzos(); }}
        disabled={almuerzosEnMantenimiento || isTransitioning}
        className={`flex-1 rounded-[1.25rem] p-4 shadow-lg active:scale-[0.97] transition-all duration-200 ${
          almuerzosEnMantenimiento
            ? 'bg-slate-100 opacity-60 cursor-not-allowed shadow-none'
            : `bg-gradient-to-br ${lunchGradient} shadow-emerald-300/40 hover:shadow-xl hover:shadow-emerald-300/50`
        }`}
        aria-label={`Almuerzos de ${activeStudentName}`}
      >
        <div className="flex items-center gap-3">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${
            almuerzosEnMantenimiento ? 'bg-slate-200' : 'bg-white/25 backdrop-blur-sm'
          }`}>
            {almuerzosEnMantenimiento
              ? <Wrench className="w-5 h-5 text-slate-400" />
              : <Utensils className="w-5 h-5 text-white" />
            }
          </div>
          <div className="text-left">
            <span className={`font-bold text-sm block ${almuerzosEnMantenimiento ? 'text-slate-400' : 'text-white'}`}>
              Almuerzos
            </span>
            <span className={`text-xs ${almuerzosEnMantenimiento ? 'text-slate-400' : 'text-white/70'}`}>
              {almuerzosEnMantenimiento ? 'En mantenimiento' : `Para ${activeStudentName.split(' ')[0]}`}
            </span>
          </div>
        </div>
      </button>

      {/* ── PAGOS ─────────────────────────────────────────────── */}
      <button
        onClick={() => { if (!isTransitioning) onPagos(); }}
        disabled={isTransitioning}
        className="flex-1 bg-gradient-to-br from-violet-400 via-violet-500 to-indigo-600 rounded-[1.25rem] p-4 shadow-lg shadow-violet-300/40 relative active:scale-[0.97] transition-all duration-200 hover:shadow-xl hover:shadow-violet-300/50"
        aria-label="Ir a pagos"
      >
        {/* Badge animado */}
        {pendingPaymentsCount > 0 && (
          <div className="absolute -top-1.5 -right-1.5">
            <span className="absolute inset-0 w-5 h-5 bg-red-400 rounded-full animate-ping opacity-75" />
            <span className="relative flex items-center justify-center w-5 h-5 bg-gradient-to-br from-red-400 to-red-600 rounded-full border-2 border-white shadow-md text-white text-[10px] font-bold">
              {pendingPaymentsCount > 9 ? '9+' : pendingPaymentsCount}
            </span>
          </div>
        )}

        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-white/25 rounded-xl flex items-center justify-center backdrop-blur-sm">
            <ShoppingCart className="w-5 h-5 text-white" />
          </div>
          <div className="text-left">
            <span className="text-white font-bold text-sm block">Pagos</span>
            <span className="text-white/70 text-xs">
              {pendingPaymentsCount > 0 ? `${pendingPaymentsCount} pendiente${pendingPaymentsCount > 1 ? 's' : ''}` : 'Historial y deudas'}
            </span>
          </div>
        </div>
      </button>

    </div>
  );
}
