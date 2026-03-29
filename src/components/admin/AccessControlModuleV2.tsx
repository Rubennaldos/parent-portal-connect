import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { Lock, Users, Shield, ShieldCheck, AlertTriangle, CheckCircle2, XCircle, Loader2, Building2, UserPlus, Eye, EyeOff, Edit2, Key, Settings2, Search, BookOpen } from "lucide-react";
import { CreateProfileModal } from './CreateProfileModal';
import { ResetUserPasswordModal } from './ResetUserPasswordModal';
import { ManageCustomSchoolsModal } from './ManageCustomSchoolsModal';
import { ReclamacionesPanel } from './ReclamacionesPanel';
import { Input } from "@/components/ui/input";

interface School {
  id: string;
  name: string;
  code: string;
}

interface Permission {
  id: string;
  module: string;
  action: string;
  name: string;
  description: string;
}

interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: string;
  school_id: string | null;
  school: { name: string; code: string } | null;
  custom_schools: string[] | null;
  is_active: boolean;
}

interface ModulePermissions {
  [module: string]: {
    enabled: boolean;
    permissions: { [action: string]: boolean };
  };
}

const ROLES = [
  { value: 'supervisor_red', label: 'Supervisor de Red', icon: '🌐', description: 'Auditor multi-sede' },
  { value: 'gestor_unidad', label: 'Gestor de Unidad', icon: '🏢', description: 'Administrador de sede' },
  { value: 'almacenero', label: 'Almacenero', icon: '📦', description: 'Gestión de inventarios' },
  { value: 'operador_caja', label: 'Operador de Caja', icon: '💰', description: 'Cajero' },
  { value: 'operador_cocina', label: 'Operador de Cocina', icon: '👨‍🍳', description: 'Personal de cocina' },
];

