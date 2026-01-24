import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { Loader2, GraduationCap, CheckCircle2, UserPlus } from 'lucide-react';

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

export default function Onboarding() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth(); // Agregamos authLoading
  const { toast } = useToast();

  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState<'school' | 'students'>('school');
  
  // Step 1: Escuela y términos
  const [selectedSchoolId, setSelectedSchoolId] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  
  // Step 2: Estudiantes
  const [students, setStudents] = useState<Array<{
    id: string;
    full_name: string;
    grade: string;
    section: string;
  }>>([
    { id: crypto.randomUUID(), full_name: '', grade: '', section: '' }
  ]);

  useEffect(() => {
    // Si todavía está cargando la autenticación, no hacemos nada
    if (authLoading) return;

    if (!user) {
      console.log('⚠️ No hay usuario en onboarding, esperando o redirigiendo...');
      // Damos un pequeño margen para que Supabase procese el hash de la URL
      const timeout = setTimeout(() => {
        if (!user) navigate('/auth');
      }, 2000);
      return () => clearTimeout(timeout);
    }
    
    fetchSchools();
    checkExistingProfile();
  }, [user, authLoading]);

  useEffect(() => {
    // Intentar recuperar school_id del localStorage (de OAuth)
    const pendingSchoolId = localStorage.getItem('pending_school_id');
    if (pendingSchoolId && schools.length > 0) {
      setSelectedSchoolId(pendingSchoolId);
      localStorage.removeItem('pending_school_id');
      console.log('✅ School ID recuperado de localStorage:', pendingSchoolId);
    }
    
    // O desde URL
    const sedeCode = searchParams.get('school') || searchParams.get('sede');
    if (sedeCode && schools.length > 0 && !selectedSchoolId) {
      const school = schools.find(s => s.code === sedeCode);
      if (school) {
        setSelectedSchoolId(school.id);
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

  const checkExistingProfile = async () => {
    if (!user) return;

    try {
      const { data: profile } = await supabase
        .from('parent_profiles')
        .select('onboarding_completed, school_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (profile?.onboarding_completed) {
        // Ya completó onboarding, redirigir al portal
        navigate('/');
      } else if (profile?.school_id) {
        // Tiene escuela, pasar a agregar estudiantes
        setSelectedSchoolId(profile.school_id);
        setCurrentStep('students');
      }
    } catch (error) {
      console.error('Error checking profile:', error);
    }
  };

  const handleSchoolSubmit = async () => {
    if (!selectedSchoolId) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Selecciona tu colegio/sede',
      });
      return;
    }

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
      // Actualizar parent_profile con school_id
      const { error: updateError } = await supabase
        .from('parent_profiles')
        .update({ school_id: selectedSchoolId })
        .eq('user_id', user!.id);

      if (updateError) throw updateError;

      // Guardar términos aceptados
      const { error: termsError } = await supabase
        .from('terms_and_conditions')
        .upsert({
          user_id: user!.id,
          version: '1.0',
          content: 'Términos y Condiciones - Lima Café 28',
          accepted_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

      if (termsError) console.error('Error saving terms:', termsError);

      toast({
        title: '✅ Sede Confirmada',
        description: 'Ahora agrega a tus hijos',
      });

      setCurrentStep('students');
    } catch (error: any) {
      console.error('Error saving school:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo guardar la sede',
      });
    } finally {
      setLoading(false);
    }
  };

  const addStudent = () => {
    setStudents([...students, { id: crypto.randomUUID(), full_name: '', grade: '', section: '' }]);
  };

  const removeStudent = (id: string) => {
    if (students.length <= 1) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Debes agregar al menos un estudiante',
      });
      return;
    }
    setStudents(students.filter(s => s.id !== id));
  };

  const updateStudent = (id: string, field: keyof Student, value: string) => {
    setStudents(students.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const handleFinish = async () => {
    // Validar que todos los estudiantes tengan datos completos
    const invalidStudent = students.find(s => !s.full_name || !s.grade || !s.section);
    if (invalidStudent) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Completa los datos de todos los estudiantes',
      });
      return;
    }

    setLoading(true);
    try {
      // 1. Insertar estudiantes
      const studentsToInsert = students.map(s => ({
        full_name: s.full_name,
        grade: s.grade,
        section: s.section,
        school_id: selectedSchoolId,
        is_active: true,
      }));

      const { data: insertedStudents, error: studentsError } = await supabase
        .from('students')
        .insert(studentsToInsert)
        .select();

      if (studentsError) throw studentsError;

      // 2. Crear relaciones parent-student
      const relationships = insertedStudents.map(student => ({
        parent_id: user!.id,
        student_id: student.id,
        relationship_type: 'padre/madre',
      }));

      const { error: relationError } = await supabase
        .from('student_relationships')
        .insert(relationships);

      if (relationError) throw relationError;

      // 3. Marcar onboarding como completado
      const { error: completeError } = await supabase
        .from('parent_profiles')
        .update({ onboarding_completed: true })
        .eq('user_id', user!.id);

      if (completeError) throw completeError;

      toast({
        title: '🎉 ¡Registro Completado!',
        description: 'Bienvenido al Portal de Padres',
        duration: 3000,
      });

      // Redirigir al portal
      setTimeout(() => navigate('/'), 500);
    } catch (error: any) {
      console.error('Error finishing onboarding:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo completar el registro',
      });
    } finally {
      setLoading(false);
    }
  };

  if (currentStep === 'school') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 via-blue-50 to-purple-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-xl shadow-xl">
          <CardHeader className="text-center bg-gradient-to-r from-green-600 to-blue-600 text-white rounded-t-lg">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
            </div>
            <CardTitle className="text-2xl">¡Email Confirmado!</CardTitle>
            <CardDescription className="text-blue-100">
              Completa tu registro para acceder al portal
            </CardDescription>
          </CardHeader>

          <CardContent className="p-6 space-y-6">
            <div>
              <Label htmlFor="school_id" className="text-lg font-semibold">
                Selecciona tu Colegio/Sede *
              </Label>
              <p className="text-sm text-muted-foreground mb-3">
                Elige la sede donde estudian tus hijos
              </p>
              <Select value={selectedSchoolId} onValueChange={setSelectedSchoolId}>
                <SelectTrigger className="h-14 text-base">
                  <SelectValue placeholder="🏫 Selecciona el colegio..." />
                </SelectTrigger>
                <SelectContent>
                  {schools.map((school) => (
                    <SelectItem key={school.id} value={school.id} className="text-base">
                      {school.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-start gap-3 p-4 bg-yellow-50 border-2 border-yellow-200 rounded-lg">
              <Checkbox
                id="terms"
                checked={acceptedTerms}
                onCheckedChange={(checked) => setAcceptedTerms(checked as boolean)}
                className="mt-1"
              />
              <label htmlFor="terms" className="text-sm cursor-pointer leading-relaxed">
                Acepto los{' '}
                <a href="/terminos" target="_blank" className="text-blue-600 underline font-semibold">
                  Términos y Condiciones
                </a>{' '}
                y autorizo el tratamiento de mis datos personales según la Ley N° 29733.
              </label>
            </div>

            <Button 
              onClick={handleSchoolSubmit} 
              disabled={loading || !selectedSchoolId || !acceptedTerms} 
              className="w-full h-14 text-lg font-bold"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  Continuar
                  <CheckCircle2 className="ml-2 h-5 w-5" />
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Step 2: Agregar estudiantes
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-orange-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl shadow-xl">
        <CardHeader className="text-center bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-t-lg">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center">
              <UserPlus className="h-8 w-8 text-purple-600" />
            </div>
          </div>
          <CardTitle className="text-2xl">Agrega a tus Hijos</CardTitle>
          <CardDescription className="text-purple-100">
            Registra a los estudiantes para ver su información
          </CardDescription>
        </CardHeader>

        <CardContent className="p-6 space-y-6">
          <div className="space-y-4">
            {students.map((student, index) => (
              <div key={student.id} className="p-4 border-2 border-purple-200 rounded-lg bg-white space-y-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-bold text-purple-900">Estudiante {index + 1}</h4>
                  {students.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeStudent(student.id)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      ✕ Eliminar
                    </Button>
                  )}
                </div>

                <div>
                  <Label>Nombre Completo *</Label>
                  <Input
                    value={student.full_name}
                    onChange={(e) => updateStudent(student.id, 'full_name', e.target.value)}
                    placeholder="Ej: Juan Pérez García"
                    className="h-12 text-base"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Grado *</Label>
                    <Input
                      value={student.grade}
                      onChange={(e) => updateStudent(student.id, 'grade', e.target.value)}
                      placeholder="Ej: 5to"
                      className="h-12 text-base"
                    />
                  </div>
                  <div>
                    <Label>Sección *</Label>
                    <Input
                      value={student.section}
                      onChange={(e) => updateStudent(student.id, 'section', e.target.value)}
                      placeholder="Ej: A"
                      className="h-12 text-base"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={addStudent}
            className="w-full h-12 border-2 border-purple-300 text-purple-700 hover:bg-purple-50"
          >
            <UserPlus className="mr-2 h-5 w-5" />
            Agregar otro hijo
          </Button>

          <Button 
            onClick={handleFinish} 
            disabled={loading} 
            className="w-full h-14 text-lg font-bold bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Finalizando...
              </>
            ) : (
              <>
                🎉 Finalizar y Entrar al Portal
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
