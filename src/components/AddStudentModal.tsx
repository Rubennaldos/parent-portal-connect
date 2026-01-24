import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, AlertCircle, School, GraduationCap, Users } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface AddStudentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface School {
  id: string;
  name: string;
}

interface Level {
  id: string;
  name: string;
  order_index: number;
}

interface Classroom {
  id: string;
  name: string;
  level_id: string;
  order_index: number;
}

export function AddStudentModal({ isOpen, onClose, onSuccess }: AddStudentModalProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingSchools, setIsLoadingSchools] = useState(true);
  const [isLoadingLevels, setIsLoadingLevels] = useState(false);
  
  const [schools, setSchools] = useState<School[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [filteredClassrooms, setFilteredClassrooms] = useState<Classroom[]>([]);
  
  const [formData, setFormData] = useState({
    full_name: '',
    school_id: '',
    level_id: '',
    classroom_id: '',
  });

  // Cargar todas las sedes disponibles al abrir el modal
  useEffect(() => {
    if (isOpen) {
      fetchSchools();
    }
  }, [isOpen]);

  // Cargar niveles y aulas cuando se selecciona una sede
  useEffect(() => {
    if (formData.school_id) {
      fetchLevelsAndClassrooms(formData.school_id);
    } else {
      setLevels([]);
      setClassrooms([]);
      setFilteredClassrooms([]);
    }
  }, [formData.school_id]);

  // Filtrar aulas cuando cambia el nivel seleccionado
  useEffect(() => {
    if (formData.level_id) {
      const filtered = classrooms.filter(c => c.level_id === formData.level_id);
      setFilteredClassrooms(filtered);
      // Limpiar aula seleccionada si ya no está en la lista filtrada
      if (formData.classroom_id && !filtered.find(c => c.id === formData.classroom_id)) {
        setFormData(prev => ({ ...prev, classroom_id: '' }));
      }
    } else {
      setFilteredClassrooms([]);
      setFormData(prev => ({ ...prev, classroom_id: '' }));
    }
  }, [formData.level_id, classrooms]);

  const fetchSchools = async () => {
    setIsLoadingSchools(true);
    try {
      const { data, error } = await supabase
        .from('schools')
        .select('id, name')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setSchools(data || []);
    } catch (error: any) {
      console.error('Error fetching schools:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar las sedes',
      });
    } finally {
      setIsLoadingSchools(false);
    }
  };

  const fetchLevelsAndClassrooms = async (schoolId: string) => {
    setIsLoadingLevels(true);
    try {
      // Cargar niveles de esa sede
      const { data: levelsData, error: levelsError } = await supabase
        .from('school_levels')
        .select('*')
        .eq('school_id', schoolId)
        .eq('is_active', true)
        .order('order_index');

      if (levelsError) throw levelsError;
      setLevels(levelsData || []);

      // Cargar todas las aulas de esa sede
      const { data: classroomsData, error: classroomsError } = await supabase
        .from('school_classrooms')
        .select('*')
        .eq('school_id', schoolId)
        .eq('is_active', true)
        .order('order_index');

      if (classroomsError) throw classroomsError;
      setClassrooms(classroomsData || []);
    } catch (error: any) {
      console.error('Error fetching levels and classrooms:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar los grados y aulas',
      });
    } finally {
      setIsLoadingLevels(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se encontró el usuario',
      });
      return;
    }

    // Validaciones
    if (!formData.full_name.trim()) {
      toast({
        variant: 'destructive',
        title: 'Nombre requerido',
        description: 'El nombre completo del estudiante es obligatorio',
      });
      return;
    }

    if (!formData.school_id) {
      toast({
        variant: 'destructive',
        title: 'Sede requerida',
        description: 'Debes seleccionar la sede del estudiante',
      });
      return;
    }

    if (!formData.level_id) {
      toast({
        variant: 'destructive',
        title: 'Grado requerido',
        description: 'Selecciona el grado/nivel del estudiante',
      });
      return;
    }

    if (!formData.classroom_id) {
      toast({
        variant: 'destructive',
        title: 'Aula requerida',
        description: 'Selecciona el aula/sección del estudiante',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Obtener los nombres de nivel y aula para campos legacy
      const selectedLevel = levels.find(l => l.id === formData.level_id);
      const selectedClassroom = classrooms.find(c => c.id === formData.classroom_id);

      const { error } = await supabase
        .from('students')
        .insert({
          full_name: formData.full_name.trim(),
          level_id: formData.level_id,
          classroom_id: formData.classroom_id,
          grade: selectedLevel?.name || '', // Campo legacy por compatibilidad
          section: selectedClassroom?.name || '', // Campo legacy por compatibilidad
          balance: 0,
          daily_limit: 0,
          parent_id: user.id,
          school_id: formData.school_id,
          is_active: true,
          free_account: true,
        });

      if (error) throw error;

      toast({
        title: '✅ Estudiante Registrado',
        description: `${formData.full_name} ha sido agregado con Cuenta Libre activada`,
      });

      // Limpiar formulario
      setFormData({
        full_name: '',
        school_id: '',
        level_id: '',
        classroom_id: '',
      });

      onSuccess();
      onClose();

    } catch (error: any) {
      console.error('Error adding student:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo registrar al estudiante: ' + error.message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center">
              <GraduationCap className="h-7 w-7 text-blue-600" />
            </div>
            <div>
              <DialogTitle className="text-2xl font-black text-slate-800">
                Agregar Hijo/a
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-500 mt-1">
                Ingresa los datos del estudiante
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 py-4">
          {/* Nombre completo */}
          <div className="space-y-2">
            <Label htmlFor="full_name" className="font-semibold text-sm flex items-center gap-2">
              <Users className="h-4 w-4" /> Nombre Completo del Estudiante *
            </Label>
            <Input
              id="full_name"
              value={formData.full_name}
              onChange={(e) => setFormData(prev => ({ ...prev, full_name: e.target.value }))}
              placeholder="Ej: Juan Carlos Pérez García"
              className="h-12"
              disabled={isSubmitting}
            />
          </div>

          {/* Sede/Colegio */}
          <div className="space-y-2">
            <Label htmlFor="school" className="font-semibold text-sm flex items-center gap-2">
              <School className="h-4 w-4" /> Sede/Colegio *
            </Label>
            {isLoadingSchools ? (
              <div className="flex items-center justify-center h-12 border rounded-lg bg-slate-50">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : (
              <Select 
                value={formData.school_id} 
                onValueChange={(value) => {
                  setFormData(prev => ({ 
                    ...prev, 
                    school_id: value,
                    level_id: '',
                    classroom_id: '',
                  }));
                }}
                disabled={isSubmitting}
              >
                <SelectTrigger className="h-12">
                  <SelectValue placeholder="Selecciona la sede del estudiante" />
                </SelectTrigger>
                <SelectContent>
                  {schools.map(school => (
                    <SelectItem key={school.id} value={school.id}>
                      {school.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Grado/Nivel */}
          <div className="space-y-2">
            <Label htmlFor="level" className="font-semibold text-sm">Grado/Nivel *</Label>
            {isLoadingLevels ? (
              <div className="flex items-center justify-center h-12 border rounded-lg bg-slate-50">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : !formData.school_id ? (
              <div className="flex items-center h-12 border rounded-lg bg-slate-50 px-3 text-sm text-slate-500">
                Primero selecciona una sede
              </div>
            ) : levels.length === 0 ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  No hay grados configurados para esta sede
                </AlertDescription>
              </Alert>
            ) : (
              <Select 
                value={formData.level_id} 
                onValueChange={(value) => setFormData(prev => ({ ...prev, level_id: value }))}
                disabled={isSubmitting || !formData.school_id}
              >
                <SelectTrigger className="h-12">
                  <SelectValue placeholder="Selecciona el grado" />
                </SelectTrigger>
                <SelectContent>
                  {levels.map(level => (
                    <SelectItem key={level.id} value={level.id}>
                      {level.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Aula/Sección */}
          <div className="space-y-2">
            <Label htmlFor="classroom" className="font-semibold text-sm">Aula/Sección *</Label>
            {!formData.level_id ? (
              <div className="flex items-center h-12 border rounded-lg bg-slate-50 px-3 text-sm text-slate-500">
                Primero selecciona un grado
              </div>
            ) : filteredClassrooms.length === 0 ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  No hay aulas configuradas para este grado
                </AlertDescription>
              </Alert>
            ) : (
              <Select 
                value={formData.classroom_id} 
                onValueChange={(value) => setFormData(prev => ({ ...prev, classroom_id: value }))}
                disabled={isSubmitting || !formData.level_id}
              >
                <SelectTrigger className="h-12">
                  <SelectValue placeholder="Selecciona el aula/sección" />
                </SelectTrigger>
                <SelectContent>
                  {filteredClassrooms.map(classroom => (
                    <SelectItem key={classroom.id} value={classroom.id}>
                      {classroom.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 bg-blue-600 hover:bg-blue-700"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="animate-spin mr-2 h-4 w-4" />
                  Guardando...
                </>
              ) : (
                'Agregar Estudiante'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
