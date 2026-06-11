import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Search, Users, BarChart3, FileText, Plus, Download, Baby, UserCircle, ArrowLeft, Mail, Phone, MapPin, CreditCard, Wallet, User2, IdCard, BookOpen, AlertTriangle, ChevronLeft, ChevronRight, KeyRound, Bell, Loader2, Sparkles, UserPlus } from 'lucide-react';
import { ResetUserPasswordModal } from '@/components/admin/ResetUserPasswordModal';
import { MergeParentsModal } from '@/components/admin/MergeParentsModal';
import { ParentListAccordion, type AccordionParentRow } from '@/components/admin/ParentListAccordion';
import { ParentAnalyticsDashboard } from '@/components/admin/ParentAnalyticsDashboard';
import StudentsDirectory from '@/components/admin/StudentsDirectory';
import { KioskWalletReport } from '@/components/admin/KioskWalletReport';
import { ComunicadosPanel } from '@/components/admin/ComunicadosPanel';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { useMaintenanceGuard } from '@/hooks/useMaintenanceGuard';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ExpressEnrollmentModal } from '@/features/express-enrollment/components/ExpressEnrollmentModal';
import { CreateTeacherModal } from '@/features/teacher-express/components/CreateTeacherModal';

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
  kiosk_disabled?: boolean;
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
  profile?: { email: string } | null;
  children?: Student[];
  created_at: string;
  // Mini-CRM v6
  behavior_profile?: string;
  behavior_notes?: string | null;
  is_suspended?: boolean;
}

interface TeacherProfile {
  id: string;
  user_id?: string;
  full_name: string;
  dni: string;
  document_type?: string;
  phone_1: string;
  corporate_phone?: string;
  personal_email?: string;
  corporate_email?: string;
  address?: string;
  area?: string;
  school_id_1?: string;
  school_id_2?: string;
  school_1_data?: School | null;
  school_2_data?: School | null;
  created_at: string;
}

interface SearchParentsV3Row {
  id: string;
  user_id: string;
  full_name: string;
  nickname: string | null;
  dni: string | null;
  phone_1: string | null;
  phone_2: string | null;
  email: string | null;
  address: string | null;
  responsible_2_full_name: string | null;
  responsible_2_dni: string | null;
  responsible_2_document_type: string | null;
  responsible_2_phone_1: string | null;
  responsible_2_email: string | null;
  responsible_2_address: string | null;
  school_id: string;
  school_name: string | null;
  children: Student[] | null;
  created_at: string;
  // Mini-CRM v6
  behavior_profile: string | null;
  behavior_notes: string | null;
  is_suspended: boolean | null;
  is_deleted: boolean | null;
  deleted_at: string | null;
  score: number;
  total_count: number;
}

const PARENTS_PAGE_SIZE = 50;
const PARENTS_SEARCH_DEBOUNCE_MS = 700;
const PARENTS_MIN_SEARCH_CHARS = 3;

