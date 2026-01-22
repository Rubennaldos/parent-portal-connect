import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import SplashScreen from '@/components/SplashScreen';
import limaCafeLogo from '@/assets/lima-cafe-logo.png';
import { supabase } from '@/lib/supabase';
import { Separator } from '@/components/ui/separator';
import { APP_CONFIG } from '@/config/app.config';

const authSchema = z.object({
  email: z.string().trim().email({ message: 'Email inválido' }).max(255, { message: 'Email muy largo' }),
  password: z.string().min(6, { message: 'La contraseña debe tener al menos 6 caracteres' }).max(72, { message: 'Contraseña muy larga' }),
  confirmPassword: z.string().optional(),
}).refine((data) => {
  // Si confirmPassword tiene valor, debe coincidir con password
  if (data.confirmPassword) {
    return data.password === data.confirmPassword;
  }
  return true;
}, {
  message: 'Las contraseñas no coinciden',
  path: ['confirmPassword'],
});

type AuthFormValues = z.infer<typeof authSchema>;

export default function Auth() {
  const location = useLocation();
  
  // Detectar modo recovery INMEDIATAMENTE antes de cualquier render
  const hash = window.location.hash;
  const params = new URLSearchParams(window.location.search);
  const isRecoveryDetected = hash.includes('type=recovery') || params.get('type') === 'recovery';
  
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [justLoggedIn, setJustLoggedIn] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [isResetMode, setIsResetMode] = useState(isRecoveryDetected);
  const { signIn, user, loading } = useAuth();
  const { role, loading: roleLoading, getDefaultRoute } = useRole();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Detectar modo recuperación desde la URL o el hash
  useEffect(() => {
    const hash = window.location.hash;
    const params = new URLSearchParams(window.location.search);
    
    // El hash puede contener parámetros después del # (como en GitHub Pages)
    // Ejemplo: #access_token=...&type=recovery
    const hashParams = new URLSearchParams(hash.substring(hash.indexOf('?') > -1 ? hash.indexOf('?') : hash.indexOf('&') > -1 ? hash.indexOf('&') - 1 : 0));
    
    if (hash.includes('type=recovery') || params.get('type') === 'recovery') {
      console.log('🔐 Modo recuperación de contraseña detectado');
      setIsResetMode(true);
    }
  }, []);

  const isOAuthCallback = window.location.hash.includes('access_token');
  
  // DEBUG: Log inicial para verificar que el código nuevo se está ejecutando
  console.log(`🔍 Auth.tsx - VERSION: ${APP_CONFIG.fullVersion}`);
  console.log('🔍 Auth.tsx - URL completa:', window.location.href);
  console.log('🔍 Auth.tsx - Hash:', window.location.hash);
  console.log('🔍 Auth.tsx - isOAuthCallback:', isOAuthCallback);
  console.log('🔍 Auth.tsx - user:', user);
  console.log('🔍 Auth.tsx - role:', role);

  const form = useForm<AuthFormValues>({
    resolver: zodResolver(authSchema),
    defaultValues: {
      email: location.state?.email || '', // Pre-llenar email si viene del modal
      password: '',
    },
  });

  // Redirigir si ya estaba autenticado (incluyendo OAuth)
  useEffect(() => {
    // PRIORIDAD MÁXIMA: Si estamos en modo recovery, NO redirigir NUNCA
    if (isResetMode) {
      console.log('🔐 Modo recovery activo - BLOQUEANDO toda redirección');
      return;
    }
    
    if (!loading && !roleLoading && user && role) {
      // Si viene desde OAuth, redirigir inmediatamente
      if (isOAuthCallback && !isResetMode) {
        console.log('OAuth callback detected, redirecting to:', getDefaultRoute());
        navigate(getDefaultRoute(), { replace: true });
        return;
      }
      
      // Si el usuario está autenticado y no está en proceso de login manual
      if (!justLoggedIn && !isResetMode) {
        navigate(getDefaultRoute(), { replace: true });
      }
    }
  }, [user, loading, roleLoading, role, navigate, getDefaultRoute, justLoggedIn, isOAuthCallback, isResetMode]);

  // Validar después del login
  useEffect(() => {
    // NO redirigir si estamos en modo recovery
    if (isResetMode) {
      return;
    }
    
    if (justLoggedIn && !roleLoading && role) {
      // Login exitoso -> redirigir automáticamente según el rol real en `profiles.role`
      toast({
        title: 'Bienvenido',
        description: 'Has iniciado sesión correctamente.',
      });
      navigate(getDefaultRoute(), { replace: true });
      setIsLoading(false);
      setJustLoggedIn(false);
    }
  }, [justLoggedIn, roleLoading, role, getDefaultRoute, navigate, toast, isResetMode]);

  const handleSocialLogin = async (provider: 'google' | 'azure') => {
    // ... (código existente)
  };

  const handleForgotPassword = async () => {
    const email = form.getValues('email');
    if (!email) {
      toast({
        variant: 'destructive',
        title: 'Email requerido',
        description: 'Por favor, ingresa tu email para recuperar la contraseña.',
      });
      return;
    }

    setIsLoading(true);
    try {
      // Usar URL con hash para GitHub Pages
      const redirectTo = `${window.location.origin}${window.location.pathname}#/auth?type=recovery`;
      
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirectTo,
      });

      if (error) throw error;

      toast({
        title: 'Correo enviado',
        description: 'Revisa tu bandeja de entrada para restablecer tu contraseña.',
      });
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err.message || 'No se pudo enviar el correo de recuperación.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdatePassword = async () => {
    const password = form.getValues('password');
    const confirmPassword = form.getValues('confirmPassword');
    
    if (password.length < 6) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'La contraseña debe tener al menos 6 caracteres.',
      });
      return;
    }
    
    if (password !== confirmPassword) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Las contraseñas no coinciden.',
      });
      return;
    }

    setIsLoading(true);
    try {
      // Verificar que tengamos una sesión activa
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError || !session) {
        throw new Error('La sesión ha expirado. Por favor, solicita un nuevo correo de recuperación.');
      }

      const { error } = await supabase.auth.updateUser({
        password: password,
      });

      if (error) throw error;

      // Cerrar sesión después de cambiar la contraseña
      await supabase.auth.signOut();

      toast({
        title: '✅ Contraseña actualizada',
        description: 'Ya puedes iniciar sesión con tu nueva contraseña.',
      });
      
      // Limpiar URL y volver al login
      setIsResetMode(false);
      window.location.href = window.location.origin + '/parent-portal-connect/#/auth';
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err.message || 'No se pudo actualizar la contraseña.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const onSubmit = async (values: AuthFormValues) => {
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
  };

  // Splash Screen
  if (showSplash) {
    return <SplashScreen onComplete={() => setShowSplash(false)} />;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-brand-cream via-background to-brand-teal-light">
      {/* Header con logo */}
      <header className="w-full pt-12 pb-0 px-4 flex justify-center">
        <img 
          src={limaCafeLogo} 
          alt="Lima Café 28" 
          className="h-24 w-auto object-contain mix-blend-multiply"
        />
      </header>

      {/* Contenido principal */}
      <main className="flex-1 flex items-start justify-center p-4 pt-2 pb-12">
        <Card className="w-full max-w-md shadow-xl border-border/30 bg-card/95 backdrop-blur-sm">
          <CardHeader className="text-center space-y-2 pb-4">
            <CardTitle className="text-2xl font-semibold text-foreground">
              {isResetMode ? 'Nueva Contraseña' : 'Portal de Acceso'}
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              {isResetMode 
                ? 'Escribe tu nueva contraseña de acceso' 
                : 'Sistema de Gestión Lima Café 28'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Botones de Login Social - Solo mostrar si NO estamos en reset mode */}
            {!isResetMode && (
              <div className="space-y-3 mb-6">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => handleSocialLogin('google')}
                  disabled={isLoading}
                >
                  <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="currentColor"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  Continuar con Google
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={true}
                >
                  <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M11.4 24H0V12.6L11.4 0v24zM24 24H12.6V12.6L24 0v24z"
                    />
                  </svg>
                  Continuar con Microsoft (Próximamente)
                </Button>

                <div className="relative my-6">
                  <Separator />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="bg-card px-2 text-xs text-muted-foreground">
                      O continúa con email
                    </span>
                  </div>
                </div>
              </div>
            )}

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                {!isResetMode && (
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-foreground">Email</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder="correo@ejemplo.com"
                            autoComplete="email"
                            className="bg-background/50 border-border focus:border-primary"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel className="text-foreground">
                          {isResetMode ? 'Nueva Contraseña' : 'Contraseña'}
                        </FormLabel>
                        {!isResetMode && (
                          <button
                            type="button"
                            onClick={handleForgotPassword}
                            className="text-xs text-primary hover:underline font-medium"
                            disabled={isLoading}
                          >
                            ¿Olvidaste tu contraseña?
                          </button>
                        )}
                      </div>
                      <FormControl>
                        <div className="relative">
                          <Input
                            type={showPassword ? "text" : "password"}
                            placeholder="••••••••"
                            autoComplete="current-password"
                            className="bg-background/50 border-border focus:border-primary pr-10"
                            {...field}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {showPassword ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                {isResetMode && (
                  <FormField
                    control={form.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-foreground">Confirmar Contraseña</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input
                              type={showConfirmPassword ? "text" : "password"}
                              placeholder="Confirma tu contraseña"
                              autoComplete="new-password"
                              className="bg-background/50 border-border focus:border-primary pr-10"
                              {...field}
                            />
                            <button
                              type="button"
                              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                            >
                              {showConfirmPassword ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                
                <Button 
                  type={isResetMode ? "button" : "submit"}
                  onClick={isResetMode ? handleUpdatePassword : undefined}
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium" 
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {isResetMode ? 'Actualizando...' : 'Iniciando sesión...'}
                    </>
                  ) : (
                    isResetMode ? 'Cambiar Contraseña' : 'Iniciar Sesión'
                  )}
                </Button>
                
                {isResetMode && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full text-xs text-muted-foreground"
                    onClick={() => setIsResetMode(false)}
                  >
                    Volver al inicio de sesión
                  </Button>
                )}
              </form>
            </Form>
          </CardContent>
        </Card>
      </main>

      {/* Footer sutil */}
      <footer className="py-8 text-center space-y-2">
        <p className="text-sm md:text-base font-medium text-muted-foreground px-4">
          © 2026 ERP Profesional diseñado por <span className="text-primary/90 font-bold">{APP_CONFIG.designedBy}</span> para <span className="text-foreground/80 font-black">{APP_CONFIG.appName}</span> — 
          <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground/70 font-bold ml-1">
            Versión {APP_CONFIG.version} {APP_CONFIG.status}
          </span>
        </p>
      </footer>
    </div>
  );
}
