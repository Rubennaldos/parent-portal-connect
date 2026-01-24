import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { Loader2, GraduationCap, AlertCircle, ArrowRight } from 'lucide-react';
import { Separator } from '@/components/ui/separator';

interface School {
  id: string;
  name: string;
  code: string;
}

export default function Register() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { signUp, user } = useAuth();
  const { toast } = useToast();

  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(false);

  // Modal para registro manual
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualEmail, setManualEmail] = useState('');
  const [manualPassword, setManualPassword] = useState('');
  const [manualConfirmPassword, setManualConfirmPassword] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showExistingUserModal, setShowExistingUserModal] = useState(false);
  const [existingUserEmail, setExistingUserEmail] = useState('');

  // Cargar colegios
  useEffect(() => {
    fetchSchools();
  }, []);

  const fetchSchools = async () => {
    try {
      const { data, error } = await supabase
        .from('schools')
        .select('id, name, code')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setSchools(data || []);
    } catch (error) {
      console.error('Error fetching schools:', error);
    }
  };

  const handleSocialLogin = async (provider: 'google' | 'azure') => {
    try {
      setLoading(true);
      console.log(`🔐 Iniciando login con ${provider}...`);
      
      const { error } = await supabase.auth.signInWithOAuth({
        provider: provider,
        options: {
          redirectTo: `${window.location.origin}/onboarding`,
          queryParams: {
            prompt: 'select_account',
            access_type: 'offline'
          }
        },
      });

      if (error) throw error;
    } catch (err: any) {
      console.error('❌ Error OAuth:', err);
      toast({
        variant: 'destructive',
        title: 'Error de Conexión',
        description: err.message || 'No se pudo abrir la ventana de Google',
      });
      setLoading(false);
    }
  };

  const validateManualForm = () => {
    const newErrors: Record<string, string> = {};

    if (!manualEmail.includes('@')) {
      newErrors.email = 'Email inválido';
    }
    if (manualPassword.length < 6) {
      newErrors.password = 'Mínimo 6 caracteres';
    }
    if (manualPassword !== manualConfirmPassword) {
      newErrors.confirmPassword = 'Las contraseñas no coinciden';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateManualForm()) return;

    setLoading(true);

    try {
      // 0. VERIFICAR SI EL EMAIL YA EXISTE
      const { data: existingUser } = await supabase
        .from('profiles')
        .select('email')
        .eq('email', manualEmail)
        .maybeSingle();

      if (existingUser) {
        console.log('⚠️ Email ya registrado:', manualEmail);
        setExistingUserEmail(manualEmail);
        setShowExistingUserModal(true);
        setShowManualForm(false);
        setLoading(false);
        return;
      }

      // 1. Crear usuario en Supabase Auth
      const { data: authData, error: authError } = await signUp(manualEmail, manualPassword);

      if (authError) {
        if (authError.message.includes('already registered') || authError.message.includes('User already registered')) {
          console.log('⚠️ Email ya registrado (Auth):', manualEmail);
          setExistingUserEmail(manualEmail);
          setShowExistingUserModal(true);
          setShowManualForm(false);
          setLoading(false);
          return;
        }
        throw authError;
      }

      if (!authData.user) {
        throw new Error('No se pudo crear el usuario');
      }

      // IMPORTANTE: Esperar un poco para que Supabase procese
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 2. Actualizar perfil en profiles (rol parent)
      const { error: roleError } = await supabase
        .from('profiles')
        .upsert({
          id: authData.user.id,
          email: authData.user.email,
          role: 'parent',
        }, { onConflict: 'id' });

      if (roleError) console.error('Error setting role:', roleError);

      // 3. Crear perfil de padre BÁSICO (sin datos completos)
      const { error: profileError } = await supabase
        .from('parent_profiles')
        .insert({
          user_id: authData.user.id,
          onboarding_completed: false,
        });

      if (profileError) throw profileError;

      toast({
        title: '✅ ¡Cuenta Creada!',
        description: 'Revisa tu email para confirmar tu cuenta',
        duration: 5000,
      });

      // Cerrar modal
      setShowManualForm(false);
      setManualEmail('');
      setManualPassword('');
      setManualConfirmPassword('');
      
      // Esperar un momento antes de redirigir
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Redirigir a onboarding
      const sedeCode = searchParams.get('school') || searchParams.get('sede');
      navigate(`/onboarding${sedeCode ? `?school=${sedeCode}` : ''}`);

    } catch (error: any) {
      console.error('Error registering:', error);
      toast({
        variant: 'destructive',
        title: 'Error en el Registro',
        description: error.message || 'No se pudo completar el registro',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg shadow-2xl">
        <CardHeader className="text-center bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-t-lg pb-8">
          <div className="flex justify-center mb-4">
            <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-lg">
              <GraduationCap className="h-10 w-10 text-blue-600" />
            </div>
          </div>
          <CardTitle className="text-3xl font-bold mb-2">Registro de Padres</CardTitle>
          <CardDescription className="text-blue-100 text-base">
            Lima Café 28 - Portal Familiar
          </CardDescription>
        </CardHeader>

        <CardContent className="p-8">
          <div className="space-y-4">
            {/* Botón de Google - MUY PROMINENTE */}
            <Button
              type="button"
              onClick={() => handleSocialLogin('google')}
              disabled={loading}
              className="w-full h-16 text-lg font-bold bg-white border-2 border-gray-300 hover:bg-gray-50 hover:border-blue-500 text-gray-700 transition-all shadow-md hover:shadow-lg"
            >
              <svg className="mr-3 h-6 w-6" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              🔵 Continuar con Google
            </Button>

            {/* Botón de Microsoft */}
            <Button
              type="button"
              onClick={() => handleSocialLogin('azure')}
              disabled={loading}
              className="w-full h-16 text-lg font-bold bg-white border-2 border-gray-300 hover:bg-gray-50 hover:border-blue-500 text-gray-700 transition-all shadow-md hover:shadow-lg"
            >
              <svg className="mr-3 h-6 w-6" viewBox="0 0 24 24">
                <path fill="#f25022" d="M0 0h11.377v11.372H0z"/>
                <path fill="#00a4ef" d="M12.623 0H24v11.372H12.623z"/>
                <path fill="#7fba00" d="M0 12.628h11.377V24H0z"/>
                <path fill="#ffb900" d="M12.623 12.628H24V24H12.623z"/>
              </svg>
              📱 Continuar con Microsoft
            </Button>

            <div className="relative my-6">
              <Separator className="bg-gray-300" />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="bg-card px-4 text-sm font-medium text-gray-600">
                  o
                </span>
              </div>
            </div>

            {/* Link para registro manual */}
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowManualForm(true)}
              className="w-full h-12 text-base font-semibold text-blue-600 hover:text-blue-700 hover:bg-blue-50 border-2 border-blue-200 hover:border-blue-400"
            >
              ✉️ ¿Quieres hacerlo manualmente?
            </Button>
          </div>

          <div className="mt-8 text-center text-sm text-gray-600">
            ¿Ya tienes cuenta?{' '}
            <a href="/auth" className="text-blue-600 hover:underline font-bold">
              Iniciar Sesión
            </a>
          </div>
        </CardContent>
      </Card>

      {/* Modal de Registro Manual */}
      <Dialog open={showManualForm} onOpenChange={setShowManualForm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-center">
              Registro Manual
            </DialogTitle>
            <DialogDescription className="text-center">
              Crea tu cuenta con email y contraseña
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleManualSubmit} className="space-y-4 mt-4">
            <div>
              <Label htmlFor="manual-email">Correo Electrónico *</Label>
              <Input
                id="manual-email"
                type="email"
                value={manualEmail}
                onChange={(e) => setManualEmail(e.target.value)}
                placeholder="tu@email.com"
                className="h-12 text-base"
                required
              />
              {errors.email && (
                <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> {errors.email}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="manual-password">Contraseña *</Label>
              <Input
                id="manual-password"
                type="password"
                value={manualPassword}
                onChange={(e) => setManualPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="h-12 text-base"
                required
              />
              {errors.password && (
                <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> {errors.password}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="manual-confirm">Confirmar Contraseña *</Label>
              <Input
                id="manual-confirm"
                type="password"
                value={manualConfirmPassword}
                onChange={(e) => setManualConfirmPassword(e.target.value)}
                placeholder="Repite tu contraseña"
                className="h-12 text-base"
                required
              />
              {errors.confirmPassword && (
                <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> {errors.confirmPassword}
                </p>
              )}
            </div>

            <Button 
              type="submit" 
              disabled={loading} 
              className="w-full h-12 text-base font-bold"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creando cuenta...
                </>
              ) : (
                <>
                  Crear Cuenta
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal de Usuario Existente */}
      <Dialog open={showExistingUserModal} onOpenChange={setShowExistingUserModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <AlertCircle className="h-6 w-6 text-amber-600" />
              Email Ya Registrado
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-sm text-amber-800 mb-2">
                Este correo electrónico ya está registrado:
              </p>
              <p className="font-bold text-amber-900 font-mono text-base">
                {existingUserEmail}
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-sm text-gray-600 font-medium">¿Qué deseas hacer?</p>
              
              <Button
                onClick={() => {
                  setShowExistingUserModal(false);
                  navigate('/auth', { state: { email: existingUserEmail } });
                }}
                className="w-full h-12 text-base bg-blue-600 hover:bg-blue-700"
              >
                🔐 Iniciar Sesión con esta cuenta
              </Button>
              
              <Button
                onClick={() => {
                  setShowExistingUserModal(false);
                  setManualEmail('');
                  setManualPassword('');
                  setManualConfirmPassword('');
                  setExistingUserEmail('');
                }}
                variant="outline"
                className="w-full h-12 text-base"
              >
                ❌ No soy yo, usar otro correo
              </Button>
            </div>

            <div className="text-xs text-center text-gray-500 mt-4 pt-4 border-t">
              <p>¿Olvidaste tu contraseña?</p>
              <a href="/auth" className="text-blue-600 hover:underline font-medium">
                Recuperar contraseña
              </a>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
