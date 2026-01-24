import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import SplashScreen from '@/components/SplashScreen';
import limaCafeLogo from '@/assets/lima-cafe-logo.png';
import { APP_CONFIG } from '@/config/app.config';

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
  
  // Estados del formulario
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    if (!authLoading && !roleLoading && user && role) {
      navigate(getDefaultRoute(), { replace: true });
    }
  }, [user, role, authLoading, roleLoading, navigate, getDefaultRoute]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    console.log('🚀 INICIO DEL PROCESO DE REGISTRO/LOGIN');
    console.log('📧 Email:', email);
    console.log('🔐 Modo:', isRegisterMode ? 'REGISTRO' : 'LOGIN');
    
    if (!email || !password) {
      console.log('❌ VALIDACIÓN FALLIDA: Campos vacíos');
      toast({
        variant: 'destructive',
        title: 'Campos incompletos',
        description: 'Por favor completa todos los campos.',
      });
      return;
    }

    if (isRegisterMode && password !== confirmPassword) {
      console.log('❌ VALIDACIÓN FALLIDA: Contraseñas no coinciden');
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Las contraseñas no coinciden.',
      });
      return;
    }

    if (password.length < 6) {
      console.log('❌ VALIDACIÓN FALLIDA: Contraseña muy corta');
      toast({
        variant: 'destructive',
        title: 'Contraseña muy corta',
        description: 'La contraseña debe tener al menos 6 caracteres.',
      });
      return;
    }

    console.log('✅ VALIDACIONES PASADAS, iniciando llamada a Supabase...');
    setIsLoading(true);
    
    try {
      if (isRegisterMode) {
        console.log('📝 Llamando a signUp()...');
        const { data, error } = await signUp(email, password);
        
        console.log('📦 RESPUESTA DE SUPABASE:');
        console.log('   - data:', data);
        console.log('   - error:', error);
        console.log('   - user:', data?.user);
        console.log('   - session:', data?.session);
        
        if (error) {
          console.log('❌ ERROR EN SIGNUP:', error);
          throw error;
        }

        if (data.user && !data.session) {
          console.log('📧 Usuario creado pero necesita confirmar email');
          toast({
            title: '📧 Revisa tu correo',
            description: 'Te hemos enviado un link para confirmar tu cuenta.',
            duration: 10000,
          });
          setIsRegisterMode(false);
          setEmail('');
          setPassword('');
          setConfirmPassword('');
        } else {
          console.log('✅ Usuario creado con sesión activa');
          toast({ 
            title: '✅ Cuenta creada', 
            description: 'Bienvenido al portal.' 
          });
        }
      } else {
        console.log('🔑 Llamando a signIn()...');
        const { error } = await signIn(email, password);
        
        console.log('📦 RESPUESTA DE LOGIN:');
        console.log('   - error:', error);
        
        if (error) {
          console.log('❌ ERROR EN LOGIN:', error);
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
        } else {
          console.log('✅ LOGIN EXITOSO');
        }
      }
    } catch (err: any) {
      console.log('💥 EXCEPCIÓN CAPTURADA:', err);
      console.log('   - message:', err.message);
      console.log('   - stack:', err.stack);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err.message || 'Ocurrió un error inesperado.',
      });
    } finally {
      console.log('🏁 FIN DEL PROCESO');
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
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="font-semibold text-sm text-gray-700">Correo Electrónico</label>
                <Input 
                  type="email"
                  placeholder="tu@email.com" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 border-2 focus:border-brand-teal"
                  disabled={isLoading}
                  autoComplete="email"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="font-semibold text-sm text-gray-700">Contraseña</label>
                  {!isRegisterMode && (
                    <button 
                      type="button" 
                      onClick={() => navigate('/auth?type=recovery')} 
                      className="text-xs text-primary hover:underline font-medium"
                    >
                      ¿Olvidaste tu clave?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Input 
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 pr-10 border-2 focus:border-brand-teal"
                    disabled={isLoading}
                    autoComplete={isRegisterMode ? "new-password" : "current-password"}
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
              </div>

              {isRegisterMode && (
                <div className="space-y-2">
                  <label className="font-semibold text-sm text-gray-700">Confirmar Contraseña</label>
                  <div className="relative">
                    <Input 
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="h-12 pr-10 border-2 focus:border-brand-teal"
                      disabled={isLoading}
                      autoComplete="new-password"
                    />
                    <button 
                      type="button" 
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)} 
                      className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
                      tabIndex={-1}
                    >
                      {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                  </div>
                </div>
              )}

              <Button 
                type="submit" 
                className="w-full h-14 text-base font-bold bg-brand-teal hover:bg-brand-teal/90 text-white shadow-lg transition-all rounded-xl" 
                disabled={isLoading}
              >
                {isLoading ? <Loader2 className="animate-spin" /> : (isRegisterMode ? 'Crear Mi Cuenta' : 'Iniciar Sesión')}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <button 
                onClick={() => {
                  setIsRegisterMode(!isRegisterMode);
                  setPassword('');
                  setConfirmPassword('');
                }}
                className="text-sm font-semibold text-gray-600 hover:text-brand-teal transition-colors"
                type="button"
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
