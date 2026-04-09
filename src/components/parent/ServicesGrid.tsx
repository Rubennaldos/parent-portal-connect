/**
 * ServicesGrid — Cuadrícula de servicios secundarios, estilo Yape.
 *
 * Fila 1: Historial de Compras · Mensajes (destacado) · Topes
 * Fila 2: Soporte · Agregar Hijo
 */
import { ShoppingBag, Headphones, ShieldCheck, MessageSquare, UserPlus, Wallet } from 'lucide-react';

interface ServicesGridProps {
  onViewHistory:   () => void;
  onTopes?:        () => void;
  onMessages?:     () => void;
  onAddStudent?:   () => void;
  onBalance?:      () => void;
  studentBalance?: number;
  unreadNotifCount?: number;
  supportPhone?:   string;
}

export function ServicesGrid({
  onViewHistory,
  onTopes,
  onMessages,
  onAddStudent,
  onBalance,
  studentBalance = 0,
  unreadNotifCount = 0,
  supportPhone = '51991236870',
}: ServicesGridProps) {
  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-[1.75rem] shadow-lg shadow-slate-200/40 border border-white p-5">
      <div className="flex items-center gap-2 mb-4 px-1">
        <ShieldCheck className="w-4 h-4 text-amber-400" />
        <span className="text-sm font-semibold text-slate-500">Servicios rápidos</span>
      </div>

      {/* ── Fila 1: 3 botones ── */}
      <div className="grid grid-cols-3 gap-2 mb-2">

        {/* HISTORIAL DE COMPRAS */}
        <ServiceButton
          label={"Historial de\nCompras"}
          Icon={ShoppingBag}
          iconBg="bg-gradient-to-br from-orange-100 to-amber-100"
          iconColor="text-orange-500"
          ring="ring-orange-200/50"
          onClick={onViewHistory}
        />

        {/* MENSAJES — destacado */}
        <button
          onClick={onMessages ?? (() => {})}
          className="relative flex flex-col items-center gap-2 p-2 rounded-2xl active:scale-95 transition-all duration-200"
        >
          <div className="relative w-12 h-12 rounded-2xl flex items-center justify-center bg-gradient-to-br from-blue-500 to-indigo-600 shadow-md shadow-blue-300/50">
            <MessageSquare className="w-5 h-5 text-white" />
            {unreadNotifCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5">
                <span className="absolute inset-0 w-[18px] h-[18px] bg-red-400 rounded-full animate-ping opacity-75" />
                <span className="relative flex items-center justify-center min-w-[18px] h-[18px] bg-gradient-to-br from-red-400 to-red-600 rounded-full border-2 border-white shadow-md text-white text-[9px] font-black px-1">
                  {unreadNotifCount > 99 ? '99+' : unreadNotifCount}
                </span>
              </span>
            )}
          </div>
          <span className="text-[10px] font-bold text-blue-700 leading-tight text-center">
            Mensajes
          </span>
        </button>

        {/* TOPES DE CONSUMO */}
        <ServiceButton
          label={'Topes de\nConsumo'}
          Icon={ShieldCheck}
          iconBg="bg-gradient-to-br from-amber-100 to-orange-100"
          iconColor="text-amber-500"
          ring="ring-amber-200/50"
          onClick={onTopes ?? (() => {})}
        />

      </div>

      {/* ── Fila 2: 3 botones ── */}
      <div className="grid grid-cols-3 gap-2">

        {/* SALDO */}
        <button
          onClick={onBalance ?? (() => {})}
          className="flex flex-col items-center gap-2 p-2 rounded-2xl hover:bg-slate-50/80 active:scale-95 transition-all duration-200"
        >
          <div className={`relative w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm
            ${studentBalance > 0
              ? 'bg-gradient-to-br from-emerald-400 to-teal-500 ring-2 ring-emerald-200/60'
              : 'bg-gradient-to-br from-slate-100 to-slate-200 ring-2 ring-slate-200/50'
            }`}
          >
            <Wallet className={`w-5 h-5 ${studentBalance > 0 ? 'text-white' : 'text-slate-400'}`} />
            {studentBalance > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-[18px] flex items-center justify-center bg-gradient-to-br from-emerald-400 to-emerald-600 border-2 border-white rounded-full shadow-sm text-white text-[8px] font-black px-1">
                ✓
              </span>
            )}
          </div>
          <div className="flex flex-col items-center gap-0">
            <span className={`text-[10px] font-semibold leading-tight text-center ${studentBalance > 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
              Mi Saldo
            </span>
            {studentBalance > 0 && (
              <span className="text-[9px] font-bold text-emerald-500 leading-none">
                S/ {studentBalance.toFixed(2)}
              </span>
            )}
          </div>
        </button>

        {/* SOPORTE */}
        <ServiceButton
          label="Soporte"
          Icon={Headphones}
          iconBg="bg-gradient-to-br from-violet-100 to-purple-100"
          iconColor="text-violet-500"
          ring="ring-violet-200/50"
          onClick={() =>
            window.open(
              `https://wa.me/${supportPhone}?text=Hola%2C%20necesito%20soporte%20con%20el%20portal%20de%20padres.`,
              '_blank',
            )
          }
        />

        {/* AGREGAR HIJO */}
        <ServiceButton
          label="Agregar Hijo"
          Icon={UserPlus}
          iconBg="bg-gradient-to-br from-pink-100 to-rose-100"
          iconColor="text-pink-500"
          ring="ring-pink-200/50"
          onClick={onAddStudent ?? (() => {})}
        />

      </div>
    </div>
  );
}

// ─── Botón genérico reutilizable ───────────────────────────────────────────

function ServiceButton({
  label,
  Icon,
  iconBg,
  iconColor,
  ring,
  onClick,
}: {
  label: string;
  Icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  ring: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 p-2 rounded-2xl hover:bg-slate-50/80 active:scale-95 transition-all duration-200"
    >
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${iconBg} ring-2 ${ring} shadow-sm`}>
        <Icon className={`w-5 h-5 ${iconColor}`} />
      </div>
      <span className="text-[10px] font-semibold text-slate-600 leading-tight text-center whitespace-pre-line">
        {label}
      </span>
    </button>
  );
}
