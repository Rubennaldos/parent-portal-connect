import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useRole } from '@/hooks/useRole';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Settings, LogOut, BarChart3, ArrowLeft } from 'lucide-react';

const Admin = () => {
  const navigate = useNavigate();
  const { signOut, user } = useAuth();
  const { role, isStaff, isParent } = useRole();

  const handleLogout = async () => {
    await signOut();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-blue-50 dark:via-blue-950/20 to-background">
      <header className="bg-background/80 backdrop-blur-sm border-b sticky top-0 z-10">
        <div className="bg-blue-100 dark:bg-blue-900/20 border-b border-blue-300 dark:border-blue-700 px-4 py-1">
          <p className="text-xs font-mono text-blue-800 dark:text-blue-300 text-center">
            🔍 DEBUG ROL: <strong>{role || 'null'}</strong> | isStaff: {isStaff ? '✅' : '❌'} | isParent: {isParent ? '✅' : '❌'}
          </p>
        </div>

        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/dashboard')}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Volver
            </Button>
            <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center">
              <Settings className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h1 className="font-semibold">Panel de Administración</h1>
              <p className="text-xs text-muted-foreground">Admin General</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">{user?.email}</span>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-2" />
              Salir
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Dashboard Administrativo
            </CardTitle>
            <CardDescription>
              Gestión y control del sistema
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Panel de administración en construcción...
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default Admin;


