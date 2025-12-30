import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Users, 
  GraduationCap, 
  Building2,
  Search,
  DollarSign,
  Calendar,
  Mail,
  User
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

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
  balance: number;
  daily_limit: number | null;
  is_active: boolean;
  created_at: string;
  parent_id: string;
  school_id: string;
  parent?: {
    email: string;
    full_name: string;
  };
}

const StudentsManagement = () => {
  const { toast } = useToast();
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchool, setSelectedSchool] = useState<string>('all');
  const [students, setStudents] = useState<Student[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<Student[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSchools();
    fetchStudents();
  }, []);

  useEffect(() => {
    filterStudents();
  }, [students, selectedSchool, searchTerm]);

  const fetchSchools = async () => {
    try {
      const { data, error } = await supabase
        .from('schools')
        .select('*')
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
    }
  };

  const fetchStudents = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('students')
        .select(`
          *,
          parent:profiles!students_parent_id_fkey(email, full_name)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setStudents(data || []);
    } catch (error: any) {
      console.error('Error fetching students:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar los estudiantes',
      });
    } finally {
      setLoading(false);
    }
  };

  const filterStudents = () => {
    let filtered = students;

    // Filtrar por colegio
    if (selectedSchool !== 'all') {
      filtered = filtered.filter(s => s.school_id === selectedSchool);
    }

    // Filtrar por búsqueda
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(s => 
        s.full_name.toLowerCase().includes(term) ||
        s.grade.toLowerCase().includes(term) ||
        s.section.toLowerCase().includes(term) ||
        s.parent?.email?.toLowerCase().includes(term)
      );
    }

    setFilteredStudents(filtered);
  };

  const getSchoolName = (schoolId: string) => {
    const school = schools.find(s => s.id === schoolId);
    return school ? school.name : 'Sin sede';
  };

  const getStats = () => {
    const total = filteredStudents.length;
    const active = filteredStudents.filter(s => s.is_active).length;
    const totalBalance = filteredStudents.reduce((sum, s) => sum + s.balance, 0);
    
    return { total, active, totalBalance };
  };

  const stats = getStats();

  // Agrupar por colegio
  const studentsBySchool = schools.map(school => ({
    school,
    students: filteredStudents.filter(s => s.school_id === school.id),
    count: filteredStudents.filter(s => s.school_id === school.id).length,
  }));

  return (
    <div className="space-y-6">
      {/* Estadísticas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Users className="h-4 w-4" />
              Total Estudiantes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.active} activos
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Sedes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{schools.length}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {studentsBySchool.filter(s => s.count > 0).length} con estudiantes
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Saldo Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">S/ {stats.totalBalance.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              En todas las cuentas
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <GraduationCap className="h-5 w-5" />
                Estudiantes por Sede
              </CardTitle>
              <CardDescription>
                Todos los estudiantes registrados en el sistema
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nombre, grado, email del padre..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Select value={selectedSchool} onValueChange={setSelectedSchool}>
              <SelectTrigger className="w-[250px]">
                <SelectValue placeholder="Filtrar por sede" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las Sedes</SelectItem>
                {schools.map(school => (
                  <SelectItem key={school.id} value={school.id}>
                    {school.name} ({school.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="text-center py-8 text-muted-foreground">
              Cargando estudiantes...
            </div>
          ) : selectedSchool === 'all' ? (
            // Vista agrupada por sede
            <div className="space-y-6">
              {studentsBySchool.map(({ school, students: schoolStudents }) => (
                schoolStudents.length > 0 && (
                  <div key={school.id}>
                    <div className="flex items-center gap-2 mb-3">
                      <Building2 className="h-5 w-5 text-primary" />
                      <h3 className="text-lg font-bold">{school.name}</h3>
                      <Badge variant="secondary">{schoolStudents.length} estudiantes</Badge>
                    </div>
                    <div className="border rounded-lg overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Estudiante</TableHead>
                            <TableHead>Grado</TableHead>
                            <TableHead>Padre</TableHead>
                            <TableHead>Saldo</TableHead>
                            <TableHead>Límite Diario</TableHead>
                            <TableHead>Estado</TableHead>
                            <TableHead>Registrado</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {schoolStudents.map((student) => (
                            <TableRow key={student.id}>
                              <TableCell className="font-medium">
                                <div className="flex items-center gap-2">
                                  <User className="h-4 w-4 text-muted-foreground" />
                                  {student.full_name}
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">
                                  {student.grade} - {student.section}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2 text-sm">
                                  <Mail className="h-3 w-3 text-muted-foreground" />
                                  {student.parent?.email || 'Sin padre'}
                                </div>
                              </TableCell>
                              <TableCell>
                                <span className="font-mono font-semibold text-emerald-600">
                                  S/ {student.balance.toFixed(2)}
                                </span>
                              </TableCell>
                              <TableCell>
                                {student.daily_limit ? (
                                  <span className="font-mono text-sm">
                                    S/ {student.daily_limit.toFixed(2)}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground text-sm">Sin límite</span>
                                )}
                              </TableCell>
                              <TableCell>
                                {student.is_active ? (
                                  <Badge className="bg-green-500">Activo</Badge>
                                ) : (
                                  <Badge variant="destructive">Inactivo</Badge>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <Calendar className="h-3 w-3" />
                                  {format(new Date(student.created_at), 'dd MMM yyyy', { locale: es })}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )
              ))}
            </div>
          ) : (
            // Vista de una sola sede
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Estudiante</TableHead>
                    <TableHead>Grado</TableHead>
                    <TableHead>Padre</TableHead>
                    <TableHead>Saldo</TableHead>
                    <TableHead>Límite Diario</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Registrado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStudents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        No se encontraron estudiantes
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredStudents.map((student) => (
                      <TableRow key={student.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-muted-foreground" />
                            {student.full_name}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {student.grade} - {student.section}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-sm">
                            <Mail className="h-3 w-3 text-muted-foreground" />
                            {student.parent?.email || 'Sin padre'}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="font-mono font-semibold text-emerald-600">
                            S/ {student.balance.toFixed(2)}
                          </span>
                        </TableCell>
                        <TableCell>
                          {student.daily_limit ? (
                            <span className="font-mono text-sm">
                              S/ {student.daily_limit.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-sm">Sin límite</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {student.is_active ? (
                            <Badge className="bg-green-500">Activo</Badge>
                          ) : (
                            <Badge variant="destructive">Inactivo</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {format(new Date(student.created_at), 'dd MMM yyyy', { locale: es })}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default StudentsManagement;

