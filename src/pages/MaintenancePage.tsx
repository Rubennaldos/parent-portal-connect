/**
 * Pantalla de mantenimiento — Portal de Padres
 * Estilo: minimalista, colores cálidos, mensaje empático tipo Yape/Plin.
 * No tiene lógica de negocio: solo muestra el mensaje y un botón de reintentar.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { useSystemStatus } from '@/hooks/useSystemStatus';
import { Loader2 } from 'lucide-react';

export default function MaintenancePage() {
  const navigate      = useNavigate();
  const { user }      = useAuth();
  const { role }      = useRole();
  const { status, loading } = useSystemStatus();
  const [dots, setDots] = useState('');

  // Animación de puntos suspensivos
  useEffect(() => {
    const t = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 600);
    return () => clearInterval(t);
  }, []);

  // Si el portal ya está activo de nuevo, redirigir automáticamente
  useEffect(() => {
    if (!loading && status.is_parent_portal_enabled) {
      navigate('/', { replace: true });
    }
  }, [loading, status.is_parent_portal_enabled, navigate]);

  // Superadmin nunca debe quedar aquí
  useEffect(() => {
    if (role === 'superadmin') navigate('/superadmin', { replace: true });
  }, [role, navigate]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-orange-50 via-white to-amber-50 px-4">

      {/* Logo / ícono central animado */}
      <div className="mb-8 relative">
        <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-orange-400 to-amber-500 flex items-center justify-center shadow-2xl shadow-orange-200">
          <svg viewBox="0 0 48 48" className="w-12 h-12 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M24 4C13 4 4 13 4 24s9 20 20 20 20-9 20-20S35 4 24 4z" />
            <path d="M24 14v10l6 4" />
          </svg>
        </div>
        {/* Pulso animado */}
        <div className="absolute inset-0 rounded-3xl bg-orange-400 opacity-20 animate-ping" />
      </div>

      {/* Texto principal */}
      <div className="text-center max-w-sm space-y-3 mb-10">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
          Volvemos pronto{dots}
        </h1>
        <p className="text-gray-500 text-sm leading-relaxed">
          {status.parent_maintenance_msg}
        </p>
      </div>

      {/* Barra de progreso falsa — da sensación de actividad */}
      <div className="w-64 h-1.5 bg-orange-100 rounded-full overflow-hidden mb-8">
        <div className="h-full bg-gradient-to-r from-orange-400 to-amber-400 rounded-full animate-[progress_2.5s_ease-in-out_infinite]" style={{ width: '60%' }} />
      </div>

      {/* Info del usuario */}
      {user && (
        <p className="text-xs text-gray-400 mb-6">
          Conectado como <span className="font-medium text-gray-500">{user.email}</span>
        </p>
      )}

      {/* Botón reintentar */}
      <button
        onClick={() => window.location.reload()}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white border border-orange-200 text-orange-600 text-sm font-semibold shadow-sm hover:shadow-md hover:bg-orange-50 transition-all active:scale-95"
      >
        <Loader2 className="h-4 w-4" />
        Verificar disponibilidad
      </button>

      {/* Footer */}
      <p className="mt-12 text-[11px] text-gray-300">Lima Café 28 · Kiosco Escolar</p>

      <style>{`
        @keyframes progress {
          0%   { width: 15%; }
          50%  { width: 80%; }
          100% { width: 15%; }
        }
      `}</style>
    </div>
  );
}
