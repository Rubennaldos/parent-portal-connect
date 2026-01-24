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
import { Loader2, Eye, EyeOff, GraduationCap, CheckCircle2, UserPlus, ArrowRight } from 'lucide-react';
import SplashScreen from '@/components/SplashScreen';
import limaCafeLogo from '@/assets/lima-cafe-logo.png';
import { supabase } from '@/lib/supabase';
import { Separator } from '@/components/ui/separator';
import { APP_CONFIG } from '@/config/app.config';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';

const authSchema = z.object({
  email: z.string().trim().email({ message: 'Email inválido' }).max(255, { message: 'Email muy largo' }),
  password: z.string().min(6, { message: 'La contraseña debe tener al menos 6 caracteres' }).max(72, { message: 'Contraseña muy larga' }),
  confirmPassword: z.string().optional(),
}).refine((data) => {
  if (data.confirmPassword) {
    return data.password === data.confirmPassword;
  }
  return true;
}, {
  message: 'Las contraseñas no coinciden',
  path: ['confirmPassword'],
});

type AuthFormValues = z.infer<typeof authSchema>;

interface School {
  id: string;
  name: string;
  code: string;
}

interface Student {
  id: string;
  full_name: string;
  grade: string;
  section: string;
}

export default function Auth() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { signIn, user, loading: authLoading } = useAuth();
  const { role, loading: roleLoading, getDefaultRoute } = useRole();

  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [isResetMode, setIsResetMode] = useState(false);
  
  // ONBOARDING INLINE
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState<'school' | 'students'>('school');
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [students, setStudents] = useState<Student[]>([
    { id: crypto.randomUUID(), full_name: '', grade: '', section: '' }
  ]);

  useEffect(() => {
    const hash = window.location.hash;
    const params = new URLSearchParams(window.location.search);
    if (hash.includes('type=recovery') || params.get('type') === 'recovery') {
      setIsResetMode(true);
    }
  }, []);

  useEffect(() => {
    if (isOnboarding) {
      const fetchSchools = async () => {
        const { data } = await supabase.from('schools').select('id, name, code').eq('is_active', true).order('name');
        setSchools(data || []);
      };
      fetchSchools();
    }
  }, [isOnboarding]);

  useEffect(() => {
    if (authLoading || roleLoading || isResetMode) return;

    if (user && role) {
      if (role === 'parent') {
        const checkOnboarding = async () => {
          const { data: profile } = await supabase
            .from('parent_profiles')
            .select('onboarding_completed')
            .eq('user_id', user.id)
            .maybeSingle();

          if (profile && !profile.onboarding_completed) {
            setIsOnboarding(true);
            setIsLoading(false);
          } else {
            navigate('/', { replace: true });
          }
        };
        checkOnboarding();
      } else {
        navigate(getDefaultRoute(), { replace: true });
      }
    }
  }, [user, role, authLoading, roleLoading, isResetMode, navigate, getDefaultRoute]);

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
          redirectTo: `${window.location.origin}/auth`,
          queryParams: { prompt: 'select_account' }
        },
      });
      if (error) throw error;
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
      setIsLoading(false);
    }
  };

  const handleSchoolNext = async () => {
    if (!selectedSchoolId || !acceptedTerms) {
      toast({ variant: 'destructive', title: 'Error', description: 'Selecciona sede y acepta términos' });
      return;
    }
    setIsLoading(true);
    try {
      await supabase.from('parent_profiles').update({ school_id: selectedSchoolId }).eq('user_id', user?.id);
      setOnboardingStep('students');
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: 'Error al guardar sede' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleOnboardingFinish = async () => {
    const invalid = students.find(s => !s.full_name || !s.grade || !s.section);
    if (invalid) {
      toast({ variant: 'destructive', title: 'Error', description: 'Completa todos los campos' });
      return;
    }

    setIsLoading(true);
    try {
      const { data: inserted, error: sErr } = await supabase.from('students').insert(
        students.map(s => ({ full_name: s.full_name, grade: s.grade, section: s.section, school_id: selectedSchoolId }))
      ).select();
      
      if (sErr) throw sErr;

      await supabase.from('student_relationships').insert(
        inserted.map(s => ({ parent_id: user?.id, student_id: s.id, relationship_type: 'padre/madre' }))
      );

      await supabase.from('parent_profiles').update({ onboarding_completed: true }).eq('user_id', user?.id);
      
      toast({ title: '¡Bienvenido!', description: 'Registro completado con éxito' });
      navigate('/', { replace: true });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
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

  const handleForgotPassword = async () => {
    const email = form.getValues('email');
    if (!email) {
      toast({ variant: 'destructive', title: 'Email requerido', description: 'Ingresa tu email.' });
      return;
    }
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth?type=recovery` });
      if (error) throw error;
      toast({ title: 'Correo enviado', description: 'Revisa tu bandeja de entrada.' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdatePassword = async () => {
    const password = form.getValues('password');
    const confirmPassword = form.getValues('confirmPassword');
    if (password.length < 6 || password !== confirmPassword) {
      toast({ variant: 'destructive', title: 'Error', description: 'Verifica los datos.' });
      return;
    }
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      await supabase.auth.signOut();
      toast({ title: '✅ Actualizada', description: 'Inicia sesión con tu nueva contraseña.' });
      setIsResetMode(false);
      window.location.href = window.location.origin + '/auth';
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setIsLoading(false);
    }
  };

  if (showSplash) return <SplashScreen onComplete={() => setShowSplash(false)} />;
  if (authLoading && !isOnboarding) return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-brand-cream via-background to-brand-teal-light">
      <header className="w-full pt-12 pb-0 px-4 flex justify-center">
        <img src={limaCafeLogo} alt="Logo" className="h-24 w-auto object-contain mix-blend-multiply" />
      </header>

      <main className="flex-1 flex items-start justify-center p-4 pt-2 pb-12">
        <Card className="w-full max-w-md shadow-xl border-border/30 bg-card/95 backdrop-blur-sm overflow-hidden">
          
          {!isOnboarding && (
            <>
              <CardHeader className="text-center space-y-2 pb-4">
                <CardTitle className="text-2xl font-bold text-foreground">
                  {isResetMode ? 'Nueva Contraseña' : 'Bienvenido'}
                </CardTitle>
                <CardDescription className="text-muted-foreground">
                  {isResetMode ? 'Escribe tu nueva contraseña' : 'Ingresa o crea tu cuenta en segundos'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!isResetMode && (
                  <>
                    <Button 
                      variant="outline" 
                      className="w-full h-14 text-lg font-bold shadow-sm hover:border-blue-500 transition-all border-2"
                      onClick={() => handleSocialLogin('google')}
                      disabled={isLoading}
                    >
                      <svg className="mr-3 h-5 w-5" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                      </svg>
                      Continuar con Google
                    </Button>
                    <div className="relative my-6">
                      <Separator />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="bg-card px-3 text-xs text-muted-foreground font-medium uppercase tracking-wider">o con email</span>
                      </div>
                    </div>
                  </>
                )}

                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    {!isResetMode && (
                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl><Input placeholder="tu@email.com" {...field} className="h-12" /></FormControl>
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
                          <div className="flex justify-between items-center">
                            <FormLabel>{isResetMode ? 'Nueva Contraseña' : 'Contraseña'}</FormLabel>
                            {!isResetMode && (
                              <button type="button" onClick={handleForgotPassword} className="text-xs text-primary hover:underline font-bold" disabled={isLoading}>¿La olvidaste?</button>
                            )}
                          </div>
                          <FormControl>
                            <div className="relative">
                              <Input type={showPassword ? "text" : "password"} {...field} className="h-12 pr-10" />
                              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-4 text-muted-foreground">
                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
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
                            <FormLabel>Confirmar Contraseña</FormLabel>
                            <FormControl><Input type="password" {...field} className="h-12" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                    <Button type={isResetMode ? "button" : "submit"} onClick={isResetMode ? handleUpdatePassword : undefined} className="w-full h-12 text-lg font-bold" disabled={isLoading}>
                      {isLoading ? <Loader2 className="animate-spin" /> : (isResetMode ? 'Cambiar Contraseña' : 'Continuar')}
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </>
          )}

          {isOnboarding && onboardingStep === 'school' && (
            <>
              <CardHeader className="bg-emerald-600 text-white text-center pb-6">
                <div className="flex justify-center mb-2"><CheckCircle2 size={48} /></div>
                <CardTitle className="text-2xl font-bold">¡Bienvenido!</CardTitle>
                <CardDescription className="text-emerald-50">Solo un paso más para completar tu cuenta</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                <div>
                  <Label className="text-base font-bold mb-2 block text-gray-700">Selecciona tu Colegio/Sede</Label>
                  <Select value={selectedSchoolId} onValueChange={setSelectedSchoolId}>
                    <SelectTrigger className="h-14 text-base border-2 focus:ring-emerald-500"><SelectValue placeholder="Busca tu sede..." /></SelectTrigger>
                    <SelectContent>
                      {schools.map(s => <SelectItem key={s.id} value={s.id} className="text-base">{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-start gap-3 p-4 bg-emerald-50 border-2 border-emerald-100 rounded-xl">
                  <Checkbox id="terms" checked={acceptedTerms} onCheckedChange={(c) => setAcceptedTerms(!!c)} className="mt-1 data-[state=checked]:bg-emerald-600" />
                  <label htmlFor="terms" className="text-sm text-emerald-900 leading-tight cursor-pointer">
                    Acepto los <b>Términos y Condiciones</b> y autorizo el tratamiento de mis datos personales según la Ley N° 29733.
                  </label>
                </div>
                <Button onClick={handleSchoolNext} className="w-full h-14 text-lg font-bold bg-emerald-600 hover:bg-emerald-700" disabled={isLoading}>
                  {isLoading ? <Loader2 className="animate-spin" /> : 'Continuar'}
                </Button>
              </CardContent>
            </>
          )}

          {isOnboarding && onboardingStep === 'students' && (
            <>
              <CardHeader className="bg-orange-500 text-white text-center pb-6">
                <div className="flex justify-center mb-2"><UserPlus size={48} /></div>
                <CardTitle className="text-2xl font-bold">Agrega a tus Hijos</CardTitle>
                <CardDescription className="text-orange-50">Ingresa los datos para ver sus consumos</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-4 max-h-[400px] overflow-y-auto custom-scrollbar">
                {students.map((s, idx) => (
                  <div key={s.id} className="p-4 border-2 border-orange-100 rounded-xl bg-orange-50/50 space-y-3 relative">
                    <div className="flex justify-between items-center"><b className="text-orange-900">Estudiante {idx + 1}</b></div>
                    <Input placeholder="Nombre Completo" value={s.full_name} onChange={e => setStudents(students.map(x => x.id === s.id ? {...x, full_name: e.target.value} : x))} className="h-11" />
                    <div className="grid grid-cols-2 gap-2">
                      <Input placeholder="Grado" value={s.grade} onChange={e => setStudents(students.map(x => x.id === s.id ? {...x, grade: e.target.value} : x))} className="h-11" />
                      <Input placeholder="Sección" value={s.section} onChange={e => setStudents(students.map(x => x.id === s.id ? {...x, section: e.target.value} : x))} className="h-11" />
                    </div>
                  </div>
                ))}
                <Button variant="ghost" onClick={() => setStudents([...students, { id: crypto.randomUUID(), full_name: '', grade: '', section: '' }])} className="w-full text-orange-700 hover:bg-orange-100 border-2 border-dashed border-orange-200">
                  <UserPlus className="mr-2" size={18} /> Agregar otro hijo
                </Button>
                <Button onClick={handleOnboardingFinish} className="w-full h-14 text-lg font-bold bg-orange-500 hover:bg-orange-600" disabled={isLoading}>
                  {isLoading ? <Loader2 className="animate-spin" /> : '🎉 Finalizar y Entrar al Portal'}
                </Button>
              </CardContent>
            </>
          )}

        </Card>
      </main>

      <footer className="py-8 text-center space-y-1">
        <p className="text-sm font-medium text-muted-foreground">© 2026 ERP Profesional diseñado por {APP_CONFIG.designedBy}</p>
        <p className="text-[10px] text-muted-foreground/60">Versión {APP_CONFIG.version}</p>
      </footer>
    </div>
  );
}
