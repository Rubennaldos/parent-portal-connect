import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export type Permission = string; // e.g., 'ventas.eliminar', 'productos.modificar'

interface UserPermission {
  permission_name: string;
  granted: boolean;
}

export function usePermissions() {
  const { user } = useAuth();
  const [userPermissions, setUserPermissions] = useState<Set<Permission>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPermissions() {
      if (!user) {
        setUserPermissions(new Set());
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        // 🔒 SUPERADMIN HARDCODED - Todos los permisos sin consultar DB
        if (user.email === 'superadmin@limacafe28.com') {
          console.log('🔐 SuperAdmin detectado (hardcoded) en permisos:', user.email);
          // Otorgar todos los permisos posibles sin consultar la base de datos
          const allPermissions = new Set<Permission>([
            'ventas.ver', 'ventas.crear', 'ventas.modificar', 'ventas.anular', 'ventas.exportar',
            'productos.ver', 'productos.crear', 'productos.modificar', 'productos.eliminar',
            'reportes.ver', 'reportes.generar', 'reportes.exportar',
            'usuarios.ver', 'usuarios.crear', 'usuarios.modificar', 'usuarios.eliminar', 'usuarios.cambiar_sede',
            'configuracion.ver', 'configuracion.modificar',
            'permisos.ver', 'permisos.modificar',
            'cobranzas.ver', 'cobranzas.gestionar',
            'inventario.ver', 'inventario.modificar',
          ]);
          setUserPermissions(allPermissions);
          setLoading(false);
          return;
        }

        // Obtener el rol del usuario
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single();

        if (profileError) throw profileError;

        const userRole = profile.role;

        // SuperAdmin y Admin General tienen TODOS los permisos
        if (userRole === 'superadmin' || userRole === 'admin_general') {
          const { data: allPerms, error: allPermsError } = await supabase
            .from('permissions')
            .select('name');

          if (allPermsError) throw allPermsError;

          const allPermissions = new Set(
            allPerms.map(p => p.name) as Permission[]
          );

          setUserPermissions(allPermissions);
          setLoading(false);
          return;
        }

        // Fetch permisos base del rol
        const { data: rolePerms, error: rolePermsError } = await supabase
          .from('role_permissions')
          .select('permission_id, granted, permissions(name)')
          .eq('role', userRole);

        if (rolePermsError) throw rolePermsError;

        const basePermissions = new Set<Permission>();
        
        rolePerms.forEach(rp => {
          if (rp.granted && rp.permissions?.name) {
            basePermissions.add(rp.permissions.name);
          }
        });

        // Fetch permisos personalizados del usuario (overrides)
        const { data: userPerms, error: userPermsError } = await supabase
          .from('user_permissions')
          .select('permission_id, granted, permissions(name)')
          .eq('user_id', user.id);

        if (userPermsError) throw userPermsError;

        // Aplicar overrides
        userPerms.forEach(up => {
          if (up.permissions?.name) {
            if (up.granted) {
              basePermissions.add(up.permissions.name);
            } else {
              basePermissions.delete(up.permissions.name);
            }
          }
        });

        setUserPermissions(basePermissions);
      } catch (error) {
        console.error('Error fetching permissions:', error);
        setUserPermissions(new Set());
      } finally {
        setLoading(false);
      }
    }

    fetchPermissions();
  }, [user]);

  const can = (permission: Permission) => userPermissions.has(permission);
  const cannot = (permission: Permission) => !userPermissions.has(permission);
  const canAny = (permissions: Permission[]) => permissions.some(p => userPermissions.has(p));
  const canAll = (permissions: Permission[]) => permissions.every(p => userPermissions.has(p));

  return { 
    can, 
    cannot, 
    canAny, 
    canAll, 
    loading,
    permissions: Array.from(userPermissions)
  };
}

