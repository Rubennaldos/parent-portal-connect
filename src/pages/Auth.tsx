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
import { useToast } from '@/hooks/use-toast';
import { Loader2, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import SplashScreen from '@/components/SplashScreen';
import limaCafeLogo from '@/assets/lima-cafe-logo.png';
import { APP_CONFIG } from '@/config/app.config';

const loginSchema = z.object({
  email: z.string().trim().email({ message: 'Email inválido' }),
  password: z.string().min(6, { message: 'Mínimo 6 caracteres' }),
});

const registerSchema = z.object({
  email: z.string().trim().email({ message: 'Email inválido' }),
  password: z.string().min(6, { message: 'Mínimo 6 caracteres' }),
  confirmPassword: z.string().min(6, { message: 'Mínimo 6 caracteres' }),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Las contraseñas no coinciden",
  path: ["confirmPassword"],
});

type LoginFormValues = z.infer<typeof loginSchema>;
type RegisterFormValues = z.infer<typeof registerSchema>;

export default function Auth() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { signIn, signUp, user, loading: authLoading } = useAuth();
  const { role, loading: roleLoading, getDefaultRoute } = useRole();

  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [isRegisterMode, setIsRegisterMode] = useState(false);

  useEffect(() => {
    if (!authLoading && !roleLoading && user && role) {
      navigate(getDefaultRoute(), { replace: true });
    }
  }, [user, role, authLoading, roleLoading, navigate, getDefaultRoute]);

  const loginForm = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const registerForm = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: '', password: '', confirmPassword: '' },
  });

  const onLoginSubmit = async (values: LoginFormValues) => {
    setIsLoading(true);
    try {
      const { error } = await signIn(values.email, values.password);
      if (error) {
        if (error.message.includes('Email not confirmed')) {
          toast({
            variant: 'destructive',
            title: 'Email no confirmado',
            description: 'Por favor, confirma tu email desde el enlace que te enviamos.',
          });
        } else if (error.message.includes('Invalid login credentials')) {
          toast({
            variant: 'destructive',
            title: 'Credenciales inválidas',
            description: 'El correo o la contraseña son incorrectos.',
          });
        } else {
          throw error;
        }
      }
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err.message || 'Ocurrió un error al iniciar sesión.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const onRegisterSubmit = async (values: RegisterFormValues) => {
    setIsLoading(true);
    try {
      const { data, error } = await signUp(values.email, values.password);
      if (error) throw error;

      if (data.user && !data.session) {
        toast({
          title: '📧 Revisa tu correo',
          description: 'Te hemos enviado un link para confirmar tu cuenta.',
          duration: 10000,
        });
        setIsRegisterMode(false);
      } else {
        toast({ 
          title: '✅ Cuenta creada', 
          description: 'Bienvenido al portal. Serás redirigido en un momento...' 
        });
      }
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Error al registrarse',
        description: err.message || 'No se pudo crear la cuenta.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (showSplash) return <SplashScreen onComplete={() => setShowSplash(false)} />;
  
  if (authLoading || roleLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-brand-cream/20">
        <Loader2 className="h-12 w-12 text-brand-teal animate-spin mb-4" />
        <p className="text-brand-teal font-semibold animate-pulse">Iniciando sesión segura...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-brand-cream via-background to-brand-teal-light">
      <header className="w-full pt-12 pb-0 px-4 flex justify-center">
        <img src={limaCafeLogo} alt="Logo" className="h-24 w-auto object-contain mix-blend-multiply" />
      </header>

      <main className="flex-1 flex items-start justify-center p-4 pt-2 pb-12">
        <Card className="w-full max-w-md shadow-2xl border-border/30 bg-card/95 backdrop-blur-sm overflow-hidden border-t-4 border-t-brand-teal rounded-2xl">
          <CardHeader className="text-center space-y-2 pb-4">
            <div className="flex justify-center mb-2">
              <div className="bg-brand-teal/10 p-3 rounded-full">
                <ShieldCheck className="h-8 w-8 text-brand-teal" />
              </div>
            </div>
            <CardTitle className="text-2xl font-bold text-foreground">
              {isRegisterMode ? 'Crear Cuenta' : 'Portal de Acceso'}
            </CardTitle>
            <CardDescription className="text-muted-foreground font-medium">
              {isRegisterMode 
                ? 'Regístrate para gestionar los consumos de tus hijos' 
                : 'Sistema de Gestión Lima Café 28'}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {!isRegisterMode ? (
              <Form {...loginForm}>
                <form onSubmit={loginForm.handleSubmit(onLoginSubmit)} className="space-y-4">
                  <FormField
                    control={loginForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-semibold text-sm text-gray-700">Correo Electrónico</FormLabel>
                        <FormControl><Input placeholder="tu@email.com" {...field} className="h-12 border-2 focus:border-brand-teal" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={loginForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex justify-between items-center">
                          <FormLabel className="font-semibold text-sm text-gray-700">Contraseña</FormLabel>
                          <button type="button" onClick={() => navigate('/auth?type=recovery')} className="text-xs text-primary hover:underline font-medium">¿Olvidaste tu clave?</button>
                        </div>
                        <FormControl>
                          <div className="relative">
                            <Input type={showPassword ? "text" : "password"} {...field} className="h-12 pr-10 border-2 focus:border-brand-teal" />
                            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-3 text-gray-400 hover:text-gray-600">
                              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                            </button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full h-14 text-base font-bold bg-brand-teal hover:bg-brand-teal/90 text-white shadow-lg transition-all rounded-xl" disabled={isLoading}>
                    {isLoading ? <Loader2 className="animate-spin" /> : 'Iniciar Sesión'}
                  </Button>
                </form>
              </Form>
            ) : (
              <Form {...registerForm}>
                <form onSubmit={registerForm.handleSubmit(onRegisterSubmit)} className="space-y-4">
                  <FormField
                    control={registerForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-semibold text-sm text-gray-700">Correo Electrónico</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="tu@email.com" 
                            type="email"
                            autoComplete="email"
                            {...field} 
                            className="h-12 border-2 focus:border-brand-teal" 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={registerForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-semibold text-sm text-gray-700">Contraseña</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input 
                              type={showPassword ? "text" : "password"} 
                              autoComplete="new-password"
                              {...field} 
                              className="h-12 pr-10 border-2 focus:border-brand-teal" 
                            />
                            <button 
                              type="button" 
                              onClick={() => setShowPassword(!showPassword)} 
                              className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
                              tabIndex={-1}
                            >
                              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                            </button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={registerForm.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-semibold text-sm text-gray-700">Confirmar Contraseña</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input type={showConfirmPassword ? "text" : "password"} {...field} className="h-12 pr-10 border-2 focus:border-brand-teal" />
                            <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-3 text-gray-400 hover:text-gray-600">
                              {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                            </button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full h-14 text-base font-bold bg-brand-teal hover:bg-brand-teal/90 text-white shadow-lg transition-all rounded-xl" disabled={isLoading}>
                    {isLoading ? <Loader2 className="animate-spin" /> : 'Crear Mi Cuenta'}
                  </Button>
                </form>
              </Form>
            )}

            <div className="mt-6 text-center">
              <button 
                onClick={() => setIsRegisterMode(!isRegisterMode)}
                className="text-sm font-semibold text-gray-600 hover:text-brand-teal transition-colors"
              >
                {isRegisterMode ? '¿Ya tienes cuenta? Ingresa aquí' : '¿No tienes cuenta? Regístrate aquí'}
              </button>
            </div>
          </CardContent>
        </Card>
      </main>

      <footer className="py-8 text-center space-y-2">
        <p className="text-sm md:text-base font-medium text-muted-foreground px-4">
          © 2026 ERP Profesional diseñado por <span className="text-primary font-bold">ARQUISIA Soluciones</span> para <span className="text-foreground font-bold">Lima Café 28</span>
        </p>
        <p className="text-xs text-muted-foreground/70 font-medium">
          Versión {APP_CONFIG.version} • {APP_CONFIG.status}
        </p>
      </footer>
    </div>
  );
}
