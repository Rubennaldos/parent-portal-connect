import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Search, Users, BarChart3, FileText, Plus, Edit, Download, Baby, UserCircle, ArrowLeft, Mail, Phone, MapPin, CreditCard, Wallet, User2, IdCard } from 'lucide-react';
import { ParentAnalyticsDashboard } from '@/components/admin/ParentAnalyticsDashboard';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

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
  photo_url?: string;
  free_account?: boolean; // true = cuenta libre, false = con recarga
  limit_type?: 'none' | 'daily' | 'weekly' | 'monthly';
  daily_limit?: number;
  weekly_limit?: number;
  monthly_limit?: number;
  balance?: number; // Saldo actual (si es con recarga)
  school_id?: string;
}

interface ParentProfile {
  id: string;
  user_id: string;
  full_name: string;
  nickname?: string;
  dni: string;
  document_type?: string;
  phone_1: string;
  phone_2?: string;
  email?: string;
  address: string;
  // Segundo Responsable
  responsible_2_full_name?: string;
  responsible_2_dni?: string;
  responsible_2_document_type?: string;
  responsible_2_phone_1?: string;
  responsible_2_email?: string;
  responsible_2_address?: string;
  // Otros
  school_id: string;
  school: School | null;
  children?: Student[];
  created_at: string;
}

interface TeacherProfile {
  id: string;
  full_name: string;
  dni: string;
  document_type?: string;
  phone_1: string;
  corporate_phone?: string;
  email: string;
  corporate_email?: string;
  address?: string;
  work_area?: string;
  school_1?: string;
  school_2?: string;
  school_1_data?: School | null;
  school_2_data?: School | null;
  created_at: string;
}

