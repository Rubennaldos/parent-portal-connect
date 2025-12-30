import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChefHat, LogOut } from 'lucide-react';

const Kitchen = () => {
  const { signOut, user } = useAuth();
  const { role, isStaff, isParent } = useRole();

  const handleLogout = async () => {
    await signOut();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-orange-50 dark:via-orange-950/20 to-background">
      <header className="bg-background/80 backdrop-blur-sm border-b sticky top-0 z-10">
        <div className="bg-orange-100 dark:bg-orange-900/20 border-b border-orange-300 dark:border-orange-700 px-4 py-1">
          <p className="text-xs font-mono text-orange-800 dark:text-orange-300 text-center">
            🔍 DEBUG ROL: <strong>{role || 'null'}</strong> | isStaff: {isStaff ? '✅' : '❌'} | isParent: {isParent ? '✅' : '❌'}
          </p>
        </div>

        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-orange-500/10 rounded-xl flex items-center justify-center">
              <ChefHat className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <h1 className="font-semibold">Pantalla de Cocina</h1>
              <p className="text-xs text-muted-foreground">Vista de órdenes</p>
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
            <CardTitle>Pantalla de Cocina</CardTitle>
            <CardDescription>
              Monitor de órdenes en tiempo real
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Sistema de cocina en construcción...
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default Kitchen;


