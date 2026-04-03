/**
 * SystemGuard — Bloqueo INSTANTÁNEO cuando el SuperAdmin apaga un portal.
 *
 * Usa useSystemStatus (Realtime) para recibir el cambio en < 1 segundo.
 * En cuanto llega el nuevo estado, redirige sin que el usuario tenga que
 * refrescar la página.
 *
 * REGLAS:
 * - superadmin → NUNCA bloqueado
 * - email en bypass_emails → NUNCA bloqueado (usuarios de prueba)
 * - parent      → /mantenimiento       si is_parent_portal_enabled = false
 * - admin_*     → /mantenimiento-admin si is_admin_panel_enabled   = false
 * - Cargando o sin rol → esperar, nunca redirigir
 * - Si el guard falla → dejar pasar (sistema abierto por defecto)
 */
import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useRole } from '@/hooks/useRole';
import { useSystemStatus } from '@/hooks/useSystemStatus';
import { useAuth } from '@/contexts/AuthContext';

const PARENT_ROLES = new Set(['parent']);
const ADMIN_ROLES  = new Set([
  'admin_general', 'gestor_unidad', 'operador_caja',
  'operador_cocina', 'contadora', 'cajero', 'teacher',
]);
const EXEMPT_ROLES = new Set(['superadmin']);

// Rutas que nunca deben ser redirigidas (auth, mantenimiento, etc.)
const ALWAYS_OPEN = new Set([
  '/auth', '/mantenimiento', '/mantenimiento-admin',
  '/register', '/onboarding',
]);

export function SystemGuard({ children }: { children: React.ReactNode }) {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { user }                           = useAuth();
  const { role, loading: roleLoading }     = useRole();
  const { status, loading: statusLoading } = useSystemStatus();

  useEffect(() => {
    try {
      if (roleLoading || statusLoading) return;
      if (ALWAYS_OPEN.has(location.pathname)) return;
      if (!role || EXEMPT_ROLES.has(role)) return;

      // Email síncrono desde AuthContext (ya disponible, sin async)
      const userEmail = user?.email?.toLowerCase().trim() ?? '';

      // Bypass: si el email está en la lista, nunca redirigir
      const parentBypassed = (status.parent_bypass_emails ?? [])
        .map((e: string) => e.toLowerCase().trim())
        .includes(userEmail);
      const adminBypassed = (status.admin_bypass_emails ?? [])
        .map((e: string) => e.toLowerCase().trim())
        .includes(userEmail);

      if (PARENT_ROLES.has(role) && !status.is_parent_portal_enabled && !parentBypassed) {
        navigate('/mantenimiento', { replace: true });
        return;
      }

      if (ADMIN_ROLES.has(role) && !status.is_admin_panel_enabled && !adminBypassed) {
        navigate('/mantenimiento-admin', { replace: true });
        return;
      }
    } catch {
      // Silencio: ante cualquier error dejar pasar al usuario
    }
  }, [role, roleLoading, user, status, statusLoading, location.pathname, navigate]);

  return <>{children}</>;
}