// Definición de módulos con sus permisos específicos
const MODULE_CONFIG = {
  pos: {
    name: 'Punto de Venta',
    icon: '🛒',
    color: 'green',
    description: 'Sistema de cobro y ventas',
    permissions: [
      { action: 'ver_modulo', label: 'Acceder al POS', description: 'Permite usar el punto de venta' }
    ]
  },
  ventas: {
    name: 'Lista de Ventas',
    icon: '📊',
    color: 'blue',
    description: 'Historial y reportes de ventas',
    permissions: [
      { action: 'ver_modulo', label: 'Ver módulo', description: 'Acceder a la lista de ventas' },
      { action: 'ver_dashboard', label: 'Ver dashboard', description: 'Ver estadísticas y analytics' },
      { action: 'ver_su_sede', label: 'Solo su sede', description: 'Ver únicamente ventas de su sede asignada', group: 'scope' },
      { action: 'ver_todas_sedes', label: 'Todas las sedes', description: 'Ver ventas de todas las sedes del sistema', group: 'scope' },
      { action: 'ver_personalizado', label: 'Personalizado', description: 'Elegir manualmente qué sedes puede ver', group: 'scope' },
      { action: 'editar', label: 'Editar venta', description: 'Modificar datos de ventas' },
      { action: 'anular', label: 'Anular venta', description: 'Anular una venta' },
      { action: 'eliminar', label: 'Eliminar venta', description: 'Eliminar venta del sistema' },
      { action: 'filtros', label: 'Usar filtros', description: 'Filtros avanzados' },
      { action: 'imprimir_ticket', label: 'Imprimir ticket', description: 'Reimprimir tickets' },
      { action: 'sacar_reportes', label: 'Sacar reportes', description: 'Generar reportes' }
    ]
  },
  cobranzas: {
    name: 'Cobranzas',
    icon: '💰',
    color: 'red',
    description: 'Gestión de cuentas por cobrar',
    permissions: [
      { action: 'ver_modulo', label: 'Ver módulo', description: 'Acceder a cobranzas' },
      { action: 'ver_dashboard', label: 'Ver dashboard', description: 'Ver estadísticas generales' },
      { action: 'cobrar_su_sede', label: 'Solo su sede', description: 'Registrar pagos únicamente de su sede asignada', group: 'scope' },
      { action: 'cobrar_todas_sedes', label: 'Todas las sedes', description: 'Registrar pagos de todas las sedes del sistema', group: 'scope' },
      { action: 'cobrar_personalizado', label: 'Personalizado', description: 'Elegir manualmente qué sedes puede cobrar', group: 'scope' },
      { action: 'sacar_reportes', label: 'Sacar reportes', description: 'Generar reportes de cobranzas' },
      { action: 'ver_estadisticas', label: 'Ver estadísticas', description: 'Ver estadísticas de pagos' },
      { action: 'configuracion', label: 'Configuración', description: 'Acceder a configuración de cobranzas' }
    ]
  },
  productos: {
    name: 'Productos',
    icon: '📦',
    color: 'purple',
    description: 'Gestión de productos y menús',
    permissions: [
      { action: 'ver_modulo', label: 'Ver módulo', description: 'Acceder a productos' },
      { action: 'ver_dashboard', label: 'Ver dashboard', description: 'Ver estadísticas' },
      { action: 'sacar_reportes', label: 'Sacar reportes', description: 'Generar reportes' },
      { action: 'crear', label: 'Crear productos', description: 'Crear nuevos productos' },
      { action: 'ver_su_sede', label: 'Solo su sede', description: 'Ver productos únicamente de su sede asignada', group: 'scope' },
      { action: 'ver_todas_sedes', label: 'Todas las sedes', description: 'Ver productos de todas las sedes del sistema', group: 'scope' },
      { action: 'ver_personalizado', label: 'Personalizado', description: 'Elegir manualmente qué sedes puede ver', group: 'scope' },
      { action: 'promociones_su_sede', label: 'Solo su sede', description: 'Activar promociones únicamente para su sede', group: 'promotions' },
      { action: 'promociones_todas_sedes', label: 'Todas las sedes', description: 'Activar promociones para todas las sedes', group: 'promotions' },
      { action: 'promociones_personalizado', label: 'Personalizado', description: 'Elegir sedes específicas para promociones', group: 'promotions' },
      { action: 'menus_su_sede', label: 'Solo su sede', description: 'Agregar menús únicamente para su sede', group: 'menus' },
      { action: 'menus_todas_sedes', label: 'Todas las sedes', description: 'Agregar menús para todas las sedes', group: 'menus' },
      { action: 'menus_personalizado', label: 'Personalizado', description: 'Elegir sedes específicas para menús', group: 'menus' }
    ]
  },
  config_padres: {
    name: 'Config. Padres y Profesores',
    icon: '👥',
    color: 'indigo',
    description: 'Gestión de padres, profesores y estudiantes',
    permissions: [
      { action: 'ver_modulo', label: 'Ver módulo', description: 'Acceder al módulo' },
      { action: 'ver_dashboard', label: 'Ver dashboard', description: 'Ver estadísticas' },
      
      // PERMISOS DE PADRES
      { action: 'crear_padre', label: 'Crear padre', description: 'Registrar nuevos padres', group: 'padres' },
      { action: 'editar_padre', label: 'Editar padre', description: 'Modificar datos de padres', group: 'padres' },
      { action: 'eliminar_padre', label: 'Eliminar padre', description: 'Eliminar padres', group: 'padres' },
      
      // PERMISOS DE ESTUDIANTES
      { action: 'crear_estudiante', label: 'Crear estudiante', description: 'Registrar nuevos estudiantes', group: 'estudiantes' },
      { action: 'editar_estudiante', label: 'Editar estudiante', description: 'Modificar datos de estudiantes', group: 'estudiantes' },
      { action: 'eliminar_estudiante', label: 'Eliminar estudiante', description: 'Eliminar estudiantes', group: 'estudiantes' },
      
      // PERMISOS DE PROFESORES (NUEVOS)
      { action: 'view_teachers', label: 'Ver profesores', description: 'Permite ver la lista de profesores', group: 'profesores' },
      { action: 'view_teacher_details', label: 'Ver detalles de profesor', description: 'Ver información detallada de profesores', group: 'profesores' },
      { action: 'create_teacher', label: 'Crear profesor', description: 'Registrar nuevos profesores', group: 'profesores' },
      { action: 'edit_teacher', label: 'Editar profesor', description: 'Modificar datos de profesores', group: 'profesores' },
      { action: 'delete_teacher', label: 'Eliminar profesor', description: 'Eliminar profesores del sistema', group: 'profesores' },
      { action: 'export_teachers', label: 'Exportar profesores', description: 'Exportar datos de profesores a Excel/PDF', group: 'profesores' }
    ]
  },
  almuerzos: {
    name: 'Almuerzos (Calendario)',
    icon: '🍱',
    color: 'emerald',
    description: 'Gestión de menús diarios y calendario escolar',
    permissions: [
      { action: 'ver_modulo', label: 'Ver módulo', description: 'Acceder al calendario' },
      { action: 'ver_dashboard', label: 'Ver Analytics', description: 'Acceder a reportes y estadísticas' },
      { action: 'crear_menu', label: 'Crear menú', description: 'Agregar platos diarios' },
      { action: 'editar_menu', label: 'Editar menú', description: 'Modificar platos existentes' },
      { action: 'eliminar_menu', label: 'Eliminar menú', description: 'Borrar platos registrados' },
      { action: 'carga_masiva', label: 'Carga masiva', description: 'Subir menús mediante Excel' },
      { action: 'gestionar_dias_especiales', label: 'Marcar Feriados/No Laborables', description: 'Cambiar estado del día' },
      { action: 'ver_su_sede', label: 'Solo su sede', description: 'Ver y gestionar únicamente su sede', group: 'scope' },
      { action: 'ver_todas_sedes', label: 'Todas las sedes', description: 'Gestión total de todas las sedes', group: 'scope' },
      { action: 'exportar', label: 'Exportar reportes', description: 'Descargar menús en PDF/Excel' }
    ]
  },
  logistica: {
    name: 'Logística y Almacén',
    icon: '📦',
    color: 'blue',
    description: 'Inventarios, pedidos y órdenes de compra',
    permissions: [
      { action: 'ver_modulo', label: 'Ver módulo', description: 'Acceder al módulo completo' },
      { action: 'ver_inventario', label: 'Ver inventario', description: 'Ver stock de productos' },
      { action: 'editar_inventario', label: 'Editar inventario', description: 'Agregar/modificar productos y stock' },
      { action: 'ver_pedidos', label: 'Ver pedidos', description: 'Ver solicitudes de suministros' },
      { action: 'procesar_pedidos', label: 'Procesar pedidos', description: 'Aprobar y procesar solicitudes' },
      { action: 'crear_orden_compra', label: 'Crear órdenes de compra', description: 'Generar órdenes a proveedores' },
      { action: 'ver_ordenes_compra', label: 'Ver órdenes de compra', description: 'Consultar órdenes' },
      { action: 'gestionar_proveedores', label: 'Gestionar proveedores', description: 'Agregar/editar proveedores' },
      { action: 'ver_activos', label: 'Ver activos', description: 'Ver inventario de máquinas y equipos' },
      { action: 'editar_activos', label: 'Editar activos', description: 'Agregar/modificar activos' },
      { action: 'ver_analytics', label: 'Ver analytics de inventario', description: 'Reportes y gráficos' }
    ]
  },
  admin_sede: {
    name: 'Administración de Sede',
    icon: '🏢',
    color: 'purple',
    description: 'Pedidos, calendario y tarjetas ID',
    permissions: [
      { action: 'ver_modulo', label: 'Ver módulo', description: 'Acceder al módulo completo' },
      { action: 'crear_pedidos', label: 'Crear pedidos de suministros', description: 'Solicitar mercadería al almacén' },
      { action: 'ver_pedidos', label: 'Ver pedidos de suministros', description: 'Consultar estado de pedidos' },
      { action: 'gestionar_calendario', label: 'Gestionar calendarios', description: 'Eventos académicos e internos' },
      { action: 'gestionar_tarjetas', label: 'Gestionar tarjetas ID', description: 'Activar y vincular tarjetas' }
    ]
  },
  cash_register: {
    name: 'Cierre de Caja',
    icon: '💰',
    color: 'green',
    description: 'Gestión de caja, ingresos, egresos y cierre diario',
    permissions: [
      { action: 'access', label: 'Acceder al módulo', description: 'Permite ver y usar el módulo de cierre de caja' },
      { action: 'ver_modulo', label: 'Ver módulo', description: 'Acceder al módulo de cierre de caja' },
      { action: 'ver_dashboard', label: 'Ver dashboard', description: 'Ver resumen ejecutivo y estadísticas' },
      { action: 'abrir_caja', label: 'Abrir caja', description: 'Iniciar turno con monto inicial' },
      { action: 'cerrar_caja', label: 'Cerrar caja', description: 'Finalizar turno y generar cierre' },
      { action: 'registrar_ingreso', label: 'Registrar ingreso', description: 'Agregar ingresos de efectivo' },
      { action: 'registrar_egreso', label: 'Registrar egreso', description: 'Registrar salidas de efectivo' },
      { action: 'ver_historial', label: 'Ver historial', description: 'Consultar cierres anteriores' },
      { action: 'imprimir_reporte', label: 'Imprimir reportes', description: 'Imprimir tickets de cierre' },
      { action: 'exportar_datos', label: 'Exportar datos', description: 'Exportar a Excel/PDF' },
      { action: 'enviar_whatsapp', label: 'Enviar por WhatsApp', description: 'Compartir reportes por WhatsApp' },
      { action: 'configurar_modulo', label: 'Configuración', description: 'Ajustar hora de cierre automático y WhatsApp' },
      { action: 'ver_su_sede', label: 'Solo su sede', description: 'Ver únicamente caja de su sede asignada', group: 'scope' },
      { action: 'ver_todas_sedes', label: 'Todas las sedes', description: 'Ver cajas de todas las sedes del sistema', group: 'scope' }
    ]
  },
  comedor: {
    name: 'Vista Cocina',
    icon: '👨‍🍳',
    color: 'orange',
    description: 'Reporte diario de cocina y gestión de pedidos',
    permissions: [
      { action: 'ver_modulo', label: 'Ver módulo', description: 'Acceder a la vista de cocina' },
      { action: 'marcar_entregado', label: 'Marcar entregados', description: 'Marcar pedidos como entregados' },
      { action: 'ver_estadisticas', label: 'Ver estadísticas', description: 'Ver estadísticas de preferencias' },
      { action: 'imprimir_reporte', label: 'Imprimir reporte', description: 'Imprimir reporte de preparación' }
    ]
  }
};