const ParentConfiguration = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const { role, canViewAllSchools: canViewAllSchoolsHook } = useRole();
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [parents, setParents] = useState<ParentProfile[]>([]);
  const [teachers, setTeachers] = useState<TeacherProfile[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchTermTeacher, setSearchTermTeacher] = useState('');
  const [selectedSchool, setSelectedSchool] = useState<string>('all');
  const [selectedSchoolTeacher, setSelectedSchoolTeacher] = useState<string>('all');
  const [selectedSchoolAnalytics, setSelectedSchoolAnalytics] = useState<string>('all');
  
  // Permisos
  const [canViewAllSchools, setCanViewAllSchools] = useState(false);
  const [userSchoolId, setUserSchoolId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState({
    canCreateParent: false,
    canEditParent: false,
    canCreateStudent: false,
    canEditStudent: false,
  });
  
  // Modales
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showChildrenModal, setShowChildrenModal] = useState(false);
  
  // Datos seleccionados
  const [selectedParent, setSelectedParent] = useState<ParentProfile | null>(null);
  const [parentChildren, setParentChildren] = useState<Student[]>([]);
  
  // Formulario
  const [formData, setFormData] = useState({
    full_name: '',
    nickname: '',
    dni: '',
    phone_1: '',
    phone_2: '',
    email: '',
    address: '',
    school_id: '',
    password: '',
  });

  useEffect(() => {
    checkPermissions();
  }, [user, role]);

  useEffect(() => {
    if (!loading && (canViewAllSchools || userSchoolId)) {
      fetchData();
    }
  }, [canViewAllSchools, userSchoolId]);

  const checkPermissions = async () => {
    if (!user || !role) return;

    try {
      console.log('🔍 Verificando permisos de Config Padres para rol:', role);

      // Admin General tiene acceso total
      if (role === 'admin_general') {
        setCanViewAllSchools(true);
        setPermissions({
          canCreateParent: true,
          canEditParent: true,
          canCreateStudent: true,
          canEditStudent: true,
        });
        setLoading(false);
        return;
      }

      // Obtener school_id del usuario actual
      const { data: profileData } = await supabase
        .from('profiles')
        .select('school_id')
        .eq('id', user.id)
        .single();

      if (profileData?.school_id) {
        setUserSchoolId(profileData.school_id);
        console.log('🏫 School ID del usuario:', profileData.school_id);
      }

      // Consultar permisos del rol
      const { data, error } = await supabase
        .from('role_permissions')
        .select(`
          granted,
          permissions (
            module,
            action
          )
        `)
        .eq('role', role)
        .eq('granted', true);

      if (error) {
        console.error('❌ Error consultando permisos:', error);
        setLoading(false);
        return;
      }

      // Mapear permisos
      let canViewAll = false;
      let perms = {
        canCreateParent: false,
        canEditParent: false,
        canCreateStudent: false,
        canEditStudent: false,
      };

      data?.forEach((perm: any) => {
        const permission = perm.permissions;
        if (permission?.module === 'config_padres') {
          switch (permission.action) {
            case 'ver_todas_sedes':
              canViewAll = true;
              break;
            case 'crear_padre':
              perms.canCreateParent = true;
              break;
            case 'editar_padre':
              perms.canEditParent = true;
              break;
            case 'crear_estudiante':
              perms.canCreateStudent = true;
              break;
            case 'editar_estudiante':
              perms.canEditStudent = true;
              break;
          }
        }
      });

      console.log('✅ Permisos finales:', perms);
      console.log('✅ Puede ver todas las sedes:', canViewAll);
      
      setPermissions(perms);
      setCanViewAllSchools(canViewAll);
      setLoading(false);

    } catch (error) {
      console.error('Error checking permissions:', error);
      setLoading(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      // Obtener escuelas
      const { data: schoolsData, error: schoolsError } = await supabase
        .from('schools')
        .select('*')
        .order('name');
      
      if (schoolsError) throw schoolsError;
      setSchools(schoolsData || []);

      // Construir query de padres con filtro de sede
      let query = supabase
        .from('parent_profiles')
        .select(`
          *,
          school:schools(id, name, code),
          responsible_2_full_name,
          responsible_2_dni,
          responsible_2_document_type,
          responsible_2_phone_1,
          responsible_2_email,
          responsible_2_address
        `);

      // Aplicar filtro de sede según permisos
      if (!canViewAllSchools && userSchoolId) {
        console.log('🔒 Filtrando por sede:', userSchoolId);
        query = query.eq('school_id', userSchoolId);
      } else {
        console.log('🌍 Viendo todas las sedes');
      }

      const { data: parentsData, error: parentsError } = await query.order('full_name');
      
      if (parentsError) {
        console.error('❌ Error al cargar padres:', parentsError);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: `Error al cargar padres: ${parentsError.message}`,
        });
        throw parentsError;
      }
      
      console.log('📊 Padres encontrados:', parentsData?.length || 0);
      
      if (!parentsData || parentsData.length === 0) {
        console.log('⚠️ No hay padres en la base de datos');
        setParents([]);
        setLoading(false);
        return;
      }
      
      // Obtener todos los hijos en una sola consulta
      const userIds = parentsData.map(p => p.user_id).filter(Boolean);
      
      let studentsData = [];
      if (userIds.length > 0) {
        const { data, error: studentsError } = await supabase
          .from('students')
          .select('id, full_name, grade, section, parent_id, photo_url, free_account, limit_type, daily_limit, weekly_limit, monthly_limit, balance, school_id')
          .in('parent_id', userIds);
        
        if (studentsError) {
          console.error('❌ Error al cargar estudiantes:', studentsError);
        } else {
          studentsData = data || [];
        }
      }
      
      // Mapear hijos a sus padres
      const parentsWithChildren = parentsData.map(parent => ({
        ...parent,
        children: studentsData.filter((s: any) => s.parent_id === parent.user_id)
      }));
      
      setParents(parentsWithChildren);

      // ==================== CARGAR PROFESORES ====================
      let teachersQuery = supabase
        .from('teacher_profiles')
        .select('*');

      // Aplicar filtro de sede según permisos
      if (!canViewAllSchools && userSchoolId) {
        console.log('🔒 Filtrando profesores por sede:', userSchoolId);
        teachersQuery = teachersQuery.or(`school_id_1.eq.${userSchoolId},school_id_2.eq.${userSchoolId}`);
      } else {
        console.log('🌍 Viendo todos los profesores');
      }

      const { data: teachersData, error: teachersError } = await teachersQuery.order('full_name');
      
      if (teachersError) {
        console.error('❌ Error al cargar profesores:', teachersError);
      } else {
        console.log('👨‍🏫 Profesores encontrados:', teachersData?.length || 0);
        
        // Enriquecer con datos de sedes
        const teachersWithSchools = await Promise.all(
          (teachersData || []).map(async (teacher) => {
            let school_1_data = null;
            let school_2_data = null;

            if (teacher.school_1) {
              const { data: s1 } = await supabase
                .from('schools')
                .select('id, name, code')
                .eq('id', teacher.school_1)
                .single();
              school_1_data = s1;
            }

            if (teacher.school_2) {
              const { data: s2 } = await supabase
                .from('schools')
                .select('id, name, code')
                .eq('id', teacher.school_2)
                .single();
              school_2_data = s2;
            }

            return {
              ...teacher,
              school_1_data,
              school_2_data,
            };
          })
        );

        setTeachers(teachersWithSchools);
      }
    } catch (error) {
      console.error('Error al cargar datos:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar los datos de padres.',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateParent = async () => {
    if (!formData.full_name || !formData.dni || !formData.phone_1 || !formData.school_id || !formData.password) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Por favor completa todos los campos obligatorios.',
      });
      return;
    }

    try {
      // Crear usuario en auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: formData.email || `parent_${formData.dni}@parent.local`,
        password: formData.password,
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error('No se pudo crear el usuario');

      // Actualizar perfil
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          full_name: formData.full_name,
          role: 'parent',
          school_id: formData.school_id,
        })
        .eq('id', authData.user.id);

      if (profileError) throw profileError;

      // Crear perfil de padre
      const { error: parentProfileError } = await supabase
        .from('parent_profiles')
        .insert({
          user_id: authData.user.id,
          full_name: formData.full_name,
          nickname: formData.nickname || null,
          dni: formData.dni,
          phone_1: formData.phone_1,
          phone_2: formData.phone_2 || null,
          email: formData.email || null,
          address: formData.address,
          school_id: formData.school_id,
        });

      if (parentProfileError) throw parentProfileError;

      toast({
        title: '✅ Padre Creado',
        description: `El perfil de ${formData.full_name} ha sido creado exitosamente.`,
      });

      setShowCreateModal(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      console.error('Error al crear padre:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo crear el perfil de padre.',
      });
    }
  };

  const handleEditParent = async () => {
    if (!selectedParent) return;

    try {
      const { error } = await supabase
        .from('parent_profiles')
        .update({
          full_name: formData.full_name,
          nickname: formData.nickname || null,
          dni: formData.dni,
          phone_1: formData.phone_1,
          phone_2: formData.phone_2 || null,
          email: formData.email || null,
          address: formData.address,
          school_id: formData.school_id,
        })
        .eq('id', selectedParent.id);

      if (error) throw error;

      toast({
        title: '✅ Padre Actualizado',
        description: `Los datos de ${formData.full_name} han sido actualizados.`,
      });

      setShowEditModal(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      console.error('Error al editar padre:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo actualizar el perfil.',
      });
    }
  };

  const handleViewChildren = async (parent: ParentProfile) => {
    setSelectedParent(parent);
    setParentChildren(parent.children || []);
    setShowChildrenModal(true);
  };

  const exportToExcel = () => {
    const data = filteredParents.map(parent => ({
      'Nombre Completo': parent.full_name,
      'Sobrenombre': parent.nickname || '-',
      'DNI': parent.dni,
      'Teléfono 1': parent.phone_1,
      'Teléfono 2': parent.phone_2 || '-',
      'Email': parent.email || '-',
      'Dirección': parent.address,
      'Sede': parent.school?.name || 'Sin asignar',
      'Cantidad de Hijos': parent.children?.length || 0,
      'Hijos': parent.children?.map(c => c.full_name).join(', ') || '-',
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Padres');
    XLSX.writeFile(wb, `Padres_${new Date().toISOString().split('T')[0]}.xlsx`);

    toast({
      title: '✅ Exportado',
      description: 'Los datos se han exportado a Excel.',
    });
  };

  const exportToPDF = () => {
    const doc = new jsPDF();
    
    doc.setFontSize(18);
    doc.text('ARQUISIA', 15, 15);
    doc.text('Lima Café 28', 150, 15);
    
    doc.setFontSize(14);
    doc.text('Reporte de Padres', 15, 30);
    
    doc.setFontSize(10);
    doc.text(`Fecha: ${new Date().toLocaleDateString()}`, 15, 38);

    const tableData = filteredParents.map(parent => [
      parent.full_name,
      parent.nickname || '-',
      parent.dni,
      parent.phone_1,
      parent.school?.name || 'Sin asignar',
      parent.children?.length || 0,
    ]);

    autoTable(doc, {
      startY: 45,
      head: [['Nombre', 'Sobrenombre', 'DNI', 'Teléfono', 'Sede', 'Hijos']],
      body: tableData,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [139, 69, 19] },
    });

    doc.save(`Padres_${new Date().toISOString().split('T')[0]}.pdf`);

    toast({
      title: '✅ Exportado',
      description: 'Los datos se han exportado a PDF.',
    });
  };

  const exportTeachersToExcel = () => {
    const data = filteredTeachers.map(teacher => ({
      'Nombre Completo': teacher.full_name,
      'DNI': teacher.dni,
      'Tipo de Documento': teacher.document_type || 'DNI',
      'Email Personal': teacher.email || '-',
      'Email Corporativo': teacher.corporate_email || '-',
      'Teléfono Personal': teacher.phone_1 || '-',
      'Teléfono Empresa': teacher.corporate_phone || '-',
      'Dirección': teacher.address || '-',
      'Área de Trabajo': teacher.work_area || '-',
      'Sede Principal': teacher.school_1_data?.name || '-',
      'Sede Secundaria': teacher.school_2_data?.name || '-',
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Profesores');
    XLSX.writeFile(wb, `Profesores_${new Date().toISOString().split('T')[0]}.xlsx`);

    toast({
      title: '✅ Exportado',
      description: 'Los datos de profesores se han exportado a Excel.',
    });
  };

  const exportTeachersToPDF = () => {
    const doc = new jsPDF();
    
    doc.setFontSize(18);
    doc.text('ARQUISIA', 15, 15);
    doc.text('Lima Café 28', 150, 15);
    
    doc.setFontSize(14);
    doc.text('Reporte de Profesores', 15, 30);
    
    doc.setFontSize(10);
    doc.text(`Fecha: ${new Date().toLocaleDateString()}`, 15, 38);

    const tableData = filteredTeachers.map(teacher => [
      teacher.full_name,
      teacher.dni,
      teacher.email || '-',
      teacher.phone_1 || '-',
      teacher.work_area || '-',
      teacher.school_1_data?.name || '-',
    ]);

    autoTable(doc, {
      startY: 45,
      head: [['Nombre', 'DNI', 'Email', 'Teléfono', 'Área', 'Sede']],
      body: tableData,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [16, 185, 129] }, // Color emerald
    });

    doc.save(`Profesores_${new Date().toISOString().split('T')[0]}.pdf`);

    toast({
      title: '✅ Exportado',
      description: 'Los datos de profesores se han exportado a PDF.',
    });
  };

  const resetForm = () => {
    setFormData({
      full_name: '',
      nickname: '',
      dni: '',
      phone_1: '',
      phone_2: '',
      email: '',
      address: '',
      school_id: '',
      password: '',
    });
    setSelectedParent(null);
  };

  const openEditModal = (parent: ParentProfile) => {
    setSelectedParent(parent);
    setFormData({
      full_name: parent.full_name,
      nickname: parent.nickname || '',
      dni: parent.dni,
      phone_1: parent.phone_1,
      phone_2: parent.phone_2 || '',
      email: parent.email || '',
      address: parent.address,
      school_id: parent.school_id,
      password: '',
    });
    setShowEditModal(true);
  };

  const filteredParents = parents.filter(parent => {
    const matchesSearch = parent.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         parent.dni.includes(searchTerm) ||
                         (parent.nickname && parent.nickname.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesSchool = selectedSchool === 'all' || parent.school_id === selectedSchool;
    return matchesSearch && matchesSchool;
  });

  const filteredTeachers = teachers.filter(teacher => {
    const matchesSearch = teacher.full_name.toLowerCase().includes(searchTermTeacher.toLowerCase()) ||
                         teacher.dni.includes(searchTermTeacher) ||
                         (teacher.email && teacher.email.toLowerCase().includes(searchTermTeacher.toLowerCase())) ||
                         (teacher.corporate_email && teacher.corporate_email.toLowerCase().includes(searchTermTeacher.toLowerCase()));
    
    const matchesSchool = selectedSchoolTeacher === 'all' || 
                         teacher.school_1 === selectedSchoolTeacher || 
                         teacher.school_2 === selectedSchoolTeacher;
    
    return matchesSearch && matchesSchool;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#8B4513] mx-auto"></div>
          <p className="mt-4 text-slate-600">Cargando configuración de padres...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-green-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between bg-white/80 backdrop-blur-sm rounded-2xl p-6 border-2 border-emerald-200 shadow-lg">
          <div>
            <h1 className="text-3xl font-black text-emerald-900 flex items-center gap-3">
              <Users className="h-8 w-8 text-emerald-600" />
              Configuración de Padres y Profesores
            </h1>
            <p className="text-emerald-600 font-medium mt-1">
              Gestiona perfiles de padres, profesores, estudiantes y genera reportes del sistema
            </p>
          </div>
          <Button 
            variant="outline" 
            onClick={() => navigate('/dashboard')}
            className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver al Panel
          </Button>
        </div>

        {/* Tabs principales */}
        <Tabs defaultValue="parents" className="w-full">
          <TabsList className="grid w-full grid-cols-4 bg-white/90 backdrop-blur-sm border-2 border-emerald-200 rounded-xl p-1 shadow-md">
            <TabsTrigger value="parents" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-emerald-500 data-[state=active]:to-teal-500 data-[state=active]:text-white">
              <Users className="h-4 w-4 mr-2" />
              Gestión de Padres
            </TabsTrigger>
            <TabsTrigger value="teachers" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-emerald-500 data-[state=active]:to-teal-500 data-[state=active]:text-white">
              <User2 className="h-4 w-4 mr-2" />
              Gestión de Profesores
            </TabsTrigger>
            <TabsTrigger value="analytics" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-emerald-500 data-[state=active]:to-teal-500 data-[state=active]:text-white">
              <BarChart3 className="h-4 w-4 mr-2" />
              Lima Analytics
            </TabsTrigger>
            <TabsTrigger value="reports" className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-emerald-500 data-[state=active]:to-teal-500 data-[state=active]:text-white">
              <FileText className="h-4 w-4 mr-2" />
              Reportes Excel
            </TabsTrigger>
          </TabsList>

          {/* Pestaña de Gestión de Padres */}
          <TabsContent value="parents" className="mt-6">
            <Card className="border-2 border-emerald-200 bg-white/80 backdrop-blur-sm shadow-lg">
              <CardHeader className="bg-gradient-to-r from-emerald-100/60 to-teal-100/40 border-b-2 border-emerald-200">
                <CardTitle className="flex items-center gap-2 text-emerald-900">
                  <Users className="h-6 w-6 text-emerald-600" />
                  Lista de Padres y Estudiantes
                </CardTitle>
                <CardDescription className="text-emerald-700">
                  Gestiona los perfiles de padres y estudiantes del sistema.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                {/* Barra de herramientas */}
                <div className="flex flex-col sm:flex-row gap-4 mb-6">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-500" />
                    <Input
                      placeholder="Buscar por nombre, DNI o sobrenombre..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 border-emerald-300 focus:border-emerald-500 focus:ring-emerald-500"
                    />
                  </div>
                  {canViewAllSchools && (
                    <Select value={selectedSchool} onValueChange={setSelectedSchool}>
                      <SelectTrigger className="w-full sm:w-[200px] border-emerald-300">
                        <SelectValue placeholder="Todas las sedes" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas las sedes</SelectItem>
                        {schools.map(school => (
                          <SelectItem key={school.id} value={school.id}>
                            {school.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {permissions.canCreateParent && (
                    <Button onClick={() => setShowCreateModal(true)} className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-md">
                      <Plus className="h-4 w-4" />
                      Nuevo Padre
                    </Button>
                  )}
                  <Button onClick={exportToExcel} variant="outline" className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-100">
                    <Download className="h-4 w-4" />
                    Excel
                  </Button>
                  <Button onClick={exportToPDF} variant="outline" className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-100">
                    <Download className="h-4 w-4" />
                    PDF
                  </Button>
                </div>

                {/* Lista de padres - DISEÑO RENOVADO */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {filteredParents.map(parent => (
                    <Card key={parent.id} className="border-l-4 border-l-emerald-400 bg-gradient-to-br from-emerald-50/50 to-teal-50/30 hover:shadow-xl transition-all duration-300">
                      <CardHeader className="pb-4 bg-gradient-to-r from-emerald-100/60 to-teal-100/40 border-b border-emerald-200">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <CardTitle className="text-xl text-emerald-900 flex items-center gap-2">
                              <UserCircle className="h-6 w-6 text-emerald-600" />
                              {parent.full_name}
                            </CardTitle>
                            {parent.nickname && (
                              <p className="text-sm text-emerald-700 mt-1 font-medium">
                                "{parent.nickname}"
                              </p>
                            )}
                          </div>
                          {permissions.canEditParent && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openEditModal(parent)}
                              className="hover:bg-emerald-200"
                            >
                              <Edit className="h-4 w-4 text-emerald-700" />
                            </Button>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="pt-4 space-y-4">
                        {/* Sección: Responsable Principal */}
                        <div className="bg-white/60 rounded-lg p-4 border border-emerald-200">
                          <h3 className="text-sm font-bold text-emerald-800 mb-3 flex items-center gap-2">
                            <User2 className="h-4 w-4" />
                            Responsable Principal
                          </h3>
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <div className="flex items-start gap-2">
                              <IdCard className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                              <div>
                                <p className="text-emerald-600 text-xs font-medium">DNI</p>
                                <p className="text-gray-800 font-semibold">{parent.dni}</p>
                              </div>
                            </div>
                            <div className="flex items-start gap-2">
                              <Phone className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                              <div>
                                <p className="text-emerald-600 text-xs font-medium">Teléfono</p>
                                <p className="text-gray-800 font-semibold">{parent.phone_1}</p>
                              </div>
                            </div>
                            {parent.phone_2 && (
                              <div className="flex items-start gap-2">
                                <Phone className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                                <div>
                                  <p className="text-emerald-600 text-xs font-medium">Teléfono 2</p>
                                  <p className="text-gray-800 font-semibold">{parent.phone_2}</p>
                                </div>
                              </div>
                            )}
                            {parent.email && (
                              <div className="flex items-start gap-2 col-span-2">
                                <Mail className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                                <div>
                                  <p className="text-emerald-600 text-xs font-medium">Email</p>
                                  <p className="text-gray-800 font-semibold break-all">{parent.email}</p>
                                </div>
                              </div>
                            )}
                            <div className="flex items-start gap-2 col-span-2">
                              <MapPin className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                              <div>
                                <p className="text-emerald-600 text-xs font-medium">Dirección</p>
                                <p className="text-gray-800 font-semibold">{parent.address}</p>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Sección: Segundo Responsable (si existe) */}
                        {parent.responsible_2_full_name && (
                          <div className="bg-teal-50/60 rounded-lg p-4 border border-teal-200">
                            <h3 className="text-sm font-bold text-teal-800 mb-3 flex items-center gap-2">
                              <User2 className="h-4 w-4" />
                              Segundo Responsable
                            </h3>
                            <div className="grid grid-cols-2 gap-3 text-sm">
                              <div className="col-span-2">
                                <p className="text-teal-600 text-xs font-medium">Nombre</p>
                                <p className="text-gray-800 font-semibold">{parent.responsible_2_full_name}</p>
                              </div>
                              {parent.responsible_2_dni && (
                                <div className="flex items-start gap-2">
                                  <IdCard className="h-4 w-4 text-teal-600 mt-0.5 flex-shrink-0" />
                                  <div>
                                    <p className="text-teal-600 text-xs font-medium">DNI</p>
                                    <p className="text-gray-800 font-semibold">{parent.responsible_2_dni}</p>
                                  </div>
                                </div>
                              )}
                              {parent.responsible_2_phone_1 && (
                                <div className="flex items-start gap-2">
                                  <Phone className="h-4 w-4 text-teal-600 mt-0.5 flex-shrink-0" />
                                  <div>
                                    <p className="text-teal-600 text-xs font-medium">Teléfono</p>
                                    <p className="text-gray-800 font-semibold">{parent.responsible_2_phone_1}</p>
                                  </div>
                                </div>
                              )}
                              {parent.responsible_2_email && (
                                <div className="flex items-start gap-2 col-span-2">
                                  <Mail className="h-4 w-4 text-teal-600 mt-0.5 flex-shrink-0" />
                                  <div>
                                    <p className="text-teal-600 text-xs font-medium">Email</p>
                                    <p className="text-gray-800 font-semibold break-all">{parent.responsible_2_email}</p>
                                  </div>
                                </div>
                              )}
                              {parent.responsible_2_address && (
                                <div className="flex items-start gap-2 col-span-2">
                                  <MapPin className="h-4 w-4 text-teal-600 mt-0.5 flex-shrink-0" />
                                  <div>
                                    <p className="text-teal-600 text-xs font-medium">Dirección</p>
                                    <p className="text-gray-800 font-semibold">{parent.responsible_2_address}</p>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Información de Sede e Hijos */}
                        <div className="flex items-center justify-between bg-emerald-100/50 rounded-lg p-3 border border-emerald-200">
                          <div className="flex items-center gap-2">
                            <Baby className="h-5 w-5 text-emerald-700" />
                            <div>
                              <p className="text-xs text-emerald-600 font-medium">Hijos Registrados</p>
                              <p className="text-lg font-bold text-emerald-900">{parent.children?.length || 0}</p>
                            </div>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleViewChildren(parent)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white"
                          >
                            <Baby className="h-4 w-4 mr-2" />
                            Ver Detalles
                          </Button>
                        </div>

                        {/* Información de Sede */}
                        <div className="text-center pt-2 border-t border-emerald-200">
                          <p className="text-xs text-emerald-600 font-medium">Sede Asignada</p>
                          <Badge variant="outline" className="mt-1 bg-emerald-100 text-emerald-800 border-emerald-300">
                            {parent.school?.name || 'Sin asignar'}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {filteredParents.length === 0 && (
                  <div className="text-center py-16 bg-emerald-50/50 rounded-2xl border-2 border-dashed border-emerald-300">
                    <Users className="h-20 w-20 text-emerald-300 mx-auto mb-4" />
                    {parents.length === 0 ? (
                      <>
                        <p className="text-xl font-bold text-emerald-900 mb-2">No hay padres registrados</p>
                        <p className="text-emerald-700 mb-6">
                          No se encontraron padres en el sistema. Crea el primer padre usando el botón "Nuevo Padre".
                        </p>
                        {permissions.canCreateParent && (
                          <Button 
                            onClick={() => setShowCreateModal(true)} 
                            className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-md"
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            Crear Primer Padre
                          </Button>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="text-xl font-bold text-emerald-900 mb-2">No se encontraron resultados</p>
                        <p className="text-emerald-700">
                          No hay padres que coincidan con los filtros aplicados.
                        </p>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Pestaña de Gestión de Profesores */}
          <TabsContent value="teachers" className="mt-6">
            <Card className="border-2 border-emerald-200 bg-white/80 backdrop-blur-sm shadow-lg">
              <CardHeader className="bg-gradient-to-r from-emerald-100/60 to-teal-100/40 border-b-2 border-emerald-200">
                <CardTitle className="flex items-center gap-2 text-emerald-900">
                  <User2 className="h-6 w-6 text-emerald-600" />
                  Lista de Profesores
                </CardTitle>
                <CardDescription className="text-emerald-700">
                  Visualiza y gestiona los perfiles de profesores del sistema.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                {/* Barra de herramientas */}
                <div className="flex flex-col sm:flex-row gap-4 mb-6">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-500" />
                    <Input
                      placeholder="Buscar por nombre, DNI o correo..."
                      value={searchTermTeacher}
                      onChange={(e) => setSearchTermTeacher(e.target.value)}
                      className="pl-10 border-emerald-300 focus:border-emerald-500 focus:ring-emerald-500"
                    />
                  </div>
                  {canViewAllSchools && (
                    <Select value={selectedSchoolTeacher} onValueChange={setSelectedSchoolTeacher}>
                      <SelectTrigger className="w-full sm:w-[200px] border-emerald-300">
                        <SelectValue placeholder="Todas las sedes" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas las sedes</SelectItem>
                        {schools.map(school => (
                          <SelectItem key={school.id} value={school.id}>
                            {school.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Button onClick={() => exportTeachersToExcel()} variant="outline" className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-100">
                    <Download className="h-4 w-4" />
                    Excel
                  </Button>
                  <Button onClick={() => exportTeachersToPDF()} variant="outline" className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-100">
                    <Download className="h-4 w-4" />
                    PDF
                  </Button>
                </div>

                {/* Lista de profesores */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {filteredTeachers.map(teacher => (
                    <Card key={teacher.id} className="border-l-4 border-l-emerald-400 bg-gradient-to-br from-emerald-50/50 to-teal-50/30 hover:shadow-xl transition-all duration-300">
                      <CardContent className="p-6">
                        {/* Header con nombre completo */}
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex-1">
                            <h3 className="text-xl font-black text-emerald-900 mb-1">{teacher.full_name}</h3>
                            <div className="flex items-center gap-2 text-sm text-emerald-700">
                              <IdCard className="h-4 w-4" />
                              <span className="font-semibold">{teacher.document_type || 'DNI'}: {teacher.dni}</span>
                            </div>
                          </div>
                        </div>

                        {/* Información de contacto */}
                        <div className="space-y-3 mb-4">
                          <div className="grid grid-cols-1 gap-2">
                            <div className="flex items-center gap-2 text-sm">
                              <Mail className="h-4 w-4 text-emerald-600" />
                              <span className="font-medium text-emerald-800">Personal:</span>
                              <span className="text-emerald-700">{teacher.email || 'No registrado'}</span>
                            </div>
                            {teacher.corporate_email && (
                              <div className="flex items-center gap-2 text-sm">
                                <Mail className="h-4 w-4 text-teal-600" />
                                <span className="font-medium text-teal-800">Corporativo:</span>
                                <span className="text-teal-700">{teacher.corporate_email}</span>
                              </div>
                            )}
                          </div>

                          <div className="grid grid-cols-1 gap-2">
                            <div className="flex items-center gap-2 text-sm">
                              <Phone className="h-4 w-4 text-emerald-600" />
                              <span className="font-medium text-emerald-800">Personal:</span>
                              <span className="text-emerald-700">{teacher.phone_1 || 'No registrado'}</span>
                            </div>
                            {teacher.corporate_phone && (
                              <div className="flex items-center gap-2 text-sm">
                                <Phone className="h-4 w-4 text-teal-600" />
                                <span className="font-medium text-teal-800">Empresa:</span>
                                <span className="text-teal-700">{teacher.corporate_phone}</span>
                              </div>
                            )}
                          </div>

                          {teacher.address && (
                            <div className="flex items-center gap-2 text-sm">
                              <MapPin className="h-4 w-4 text-emerald-600" />
                              <span className="font-medium text-emerald-800">Dirección:</span>
                              <span className="text-emerald-700">{teacher.address}</span>
                            </div>
                          )}

                          {teacher.work_area && (
                            <div className="flex items-center gap-2 text-sm">
                              <Users className="h-4 w-4 text-emerald-600" />
                              <span className="font-medium text-emerald-800">Área:</span>
                              <span className="text-emerald-700">{teacher.work_area}</span>
                            </div>
                          )}
                        </div>

                        {/* Sedes */}
                        <div className="border-t-2 border-emerald-200 pt-4">
                          <p className="text-sm font-bold text-emerald-800 mb-2">Sedes Asignadas:</p>
                          <div className="space-y-2">
                            {teacher.school_1_data && (
                              <Badge className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white">
                                Principal: {teacher.school_1_data.name}
                              </Badge>
                            )}
                            {teacher.school_2_data && (
                              <Badge className="bg-gradient-to-r from-teal-500 to-cyan-500 text-white ml-2">
                                Secundaria: {teacher.school_2_data.name}
                              </Badge>
                            )}
                            {!teacher.school_1_data && !teacher.school_2_data && (
                              <Badge variant="outline" className="border-amber-500 text-amber-700">
                                Sin sede asignada
                              </Badge>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* Empty state */}
                {filteredTeachers.length === 0 && (
                  <div className="text-center py-16 bg-gradient-to-br from-emerald-50/50 to-teal-50/30 rounded-2xl border-2 border-dashed border-emerald-300">
                    {teachers.length === 0 ? (
                      <>
                        <User2 className="h-16 w-16 text-emerald-400 mx-auto mb-4" />
                        <p className="text-xl font-bold text-emerald-900 mb-2">No hay profesores registrados</p>
                        <p className="text-emerald-700">
                          Los profesores deben registrarse desde el Portal del Profesor.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-xl font-bold text-emerald-900 mb-2">No se encontraron resultados</p>
                        <p className="text-emerald-700">
                          No hay profesores que coincidan con los filtros aplicados.
                        </p>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Pestaña de Analytics */}
          <TabsContent value="analytics" className="mt-6">
            {/* Filtro por Sede */}
            {canViewAllSchools && schools.length > 0 && (
              <Card className="mb-4">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <label className="font-bold text-slate-700">Filtrar por Sede:</label>
                    <Select value={selectedSchoolAnalytics} onValueChange={setSelectedSchoolAnalytics}>
                      <SelectTrigger className="w-[300px]">
                        <SelectValue placeholder="Seleccionar sede" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">📊 Todas las Sedes (Global)</SelectItem>
                        {schools.map((school) => (
                          <SelectItem key={school.id} value={school.id}>
                            {school.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            )}
            
            <ParentAnalyticsDashboard selectedSchool={selectedSchoolAnalytics} />
          </TabsContent>

          {/* Pestaña de Reportes */}
          <TabsContent value="reports" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Reportes Personalizados</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-slate-400">Próximamente: Reportes avanzados con filtros personalizados</p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Modal Crear Padre */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Crear Nuevo Padre</DialogTitle>
            <DialogDescription>
              Complete los datos del padre. Los campos con * son obligatorios.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label htmlFor="full_name">Nombre Completo *</Label>
              <Input
                id="full_name"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              />
            </div>
            <div className="col-span-2">
              <Label htmlFor="nickname">Sobrenombre (ej: "Papá de Juanito")</Label>
              <Input
                id="nickname"
                value={formData.nickname}
                onChange={(e) => setFormData({ ...formData, nickname: e.target.value })}
                placeholder="Opcional"
              />
            </div>
            <div>
              <Label htmlFor="dni">DNI *</Label>
              <Input
                id="dni"
                value={formData.dni}
                onChange={(e) => setFormData({ ...formData, dni: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="phone_1">Teléfono Principal *</Label>
              <Input
                id="phone_1"
                value={formData.phone_1}
                onChange={(e) => setFormData({ ...formData, phone_1: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="phone_2">Teléfono Secundario</Label>
              <Input
                id="phone_2"
                value={formData.phone_2}
                onChange={(e) => setFormData({ ...formData, phone_2: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
            <div className="col-span-2">
              <Label htmlFor="address">Dirección *</Label>
              <Input
                id="address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="school_id">Sede *</Label>
              <Select value={formData.school_id} onValueChange={(value) => setFormData({ ...formData, school_id: value })}>
                <SelectTrigger id="school_id">
                  <SelectValue placeholder="Selecciona una sede" />
                </SelectTrigger>
                <SelectContent>
                  {schools.map(school => (
                    <SelectItem key={school.id} value={school.id}>
                      {school.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="password">Contraseña *</Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreateModal(false); resetForm(); }} className="border-emerald-300 text-emerald-700 hover:bg-emerald-100">
              Cancelar
            </Button>
            <Button onClick={handleCreateParent} className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-md">Crear Padre</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Editar Padre */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar Padre</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label htmlFor="edit_full_name">Nombre Completo</Label>
              <Input
                id="edit_full_name"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              />
            </div>
            <div className="col-span-2">
              <Label htmlFor="edit_nickname">Sobrenombre</Label>
              <Input
                id="edit_nickname"
                value={formData.nickname}
                onChange={(e) => setFormData({ ...formData, nickname: e.target.value })}
                placeholder="Opcional"
              />
            </div>
            <div>
              <Label htmlFor="edit_dni">DNI</Label>
              <Input
                id="edit_dni"
                value={formData.dni}
                onChange={(e) => setFormData({ ...formData, dni: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="edit_phone_1">Teléfono Principal</Label>
              <Input
                id="edit_phone_1"
                value={formData.phone_1}
                onChange={(e) => setFormData({ ...formData, phone_1: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="edit_phone_2">Teléfono Secundario</Label>
              <Input
                id="edit_phone_2"
                value={formData.phone_2}
                onChange={(e) => setFormData({ ...formData, phone_2: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="edit_email">Email</Label>
              <Input
                id="edit_email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
            <div className="col-span-2">
              <Label htmlFor="edit_address">Dirección</Label>
              <Input
                id="edit_address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              />
            </div>
            <div className="col-span-2">
              <Label htmlFor="edit_school_id">Sede</Label>
              <Select value={formData.school_id} onValueChange={(value) => setFormData({ ...formData, school_id: value })}>
                <SelectTrigger id="edit_school_id">
                  <SelectValue placeholder="Selecciona una sede" />
                </SelectTrigger>
                <SelectContent>
                  {schools.map(school => (
                    <SelectItem key={school.id} value={school.id}>
                      {school.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowEditModal(false); resetForm(); }} className="border-emerald-300 text-emerald-700 hover:bg-emerald-100">
              Cancelar
            </Button>
            <Button onClick={handleEditParent} className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-md">Guardar Cambios</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Ver Hijos - DISEÑO RENOVADO */}
      <Dialog open={showChildrenModal} onOpenChange={setShowChildrenModal}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-gradient-to-br from-emerald-50 to-teal-50">
          <DialogHeader className="border-b border-emerald-200 pb-4">
            <DialogTitle className="flex items-center gap-3 text-2xl text-emerald-900">
              <Baby className="h-7 w-7 text-emerald-600" />
              Hijos de {selectedParent?.full_name}
            </DialogTitle>
            {selectedParent?.nickname && (
              <p className="text-sm text-emerald-700 font-medium">({selectedParent.nickname})</p>
            )}
          </DialogHeader>
          
          {parentChildren.length > 0 ? (
            <div className="space-y-4">
              {parentChildren.map(child => (
                <Card key={child.id} className="border-2 border-emerald-200 bg-white/80 hover:shadow-lg transition-all">
                  <CardContent className="p-6">
                    <div className="flex gap-6">
                      {/* Foto del Estudiante */}
                      <div className="flex-shrink-0">
                        <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-emerald-300 bg-emerald-100 flex items-center justify-center">
                          {child.photo_url ? (
                            <img 
                              src={child.photo_url} 
                              alt={child.full_name} 
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <UserCircle className="w-16 h-16 text-emerald-400" />
                          )}
                        </div>
                      </div>

                      {/* Información del Estudiante */}
                      <div className="flex-1 space-y-4">
                        {/* Nombre y Datos Básicos */}
                        <div>
                          <h3 className="text-xl font-bold text-emerald-900 mb-2">{child.full_name}</h3>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200">
                              <p className="text-xs text-emerald-600 font-medium mb-1">Grado</p>
                              <p className="text-lg font-bold text-emerald-900">{child.grade}</p>
                            </div>
                            <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200">
                              <p className="text-xs text-emerald-600 font-medium mb-1">Sección</p>
                              <p className="text-lg font-bold text-emerald-900">{child.section}</p>
                            </div>
                          </div>
                        </div>

                        {/* Tipo de Cuenta y Límites */}
                        <div className="grid grid-cols-2 gap-4">
                          {/* Tipo de Cuenta */}
                          <div className={`rounded-lg p-4 border-2 ${
                            child.free_account !== false
                              ? 'bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-300' 
                              : 'bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-300'
                          }`}>
                            <div className="flex items-center gap-2 mb-2">
                              {child.free_account !== false ? (
                                <Wallet className="h-5 w-5 text-emerald-600" />
                              ) : (
                                <CreditCard className="h-5 w-5 text-blue-600" />
                              )}
                              <p className={`text-sm font-bold ${
                                child.free_account !== false ? 'text-emerald-700' : 'text-blue-700'
                              }`}>
                                Tipo de Cuenta
                              </p>
                            </div>
                            <Badge 
                              variant="secondary" 
                              className={`text-sm ${
                                child.free_account !== false
                                  ? 'bg-emerald-100 text-emerald-800 border-emerald-300' 
                                  : 'bg-blue-100 text-blue-800 border-blue-300'
                              }`}
                            >
                              {child.free_account !== false ? '🆓 Cuenta Libre' : '💳 Con Recarga'}
                            </Badge>
                            
                            {/* Mostrar tipo de límite si existe */}
                            {child.limit_type && child.limit_type !== 'none' && (
                              <div className="mt-3 pt-3 border-t border-emerald-200">
                                <p className="text-xs font-medium text-emerald-600 mb-1">Límite de Gasto</p>
                                <p className="text-base font-bold text-emerald-900">
                                  {child.limit_type === 'daily' && `Diario: S/ ${child.daily_limit?.toFixed(2)}`}
                                  {child.limit_type === 'weekly' && `Semanal: S/ ${child.weekly_limit?.toFixed(2)}`}
                                  {child.limit_type === 'monthly' && `Mensual: S/ ${child.monthly_limit?.toFixed(2)}`}
                                </p>
                                <p className="text-xs text-emerald-600 mt-1">
                                  {child.limit_type === 'daily' && '⏰ Se reinicia cada día'}
                                  {child.limit_type === 'weekly' && '📅 Se reinicia cada semana'}
                                  {child.limit_type === 'monthly' && '📆 Se reinicia cada mes'}
                                </p>
                              </div>
                            )}
                          </div>

                          {/* Saldo (solo si es con recarga) */}
                          {child.free_account === false && (
                            <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-4 border-2 border-green-300">
                              <div className="flex items-center gap-2 mb-2">
                                <Wallet className="h-5 w-5 text-green-600" />
                                <p className="text-sm font-bold text-green-700">Saldo Actual</p>
                              </div>
                              <p className="text-2xl font-black text-green-900">
                                S/ {(child.balance || 0).toFixed(2)}
                              </p>
                              <p className={`text-xs mt-1 font-medium ${
                                (child.balance || 0) < 0 
                                  ? 'text-red-600' 
                                  : 'text-green-600'
                              }`}>
                                {(child.balance || 0) < 0 ? '⚠️ Deuda Pendiente' : '✅ Saldo Disponible'}
                              </p>
                            </div>
                          )}
                          
                          {/* Información de cuenta libre sin límite */}
                          {child.free_account !== false && (!child.limit_type || child.limit_type === 'none') && (
                            <div className="bg-gradient-to-br from-amber-50 to-yellow-50 rounded-lg p-4 border-2 border-amber-300">
                              <div className="flex items-center gap-2 mb-2">
                                <CreditCard className="h-5 w-5 text-amber-600" />
                                <p className="text-sm font-bold text-amber-700">Sin Límites</p>
                              </div>
                              <p className="text-base text-amber-900 font-semibold">
                                ∞ Sin tope de gasto
                              </p>
                              <p className="text-xs text-amber-600 mt-1">
                                ✨ Puede consumir libremente
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-16 bg-white/60 rounded-xl border-2 border-dashed border-emerald-300">
              <Baby className="h-16 w-16 text-emerald-300 mx-auto mb-4" />
              <p className="text-lg font-bold text-emerald-800 mb-2">
                Sin hijos registrados
              </p>
              <p className="text-emerald-600">
                Este padre no tiene hijos registrados en el sistema.
              </p>
            </div>
          )}
          
          <DialogFooter className="border-t border-emerald-200 pt-4">
            <Button 
              onClick={() => setShowChildrenModal(false)} 
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-8"
            >
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ParentConfiguration;
