import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface AddStudentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
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
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [levels, setLevels] = useState<Level[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [filteredClassrooms, setFilteredClassrooms] = useState<Classroom[]>([]);
  
  const [formData, setFormData] = useState({
    full_name: '',
    level_id: '',
    classroom_id: '',
  });

  // Cargar school_id del padre y datos de grados/aulas
  useEffect(() => {
    if (isOpen && user) {
      fetchParentSchoolAndLevels();
    }
  }, [isOpen, user]);

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

  const fetchParentSchoolAndLevels = async () => {
    if (!user) return;
    
    setIsLoadingData(true);
    try {
      // 1. Obtener el school_id del padre desde la tabla students (de algún hijo existente)
      const { data: existingStudent } = await supabase
        .from('students')
        .select('school_id')
        .eq('parent_id', user.id)
        .eq('is_active', true)
        .limit(1)
        .single();

      let parentSchoolId = existingStudent?.school_id;

      // Si no tiene hijos, obtener school_id desde el perfil del padre (si existe)
      if (!parentSchoolId) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('school_id')
          .eq('id', user.id)
          .single();
        
        parentSchoolId = profile?.school_id;
      }

      if (!parentSchoolId) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'No se pudo determinar tu sede. Contacta al administrador.',
        });
        setIsLoadingData(false);
        return;
      }

      setSchoolId(parentSchoolId);

      // 2. Cargar niveles de esa sede
      const { data: levelsData, error: levelsError } = await supabase
        .from('school_levels')
        .select('*')
        .eq('school_id', parentSchoolId)
        .eq('is_active', true)
        .order('order_index');

      if (levelsError) throw levelsError;
      setLevels(levelsData || []);

      // 3. Cargar todas las aulas de esa sede
      const { data: classroomsData, error: classroomsError } = await supabase
        .from('school_classrooms')
        .select('*')
        .eq('school_id', parentSchoolId)
        .eq('is_active', true)
        .order('order_index');

      if (classroomsError) throw classroomsError;
      setClassrooms(classroomsData || []);

    } catch (error: any) {
      console.error('Error fetching school data:', error);
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
    
    if (!user || !schoolId) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se encontró el usuario o la sede',
      });
      return;
    }
    
    if (!formData.full_name.trim()) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'El nombre completo es obligatorio',
      });
      return;
    }

    if (!formData.level_id) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Selecciona un grado/nivel',
      });
      return;
    }

    if (!formData.classroom_id) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Selecciona un aula/sección',
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
          school_id: schoolId,
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar Estudiante</DialogTitle>
          <DialogDescription>
            Agrega los datos de tu hijo para gestionar su cuenta del kiosco
          </DialogDescription>
        </DialogHeader>

        {isLoadingData ? (
          <div className="flex justify-center items-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="ml-3 text-muted-foreground">Cargando datos...</span>
          </div>
        ) : levels.length === 0 ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No hay grados disponibles para tu sede. Contacta al administrador para que configure los grados y aulas.
            </AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Nombre Completo */}
            <div>
              <Label htmlFor="full_name">Nombre Completo *</Label>
              <Input
                id="full_name"
                placeholder="Ej: Carlos Pérez López"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                required
              />
            </div>

            {/* Grado/Nivel */}
            <div>
              <Label htmlFor="level">Grado/Nivel *</Label>
              <Select 
                value={formData.level_id} 
                onValueChange={(value) => setFormData({ ...formData, level_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona el grado" />
                </SelectTrigger>
                <SelectContent>
                  {levels.map((level) => (
                    <SelectItem key={level.id} value={level.id}>
                      {level.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Aula/Sección */}
            <div>
              <Label htmlFor="classroom">Aula/Sección *</Label>
              <Select 
                value={formData.classroom_id} 
                onValueChange={(value) => setFormData({ ...formData, classroom_id: value })}
                disabled={!formData.level_id}
              >
                <SelectTrigger>
                  <SelectValue placeholder={formData.level_id ? "Selecciona el aula" : "Primero selecciona un grado"} />
                </SelectTrigger>
                <SelectContent>
                  {filteredClassrooms.length > 0 ? (
                    filteredClassrooms.map((classroom) => (
                      <SelectItem key={classroom.id} value={classroom.id}>
                        {classroom.name}
                      </SelectItem>
                    ))
                  ) : (
                    <div className="p-2 text-sm text-muted-foreground text-center">
                      No hay aulas para este grado
                    </div>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Botones */}
            <div className="flex gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={onClose}
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
              <Button type="submit" className="flex-1" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  'Registrar Estudiante'
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}


