import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  ShieldCheck, 
  LogOut, 
  AlertTriangle, 
  Key, 
  UserPlus, 
  Database,
  Activity,
  Settings,
  Code2
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';

const SuperAdmin = () => {
  const { signOut, user } = useAuth();
  const { role, isStaff, isParent } = useRole();
  const { toast } = useToast();

  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [creatingAdmin, setCreatingAdmin] = useState(false);

  const handleLogout = async () => {
    await signOut();
  };

  const handleCreateAdminGeneral = async () => {
    if (!newAdminEmail || !newAdminPassword) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Debes completar todos los campos',
      });
      return;
    }

    setCreatingAdmin(true);

    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: newAdminEmail,
        password: newAdminPassword,
      });

      if (authError) throw authError;

      if (authData.user) {
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ role: 'admin_general' })
          .eq('id', authData.user.id);

        if (updateError) throw updateError;

        toast({
          title: '✅ Admin Creado',
          description: `Usuario ${newAdminEmail} creado con rol admin_general`,
        });

        setNewAdminEmail('');
        setNewAdminPassword('');
      }
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error al crear admin',
        description: error.message,
      });
    } finally {
      setCreatingAdmin(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950">
      <header className="bg-slate-900/80 backdrop-blur-md border-b border-purple-500/30 sticky top-0 z-50 shadow-lg shadow-purple-500/10">
        <div className="bg-purple-900/30 border-b border-purple-500/30 px-4 py-1">
          <p className="text-xs font-mono text-purple-300 text-center">
            🔐 DEBUG ROL: <strong>{role || 'null'}</strong> | isStaff: {isStaff ? '✅' : '❌'} | isParent: {isParent ? '✅' : '❌'}
          </p>
        </div>

        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-600 to-pink-600 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/50">
              <ShieldCheck className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
                SuperAdmin Panel
              </h1>
              <p className="text-xs text-purple-300">Panel de Programador - Acceso Total</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-white">{user?.email}</p>
              <p className="text-xs text-purple-300">👨‍💻 Programador</p>
            </div>
            <Button 
              onClick={handleLogout} 
              variant="outline" 
              size="sm"
              className="border-purple-500/50 hover:bg-purple-500/20"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Salir
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-5 bg-slate-900/50 border border-purple-500/30">
            <TabsTrigger value="overview" className="data-[state=active]:bg-purple-600">
              <Activity className="h-4 w-4 mr-2" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="users" className="data-[state=active]:bg-purple-600">
              <UserPlus className="h-4 w-4 mr-2" />
              Crear Admins
            </TabsTrigger>
            <TabsTrigger value="errors" className="data-[state=active]:bg-purple-600">
              <AlertTriangle className="h-4 w-4 mr-2" />
              Errores
            </TabsTrigger>
            <TabsTrigger value="credentials" className="data-[state=active]:bg-purple-600">
              <Key className="h-4 w-4 mr-2" />
              Credenciales
            </TabsTrigger>
            <TabsTrigger value="database" className="data-[state=active]:bg-purple-600">
              <Database className="h-4 w-4 mr-2" />
              Base de Datos
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="bg-slate-900/50 border-purple-500/30">
                <CardHeader>
                  <CardTitle className="text-purple-300">Sistema</CardTitle>
                  <CardDescription>Estado del sistema</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm">Estado:</span>
                      <span className="text-green-400 font-bold">✅ Operativo</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm">Versión:</span>
                      <span className="font-mono text-xs">v1.0.0</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-slate-900/50 border-purple-500/30">
                <CardHeader>
                  <CardTitle className="text-purple-300">Base de Datos</CardTitle>
                  <CardDescription>Conexión Supabase</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm">Conexión:</span>
                      <span className="text-green-400 font-bold">✅ Activa</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-slate-900/50 border-purple-500/30">
                <CardHeader>
                  <CardTitle className="text-purple-300">Accesos</CardTitle>
                  <CardDescription>Nivel de permisos</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm">Nivel:</span>
                      <span className="text-purple-400 font-bold">SUPERADMIN</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="users" className="space-y-4">
            <Card className="bg-slate-900/50 border-purple-500/30">
              <CardHeader>
                <CardTitle className="text-purple-300">Crear Admin General</CardTitle>
                <CardDescription>
                  Crea nuevos usuarios con rol de administrador general
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="admin-email">Email del Admin</Label>
                  <Input
                    id="admin-email"
                    type="email"
                    placeholder="admin@limacafe28.com"
                    value={newAdminEmail}
                    onChange={(e) => setNewAdminEmail(e.target.value)}
                    className="bg-slate-800 border-purple-500/30"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="admin-password">Contraseña</Label>
                  <Input
                    id="admin-password"
                    type="password"
                    placeholder="Mínimo 6 caracteres"
                    value={newAdminPassword}
                    onChange={(e) => setNewAdminPassword(e.target.value)}
                    className="bg-slate-800 border-purple-500/30"
                  />
                </div>

                <Button 
                  onClick={handleCreateAdminGeneral}
                  disabled={creatingAdmin}
                  className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                >
                  {creatingAdmin ? (
                    <>Creando Admin...</>
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4 mr-2" />
                      Crear Admin General
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="errors" className="space-y-4">
            <Card className="bg-slate-900/50 border-purple-500/30">
              <CardHeader>
                <CardTitle className="text-purple-300">Logs de Errores</CardTitle>
                <CardDescription>Monitoreo de errores del sistema</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="bg-slate-800 rounded-lg p-4 font-mono text-xs">
                  <p className="text-green-400">✅ No hay errores críticos registrados</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="credentials" className="space-y-4">
            <Card className="bg-slate-900/50 border-purple-500/30">
              <CardHeader>
                <CardTitle className="text-purple-300">Credenciales</CardTitle>
                <CardDescription>Configuración de servicios</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-slate-800 rounded-lg p-4">
                  <Label>Supabase URL</Label>
                  <Input 
                    value={import.meta.env.VITE_SUPABASE_URL || 'No configurado'} 
                    readOnly 
                    className="mt-2 bg-slate-900 font-mono text-xs"
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="database" className="space-y-4">
            <Card className="bg-slate-900/50 border-purple-500/30">
              <CardHeader>
                <CardTitle className="text-purple-300">Gestión de Base de Datos</CardTitle>
              </CardHeader>
              <CardContent>
                <Button 
                  variant="outline" 
                  className="w-full justify-start border-purple-500/30"
                  onClick={() => window.open('https://supabase.com', '_blank')}
                >
                  <Database className="h-4 w-4 mr-2" />
                  Abrir Supabase Dashboard
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default SuperAdmin;

