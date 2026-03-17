import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ResetUserPasswordModal } from '@/components/admin/ResetUserPasswordModal';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { 
  Users, 
  UserPlus, 
  Search, 
  Filter,
  Mail,
  Calendar,
  Shield,
  Building2,
  Ban,
  CheckCircle2,
  Edit2,
  Trash2,
  Key,
  MoreVertical
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { CreateAdminSimple } from '@/components/admin/CreateAdminSimple';

interface User {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  app_metadata: {
    provider?: string;
  };
  user_metadata: {
    full_name?: string;
  };
}

interface Profile {
  id: string;
  role: string;
  full_name?: string | null;
  school_id: string | null;
  pos_number: number | null;
  ticket_prefix: string | null;
}

interface School {
  id: string;
  name: string;
  code: string;
}

interface UserWithProfile extends User {
  profile?: Profile;
  school?: School;
  /** Solo para role=parent: hijos desde students */
  children?: { full_name: string; grade?: string; section?: string; school_id?: string }[];
}

export function UsersManagement() {
  const { toast } = useToast();
  const [users, setUsers] = useState<UserWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingUser, setEditingUser] = useState<UserWithProfile | null>(null);
  const [deletingUser, setDeletingUser] = useState<UserWithProfile | null>(null);
  const [resetPasswordUser, setResetPasswordUser] = useState<UserWithProfile | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [editingRole, setEditingRole] = useState<string>('');

  // Estadísticas
  const [stats, setStats] = useState({
    total: 0,
    superadmin: 0,
    admin_general: 0,
    supervisor_red: 0,
    gestor_unidad: 0,
    operador_caja: 0,
    operador_cocina: 0,
    parent: 0,
  });

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      // Obtener perfiles con email y nombre (quienes no están aquí no aparecen en la lista)
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, email, full_name, role, school_id, pos_number, ticket_prefix')
        .order('email')
        .range(0, 4999);

      if (profilesError) throw profilesError;

      // Obtener schools
      const { data: schools } = await supabase
        .from('schools')
        .select('id, name, code');

      const schoolsMap = new Map(schools?.map(s => [s.id, s]) || []);

      // Para padres, obtener school_id desde parent_profiles
      const parentIds = profiles?.filter(p => p.role === 'parent').map(p => p.id) || [];
      let parentSchoolsMap = new Map();

      if (parentIds.length > 0) {
        const { data: parentProfiles } = await supabase
          .from('parent_profiles')
          .select('user_id, school_id')
          .in('user_id', parentIds)
          .range(0, 4999);

        parentSchoolsMap = new Map(parentProfiles?.map(pp => [pp.user_id, pp.school_id]) || []);
      }

      // Crear usuarios con datos reales
      let usersWithData = (profiles || []).map((profile) => {
        // Para padres, usar school_id de parent_profiles (puede ser null → SIN SEDE)
        const schoolId = profile.role === 'parent'
          ? parentSchoolsMap.get(profile.id)
          : profile.school_id;

        return {
          id: profile.id,
          email: profile.email || 'Sin email',
          created_at: new Date().toISOString(),
          last_sign_in_at: null,
          app_metadata: {},
          user_metadata: {},
          profile: {
            ...profile,
            school_id: schoolId,
          },
          school: schoolId ? schoolsMap.get(schoolId) : undefined,
          children: [] as UserWithProfile['children'],
        };
      });

      // Para padres: cargar hijos desde students (así se ve aunque tengan SIN SEDE)
      if (parentIds.length > 0) {
        const { data: studentsData } = await supabase
          .from('students')
          .select('parent_id, full_name, grade, section, school_id')
          .in('parent_id', parentIds)
          .eq('is_active', true)
          .range(0, 4999);
        const byParent = new Map<string, UserWithProfile['children']>();
        (studentsData || []).forEach((s: any) => {
          if (!s.parent_id) return;
          const list = byParent.get(s.parent_id) || [];
          list.push({ full_name: s.full_name, grade: s.grade, section: s.section, school_id: s.school_id });
          byParent.set(s.parent_id, list);
        });
        usersWithData = usersWithData.map((u) => ({
          ...u,
          children: u.profile?.role === 'parent' ? (byParent.get(u.id) || []) : undefined,
        }));
      }

      setUsers(usersWithData as UserWithProfile[]);

      // Calcular estadísticas
      const statsCopy = {
        total: profiles?.length || 0,
        superadmin: profiles?.filter(p => p.role === 'superadmin').length || 0,
        admin_general: profiles?.filter(p => p.role === 'admin_general').length || 0,
        supervisor_red: profiles?.filter(p => p.role === 'supervisor_red').length || 0,
        gestor_unidad: profiles?.filter(p => p.role === 'gestor_unidad').length || 0,
        operador_caja: profiles?.filter(p => p.role === 'operador_caja').length || 0,
        operador_cocina: profiles?.filter(p => p.role === 'operador_cocina').length || 0,
        parent: profiles?.filter(p => p.role === 'parent').length || 0,
      };
      setStats(statsCopy);

    } catch (error: any) {
      console.error('Error fetching users:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar los usuarios',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateRole = async () => {
    if (!editingUser || !editingRole) return;

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ role: editingRole })
        .eq('id', editingUser.id);

      if (error) throw error;

      toast({
        title: '✅ Rol Actualizado',
        description: `El rol de ${editingUser.email} se cambió a ${editingRole}`,
      });

      setEditingUser(null);
      setEditingRole('');
      fetchUsers();
    } catch (error: any) {
      console.error('Error updating role:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo actualizar el rol',
      });
    }
  };

  const handleDeleteUser = async (user: UserWithProfile) => {
    try {
      // 1. Eliminar de profiles
      const { error: profileError } = await supabase
        .from('profiles')
        .delete()
        .eq('id', user.id);

      if (profileError) throw profileError;

      // 2. Mostrar advertencia sobre eliminación de auth.users
      toast({
        title: '⚠️ Usuario Eliminado de Profiles',
        description: `${user.email} eliminado. Para eliminación completa, ejecuta en Supabase: DELETE FROM auth.users WHERE email = '${user.email}';`,
        duration: 10000,
      });

      setDeletingUser(null);
      fetchUsers();
    } catch (error: any) {
      console.error('Error deleting user:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo eliminar el usuario',
      });
    }
  };

  const handleResetPassword = async () => {
    if (!resetPasswordUser || !newPassword || newPassword.length < 6) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'La contraseña debe tener al menos 6 caracteres',
      });
      return;
    }

    try {
      // Nota: Esto requiere service_role key en producción
      // Por ahora, solo actualizamos en profiles como referencia
      toast({
        title: '⚠️ Función Limitada',
        description: 'El cambio de contraseña requiere configuración adicional en el servidor. El usuario debe usar "Olvidé mi contraseña" en el login.',
      });

      setResetPasswordUser(null);
      setNewPassword('');
    } catch (error: any) {
      console.error('Error resetting password:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo cambiar la contraseña',
      });
    }
  };

  const generateTempPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < 10; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setNewPassword(password);
  };

  const filteredUsers = users.filter(user => {
    const term = searchTerm.toLowerCase().trim();
    const matchesSearch = !term
      || user.email?.toLowerCase().includes(term)
      || (user.profile?.full_name?.toLowerCase().includes(term));
    const matchesRole = roleFilter === 'all' || user.profile?.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const getRoleBadge = (role: string) => {
    const badges: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      superadmin: { label: 'SuperAdmin', variant: 'destructive' },
      admin_general: { label: 'Admin General', variant: 'default' },
      supervisor_red: { label: 'Supervisor de Red', variant: 'secondary' },
      gestor_unidad: { label: 'Gestor de Unidad', variant: 'secondary' },
      operador_caja: { label: 'Operador de Caja', variant: 'secondary' },
      operador_cocina: { label: 'Operador de Cocina', variant: 'secondary' },
      parent: { label: 'Padre', variant: 'outline' },
    };

    const badge = badges[role] || { label: role, variant: 'outline' };
    return <Badge variant={badge.variant}>{badge.label}</Badge>;
  };

  const getProviderIcon = (provider?: string) => {
    if (!provider) return <Mail className="h-4 w-4" />;
    if (provider === 'google') return <span className="text-xs">🔵</span>;
    if (provider === 'azure') return <span className="text-xs">🔷</span>;
    return <Mail className="h-4 w-4" />;
  };

  return (
    <div className="space-y-6">
      {/* Estadísticas */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground">Total Usuarios</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{stats.superadmin}</div>
            <p className="text-xs text-muted-foreground">SuperAdmin</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{stats.admin_general}</div>
            <p className="text-xs text-muted-foreground">Admin General</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{stats.supervisor_red}</div>
            <p className="text-xs text-muted-foreground">Supervisor de Red</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{stats.gestor_unidad}</div>
            <p className="text-xs text-muted-foreground">Gestor de Unidad</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{stats.operador_caja}</div>
            <p className="text-xs text-muted-foreground">Operador de Caja</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{stats.operador_cocina}</div>
            <p className="text-xs text-muted-foreground">Operador de Cocina</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{stats.parent}</div>
            <p className="text-xs text-muted-foreground">Padres</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabla de Usuarios */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Gestión de Usuarios
              </CardTitle>
              <CardDescription>
                Todos los usuarios registrados en el sistema
              </CardDescription>
            </div>
            <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
              <DialogTrigger asChild>
                <Button>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Crear Admin General
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle>Crear Admin General</DialogTitle>
                  <DialogDescription>
                    Nuevo usuario con acceso completo al ERP
                  </DialogDescription>
                </DialogHeader>
                <CreateAdminSimple 
                  onSuccess={() => {
                    setShowCreateDialog(false);
                    fetchUsers();
                  }}
                  onCancel={() => setShowCreateDialog(false)}
                />
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filtros */}
          <div className="flex gap-4 mb-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-[200px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Filtrar por rol" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los roles</SelectItem>
                <SelectItem value="superadmin">SuperAdmin</SelectItem>
                <SelectItem value="admin_general">Admin General</SelectItem>
                <SelectItem value="supervisor_red">Supervisor de Red</SelectItem>
                <SelectItem value="gestor_unidad">Gestor de Unidad</SelectItem>
                <SelectItem value="operador_caja">Operador de Caja</SelectItem>
                <SelectItem value="operador_cocina">Operador de Cocina</SelectItem>
                <SelectItem value="parent">Padres</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Tabla */}
          {loading ? (
            <div className="text-center py-8">Cargando...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Sede</TableHead>
                  <TableHead>Hijos</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead>Creado</TableHead>
                  <TableHead>Último acceso</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-6 text-muted-foreground">
                      {searchTerm || roleFilter !== 'all' ? (
                        <>No hay usuarios que coincidan con la búsqueda o el filtro.</>
                      ) : (
                        <>No hay usuarios cargados.</>
                      )}
                      {searchTerm && (
                        <p className="text-xs mt-2 max-w-md mx-auto">
                          Si el correo debería existir y no aparece, puede que falte su perfil en la base de datos (cuenta en Auth sin fila en <code>profiles</code>). Ejecuta en Supabase → SQL Editor el script <code>SYNC_MISSING_PROFILES_FROM_AUTH.sql</code> para crearlos.
                        </p>
                      )}
                    </TableCell>
                  </TableRow>
                ) : filteredUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="text-sm">{user.profile?.full_name?.trim() || '-'}</TableCell>
                    <TableCell className="font-mono text-sm">{user.email}</TableCell>
                    <TableCell>{getRoleBadge(user.profile?.role || 'unknown')}</TableCell>
                    <TableCell>
                      {user.school ? (
                        <span className="text-sm flex items-center gap-1">
                          <Building2 className="h-3 w-3" />
                          {user.school.name}
                          {user.profile?.ticket_prefix && (
                            <Badge variant="outline" className="ml-1">
                              {user.profile.ticket_prefix}
                            </Badge>
                          )}
                        </span>
                      ) : user.profile?.role === 'parent' ? (
                        <Badge variant="destructive" className="text-xs">
                          ⚠️ SIN SEDE
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {user.profile?.role === 'parent' && user.children !== undefined ? (
                        user.children.length > 0 ? (
                          <span className="text-xs text-gray-700" title={user.children.map(c => `${c.full_name}${c.grade || c.section ? ` (${[c.grade, c.section].filter(Boolean).join(' - ')})` : ''}`).join('\n')}>
                            {user.children.length} hijo{user.children.length !== 1 ? 's' : ''}: {user.children.map(c => c.full_name).join(', ')}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">0 hijos</span>
                        )
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1">
                        {getProviderIcon(user.app_metadata?.provider)}
                        <span className="text-xs capitalize">{user.app_metadata?.provider || 'email'}</span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(user.created_at), 'dd MMM yyyy', { locale: es })}
                      </span>
                    </TableCell>
                    <TableCell>
                      {user.last_sign_in_at ? (
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(user.last_sign_in_at), 'dd MMM HH:mm', { locale: es })}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Nunca</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingUser(user);
                            setEditingRole(user.profile?.role || '');
                          }}
                          disabled={user.profile?.role === 'superadmin'}
                          title="Cambiar rol"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setResetPasswordUser(user)}
                          title="Cambiar contraseña"
                        >
                          <Key className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeletingUser(user)}
                          disabled={user.profile?.role === 'superadmin'}
                          title="Eliminar usuario"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dialog: Editar Rol */}
      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cambiar Rol de Usuario</DialogTitle>
            <DialogDescription>
              Usuario: <strong>{editingUser?.email}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="role-select">Nuevo Rol</Label>
              <Select value={editingRole} onValueChange={setEditingRole}>
                <SelectTrigger id="role-select">
                  <SelectValue placeholder="Selecciona un rol" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="parent">Padre de Familia</SelectItem>
                  <SelectItem value="admin_general">Admin General</SelectItem>
                  <SelectItem value="supervisor_red">Supervisor de Red</SelectItem>
                  <SelectItem value="gestor_unidad">Gestor de Unidad</SelectItem>
                  <SelectItem value="operador_caja">Operador de Caja</SelectItem>
                  <SelectItem value="operador_cocina">Operador de Cocina</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <p className="text-sm text-yellow-800">
                <strong>⚠️ Importante:</strong> Al cambiar el rol, el usuario tendrá diferentes permisos y acceso a diferentes módulos.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setEditingUser(null)}>
                Cancelar
              </Button>
              <Button onClick={handleUpdateRole} disabled={!editingRole}>
                Cambiar Rol
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Resetear Contraseña */}
      <ResetUserPasswordModal
        open={!!resetPasswordUser}
        onOpenChange={(open) => !open && setResetPasswordUser(null)}
        userEmail={resetPasswordUser?.email || ''}
        userName={resetPasswordUser?.profile?.full_name}
        onSuccess={() => {
          toast({
            title: '✅ Contraseña Reseteada',
            description: 'La contraseña temporal ha sido generada',
          });
          setResetPasswordUser(null);
        }}
      />

      {/* Dialog: Confirmar Eliminación */}
      <Dialog open={!!deletingUser} onOpenChange={(open) => !open && setDeletingUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Eliminar Usuario?</DialogTitle>
            <DialogDescription>
              Esta acción NO se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-800 font-semibold">
                Estás a punto de eliminar:
              </p>
              <p className="text-sm text-red-800 mt-2">
                📧 <strong>{deletingUser?.email}</strong>
              </p>
              <p className="text-sm text-red-800 mt-1">
                🏷️ Rol: <strong>{deletingUser?.profile?.role}</strong>
              </p>
              {deletingUser?.school && (
                <p className="text-sm text-red-800 mt-1">
                  🏫 Sede: <strong>{deletingUser.school.name}</strong>
                </p>
              )}
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <p className="text-sm text-yellow-800">
                <strong>⚠️ Se eliminarán:</strong>
              </p>
              <ul className="text-sm text-yellow-800 mt-2 list-disc list-inside">
                <li>El usuario y su perfil</li>
                <li>Sus accesos al sistema</li>
                {deletingUser?.profile?.role === 'pos' && <li>Sus secuencias de tickets</li>}
                {deletingUser?.profile?.role === 'parent' && <li>Su vinculación con estudiantes</li>}
              </ul>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setDeletingUser(null)}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={() => deletingUser && handleDeleteUser(deletingUser)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Sí, Eliminar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

