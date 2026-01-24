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
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import SplashScreen from '@/components/SplashScreen';
import limaCafeLogo from '@/assets/lima-cafe-logo.png';
import { supabase } from '@/lib/supabase';
import { Separator } from '@/components/ui/separator';
import { APP_CONFIG } from '@/config/app.config';

const authSchema = z.object({
  email: z.string().trim().email({ message: 'Email inválido' }),
  password: z.string().min(6, { message: 'La contraseña debe tener al menos 6 caracteres' }),
});

type AuthFormValues = z.infer<typeof authSchema>;

export default function Auth() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { signIn, user, loading: authLoading } = useAuth();
  const { role, loading: roleLoading, getDefaultRoute } = useRole();

  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [isRegisterMode, setIsRegisterMode] = useState(false);

  useEffect(() => {
    if (!authLoading && !roleLoading && user && role) {
      navigate(getDefaultRoute(), { replace: true });
    }
  }, [user, role, authLoading, roleLoading, navigate, getDefaultRoute]);

  const form = useForm<AuthFormValues>({
    resolver: zodResolver(authSchema),
    defaultValues: { email: '', password: '' },
  });

  const handleSocialLogin = async (provider: 'google' | 'azure') => {
    try {
      setIsLoading(true);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: provider,
        options: {
          redirectTo: `${window.location.origin}/`,
          queryParams: { prompt: 'select_account' }
        },
      });
      if (error) throw error;
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
      setIsLoading(false);
    }
  };

  const onSubmit = async (values: AuthFormValues) => {
    setIsLoading(true);
    const { error } = await signIn(values.email, values.password);
    if (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'Credenciales inválidas' });
      setIsLoading(false);
    }
  };

  if (showSplash) return <SplashScreen onComplete={() => setShowSplash(false)} />;
  
  if (authLoading || roleLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-brand-cream/20">
        <Loader2 className="h-12 w-12 text-brand-teal animate-spin mb-4" />
        <p className="text-brand-teal font-black animate-pulse uppercase tracking-widest">Iniciando sesión segura...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-brand-cream via-background to-brand-teal-light font-sans">
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
            <CardTitle className="text-2xl font-black text-foreground uppercase tracking-tight">
              {isRegisterMode ? 'Crear Cuenta' : 'Portal de Acceso'}
            </CardTitle>
            <CardDescription className="text-muted-foreground font-bold">
              {isRegisterMode 
                ? 'Regístrate para gestionar los consumos de tus hijos' 
                : 'Sistema de Gestión Lima Café 28'}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            <div className="space-y-3">
              <Button 
                variant="outline" 
                className="w-full h-14 text-lg font-black shadow-lg hover:border-blue-500 transition-all border-2 bg-white active:scale-95"
                onClick={() => handleSocialLogin('google')}
                disabled={isLoading}
              >
                <svg className="mr-3 h-6 w-6" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                {isRegisterMode ? 'REGISTRARME CON GOOGLE' : 'CONTINUAR CON GOOGLE'}
              </Button>

              <Button 
                variant="outline" 
                className="w-full h-14 text-lg font-black shadow-md opacity-50 cursor-not-allowed border-2 bg-white"
                disabled={true}
              >
                <svg className="mr-3 h-6 w-6" viewBox="0 0 24 24">
                  <path fill="#f25022" d="M0 0h11.377v11.372H0z"/><path fill="#00a4ef" d="M12.623 0H24v11.372H12.623z"/><path fill="#7fba00" d="M0 12.628h11.377V24H0z"/><path fill="#ffb900" d="M12.623 12.628H24V24H12.623z"/>
                </svg>
                MICROSOFT (Próximamente)
              </Button>

              <div className="relative my-8">
                <Separator className="bg-gray-200" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="bg-card px-4 text-[10px] text-muted-foreground font-black uppercase tracking-[0.2em]">o usa tu correo</span>
                </div>
              </div>

              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-black text-xs uppercase tracking-wider text-gray-500 ml-1">Correo Electrónico</FormLabel>
                        <FormControl><Input placeholder="tu@email.com" {...field} className="h-12 border-2 focus:border-brand-teal font-medium" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex justify-between items-center">
                          <FormLabel className="font-black text-xs uppercase tracking-wider text-gray-500 ml-1">Contraseña</FormLabel>
                          {!isRegisterMode && (
                            <button type="button" onClick={() => navigate('/auth?type=recovery')} className="text-[10px] text-primary hover:underline font-black uppercase tracking-tighter">¿Olvidaste tu clave?</button>
                          )}
                        </div>
                        <FormControl>
                          <div className="relative">
                            <Input type={showPassword ? "text" : "password"} {...field} className="h-12 pr-10 border-2 focus:border-brand-teal font-medium" />
                            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-3 text-gray-400">
                              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                            </button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full h-14 text-lg font-black bg-brand-teal hover:bg-brand-teal/90 text-white shadow-xl active:scale-95 transition-all rounded-xl" disabled={isLoading}>
                    {isLoading ? <Loader2 className="animate-spin" /> : (isRegisterMode ? 'CREAR MI CUENTA' : 'INICIAR SESIÓN')}
                  </Button>
                </form>
              </Form>

              <div className="mt-6 text-center">
                <button 
                  onClick={() => setIsRegisterMode(!isRegisterMode)}
                  className="text-xs font-black text-gray-500 hover:text-brand-teal transition-colors uppercase tracking-widest border-b-2 border-transparent hover:border-brand-teal pb-1"
                >
                  {isRegisterMode ? '¿Ya tienes cuenta? Ingresa aquí' : '¿No tienes cuenta? Regístrate aquí'}
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Footer Pro Elegante */}
      <footer className="py-8 text-center space-y-2">
        <p className="text-sm md:text-base font-medium text-muted-foreground px-4">
          © 2026 ERP Profesional diseñado por <span className="text-primary font-black">ARQUISIA Soluciones</span> para <span className="text-foreground font-black">Lima Café 28</span> — 
          <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground font-black ml-1">
            Versión {APP_CONFIG.version}
          </span>
        </p>
      </footer>
    </div>
  );
}
