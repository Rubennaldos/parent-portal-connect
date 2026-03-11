import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

export type UserRole = 
  | 'parent' 
  | 'teacher'
  | 'superadmin' 
  | 'admin_general' 
  | 'supervisor_red' 
  | 'gestor_unidad' 
  | 'operador_caja' 
  | 'operador_cocina'
  | 'contadora'
  | null;

interface UseRoleReturn {
  role: UserRole;
  loading: boolean;
  error: Error | null;
  isParent: boolean;
  isStaff: boolean;
  canViewAllSchools: boolean;
  hasRole: (allowedRoles: UserRole[]) => boolean;
  getDefaultRoute: () => string;
}

export function useRole(): UseRoleReturn {
  const { user } = useAuth();
  const [role, setRole] = useState<UserRole>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchRole() {
      if (!user) {
        setRole(null);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);

        // 🔒 SUPERADMIN - Configurable via variable de entorno (fallback al email original)
        const superadminEmail = import.meta.env.VITE_SUPERADMIN_EMAIL || 'superadmin@limacafe28.com';
        if (user.email === superadminEmail) {
          console.log('🔐 SuperAdmin detectado:', user.email);
          setRole('superadmin');
          setLoading(false);
          return;
        }

        console.log('🔍 useRole: Buscando rol para usuario:', user.id);
        
        const { data, error } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single();

        if (error) {
          console.error('❌ useRole: Error al buscar rol:', error);
          throw error;
        }
        
        console.log('✅ useRole: Rol encontrado:', data?.role);
        setRole(data?.role || 'parent');
      } catch (err) {
        console.error('Error al obtener rol:', err);
        setError(err instanceof Error ? err : new Error('Error desconocido'));
        setRole('parent');
      } finally {
        setLoading(false);
      }
    }

    fetchRole();
  }, [user]);

  const isParent = useMemo(() => role === 'parent', [role]);
  const isStaff = useMemo(
    () => [
      'superadmin', 
      'admin_general', 
      'supervisor_red', 
      'gestor_unidad', 
      'operador_caja', 
      'operador_cocina'
    ].includes(role || ''),
    [role]
  );

  // ✅ Roles que pueden ver TODAS las sedes
  const canViewAllSchools = useMemo(
    () => ['superadmin', 'admin_general', 'supervisor_red'].includes(role || ''),
    [role]
  );

  const hasRole = useCallback(
    (allowedRoles: UserRole[]): boolean => {
      if (!role) return false;
      return allowedRoles.includes(role);
    },
    [role]
  );

  const getDefaultRoute = useCallback((): string => {
    switch (role) {
      case 'parent':
        return '/';
      case 'teacher':
        return '/teacher'; // Portal del profesor
      case 'superadmin':
        return '/superadmin'; // Panel técnico del programador
      case 'admin_general':
        return '/dashboard'; // Dashboard de módulos de negocio
      case 'supervisor_red':
        return '/cobranzas'; // Solo módulo de cobranzas
      case 'gestor_unidad':
        return '/dashboard'; // Administrador de sede
      case 'operador_caja':
        return '/pos'; // Cajero directo al POS
      case 'operador_cocina':
        return '/comedor'; // Cocina directo a su pantalla
      default:
        return '/';
    }
  }, [role]);

  return {
    role,
    loading,
    error,
    isParent,
    isStaff,
    canViewAllSchools,
    hasRole,
    getDefaultRoute,
  };
}

