import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Plus, Trash2, GraduationCap, Users, Edit2, Check, X, School, Building2, Search, AlertTriangle, ArrowRight, Loader2, ShieldAlert } from 'lucide-react';

interface Level {
  id: string;
  name: string;
  order_index: number;
  student_count?: number;
}

interface Classroom {
  id: string;
  level_id: string;
  name: string;
  order_index: number;
  student_count?: number;
}

interface Student {
  id: string;
  full_name: string;
  grade: string;
  section: string;
  level_id: string | null;
  classroom_id: string | null;
  school_id: string;
  schools?: {
    name: string;
  };
}

interface SchoolWithStudents {
  id: string;
  name: string;
  students: Student[];
}

interface School {
  id: string;
  name: string;
}

interface GradesManagementProps {
  schoolId: string | null;
}

export const GradesManagement = ({ schoolId }: GradesManagementProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [userRole, setUserRole] = useState<string | null>(null);
  const [isAdminGeneral, setIsAdminGeneral] = useState(false);
  
  // Estado para Admin General: lista de sedes y sede seleccionada
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string | null>(schoolId);
  
  const [levels, setLevels] = useState<Level[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [allSchoolsStudents, setAllSchoolsStudents] = useState<SchoolWithStudents[]>([]);
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null);
  
  // Estados para filtros de búsqueda
  const [searchName, setSearchName] = useState('');
  const [searchGrade, setSearchGrade] = useState('');
  const [searchClassroom, setSearchClassroom] = useState('');
  
  // Función para filtrar estudiantes
  const filterStudents = (studentsList: Student[]) => {
    return studentsList.filter(student => {
      const matchesName = !searchName || 
        student.full_name?.toLowerCase().includes(searchName.toLowerCase());
      
      const matchesGrade = !searchGrade || 
        student.grade?.toLowerCase().includes(searchGrade.toLowerCase()) ||
        levels.find(l => l.id === student.level_id)?.name.toLowerCase().includes(searchGrade.toLowerCase());
      
      const matchesClassroom = !searchClassroom || 
        student.section?.toLowerCase().includes(searchClassroom.toLowerCase()) ||
        classrooms.find(c => c.id === student.classroom_id)?.name.toLowerCase().includes(searchClassroom.toLowerCase());
      
      return matchesName && matchesGrade && matchesClassroom;
    });
  };
  
  const [showNewLevelModal, setShowNewLevelModal] = useState(false);
  const [showNewClassroomModal, setShowNewClassroomModal] = useState(false);
  const [newLevelName, setNewLevelName] = useState('');
  const [newClassroomName, setNewClassroomName] = useState('');
  
  const [editingLevel, setEditingLevel] = useState<string | null>(null);
  const [editLevelName, setEditLevelName] = useState('');
  const [editingClassroom, setEditingClassroom] = useState<string | null>(null);
  const [editClassroomName, setEditClassroomName] = useState('');
  
  // Estados para modal de reasignación al eliminar GRADO
  const [showReassignLevelModal, setShowReassignLevelModal] = useState(false);
  const [levelToDelete, setLevelToDelete] = useState<Level | null>(null);
  const [targetLevelForReassign, setTargetLevelForReassign] = useState<string>('');
  const [targetClassroomForLevelReassign, setTargetClassroomForLevelReassign] = useState<string>('');
  const [targetClassroomsForReassign, setTargetClassroomsForReassign] = useState<Classroom[]>([]);
  const [studentsInLevelToDelete, setStudentsInLevelToDelete] = useState<Student[]>([]);
  const [isReassigning, setIsReassigning] = useState(false);
  
  // Estados para modal de reasignación al eliminar AULA
  const [showReassignClassroomModal, setShowReassignClassroomModal] = useState(false);
  const [classroomToDelete, setClassroomToDelete] = useState<Classroom | null>(null);
  const [targetClassroomForReassign, setTargetClassroomForReassign] = useState<string>('');
  const [studentsInClassroomToDelete, setStudentsInClassroomToDelete] = useState<Student[]>([]);

  useEffect(() => {
    if (user) {
      fetchUserRole();
    }
  }, [user]);

  useEffect(() => {
    if (isAdminGeneral) {
      // Admin General: cargar todas las sedes
      fetchSchools();
      fetchAllSchoolsStudents();
    }
    
    // Cargar datos de la sede seleccionada (Admin General o Admin de Sede)
    if (selectedSchoolId) {
      fetchLevels();
      fetchStudents();
    }
  }, [isAdminGeneral, selectedSchoolId]);

  useEffect(() => {
    if (selectedLevel && selectedSchoolId) {
      // console.log('🔄 [GradesManagement useEffect] Cargando aulas porque cambió selectedLevel:', selectedLevel);
      fetchClassrooms(selectedLevel);
    }
  }, [selectedLevel, selectedSchoolId]);

  const fetchUserRole = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      if (error) throw error;
      
      setUserRole(data.role);
      const isAdminGen = data.role === 'admin_general' || data.role === 'supervisor_red';
      setIsAdminGeneral(isAdminGen);
      
      // Si es Admin de Sede, usar su schoolId
      if (!isAdminGen) {
        setSelectedSchoolId(schoolId);
      }
    } catch (error: any) {
      console.error('Error fetching user role:', error);
    }
  };

  const fetchSchools = async () => {
    try {
      const { data, error } = await supabase
        .from('schools')
        .select('id, name')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setSchools(data || []);
      
      // Seleccionar la primera sede por defecto si es Admin General
      if (data && data.length > 0 && !selectedSchoolId) {
        setSelectedSchoolId(data[0].id);
      }
    } catch (error: any) {
      console.error('Error fetching schools:', error);
    }
  };

  const fetchLevels = async () => {
    if (!selectedSchoolId) return;
    
    // console.log('📚 [fetchLevels] Cargando niveles para school_id:', selectedSchoolId);
    
    try {
      const { data, error } = await supabase
        .from('school_levels')
        .select('*')
        .eq('school_id', selectedSchoolId)
        .eq('is_active', true)
        .order('order_index');

      if (error) throw error;

      // console.log('✅ [fetchLevels] Niveles cargados de BD:', data?.length || 0, data?.map(l => l.name));

      // Contar estudiantes por nivel
      const levelsWithCount = await Promise.all(
        (data || []).map(async (level) => {
          const { count } = await supabase
            .from('students')
            .select('*', { count: 'exact', head: true })
            .eq('level_id', level.id)
            .eq('is_active', true);
          
          return { ...level, student_count: count || 0 };
        })
      );

      setLevels(levelsWithCount);
      
      // Solo establecer el selectedLevel si no hay uno YA seleccionado
      // O si el seleccionado ya no existe en la nueva lista de niveles
      if (levelsWithCount.length > 0) {
        const selectedLevelExists = levelsWithCount.some(l => l.id === selectedLevel);
        // console.log('🔍 [fetchLevels] selectedLevel actual:', selectedLevel);
        // console.log('🔍 [fetchLevels] ¿El nivel seleccionado existe?:', selectedLevelExists);
        // console.log('🔍 [fetchLevels] Niveles disponibles:', levelsWithCount.map(l => ({ id: l.id, name: l.name })));
        
        if (!selectedLevel || !selectedLevelExists) {
          // console.log('📌 [GradesManagement] Estableciendo nivel inicial:', levelsWithCount[0].id, levelsWithCount[0].name);
          setSelectedLevel(levelsWithCount[0].id);
        } else {
          // console.log('✅ [GradesManagement] Manteniendo nivel seleccionado:', selectedLevel);
        }
      }
    } catch (error: any) {
      console.error('Error fetching levels:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los grados' });
    }
  };

  const fetchClassrooms = async (levelId: string) => {
    if (!selectedSchoolId) return;
    
    // console.log('🔍 [GradesManagement] Cargando aulas para level_id:', levelId, 'school_id:', selectedSchoolId);
    
    try {
      const { data, error } = await supabase
        .from('school_classrooms')
        .select('*')
        .eq('school_id', selectedSchoolId)
        .eq('level_id', levelId)
        // Removido temporalmente el filtro is_active para debugging
        // .eq('is_active', true)
        .order('order_index');

      if (error) throw error;

      // console.log('✅ [GradesManagement] Aulas encontradas:', data);
      // console.log('✅ [GradesManagement] Total de aulas:', data?.length || 0);

      // Contar estudiantes por aula
      const classroomsWithCount = await Promise.all(
        (data || []).map(async (classroom) => {
          const { count } = await supabase
            .from('students')
            .select('*', { count: 'exact', head: true })
            .eq('classroom_id', classroom.id)
            .eq('is_active', true);
          
          return { ...classroom, student_count: count || 0 };
        })
      );

      // console.log('✅ [GradesManagement] Aulas procesadas con contador:', classroomsWithCount);
      // console.log('✅ [GradesManagement] Estableciendo estado con', classroomsWithCount.length, 'aulas');
      
      setClassrooms(classroomsWithCount);
    } catch (error: any) {
      console.error('Error fetching classrooms:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar las aulas' });
    }
  };

  const fetchStudents = async () => {
    if (!selectedSchoolId) return;
    
    try {
      const { data, error } = await supabase
        .from('students')
        .select('id, full_name, grade, section, level_id, classroom_id, school_id')
        .eq('school_id', selectedSchoolId)
        .eq('is_active', true)
        .order('full_name');

      if (error) throw error;
      setStudents(data || []);
    } catch (error: any) {
      console.error('Error fetching students:', error);
    }
  };

  const fetchAllSchoolsStudents = async () => {
    try {
      // Obtener todas las sedes activas
      const { data: schoolsData, error: schoolsError } = await supabase
        .from('schools')
        .select('id, name')
        .eq('is_active', true)
        .order('name');

      if (schoolsError) throw schoolsError;

      // Obtener todos los estudiantes con su información de sede
      const { data: studentsData, error: studentsError } = await supabase
        .from('students')
        .select(`
          id, 
          full_name, 
          grade, 
          section, 
          level_id, 
          classroom_id, 
          school_id,
          schools (name)
        `)
        .eq('is_active', true)
        .order('full_name');

      if (studentsError) throw studentsError;

      // Agrupar estudiantes por sede
      const schoolsWithStudents: SchoolWithStudents[] = (schoolsData || []).map(school => ({
        id: school.id,
        name: school.name,
        students: (studentsData || []).filter((s: any) => s.school_id === school.id),
      }));

      setAllSchoolsStudents(schoolsWithStudents);
    } catch (error: any) {
      console.error('Error fetching all schools students:', error);
      toast({ 
        variant: 'destructive', 
        title: 'Error', 
        description: 'No se pudieron cargar los estudiantes de todas las sedes' 
      });
    }
  };

  const createLevel = async () => {
    if (!selectedSchoolId || !newLevelName.trim()) return;

    // console.log('📝 [createLevel] Creando nuevo grado:', newLevelName);

    try {
      const { data, error } = await supabase
        .from('school_levels')
        .insert({
          school_id: selectedSchoolId,
          name: newLevelName.trim(),
          order_index: levels.length,
          is_active: true, // ✅ CRÍTICO: Establecer is_active en true
        })
        .select()
        .single();

      if (error) throw error;

      // console.log('✅ [createLevel] Grado creado exitosamente:', data);

      toast({ title: '✅ Grado creado', description: `${newLevelName} agregado correctamente` });
      setNewLevelName('');
      setShowNewLevelModal(false);
      
      // Primero establecer el nuevo grado como seleccionado
      if (data) {
        // console.log('🆕 [createLevel] Seleccionando nuevo grado:', data.id, data.name);
        setSelectedLevel(data.id);
      }
      
      // Luego actualizar la lista
      fetchLevels();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  const createClassroom = async () => {
    if (!selectedSchoolId || !selectedLevel || !newClassroomName.trim()) return;

    // console.log('🎓 [GradesManagement] Creando aula:', { school_id, level_id, name });

    try {
      const { error } = await supabase
        .from('school_classrooms')
        .insert({
          school_id: selectedSchoolId,
          level_id: selectedLevel,
          name: newClassroomName.trim(),
          order_index: classrooms.length,
          is_active: true, // ✅ CRÍTICO: Establecer is_active en true
        });

      if (error) throw error;

      // console.log('✅ [GradesManagement] Aula creada exitosamente');

      toast({ title: '✅ Aula creada', description: `${newClassroomName} agregada correctamente` });
      setNewClassroomName('');
      setShowNewClassroomModal(false);
      fetchClassrooms(selectedLevel);
    } catch (error: any) {
      console.error('❌ [GradesManagement] Error al crear aula:', error);
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  const updateLevelName = async (levelId: string, newName: string) => {
    if (!newName.trim()) return;
    
    try {
      // 1. Actualizar el nombre del grado
      const { error } = await supabase
        .from('school_levels')
        .update({ name: newName.trim() })
        .eq('id', levelId);

      if (error) throw error;

      // 2. ✅ PROTECCIÓN: Actualizar campo legacy "grade" en todos los estudiantes vinculados
      const { error: studentError } = await supabase
        .from('students')
        .update({ grade: newName.trim() })
        .eq('level_id', levelId)
        .eq('is_active', true);

      if (studentError) {
        console.error('⚠️ Error actualizando campo legacy grade en estudiantes:', studentError);
      }

      toast({ 
        title: '✅ Grado actualizado', 
        description: `Se actualizó el nombre a "${newName.trim()}" en el grado y en todos los estudiantes vinculados.`
      });
      setEditingLevel(null);
      fetchLevels();
      fetchStudents();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  const updateClassroomName = async (classroomId: string, newName: string) => {
    if (!newName.trim()) return;
    
    try {
      // 1. Actualizar el nombre del aula
      const { error } = await supabase
        .from('school_classrooms')
        .update({ name: newName.trim() })
        .eq('id', classroomId);

      if (error) throw error;

      // 2. ✅ PROTECCIÓN: Actualizar campo legacy "section" en todos los estudiantes vinculados
      const { error: studentError } = await supabase
        .from('students')
        .update({ section: newName.trim() })
        .eq('classroom_id', classroomId)
        .eq('is_active', true);

      if (studentError) {
        console.error('⚠️ Error actualizando campo legacy section en estudiantes:', studentError);
      }

      toast({ 
        title: '✅ Aula actualizada',
        description: `Se actualizó el nombre a "${newName.trim()}" en el aula y en todos los estudiantes vinculados.`
      });
      setEditingClassroom(null);
      if (selectedLevel) fetchClassrooms(selectedLevel);
      fetchStudents();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  // ============================================
  // 🛡️ PROTECCIÓN: ELIMINAR GRADO
  // ============================================
  const deleteLevel = async (levelId: string) => {
    const level = levels.find(l => l.id === levelId);
    if (!level) return;

    // Contar estudiantes asignados a este grado
    const { count, error: countError } = await supabase
      .from('students')
      .select('*', { count: 'exact', head: true })
      .eq('level_id', levelId)
      .eq('is_active', true);

    if (countError) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo verificar los estudiantes del grado' });
      return;
    }

    const studentCount = count || 0;

    if (studentCount > 0) {
      // ⚠️ HAY ESTUDIANTES → Abrir modal de reasignación
      // Cargar los estudiantes afectados
      const { data: affectedStudents } = await supabase
        .from('students')
        .select('id, full_name, grade, section, level_id, classroom_id, school_id')
        .eq('level_id', levelId)
        .eq('is_active', true)
        .order('full_name');

      setLevelToDelete(level);
      setStudentsInLevelToDelete(affectedStudents || []);
      setTargetLevelForReassign('');
      setTargetClassroomForLevelReassign('');
      setTargetClassroomsForReassign([]);
      setShowReassignLevelModal(true);
    } else {
      // ✅ NO HAY ESTUDIANTES → Confirmar y eliminar directamente
      if (!confirm(`¿Estás seguro de eliminar el grado "${level.name}"? No tiene estudiantes asignados.`)) return;
      
      try {
        // También desactivar las aulas de este grado
        await supabase
          .from('school_classrooms')
          .update({ is_active: false })
          .eq('level_id', levelId);

        const { error } = await supabase
          .from('school_levels')
          .update({ is_active: false })
          .eq('id', levelId);

        if (error) throw error;

        toast({ title: '✅ Grado eliminado', description: `"${level.name}" fue eliminado correctamente (sin estudiantes afectados)` });
        setSelectedLevel(null);
        fetchLevels();
      } catch (error: any) {
        toast({ variant: 'destructive', title: 'Error', description: error.message });
      }
    }
  };

  // Cargar aulas del grado destino cuando se selecciona uno en el modal de reasignación
  const loadTargetClassrooms = async (targetLevelId: string) => {
    if (!selectedSchoolId) return;
    try {
      const { data, error } = await supabase
        .from('school_classrooms')
        .select('*')
        .eq('school_id', selectedSchoolId)
        .eq('level_id', targetLevelId)
        .eq('is_active', true)
        .order('order_index');

      if (error) throw error;

      // Contar estudiantes por aula
      const classroomsWithCount = await Promise.all(
        (data || []).map(async (classroom) => {
          const { count } = await supabase
            .from('students')
            .select('*', { count: 'exact', head: true })
            .eq('classroom_id', classroom.id)
            .eq('is_active', true);
          return { ...classroom, student_count: count || 0 };
        })
      );

      setTargetClassroomsForReassign(classroomsWithCount);
    } catch (error: any) {
      console.error('Error loading target classrooms:', error);
    }
  };

  // Ejecutar la reasignación de estudiantes y eliminar el grado
  const handleReassignAndDeleteLevel = async () => {
    if (!levelToDelete || !targetLevelForReassign || !targetClassroomForLevelReassign) return;
    
    setIsReassigning(true);
    try {
      const targetLevel = levels.find(l => l.id === targetLevelForReassign);
      const targetClassroom = targetClassroomsForReassign.find(c => c.id === targetClassroomForLevelReassign);

      // 1. Mover TODOS los estudiantes al nuevo grado y aula
      const { error: moveError } = await supabase
        .from('students')
        .update({ 
          level_id: targetLevelForReassign,
          classroom_id: targetClassroomForLevelReassign,
          grade: targetLevel?.name || '',
          section: targetClassroom?.name || ''
        })
        .eq('level_id', levelToDelete.id)
        .eq('is_active', true);

      if (moveError) throw moveError;

      // 2. Desactivar las aulas del grado eliminado
      await supabase
        .from('school_classrooms')
        .update({ is_active: false })
        .eq('level_id', levelToDelete.id);

      // 3. Desactivar el grado
      const { error: deleteError } = await supabase
        .from('school_levels')
        .update({ is_active: false })
        .eq('id', levelToDelete.id);

      if (deleteError) throw deleteError;

      toast({ 
        title: '✅ Grado eliminado correctamente', 
        description: `${studentsInLevelToDelete.length} estudiantes fueron movidos a "${targetLevel?.name}" → "${targetClassroom?.name}"`
      });

      // Limpiar y refrescar
      setShowReassignLevelModal(false);
      setLevelToDelete(null);
      setSelectedLevel(targetLevelForReassign);
      fetchLevels();
      fetchStudents();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error al reasignar', description: error.message });
    } finally {
      setIsReassigning(false);
    }
  };

  // ============================================
  // 🛡️ PROTECCIÓN: ELIMINAR AULA
  // ============================================
  const deleteClassroom = async (classroomId: string) => {
    const classroom = classrooms.find(c => c.id === classroomId);
    if (!classroom) return;

    // Contar estudiantes asignados a esta aula
    const { count, error: countError } = await supabase
      .from('students')
      .select('*', { count: 'exact', head: true })
      .eq('classroom_id', classroomId)
      .eq('is_active', true);

    if (countError) {
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo verificar los estudiantes del aula' });
      return;
    }

    const studentCount = count || 0;

    if (studentCount > 0) {
      // ⚠️ HAY ESTUDIANTES → Abrir modal de reasignación
      const { data: affectedStudents } = await supabase
        .from('students')
        .select('id, full_name, grade, section, level_id, classroom_id, school_id')
        .eq('classroom_id', classroomId)
        .eq('is_active', true)
        .order('full_name');

      setClassroomToDelete(classroom);
      setStudentsInClassroomToDelete(affectedStudents || []);
      setTargetClassroomForReassign('');
      setShowReassignClassroomModal(true);
    } else {
      // ✅ NO HAY ESTUDIANTES → Confirmar y eliminar directamente
      if (!confirm(`¿Estás seguro de eliminar el aula "${classroom.name}"? No tiene estudiantes asignados.`)) return;
      
      try {
        const { error } = await supabase
          .from('school_classrooms')
          .update({ is_active: false })
          .eq('id', classroomId);

        if (error) throw error;

        toast({ title: '✅ Aula eliminada', description: `"${classroom.name}" fue eliminada correctamente (sin estudiantes afectados)` });
        if (selectedLevel) fetchClassrooms(selectedLevel);
      } catch (error: any) {
        toast({ variant: 'destructive', title: 'Error', description: error.message });
      }
    }
  };

  // Ejecutar la reasignación de estudiantes y eliminar el aula
  const handleReassignAndDeleteClassroom = async () => {
    if (!classroomToDelete || !targetClassroomForReassign) return;
    
    setIsReassigning(true);
    try {
      const targetClassroom = classrooms.find(c => c.id === targetClassroomForReassign);

      // 1. Mover TODOS los estudiantes a la nueva aula
      const { error: moveError } = await supabase
        .from('students')
        .update({ 
          classroom_id: targetClassroomForReassign,
          section: targetClassroom?.name || ''
        })
        .eq('classroom_id', classroomToDelete.id)
        .eq('is_active', true);

      if (moveError) throw moveError;

      // 2. Desactivar el aula
      const { error: deleteError } = await supabase
        .from('school_classrooms')
        .update({ is_active: false })
        .eq('id', classroomToDelete.id);

      if (deleteError) throw deleteError;

      toast({ 
        title: '✅ Aula eliminada correctamente', 
        description: `${studentsInClassroomToDelete.length} estudiantes fueron movidos a "${targetClassroom?.name}"`
      });

      // Limpiar y refrescar
      setShowReassignClassroomModal(false);
      setClassroomToDelete(null);
      if (selectedLevel) fetchClassrooms(selectedLevel);
      fetchStudents();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error al reasignar', description: error.message });
    } finally {
      setIsReassigning(false);
    }
  };

  if (!selectedSchoolId && !isAdminGeneral) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <School className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p>No se pudo determinar la sede actual</p>
        </CardContent>
      </Card>
    );
  }

  const studentsInSelectedLevel = students.filter(s => s.level_id === selectedLevel);

  return (
    <div className="space-y-6">
      <Card className="border-2 shadow-lg">
        <CardHeader className="bg-gradient-to-r from-blue-50 to-cyan-50 border-b-2">
          <div className="flex justify-between items-center">
            <div className="flex-1">
              <CardTitle className="text-2xl flex items-center gap-3">
                <GraduationCap className="h-7 w-7 text-blue-600" />
                Grados y Salones Personalizables
              </CardTitle>
              <CardDescription className="text-base mt-2">
                Configura los niveles y aulas de tu sede según tu nomenclatura
              </CardDescription>
            </div>
            
            {/* Selector de Sede para Admin General */}
            {isAdminGeneral && schools.length > 0 && (
              <div className="w-72">
                <Label className="text-sm font-semibold mb-2 block">Seleccionar Sede:</Label>
                <Select value={selectedSchoolId || ''} onValueChange={setSelectedSchoolId}>
                  <SelectTrigger className="h-11 text-base font-medium">
                    <SelectValue placeholder="Selecciona una sede" />
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
            )}
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <Tabs defaultValue="levels">
            <TabsList className={`grid w-full ${isAdminGeneral ? 'grid-cols-3' : 'grid-cols-2'} mb-6`}>
              <TabsTrigger value="levels">
                <GraduationCap className="h-4 w-4 mr-2" />
                Grados/Niveles
              </TabsTrigger>
              <TabsTrigger value="students">
                <Users className="h-4 w-4 mr-2" />
                Ver Estudiantes ({students.length})
              </TabsTrigger>
              {isAdminGeneral && (
                <TabsTrigger value="all-schools">
                  <Building2 className="h-4 w-4 mr-2" />
                  Todas las Sedes
                </TabsTrigger>
              )}
            </TabsList>

            {/* Tab: Grados y Aulas */}
            <TabsContent value="levels">
              {/* Explicación del funcionamiento */}
              <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl">
                <div className="flex items-start gap-3">
                  <School className="h-6 w-6 text-blue-600 mt-1 flex-shrink-0" />
                  <div>
                    <h4 className="font-bold text-blue-900 mb-2">📚 ¿Cómo funciona?</h4>
                    <p className="text-blue-800 text-sm leading-relaxed">
                      Cada <strong>Grado/Nivel</strong> (ejemplo: "1er Grado", "Inicial 3 años") tiene sus propias <strong>Aulas/Secciones</strong> (ejemplo: "Aula A", "Aula B"). 
                      <br />
                      <span className="inline-block mt-2 font-semibold">
                        👉 Selecciona un grado de la izquierda para ver y gestionar sus aulas en la derecha.
                      </span>
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                {/* Columna Izquierda: Grados */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center bg-gradient-to-r from-blue-100 to-blue-50 p-3 rounded-lg border-2 border-blue-300">
                    <div>
                      <h3 className="font-bold text-lg text-blue-900 flex items-center gap-2">
                        <GraduationCap className="h-5 w-5" />
                        1️⃣ Grados/Niveles
                      </h3>
                      <p className="text-xs text-blue-700 mt-1">Haz clic para ver sus aulas →</p>
                    </div>
                    <Button onClick={() => setShowNewLevelModal(true)} size="sm" className="bg-blue-600 hover:bg-blue-700">
                      <Plus className="h-4 w-4 mr-2" />
                      Agregar Grado
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {levels.map((level) => (
                      <div
                        key={level.id}
                        className={`p-4 border-2 rounded-lg cursor-pointer transition ${
                          selectedLevel === level.id
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-blue-300'
                        }`}
                        onClick={() => setSelectedLevel(level.id)}
                      >
                        {editingLevel === level.id ? (
                          <div className="flex gap-2">
                            <Input
                              value={editLevelName}
                              onChange={(e) => setEditLevelName(e.target.value)}
                              className="h-8"
                              autoFocus
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateLevelName(level.id, editLevelName);
                              }}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingLevel(null);
                              }}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex justify-between items-center">
                            <div>
                              <p className="font-semibold">{level.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {level.student_count} estudiantes
                              </p>
                            </div>
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingLevel(level.id);
                                  setEditLevelName(level.name);
                                }}
                              >
                                <Edit2 className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteLevel(level.id);
                                }}
                                title={level.student_count && level.student_count > 0 
                                  ? `⚠️ ${level.student_count} estudiantes - Se requiere reasignar antes de eliminar` 
                                  : 'Eliminar grado'}
                              >
                                <Trash2 className={`h-3 w-3 ${level.student_count && level.student_count > 0 ? 'text-amber-500' : 'text-red-500'}`} />
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Columna Derecha: Aulas/Secciones */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center bg-gradient-to-r from-green-100 to-emerald-50 p-3 rounded-lg border-2 border-green-300">
                    <div>
                      <h3 className="font-bold text-lg text-green-900 flex items-center gap-2">
                        <Users className="h-5 w-5" />
                        2️⃣ Aulas/Secciones
                        {selectedLevel && (
                          <Badge className="ml-2 bg-green-600">
                            {levels.find(l => l.id === selectedLevel)?.name}
                          </Badge>
                        )}
                      </h3>
                      {!selectedLevel && (
                        <p className="text-xs text-green-700 mt-1">← Selecciona un grado primero</p>
                      )}
                    </div>
                    <Button
                      onClick={() => setShowNewClassroomModal(true)}
                      size="sm"
                      disabled={!selectedLevel}
                      className="bg-green-600 hover:bg-green-700 disabled:opacity-50"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Agregar Aula
                    </Button>
                  </div>
                  {selectedLevel ? (
                    <div className="space-y-2">
                      {classrooms.map((classroom) => (
                        <div
                          key={classroom.id}
                          className="p-4 border-2 border-gray-200 rounded-lg hover:border-green-300 transition"
                        >
                          {editingClassroom === classroom.id ? (
                            <div className="flex gap-2">
                              <Input
                                value={editClassroomName}
                                onChange={(e) => setEditClassroomName(e.target.value)}
                                className="h-8"
                                autoFocus
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => updateClassroomName(classroom.id, editClassroomName)}
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditingClassroom(null)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex justify-between items-center">
                              <div>
                                <p className="font-semibold">{classroom.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {classroom.student_count} estudiantes
                                </p>
                              </div>
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setEditingClassroom(classroom.id);
                                    setEditClassroomName(classroom.name);
                                  }}
                                >
                                  <Edit2 className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => deleteClassroom(classroom.id)}
                                  title={classroom.student_count && classroom.student_count > 0 
                                    ? `⚠️ ${classroom.student_count} estudiantes - Se requiere reasignar antes de eliminar` 
                                    : 'Eliminar aula'}
                                >
                                  <Trash2 className={`h-3 w-3 ${classroom.student_count && classroom.student_count > 0 ? 'text-amber-500' : 'text-red-500'}`} />
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                      {classrooms.length === 0 && (
                        <p className="text-center text-muted-foreground py-8">
                          No hay aulas creadas para este grado
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-12 bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl border-2 border-dashed border-amber-300">
                      <GraduationCap className="h-16 w-16 text-amber-400 mx-auto mb-4" />
                      <p className="text-amber-900 font-bold text-lg mb-2">👈 Selecciona un grado primero</p>
                      <p className="text-amber-700 text-sm">
                        Haz clic en un grado de la columna izquierda para ver sus aulas
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* Tab: Ver Estudiantes */}
            <TabsContent value="students">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="font-bold text-lg">
                      {isAdminGeneral ? 'Estudiantes de Mi Sede' : 'Todos los Estudiantes de esta Sede'}
                    </h3>
                    <Badge variant="outline">{filterStudents(students).length} de {students.length} estudiantes</Badge>
                  </div>
                  
                  {/* Filtros de Búsqueda */}
                  <Card className="border-2 border-blue-200 bg-blue-50/50">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Search className="h-5 w-5 text-blue-600" />
                        <h4 className="font-semibold text-blue-900">Buscar Estudiantes</h4>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <Label htmlFor="search-name" className="text-xs text-gray-700">Nombre del Estudiante</Label>
                          <Input
                            id="search-name"
                            placeholder="Ej: Juan Pérez"
                            value={searchName}
                            onChange={(e) => setSearchName(e.target.value)}
                            className="h-9"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="search-grade" className="text-xs text-gray-700">Grado/Nivel</Label>
                          <Input
                            id="search-grade"
                            placeholder="Ej: little"
                            value={searchGrade}
                            onChange={(e) => setSearchGrade(e.target.value)}
                            className="h-9"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="search-classroom" className="text-xs text-gray-700">Aula/Sección</Label>
                          <Input
                            id="search-classroom"
                            placeholder="Ej: geoge"
                            value={searchClassroom}
                            onChange={(e) => setSearchClassroom(e.target.value)}
                            className="h-9"
                          />
                        </div>
                      </div>
                      {(searchName || searchGrade || searchClassroom) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSearchName('');
                            setSearchGrade('');
                            setSearchClassroom('');
                          }}
                          className="mt-2 text-xs text-blue-600 hover:text-blue-800"
                        >
                          <X className="h-3 w-3 mr-1" />
                          Limpiar filtros
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filterStudents(students).map((student) => {
                      const level = levels.find(l => l.id === student.level_id);
                      const classroom = classrooms.find(c => c.id === student.classroom_id);
                      
                      return (
                        <Card key={student.id} className="border">
                          <CardContent className="p-4">
                            <p className="font-semibold">{student.full_name}</p>
                            <div className="flex gap-2 mt-2">
                              <Badge variant="secondary" className="text-xs">
                                {level?.name || student.grade || 'Sin grado'}
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                {classroom?.name || student.section || 'Sin aula'}
                              </Badge>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
            </TabsContent>

            {/* Tab: Todas las Sedes (Solo Admin General) */}
            {isAdminGeneral && (
              <TabsContent value="all-schools">
                <div className="space-y-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-xl">Estudiantes por Sede</h3>
                    <Badge variant="outline" className="text-base">
                      {allSchoolsStudents.reduce((acc, school) => 
                        acc + filterStudents(school.students).length, 0
                      )} de {allSchoolsStudents.reduce((acc, school) => acc + school.students.length, 0)} estudiantes totales
                    </Badge>
                  </div>
                  
                  {/* Filtros de Búsqueda Global */}
                  <Card className="border-2 border-purple-200 bg-purple-50/50">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Search className="h-5 w-5 text-purple-600" />
                        <h4 className="font-semibold text-purple-900">Buscar en Todas las Sedes</h4>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <Label htmlFor="search-name-all" className="text-xs text-gray-700">Nombre del Estudiante</Label>
                          <Input
                            id="search-name-all"
                            placeholder="Ej: Juan Pérez"
                            value={searchName}
                            onChange={(e) => setSearchName(e.target.value)}
                            className="h-9"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="search-grade-all" className="text-xs text-gray-700">Grado/Nivel</Label>
                          <Input
                            id="search-grade-all"
                            placeholder="Ej: little"
                            value={searchGrade}
                            onChange={(e) => setSearchGrade(e.target.value)}
                            className="h-9"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="search-classroom-all" className="text-xs text-gray-700">Aula/Sección</Label>
                          <Input
                            id="search-classroom-all"
                            placeholder="Ej: geoge"
                            value={searchClassroom}
                            onChange={(e) => setSearchClassroom(e.target.value)}
                            className="h-9"
                          />
                        </div>
                      </div>
                      {(searchName || searchGrade || searchClassroom) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSearchName('');
                            setSearchGrade('');
                            setSearchClassroom('');
                          }}
                          className="mt-2 text-xs text-purple-600 hover:text-purple-800"
                        >
                          <X className="h-3 w-3 mr-1" />
                          Limpiar filtros
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                  
                  {allSchoolsStudents.map((school) => {
                    const filteredSchoolStudents = filterStudents(school.students);
                    if (filteredSchoolStudents.length === 0 && (searchName || searchGrade || searchClassroom)) {
                      return null; // No mostrar sedes sin resultados cuando hay filtros activos
                    }
                    
                    return (
                    <Card key={school.id} className="border-2 shadow-md">
                      <CardHeader className="bg-gradient-to-r from-purple-50 to-pink-50 border-b-2">
                        <div className="flex justify-between items-center">
                          <CardTitle className="flex items-center gap-2 text-xl">
                            <Building2 className="h-6 w-6 text-purple-600" />
                            {school.name}
                          </CardTitle>
                          <Badge variant="secondary" className="text-base">
                            {filteredSchoolStudents.length} {filteredSchoolStudents.length !== school.students.length && `de ${school.students.length}`} estudiantes
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="p-6">
                        {filteredSchoolStudents.length > 0 ? (
                          <div className="rounded-lg border overflow-hidden">
                            <Table>
                              <TableHeader>
                                <TableRow className="bg-gray-50">
                                  <TableHead className="font-bold">Nombre Completo</TableHead>
                                  <TableHead className="font-bold">Grado/Nivel</TableHead>
                                  <TableHead className="font-bold">Aula/Sección</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {filteredSchoolStudents.map((student) => (
                                  <TableRow key={student.id} className="hover:bg-gray-50">
                                    <TableCell className="font-medium">{student.full_name}</TableCell>
                                    <TableCell>
                                      <Badge variant="secondary" className="text-xs">
                                        {student.grade || 'Sin grado'}
                                      </Badge>
                                    </TableCell>
                                    <TableCell>
                                      <Badge variant="outline" className="text-xs">
                                        {student.section || 'Sin aula'}
                                      </Badge>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        ) : (
                          <div className="text-center py-8 text-muted-foreground">
                            <Users className="h-12 w-12 mx-auto mb-2 opacity-30" />
                            <p>No hay estudiantes registrados en esta sede</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                    );
                  })}

                  {allSchoolsStudents.length === 0 && (
                    <Card>
                      <CardContent className="py-12 text-center text-muted-foreground">
                        <School className="h-12 w-12 mx-auto mb-4 opacity-30" />
                        <p>No hay sedes registradas</p>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </TabsContent>
            )}
          </Tabs>
        </CardContent>
      </Card>

      {/* Modal: Crear Grado */}
      <Dialog open={showNewLevelModal} onOpenChange={setShowNewLevelModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crear Nuevo Grado/Nivel</DialogTitle>
            <DialogDescription>
              Configura un nuevo grado o nivel para tu sede educativa
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nombre del Grado</Label>
              <Input
                value={newLevelName}
                onChange={(e) => setNewLevelName(e.target.value)}
                placeholder="Ej: 1er Grado, Sala Azul, Nivel A"
                autoFocus
              />
              <p className="text-xs text-muted-foreground mt-1">
                Puedes usar el nombre que prefieras: grados, niveles, salas, colores, etc.
              </p>
            </div>
            <Button onClick={createLevel} disabled={!newLevelName.trim()} className="w-full">
              Crear Grado
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Crear Aula */}
      <Dialog open={showNewClassroomModal} onOpenChange={setShowNewClassroomModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crear Nueva Aula/Sección</DialogTitle>
            <DialogDescription>
              Configura una nueva aula o sección para el grado seleccionado
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nombre del Aula</Label>
              <Input
                value={newClassroomName}
                onChange={(e) => setNewClassroomName(e.target.value)}
                placeholder="Ej: Sección A, Leones, Amarillo"
                autoFocus
              />
              <p className="text-xs text-muted-foreground mt-1">
                Puedes usar el nombre que prefieras: secciones, animales, colores, etc.
              </p>
            </div>
            <Button onClick={createClassroom} disabled={!newClassroomName.trim()} className="w-full">
              Crear Aula
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ============================================ */}
      {/* 🛡️ MODAL: Reasignar estudiantes antes de eliminar GRADO */}
      {/* ============================================ */}
      <Dialog open={showReassignLevelModal} onOpenChange={(open) => {
        if (!isReassigning) setShowReassignLevelModal(open);
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <ShieldAlert className="h-6 w-6" />
              ⚠️ No se puede eliminar el grado "{levelToDelete?.name}"
            </DialogTitle>
            <DialogDescription className="text-base">
              Este grado tiene estudiantes asignados. Debes moverlos a otro grado y aula antes de eliminarlo.
            </DialogDescription>
          </DialogHeader>

          {/* Advertencia visual */}
          <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-8 w-8 text-red-600 flex-shrink-0" />
              <div>
                <p className="font-bold text-red-800 text-lg">
                  {studentsInLevelToDelete.length} estudiante{studentsInLevelToDelete.length !== 1 ? 's' : ''} será{studentsInLevelToDelete.length !== 1 ? 'n' : ''} movido{studentsInLevelToDelete.length !== 1 ? 's' : ''}
                </p>
                <p className="text-red-700 text-sm mt-1">
                  Todos los niños de "{levelToDelete?.name}" deben ser reasignados a otro grado y aula para poder eliminar este grado.
                </p>
              </div>
            </div>
          </div>

          {/* Lista de estudiantes afectados */}
          <div className="border-2 rounded-lg overflow-hidden">
            <div className="bg-amber-50 px-4 py-2 border-b-2 border-amber-200">
              <p className="font-bold text-amber-900 text-sm">
                👦 Estudiantes en "{levelToDelete?.name}" que serán reasignados:
              </p>
            </div>
            <div className="max-h-40 overflow-y-auto p-2">
              {studentsInLevelToDelete.map((student, i) => (
                <div key={student.id} className="flex items-center gap-2 py-1 px-2 text-sm hover:bg-gray-50 rounded">
                  <span className="text-gray-400 w-6 text-right">{i + 1}.</span>
                  <span className="font-medium">{student.full_name}</span>
                  {student.section && (
                    <Badge variant="outline" className="text-xs ml-auto">{student.section}</Badge>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Selector de destino */}
          <div className="space-y-4 bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
            <h4 className="font-bold text-blue-900 flex items-center gap-2">
              <ArrowRight className="h-5 w-5" />
              Selecciona el nuevo destino:
            </h4>

            <div className="space-y-3">
              <div>
                <Label className="font-semibold">1️⃣ Nuevo Grado/Nivel:</Label>
                <Select 
                  value={targetLevelForReassign} 
                  onValueChange={(val) => {
                    setTargetLevelForReassign(val);
                    setTargetClassroomForLevelReassign('');
                    loadTargetClassrooms(val);
                  }}
                >
                  <SelectTrigger className="mt-1 bg-white">
                    <SelectValue placeholder="Selecciona el grado destino..." />
                  </SelectTrigger>
                  <SelectContent>
                    {levels.filter(l => l.id !== levelToDelete?.id).map(level => (
                      <SelectItem key={level.id} value={level.id}>
                        {level.name} ({level.student_count} estudiantes)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {targetLevelForReassign && (
                <div>
                  <Label className="font-semibold">2️⃣ Nueva Aula/Sección:</Label>
                  {targetClassroomsForReassign.length > 0 ? (
                    <Select 
                      value={targetClassroomForLevelReassign} 
                      onValueChange={setTargetClassroomForLevelReassign}
                    >
                      <SelectTrigger className="mt-1 bg-white">
                        <SelectValue placeholder="Selecciona el aula destino..." />
                      </SelectTrigger>
                      <SelectContent>
                        {targetClassroomsForReassign.map(classroom => (
                          <SelectItem key={classroom.id} value={classroom.id}>
                            {classroom.name} ({classroom.student_count} estudiantes)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="mt-1 p-3 bg-amber-100 border-2 border-amber-300 rounded-lg">
                      <p className="text-amber-800 text-sm font-medium">
                        ⚠️ El grado seleccionado no tiene aulas. Crea al menos un aula primero.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Resumen de la acción */}
            {targetLevelForReassign && targetClassroomForLevelReassign && (
              <div className="bg-green-50 border-2 border-green-300 rounded-lg p-3 mt-3">
                <p className="text-green-800 font-medium text-sm">
                  ✅ Se moverán <strong>{studentsInLevelToDelete.length} estudiantes</strong> de "{levelToDelete?.name}" → "{levels.find(l => l.id === targetLevelForReassign)?.name}" / "{targetClassroomsForReassign.find(c => c.id === targetClassroomForLevelReassign)?.name}"
                </p>
              </div>
            )}
          </div>

          {/* Botones de acción */}
          <div className="flex gap-3 pt-2">
            <Button 
              variant="outline" 
              onClick={() => setShowReassignLevelModal(false)}
              disabled={isReassigning}
              className="flex-1"
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleReassignAndDeleteLevel}
              disabled={!targetLevelForReassign || !targetClassroomForLevelReassign || isReassigning}
              className="flex-1"
            >
              {isReassigning ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Reasignando...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Mover Estudiantes y Eliminar Grado
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ============================================ */}
      {/* 🛡️ MODAL: Reasignar estudiantes antes de eliminar AULA */}
      {/* ============================================ */}
      <Dialog open={showReassignClassroomModal} onOpenChange={(open) => {
        if (!isReassigning) setShowReassignClassroomModal(open);
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <ShieldAlert className="h-6 w-6" />
              ⚠️ No se puede eliminar el aula "{classroomToDelete?.name}"
            </DialogTitle>
            <DialogDescription className="text-base">
              Esta aula tiene estudiantes asignados. Debes moverlos a otra aula del mismo grado antes de eliminarla.
            </DialogDescription>
          </DialogHeader>

          {/* Advertencia visual */}
          <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-8 w-8 text-red-600 flex-shrink-0" />
              <div>
                <p className="font-bold text-red-800 text-lg">
                  {studentsInClassroomToDelete.length} estudiante{studentsInClassroomToDelete.length !== 1 ? 's' : ''} será{studentsInClassroomToDelete.length !== 1 ? 'n' : ''} movido{studentsInClassroomToDelete.length !== 1 ? 's' : ''}
                </p>
                <p className="text-red-700 text-sm mt-1">
                  Todos los niños de "{classroomToDelete?.name}" deben ser reasignados a otra aula para poder eliminar esta aula.
                </p>
              </div>
            </div>
          </div>

          {/* Lista de estudiantes afectados */}
          <div className="border-2 rounded-lg overflow-hidden">
            <div className="bg-amber-50 px-4 py-2 border-b-2 border-amber-200">
              <p className="font-bold text-amber-900 text-sm">
                👦 Estudiantes en "{classroomToDelete?.name}" que serán reasignados:
              </p>
            </div>
            <div className="max-h-40 overflow-y-auto p-2">
              {studentsInClassroomToDelete.map((student, i) => (
                <div key={student.id} className="flex items-center gap-2 py-1 px-2 text-sm hover:bg-gray-50 rounded">
                  <span className="text-gray-400 w-6 text-right">{i + 1}.</span>
                  <span className="font-medium">{student.full_name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Selector de destino */}
          <div className="space-y-4 bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
            <h4 className="font-bold text-blue-900 flex items-center gap-2">
              <ArrowRight className="h-5 w-5" />
              Selecciona la nueva aula destino:
            </h4>

            {classrooms.filter(c => c.id !== classroomToDelete?.id).length > 0 ? (
              <div>
                <Label className="font-semibold">Nueva Aula/Sección (mismo grado: {levels.find(l => l.id === selectedLevel)?.name}):</Label>
                <Select 
                  value={targetClassroomForReassign} 
                  onValueChange={setTargetClassroomForReassign}
                >
                  <SelectTrigger className="mt-1 bg-white">
                    <SelectValue placeholder="Selecciona el aula destino..." />
                  </SelectTrigger>
                  <SelectContent>
                    {classrooms.filter(c => c.id !== classroomToDelete?.id).map(classroom => (
                      <SelectItem key={classroom.id} value={classroom.id}>
                        {classroom.name} ({classroom.student_count} estudiantes)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="p-4 bg-amber-100 border-2 border-amber-300 rounded-lg">
                <p className="text-amber-800 font-medium">
                  ⚠️ No hay otras aulas en este grado. Crea otra aula primero, o elimina el grado completo para reasignar a otro grado.
                </p>
              </div>
            )}

            {/* Resumen de la acción */}
            {targetClassroomForReassign && (
              <div className="bg-green-50 border-2 border-green-300 rounded-lg p-3 mt-3">
                <p className="text-green-800 font-medium text-sm">
                  ✅ Se moverán <strong>{studentsInClassroomToDelete.length} estudiantes</strong> de "{classroomToDelete?.name}" → "{classrooms.find(c => c.id === targetClassroomForReassign)?.name}"
                </p>
              </div>
            )}
          </div>

          {/* Botones de acción */}
          <div className="flex gap-3 pt-2">
            <Button 
              variant="outline" 
              onClick={() => setShowReassignClassroomModal(false)}
              disabled={isReassigning}
              className="flex-1"
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleReassignAndDeleteClassroom}
              disabled={!targetClassroomForReassign || isReassigning}
              className="flex-1"
            >
              {isReassigning ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Reasignando...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Mover Estudiantes y Eliminar Aula
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
