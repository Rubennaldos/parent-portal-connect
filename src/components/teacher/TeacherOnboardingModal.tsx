import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle2, Loader2, LogOut, AlertTriangle, Info, School, RefreshCw } from 'lucide-react';

interface SchoolOption {
  id: string;
  name: string;
  code: string;
}

interface TeacherOnboardingModalProps {
  open: boolean;
  onComplete: () => void;
}

export function TeacherOnboardingModal({ open, onComplete }: TeacherOnboardingModalProps) {
  const { user, signOut } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [schools, setSchools] = useState<SchoolOption[]>([]);
  const [loadingSchools, setLoadingSchools] = useState(false);
  const [schoolsError, setSchoolsError] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Datos del formulario
  const [fullName, setFullName] = useState('');
  const [dni, setDni] = useState('');
  const [personalEmail, setPersonalEmail] = useState('');
  const [corporateEmail, setCorporateEmail] = useState('');
  const [phone1, setPhone1] = useState('');
  const [corporatePhone, setCorporatePhone] = useState('');
  const [area, setArea] = useState('profesor');
  const [schoolId1, setSchoolId1] = useState('');
  const [schoolId2, setSchoolId2] = useState('');

  useEffect(() => {
    if (open) {
      fetchSchools();
      // Pre-llenar el email personal con el email de registro
      if (user?.email) {
        setPersonalEmail(user.email);
      }
    }
  }, [open, user]);

  const fetchSchools = async () => {
    setLoadingSchools(true);
    setSchoolsError(false);
    try {
      const { data, error } = await supabase
        .from('schools')
        .select('id, name, code')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setSchools(data || []);
    } catch (error: any) {
      console.error('Error cargando escuelas:', error);
      setSchoolsError(true);
      toast({
        variant: 'destructive',
        title: 'Error al cargar sedes',
        description: 'No se pudieron cargar las sedes. Usa el botón "Reintentar" o recarga la página.',
      });
    } finally {
      setLoadingSchools(false);
    }
  };

  const handleReloadPage = () => {
    window.location.reload();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    // Validaciones
    if (!fullName.trim()) {
      toast({
        variant: 'destructive',
        title: 'Campo requerido',
        description: 'Por favor ingresa tu nombre completo.',
      });
      return;
    }

    if (!dni || dni.length !== 8) {
      toast({
        variant: 'destructive',
        title: 'DNI inválido',
        description: 'El DNI debe tener exactamente 8 dígitos.',
      });
      return;
    }

    if (!phone1 || phone1.length < 7) {
      toast({
        variant: 'destructive',
        title: 'Teléfono requerido',
        description: 'Por favor ingresa un teléfono personal válido.',
      });
      return;
    }

    if (!schoolId1) {
      toast({
        variant: 'destructive',
        title: 'Sede requerida',
        description: 'Por favor selecciona tu sede principal.',
      });
      return;
    }

    setLoading(true);

    try {
      console.log('📝 Guardando perfil del profesor...');

      // 1. Crear/actualizar perfil del profesor
      const { error: profileError } = await supabase
        .from('teacher_profiles')
        .upsert({
          id: user?.id,
          full_name: fullName.trim(),
          dni: dni.trim(),
          personal_email: personalEmail.trim() || null,
          corporate_email: corporateEmail.trim() || null,
          phone_1: phone1.trim(),
          corporate_phone: corporatePhone.trim() || null,
          area: area,
          school_id_1: schoolId1,
          school_id_2: schoolId2 || null,
          free_account: true,
          onboarding_completed: true,
        }, {
          onConflict: 'id'
        });

      if (profileError) {
        console.error('❌ Error en teacher_profiles:', profileError);
        
        // Manejo específico de DNI duplicado
        if (profileError.message?.includes('unique') || profileError.message?.includes('duplicate') || profileError.code === '23505') {
          throw new Error('El DNI ingresado ya está registrado en el sistema. Si crees que es un error, contacta al administrador.');
        }
        
        // Error de permisos RLS
        if (profileError.message?.includes('policy') || profileError.code === '42501' || profileError.message?.includes('row-level security')) {
          throw new Error('Error de permisos al crear tu perfil. Por favor contacta al administrador del sistema.');
        }
        
        throw profileError;
      }

      // 2. Crear/actualizar entrada en profiles (para el sistema general)
      const { error: generalProfileError } = await supabase
        .from('profiles')
        .upsert({
          id: user?.id,
          email: user?.email,
          full_name: fullName.trim(),
          role: 'teacher',
          school_id: schoolId1, // Escuela principal
          created_at: new Date().toISOString(),
        }, {
          onConflict: 'id'
        });

      if (generalProfileError) {
        console.error('❌ Error en profiles:', generalProfileError);
        // Si falla el segundo paso, intentamos revertir el primero
        // marcando onboarding como no completado
        await supabase
          .from('teacher_profiles')
          .update({ onboarding_completed: false })
          .eq('id', user?.id);
        throw generalProfileError;
      }

      console.log('✅ Perfil creado exitosamente');

      toast({
        title: '✅ ¡Bienvenido!',
        description: 'Tu perfil ha sido creado exitosamente.',
      });

      onComplete();
    } catch (error: any) {
      console.error('❌ Error guardando perfil:', error);
      const errorMsg = error.message || 'No se pudo guardar tu perfil. Intenta de nuevo.';
      setSubmitError(errorMsg);
      toast({
        variant: 'destructive',
        title: 'Error al registrarte',
        description: errorMsg,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut();
      toast({
        title: 'Sesión cerrada',
        description: 'Has cerrado sesión exitosamente',
      });
    } catch (err) {
      console.error('Error cerrando sesión:', err);
      // Forzar recarga como fallback
      window.location.href = '/auth';
    }
  };

  // Obtener nombre de la sede seleccionada
  const selectedSchoolName = schools.find(s => s.id === schoolId1)?.name || '';

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent 
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="text-2xl">Hola Profesor 👋</DialogTitle>
              <DialogDescription>
                Por favor completa tu información para comenzar a usar el portal.
              </DialogDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="text-stone-500 hover:text-red-600 hover:bg-red-50 ml-2"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Cerrar Sesión
            </Button>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Error persistente */}
          {submitError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800">Error en el registro</p>
                <p className="text-xs text-red-700 mt-1">{submitError}</p>
                <p className="text-xs text-red-600 mt-2">
                  Puedes intentar de nuevo o{' '}
                  <button type="button" onClick={handleLogout} className="underline font-medium hover:text-red-800">
                    cerrar sesión
                  </button>{' '}
                  y volver a intentar.
                </p>
              </div>
            </div>
          )}

          {/* Nombre Completo */}
          <div>
            <Label htmlFor="fullName">
              Nombre Completo <span className="text-red-500">*</span>
            </Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Nombres y Apellidos"
              required
            />
          </div>

          {/* DNI */}
          <div>
            <Label htmlFor="dni">
              DNI <span className="text-red-500">*</span>
            </Label>
            <Input
              id="dni"
              value={dni}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, '').slice(0, 8);
                setDni(value);
              }}
              placeholder="12345678"
              maxLength={8}
              inputMode="numeric"
              required
            />
          </div>

          {/* Grid de 2 columnas */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Correo Personal */}
            <div>
              <Label htmlFor="personalEmail">Correo Personal</Label>
              <Input
                id="personalEmail"
                type="email"
                value={personalEmail}
                onChange={(e) => setPersonalEmail(e.target.value)}
                placeholder="tu@email.com"
              />
            </div>

            {/* Correo Corporativo */}
            <div>
              <Label htmlFor="corporateEmail">Correo Corporativo</Label>
              <Input
                id="corporateEmail"
                type="email"
                value={corporateEmail}
                onChange={(e) => setCorporateEmail(e.target.value)}
                placeholder="tu@escuela.edu.pe"
              />
            </div>

            {/* Teléfono Personal */}
            <div>
              <Label htmlFor="phone1">
                Teléfono Personal <span className="text-red-500">*</span>
              </Label>
              <Input
                id="phone1"
                value={phone1}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, '').slice(0, 9);
                  setPhone1(value);
                }}
                placeholder="999888777"
                maxLength={9}
                inputMode="numeric"
                required
              />
            </div>

            {/* Teléfono Corporativo */}
            <div>
              <Label htmlFor="corporatePhone">Teléfono de la Empresa</Label>
              <Input
                id="corporatePhone"
                value={corporatePhone}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, '').slice(0, 9);
                  setCorporatePhone(value);
                }}
                placeholder="999888777"
                maxLength={9}
                inputMode="numeric"
              />
            </div>
          </div>

          {/* Área de Trabajo - Usando <select> nativo en vez de Radix Select */}
          <div>
            <Label htmlFor="area">
              Área de Trabajo <span className="text-red-500">*</span>
            </Label>
            <select
              id="area"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              required
              className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="profesor">Profesor</option>
              <option value="administrador">Administrador</option>
              <option value="personal">Personal</option>
              <option value="otro">Otro</option>
            </select>
          </div>

          {/* Escuela Principal - Usando <select> nativo para evitar conflicto Portal/Dialog */}
          <div>
            <Label htmlFor="school1">
              Sede Principal <span className="text-red-500">*</span>
            </Label>
            <select
              id="school1"
              value={schoolId1}
              onChange={(e) => {
                setSchoolId1(e.target.value);
                // Si la segunda escuela es la misma, limpiarla
                if (e.target.value === schoolId2) {
                  setSchoolId2('');
                }
              }}
              required
              disabled={loadingSchools || schoolsError}
              className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">
                {loadingSchools ? 'Cargando sedes...' : schoolsError ? '⚠️ Error al cargar sedes' : 'Selecciona tu sede'}
              </option>
              {schools.map((school) => (
                <option key={school.id} value={school.id}>
                  {school.name}
                </option>
              ))}
            </select>

            {/* Botones de recuperación cuando las sedes no cargan */}
            {schoolsError && !loadingSchools && (
              <div className="mt-2 bg-red-50 border border-red-200 rounded-lg p-3 flex flex-col gap-2">
                <div className="flex gap-2 items-start">
                  <AlertTriangle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-700">
                    No se pudieron cargar las sedes. Verifica tu conexión a internet e intenta de nuevo.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={fetchSchools}
                    className="text-xs h-8"
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Reintentar
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleReloadPage}
                    className="text-xs h-8 text-stone-500"
                  >
                    Recargar Página
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* ⚠️ Advertencia de Sede Principal - Solo se muestra cuando seleccionan una sede */}
          {schoolId1 && (
            <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 flex gap-2 animate-in fade-in slide-in-from-top-2 duration-300">
              <School className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-800">
                  Sede Principal: {selectedSchoolName}
                </p>
                <p className="text-xs text-amber-700 mt-1">
                  <strong>Importante:</strong> Esta será tu sede principal y tu cuenta estará asociada únicamente a esta sede. 
                  Tus consumos, pagos y toda tu operación se registrarán aquí.
                </p>
                <p className="text-xs text-amber-600 mt-1">
                  La segunda sede (abajo) es solo de referencia para futuras actualizaciones.
                </p>
              </div>
            </div>
          )}

          {/* Segunda Escuela (Opcional) - Usando <select> nativo */}
          <div>
            <Label htmlFor="school2">Segunda Sede (Solo referencia - Opcional)</Label>
            <select
              id="school2"
              value={schoolId2 || ''}
              onChange={(e) => setSchoolId2(e.target.value)}
              disabled={loadingSchools || schoolsError}
              className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">Ninguna</option>
              {schools
                .filter((s) => s.id !== schoolId1)
                .map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.name}
                  </option>
                ))}
            </select>
          </div>

          {/* Información */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex gap-2">
            <Info className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-blue-800">
              <strong>Nota:</strong> Tu cuenta es libre y no tiene límites de gasto. 
              Toda la información es confidencial y solo será usada para fines administrativos.
            </p>
          </div>

          {/* Botones */}
          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="submit"
              disabled={loading || loadingSchools || schoolsError}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Completar Perfil
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
