import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { Loader2, GraduationCap, Pencil } from 'lucide-react';

interface Student {
  id: string;
  full_name: string;
  school_id: string;
  level_id?: string | null;
  classroom_id?: string | null;
  grade?: string;
  section?: string;
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

interface EditStudentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  student: Student | null;
}

export function EditStudentModal({ isOpen, onClose, onSuccess, student }: EditStudentModalProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);

  const [levels, setLevels] = useState<Level[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [filteredClassrooms, setFilteredClassrooms] = useState<Classroom[]>([]);

  const [formData, setFormData] = useState({
    full_name: '',
    level_id: '',
    classroom_id: '',
  });

  // Cargar datos cuando se abre el modal
  useEffect(() => {
    if (isOpen && student) {
      setFormData({
        full_name: student.full_name || '',
        level_id: student.level_id || '',
        classroom_id: student.classroom_id || '',
      });
      fetchLevelsAndClassrooms(student.school_id);
    }
  }, [isOpen, student]);

  // Filtrar aulas cuando cambia el nivel
  useEffect(() => {
    if (formData.level_id) {
      const filtered = classrooms.filter(c => c.level_id === formData.level_id);
      setFilteredClassrooms(filtered);
      // Limpiar aula si ya no corresponde al nivel
      if (formData.classroom_id && !filtered.find(c => c.id === formData.classroom_id)) {
        setFormData(prev => ({ ...prev, classroom_id: '' }));
      }
    } else {
      setFilteredClassrooms([]);
    }
  }, [formData.level_id, classrooms]);

  const fetchLevelsAndClassrooms = async (schoolId: string) => {
    setIsLoadingData(true);
    try {
      const [levelsRes, classroomsRes] = await Promise.all([
        supabase
          .from('school_levels')
          .select('*')
          .eq('school_id', schoolId)
          .eq('is_active', true)
          .order('order_index'),
        supabase
          .from('school_classrooms')
          .select('*')
          .eq('school_id', schoolId)
          .eq('is_active', true)
          .order('order_index'),
      ]);

      if (levelsRes.error) throw levelsRes.error;
      if (classroomsRes.error) throw classroomsRes.error;

      setLevels(levelsRes.data || []);
      setClassrooms(classroomsRes.data || []);
    } catch (error: any) {
      console.error('Error cargando grados/aulas:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar los grados y aulas',
      });
    } finally {
      setIsLoadingData(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!student) return;

    if (!formData.full_name.trim()) {
      toast({ variant: 'destructive', title: 'Nombre requerido', description: 'El nombre completo es obligatorio' });
      return;
    }
    if (!formData.level_id) {
      toast({ variant: 'destructive', title: 'Grado requerido', description: 'Selecciona el grado del estudiante' });
      return;
    }
    if (!formData.classroom_id) {
      toast({ variant: 'destructive', title: 'Salón requerido', description: 'Selecciona el salón del estudiante' });
      return;
    }

    setIsSubmitting(true);
    try {
      // Obtener nombres para campos legacy (grade y section)
      const selectedLevel = levels.find(l => l.id === formData.level_id);
      const selectedClassroom = classrooms.find(c => c.id === formData.classroom_id);

      const { error } = await supabase
        .from('students')
        .update({
          full_name: formData.full_name.trim(),
          level_id: formData.level_id,
          classroom_id: formData.classroom_id,
          grade: selectedLevel?.name || '',    // campo legacy
          section: selectedClassroom?.name || '', // campo legacy
        })
        .eq('id', student.id);

      if (error) throw error;

      toast({
        title: '✅ Datos actualizados',
        description: `Los datos de ${formData.full_name.trim()} se guardaron correctamente.`,
      });
      onSuccess();
      onClose();
    } catch (error: any) {
      console.error('Error actualizando estudiante:', error);
      toast({
        variant: 'destructive',
        title: 'Error al guardar',
        description: error.message || 'No se pudo actualizar la información',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto border border-stone-200/50 bg-white shadow-2xl">
        <DialogHeader className="pb-3 sm:pb-4 px-4 sm:px-6">
          <div className="flex flex-col items-center text-center space-y-2 sm:space-y-3">
            <div className="w-14 h-14 sm:w-16 sm:h-16 bg-gradient-to-br from-emerald-50/50 to-[#8B7355]/5 rounded-xl sm:rounded-2xl flex items-center justify-center border border-emerald-100/30 shadow-sm">
              <Pencil className="h-7 w-7 sm:h-8 sm:w-8 text-emerald-600/80" />
            </div>
            <div>
              <DialogTitle className="text-xl sm:text-2xl font-light text-stone-800 tracking-wide">
                Editar Datos del Hijo/a
              </DialogTitle>
              <DialogDescription className="text-xs sm:text-sm text-stone-500 mt-1.5 sm:mt-2 font-normal px-2">
                Puedes corregir el nombre, grado y salón. La sede no puede modificarse desde aquí.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {isLoadingData ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
            <span className="ml-3 text-stone-500 text-sm">Cargando información...</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5 py-2 px-4 sm:px-6">
            {/* Nombre completo */}
            <div className="space-y-1.5">
              <Label htmlFor="edit-full-name" className="text-sm font-medium text-stone-700">
                Nombre completo *
              </Label>
              <Input
                id="edit-full-name"
                value={formData.full_name}
                onChange={e => setFormData(prev => ({ ...prev, full_name: e.target.value }))}
                placeholder="Nombre y apellidos del estudiante"
                className="border-stone-200 focus:border-emerald-400"
              />
            </div>

            {/* Grado / Nivel */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-stone-700 flex items-center gap-1">
                <GraduationCap className="h-4 w-4 text-emerald-600" />
                Grado *
              </Label>
              {levels.length === 0 ? (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  No hay grados configurados para esta sede. Contacta al administrador.
                </p>
              ) : (
                <Select
                  value={formData.level_id}
                  onValueChange={val => setFormData(prev => ({ ...prev, level_id: val, classroom_id: '' }))}
                >
                  <SelectTrigger className="border-stone-200 focus:border-emerald-400">
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

            {/* Salón / Aula */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-stone-700">
                Salón / Sección *
              </Label>
              {!formData.level_id ? (
                <p className="text-xs text-stone-400 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2">
                  Primero selecciona un grado
                </p>
              ) : filteredClassrooms.length === 0 ? (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  No hay salones para este grado. Contacta al administrador.
                </p>
              ) : (
                <Select
                  value={formData.classroom_id}
                  onValueChange={val => setFormData(prev => ({ ...prev, classroom_id: val }))}
                >
                  <SelectTrigger className="border-stone-200 focus:border-emerald-400">
                    <SelectValue placeholder="Selecciona el salón" />
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

            {/* Botones */}
            <div className="flex gap-3 pt-2 pb-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="flex-1 border-stone-200 text-stone-600"
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={isSubmitting || !formData.full_name.trim() || !formData.level_id || !formData.classroom_id}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  'Guardar cambios'
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
