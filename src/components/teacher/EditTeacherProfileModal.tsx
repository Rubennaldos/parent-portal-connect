import { useState, useEffect } from 'react';
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

interface EditTeacherProfileModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teacherProfile: any;
  onSuccess: () => void;
}

export function EditTeacherProfileModal({
  open,
  onOpenChange,
  teacherProfile,
  onSuccess,
}: EditTeacherProfileModalProps) {
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
    if (open && teacherProfile) {
      // Cargar datos actuales
      setFullName(teacherProfile.full_name || '');
      setDni(teacherProfile.dni || '');
      setPersonalEmail(teacherProfile.personal_email || '');
      setCorporateEmail(teacherProfile.corporate_email || '');
      setPhone1(teacherProfile.phone_1 || '');
      setCorporatePhone(teacherProfile.corporate_phone || '');
      setArea(teacherProfile.area || 'profesor');
      setSchoolId1(teacherProfile.school_id_1 || teacherProfile.school_1_id || '');
      setSchoolId2(teacherProfile.school_id_2 || teacherProfile.school_2_id || '');

      fetchSchools();
    }
  }, [open, teacherProfile]);

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
      console.log('📝 Actualizando perfil del profesor...');

      // Actualizar perfil del profesor
      const { error: profileError } = await supabase
        .from('teacher_profiles')
        .update({
          full_name: fullName.trim(),
          dni: dni.trim(),
          personal_email: personalEmail.trim() || null,
          corporate_email: corporateEmail.trim() || null,
          phone_1: phone1.trim(),
          corporate_phone: corporatePhone.trim() || null,
          area: area,
          school_id_1: schoolId1,
          school_id_2: schoolId2 || null,
        })
        .eq('id', teacherProfile.id);

      if (profileError) {
        console.error('❌ Error actualizando perfil:', profileError);
        throw profileError;
      }

      // Actualizar también en profiles
      await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          school_id: schoolId1,
        })
        .eq('id', teacherProfile.id);

      console.log('✅ Perfil actualizado exitosamente');

      toast({
        title: '✅ Perfil actualizado',
        description: 'Tus datos han sido actualizados correctamente.',
      });

      onSuccess();
    } catch (error: any) {
      console.error('❌ Error actualizando perfil:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo actualizar tu perfil.',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Datos Personales</DialogTitle>
          <DialogDescription>
            Actualiza tu información personal
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

          {/* Botones */}
          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancelar
            </Button>
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
                  Guardar Cambios
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
