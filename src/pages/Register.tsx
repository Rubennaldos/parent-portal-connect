import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { Loader2, GraduationCap, CheckCircle2, AlertCircle } from 'lucide-react';
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
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  // Form data - SOLO PASO 1 (credenciales)
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    school_id: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showExistingUserModal, setShowExistingUserModal] = useState(false);
  const [existingUserEmail, setExistingUserEmail] = useState('');
  const [detectedSchoolName, setDetectedSchoolName] = useState<string>('');

  // Si ya está logueado (OAuth o manual), redirigir al dashboard
  // El sistema detectará automáticamente si necesita onboarding
  useEffect(() => {
    if (user) {
      console.log('✅ Usuario autenticado, redirigiendo al dashboard');
      navigate('/', { replace: true });
    }
  }, [user, navigate]);

  // Cargar colegios
  useEffect(() => {
    fetchSchools();
  }, []);

  // Pre-seleccionar sede del QR
  useEffect(() => {
    const sedeCode = searchParams.get('school') || searchParams.get('sede');
    if (sedeCode && schools.length > 0) {
      const school = schools.find(s => s.code === sedeCode);
      if (school) {
        setFormData(prev => ({ ...prev, school_id: school.id }));
        setDetectedSchoolName(school.name);
        console.log('✅ Sede detectada desde URL:', school.name);
      }
    }
  }, [searchParams, schools]);

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
    setLoading(true);
    
    // Obtener el school_id del URL para guardarlo en metadata
    const sedeCode = searchParams.get('sede') || searchParams.get('school');
    const schoolId = formData.school_id || (sedeCode && schools.find(s => s.code === sedeCode)?.id);
    
    // GUARDAR EN LOCALSTORAGE para recuperarlo en Onboarding después del login
    if (schoolId) {
      console.log('💾 Guardando schoolId para onboarding:', schoolId);
      localStorage.setItem('pending_school_id', schoolId);
    }
    
    // Redirigir al dashboard después de OAuth
    // IMPORTANTE: Usar window.location.href completa (sin modificar)
    const baseUrl = window.location.origin + window.location.pathname;
    const redirectUrl = baseUrl; // Supabase agregará el hash automáticamente
    
    console.log('🔐 Iniciando OAuth con school:', { sedeCode, schoolId, redirectUrl });
    
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: provider,
        options: {
          redirectTo: redirectUrl,
        },
      });

      if (error) {
        // Verificar si es un error de usuario ya existente
        if (error.message.includes('already registered') || error.message.includes('User already registered')) {
          // Este caso normalmente no ocurre en OAuth, pero por si acaso
          console.log('⚠️ Usuario OAuth ya registrado');
        }
        
        toast({
          variant: 'destructive',
          title: 'Error',
          description: `No se pudo conectar con ${provider === 'google' ? 'Google' : 'Microsoft'}`,
        });
        setLoading(false);
      }
      // Si no hay error, el usuario será redirigido a Google/Microsoft
    } catch (err: any) {
      console.error('Error en OAuth:', err);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Error inesperado al iniciar sesión',
      });
      setLoading(false);
    }
  };

  const validateStep1 = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.email.includes('@')) {
      newErrors.email = 'Email inválido';
    }
    if (formData.password.length < 6) {
      newErrors.password = 'Mínimo 6 caracteres';
    }
    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Las contraseñas no coinciden';
    }
    if (!formData.school_id) {
      newErrors.school_id = 'Selecciona un colegio';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateStep1()) return;
    if (!acceptedTerms) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Debes aceptar los Términos y Condiciones',
      });
      return;
    }

    setLoading(true);

    try {
      // 0. VERIFICAR SI EL EMAIL YA EXISTE
      const { data: existingUser } = await supabase
        .from('profiles')
        .select('email')
        .eq('email', formData.email)
        .maybeSingle();

      if (existingUser) {
        console.log('⚠️ Email ya registrado:', formData.email);
        setExistingUserEmail(formData.email);
        setShowExistingUserModal(true);
        setLoading(false);
        return;
      }

      // 1. Crear usuario en Supabase Auth
      const { data: authData, error: authError } = await signUp(formData.email, formData.password);

      if (authError) {
        // Capturar errores específicos de Supabase Auth
        if (authError.message.includes('already registered') || authError.message.includes('User already registered')) {
          console.log('⚠️ Email ya registrado (Auth):', formData.email);
          setExistingUserEmail(formData.email);
          setShowExistingUserModal(true);
          setLoading(false);
          return;
        }
        throw authError;
      }

      if (!authData.user) {
        throw new Error('No se pudo crear el usuario');
      }

      // IMPORTANTE: Esperar un poco para que Supabase procese la creación
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
          school_id: formData.school_id,
          onboarding_completed: false,
        });

      if (profileError) throw profileError;

      // 4. Guardar términos aceptados
      const { error: termsError } = await supabase
        .from('terms_and_conditions')
        .insert({
          user_id: authData.user.id,
          version: '1.0',
          content: 'Términos y Condiciones - Lima Café 28',
          accepted_at: new Date().toISOString(),
        });

      if (termsError) console.error('Error saving terms:', termsError);

      toast({
        title: '✅ ¡Cuenta Creada!',
        description: 'Ahora completa tus datos y registra a tus hijos',
      });

      // Esperar otro segundo antes de redirigir
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Redirigir a onboarding para completar datos
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
      <Card className="w-full max-w-2xl shadow-xl">
        <CardHeader className="text-center bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-t-lg">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center">
              <GraduationCap className="h-8 w-8 text-blue-600" />
            </div>
          </div>
          <CardTitle className="text-2xl">Registro de Padres</CardTitle>
          <CardDescription className="text-blue-100">
            Lima Café 28 - Sistema de Kiosco Escolar
          </CardDescription>
        </CardHeader>

        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-center mb-4">Crea tu Cuenta</h3>

              {/* Botones de Login Social */}
              <div className="space-y-3 mb-6">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => handleSocialLogin('google')}
                  disabled={loading}
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
                  onClick={() => handleSocialLogin('azure')}
                  disabled={loading}
                >
                  <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M11.4 24H0V12.6L11.4 0v24zM24 24H12.6V12.6L24 0v24z"
                    />
                  </svg>
                  Continuar con Microsoft
                </Button>

                <div className="relative my-6">
                  <Separator />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="bg-card px-2 text-xs text-muted-foreground">
                      O crea cuenta con email
                    </span>
                  </div>
                </div>
              </div>

              {/* Selector de Sede - SOLO si NO viene del QR */}
              {detectedSchoolName ? (
                <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                      <GraduationCap className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-xs text-blue-600 font-semibold uppercase">Sede Detectada</p>
                      <p className="text-lg font-bold text-blue-900">{detectedSchoolName}</p>
                    </div>
                  </div>
                  <Button 
                    type="button"
                    variant="ghost" 
                    size="sm" 
                    onClick={() => { 
                      setFormData({ ...formData, school_id: '' }); 
                      setDetectedSchoolName(''); 
                    }}
                    className="text-xs text-blue-600 hover:bg-blue-100"
                  >
                    Cambiar
                  </Button>
                </div>
              ) : (
                <div>
                  <Label htmlFor="school_id">Colegio/Sede *</Label>
                  <Select value={formData.school_id} onValueChange={(value) => {
                    setFormData({ ...formData, school_id: value });
                    const school = schools.find(s => s.id === value);
                    if (school) setDetectedSchoolName(school.name);
                  }}>
                    <SelectTrigger className="h-12">
                      <SelectValue placeholder="Selecciona el colegio" />
                    </SelectTrigger>
                    <SelectContent>
                      {schools.map((school) => (
                        <SelectItem key={school.id} value={school.id}>
                          {school.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.school_id && <p className="text-xs text-red-600 mt-1">{errors.school_id}</p>}
                </div>
              )}

              <div>
                <Label htmlFor="email">Correo Electrónico *</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="tu@email.com"
                  required
                />
                {errors.email && (
                  <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> {errors.email}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="password">Contraseña *</Label>
                <Input
                  id="password"
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="Mínimo 6 caracteres"
                  required
                />
                {errors.password && (
                  <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> {errors.password}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="confirmPassword">Confirmar Contraseña *</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  placeholder="Repite tu contraseña"
                  required
                />
                {errors.confirmPassword && (
                  <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> {errors.confirmPassword}
                  </p>
                )}
              </div>

              {/* Términos */}
              <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded">
                <Checkbox
                  id="terms"
                  checked={acceptedTerms}
                  onCheckedChange={(checked) => setAcceptedTerms(checked as boolean)}
                />
                <label htmlFor="terms" className="text-sm cursor-pointer">
                  Acepto los{' '}
                  <a href="/terminos" target="_blank" className="text-blue-600 underline">
                    Términos y Condiciones
                  </a>{' '}
                  y autorizo el tratamiento de mis datos personales según la Ley N° 29733.
                </label>
              </div>

              <Button type="submit" disabled={loading} className="w-full h-12 text-lg">
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creando cuenta...
                  </>
                ) : (
                  'Crear Cuenta'
                )}
              </Button>
            </div>
          </form>

          <div className="mt-6 text-center text-sm text-gray-600">
            ¿Ya tienes cuenta?{' '}
            <a href="/auth" className="text-blue-600 hover:underline">
              Iniciar Sesión
            </a>
          </div>
        </CardContent>
      </Card>

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
                Este correo electrónico ya está registrado en el sistema:
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
                  setFormData({ ...formData, email: '', password: '', confirmPassword: '' });
                  setExistingUserEmail('');
                  setStep(1);
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

