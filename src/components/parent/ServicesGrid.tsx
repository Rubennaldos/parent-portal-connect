/**
 * ServicesGrid — Cuadrícula de servicios secundarios, estilo Yape.
 *
 * Muestra únicamente Historial y Soporte.
 * Recargas y Topes fueron eliminados de la UI por decisión de negocio.
 */
import { Clock, Headphones, Sparkles } from 'lucide-react';

interface ServicesGridProps {
  onViewHistory: () => void;
  supportPhone?: string;
}

export function ServicesGrid({ onViewHistory, supportPhone = '51991236870' }: ServicesGridProps) {
  const services = [
    {
      id: 'historial',
      label: 'Historial',
      Icon: Clock,
      bg: 'bg-gradient-to-br from-emerald-100 to-teal-100',
      iconColor: 'text-emerald-500',
      ring: 'ring-emerald-200/50',
      action: onViewHistory,
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
    },
  ];

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-[1.75rem] shadow-lg shadow-slate-200/40 border border-white p-5">
      <div className="flex items-center gap-2 mb-4 px-1">
        <Sparkles className="w-4 h-4 text-amber-400" />
        <span className="text-sm font-semibold text-slate-500">Servicios rápidos</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {services.map(({ id, label, Icon, bg, iconColor, ring, action }) => (
          <button
            key={id}
            onClick={action}
            className="flex flex-col items-center gap-2.5 p-3 rounded-2xl hover:bg-slate-50/80 cursor-pointer active:scale-95 transition-all duration-200"
          >
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${bg} ring-2 ${ring} shadow-sm`}>
              <Icon className={`w-6 h-6 ${iconColor}`} />
            </div>
            <span className="text-xs font-semibold text-slate-600 leading-tight text-center">
              {label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
