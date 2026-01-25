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
import { Plus, Trash2, GraduationCap, Users, Edit2, Check, X, School, Building2 } from 'lucide-react';

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
  
  const [showNewLevelModal, setShowNewLevelModal] = useState(false);
  const [showNewClassroomModal, setShowNewClassroomModal] = useState(false);
  const [newLevelName, setNewLevelName] = useState('');
  const [newClassroomName, setNewClassroomName] = useState('');
  
  const [editingLevel, setEditingLevel] = useState<string | null>(null);
  const [editLevelName, setEditLevelName] = useState('');
  const [editingClassroom, setEditingClassroom] = useState<string | null>(null);
  const [editClassroomName, setEditClassroomName] = useState('');

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
    
    try {
      const { data, error } = await supabase
        .from('school_levels')
        .select('*')
        .eq('school_id', selectedSchoolId)
        .eq('is_active', true)
        .order('order_index');

      if (error) throw error;

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
      
      if (levelsWithCount.length > 0 && !selectedLevel) {
        setSelectedLevel(levelsWithCount[0].id);
      }
    } catch (error: any) {
      console.error('Error fetching levels:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudieron cargar los grados' });
    }
  };

  const fetchClassrooms = async (levelId: string) => {
    if (!selectedSchoolId) return;
    
    try {
      const { data, error } = await supabase
        .from('school_classrooms')
        .select('*')
        .eq('school_id', selectedSchoolId)
        .eq('level_id', levelId)
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

    try {
      const { error } = await supabase
        .from('school_levels')
        .insert({
          school_id: selectedSchoolId,
          name: newLevelName.trim(),
          order_index: levels.length,
        });

      if (error) throw error;

      toast({ title: '✅ Grado creado', description: `${newLevelName} agregado correctamente` });
      setNewLevelName('');
      setShowNewLevelModal(false);
      fetchLevels();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  const createClassroom = async () => {
    if (!selectedSchoolId || !selectedLevel || !newClassroomName.trim()) return;

    try {
      const { error } = await supabase
        .from('school_classrooms')
        .insert({
          school_id: selectedSchoolId,
          level_id: selectedLevel,
          name: newClassroomName.trim(),
          order_index: classrooms.length,
        });

      if (error) throw error;

      toast({ title: '✅ Aula creada', description: `${newClassroomName} agregada correctamente` });
      setNewClassroomName('');
      setShowNewClassroomModal(false);
      fetchClassrooms(selectedLevel);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  const updateLevelName = async (levelId: string, newName: string) => {
    if (!newName.trim()) return;
    
    try {
      const { error } = await supabase
        .from('school_levels')
        .update({ name: newName.trim() })
        .eq('id', levelId);

      if (error) throw error;

      toast({ title: '✅ Grado actualizado' });
      setEditingLevel(null);
      fetchLevels();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  const updateClassroomName = async (classroomId: string, newName: string) => {
    if (!newName.trim()) return;
    
    try {
      const { error } = await supabase
        .from('school_classrooms')
        .update({ name: newName.trim() })
        .eq('id', classroomId);

      if (error) throw error;

      toast({ title: '✅ Aula actualizada' });
      setEditingClassroom(null);
      if (selectedLevel) fetchClassrooms(selectedLevel);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  const deleteLevel = async (levelId: string) => {
    if (!confirm('¿Estás seguro? Los estudiantes asignados quedarán sin grado.')) return;

    try {
      const { error } = await supabase
        .from('school_levels')
        .update({ is_active: false })
        .eq('id', levelId);

      if (error) throw error;

      toast({ title: '✅ Grado eliminado' });
      fetchLevels();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    }
  };

  const deleteClassroom = async (classroomId: string) => {
    if (!confirm('¿Estás seguro? Los estudiantes asignados quedarán sin aula.')) return;

    try {
      const { error } = await supabase
        .from('school_classrooms')
        .update({ is_active: false })
        .eq('id', classroomId);

      if (error) throw error;

      toast({ title: '✅ Aula eliminada' });
      if (selectedLevel) fetchClassrooms(selectedLevel);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
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
              <div className="grid grid-cols-2 gap-6">
                {/* Columna Izquierda: Grados */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="font-bold text-lg">Grados/Niveles</h3>
                    <Button onClick={() => setShowNewLevelModal(true)} size="sm">
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
                              >
                                <Trash2 className="h-3 w-3 text-red-500" />
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
                  <div className="flex justify-between items-center">
                    <h3 className="font-bold text-lg">
                      Aulas/Secciones
                      {selectedLevel && (
                        <span className="text-sm text-muted-foreground ml-2">
                          ({levels.find(l => l.id === selectedLevel)?.name})
                        </span>
                      )}
                    </h3>
                    <Button
                      onClick={() => setShowNewClassroomModal(true)}
                      size="sm"
                      disabled={!selectedLevel}
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
                                >
                                  <Trash2 className="h-3 w-3 text-red-500" />
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
                    <p className="text-center text-muted-foreground py-8">
                      Selecciona un grado para ver sus aulas
                    </p>
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
                    <Badge variant="outline">{students.length} estudiantes</Badge>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {students.map((student) => {
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
                      {allSchoolsStudents.reduce((acc, school) => acc + school.students.length, 0)} estudiantes totales
                    </Badge>
                  </div>
                  
                  {allSchoolsStudents.map((school) => (
                    <Card key={school.id} className="border-2 shadow-md">
                      <CardHeader className="bg-gradient-to-r from-purple-50 to-pink-50 border-b-2">
                        <div className="flex justify-between items-center">
                          <CardTitle className="flex items-center gap-2 text-xl">
                            <Building2 className="h-6 w-6 text-purple-600" />
                            {school.name}
                          </CardTitle>
                          <Badge variant="secondary" className="text-base">
                            {school.students.length} estudiantes
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="p-6">
                        {school.students.length > 0 ? (
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
                                {school.students.map((student) => (
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
                  ))}

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
    </div>
  );
};
