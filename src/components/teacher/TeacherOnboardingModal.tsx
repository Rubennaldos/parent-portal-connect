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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle2, Loader2 } from 'lucide-react';

interface School {
  id: string;
  name: string;
  code: string;
}

interface TeacherOnboardingModalProps {
  open: boolean;
  onComplete: () => void;
}

export function TeacherOnboardingModal({ open, onComplete }: TeacherOnboardingModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [schools, setSchools] = useState<School[]>([]);

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
    try {
      const { data, error } = await supabase
        .from('schools')
        .select('id, name, code')
        .order('name');

      if (error) throw error;
      setSchools(data || []);
    } catch (error: any) {
      console.error('Error cargando escuelas:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar las escuelas.',
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validaciones
    if (!fullName || !dni || !phone1 || !schoolId1) {
      toast({
        variant: 'destructive',
        title: 'Campos requeridos',
        description: 'Por favor completa todos los campos obligatorios.',
      });
      return;
    }

    if (dni.length !== 8) {
      toast({
        variant: 'destructive',
        title: 'DNI inválido',
        description: 'El DNI debe tener 8 dígitos.',
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
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo guardar tu perfil. Intenta de nuevo.',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Hola Profesor 👋</DialogTitle>
          <DialogDescription>
            Por favor completa tu información para comenzar a usar el portal.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
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
              />
            </div>
          </div>

          {/* Área de Trabajo */}
          <div>
            <Label htmlFor="area">
              Área de Trabajo <span className="text-red-500">*</span>
            </Label>
            <Select value={area} onValueChange={setArea} required>
              <SelectTrigger id="area">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="profesor">Profesor</SelectItem>
                <SelectItem value="administrador">Administrador</SelectItem>
                <SelectItem value="personal">Personal</SelectItem>
                <SelectItem value="otro">Otro</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Escuela Principal */}
          <div>
            <Label htmlFor="school1">
              Escuela Principal <span className="text-red-500">*</span>
            </Label>
            <Select value={schoolId1} onValueChange={setSchoolId1} required>
              <SelectTrigger id="school1">
                <SelectValue placeholder="Selecciona tu escuela" />
              </SelectTrigger>
              <SelectContent>
                {schools.map((school) => (
                  <SelectItem key={school.id} value={school.id}>
                    {school.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Segunda Escuela (Opcional) */}
          <div>
            <Label htmlFor="school2">Segunda Escuela (Opcional)</Label>
            <Select value={schoolId2 || 'none'} onValueChange={(val) => setSchoolId2(val === 'none' ? '' : val)}>
              <SelectTrigger id="school2">
                <SelectValue placeholder="Selecciona si trabajas en otra escuela" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Ninguna</SelectItem>
                {schools
                  .filter((s) => s.id !== schoolId1)
                  .map((school) => (
                    <SelectItem key={school.id} value={school.id}>
                      {school.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {/* Información */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800">
              <strong>Nota:</strong> Tu cuenta es libre y no tiene límites de gasto. 
              Toda la información es confidencial y solo será usada para fines administrativos.
            </p>
          </div>

          {/* Botones */}
          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="submit"
              disabled={loading}
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
