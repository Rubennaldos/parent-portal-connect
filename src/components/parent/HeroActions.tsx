/**
 * HeroActions — Botones de acción gigante estilo Yape
 *
 * Muestra dos acciones principales debajo del BalanceHero:
 *  · Almuerzos — abre la pestaña de pedidos, deshabilitado si hay mantenimiento
 *  · Pagos     — abre la pestaña de carrito/pagos pendientes, badge rojo con conteo
 *
 * No tiene lógica propia: todas las decisiones vienen de Index.tsx a través de props.
 * Si activeStudentId cambia en el carrusel, los botones reflejan el cambio de inmediato
 * porque React re-renderiza este componente con las nuevas props.
 */
import { UtensilsCrossed, ShoppingCart, Wrench } from 'lucide-react';

interface HeroActionsProps {
  /** Nombre del hijo activo (para el tooltip del botón de almuerzos) */
  activeStudentName: string;
  /** Nombre de la sede del hijo activo (para personalización de colores) */
  schoolName?: string;
  /** Navega a la pestaña de almuerzos */
  onAlmuerzos: () => void;
  /** Navega a la pestaña de pagos/carrito */
  onPagos: () => void;
  /** Total de pagos pendientes para mostrar en el badge */
  pendingPaymentsCount: number;
  /** Si hay mantenimiento activo en almuerzos para esta sede */
  almuerzosEnMantenimiento: boolean;
  /** Lock de transición: evita doble click durante slide del carrusel */
  isTransitioning: boolean;
}

/** Colores personalizados por sede — fácil de ampliar */
const SCHOOL_COLORS: Record<string, { from: string; to: string; text: string }> = {
  'jean lebouch': { from: 'from-blue-700', to: 'to-blue-500', text: 'Jean LeBouch' },
};

function getSchoolLunchColors(schoolName?: string) {
  if (!schoolName) return null;
  const key = schoolName.toLowerCase();
  for (const [pattern, colors] of Object.entries(SCHOOL_COLORS)) {
    if (key.includes(pattern)) return colors;
  }
  return null;
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
  const lunchColors = getSchoolLunchColors(schoolName);

  const lunchBg = almuerzosEnMantenimiento
    ? 'bg-stone-100 border-stone-200'
    : lunchColors
      ? `bg-gradient-to-br ${lunchColors.from} ${lunchColors.to} border-transparent`
      : 'bg-gradient-to-br from-emerald-500 to-emerald-700 border-transparent';

  const lunchText = almuerzosEnMantenimiento
    ? 'text-stone-400'
    : 'text-white';

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 px-1">

      {/* ── BOTÓN ALMUERZOS ─────────────────────────────────────── */}
      <button
        onClick={() => { if (!isTransitioning && !almuerzosEnMantenimiento) onAlmuerzos(); }}
        disabled={almuerzosEnMantenimiento || isTransitioning}
        className={`
          relative flex flex-col items-center justify-center
          gap-2 sm:gap-3 py-5 sm:py-6 px-3
          rounded-2xl border-2 shadow-md
          transition-all duration-200
          active:scale-95
          ${lunchBg}
          ${almuerzosEnMantenimiento
            ? 'opacity-60 cursor-not-allowed'
            : 'hover:shadow-lg hover:brightness-105 cursor-pointer'
          }
        `}
        aria-label={`Ir a almuerzos de ${activeStudentName}`}
      >
        {almuerzosEnMantenimiento && (
          <span className="absolute top-2 right-2">
            <Wrench className="h-3 w-3 text-stone-400" />
          </span>
        )}

        <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center ${
          almuerzosEnMantenimiento ? 'bg-stone-200' : 'bg-white/20'
        }`}>
          <UtensilsCrossed className={`h-6 w-6 sm:h-7 sm:w-7 ${lunchText}`} />
        </div>

        <div className="text-center">
          <p className={`text-sm sm:text-base font-semibold leading-tight ${lunchText}`}>
            Almuerzos
          </p>
          {almuerzosEnMantenimiento ? (
            <p className="text-[10px] text-stone-400 mt-0.5 leading-tight">
              En mantenimiento
            </p>
          ) : (
            <p className={`text-[10px] sm:text-xs mt-0.5 leading-tight ${lunchText} opacity-80`}>
              Pedir para {activeStudentName.split(' ')[0]}
            </p>
          )}
        </div>
      </button>

      {/* ── BOTÓN PAGOS ─────────────────────────────────────────── */}
      <button
        onClick={() => { if (!isTransitioning) onPagos(); }}
        disabled={isTransitioning}
        className={`
          relative flex flex-col items-center justify-center
          gap-2 sm:gap-3 py-5 sm:py-6 px-3
          rounded-2xl border-2 shadow-md
          transition-all duration-200
          active:scale-95 cursor-pointer
          hover:shadow-lg hover:brightness-105
          ${pendingPaymentsCount > 0
            ? 'bg-gradient-to-br from-red-500 to-rose-600 border-transparent'
            : 'bg-gradient-to-br from-indigo-500 to-violet-600 border-transparent'
          }
        `}
        aria-label="Ir a pagos y carrito"
      >
        {/* Badge de pagos pendientes */}
        {pendingPaymentsCount > 0 && (
          <span className="absolute -top-2 -right-2 flex">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex items-center justify-center h-6 w-6 rounded-full bg-red-600 border-2 border-white text-white text-[9px] font-bold shadow-lg">
              {pendingPaymentsCount > 9 ? '9+' : pendingPaymentsCount}
            </span>
          </span>
        )}

        <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-white/20 flex items-center justify-center">
          <ShoppingCart className={`h-6 w-6 sm:h-7 sm:w-7 text-white ${pendingPaymentsCount > 0 ? 'animate-bounce' : ''}`} />
        </div>

        <div className="text-center">
          <p className="text-sm sm:text-base font-semibold text-white leading-tight">
            Pagos
          </p>
          <p className="text-[10px] sm:text-xs text-white/80 mt-0.5 leading-tight">
            {pendingPaymentsCount > 0
              ? `${pendingPaymentsCount} pendiente${pendingPaymentsCount > 1 ? 's' : ''}`
              : 'Historial y deudas'
            }
          </p>
        </div>
      </button>
    </div>
  );
}
