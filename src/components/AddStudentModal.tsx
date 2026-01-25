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
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto border border-stone-200/50 bg-white shadow-2xl">
        <DialogHeader className="pb-4">
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="w-16 h-16 bg-gradient-to-br from-emerald-50/50 to-[#8B7355]/5 rounded-2xl flex items-center justify-center border border-emerald-100/30 shadow-sm">
              <GraduationCap className="h-8 w-8 text-emerald-600/80" />
            </div>
            <div>
              <DialogTitle className="text-2xl font-light text-stone-800 tracking-wide">
                Agregar Hijo/a
              </DialogTitle>
              <DialogDescription className="text-sm text-stone-500 mt-2 font-normal">
                Ingresa los datos del estudiante
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 py-2">
          {/* Nombre completo */}
          <div className="space-y-2">
            <Label htmlFor="full_name" className="font-medium text-xs text-stone-600 uppercase tracking-wider flex items-center gap-2">
              <Users className="h-3.5 w-3.5 text-emerald-600/70" /> Nombre Completo del Estudiante *
            </Label>
            <Input
              id="full_name"
              value={formData.full_name}
              onChange={(e) => setFormData(prev => ({ ...prev, full_name: e.target.value }))}
              placeholder="Ej: Juan Carlos Pérez García"
              className="h-12 border border-stone-200 focus:border-emerald-500/50 focus:ring-emerald-500/10 rounded-xl font-normal"
              disabled={isSubmitting}
            />
          </div>

          {/* Sede/Colegio */}
          <div className="space-y-2">
            <Label htmlFor="school" className="font-medium text-xs text-stone-600 uppercase tracking-wider flex items-center gap-2">
              <School className="h-3.5 w-3.5 text-[#8B7355]" /> Sede/Colegio *
            </Label>
            {isLoadingSchools ? (
              <div className="flex items-center justify-center h-12 border border-stone-200 rounded-xl bg-stone-50/50">
                <Loader2 className="h-5 w-5 animate-spin text-stone-400" />
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
                <SelectTrigger className="h-12 border border-stone-200 focus:border-[#8B7355]/50 focus:ring-[#8B7355]/10 rounded-xl">
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
            <Label htmlFor="level" className="font-medium text-xs text-stone-600 uppercase tracking-wider">Grado/Nivel *</Label>
            {isLoadingLevels ? (
              <div className="flex items-center justify-center h-12 border border-stone-200 rounded-xl bg-stone-50/50">
                <Loader2 className="h-5 w-5 animate-spin text-stone-400" />
              </div>
            ) : !formData.school_id ? (
              <div className="flex items-center h-12 border border-stone-200 rounded-xl bg-stone-50/50 px-3 text-sm text-stone-500 font-normal">
                Primero selecciona una sede
              </div>
            ) : levels.length === 0 ? (
              <Alert variant="destructive" className="rounded-xl border-rose-200/50">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  No hay grados configurados para esta sede
                </AlertDescription>
              </Alert>
            ) : (
              <Select 
                value={formData.level_id} 
                onValueChange={(value) => setFormData(prev => ({ ...prev, level_id: value }))}
                disabled={isSubmitting || !formData.school_id}
              >
                <SelectTrigger className="h-12 border border-stone-200 focus:border-emerald-500/50 focus:ring-emerald-500/10 rounded-xl">
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
            <Label htmlFor="classroom" className="font-medium text-xs text-stone-600 uppercase tracking-wider">Aula/Sección *</Label>
            {!formData.level_id ? (
              <div className="flex items-center h-12 border border-stone-200 rounded-xl bg-stone-50/50 px-3 text-sm text-stone-500 font-normal">
                Primero selecciona un grado
              </div>
            ) : filteredClassrooms.length === 0 ? (
              <Alert variant="destructive" className="rounded-xl border-rose-200/50">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  No hay aulas configuradas para este grado
                </AlertDescription>
              </Alert>
            ) : (
              <Select 
                value={formData.classroom_id} 
                onValueChange={(value) => setFormData(prev => ({ ...prev, classroom_id: value }))}
                disabled={isSubmitting || !formData.level_id}
              >
                <SelectTrigger className="h-12 border border-stone-200 focus:border-emerald-500/50 focus:ring-emerald-500/10 rounded-xl">
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
              className="flex-1 h-12 border border-stone-200 hover:bg-stone-50/50 rounded-xl font-normal"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 h-12 bg-gradient-to-r from-emerald-600/90 to-[#8B7355]/80 hover:from-emerald-700/90 hover:to-[#6B5744]/80 text-white shadow-md rounded-xl font-medium tracking-wide"
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
