import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Eye, EyeOff, ShieldCheck, HelpCircle, Phone, Mail, AlertCircle, Users, UtensilsCrossed } from 'lucide-react';
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
  const [showPasswordRecoveryModal, setShowPasswordRecoveryModal] = useState(false);
  
  // Estados del formulario
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState<'parent' | 'teacher'>('parent');

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
        const { data, error } = await signUp(email, password, { 
          role: selectedRole,
          full_name: '', // Se completará en el onboarding
        });
        
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
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-[#FAFAF9] via-white to-stone-100">
      {/* Header - Logo más pequeño en móvil */}
      <header className="w-full pt-8 sm:pt-12 pb-0 px-4 flex justify-center">
        <img 
          src={limaCafeLogo} 
          alt="Logo" 
          className="h-16 sm:h-20 md:h-24 w-auto object-contain mix-blend-multiply transition-all" 
        />
      </header>

      {/* Main - Menos padding en móvil */}
      <main className="flex-1 flex items-start justify-center p-3 sm:p-4 pt-2 pb-8 sm:pb-12">
        <Card className="w-full max-w-md shadow-lg border border-stone-200/50 bg-white/95 backdrop-blur-sm overflow-hidden rounded-2xl">
          {/* Header del Card - Padding ajustado para móvil */}
          <CardHeader className="text-center space-y-2 sm:space-y-3 pb-3 sm:pb-4 pt-6 sm:pt-8 px-4 sm:px-6">
            <div className="flex justify-center mb-1 sm:mb-2">
              <div className="bg-gradient-to-br from-[#8B7355]/10 to-[#6B5744]/10 p-2.5 sm:p-3 rounded-xl sm:rounded-2xl">
                <ShieldCheck className="h-7 w-7 sm:h-8 sm:w-8 text-[#8B7355]" />
              </div>
            </div>
            <CardTitle className="text-xl sm:text-2xl font-light text-stone-800 tracking-wide">
              {isRegisterMode ? 'Crear Cuenta' : 'Portal de Acceso'}
            </CardTitle>
            <CardDescription className="text-stone-500 font-normal text-xs sm:text-sm tracking-wide px-2">
              {isRegisterMode 
                ? 'Regístrate para gestionar los consumos de tus hijos' 
                : 'Sistema de Gestión Lima Café 28'}
            </CardDescription>
          </CardHeader>

          {/* Content - Padding responsivo */}
          <CardContent className="space-y-5 sm:space-y-6 px-4 sm:px-6 md:px-8 pb-6 sm:pb-8">
            <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
              
              {/* Selector de Rol (Solo en registro) */}
              {isRegisterMode && (
                <div className="space-y-2">
                  <label className="font-medium text-[10px] sm:text-xs text-stone-600 uppercase tracking-wider block text-center mb-3">
                    ¿Qué tipo de cuenta deseas crear?
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedRole('parent')}
                      className={`flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all ${
                        selectedRole === 'parent'
                          ? 'border-[#8B7355] bg-[#8B7355]/5 text-[#8B7355]'
                          : 'border-stone-100 bg-stone-50 text-stone-400 hover:border-stone-200'
                      }`}
                    >
                      <Users className="h-6 w-6" />
                      <span className="text-xs font-bold uppercase tracking-tighter">Padre de Familia</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedRole('teacher')}
                      className={`flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all ${
                        selectedRole === 'teacher'
                          ? 'border-purple-600 bg-purple-50 text-purple-600'
                          : 'border-stone-100 bg-stone-50 text-stone-400 hover:border-stone-200'
                      }`}
                    >
                      <UtensilsCrossed className="h-6 w-6" />
                      <span className="text-xs font-bold uppercase tracking-tighter">Profesor / Personal</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Email */}
              <div className="space-y-1.5 sm:space-y-2">
                <label className="font-medium text-[10px] sm:text-xs text-stone-600 uppercase tracking-wider">
                  Correo Electrónico
                </label>
                <Input 
                  type="email"
                  placeholder="tu@email.com" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 sm:h-12 border border-stone-200 focus:border-[#8B7355] rounded-xl transition-all text-sm sm:text-base"
                  disabled={isLoading}
                  autoComplete="email"
                />
              </div>

              {/* Contraseña */}
              <div className="space-y-1.5 sm:space-y-2">
                <div className="flex justify-between items-center">
                  <label className="font-medium text-[10px] sm:text-xs text-stone-600 uppercase tracking-wider">
                    Contraseña
                  </label>
                  {!isRegisterMode && (
                    <button 
                      type="button" 
                      onClick={() => setShowPasswordRecoveryModal(true)} 
                      className="text-[10px] sm:text-xs text-[#8B7355] hover:underline font-normal"
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
                    className="h-11 sm:h-12 pr-10 border border-stone-200 focus:border-[#8B7355] rounded-xl transition-all text-sm sm:text-base"
                    disabled={isLoading}
                    autoComplete={isRegisterMode ? "new-password" : "current-password"}
                  />
                  <button 
                    type="button" 
                    onClick={() => setShowPassword(!showPassword)} 
                    className="absolute right-3 top-2.5 sm:top-3 text-stone-400 hover:text-stone-600"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={18} className="sm:w-5 sm:h-5" /> : <Eye size={18} className="sm:w-5 sm:h-5" />}
                  </button>
                </div>
              </div>

              {/* Confirmar Contraseña */}
              {isRegisterMode && (
                <div className="space-y-1.5 sm:space-y-2">
                  <label className="font-medium text-[10px] sm:text-xs text-stone-600 uppercase tracking-wider">
                    Confirmar Contraseña
                  </label>
                  <div className="relative">
                    <Input 
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="h-11 sm:h-12 pr-10 border border-stone-200 focus:border-[#8B7355] rounded-xl transition-all text-sm sm:text-base"
                      disabled={isLoading}
                      autoComplete="new-password"
                    />
                    <button 
                      type="button" 
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)} 
                      className="absolute right-3 top-2.5 sm:top-3 text-stone-400 hover:text-stone-600"
                      tabIndex={-1}
                    >
                      {showConfirmPassword ? <EyeOff size={18} className="sm:w-5 sm:h-5" /> : <Eye size={18} className="sm:w-5 sm:h-5" />}
                    </button>
                  </div>
                </div>
              )}

              {/* Botón Submit - Altura responsiva */}
              <Button 
                type="submit" 
                className="w-full h-12 sm:h-14 text-sm sm:text-base font-medium bg-gradient-to-r from-[#8B7355] to-[#6B5744] hover:from-[#6B5744] hover:to-[#5B4734] text-white shadow-md transition-all rounded-xl tracking-wide" 
                disabled={isLoading}
              >
                {isLoading ? <Loader2 className="animate-spin h-5 w-5" /> : (isRegisterMode ? 'Crear Mi Cuenta' : 'Iniciar Sesión')}
              </Button>
            </form>

            {/* Link para cambiar modo - Texto más pequeño en móvil */}
            <div className="mt-4 sm:mt-6 text-center">
              <button 
                onClick={() => {
                  setIsRegisterMode(!isRegisterMode);
                  setPassword('');
                  setConfirmPassword('');
                }}
                className="text-xs sm:text-sm font-normal text-stone-500 hover:text-[#8B7355] transition-colors tracking-wide"
                type="button"
              >
                {isRegisterMode ? '¿Ya tienes cuenta? Ingresa aquí' : '¿No tienes cuenta? Regístrate aquí'}
              </button>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Footer - Texto más pequeño y ajustado en móvil */}
      <footer className="py-4 sm:py-6 md:py-8 text-center space-y-1.5 sm:space-y-2">
        <p className="text-xs sm:text-sm md:text-base font-normal text-stone-500 px-4 tracking-wide leading-relaxed">
          © 2026 ERP Profesional diseñado por{' '}
          <span className="text-[#8B7355] font-medium">ARQUISIA Soluciones</span> para{' '}
          <span className="text-stone-800 font-medium">Lima Café 28</span>
        </p>
        <p className="text-[10px] sm:text-xs text-stone-400 font-normal tracking-wide">
          Versión {APP_CONFIG.version} • {APP_CONFIG.status}
        </p>
      </footer>

      {/* Modal de Recuperación de Contraseña */}
      <Dialog open={showPasswordRecoveryModal} onOpenChange={setShowPasswordRecoveryModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg flex items-center gap-2">
              <HelpCircle className="h-5 w-5 text-[#8B4513]" />
              ¿Olvidaste tu contraseña?
            </DialogTitle>
            <DialogDescription className="text-sm">
              Sistema de recuperación sin correo electrónico
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-3">
            {/* Mensaje principal */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="flex gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-amber-800">
                  <strong className="block mb-1">Importante:</strong>
                  <p>
                    Actualmente el sistema <strong>no tiene configurado el envío de correos electrónicos</strong>.
                    Para recuperar tu contraseña, debes contactar al administrador del sistema.
                  </p>
                </div>
              </div>
            </div>

            {/* Instrucciones */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <h4 className="font-bold text-blue-900 text-sm mb-2">¿Cómo recuperar mi contraseña?</h4>
              <ol className="text-xs text-blue-800 space-y-1 list-decimal list-inside ml-1">
                <li>Contacta al <strong>Administrador del Sistema</strong></li>
                <li>Proporciona tu <strong>correo electrónico registrado</strong></li>
                <li>El administrador reseteará tu contraseña desde el panel de control</li>
                <li>Recibirás una <strong>contraseña temporal</strong> que deberás cambiar en tu primer inicio de sesión</li>
              </ol>
            </div>

            {/* Contacto */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <h4 className="font-bold text-green-900 text-sm mb-2">Contacto del Administrador:</h4>
              <div className="flex items-center gap-2 text-sm text-green-800">
                <Mail className="h-4 w-4 flex-shrink-0" />
                <span><strong>Email:</strong> fiorella@limacafe28.com</span>
              </div>
            </div>

            {/* Nota de seguridad */}
            <p className="text-xs text-gray-600 text-center px-2">
              💡 <strong>Recomendación:</strong> Una vez recuperes tu contraseña, cámbiala inmediatamente 
              desde el menú de configuración ⚙️
            </p>
          </div>

          {/* Botón */}
          <Button
            onClick={() => setShowPasswordRecoveryModal(false)}
            className="w-full bg-[#8B4513] hover:bg-[#A0522D]"
          >
            Entendido
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
