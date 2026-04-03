/**
 * ServicesGrid — Cuadrícula de servicios secundarios, estilo Yape.
 *
 * Íconos circulares con texto debajo, organizados en fila de 4.
 * Los servicios en mantenimiento se ven en escala de grises + candado.
 * Al tocarlos, muestran un toast informativo (sin lógica de negocio).
 *
 * Los servicios activos (Soporte, Historial) sí ejecutan su acción.
 */
import { Wallet, SlidersHorizontal, MessageCircle, Clock, Lock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Service {
  id: string;
  label: string;
  icon: React.ReactNode;
  disabled: boolean;
  action: () => void;
  color: string; // Color del fondo del ícono cuando está activo
}

interface ServicesGridProps {
  /** Callback para abrir el historial de compras del hijo activo */
  onViewHistory: () => void;
  /** Número de WhatsApp de soporte (sin espacios) */
  supportPhone?: string;
}

const MAINTENANCE_TOAST_MSG =
  'Módulo en mantenimiento por mejora de experiencia. Estará disponible pronto.';

export function ServicesGrid({ onViewHistory, supportPhone = '51991236870' }: ServicesGridProps) {
  const { toast } = useToast();

  const showMaintenanceToast = () => {
    toast({
      title: '🔧 En mantenimiento',
      description: MAINTENANCE_TOAST_MSG,
      duration: 4000,
    });
  };

  const services: Service[] = [
    {
      id: 'recargas',
      label: 'Recargas',
      icon: <Wallet className="h-5 w-5" />,
      disabled: true,
      action: showMaintenanceToast,
      color: 'bg-emerald-100 text-emerald-700',
    },
    {
      id: 'topes',
      label: 'Topes',
      icon: <SlidersHorizontal className="h-5 w-5" />,
      disabled: true,
      action: showMaintenanceToast,
      color: 'bg-violet-100 text-violet-700',
    },
    {
      id: 'historial',
      label: 'Historial',
      icon: <Clock className="h-5 w-5" />,
      disabled: false,
      action: onViewHistory,
      color: 'bg-amber-100 text-amber-700',
    },
    {
      id: 'soporte',
      label: 'Soporte',
      icon: <MessageCircle className="h-5 w-5" />,
      disabled: false,
      action: () => {
        window.open(
          `https://wa.me/${supportPhone}?text=Hola%2C%20necesito%20soporte%20con%20el%20portal%20de%20padres%20Lima%20Café%2028.`,
          '_blank',
        );
      },
      color: 'bg-green-100 text-green-700',
    },
  ];

  return (
    <div className="px-1">
      {/* Separador con etiqueta */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1 h-px bg-stone-100" />
        <span className="text-[10px] font-medium text-stone-400 uppercase tracking-widest">Servicios</span>
        <div className="flex-1 h-px bg-stone-100" />
      </div>

      <div className="grid grid-cols-4 gap-2">
        {services.map((svc) => (
          <button
            key={svc.id}
            onClick={svc.action}
            className={`flex flex-col items-center gap-1.5 py-3 px-1 rounded-2xl transition-all duration-200 active:scale-95 ${
              svc.disabled
                ? 'opacity-40 grayscale cursor-not-allowed'
                : 'hover:bg-stone-50 cursor-pointer'
            }`}
          >
            {/* Círculo ícono */}
            <div className={`relative w-12 h-12 rounded-full flex items-center justify-center shadow-sm ${
              svc.disabled ? 'bg-stone-200 text-stone-500' : svc.color
            }`}>
              {svc.icon}
              {/* Candado sobre el ícono cuando está deshabilitado */}
              {svc.disabled && (
                <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-stone-500 rounded-full flex items-center justify-center">
                  <Lock className="h-2.5 w-2.5 text-white" />
                </span>
              )}
            </div>

            {/* Label */}
            <span className={`text-[10px] sm:text-xs font-medium leading-tight text-center ${
              svc.disabled ? 'text-stone-400' : 'text-stone-600'
            }`}>
              {svc.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
