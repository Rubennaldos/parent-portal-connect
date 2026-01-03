import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { 
  Building2,
  UserPlus,
  Users,
  UtensilsCrossed,
  CreditCard,
  AlertCircle,
  CheckCircle2,
  Edit2
} from 'lucide-react';

interface School {
  id: string;
  name: string;
  code: string;
  prefix_base: string;
}

interface POSProfile {
  id: string;
  email: string;
  role: string;
  pos_number: number;
  ticket_prefix: string;
  created_at: string;
}

interface SchoolProfiles {
  school: School;
  pos_users: POSProfile[];
  comedor_users: POSProfile[];
  total_profiles: number;
  can_add_more: boolean;
  next_pos_number: number;
  next_prefix: string;
}

export function ProfilesControl() {
  const { toast } = useToast();
  const [schoolsData, setSchoolsData] = useState<SchoolProfiles[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('');
  const [editingPrefix, setEditingPrefix] = useState<string | null>(null);
  const [newPrefixValue, setNewPrefixValue] = useState('');

  useEffect(() => {
    fetchSchoolsProfiles();
  }, []);

  const handleUpdatePrefix = async (userId: string, oldPrefix: string) => {
    if (!newPrefixValue || newPrefixValue === oldPrefix) {
      setEditingPrefix(null);
      return;
    }

    try {
      // Actualizar prefijo en profiles
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ ticket_prefix: newPrefixValue })
        .eq('id', userId);

      if (profileError) throw profileError;

      // Actualizar prefijo en ticket_sequences
      const { error: seqError } = await supabase
        .from('ticket_sequences')
        .update({ prefix: newPrefixValue })
        .eq('pos_user_id', userId);

      if (seqError) throw seqError;

      toast({
        title: '✅ Prefijo Actualizado',
        description: `Cambiado de ${oldPrefix} a ${newPrefixValue}`,
      });

      setEditingPrefix(null);
      fetchSchoolsProfiles();
    } catch (error: any) {
      console.error('Error updating prefix:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo actualizar el prefijo',
      });
    }
  };

  const fetchSchoolsProfiles = async () => {
    setLoading(true);
    try {
      // Obtener todas las sedes con sus prefijos
      const { data: schools, error: schoolsError } = await supabase
        .from('schools')
        .select(`
          id,
          name,
          code,
          school_prefixes (
            prefix_base
          )
        `)
        .order('name');

      if (schoolsError) throw schoolsError;

      // Para cada sede, obtener sus usuarios POS y Kitchen
      const schoolsWithProfiles = await Promise.all(
        (schools || []).map(async (school) => {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, role, pos_number, ticket_prefix, created_at')
            .eq('school_id', school.id)
            .in('role', ['pos', 'comedor'])
            .order('role')
            .order('pos_number');

          // Obtener emails de auth
          // Ya no necesitamos auth.admin, el email ya viene en profiles
          const profilesWithEmail = profiles || [];

          const posUsers = profilesWithEmail.filter(p => p.role === 'pos');
          const comedorUsers = profilesWithEmail.filter(p => p.role === 'comedor');
          const totalProfiles = posUsers.length + comedorUsers.length;
          
          // Calcular siguiente número POS disponible
          const usedNumbers = posUsers.map(p => p.pos_number).filter(n => n !== null);
          const maxNumber = usedNumbers.length > 0 ? Math.max(...usedNumbers) : 0;
          const nextPosNumber = maxNumber + 1 <= 3 ? maxNumber + 1 : 0;
          
          // Generar siguiente prefijo
          const prefixBase = school.school_prefixes?.[0]?.prefix_base || school.code;
          const nextPrefix = nextPosNumber > 0 ? `${prefixBase}${nextPosNumber}` : '-';

          return {
            school: {
              ...school,
              prefix_base: prefixBase,
            },
            pos_users: posUsers,
            comedor_users: comedorUsers,
            total_profiles: totalProfiles,
            can_add_more: totalProfiles < 3,
            next_pos_number: nextPosNumber,
            next_prefix: nextPrefix,
          };
        })
      );

      setSchoolsData(schoolsWithProfiles as SchoolProfiles[]);
    } catch (error: any) {
      console.error('Error fetching schools profiles:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar los perfiles',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Control de Perfiles por Sede</h2>
          <p className="text-muted-foreground">
            Gestiona usuarios POS y Comedor (máximo 3 por sede)
          </p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8">Cargando sedes...</div>
      ) : (
        <div className="grid gap-6">
          {schoolsData.map((schoolData) => (
            <Card key={schoolData.school.id} className="border-2">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Building2 className="h-5 w-5" />
                      {schoolData.school.name}
                    </CardTitle>
                    <CardDescription>
                      Código: {schoolData.school.code} | Prefijo base: {schoolData.school.prefix_base}
                    </CardDescription>
                    {schoolData.can_add_more && schoolData.next_pos_number > 0 && (
                      <div className="mt-2 bg-blue-50 border border-blue-200 rounded px-2 py-1 inline-block">
                        <span className="text-xs text-blue-900">
                          ✨ Siguiente correlativo POS: <strong className="font-mono">{schoolData.next_prefix}</strong>
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={schoolData.can_add_more ? 'secondary' : 'destructive'}>
                      {schoolData.total_profiles}/3 perfiles
                    </Badge>
                    {schoolData.can_add_more && (
                      <Dialog open={showCreateDialog && selectedSchoolId === schoolData.school.id} 
                              onOpenChange={(open) => {
                                setShowCreateDialog(open);
                                if (open) setSelectedSchoolId(schoolData.school.id);
                              }}>
                        <DialogTrigger asChild>
                          <Button size="sm">
                            <UserPlus className="h-4 w-4 mr-2" />
                            Agregar Perfil
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Crear Usuario POS/Comedor</DialogTitle>
                            <DialogDescription>
                              Sede: {schoolData.school.name}
                            </DialogDescription>
                          </DialogHeader>
                          <CreatePOSComedorForm 
                            schoolId={schoolData.school.id}
                            schoolName={schoolData.school.name}
                            prefixBase={schoolData.school.prefix_base}
                            currentCount={schoolData.total_profiles}
                            onSuccess={() => {
                              setShowCreateDialog(false);
                              fetchSchoolsProfiles();
                            }}
                          />
                        </DialogContent>
                      </Dialog>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid md:grid-cols-2 gap-4">
                  {/* POS Users */}
                  <div>
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <CreditCard className="h-4 w-4" />
                      Puntos de Venta (POS)
                    </h4>
                    {schoolData.pos_users.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No hay cajeros asignados</p>
                    ) : (
                      <div className="space-y-2">
                        {schoolData.pos_users.map((user) => (
                          <Card key={user.id} className="p-3">
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <p className="text-sm font-mono">{user.email}</p>
                                <div className="mt-1 flex items-center gap-2">
                                  {editingPrefix === user.id ? (
                                    <div className="flex items-center gap-2">
                                      <Input
                                        value={newPrefixValue}
                                        onChange={(e) => setNewPrefixValue(e.target.value.toUpperCase())}
                                        className="h-7 w-20 text-xs font-mono"
                                        placeholder={user.ticket_prefix}
                                        autoFocus
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            handleUpdatePrefix(user.id, user.ticket_prefix);
                                          } else if (e.key === 'Escape') {
                                            setEditingPrefix(null);
                                          }
                                        }}
                                      />
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 px-2"
                                        onClick={() => handleUpdatePrefix(user.id, user.ticket_prefix)}
                                      >
                                        ✓
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 px-2"
                                        onClick={() => setEditingPrefix(null)}
                                      >
                                        ✕
                                      </Button>
                                    </div>
                                  ) : (
                                    <>
                                      <Badge variant="secondary">
                                        {user.ticket_prefix}
                                      </Badge>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-6 w-6 p-0"
                                        onClick={() => {
                                          setEditingPrefix(user.id);
                                          setNewPrefixValue(user.ticket_prefix);
                                        }}
                                        title="Editar prefijo"
                                      >
                                        <Edit2 className="h-3 w-3" />
                                      </Button>
                                    </>
                                  )}
                                </div>
                              </div>
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                            </div>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Comedor Users */}
                  <div>
                    <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <UtensilsCrossed className="h-4 w-4" />
                      Gestión de Menús (Comedor)
                    </h4>
                    {schoolData.comedor_users.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No hay usuarios de comedor</p>
                    ) : (
                      <div className="space-y-2">
                        {schoolData.comedor_users.map((user) => (
                          <Card key={user.id} className="p-3">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-mono">{user.email}</p>
                              </div>
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                            </div>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {!schoolData.can_add_more && (
                  <div className="mt-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                    <p className="text-sm text-yellow-600 flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" />
                      Esta sede ha alcanzado el límite máximo de 3 perfiles
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CreatePOSComedorForm({ 
  schoolId, 
  schoolName, 
  prefixBase,
  currentCount,
  onSuccess 
}: { 
  schoolId: string;
  schoolName: string;
  prefixBase: string;
  currentCount: number;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [profileType, setProfileType] = useState<'pos' | 'comedor'>('pos');
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
      // 🔐 GUARDAR SESIÓN ACTUAL DEL SUPERADMIN
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession) {
        throw new Error('No hay sesión activa de SuperAdmin');
      }

      // 1. Crear usuario en Auth (esto hará auto-login)
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { 
            full_name: fullName,
            role: profileType, // 🔥 IMPORTANTE: Pasar el rol correcto desde el inicio
          },
          emailRedirectTo: undefined, // Evitar redirección
        },
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error('No se pudo crear el usuario');

      // 🔥 ESPERAR UN MOMENTO PARA QUE EL TRIGGER CREE EL PERFIL
      await new Promise(resolve => setTimeout(resolve, 500));

      // 2. Si es POS, obtener siguiente número y crear secuencia
      let posNumber: number | null = null;
      let ticketPrefix: string | null = null;

      if (profileType === 'pos') {
        // Obtener siguiente número POS disponible
        const { data: nextNumber, error: numberError } = await supabase
          .rpc('get_next_pos_number', { p_school_id: schoolId });

        if (numberError) throw numberError;
        posNumber = nextNumber;

        // Generar prefijo completo
        const { data: prefix, error: prefixError } = await supabase
          .rpc('generate_ticket_prefix', { 
            p_school_id: schoolId,
            p_pos_number: posNumber 
          });

        if (prefixError) throw prefixError;
        ticketPrefix = prefix;

        // Crear secuencia de tickets
        const { error: seqError } = await supabase
          .rpc('create_ticket_sequence', {
            p_school_id: schoolId,
            p_pos_user_id: authData.user.id,
            p_prefix: ticketPrefix
          });

        if (seqError) throw seqError;
      }

      // 3. Actualizar perfil con UPSERT (forzar el rol correcto)
      const { error: updateError } = await supabase
        .from('profiles')
        .upsert({
          id: authData.user.id,
          email: email,
          role: profileType, // 🔥 FORZAR el rol correcto (pos o comedor)
          school_id: schoolId,
          pos_number: posNumber,
          ticket_prefix: ticketPrefix,
        }, {
          onConflict: 'id'
        });

      if (updateError) throw updateError;

      // 🔄 RESTAURAR SESIÓN DEL SUPERADMIN
      // Cerrar sesión del nuevo usuario
      await supabase.auth.signOut();
      
      // Restaurar sesión del SuperAdmin
      const { error: setSessionError } = await supabase.auth.setSession({
        access_token: currentSession.access_token,
        refresh_token: currentSession.refresh_token,
      });

      if (setSessionError) {
        console.warn('Error al restaurar sesión:', setSessionError);
        // No lanzamos error, el usuario se creó correctamente
      }

      toast({
        title: '✅ Usuario Creado',
        description: `${profileType === 'pos' ? 'Cajero' : 'Comedor'} ${email} creado exitosamente${ticketPrefix ? ` con prefijo ${ticketPrefix}` : ''}`,
      });

      onSuccess();
    } catch (error: any) {
      console.error('Error creating user:', error);
      
      // 🔄 INTENTAR RESTAURAR SESIÓN INCLUSO SI HAY ERROR
      try {
        const { data: { session: fallbackSession } } = await supabase.auth.getSession();
        if (!fallbackSession) {
          // Forzar reload para volver al login
          window.location.reload();
        }
      } catch (e) {
        console.error('Error al recuperar sesión:', e);
      }

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
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <p className="text-sm text-blue-900">
          <strong>Sede:</strong> {schoolName}<br />
          <strong>Perfiles actuales:</strong> {currentCount}/3<br />
          {prefixBase && <><strong>Prefijo base:</strong> {prefixBase}</>}
        </p>
      </div>

      <div>
        <Label htmlFor="profileType">Tipo de Perfil</Label>
        <Select value={profileType} onValueChange={(v) => setProfileType(v as 'pos' | 'comedor')}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pos">
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4" />
                Punto de Venta (POS)
              </div>
            </SelectItem>
            <SelectItem value="comedor">
              <div className="flex items-center gap-2">
                <UtensilsCrossed className="h-4 w-4" />
                Gestión de Menús (Comedor)
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="fullName">Nombre Completo</Label>
        <Input
          id="fullName"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Nombre del usuario"
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
          placeholder={`${profileType}@${schoolName.toLowerCase().replace(/\s+/g, '')}.com`}
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

      {profileType === 'pos' && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
          <p className="text-sm text-green-900">
            ℹ️ Se asignará automáticamente un prefijo único para los tickets (ej: {prefixBase}1, {prefixBase}2)
          </p>
        </div>
      )}

      <Button type="submit" className="w-full" disabled={creating}>
        {creating ? 'Creando...' : `Crear Usuario ${profileType === 'pos' ? 'POS' : 'Comedor'}`}
      </Button>
    </form>
  );
}

