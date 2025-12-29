import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, GraduationCap, ShieldAlert } from 'lucide-react';

const authSchema = z.object({
  email: z.string().trim().email({ message: 'Email inválido' }).max(255, { message: 'Email muy largo' }),
  password: z.string().min(6, { message: 'La contraseña debe tener al menos 6 caracteres' }).max(72, { message: 'Contraseña muy larga' }),
});

type AuthFormValues = z.infer<typeof authSchema>;

export default function Auth() {
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('login');
  const [userType, setUserType] = useState<'parent' | 'staff'>('parent');
  const [justLoggedIn, setJustLoggedIn] = useState(false);
  const { signIn, signUp, user, loading, signOut } = useAuth();
  const { role, loading: roleLoading, isParent, isStaff, getDefaultRoute } = useRole();
  const navigate = useNavigate();
  const { toast } = useToast();

  const form = useForm<AuthFormValues>({
    resolver: zodResolver(authSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  // Redirigir si ya estaba autenticado (no recién logueado)
  useEffect(() => {
    if (!loading && !roleLoading && user && role && !justLoggedIn) {
      navigate(getDefaultRoute(), { replace: true });
    }
  }, [user, loading, roleLoading, role, navigate, getDefaultRoute, justLoggedIn]);

  // Validar después del login
  useEffect(() => {
    if (justLoggedIn && !roleLoading && role) {
      // Validar que el tipo seleccionado coincida con el rol
      if (userType === 'parent') {
        // Usuario seleccionó "Padre de Familia"
        if (!isParent) {
          // Pero su rol es staff
          toast({
            variant: 'destructive',
            title: '⛔ Acceso Denegado',
            description: 'No tienes acceso como Padre de Familia. Tu cuenta es de Personal Administrativo. Por favor, selecciona "Personal Administrativo" e intenta de nuevo.',
            duration: 6000,
          });
          signOut();
          setIsLoading(false);
          setJustLoggedIn(false);
          return;
        }
      } else {
        // Usuario seleccionó "Personal Administrativo"
        if (!isStaff) {
          // Pero su rol es parent
          toast({
            variant: 'destructive',
            title: '⛔ Acceso Denegado',
            description: 'No tienes acceso administrativo. Tu cuenta es de Padre de Familia. Por favor, selecciona "Padre de Familia" e intenta de nuevo.',
            duration: 6000,
          });
          signOut();
          setIsLoading(false);
          setJustLoggedIn(false);
          return;
        }
      }

      // Si llegamos aquí, la validación fue exitosa
      toast({
        title: '✅ Bienvenido',
        description: 'Has iniciado sesión correctamente.',
      });
      navigate(getDefaultRoute(), { replace: true });
      setIsLoading(false);
      setJustLoggedIn(false);
    }
  }, [justLoggedIn, roleLoading, role, userType, isParent, isStaff, getDefaultRoute, navigate, signOut, toast]);

  const onSubmit = async (values: AuthFormValues) => {
    if (activeTab === 'login') {
      setIsLoading(true);
      try {
        const { error } = await signIn(values.email, values.password);
        if (error) {
          let message = 'Error al iniciar sesión';
          if (error.message.includes('Invalid login credentials')) {
            message = 'Credenciales inválidas. Verifica tu email y contraseña.';
          } else if (error.message.includes('Email not confirmed')) {
            message = 'Por favor confirma tu email antes de iniciar sesión.';
          }
          toast({
            variant: 'destructive',
            title: 'Error',
            description: message,
          });
          setIsLoading(false);
        } else {
          // Login exitoso, marcar para validación
          setJustLoggedIn(true);
          // El useEffect se encargará de validar y redirigir
        }
      } catch (err) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Error inesperado al iniciar sesión',
        });
        setIsLoading(false);
      }
    } else {
      setIsLoading(true);
      try {
        const { error } = await signUp(values.email, values.password);
        if (error) {
          let message = 'Error al crear la cuenta';
          if (error.message.includes('User already registered')) {
            message = 'Este email ya está registrado. Intenta iniciar sesión.';
          } else if (error.message.includes('Password')) {
            message = 'La contraseña no cumple con los requisitos de seguridad.';
          } else {
            message = error.message;
          }
          toast({
            variant: 'destructive',
            title: 'Error de Registro',
            description: message,
          });
        } else {
          toast({
            title: 'Cuenta creada',
            description: 'Revisa tu email para confirmar tu cuenta.',
          });
          form.reset();
          setActiveTab('login');
        }
      } finally {
        setIsLoading(false);
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-secondary/30 to-background p-4">
      <Card className="w-full max-w-md shadow-lg border-border/50">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center">
            <GraduationCap className="h-8 w-8 text-primary" />
          </div>
          <div>
            <CardTitle className="text-2xl font-semibold">Portal de Padres</CardTitle>
            <CardDescription className="mt-2">
              Gestiona el kiosco escolar de tus hijos
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="login">Iniciar Sesión</TabsTrigger>
              <TabsTrigger value="register">Registrarse</TabsTrigger>
            </TabsList>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <TabsContent value="login" className="space-y-4 mt-0">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder="tu@email.com"
                            autoComplete="email"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contraseña</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder="••••••••"
                            autoComplete="current-password"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  {/* Selector de Tipo de Usuario */}
                  <div className="space-y-3 pt-2">
                    <Label className="font-semibold">Ingresar como:</Label>
                    <RadioGroup value={userType} onValueChange={(value: 'parent' | 'staff') => setUserType(value)} className="grid grid-cols-1 gap-3">
                      <Label htmlFor="parent-type" className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground [&:has([data-state=checked])]:border-primary cursor-pointer">
                        <RadioGroupItem value="parent" id="parent-type" className="sr-only" />
                        <div className="flex items-center space-x-2 w-full">
                          <GraduationCap className="h-5 w-5 text-primary" />
                          <span className="font-medium">Padre de Familia</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1 w-full text-left">Ver mis hijos y saldos</p>
                      </Label>
                      <Label htmlFor="staff-type" className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground [&:has([data-state=checked])]:border-primary cursor-pointer">
                        <RadioGroupItem value="staff" id="staff-type" className="sr-only" />
                        <div className="flex items-center space-x-2 w-full">
                          <ShieldAlert className="h-5 w-5 text-primary" />
                          <span className="font-medium">Personal Administrativo</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1 w-full text-left">Acceso a admin, POS, cocina</p>
                      </Label>
                    </RadioGroup>
                  </div>

                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Iniciando sesión...
                      </>
                    ) : (
                      'Iniciar Sesión'
                    )}
                  </Button>
                </TabsContent>

                <TabsContent value="register" className="space-y-4 mt-0">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder="tu@email.com"
                            autoComplete="email"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contraseña</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder="Mínimo 6 caracteres"
                            autoComplete="new-password"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creando cuenta...
                      </>
                    ) : (
                      'Crear Cuenta'
                    )}
                  </Button>
                </TabsContent>
              </form>
            </Form>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
