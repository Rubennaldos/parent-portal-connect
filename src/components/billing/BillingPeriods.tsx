import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { 
  Calendar as CalendarIcon,
  Plus,
  Edit,
  Trash2,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Clock,
  Building2,
  Loader2
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface School {
  id: string;
  name: string;
  code: string;
}

interface BillingPeriod {
  id: string;
  school_id: string;
  period_name: string;
  start_date: string;
  end_date: string;
  status: 'draft' | 'open' | 'closed';
  visible_to_parents: boolean;
  notes: string | null;
  created_at: string;
  schools?: School;
}

export const BillingPeriods = () => {
  const { user } = useAuth();
  const { role } = useRole();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [periods, setPeriods] = useState<BillingPeriod[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [userSchoolId, setUserSchoolId] = useState<string | null>(null);
  
  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<BillingPeriod | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    school_id: '',
    period_name: '',
    start_date: new Date(),
    end_date: new Date(),
    status: 'draft' as 'draft' | 'open' | 'closed',
    visible_to_parents: false,
    notes: '',
  });

  const canViewAllSchools = role === 'admin_general';

  useEffect(() => {
    fetchSchools();
    fetchUserSchool();
    fetchPeriods();
  }, []);

  const fetchSchools = async () => {
    try {
      const { data, error } = await supabase
        .from('schools')
        .select('*')
        .order('name');
      
      if (error) throw error;
      setSchools(data || []);
    } catch (error) {
      console.error('Error fetching schools:', error);
    }
  };

  const fetchUserSchool = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('school_id')
        .eq('id', user.id)
        .single();
      
      if (error) throw error;
      setUserSchoolId(data?.school_id || null);
      
      // Si no es admin_general, setear su sede por defecto
      if (!canViewAllSchools && data?.school_id) {
        setFormData(prev => ({ ...prev, school_id: data.school_id }));
      }
    } catch (error) {
      console.error('Error fetching user school:', error);
    }
  };

  const fetchPeriods = async () => {
    try {
      setLoading(true);

      let query = supabase
        .from('billing_periods')
        .select(`
          *,
          schools(id, name, code)
        `)
        .order('created_at', { ascending: false });

      // Si no es admin_general, solo ve su sede
      if (!canViewAllSchools && userSchoolId) {
        query = query.eq('school_id', userSchoolId);
      }

      const { data, error } = await query;

      if (error) throw error;
      setPeriods(data || []);
    } catch (error) {
      console.error('Error fetching periods:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar los períodos',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (period?: BillingPeriod) => {
    if (period) {
      setEditingPeriod(period);
      setFormData({
        school_id: period.school_id,
        period_name: period.period_name,
        start_date: new Date(period.start_date),
        end_date: new Date(period.end_date),
        status: period.status,
        visible_to_parents: period.visible_to_parents,
        notes: period.notes || '',
      });
    } else {
      setEditingPeriod(null);
      setFormData({
        school_id: canViewAllSchools ? '' : (userSchoolId || ''),
        period_name: '',
        start_date: new Date(),
        end_date: new Date(),
        status: 'draft',
        visible_to_parents: false,
        notes: '',
      });
    }
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.school_id || !formData.period_name) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'La sede y el nombre son obligatorios',
      });
      return;
    }

    if (formData.end_date < formData.start_date) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'La fecha final debe ser mayor o igual a la fecha inicial',
      });
      return;
    }

    setSaving(true);
    try {
      const periodData = {
        school_id: formData.school_id,
        period_name: formData.period_name,
        start_date: format(formData.start_date, 'yyyy-MM-dd'),
        end_date: format(formData.end_date, 'yyyy-MM-dd'),
        status: formData.status,
        visible_to_parents: formData.visible_to_parents,
        notes: formData.notes || null,
        created_by: user?.id,
      };

      if (editingPeriod) {
        // Actualizar
        const { error } = await supabase
          .from('billing_periods')
          .update(periodData)
          .eq('id', editingPeriod.id);

        if (error) throw error;

        toast({
          title: '✅ Período actualizado',
          description: 'Los cambios se guardaron correctamente',
        });
      } else {
        // Crear
        const { error } = await supabase
          .from('billing_periods')
          .insert(periodData);

        if (error) throw error;

        toast({
          title: '✅ Período creado',
          description: 'El nuevo período se creó correctamente',
        });
      }

      setShowModal(false);
      fetchPeriods();
    } catch (error: any) {
      console.error('Error saving period:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo guardar el período',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (period: BillingPeriod) => {
    if (!confirm(`¿Estás seguro de eliminar el período "${period.period_name}"?`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('billing_periods')
        .delete()
        .eq('id', period.id);

      if (error) throw error;

      toast({
        title: '✅ Período eliminado',
        description: 'El período se eliminó correctamente',
      });

      fetchPeriods();
    } catch (error: any) {
      console.error('Error deleting period:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo eliminar el período',
      });
    }
  };

  const toggleVisibility = async (period: BillingPeriod) => {
    try {
      const { error } = await supabase
        .from('billing_periods')
        .update({ visible_to_parents: !period.visible_to_parents })
        .eq('id', period.id);

      if (error) throw error;

      toast({
        title: '✅ Visibilidad actualizada',
        description: period.visible_to_parents 
          ? 'El período ahora está oculto para padres'
          : 'El período ahora es visible para padres',
      });

      fetchPeriods();
    } catch (error) {
      console.error('Error toggling visibility:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo cambiar la visibilidad',
      });
    }
  };

  const changeStatus = async (period: BillingPeriod, newStatus: 'draft' | 'open' | 'closed') => {
    try {
      const { error } = await supabase
        .from('billing_periods')
        .update({ status: newStatus })
        .eq('id', period.id);

      if (error) throw error;

      toast({
        title: '✅ Estado actualizado',
        description: `El período ahora está en estado: ${newStatus}`,
      });

      fetchPeriods();
    } catch (error) {
      console.error('Error changing status:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo cambiar el estado',
      });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return <Badge variant="outline" className="bg-gray-100">📝 Borrador</Badge>;
      case 'open':
        return <Badge variant="default" className="bg-green-500">✅ Abierto</Badge>;
      case 'closed':
        return <Badge variant="secondary" className="bg-red-500">🔒 Cerrado</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-red-600" />
        <p className="ml-3 text-gray-600">Cargando períodos...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header con botón crear */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Períodos de Cobranza</h2>
          <p className="text-gray-600 mt-1">Gestiona los períodos de facturación de tu sede</p>
        </div>
        <Button onClick={() => handleOpenModal()} className="bg-red-600 hover:bg-red-700">
          <Plus className="h-4 w-4 mr-2" />
          Crear Período
        </Button>
      </div>

      {/* Lista de períodos */}
      {periods.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CalendarIcon className="h-16 w-16 mx-auto mb-4 text-gray-400" />
            <h3 className="text-lg font-semibold text-gray-700 mb-2">No hay períodos creados</h3>
            <p className="text-gray-500 mb-4">
              Crea tu primer período de cobranza para empezar a gestionar pagos
            </p>
            <Button onClick={() => handleOpenModal()} variant="outline">
              <Plus className="h-4 w-4 mr-2" />
              Crear Primer Período
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {periods.map((period) => (
            <Card key={period.id} className="hover:shadow-lg transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg mb-2">{period.period_name}</CardTitle>
                    {canViewAllSchools && period.schools && (
                      <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                        <Building2 className="h-4 w-4" />
                        <span>{period.schools.name}</span>
                      </div>
                    )}
                    <div className="flex gap-2">
                      {getStatusBadge(period.status)}
                      {period.visible_to_parents ? (
                        <Badge variant="outline" className="bg-blue-50 border-blue-300">
                          <Eye className="h-3 w-3 mr-1" />
                          Visible
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-gray-50">
                          <EyeOff className="h-3 w-3 mr-1" />
                          Oculto
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2 text-sm">
                  <CalendarIcon className="h-4 w-4 text-gray-500" />
                  <span className="text-gray-700">
                    {format(new Date(period.start_date), 'dd MMM yyyy', { locale: es })}
                    {' → '}
                    {format(new Date(period.end_date), 'dd MMM yyyy', { locale: es })}
                  </span>
                </div>

                {period.notes && (
                  <p className="text-sm text-gray-600 bg-gray-50 p-2 rounded">
                    {period.notes}
                  </p>
                )}

                {/* Botones de acción */}
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleOpenModal(period)}
                  >
                    <Edit className="h-3 w-3 mr-1" />
                    Editar
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggleVisibility(period)}
                  >
                    {period.visible_to_parents ? (
                      <><EyeOff className="h-3 w-3 mr-1" /> Ocultar</>
                    ) : (
                      <><Eye className="h-3 w-3 mr-1" /> Mostrar</>
                    )}
                  </Button>

                  {period.status === 'draft' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-green-500 text-green-600 hover:bg-green-50"
                      onClick={() => changeStatus(period, 'open')}
                    >
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Abrir
                    </Button>
                  )}

                  {period.status === 'open' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-red-500 text-red-600 hover:bg-red-50"
                      onClick={() => changeStatus(period, 'closed')}
                    >
                      <XCircle className="h-3 w-3 mr-1" />
                      Cerrar
                    </Button>
                  )}

                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleDelete(period)}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Eliminar
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Modal Crear/Editar */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingPeriod ? 'Editar Período' : 'Crear Nuevo Período'}
            </DialogTitle>
            <DialogDescription>
              Define el rango de fechas y configuración para este período de cobranza
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Sede (solo si es admin_general) */}
            {canViewAllSchools && (
              <div className="space-y-2">
                <Label htmlFor="school_id">Sede *</Label>
                <Select
                  value={formData.school_id}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, school_id: value }))}
                >
                  <SelectTrigger id="school_id">
                    <SelectValue placeholder="Selecciona una sede" />
                  </SelectTrigger>
                  <SelectContent>
                    {schools.map((school) => (
                      <SelectItem key={school.id} value={school.id}>
                        {school.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Nombre del período */}
            <div className="space-y-2">
              <Label htmlFor="period_name">Nombre del Período *</Label>
              <Input
                id="period_name"
                placeholder="Ej: Semana 1-5 Enero 2026"
                value={formData.period_name}
                onChange={(e) => setFormData(prev => ({ ...prev, period_name: e.target.value }))}
              />
            </div>

            {/* Fechas */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Fecha Inicio *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(formData.start_date, 'dd MMM yyyy', { locale: es })}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={formData.start_date}
                      onSelect={(date) => date && setFormData(prev => ({ ...prev, start_date: date }))}
                      locale={es}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>Fecha Fin *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(formData.end_date, 'dd MMM yyyy', { locale: es })}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={formData.end_date}
                      onSelect={(date) => date && setFormData(prev => ({ ...prev, end_date: date }))}
                      locale={es}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Estado */}
            <div className="space-y-2">
              <Label htmlFor="status">Estado</Label>
              <Select
                value={formData.status}
                onValueChange={(value: any) => setFormData(prev => ({ ...prev, status: value }))}
              >
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">📝 Borrador (no visible)</SelectItem>
                  <SelectItem value="open">✅ Abierto (listo para cobrar)</SelectItem>
                  <SelectItem value="closed">🔒 Cerrado (histórico)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Visible para padres */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="visible_to_parents"
                checked={formData.visible_to_parents}
                onChange={(e) => setFormData(prev => ({ ...prev, visible_to_parents: e.target.checked }))}
                className="w-4 h-4"
              />
              <Label htmlFor="visible_to_parents" className="cursor-pointer">
                Visible para padres en el portal
              </Label>
            </div>

            {/* Notas */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notas (Opcional)</Label>
              <Textarea
                id="notes"
                placeholder="Información adicional sobre este período..."
                value={formData.notes}
                onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving} className="bg-red-600 hover:bg-red-700">
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  {editingPeriod ? 'Actualizar' : 'Crear'} Período
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
