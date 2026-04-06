/**
 * ServicesGrid — Cuadrícula de servicios secundarios, estilo Yape.
 *
 * 4 botones: Historial · Mensajes (destacado) · Topes · Soporte
 */
import { Clock, Headphones, ShieldCheck, MessageSquare } from 'lucide-react';

interface ServicesGridProps {
  onViewHistory: () => void;
  onTopes?: () => void;
  onMessages?: () => void;
  unreadNotifCount?: number;
  supportPhone?: string;
}

export function ServicesGrid({
  onViewHistory,
  onTopes,
  onMessages,
  unreadNotifCount = 0,
  supportPhone = '51991236870',
}: ServicesGridProps) {
  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-[1.75rem] shadow-lg shadow-slate-200/40 border border-white p-5">
      <div className="flex items-center gap-2 mb-4 px-1">
        <ShieldCheck className="w-4 h-4 text-amber-400" />
        <span className="text-sm font-semibold text-slate-500">Servicios rápidos</span>
      </div>

      <div className="grid grid-cols-4 gap-2">

        {/* ── HISTORIAL ── */}
        <button
          onClick={onViewHistory}
          className="flex flex-col items-center gap-2 p-2 rounded-2xl hover:bg-slate-50/80 active:scale-95 transition-all duration-200"
        >
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-gradient-to-br from-emerald-100 to-teal-100 ring-2 ring-emerald-200/50 shadow-sm">
            <Clock className="w-5 h-5 text-emerald-500" />
          </div>
          <span className="text-[10px] font-semibold text-slate-600 leading-tight text-center">
            Historial
          </span>
        </button>

        {/* ── MENSAJES — botón destacado con fondo sólido ── */}
        <button
          onClick={onMessages ?? (() => {})}
          className="relative flex flex-col items-center gap-2 p-2 rounded-2xl active:scale-95 transition-all duration-200"
        >
          <div className="relative w-12 h-12 rounded-2xl flex items-center justify-center bg-gradient-to-br from-blue-500 to-indigo-600 shadow-md shadow-blue-300/50">
            <MessageSquare className="w-5 h-5 text-white" />
            {/* Badge de no leídos */}
            {unreadNotifCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5">
                {/* Aro exterior pulsante */}
                <span className="absolute inset-0 w-[18px] h-[18px] bg-red-400 rounded-full animate-ping opacity-75" />
                {/* Bolita sólida con número */}
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

        {/* ── TOPES DE CONSUMO ── */}
        <button
          onClick={onTopes ?? (() => {})}
          className="flex flex-col items-center gap-2 p-2 rounded-2xl hover:bg-slate-50/80 active:scale-95 transition-all duration-200"
        >
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-gradient-to-br from-amber-100 to-orange-100 ring-2 ring-amber-200/50 shadow-sm">
            <ShieldCheck className="w-5 h-5 text-amber-500" />
          </div>
          <span className="text-[10px] font-semibold text-slate-600 leading-tight text-center whitespace-pre-line">
            {'Topes de\nConsumo'}
          </span>
        </button>

        {/* ── SOPORTE ── */}
        <button
          onClick={() => {
            window.open(
              `https://wa.me/${supportPhone}?text=Hola%2C%20necesito%20soporte%20con%20el%20portal%20de%20padres.`,
              '_blank',
            );
          }}
          className="flex flex-col items-center gap-2 p-2 rounded-2xl hover:bg-slate-50/80 active:scale-95 transition-all duration-200"
        >
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-gradient-to-br from-violet-100 to-purple-100 ring-2 ring-violet-200/50 shadow-sm">
            <Headphones className="w-5 h-5 text-violet-500" />
          </div>
          <span className="text-[10px] font-semibold text-slate-600 leading-tight text-center">
            Soporte
          </span>
        </button>

      </div>
    </div>
  );
}
