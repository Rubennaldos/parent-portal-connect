import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Users, Plus, Download, Search, Baby, AlertCircle, Loader2 } from "lucide-react";
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ParentCard } from '@/components/admin/ParentCard';
import { useParentsSearch, type ParentSearchItem, type ParentChildLite } from '@/hooks/useParentsSearch';

interface School {
  id: string;
  name: string;
  code: string;
}

export default function ParentsManagement() {
  const { user } = useAuth();
  const { role } = useRole();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [schools, setSchools] = useState<School[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSchool, setSelectedSchool] = useState<string>('all');
  const [page, setPage] = useState(1);
  
  // Permisos y alcance
  const [canViewAllSchools, setCanViewAllSchools] = useState(false);
  const [userSchoolId, setUserSchoolId] = useState<string | null>(null);
  
  // Permisos granulares
  const [permissions, setPermissions] = useState({
    canCreateParent: false,
    canEditParent: false,
    canCreateStudent: false,
    canEditStudent: false,
  });
  
  // Modales
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showChildrenModal, setShowChildrenModal] = useState(false);
  
  // Datos seleccionados
  const [selectedParent, setSelectedParent] = useState<ParentSearchItem | null>(null);
  const [parentChildren, setParentChildren] = useState<ParentChildLite[]>([]);
  
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

  const effectiveSchoolId = canViewAllSchools
    ? (selectedSchool === 'all' ? null : selectedSchool)
    : userSchoolId;

  const {
    parents,
    loading: searchingParents,
    error: searchError,
    minLengthError,
    totalCount,
    totalPages,
    refresh: refreshParents,
  } = useParentsSearch({
    searchTerm,
    schoolId: effectiveSchoolId,
    page,
    pageSize: 30,
  });

  useEffect(() => {
    checkPermissions();
  }, [user, role]);

  useEffect(() => {
    if (!loading && (canViewAllSchools || userSchoolId)) {
      fetchSchools();
    }
  }, [loading, canViewAllSchools, userSchoolId]);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, selectedSchool]);

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

  const fetchSchools = async () => {
    try {
      const { data: schoolsData, error: schoolsError } = await supabase
        .from('schools')
        .select('*')
        .order('name');
      
      if (schoolsError) throw schoolsError;
      setSchools(schoolsData || []);
    } catch (error) {
      console.error('Error al cargar sedes:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar las sedes.',
      });
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
      await refreshParents();
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
      await refreshParents();
    } catch (error: any) {
      console.error('Error al editar padre:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo actualizar el perfil.',
      });
    }
  };

  const handleDeleteParent = async () => {
    if (!selectedParent) return;

    try {
      const { error } = await supabase
        .from('parent_profiles')
        .delete()
        .eq('id', selectedParent.id);

      if (error) throw error;

      toast({
        title: '✅ Padre Eliminado',
        description: `El perfil ha sido eliminado.`,
      });

      setShowDeleteModal(false);
      setSelectedParent(null);
      await refreshParents();
    } catch (error: any) {
      console.error('Error al eliminar padre:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo eliminar el perfil.',
      });
    }
  };

  const handleViewChildren = async (parent: ParentSearchItem) => {
    setSelectedParent(parent);
    setParentChildren(parent.children || []);
    setShowChildrenModal(true);
  };

  const exportToExcel = () => {
    const data = parents.map(parent => ({
      'Nombre Completo': parent.full_name,
      'Sobrenombre': parent.nickname || '-',
      'DNI': parent.dni,
      'Teléfono 1': parent.phone_1,
      'Teléfono 2': parent.phone_2 || '-',
      'Email': parent.email || '-',
      'Dirección': parent.address,
      'Sede': parent.school_name || 'Sin asignar',
      'Cantidad de Hijos': parent.children_count || 0,
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
    
    // Agregar logos (simulado - necesitarías las imágenes reales)
    doc.setFontSize(18);
    doc.text('ARQUISIA', 15, 15);
    doc.text('Lima Café 28', 150, 15);
    
    doc.setFontSize(14);
    doc.text('Reporte de Padres', 15, 30);
    
    doc.setFontSize(10);
    doc.text(`Fecha: ${new Date().toLocaleDateString()}`, 15, 38);

    const tableData = parents.map(parent => [
      parent.full_name,
      parent.nickname || '-',
      parent.dni,
      parent.phone_1,
      parent.school_name || 'Sin asignar',
      parent.children_count || 0,
    ]);

    autoTable(doc, {
      startY: 45,
      head: [['Nombre', 'Sobrenombre', 'DNI', 'Teléfono', 'Sede', 'Hijos']],
      body: tableData,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [41, 128, 185] },
    });

    doc.save(`Padres_${new Date().toISOString().split('T')[0]}.pdf`);

    toast({
      title: '✅ Exportado',
      description: 'Los datos se han exportado a PDF.',
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

  const openEditModal = (parent: ParentSearchItem) => {
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Cargando padres...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            Configuración de Padres
          </CardTitle>
          <CardDescription>
            Gestiona los perfiles de padres y estudiantes del sistema.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Barra de herramientas */}
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por padre, DNI, correo, apodo o nombre del alumno..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setPage(1);
                }}
                className="pl-10 pr-10"
              />
              {searchingParents && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
            {canViewAllSchools && (
              <Select
                value={selectedSchool}
                onValueChange={(value) => {
                  setSelectedSchool(value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-full sm:w-[200px]">
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
              <Button onClick={() => setShowCreateModal(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                Nuevo Padre
              </Button>
            )}
            <Button onClick={exportToExcel} variant="outline" className="gap-2">
              <Download className="h-4 w-4" />
              Excel
            </Button>
            <Button onClick={exportToPDF} variant="outline" className="gap-2">
              <Download className="h-4 w-4" />
              PDF
            </Button>
          </div>

          {minLengthError && (
            <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              {minLengthError}
            </div>
          )}

          {searchError && (
            <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {searchError}
            </div>
          )}

          {searchingParents ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto"></div>
              <p className="mt-4 text-muted-foreground">Consultando padres...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {parents.map(parent => (
                <ParentCard
                  key={parent.id}
                  parent={parent}
                  canEditParent={permissions.canEditParent}
                  onViewChildren={handleViewChildren}
                  onEditParent={openEditModal}
                />
              ))}
            </div>
          )}

          {parents.length === 0 && !searchingParents && !searchError && !minLengthError && (
            <div className="text-center py-12">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No se encontraron padres.</p>
            </div>
          )}

          {!minLengthError && !searchError && totalCount > 0 && (
            <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Mostrando página {page} de {totalPages} ({totalCount} resultados)
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || searchingParents}
                  onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || searchingParents}
                  onClick={() => setPage((prev) => Math.min(prev + 1, totalPages))}
                >
                  Siguiente
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

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
            <Button variant="outline" onClick={() => { setShowCreateModal(false); resetForm(); }}>
              Cancelar
            </Button>
            <Button onClick={handleCreateParent}>Crear Padre</Button>
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
            <Button variant="outline" onClick={() => { setShowEditModal(false); resetForm(); }}>
              Cancelar
            </Button>
            <Button onClick={handleEditParent}>Guardar Cambios</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Eliminar */}
      <Dialog open={showDeleteModal} onOpenChange={setShowDeleteModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Eliminar Padre?</DialogTitle>
            <DialogDescription>
              Esta acción no se puede deshacer. ¿Estás seguro de eliminar el perfil de{' '}
              <strong>{selectedParent?.full_name}</strong>?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteModal(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDeleteParent}>
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Ver Hijos */}
      <Dialog open={showChildrenModal} onOpenChange={setShowChildrenModal}>
        <DialogContent className="max-w-3xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Baby className="h-5 w-5" />
              Hijos de {selectedParent?.full_name}
              {selectedParent?.nickname && (
                <span className="text-sm text-muted-foreground">({selectedParent.nickname})</span>
              )}
            </DialogTitle>
          </DialogHeader>
          
          {parentChildren.length > 0 ? (
            <div className="space-y-4">
              {parentChildren.map(child => (
                <Card key={child.id}>
                  <CardContent className="pt-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-muted-foreground">Nombre Completo</Label>
                        <p className="font-medium">{child.full_name}</p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground">Grado</Label>
                        <p className="font-medium">{child.grade}</p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground">Sección</Label>
                        <p className="font-medium">{child.section}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <Baby className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                Este padre no tiene hijos registrados en el sistema.
              </p>
            </div>
          )}
          
          <DialogFooter>
            <Button onClick={() => setShowChildrenModal(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