export const AccessControlModuleV2 = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [activeTab, setActiveTab] = useState('roles');
  const [createProfileModalOpen, setCreateProfileModalOpen] = useState(false);
  const [resetPasswordModalOpen, setResetPasswordModalOpen] = useState(false);
  const [userToResetPassword, setUserToResetPassword] = useState<UserProfile | null>(null);
  const [manageSchoolsModalOpen, setManageSchoolsModalOpen] = useState(false);
  const [userToManageSchools, setUserToManageSchools] = useState<UserProfile | null>(null);

  // State for Role Permissions Tab
  const [selectedRole, setSelectedRole] = useState<string>('gestor_unidad');
  const [roleModulePermissions, setRoleModulePermissions] = useState<ModulePermissions>({});
  const [savingPermission, setSavingPermission] = useState<string | null>(null); // Para mostrar loading en el switch específico

  // State for User Permissions Tab
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [userSearchTerm, setUserSearchTerm] = useState('');

  useEffect(() => {
    fetchInitialData();
  }, []);

  useEffect(() => {
    if (permissions.length > 0 && selectedRole) {
      fetchRolePermissions(selectedRole);
    }
  }, [selectedRole, permissions]);

  // Funciones para gestión de usuarios
  const handleResetPassword = (user: UserProfile) => {
    console.log('🔐 Abriendo modal de reseteo para:', user.email);
    setUserToResetPassword(user);
    setResetPasswordModalOpen(true);
  };

  const handleEditUser = (user: UserProfile) => {
    console.log('✏️ Editando usuario:', user.email);
    toast({
      title: '🚧 Función en desarrollo',
      description: 'La edición de usuarios estará disponible próximamente.',
    });
    // TODO: Implementar modal de edición de usuario
  };

  const handleManageSchools = (user: UserProfile) => {
    console.log('🏫 Abriendo gestión de sedes para:', user.email);
    setUserToManageSchools(user);
    setManageSchoolsModalOpen(true);
  };

  const handleToggleActive = async (user: UserProfile) => {
    const newStatus = !(user.is_active !== false);
    const action = newStatus ? 'activar' : 'desactivar';
    
    if (!confirm(`¿Estás seguro de ${action} la cuenta de ${user.full_name || user.email}?`)) return;

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ is_active: newStatus })
        .eq('id', user.id);

      if (error) throw error;

      toast({
        title: newStatus ? '✅ Cuenta activada' : '🔒 Cuenta desactivada',
        description: `${user.full_name || user.email} ha sido ${newStatus ? 'activada' : 'desactivada'}.`,
      });

      await fetchUsers();
    } catch (error: any) {
      console.error('Error toggling user status:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo cambiar el estado de la cuenta.' });
    }
  };

  // Filtrar usuarios según búsqueda
  const filteredUsers = users.filter(user => {
    const searchLower = userSearchTerm.toLowerCase();
    return (
      user.full_name?.toLowerCase().includes(searchLower) ||
      user.email?.toLowerCase().includes(searchLower) ||
      user.school?.name?.toLowerCase().includes(searchLower) ||
      ROLES.find(r => r.value === user.role)?.label.toLowerCase().includes(searchLower)
    );
  });

  const fetchInitialData = async () => {
    try {
      setLoading(true);

      // Fetch permissions
      const { data: permsData, error: permsError } = await supabase
        .from('permissions')
        .select('*')
        .order('module')
        .order('action');
      
      if (permsError) throw permsError;

      // 🔧 Auto-crear permisos faltantes para módulos definidos en MODULE_CONFIG
      let allPerms = permsData || [];
      const existingModuleActions = new Set(allPerms.map(p => `${p.module}::${p.action}`));
      const missingPerms: { module: string; action: string; name: string }[] = [];

      Object.entries(MODULE_CONFIG).forEach(([moduleCode, config]) => {
        config.permissions.forEach(perm => {
          const key = `${moduleCode}::${perm.action}`;
          if (!existingModuleActions.has(key)) {
            missingPerms.push({
              module: moduleCode,
              action: perm.action,
              name: `${config.name} - ${perm.label}`
            });
          }
        });
      });

      if (missingPerms.length > 0) {
        console.log('🔧 Creando permisos faltantes:', missingPerms);
        const { data: insertedPerms, error: insertError } = await supabase
          .from('permissions')
          .insert(missingPerms)
          .select();
        
        if (!insertError && insertedPerms) {
          allPerms = [...allPerms, ...insertedPerms];
          console.log(`✅ ${insertedPerms.length} permisos creados automáticamente`);
        } else {
          console.error('❌ Error creando permisos:', insertError);
        }
      }

      setPermissions(allPerms);

      // Fetch schools
      const { data: schoolsData, error: schoolsError } = await supabase
        .from('schools')
        .select('*')
        .order('name');
      
      if (schoolsError) throw schoolsError;
      setSchools(schoolsData || []);

      // Fetch users
      await fetchUsers();

    } catch (error) {
      console.error('Error fetching initial data:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los datos.' });
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select(`
          id,
          email,
          full_name,
          role,
          school_id,
          is_active,
          school:schools(name, code)
        `)
        .in('role', ['supervisor_red', 'gestor_unidad', 'operador_caja', 'operador_cocina']);
      
      if (error) throw error;
      setUsers(data || []);
    } catch (error) {
      console.error('Error fetching users:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los usuarios.' });
    }
  };

  const fetchRolePermissions = async (role: string) => {
    try {
      console.log('🔍 Cargando permisos para rol:', role);
      
      const { data, error } = await supabase
        .from('role_permissions')
        .select(`
          permission_id,
          granted,
          permissions (
            id,
            module,
            action,
            name
          )
        `)
        .eq('role', role);
      
      if (error) throw error;

      console.log('✅ Permisos obtenidos:', data?.length || 0);

      // Organizar por módulos
      const modulePerms: ModulePermissions = {};
      
      Object.keys(MODULE_CONFIG).forEach(moduleCode => {
        const modulePermissions = permissions.filter(p => p.module === moduleCode);
        
        // Verificar si tiene el permiso ver_modulo activado
        const verModuloPerm = data?.find(
          (rp: any) => rp.permissions?.module === moduleCode && 
          rp.permissions?.action === 'ver_modulo'
        );
        
        const isModuleEnabled = verModuloPerm?.granted || false;
        
        modulePerms[moduleCode] = {
          enabled: isModuleEnabled,
          permissions: {}
        };

        // Llenar todos los permisos del módulo
        modulePermissions.forEach(perm => {
          const rolePerm = data?.find((rp: any) => rp.permissions?.id === perm.id);
          modulePerms[moduleCode].permissions[perm.action] = rolePerm?.granted || false;
        });

        console.log(`  📦 ${moduleCode}: enabled=${isModuleEnabled}, permisos=${Object.keys(modulePerms[moduleCode].permissions).length}`);
      });

      console.log('✅ Permisos organizados correctamente');
      setRoleModulePermissions(modulePerms);
    } catch (error) {
      console.error('❌ Error fetching role permissions:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los permisos del rol.' });
    }
  };

  // Acciones que se activan automáticamente cuando se habilita un módulo (scope por defecto)
  const DEFAULT_SCOPE_ON_ENABLE: { [moduleCode: string]: string } = {
    cobranzas: 'cobrar_su_sede',
    ventas: 'ver_su_sede',
    productos: 'ver_su_sede',
    almuerzos: 'ver_su_sede',
    cash_register: 'ver_su_sede',
  };

  const handleModuleToggle = async (moduleCode: string, enabled: boolean) => {
    if (!selectedRole) return;
    
    setSavingPermission(`module-${moduleCode}`);
    
    // Scope por defecto para este módulo (si aplica)
    const defaultScope = DEFAULT_SCOPE_ON_ENABLE[moduleCode];
    const currentPermsForModule = roleModulePermissions[moduleCode]?.permissions || {};
    const hasScopeAlreadySet = defaultScope
      ? Object.entries(currentPermsForModule).some(
          ([action, granted]) => action.includes('_su_sede') || action.includes('_todas_sedes') || action.includes('_personalizado') ? granted : false
        )
      : true;

    try {
      // Actualizar estado local primero
      setRoleModulePermissions(prev => {
        const currentPerms = prev[moduleCode]?.permissions || {};
        return {
          ...prev,
          [moduleCode]: {
            enabled,
            permissions: {
              ...currentPerms,
              ver_modulo: enabled,
              // Si se activa y no hay scope configurado, auto-asignar el scope por defecto
              ...(enabled && defaultScope && !hasScopeAlreadySet ? { [defaultScope]: true } : {})
            }
          }
        };
      });

      // Guardar en la base de datos
      const modulePermissions = permissions.filter(p => p.module === moduleCode);
      
      for (const perm of modulePermissions) {
        let finalGranted = false;
        
        if (enabled) {
          if (perm.action === 'ver_modulo') {
            finalGranted = true;
          } else if (defaultScope && perm.action === defaultScope && !hasScopeAlreadySet) {
            // Auto-activar scope por defecto si no había ninguno configurado
            finalGranted = true;
          } else {
            // Mantener el valor actual de otros permisos
            finalGranted = roleModulePermissions[moduleCode]?.permissions[perm.action] || false;
          }
        }

        // Verificar si ya existe
        const { data: existing } = await supabase
          .from('role_permissions')
          .select('id')
          .eq('role', selectedRole)
          .eq('permission_id', perm.id)
          .maybeSingle();

        if (existing) {
          await supabase
            .from('role_permissions')
            .update({ granted: finalGranted })
            .eq('role', selectedRole)
            .eq('permission_id', perm.id);
        } else {
          await supabase
            .from('role_permissions')
            .insert({
              role: selectedRole,
              permission_id: perm.id,
              granted: finalGranted
            });
        }
      }

      console.log(`✅ Módulo ${moduleCode} ${enabled ? 'activado' : 'desactivado'}`);
    } catch (error) {
      console.error('Error saving module toggle:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo guardar el cambio.'
      });
      // Revertir el cambio local
      await fetchRolePermissions(selectedRole);
    } finally {
      setSavingPermission(null);
    }
  };

  const handleScopeChange = async (moduleCode: string, scopeType: 'scope' | 'promotions' | 'menus', selectedScope: string) => {
    if (!selectedRole) return;

    setSavingPermission(`${moduleCode}-${scopeType}`);

    try {
      // Obtener todas las acciones del grupo de scope
      const config = MODULE_CONFIG[moduleCode as keyof typeof MODULE_CONFIG];
      const scopeActions = config.permissions
        .filter(p => p.group === scopeType)
        .map(p => p.action);

      // Desactivar todas las opciones del scope primero
      for (const action of scopeActions) {
        const permission = permissions.find(p => p.module === moduleCode && p.action === action);
        if (!permission) continue;

        const shouldBeActive = action === selectedScope;

        const { data: existing } = await supabase
          .from('role_permissions')
          .select('id')
          .eq('role', selectedRole)
          .eq('permission_id', permission.id)
          .maybeSingle();

        if (existing) {
          await supabase
            .from('role_permissions')
            .update({ granted: shouldBeActive })
            .eq('role', selectedRole)
            .eq('permission_id', permission.id);
        } else {
          await supabase
            .from('role_permissions')
            .insert({
              role: selectedRole,
              permission_id: permission.id,
              granted: shouldBeActive
            });
        }
      }

      // Actualizar estado local
      setRoleModulePermissions(prev => {
        const updatedPermissions = { ...prev[moduleCode]?.permissions };
        scopeActions.forEach(action => {
          updatedPermissions[action] = action === selectedScope;
        });
        return {
          ...prev,
          [moduleCode]: {
            ...prev[moduleCode],
            permissions: updatedPermissions
          }
        };
      });

      console.log(`✅ Alcance de ${scopeType} actualizado a: ${selectedScope}`);
    } catch (error) {
      console.error('Error saving scope change:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo guardar el cambio.'
      });
      await fetchRolePermissions(selectedRole);
    } finally {
      setSavingPermission(null);
    }
  };

  const handlePermissionToggle = async (moduleCode: string, action: string, granted: boolean) => {
    if (!selectedRole) return;
    
    setSavingPermission(`${moduleCode}-${action}`);
    
    try {
      // Actualizar estado local
      setRoleModulePermissions(prev => ({
        ...prev,
        [moduleCode]: {
          ...prev[moduleCode],
          permissions: {
            ...prev[moduleCode]?.permissions,
            [action]: granted
          }
        }
      }));

      // Guardar en la base de datos
      const permission = permissions.find(p => p.module === moduleCode && p.action === action);
      if (!permission) {
        console.error('Permission not found:', moduleCode, action);
        return;
      }

      // Verificar si ya existe
      const { data: existing } = await supabase
        .from('role_permissions')
        .select('id')
        .eq('role', selectedRole)
        .eq('permission_id', permission.id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('role_permissions')
          .update({ granted })
          .eq('role', selectedRole)
          .eq('permission_id', permission.id);
      } else {
        await supabase
          .from('role_permissions')
          .insert({
            role: selectedRole,
            permission_id: permission.id,
            granted
          });
      }

      console.log(`✅ Permiso ${moduleCode}.${action} ${granted ? 'activado' : 'desactivado'}`);
    } catch (error) {
      console.error('Error saving permission toggle:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo guardar el cambio.'
      });
      // Revertir el cambio local
      await fetchRolePermissions(selectedRole);
    } finally {
      setSavingPermission(null);
    }
  };

  const renderModulePermissions = (moduleCode: string) => {
    const config = MODULE_CONFIG[moduleCode as keyof typeof MODULE_CONFIG];
    if (!config) return null;

    const moduleData = roleModulePermissions[moduleCode] || { enabled: false, permissions: {} };
    const isEnabled = moduleData.enabled;

    return (
      <Card key={moduleCode} className="mb-4">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-3xl">{config.icon}</span>
              <div>
                <CardTitle className="text-lg">{config.name}</CardTitle>
                <CardDescription>{config.description}</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {savingPermission === `module-${moduleCode}` ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : null}
              <Label htmlFor={`module-${moduleCode}`} className="font-medium">
                {isEnabled ? 'Activado' : 'Desactivado'}
              </Label>
              <Switch
                id={`module-${moduleCode}`}
                checked={isEnabled}
                onCheckedChange={(checked) => handleModuleToggle(moduleCode, checked)}
                disabled={savingPermission === `module-${moduleCode}`}
              />
            </div>
          </div>
        </CardHeader>
        
        {isEnabled && (
          <CardContent>
            <div className="space-y-4">
              {/* Agrupar permisos si tienen group */}
              {(() => {
                const groups: { [key: string]: typeof config.permissions } = { main: [] };
                config.permissions.forEach(perm => {
                  const group = perm.group || 'main';
                  if (!groups[group]) groups[group] = [];
                  groups[group].push(perm);
                });

                return Object.entries(groups).map(([groupName, perms]) => {
                  // Si es un grupo de scope (radio buttons)
                  if (groupName === 'scope' || groupName === 'promotions' || groupName === 'menus') {
                    const selectedScope = perms.find(p => moduleData.permissions[p.action])?.action || '';
                    const isSaving = savingPermission === `${moduleCode}-${groupName}`;

                    return (
                      <div key={groupName} className="space-y-3">
                        <Separator className="my-3" />
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold text-sm text-muted-foreground">
                            {groupName === 'scope' && '📍 Alcance de Visualización'}
                            {groupName === 'promotions' && '🎯 Alcance de Promociones'}
                            {groupName === 'menus' && '🍽️ Alcance de Menús'}
                          </h4>
                          {isSaving && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                        </div>
                        <RadioGroup
                          value={selectedScope}
                          onValueChange={(value) => handleScopeChange(moduleCode, groupName as any, value)}
                          disabled={isSaving}
                          className="space-y-2"
                        >
                          {perms.map(perm => (
                            <div key={perm.action} className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                              <RadioGroupItem value={perm.action} id={`${moduleCode}-${perm.action}`} />
                              <div className="flex-1">
                                <Label htmlFor={`${moduleCode}-${perm.action}`} className="cursor-pointer font-medium">
                                  {perm.label}
                                </Label>
                                <p className="text-xs text-muted-foreground mt-0.5">{perm.description}</p>
                              </div>
                            </div>
                          ))}
                        </RadioGroup>
                      </div>
                    );
                  }

                  // Para permisos normales (switches)
                  return (
                    <div key={groupName} className="space-y-2">
                      {groupName !== 'main' && (
                        <>
                          <Separator className="my-3" />
                          <h4 className="font-semibold text-sm text-muted-foreground">
                            {groupName}
                          </h4>
                        </>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {perms.map(perm => {
                          const isSaving = savingPermission === `${moduleCode}-${perm.action}`;
                          return (
                            <div key={perm.action} className="flex items-start space-x-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                              {isSaving ? (
                                <Loader2 className="h-5 w-5 animate-spin text-primary mt-0.5" />
                              ) : (
                                <Switch
                                  id={`${moduleCode}-${perm.action}`}
                                  checked={moduleData.permissions[perm.action] || false}
                                  onCheckedChange={(checked) => handlePermissionToggle(moduleCode, perm.action, checked)}
                                  disabled={perm.action === 'ver_modulo'} // ver_modulo se controla con el switch principal
                                />
                              )}
                              <div className="flex-1">
                                <Label htmlFor={`${moduleCode}-${perm.action}`} className="cursor-pointer font-medium">
                                  {perm.label}
                                </Label>
                                <p className="text-xs text-muted-foreground mt-0.5">{perm.description}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </CardContent>
        )}
      </Card>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="ml-2 text-muted-foreground">Cargando sistema de permisos...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Botón Crear Perfil */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Control de Acceso y Permisos</h2>
          <p className="text-muted-foreground">Gestiona los permisos de roles y usuarios</p>
        </div>
        <Button 
          onClick={() => setCreateProfileModalOpen(true)}
          size="lg"
          className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
        >
          <UserPlus className="h-5 w-5 mr-2" />
          Crear Nuevo Perfil
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Control de Acceso y Reclamaciones
          </CardTitle>
          <CardDescription>
            Gestión de permisos, roles de usuarios y libro de reclamaciones
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="roles">
                <Shield className="h-4 w-4 mr-2" />
                Permisos de Roles
              </TabsTrigger>
              <TabsTrigger value="users">
                <Users className="h-4 w-4 mr-2" />
                Usuarios ({users.length})
              </TabsTrigger>
              <TabsTrigger value="reclamaciones">
                <BookOpen className="h-4 w-4 mr-2" />
                Reclamaciones
              </TabsTrigger>
            </TabsList>

            {/* TAB: PERMISOS DE ROLES */}
            <TabsContent value="roles" className="space-y-4 mt-6">
              {/* Selector de Rol */}
              <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
                <Label className="font-semibold">Configurando permisos para:</Label>
                <Select value={selectedRole} onValueChange={setSelectedRole}>
                  <SelectTrigger className="w-[300px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map(role => (
                      <SelectItem key={role.value} value={role.value}>
                        <div className="flex items-center gap-2">
                          <span>{role.icon}</span>
                          <span>{role.label}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Badge variant="outline" className="ml-auto">
                  {ROLES.find(r => r.value === selectedRole)?.description}
                </Badge>
              </div>

              {/* Módulos */}
              <div className="space-y-4">
                {Object.keys(MODULE_CONFIG).map(moduleCode => renderModulePermissions(moduleCode))}
              </div>

              {/* Info de guardado automático */}
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground pt-4 border-t">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span>Los cambios se guardan automáticamente</span>
              </div>
            </TabsContent>

            {/* TAB: USUARIOS */}
            <TabsContent value="users" className="mt-6">
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-blue-800">
                    <strong>ℹ️ Nota:</strong> Los usuarios heredan los permisos de su rol. 
                    Aquí puedes ver la lista de usuarios activos. Los permisos personalizados por usuario 
                    se implementarán en una futura versión.
                  </p>
                </div>

                {/* Buscador de usuarios */}
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      placeholder="Buscar por nombre, email, sede o rol..."
                      value={userSearchTerm}
                      onChange={(e) => setUserSearchTerm(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  {userSearchTerm && (
                    <Badge variant="outline" className="gap-2">
                      <Users className="h-3 w-3" />
                      {filteredUsers.length} de {users.length}
                    </Badge>
                  )}
                </div>
                
                {/* Lista de usuarios */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredUsers.map(user => (
                    <Card key={user.id} className={user.is_active === false ? 'opacity-60 border-red-200 bg-red-50/30' : ''}>
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <div>
                            <CardTitle className="text-base flex items-center gap-2">
                              {user.full_name || 'Sin nombre'}
                              {user.is_active === false && (
                                <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                                  Desactivado
                                </Badge>
                              )}
                            </CardTitle>
                            <CardDescription className="text-sm">{user.email}</CardDescription>
                          </div>
                          <Badge variant="outline">
                            {ROLES.find(r => r.value === user.role)?.icon} {ROLES.find(r => r.value === user.role)?.label}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            {user.school && (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Building2 className="h-4 w-4" />
                                <span>{user.school.name}</span>
                              </div>
                            )}
                          </div>
                          
                          {/* Botones de acción */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleEditUser(user)}
                              className="gap-2"
                            >
                              <Edit2 className="h-4 w-4" />
                              Editar
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleManageSchools(user)}
                              className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-50"
                            >
                              <Settings2 className="h-4 w-4" />
                              Gestión de Sedes
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleResetPassword(user)}
                              className="gap-2"
                            >
                              <Key className="h-4 w-4" />
                              Cambiar Contraseña
                            </Button>
                            <Button
                              variant={user.is_active === false ? "outline" : "destructive"}
                              size="sm"
                              onClick={() => handleToggleActive(user)}
                              className={user.is_active === false ? "gap-2 border-green-300 text-green-700 hover:bg-green-50" : "gap-2"}
                            >
                              {user.is_active === false ? (
                                <><CheckCircle2 className="h-4 w-4" /> Activar</>
                              ) : (
                                <><XCircle className="h-4 w-4" /> Desactivar</>
                              )}
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* Empty state cuando no hay resultados */}
                {filteredUsers.length === 0 && (
                  <div className="text-center py-12 bg-slate-50 rounded-lg border-2 border-dashed">
                    <Users className="h-12 w-12 text-slate-400 mx-auto mb-4" />
                    <p className="text-slate-600 font-semibold mb-2">No se encontraron usuarios</p>
                    <p className="text-slate-500 text-sm">
                      {userSearchTerm ? 'Intenta con otro término de búsqueda' : 'No hay usuarios registrados'}
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* TAB: RECLAMACIONES */}
            <TabsContent value="reclamaciones" className="mt-6">
              <ReclamacionesPanel />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Modal de Creación de Perfiles */}
      <CreateProfileModal 
        open={createProfileModalOpen}
        onOpenChange={setCreateProfileModalOpen}
        onSuccess={() => {
          fetchUsers();
          toast({
            title: '✅ Perfil creado',
            description: 'El nuevo perfil ha sido agregado exitosamente.',
          });
        }}
      />

      {/* Modal de Reseteo de Contraseña */}
      {userToResetPassword && (
        <ResetUserPasswordModal
          open={resetPasswordModalOpen}
          onOpenChange={setResetPasswordModalOpen}
          userEmail={userToResetPassword.email}
          userName={userToResetPassword.full_name}
          recipientKind="staff"
          onSuccess={() => {
            fetchUsers();
          }}
        />
      )}

      {/* Modal de Gestión de Sedes Personalizadas */}
      <ManageCustomSchoolsModal
        isOpen={manageSchoolsModalOpen}
        onClose={() => {
          setManageSchoolsModalOpen(false);
          setUserToManageSchools(null);
        }}
        userProfile={userToManageSchools}
        onSuccess={() => {
          console.log('✅ Sedes actualizadas exitosamente');
          fetchUsers(); // Refrescar la lista
        }}
      />
    </div>
  );
};

