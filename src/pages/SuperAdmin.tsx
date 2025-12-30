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
  Circle,
  Users,
  Building2,
  GraduationCap
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { UsersManagement } from '@/components/admin/UsersManagement';
import { ProfilesControl } from '@/components/admin/ProfilesControl';
import StudentsManagement from '@/components/admin/StudentsManagement';

const SuperAdmin = () => {
  const { signOut, user } = useAuth();
  const { role, isStaff, isParent } = useRole();

  const handleLogout = async () => {
    await signOut();
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
            <TabsTrigger value="users-management" className="data-[state=active]:bg-background">
              <Users className="h-4 w-4 mr-2" />
              Usuarios
            </TabsTrigger>
            <TabsTrigger value="profiles-control" className="data-[state=active]:bg-background">
              <Building2 className="h-4 w-4 mr-2" />
              Perfiles por Sede
            </TabsTrigger>
            <TabsTrigger value="students" className="data-[state=active]:bg-background">
              <GraduationCap className="h-4 w-4 mr-2" />
              Estudiantes
            </TabsTrigger>
            <TabsTrigger value="errors" className="data-[state=active]:bg-background">
              <AlertTriangle className="h-4 w-4 mr-2" />
              Logs
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

          {/* Gestión de Usuarios Tab */}
          <TabsContent value="users-management" className="space-y-4">
            <UsersManagement />
          </TabsContent>

          {/* Control de Perfiles por Sede Tab */}
          <TabsContent value="profiles-control" className="space-y-4">
            <ProfilesControl />
          </TabsContent>

          {/* Students Tab */}
          <TabsContent value="students" className="space-y-4">
            <StudentsManagement />
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