const ParentConfiguration = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const { role, canViewAllSchools: canViewAllSchoolsHook } = useRole();
  const navigate = useNavigate();
  const maintenance = useMaintenanceGuard('config_padres_admin');
  
  const [loading, setLoading] = useState(true);
  const [parents, setParents] = useState<ParentProfile[]>([]);
  const [teachers, setTeachers] = useState<TeacherProfile[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchTermTeacher, setSearchTermTeacher] = useState('');
  const [selectedSchool, setSelectedSchool] = useState<string>('all');
  const [selectedSchoolTeacher, setSelectedSchoolTeacher] = useState<string>('all');
  const [selectedSchoolAnalytics, setSelectedSchoolAnalytics] = useState<string>('all');
  const [parentsPage, setParentsPage] = useState(0);
  const [parentsTotalCount, setParentsTotalCount] = useState(0);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [parentsLoading, setParentsLoading] = useState(false);
  const [parentsLoadError, setParentsLoadError] = useState<string | null>(null);
  const parentsAbortRef = useRef<AbortController | null>(null);
  const parentsRequestSeqRef = useRef(0);

  // Control de pestañas y carga diferida de profesores
  const [activeTab, setActiveTab] = useState('parents');
  const [teachersLoaded, setTeachersLoaded] = useState(false);
  const [teachersLoading, setTeachersLoading] = useState(false);
  const [teachersTotalCount, setTeachersTotalCount] = useState(0);
  
  // Permisos
  const [canViewAllSchools, setCanViewAllSchools] = useState(false);
  const [userSchoolId, setUserSchoolId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState({
    canCreateParent: false,
    canEditParent: false,
    canCreateStudent: false,
    canEditStudent: false,
    // Permisos de profesores
    canViewTeachers: false,
    canViewTeacherDetails: false,
    canCreateTeacher: false,
    canEditTeacher: false,
    canDeleteTeacher: false,
    canExportTeachers: false,
  });
  
  // Modales
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showChildrenModal, setShowChildrenModal] = useState(false);
  
  // Datos seleccionados
  const [selectedParent, setSelectedParent] = useState<ParentProfile | null>(null);
  const [parentChildren, setParentChildren] = useState<Student[]>([]);

  // Modal de restablecer contraseña
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetPasswordParent, setResetPasswordParent] = useState<ParentProfile | null>(null);
  const [showTeacherResetPassword, setShowTeacherResetPassword] = useState(false);
  const [resetPasswordTeacher, setResetPasswordTeacher] = useState<TeacherProfile | null>(null);

  // Modal de unir padres (resolver duplicados)
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeSourceParent, setMergeSourceParent] = useState<ParentProfile | null>(null);

  // Modales express
  const [showExpressEnroll, setShowExpressEnroll] = useState(false);
  const [showCreateTeacher, setShowCreateTeacher] = useState(false);

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
    if (canViewAllSchools === true || (canViewAllSchools === false && userSchoolId)) {
      setParentsPage(0);
    }
  }, [canViewAllSchools, userSchoolId]);

  // Debounce real: solo disparamos query al terminar de escribir.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setParentsPage(0);
    }, PARENTS_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    if (parentsPage !== 0) {
      setParentsPage(0);
    }
  }, [selectedSchool, parentsPage]);

  useEffect(() => {
    if (canViewAllSchools === true || (canViewAllSchools === false && userSchoolId)) {
      console.log('🚀 Trigger fetchData - canViewAllSchools:', canViewAllSchools, 'userSchoolId:', userSchoolId, 'parentsPage:', parentsPage, 'search:', debouncedSearch);
      fetchData();
    } else {
      console.log('⏳ Esperando permisos... canViewAllSchools:', canViewAllSchools, 'userSchoolId:', userSchoolId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewAllSchools, userSchoolId, parentsPage, debouncedSearch, selectedSchool]);

  useEffect(() => {
    return () => {
      parentsAbortRef.current?.abort();
    };
  }, []);

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
          // Permisos de profesores
          canViewTeachers: true,
          canViewTeacherDetails: true,
          canCreateTeacher: true,
          canEditTeacher: true,
          canDeleteTeacher: true,
          canExportTeachers: true,
        });
        setLoading(false);
        return;
      }

      // Obtener school_id del usuario actual
      console.log('🔍 Buscando school_id para usuario:', user.id);
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('school_id, role')
        .eq('id', user.id)
        .single();

      if (profileError) {
        console.error('❌ Error al obtener perfil:', profileError);
      } else {
        console.log('📋 Datos del perfil:', profileData);
        if (profileData?.school_id) {
          setUserSchoolId(profileData.school_id);
          console.log('✅ School ID del usuario establecido:', profileData.school_id);
        } else {
          console.warn('⚠️ El usuario NO tiene school_id asignado');
        }
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
        // Permisos de profesores
        canViewTeachers: false,
        canViewTeacherDetails: false,
        canCreateTeacher: false,
        canEditTeacher: false,
        canDeleteTeacher: false,
        canExportTeachers: false,
      };

      data?.forEach((perm: any) => {
        const permission = perm.permissions;
        if (permission?.module === 'config_padres') {
          switch (permission.action) {
            case 'ver_todas_sedes':
              canViewAll = true;
              break;
            // Permisos de padres
            case 'crear_padre':
              perms.canCreateParent = true;
              break;
            case 'editar_padre':
              perms.canEditParent = true;
              break;
            // Permisos de estudiantes
            case 'crear_estudiante':
              perms.canCreateStudent = true;
              break;
            case 'editar_estudiante':
              perms.canEditStudent = true;
              break;
            // Permisos de profesores
            case 'view_teachers':
              perms.canViewTeachers = true;
              break;
            case 'view_teacher_details':
              perms.canViewTeacherDetails = true;
              break;
            case 'create_teacher':
              perms.canCreateTeacher = true;
              break;
            case 'edit_teacher':
              perms.canEditTeacher = true;
              break;
            case 'delete_teacher':
              perms.canDeleteTeacher = true;
              break;
            case 'export_teachers':
              perms.canExportTeachers = true;
              break;
          }
        }
      });

      console.log('✅ Permisos finales de Config Padres:', perms);
      
      setPermissions(perms);
      setCanViewAllSchools(canViewAll);
      setLoading(false);

    } catch (error) {
      console.error('Error checking permissions:', error);
      setLoading(false);
    }
  };

  const fetchData = async () => {
    const requestSeq = ++parentsRequestSeqRef.current;
    const isFirstLoad = parents.length === 0;
    if (isFirstLoad) {
      setLoading(true);
    } else {
      setParentsLoading(true);
    }
    setParentsLoadError(null);

    try {
      if (schools.length === 0) {
        const { data: schoolsData, error: schoolsError } = await supabase
          .from('schools')
          .select('*')
          .order('name');
        if (schoolsError) throw schoolsError;
        setSchools(schoolsData || []);
      }

      const normalizedSearch = debouncedSearch.trim();
      if (normalizedSearch.length > 0 && normalizedSearch.length < PARENTS_MIN_SEARCH_CHARS) {
        return;
      }
      const selectedSchoolId = canViewAllSchools
        ? (selectedSchool === 'all' ? null : selectedSchool)
        : userSchoolId;

      parentsAbortRef.current?.abort();
      const abortController = new AbortController();
      parentsAbortRef.current = abortController;

      const rpcPromise = supabase
        .rpc('search_parents_v3', {
        p_query: normalizedSearch,
        p_school_id: selectedSchoolId,
        p_limit: PARENTS_PAGE_SIZE,
        p_offset: parentsPage * PARENTS_PAGE_SIZE,
        })
        .abortSignal(abortController.signal);

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT_DB_QUERY')), 5000),
      );

      const { data, error } = await Promise.race([rpcPromise, timeoutPromise]) as {
        data: SearchParentsV3Row[] | null;
        error: Error | null;
      };

      if (requestSeq !== parentsRequestSeqRef.current) return;
      if (error) throw error;

      const mappedParents: ParentProfile[] = (data || []).map((row) => ({
        id: row.id,
        user_id: row.user_id,
        full_name: row.full_name || '',
        nickname: row.nickname || undefined,
        dni: row.dni || '',
        phone_1: row.phone_1 || '',
        phone_2: row.phone_2 || undefined,
        email: row.email || undefined,
        address: row.address || '',
        responsible_2_full_name: row.responsible_2_full_name || undefined,
        responsible_2_dni: row.responsible_2_dni || undefined,
        responsible_2_document_type: row.responsible_2_document_type || undefined,
        responsible_2_phone_1: row.responsible_2_phone_1 || undefined,
        responsible_2_email: row.responsible_2_email || undefined,
        responsible_2_address: row.responsible_2_address || undefined,
        school_id: row.school_id,
        school: row.school_id
          ? { id: row.school_id, name: row.school_name || 'Sin asignar', code: '' }
          : null,
        profile: row.email ? { email: row.email } : null,
        children: row.children || [],
        created_at: row.created_at,
        behavior_profile: row.behavior_profile ?? 'neutro',
        behavior_notes: row.behavior_notes ?? null,
        is_suspended: row.is_suspended ?? false,
      }));

      setParents(mappedParents);
      setParentsTotalCount(data?.[0]?.total_count ?? 0);
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return;
      }
      if (requestSeq !== parentsRequestSeqRef.current) return;
      const message = error?.message === 'TIMEOUT_DB_QUERY'
        ? 'La búsqueda tardó más de 5 segundos. Mantuvimos resultados previos; intenta de nuevo.'
        : 'No se pudo completar la búsqueda de padres.';

      console.error('Error al cargar datos de padres:', error);
      setParentsLoadError(message);
    } finally {
      if (requestSeq !== parentsRequestSeqRef.current) return;
      setParentsLoading(false);
      setLoading(false);
    }
  };

  // Carga diferida de profesores — solo cuando el usuario abre esa pestaña
  // Elimina las ~600 queries separadas usando las sedes ya en memoria
  const fetchTeachers = async () => {
    if (teachersLoaded || teachersLoading) return;
    setTeachersLoading(true);
    try {
      let query = supabase
        .from('teacher_profiles')
        .select('*', { count: 'exact' })
        .order('full_name');

      if (!canViewAllSchools && userSchoolId) {
        query = query.or(`school_id_1.eq.${userSchoolId},school_id_2.eq.${userSchoolId}`);
      }

      const { data: teachersData, error, count } = await query;
      if (error) throw error;

      setTeachersTotalCount(count ?? 0);

      // Enriquecer sedes usando el estado ya cargado — CERO queries extra
      const currentSchools = schools.length > 0 ? schools : [];
      const teachersWithSchools = (teachersData || []).map((teacher: any) => ({
        ...teacher,
        // teacher_profiles.id referencia auth.users/profiles.id
        user_id: teacher.user_id || teacher.id,
        school_1_data: currentSchools.find((s) => s.id === teacher.school_id_1) || null,
        school_2_data: currentSchools.find((s) => s.id === teacher.school_id_2) || null,
      }));

      setTeachers(teachersWithSchools);
      setTeachersLoaded(true);
      console.log('👨‍🏫 Profesores cargados (diferido):', teachersWithSchools.length);
    } catch (error: any) {
      console.error('Error al cargar profesores:', error);
      toast({ variant: 'destructive', title: 'Error al cargar profesores', description: error.message });
    } finally {
      setTeachersLoading(false);
    }
  };

  // Cuando el admin cambia de pestaña, cargar la data necesaria por primera vez
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    if (tab === 'teachers' && !teachersLoaded && !teachersLoading) {
      fetchTeachers();
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
      'Email Personal': teacher.personal_email || '-',
      'Email Corporativo': teacher.corporate_email || '-',
      'Teléfono Personal': teacher.phone_1 || '-',
      'Teléfono Empresa': teacher.corporate_phone || '-',
      'Dirección': teacher.address || '-',
      'Área de Trabajo': teacher.area || '-',
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
      teacher.personal_email || teacher.corporate_email || '-',
      teacher.phone_1 || '-',
      teacher.area || '-',
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

  const filteredParents = parents;

  const filteredTeachers = teachers.filter(teacher => {
    const term = searchTermTeacher.toLowerCase();
    const matchesSearch = !searchTermTeacher ||
                         (teacher.full_name?.toLowerCase().includes(term)) ||
                         (teacher.dni?.includes(searchTermTeacher)) ||
                         (teacher.personal_email?.toLowerCase().includes(term)) ||
                         (teacher.corporate_email?.toLowerCase().includes(term));
    
    const matchesSchool = selectedSchoolTeacher === 'all' || 
                         teacher.school_id_1 === selectedSchoolTeacher || 
                         teacher.school_id_2 === selectedSchoolTeacher;
    
    return matchesSearch && matchesSchool;
  });

  const openTeacherResetModal = (teacher: TeacherProfile) => {
    const targetUserId = teacher.user_id || teacher.id;
    if (!targetUserId) {
      console.warn('[Teacher Reset] Profesor sin user_id/id vinculado:', teacher);
      toast({
        variant: 'destructive',
        title: 'Profesor sin identidad vinculada',
        description: 'Este profesor no tiene user_id asociado a profiles/auth. No se puede restablecer contraseña.',
      });
      return;
    }
    setResetPasswordTeacher({ ...teacher, user_id: targetUserId });
    setShowTeacherResetPassword(true);
  };

  if (maintenance.blocked) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-6">
          <div className="w-20 h-20 mx-auto bg-red-100 rounded-full flex items-center justify-center">
            <AlertTriangle className="h-10 w-10 text-red-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{maintenance.title}</h1>
          <p className="text-gray-600">{maintenance.message}</p>
          <Button variant="outline" onClick={() => navigate('/dashboard')}>
            Volver al Panel
          </Button>
        </div>
      </div>
    );
  }

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
              Configuración de Padres, Profesores y Alumnos
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
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="flex w-full flex-wrap gap-1 bg-white/90 backdrop-blur-sm border-2 border-emerald-200 rounded-xl p-1 shadow-md h-auto">
            <TabsTrigger value="parents" className="flex-1 min-w-[120px] data-[state=active]:bg-gradient-to-r data-[state=active]:from-emerald-500 data-[state=active]:to-teal-500 data-[state=active]:text-white">
              <Users className="h-4 w-4 mr-2" />
              Gestión de Padres
            </TabsTrigger>
            
            {/* Solo mostrar pestaña de profesores si tiene permiso */}
            {permissions.canViewTeachers && (
              <TabsTrigger value="teachers" className="flex-1 min-w-[120px] data-[state=active]:bg-gradient-to-r data-[state=active]:from-emerald-500 data-[state=active]:to-teal-500 data-[state=active]:text-white">
                <User2 className="h-4 w-4 mr-2" />
                Gestión de Profesores
              </TabsTrigger>
            )}
            
            <TabsTrigger value="directory" className="flex-1 min-w-[120px] data-[state=active]:bg-gradient-to-r data-[state=active]:from-emerald-500 data-[state=active]:to-teal-500 data-[state=active]:text-white">
              <BookOpen className="h-4 w-4 mr-2" />
              Alumnos
            </TabsTrigger>

            <TabsTrigger value="analytics" className="flex-1 min-w-[120px] data-[state=active]:bg-gradient-to-r data-[state=active]:from-emerald-500 data-[state=active]:to-teal-500 data-[state=active]:text-white">
              <BarChart3 className="h-4 w-4 mr-2" />
              Lima Analytics
            </TabsTrigger>
            <TabsTrigger value="reports" className="flex-1 min-w-[120px] data-[state=active]:bg-gradient-to-r data-[state=active]:from-emerald-500 data-[state=active]:to-teal-500 data-[state=active]:text-white">
              <FileText className="h-4 w-4 mr-2" />
              Reportes Excel
            </TabsTrigger>
            <TabsTrigger value="kiosk-wallet" className="flex-1 min-w-[120px] data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-indigo-500 data-[state=active]:text-white">
              <Wallet className="h-4 w-4 mr-2" />
              Recargas
            </TabsTrigger>
            <TabsTrigger value="comunicados" className="flex-1 min-w-[120px] data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-500 data-[state=active]:to-violet-500 data-[state=active]:text-white">
              <Bell className="h-4 w-4 mr-2" />
              Comunicados
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
                      placeholder="Buscar global por padre, DNI, correo, apodo o alumno..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 pr-10 border-emerald-300 focus:border-emerald-500 focus:ring-emerald-500"
                    />
                    {parentsLoading && (
                      <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-500 animate-spin" />
                    )}
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
                  {permissions.canCreateStudent && (
                    <Button onClick={() => setShowExpressEnroll(true)} className="gap-2 bg-gradient-to-r from-purple-600 to-violet-600 hover:from-purple-700 hover:to-violet-700 text-white shadow-md">
                      <Sparkles className="h-4 w-4" />
                      + Matriculación Express
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

                {parentsLoadError && (
                  <div className="mb-4 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {parentsLoadError}
                  </div>
                )}

                {/* Lista de padres — Listado Limpio con Acordeón */}
                <div className={`transition-opacity duration-200 ${parentsLoading ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
                  <ParentListAccordion
                    parents={filteredParents as unknown as AccordionParentRow[]}
                    permissions={permissions}
                    onResetPassword={(p) => {
                      setResetPasswordParent(p as unknown as ParentProfile);
                      setShowResetPassword(true);
                    }}
                    onMerge={(p) => {
                      setMergeSourceParent(p as unknown as ParentProfile);
                      setShowMergeModal(true);
                    }}
                    onEditParent={(p) => openEditModal(p as unknown as ParentProfile)}
                    onRefresh={fetchData}
                  />
                </div>

                {parentsLoading && (
                  <div className="mt-4 text-center text-sm text-emerald-700">
                    Actualizando resultados...
                  </div>
                )}

                {parentsTotalCount > PARENTS_PAGE_SIZE && (
                  <div className="flex items-center justify-center gap-4 mt-6 py-4 border-t border-emerald-200">
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-emerald-300 text-emerald-700 hover:bg-emerald-100"
                      disabled={parentsPage === 0}
                      onClick={() => setParentsPage(p => Math.max(0, p - 1))}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Anterior
                    </Button>
                    <span className="text-sm text-emerald-800 font-medium">
                      Página {parentsPage + 1} de {Math.ceil(parentsTotalCount / PARENTS_PAGE_SIZE)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-emerald-300 text-emerald-700 hover:bg-emerald-100"
                      disabled={(parentsPage + 1) * PARENTS_PAGE_SIZE >= parentsTotalCount}
                      onClick={() => setParentsPage(p => p + 1)}
                    >
                      Siguiente
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                )}

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

          {/* Pestaña de Gestión de Profesores - Solo visible con permiso */}
          {permissions.canViewTeachers && (
          <TabsContent value="teachers" className="mt-6">
            <Card className="border-2 border-emerald-200 bg-white/80 backdrop-blur-sm shadow-lg">
              <CardHeader className="bg-gradient-to-r from-emerald-100/60 to-teal-100/40 border-b-2 border-emerald-200">
                <CardTitle className="flex items-center gap-2 text-emerald-900">
                  <User2 className="h-6 w-6 text-emerald-600" />
                  Lista de Profesores
                  {teachersTotalCount > 0 && (
                    <span className="ml-auto text-sm font-normal text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full">
                      {teachersTotalCount} profesores
                    </span>
                  )}
                </CardTitle>
                <CardDescription className="text-emerald-700">
                  Visualiza y gestiona los perfiles de profesores del sistema.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                {/* Cargando profesores por primera vez */}
                {teachersLoading && (
                  <div className="flex flex-col items-center justify-center py-16 gap-3 text-emerald-600">
                    <div className="animate-spin h-8 w-8 border-4 border-emerald-500 border-t-transparent rounded-full" />
                    <p className="text-sm font-medium">Cargando profesores...</p>
                  </div>
                )}
                {!teachersLoading && !teachersLoaded && (
                  <div className="flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
                    <User2 className="h-12 w-12" />
                    <p className="text-sm">Haz clic en esta pestaña para cargar los profesores</p>
                  </div>
                )}
                {/* Barra de herramientas — solo cuando ya cargaron */}
                {teachersLoaded && !teachersLoading && (<>
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
                  {permissions.canCreateTeacher && (
                    <Button onClick={() => setShowCreateTeacher(true)} className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-md">
                      <UserPlus className="h-4 w-4" />
                      + Agregar Profesor
                    </Button>
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
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openTeacherResetModal(teacher)}
                            className="border-red-300 text-red-600 hover:bg-red-50"
                            title="Restablecer contraseña del profesor"
                          >
                            <KeyRound className="h-4 w-4" />
                          </Button>
                        </div>

                        {/* Información de contacto */}
                        <div className="space-y-3 mb-4">
                          <div className="grid grid-cols-1 gap-2">
                            <div className="flex items-center gap-2 text-sm">
                              <Mail className="h-4 w-4 text-emerald-600" />
                              <span className="font-medium text-emerald-800">Personal:</span>
                              <span className="text-emerald-700">{teacher.personal_email || 'No registrado'}</span>
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

                          {teacher.area && (
                            <div className="flex items-center gap-2 text-sm">
                              <Users className="h-4 w-4 text-emerald-600" />
                              <span className="font-medium text-emerald-800">Área:</span>
                              <span className="text-emerald-700">{teacher.area}</span>
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
                </>)}
              </CardContent>
            </Card>
          </TabsContent>
          )}

          {/* Pestaña Directorio de Alumnos */}
          <TabsContent value="directory" className="mt-6">
            <Card className="border-2 border-emerald-200 bg-white/80 backdrop-blur-sm shadow-lg">
              <CardContent className="pt-6">
                <StudentsDirectory
                  schoolId={userSchoolId}
                  canViewAllSchools={canViewAllSchools}
                />
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

          {/* Pestaña Saldos Kiosco */}
          <TabsContent value="kiosk-wallet" className="mt-6">
            <KioskWalletReport
              canViewAllSchools={canViewAllSchools}
              userSchoolId={userSchoolId}
              schools={schools}
            />
          </TabsContent>

          {/* ── Pestaña Comunicados ── */}
          <TabsContent value="comunicados" className="mt-6">
            <ComunicadosPanel
              schoolId={userSchoolId}
              canViewAllSchools={canViewAllSchools}
              schools={schools.map(s => ({ id: s.id, name: s.name }))}
            />
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
        <DialogContent className="max-w-2xl" aria-describedby={undefined}>
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
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-gradient-to-br from-emerald-50 to-teal-50" aria-describedby={undefined}>
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
                          <div className="rounded-lg p-4 border-2 bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-300">
                            <div className="flex items-center gap-2 mb-2">
                              <Wallet className="h-5 w-5 text-emerald-600" />
                              <p className="text-sm font-bold text-emerald-700">
                                Tipo de Cuenta
                              </p>
                            </div>
                            <Badge 
                              variant="secondary" 
                              className={`text-sm ${
                                child.kiosk_disabled
                                  ? 'bg-slate-100 text-slate-800 border-slate-300'
                                  : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                              }`}
                            >
                              {child.kiosk_disabled ? '🚫 Quiosco Bloqueado' : '🆓 Cuenta Libre'}
                            </Badge>
                            
                            {/* Mostrar tipo de límite si existe */}
                            {!child.kiosk_disabled && child.limit_type && child.limit_type !== 'none' && (
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

                          {/* Modo solo almuerzos (kiosco bloqueado) */}
                          {child.kiosk_disabled ? (
                            <div className="bg-gradient-to-br from-slate-50 to-gray-100 rounded-lg p-4 border-2 border-slate-300">
                              <div className="flex items-center gap-2 mb-2">
                                <CreditCard className="h-5 w-5 text-slate-600" />
                                <p className="text-sm font-bold text-slate-700">Solo Almuerzos</p>
                              </div>
                              <p className="text-base text-slate-900 font-semibold">
                                🚫 Sin acceso al quiosco
                              </p>
                              <p className="text-xs text-slate-600 mt-1">
                                Puede pedir almuerzos, pero no comprar en quiosco.
                              </p>
                            </div>
                          ) : (!child.limit_type || child.limit_type === 'none') && (
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

      {/* Modal restablecer contraseña del padre */}
      {resetPasswordParent && (
        <ResetUserPasswordModal
          open={showResetPassword}
          onOpenChange={(open) => { setShowResetPassword(open); if (!open) setResetPasswordParent(null); }}
          userName={resetPasswordParent.full_name}
          userEmail={resetPasswordParent.profile?.email || resetPasswordParent.email || ''}
          userId={resetPasswordParent.user_id || undefined}
          onSuccess={() => setShowResetPassword(false)}
        />
      )}

      {/* Modal restablecer contraseña del profesor */}
      {resetPasswordTeacher && (
        <ResetUserPasswordModal
          open={showTeacherResetPassword}
          onOpenChange={(open) => {
            setShowTeacherResetPassword(open);
            if (!open) setResetPasswordTeacher(null);
          }}
          userName={resetPasswordTeacher.full_name}
          userEmail={resetPasswordTeacher.corporate_email || resetPasswordTeacher.personal_email || ''}
          emails={(() => {
            const raw = [
              ...(resetPasswordTeacher.corporate_email ? [{ email: resetPasswordTeacher.corporate_email, label: 'corporativo' }] : []),
              ...(resetPasswordTeacher.personal_email ? [{ email: resetPasswordTeacher.personal_email, label: 'personal' }] : []),
            ];
            const seen = new Set<string>();
            return raw.filter((item) => {
              const key = item.email.toLowerCase();
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
          })()}
          userId={resetPasswordTeacher.user_id || resetPasswordTeacher.id || undefined}
          recipientKind="staff"
          onSuccess={() => setShowTeacherResetPassword(false)}
        />
      )}

      {/* Modal unir padres / resolver duplicados */}
      {mergeSourceParent && (
        <MergeParentsModal
          open={showMergeModal}
          onOpenChange={(open) => { setShowMergeModal(open); if (!open) setMergeSourceParent(null); }}
          sourceParent={mergeSourceParent}
          onMergeComplete={() => {
            setShowMergeModal(false);
            setMergeSourceParent(null);
            fetchData();
          }}
        />
      )}

      {/* Modal Matriculación Express */}
      <ExpressEnrollmentModal
        open={showExpressEnroll}
        onOpenChange={setShowExpressEnroll}
        onSuccess={fetchData}
        userRole={role}
        userSchoolId={userSchoolId}
      />

      {/* Modal Registro Rápido de Profesor */}
      <CreateTeacherModal
        open={showCreateTeacher}
        onOpenChange={setShowCreateTeacher}
        onSuccess={() => {
          setShowCreateTeacher(false);
          setTeachersLoaded(false);
          fetchTeachers();
        }}
        userRole={role}
        userSchoolId={userSchoolId}
        selectedSchoolFilter={selectedSchoolTeacher}
      />
    </div>
  );
};

export default ParentConfiguration;
