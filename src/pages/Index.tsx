import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { GraduationCap, LogOut, Users, Wallet, History, Settings } from 'lucide-react';

const Index = () => {
  const { user, signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-secondary/20 to-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
              <GraduationCap className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="font-semibold text-foreground">Portal de Padres</h1>
              <p className="text-xs text-muted-foreground">Kiosco Escolar</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground hidden sm:block">
              {user?.email}
            </span>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              <LogOut className="h-4 w-4 mr-2" />
              Salir
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-semibold text-foreground">Bienvenido</h2>
          <p className="text-muted-foreground mt-1">Gestiona las cuentas del kiosco de tus hijos</p>
        </div>

        {/* Quick Actions Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <Card className="hover:shadow-md transition-shadow cursor-pointer border-border/50">
            <CardHeader className="pb-2">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center mb-2">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <CardTitle className="text-lg">Mis Hijos</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>Administra los perfiles de tus estudiantes</CardDescription>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-shadow cursor-pointer border-border/50">
            <CardHeader className="pb-2">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center mb-2">
                <Wallet className="h-5 w-5 text-primary" />
              </div>
              <CardTitle className="text-lg">Saldos</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>Ver saldos y realizar recargas</CardDescription>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-shadow cursor-pointer border-border/50">
            <CardHeader className="pb-2">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center mb-2">
                <History className="h-5 w-5 text-primary" />
              </div>
              <CardTitle className="text-lg">Historial</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>Revisa las compras realizadas</CardDescription>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-shadow cursor-pointer border-border/50">
            <CardHeader className="pb-2">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center mb-2">
                <Settings className="h-5 w-5 text-primary" />
              </div>
              <CardTitle className="text-lg">Configuración</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>Límites de gasto y restricciones</CardDescription>
            </CardContent>
          </Card>
        </div>

        {/* Empty State */}
        <Card className="border-dashed border-2 border-border/50">
          <CardContent className="py-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">No hay estudiantes registrados</h3>
            <p className="text-muted-foreground mb-4">Comienza agregando a tus hijos para gestionar sus cuentas del kiosco</p>
            <Button>
              Agregar Estudiante
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default Index;
