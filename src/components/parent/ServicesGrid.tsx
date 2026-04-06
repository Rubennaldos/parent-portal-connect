/**
 * ServicesGrid — Cuadrícula de servicios secundarios, estilo Yape.
 *
 * Botones de acceso rápido: Historial, Mensajes, Topes de Consumo, Soporte.
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
  const services = [
    {
      id: 'historial',
      label: 'Historial',
      Icon: Clock,
      bg: 'bg-gradient-to-br from-emerald-100 to-teal-100',
      iconColor: 'text-emerald-500',
      ring: 'ring-emerald-200/50',
      action: onViewHistory,
      badge: 0,
    },
    {
      id: 'mensajes',
      label: 'Mensajes',
      Icon: MessageSquare,
      bg: 'bg-gradient-to-br from-blue-100 to-indigo-100',
      iconColor: 'text-blue-500',
      ring: 'ring-blue-200/50',
      action: onMessages ?? (() => {}),
      badge: unreadNotifCount,
    },
    {
      id: 'topes',
      label: 'Topes de\nConsumo',
      Icon: ShieldCheck,
      bg: 'bg-gradient-to-br from-amber-100 to-orange-100',
      iconColor: 'text-amber-500',
      ring: 'ring-amber-200/50',
      action: onTopes ?? (() => {}),
      badge: 0,
    },
    {
      id: 'soporte',
      label: 'Soporte',
      Icon: Headphones,
      bg: 'bg-gradient-to-br from-violet-100 to-purple-100',
      iconColor: 'text-violet-500',
      ring: 'ring-violet-200/50',
      action: () => {
        window.open(
          `https://wa.me/${supportPhone}?text=Hola%2C%20necesito%20soporte%20con%20el%20portal%20de%20padres.`,
          '_blank',
        );
      },
      badge: 0,
    },
  ];

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-[1.75rem] shadow-lg shadow-slate-200/40 border border-white p-5">
      <div className="flex items-center gap-2 mb-4 px-1">
        <ShieldCheck className="w-4 h-4 text-amber-400" />
        <span className="text-sm font-semibold text-slate-500">Servicios rápidos</span>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {services.map(({ id, label, Icon, bg, iconColor, ring, action, badge }) => (
          <button
            key={id}
            onClick={action}
            className="relative flex flex-col items-center gap-2 p-2 rounded-2xl hover:bg-slate-50/80 cursor-pointer active:scale-95 transition-all duration-200"
          >
            {/* Ícono con badge */}
            <div className={`relative w-12 h-12 rounded-2xl flex items-center justify-center ${bg} ring-2 ${ring} shadow-sm`}>
              <Icon className={`w-5 h-5 ${iconColor}`} />
              {badge > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center px-1 shadow-sm animate-pulse">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </div>
            <span className="text-[10px] font-semibold text-slate-600 leading-tight text-center whitespace-pre-line">
              {label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
