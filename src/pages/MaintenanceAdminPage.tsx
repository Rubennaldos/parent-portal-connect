/**
 * Pantalla de mantenimiento — Panel de Administradores
 * Estilo: oscuro / técnico. Transmite seriedad al personal operativo.
 * No tiene lógica de negocio: solo muestra el mensaje del SuperAdmin.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRole } from '@/hooks/useRole';
import { useSystemStatus } from '@/hooks/useSystemStatus';
import { ShieldCheck, RefreshCw } from 'lucide-react';

export default function MaintenanceAdminPage() {
  const navigate = useNavigate();
  const { role } = useRole();
  const { status, loading } = useSystemStatus();
  const [dots, setDots] = useState('');

  useEffect(() => {
    const t = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 700);
    return () => clearInterval(t);
  }, []);

  // Si el panel ya fue reactivado → redirigir al dashboard
  useEffect(() => {
    if (!loading && status.is_admin_panel_enabled) {
      navigate('/dashboard', { replace: true });
    }
  }, [loading, status.is_admin_panel_enabled, navigate]);

  // Superadmin NUNCA debe quedar bloqueado aquí
  useEffect(() => {
    if (role === 'superadmin') navigate('/superadmin', { replace: true });
  }, [role, navigate]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-950 px-4">

      {/* Ícono */}
      <div className="mb-8 relative">
        <div className="w-20 h-20 rounded-2xl bg-gray-800 border border-gray-700 flex items-center justify-center shadow-xl">
          <ShieldCheck className="w-9 h-9 text-gray-400" />
        </div>
        <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 border-2 border-gray-950 animate-pulse" />
      </div>

      {/* Texto */}
      <div className="text-center max-w-sm space-y-3 mb-8">
        <p className="text-xs font-mono text-gray-500 uppercase tracking-widest">
          system · maintenance
        </p>
        <h1 className="text-xl font-bold text-white">
          Panel en mantenimiento{dots}
        </h1>
        <p className="text-gray-400 text-sm leading-relaxed">
          {status.admin_maintenance_msg}
        </p>
      </div>

      {/* Indicador técnico */}
      <div className="w-56 bg-gray-800 rounded-lg border border-gray-700 p-3 mb-8 font-mono text-xs text-gray-500 space-y-1">
        <p><span className="text-green-500">▶</span> Conectando al servidor{dots}</p>
        <p><span className="text-amber-400">⚠</span> Panel deshabilitado por admin</p>
        <p><span className="text-gray-600">—</span> Esperando autorización{dots}</p>
      </div>

      {/* Botón reintentar */}
      <button
        onClick={() => window.location.reload()}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-300 text-sm font-medium hover:bg-gray-700 hover:text-white transition-all active:scale-95"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Reintentar
      </button>

      <p className="mt-10 text-[11px] text-gray-700 font-mono">
        Lima Café 28 · v1.x · restricted
      </p>
    </div>
  );
}
