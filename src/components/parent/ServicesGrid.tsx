/**
 * ServicesGrid — Cuadrícula de servicios secundarios, estilo v0/Yape
 *
 * Tarjeta blanca con íconos circulares de gradiente.
 * Recargas y Topes → disabled (mantenimiento) con toast informativo.
 * Historial y Soporte → activos.
 */
import { Wallet, SlidersHorizontal, Clock, Headphones, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ServicesGridProps {
  onViewHistory: () => void;
  supportPhone?: string;
}

const MAINTENANCE_MSG = 'Módulo en mantenimiento por mejora de experiencia. Estará disponible pronto.';

export function ServicesGrid({ onViewHistory, supportPhone = '51991236870' }: ServicesGridProps) {
  const { toast } = useToast();

  const showMaintenance = () => {
    toast({ title: '🔧 En mantenimiento', description: MAINTENANCE_MSG, duration: 4000 });
  };

  const services = [
    {
      id: 'recargas',
      label: 'Recargas',
      Icon: Wallet,
      bg: 'bg-gradient-to-br from-amber-100 to-orange-100',
      iconColor: 'text-amber-500',
      ring: 'ring-amber-200/50',
      disabled: true,
      action: showMaintenance,
    },
    {
      id: 'topes',
      label: 'Topes',
      Icon: SlidersHorizontal,
      bg: 'bg-gradient-to-br from-blue-100 to-cyan-100',
      iconColor: 'text-blue-500',
      ring: 'ring-blue-200/50',
      disabled: true,
      action: showMaintenance,
    },
    {
      id: 'historial',
      label: 'Historial',
      Icon: Clock,
      bg: 'bg-gradient-to-br from-emerald-100 to-teal-100',
      iconColor: 'text-emerald-500',
      ring: 'ring-emerald-200/50',
      disabled: false,
      action: onViewHistory,
    },
    {
      id: 'soporte',
      label: 'Soporte',
      Icon: Headphones,
      bg: 'bg-gradient-to-br from-violet-100 to-purple-100',
      iconColor: 'text-violet-500',
      ring: 'ring-violet-200/50',
      disabled: false,
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
      {/* Header de sección */}
      <div className="flex items-center gap-2 mb-4 px-1">
        <Sparkles className="w-4 h-4 text-amber-400" />
        <span className="text-sm font-semibold text-slate-500">Servicios rápidos</span>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {services.map(({ id, label, Icon, bg, iconColor, ring, disabled, action }) => (
          <button
            key={id}
            onClick={action}
            className={`flex flex-col items-center gap-2.5 p-3 rounded-2xl active:scale-95 transition-all duration-200 ${
              disabled
                ? 'opacity-50 grayscale cursor-not-allowed'
                : 'hover:bg-slate-50/80 cursor-pointer'
            }`}
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
