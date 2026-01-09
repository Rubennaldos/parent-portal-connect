import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Users, Plus, Edit, Trash2, Download, Search, Baby, UserCircle } from "lucide-react";
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
  code: string;
  grade: string;
  section: string;
}

interface ParentProfile {
  id: string;
  user_id: string;
  full_name: string;
  nickname?: string;
  dni: string;
  phone_1: string;
  phone_2?: string;
  email?: string;
  address: string;
  school_id: string;
  school: School | null;
  children?: Student[];
  created_at: string;
}

interface Transaction {
  id: string;
  amount: number;
  type: string;
  created_at: string;
}

export default function ParentsManagement() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [parents, setParents] = useState<ParentProfile[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSchool, setSelectedSchool] = useState<string>('all');
  
  // Modales
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showChildrenModal, setShowChildrenModal] = useState(false);
  const [showTransactionsModal, setShowTransactionsModal] = useState(false);
  
  // Datos seleccionados
  const [selectedParent, setSelectedParent] = useState<ParentProfile | null>(null);
  const [parentChildren, setParentChildren] = useState<Student[]>([]);
  const [parentTransactions, setParentTransactions] = useState<Transaction[]>([]);
  
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
    fetchData();
  }, []);

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

      // Obtener perfiles de padres con sus hijos
      const { data: parentsData, error: parentsError } = await supabase
        .from('parent_profiles')
        .select(`
          *,
          school:schools(id, name, code)
        `)
        .order('full_name');
      
      if (parentsError) throw parentsError;
      
      // Para cada padre, obtener sus hijos
      if (parentsData) {
        const parentsWithChildren = await Promise.all(
          parentsData.map(async (parent) => {
            const { data: childrenData } = await supabase
              .from('students')
              .select('id, full_name, code, grade, section')
              .eq('parent_id', parent.user_id);
            
            return {
              ...parent,
              children: childrenData || []
            };
          })
        );
        setParents(parentsWithChildren);
      } else {
        setParents([]);
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
      fetchData();
    } catch (error: any) {
      console.error('Error al eliminar padre:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo eliminar el perfil.',
      });
    }
  };

  const handleViewChildren = async (parent: ParentProfile) => {
    setSelectedParent(parent);
    setParentChildren(parent.children || []);
    setShowChildrenModal(true);
  };

  const handleViewTransactions = async (parent: ParentProfile) => {
    setSelectedParent(parent);
    setShowTransactionsModal(true);

    try {
      // Obtener todas las transacciones de los hijos del padre
      if (!parent.children || parent.children.length === 0) {
        setParentTransactions([]);
        return;
      }

      const studentIds = parent.children.map(child => child.id);
      
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .in('student_id', studentIds)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setParentTransactions(data || []);
    } catch (error) {
      console.error('Error al cargar transacciones:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar las transacciones.',
      });
    }
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
    
    // Agregar logos (simulado - necesitarías las imágenes reales)
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
                placeholder="Buscar por nombre, DNI o sobrenombre..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={selectedSchool} onValueChange={setSelectedSchool}>
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
            <Button onClick={() => setShowCreateModal(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Nuevo Padre
            </Button>
            <Button onClick={exportToExcel} variant="outline" className="gap-2">
              <Download className="h-4 w-4" />
              Excel
            </Button>
            <Button onClick={exportToPDF} variant="outline" className="gap-2">
              <Download className="h-4 w-4" />
              PDF
            </Button>
          </div>

          {/* Lista de padres */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredParents.map(parent => (
              <Card key={parent.id} className="border-l-4 border-blue-500">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg">{parent.full_name}</CardTitle>
                      {parent.nickname && (
                        <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                          <UserCircle className="h-3 w-3" />
                          "{parent.nickname}"
                        </p>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-sm">
                    <p><strong>DNI:</strong> {parent.dni}</p>
                    <p><strong>Teléfono:</strong> {parent.phone_1}</p>
                    <p><strong>Sede:</strong> {parent.school?.name || 'Sin asignar'}</p>
                    <p className="flex items-center gap-1">
                      <Baby className="h-4 w-4" />
                      <strong>Hijos:</strong> {parent.children?.length || 0}
                    </p>
                  </div>
                  
                  <div className="flex gap-2 pt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleViewChildren(parent)}
                      className="flex-1"
                    >
                      <Baby className="h-4 w-4 mr-1" />
                      Ver Hijos
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEditModal(parent)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSelectedParent(parent);
                        setShowDeleteModal(true);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {filteredParents.length === 0 && (
            <div className="text-center py-12">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No se encontraron padres.</p>
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
        <DialogContent className="max-w-3xl">
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
                        <Label className="text-muted-foreground">Código</Label>
                        <p className="font-medium">{child.code}</p>
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

