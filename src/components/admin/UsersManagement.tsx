import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  CheckCircle2
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

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
}

export function UsersManagement() {
  const { toast } = useToast();
  const [users, setUsers] = useState<UserWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Estadísticas
  const [stats, setStats] = useState({
    total: 0,
    superadmin: 0,
    admin_general: 0,
    pos: 0,
    kitchen: 0,
    parent: 0,
  });

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      // Obtener perfiles
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, role, school_id, pos_number, ticket_prefix')
        .order('id');

      if (profilesError) throw profilesError;

      // Obtener schools por separado
      const { data: schools } = await supabase
        .from('schools')
        .select('id, name, code');

      const schoolsMap = new Map(schools?.map(s => [s.id, s]) || []);

      // Obtener datos de auth para cada perfil
      const usersWithData = (profiles || []).map((profile) => {
        return {
          id: profile.id,
          email: 'Cargando...', // Se cargará después
          created_at: new Date().toISOString(),
          last_sign_in_at: null,
          app_metadata: {},
          user_metadata: {},
          profile,
          school: profile.school_id ? schoolsMap.get(profile.school_id) : undefined,
        };
      });

      setUsers(usersWithData as UserWithProfile[]);

      // Calcular estadísticas
      const statsCopy = {
        total: profiles?.length || 0,
        superadmin: profiles?.filter(p => p.role === 'superadmin').length || 0,
        admin_general: profiles?.filter(p => p.role === 'admin_general').length || 0,
        pos: profiles?.filter(p => p.role === 'pos').length || 0,
        kitchen: profiles?.filter(p => p.role === 'kitchen').length || 0,
        parent: profiles?.filter(p => p.role === 'parent').length || 0,
      };
      setStats(statsCopy);

      // Cargar emails en segundo plano
      loadUserEmails(usersWithData);

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

  const loadUserEmails = async (usersData: UserWithProfile[]) => {
    // Cargar emails de la tabla auth.users usando una función SQL
    const { data: authUsers } = await supabase
      .from('profiles')
      .select('id');

    // Por simplicidad, usamos el ID como email temporal
    // En producción, deberías crear una vista o función SQL
    const updatedUsers = usersData.map(user => ({
      ...user,
      email: `user-${user.id.substring(0, 8)}@limacafe28.com`, // Temporal
    }));

    setUsers(updatedUsers as UserWithProfile[]);
  };

  const filteredUsers = users.filter(user => {
    const matchesSearch = user.email?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = roleFilter === 'all' || user.profile?.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const getRoleBadge = (role: string) => {
    const badges: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      superadmin: { label: 'SuperAdmin', variant: 'destructive' },
      admin_general: { label: 'Admin General', variant: 'default' },
      pos: { label: 'POS', variant: 'secondary' },
      kitchen: { label: 'Kitchen', variant: 'secondary' },
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
            <div className="text-2xl font-bold">{stats.pos}</div>
            <p className="text-xs text-muted-foreground">POS</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{stats.kitchen}</div>
            <p className="text-xs text-muted-foreground">Kitchen</p>
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
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Crear Usuario Admin General</DialogTitle>
                  <DialogDescription>
                    Este usuario tendrá acceso completo al ERP
                  </DialogDescription>
                </DialogHeader>
                <CreateAdminForm onSuccess={() => {
                  setShowCreateDialog(false);
                  fetchUsers();
                }} />
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
                <SelectItem value="pos">POS</SelectItem>
                <SelectItem value="kitchen">Kitchen</SelectItem>
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
                  <TableHead>Email</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Sede</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead>Creado</TableHead>
                  <TableHead>Último acceso</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((user) => (
                  <TableRow key={user.id}>
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
                      <Button variant="ghost" size="sm">
                        Ver detalles
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CreateAdminForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [creating, setCreating] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password || !fullName) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Completa todos los campos',
      });
      return;
    }

    setCreating(true);

    try {
      // Crear usuario en Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
          },
        },
      });

      if (authError) throw authError;

      if (authData.user) {
        // Actualizar rol a admin_general
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ role: 'admin_general' })
          .eq('id', authData.user.id);

        if (updateError) throw updateError;

        toast({
          title: '✅ Admin Creado',
          description: `Usuario ${email} creado exitosamente`,
        });

        onSuccess();
      }
    } catch (error: any) {
      console.error('Error creating admin:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo crear el usuario',
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="fullName">Nombre Completo</Label>
        <Input
          id="fullName"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Juan Pérez"
          required
        />
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="admin@limacafe28.com"
          required
        />
      </div>
      <div>
        <Label htmlFor="password">Contraseña</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Mínimo 6 caracteres"
          required
        />
      </div>
      <Button type="submit" className="w-full" disabled={creating}>
        {creating ? 'Creando...' : 'Crear Admin General'}
      </Button>
    </form>
  );
}

