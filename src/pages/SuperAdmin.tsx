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
  ExternalLink,
  CheckCircle2,
  Circle
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
          title: 'Admin Creado',
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
    <div className="min-h-screen bg-background">
      {/* Debug banner - minimal */}
      <div className="bg-muted border-b px-4 py-1">
        <p className="text-xs font-mono text-muted-foreground text-center">
          DEBUG: role={role || 'null'} | staff={isStaff ? '1' : '0'} | parent={isParent ? '1' : '0'}
        </p>
      </div>

      {/* Header - clean and minimal */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-foreground rounded-lg flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-background" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground tracking-tight">
                SuperAdmin
              </h1>
              <p className="text-xs text-muted-foreground font-mono">system::root</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm text-foreground font-mono">{user?.email}</p>
              <p className="text-xs text-muted-foreground">level: superadmin</p>
            </div>
            <Button 
              onClick={handleLogout} 
              variant="outline" 
              size="sm"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Exit
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-6">
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="bg-muted/50 border">
            <TabsTrigger value="overview" className="data-[state=active]:bg-background">
              <Activity className="h-4 w-4 mr-2" />
              Status
            </TabsTrigger>
            <TabsTrigger value="users" className="data-[state=active]:bg-background">
              <UserPlus className="h-4 w-4 mr-2" />
              Users
            </TabsTrigger>
            <TabsTrigger value="errors" className="data-[state=active]:bg-background">
              <AlertTriangle className="h-4 w-4 mr-2" />
              Logs
            </TabsTrigger>
            <TabsTrigger value="credentials" className="data-[state=active]:bg-background">
              <Key className="h-4 w-4 mr-2" />
              Config
            </TabsTrigger>
            <TabsTrigger value="database" className="data-[state=active]:bg-background">
              <Database className="h-4 w-4 mr-2" />
              Database
            </TabsTrigger>
          </TabsList>

          {/* Status Tab */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">System</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Status</span>
                    <span className="flex items-center gap-1.5 text-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                      Operational
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Version</span>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">v1.0.0</code>
                  </div>
                </CardContent>
              </Card>

              <Card className="border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Database</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Connection</span>
                    <span className="flex items-center gap-1.5 text-foreground">
                      <Circle className="h-2 w-2 fill-green-600 text-green-600" />
                      Active
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Provider</span>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">supabase</code>
                  </div>
                </CardContent>
              </Card>

              <Card className="border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Access</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Level</span>
                    <code className="text-xs bg-foreground text-background px-1.5 py-0.5 rounded font-semibold">ROOT</code>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Permissions</span>
                    <span className="text-foreground">Full</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Users Tab */}
          <TabsContent value="users" className="space-y-4">
            <Card className="border max-w-lg">
              <CardHeader>
                <CardTitle className="text-base">Create Admin</CardTitle>
                <CardDescription>
                  Add a new admin_general user to the system
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="admin-email" className="text-sm">Email</Label>
                  <Input
                    id="admin-email"
                    type="email"
                    placeholder="admin@example.com"
                    value={newAdminEmail}
                    onChange={(e) => setNewAdminEmail(e.target.value)}
                    className="font-mono text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="admin-password" className="text-sm">Password</Label>
                  <Input
                    id="admin-password"
                    type="password"
                    placeholder="min 6 characters"
                    value={newAdminPassword}
                    onChange={(e) => setNewAdminPassword(e.target.value)}
                  />
                </div>

                <Button 
                  onClick={handleCreateAdminGeneral}
                  disabled={creatingAdmin}
                  className="w-full"
                >
                  {creatingAdmin ? 'Creating...' : 'Create Admin'}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Logs Tab */}
          <TabsContent value="errors" className="space-y-4">
            <Card className="border">
              <CardHeader>
                <CardTitle className="text-base">System Logs</CardTitle>
                <CardDescription>Error monitoring and debug output</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="bg-muted rounded-md p-4 font-mono text-xs">
                  <p className="text-muted-foreground">[info] No critical errors logged</p>
                  <p className="text-muted-foreground mt-1">[info] System running normally</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Config Tab */}
          <TabsContent value="credentials" className="space-y-4">
            <Card className="border max-w-lg">
              <CardHeader>
                <CardTitle className="text-base">Configuration</CardTitle>
                <CardDescription>Service endpoints and settings</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Supabase URL</Label>
                  <Input 
                    value={import.meta.env.VITE_SUPABASE_URL || 'Not configured'} 
                    readOnly 
                    className="font-mono text-xs bg-muted"
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Database Tab */}
          <TabsContent value="database" className="space-y-4">
            <Card className="border max-w-lg">
              <CardHeader>
                <CardTitle className="text-base">Database Management</CardTitle>
                <CardDescription>Direct access to database console</CardDescription>
              </CardHeader>
              <CardContent>
                <Button 
                  variant="outline" 
                  className="w-full justify-between"
                  onClick={() => window.open('https://supabase.com', '_blank')}
                >
                  <span className="flex items-center">
                    <Database className="h-4 w-4 mr-2" />
                    Open Supabase Dashboard
                  </span>
                  <ExternalLink className="h-4 w-4" />
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
