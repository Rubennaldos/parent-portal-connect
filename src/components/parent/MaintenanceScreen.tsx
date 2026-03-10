import { Wrench, Clock, Bell } from 'lucide-react';
import { useEffect, useState } from 'react';

interface MaintenanceScreenProps {
  title: string;
  message: string;
}

export function MaintenanceScreen({ title, message }: MaintenanceScreenProps) {
  const [progress, setProgress] = useState(0);

  // Barra de progreso animada infinita
  useEffect(() => {
    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 85) return 30;
        return prev + 0.5;
      });
    }, 100);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 py-12">
      {/* Ícono animado con puntos */}
      <div className="relative mb-8">
        <div className="w-24 h-24 bg-gradient-to-br from-amber-100 to-yellow-100 rounded-full flex items-center justify-center shadow-lg">
          <Wrench className="h-12 w-12 text-amber-600 animate-pulse" />
        </div>
        {/* Puntos decorativos */}
        <div className="absolute -top-1 -right-1 w-4 h-4 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '0s' }} />
        <div className="absolute -bottom-1 -left-1 w-3 h-3 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }} />
      </div>

      {/* Título */}
      <h2 className="text-xl sm:text-2xl font-bold text-gray-900 text-center mb-3 flex items-center gap-2">
        🔧 {title}
      </h2>

      {/* Mensaje */}
      <p className="text-gray-500 text-center text-sm sm:text-base max-w-md leading-relaxed mb-8">
        {message}
      </p>

      {/* Cards informativas */}
      <div className="flex gap-4 mb-8">
        <div className="border-2 border-blue-200 bg-blue-50 rounded-xl p-4 text-center min-w-[130px]">
          <Clock className="h-5 w-5 text-blue-600 mx-auto mb-2" />
          <p className="font-semibold text-sm text-blue-800">Disponible pronto</p>
          <p className="text-xs text-blue-500">Trabajando en ello</p>
        </div>
        <div className="border-2 border-green-200 bg-green-50 rounded-xl p-4 text-center min-w-[130px]">
          <Bell className="h-5 w-5 text-green-600 mx-auto mb-2" />
          <p className="font-semibold text-sm text-green-800">Sin cambios</p>
          <p className="text-xs text-green-500">Tus datos están seguros</p>
        </div>
      </div>

      {/* Barra de progreso animada */}
      <div className="w-64 bg-gray-200 rounded-full h-2 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full transition-all duration-300 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="text-xs text-gray-400 mt-2">Preparando la mejor experiencia para ti...</p>
    </div>
  );
}
