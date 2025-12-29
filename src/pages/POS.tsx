import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ShoppingCart, LogOut } from 'lucide-react';

const POS = () => {
  const { signOut, user } = useAuth();
  const { role, isStaff, isParent } = useRole();

  const handleLogout = async () => {
    await signOut();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-green-50 dark:via-green-950/20 to-background">
      <header className="bg-background/80 backdrop-blur-sm border-b sticky top-0 z-10">
        <div className="bg-green-100 dark:bg-green-900/20 border-b border-green-300 dark:border-green-700 px-4 py-1">
          <p className="text-xs font-mono text-green-800 dark:text-green-300 text-center">
            🔍 DEBUG ROL: <strong>{role || 'null'}</strong> | isStaff: {isStaff ? '✅' : '❌'} | isParent: {isParent ? '✅' : '❌'}
          </p>
        </div>

        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-500/10 rounded-xl flex items-center justify-center">
              <ShoppingCart className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <h1 className="font-semibold">Punto de Venta</h1>
              <p className="text-xs text-muted-foreground">Sistema POS</p>
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
            <CardTitle>Punto de Venta</CardTitle>
            <CardDescription>
              Sistema de cobro del kiosco escolar
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Sistema POS en construcción...
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default POS;

