import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { Loader2, Plus, Trash2, CheckCircle2, GraduationCap } from 'lucide-react';

interface StudentForm {
  id: string;
  full_name: string;
  grade: string;
  section: string;
  relationship: string;
  has_allergies: boolean;
  allergy_notes: string;
}

const RELATIONSHIPS = [
  { value: 'hijo', label: 'Hijo/Hija' },
  { value: 'hermano', label: 'Hermano/Hermana' },
  { value: 'primo', label: 'Primo/Prima' },
  { value: 'sobrino', label: 'Sobrino/Sobrina' },
  { value: 'nieto', label: 'Nieto/Nieta' },
  { value: 'a_cargo', label: 'A cargo (Tutor legal)' },
];

const GRADES = [
  'Inicial 3 años', 'Inicial 4 años', 'Inicial 5 años',
  '1ro Primaria', '2do Primaria', '3ro Primaria', '4to Primaria', '5to Primaria', '6to Primaria',
  '1ro Secundaria', '2do Secundaria', '3ro Secundaria', '4to Secundaria', '5to Secundaria',
];

export default function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(1); // 1: Datos del padre, 2: Datos de hijos
  
  // Datos del padre
  const [parentData, setParentData] = useState({
    full_name: user?.user_metadata?.full_name || user?.user_metadata?.name || '',
    dni: '',
    phone_1: '',
    phone_2: '',
    address: '',
  });

  const [students, setStudents] = useState<StudentForm[]>([
    {
      id: crypto.randomUUID(),
      full_name: '',
      grade: '',
      section: '',
      relationship: 'hijo',
      has_allergies: false,
      allergy_notes: '',
    },
  ]);

  const [schoolId, setSchoolId] = useState<string>('');

  // Obtener el school_id del padre
  useEffect(() => {
    if (user) {
      fetchParentSchool();
    }
  }, [user]);

  const fetchParentSchool = async () => {
    try {
      const { data, error } = await supabase
        .from('parent_profiles')
        .select('school_id')
        .eq('user_id', user?.id)
        .single();

      if (error) throw error;
      setSchoolId(data.school_id);
    } catch (error) {
      console.error('Error fetching school:', error);
    }
  };

  const addStudent = () => {
    setStudents([
      ...students,
      {
        id: crypto.randomUUID(),
        full_name: '',
        grade: '',
        section: '',
        relationship: 'hijo',
        has_allergies: false,
        allergy_notes: '',
      },
    ]);
  };

  const removeStudent = (id: string) => {
    if (students.length > 1) {
      setStudents(students.filter((s) => s.id !== id));
    }
  };

  const updateStudent = (id: string, field: keyof StudentForm, value: any) => {
    setStudents(
      students.map((s) => (s.id === id ? { ...s, [field]: value } : s))
    );
  };

  const validateParentData = () => {
    if (!parentData.full_name.trim()) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Ingresa tu nombre completo',
      });
      return false;
    }
    if (!parentData.dni.trim() || parentData.dni.length < 8) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Ingresa un DNI válido (8 dígitos)',
      });
      return false;
    }
    if (!parentData.phone_1.trim() || parentData.phone_1.length < 9) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Ingresa un teléfono válido',
      });
      return false;
    }
    if (!parentData.address.trim()) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Ingresa tu dirección',
      });
      return false;
    }
    return true;
  };

  const validateStudentsData = () => {
    for (const student of students) {
      if (!student.full_name.trim()) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Todos los estudiantes deben tener nombre',
        });
        return false;
      }
      if (!student.grade) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Selecciona el grado de todos los estudiantes',
        });
        return false;
      }
      if (!student.relationship) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Indica la relación con cada estudiante',
        });
        return false;
      }
    }
    return true;
  };

  const handleNextStep = () => {
    if (currentStep === 1) {
      if (validateParentData()) {
        setCurrentStep(2);
      }
    }
  };

  const handleSubmit = async () => {
    if (!validateStudentsData()) return;

    setLoading(true);

    try {
      // Validar que tengamos school_id
      if (!schoolId) {
        throw new Error('No se pudo obtener el colegio. Por favor, intenta de nuevo.');
      }

      // 1. Actualizar datos del padre en parent_profiles
      const { error: parentError } = await supabase
        .from('parent_profiles')
        .update({
          full_name: parentData.full_name,
          dni: parentData.dni,
          phone_1: parentData.phone_1,
          phone_2: parentData.phone_2 || null,
          address: parentData.address,
        })
        .eq('user_id', user?.id);

      if (parentError) throw parentError;

      // 2. Insertar cada estudiante
      for (const student of students) {
        // Crear estudiante
        const { data: studentData, error: studentError } = await supabase
          .from('students')
          .insert({
            parent_id: user?.id,
            school_id: schoolId, // Agregar el school_id del padre
            full_name: student.full_name,
            name: student.full_name,
            grade: student.grade,
            section: student.section || 'A',
            balance: 0,
            daily_limit: 15,
            is_active: true,
          })
          .select()
          .single();

        if (studentError) throw studentError;

        // 2. Crear relación familiar
        const { error: relationError } = await supabase
          .from('student_relationships')
          .insert({
            student_id: studentData.id,
            parent_id: user?.id,
            relationship: student.relationship,
            is_primary: student.relationship === 'hijo',
          });

        if (relationError) throw relationError;

        // 3. Registrar alergias si tiene
        if (student.has_allergies && student.allergy_notes.trim()) {
          const { error: allergyError } = await supabase
            .from('allergies')
            .insert({
              student_id: studentData.id,
              allergy_type: 'general',
              notes: student.allergy_notes,
              created_by: user?.id,
            });

          if (allergyError) console.error('Error saving allergy:', allergyError);
        }
      }

      // Marcar onboarding como completado
      await supabase
        .from('parent_profiles')
        .update({ onboarding_completed: true })
        .eq('user_id', user?.id);

      toast({
        title: '✅ ¡Registro Completado!',
        description: `${students.length} estudiante(s) registrado(s) exitosamente`,
      });

      navigate('/');

    } catch (error: any) {
      console.error('Error onboarding:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo completar el registro',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <Card className="shadow-xl">
          <CardHeader className="bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-t-lg">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center">
                <GraduationCap className="h-8 w-8 text-blue-600" />
              </div>
            </div>
            <CardTitle className="text-2xl text-center">
              {currentStep === 1 ? 'Completa tus Datos' : 'Registra a tus Hijos'}
            </CardTitle>
            <CardDescription className="text-blue-100 text-center">
              {currentStep === 1 
                ? 'Necesitamos algunos datos para completar tu perfil' 
                : 'Agrega a todos los estudiantes que usarán el kiosco'}
            </CardDescription>
            {/* Indicador de pasos */}
            <div className="flex justify-center gap-2 mt-4">
              <div className={`h-2 w-20 rounded-full ${currentStep === 1 ? 'bg-white' : 'bg-white/30'}`} />
              <div className={`h-2 w-20 rounded-full ${currentStep === 2 ? 'bg-white' : 'bg-white/30'}`} />
            </div>
          </CardHeader>

          <CardContent className="p-6 space-y-6">
            
            {/* PASO 1: Datos del Padre */}
            {currentStep === 1 && (
              <div className="space-y-4">
                <div>
                  <Label>Nombre Completo *</Label>
                  <Input
                    value={parentData.full_name}
                    onChange={(e) => setParentData({ ...parentData, full_name: e.target.value })}
                    placeholder="Nombres y Apellidos"
                  />
                </div>

                <div>
                  <Label>DNI *</Label>
                  <Input
                    value={parentData.dni}
                    onChange={(e) => setParentData({ ...parentData, dni: e.target.value })}
                    placeholder="12345678"
                    maxLength={8}
                  />
                </div>

                <div>
                  <Label>Teléfono Principal *</Label>
                  <Input
                    value={parentData.phone_1}
                    onChange={(e) => setParentData({ ...parentData, phone_1: e.target.value })}
                    placeholder="999888777"
                    maxLength={9}
                  />
                </div>

                <div>
                  <Label>Teléfono Secundario (Opcional)</Label>
                  <Input
                    value={parentData.phone_2}
                    onChange={(e) => setParentData({ ...parentData, phone_2: e.target.value })}
                    placeholder="999888666"
                    maxLength={9}
                  />
                </div>

                <div>
                  <Label>Dirección *</Label>
                  <Input
                    value={parentData.address}
                    onChange={(e) => setParentData({ ...parentData, address: e.target.value })}
                    placeholder="Av/Jr/Calle, Nro. Distrito"
                  />
                </div>

                <Button
                  onClick={handleNextStep}
                  className="w-full h-12 text-lg"
                >
                  Siguiente: Registrar Hijos
                </Button>
              </div>
            )}

            {/* PASO 2: Datos de los Hijos */}
            {currentStep === 2 && (
              <div className="space-y-6">
            {/* Advertencia de alergias */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm">
              <p className="font-semibold text-yellow-800 mb-1">⚠️ Importante - Alergias Alimentarias</p>
              <p className="text-yellow-700">
                El registro de alergias es <strong>solo informativo</strong>. Lima Café 28 no se hace responsable por reacciones alérgicas. 
                Es tu responsabilidad verificar los ingredientes de cada producto.
              </p>
            </div>

            {/* Formularios de estudiantes */}
            {students.map((student, index) => (
              <Card key={student.id} className="border-2">
                <CardHeader className="pb-3 bg-gray-50">
                  <div className="flex justify-between items-center">
                    <CardTitle className="text-base">Estudiante {index + 1}</CardTitle>
                    {students.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeStudent(student.id)}
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 pt-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <Label>Nombre Completo *</Label>
                      <Input
                        value={student.full_name}
                        onChange={(e) => updateStudent(student.id, 'full_name', e.target.value)}
                        placeholder="Nombres y Apellidos"
                      />
                    </div>

                    <div>
                      <Label>Grado *</Label>
                      <Select
                        value={student.grade}
                        onValueChange={(value) => updateStudent(student.id, 'grade', value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecciona" />
                        </SelectTrigger>
                        <SelectContent>
                          {GRADES.map((grade) => (
                            <SelectItem key={grade} value={grade}>
                              {grade}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Sección</Label>
                      <Input
                        value={student.section}
                        onChange={(e) => updateStudent(student.id, 'section', e.target.value.toUpperCase())}
                        placeholder="A, B, C..."
                        maxLength={2}
                      />
                    </div>

                    <div className="md:col-span-2">
                      <Label>Relación Familiar *</Label>
                      <Select
                        value={student.relationship}
                        onValueChange={(value) => updateStudent(student.id, 'relationship', value)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RELATIONSHIPS.map((rel) => (
                            <SelectItem key={rel.value} value={rel.value}>
                              {rel.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="md:col-span-2">
                      <div className="flex items-center gap-2 mb-2">
                        <input
                          type="checkbox"
                          id={`allergy-${student.id}`}
                          checked={student.has_allergies}
                          onChange={(e) =>
                            updateStudent(student.id, 'has_allergies', e.target.checked)
                          }
                          className="rounded"
                        />
                        <Label htmlFor={`allergy-${student.id}`}>
                          Tiene alergias o intolerancias alimentarias
                        </Label>
                      </div>
                      {student.has_allergies && (
                        <Input
                          value={student.allergy_notes}
                          onChange={(e) =>
                            updateStudent(student.id, 'allergy_notes', e.target.value)
                          }
                          placeholder="Especifica: gluten, lácteos, maní, mariscos, etc."
                        />
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

                {/* Botón agregar estudiante */}
                <Button
                  type="button"
                  variant="outline"
                  onClick={addStudent}
                  className="w-full border-dashed border-2"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Agregar Otro Estudiante
                </Button>

                {/* Botones de navegación */}
                <div className="flex gap-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCurrentStep(1)}
                    disabled={loading}
                    className="flex-1"
                  >
                    Atrás
                  </Button>
                  <Button
                    onClick={handleSubmit}
                    disabled={loading}
                    className="flex-1 h-12 text-lg"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Registrando...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="mr-2 h-5 w-5" />
                        Finalizar Registro
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}

          </CardContent>
        </Card>
      </div>
    </div>
  );
}

