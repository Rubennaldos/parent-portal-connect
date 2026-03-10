import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShoppingCart, Calendar, CreditCard, Plus, Clock, CheckCircle2, AlertTriangle, ArrowLeft, GraduationCap, Wrench } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { CreateSupplyRequestModal } from '@/components/school-admin/CreateSupplyRequestModal';
import { GradesManagement } from '@/components/school-admin/GradesManagement';
import { NFCCardsManager } from '@/components/admin/NFCCardsManager';
import { MaintenanceConfig } from '@/components/school-admin/MaintenanceConfig';

interface SupplyRequest {
  id: string;
  request_number: string;
  status: string;
  created_at: string;
  items_count: number;
  notes: string;
}

const SchoolAdmin = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [userSchoolId, setUserSchoolId] = useState<string | null>(null);
  const [myRequests, setMyRequests] = useState<SupplyRequest[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    loadData();
  }, [user]);

  const loadData = async () => {
    if (!user) return;
    
    try {
      setLoading(true);
      
      // Obtener el school_id y rol del usuario
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('school_id, role')
        .eq('id', user.id)
        .single();

      if (profileError) throw profileError;
      
      // Admin General puede no tener school_id, es normal
      setUserSchoolId(profileData.school_id);

      // Cargar pedidos de esta sede (solo si tiene school_id)
      if (profileData.school_id) {
        const { data: requestsData, error: requestsError } = await supabase
          .from('supply_requests')
          .select(`
            *,
            items:supply_request_items(count)
          `)
          .eq('requesting_school_id', profileData.school_id)
          .order('created_at', { ascending: false });

        if (requestsError) throw requestsError;

        const formattedRequests = requestsData?.map(req => ({
          ...req,
          items_count: req.items?.[0]?.count || 0
        })) || [];

        setMyRequests(formattedRequests);
      }

    } catch (error: any) {
      console.error('Error loading school admin data:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo cargar la información',
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      pending: { label: 'Pendiente', color: 'bg-yellow-100 text-yellow-700', icon: Clock },
      processing: { label: 'En Proceso', color: 'bg-blue-100 text-blue-700', icon: ShoppingCart },
      partially_fulfilled: { label: 'Parcial', color: 'bg-orange-100 text-orange-700', icon: AlertTriangle },
      fulfilled: { label: 'Completado', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
    const Icon = config.icon;

    return (
      <Badge className={`${config.color} flex items-center gap-1`}>
        <Icon className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#8B4513] mx-auto"></div>
          <p className="mt-4 text-slate-600">Cargando administración de sede...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFCFB] p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-black text-slate-800 flex items-center gap-3">
              <ShoppingCart className="h-8 w-8 text-[#8B4513]" />
              Administración de Sede
            </h1>
            <p className="text-slate-400 font-medium mt-1">
              Gestión de pedidos, calendarios y tarjetas de identificación
            </p>
          </div>
          <Button 
            variant="outline" 
            onClick={() => navigate('/dashboard')}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver al Panel
          </Button>
        </div>

        {/* Tabs Principales */}
        <Tabs defaultValue="requests" className="w-full">
          <TabsList className="grid w-full grid-cols-5 bg-white border rounded-xl p-1">
            <TabsTrigger value="requests" className="data-[state=active]:bg-[#8B4513] data-[state=active]:text-white text-xs sm:text-sm px-1 sm:px-3">
              <ShoppingCart className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Pedidos</span>
            </TabsTrigger>
            <TabsTrigger value="grades" className="data-[state=active]:bg-[#8B4513] data-[state=active]:text-white text-xs sm:text-sm px-1 sm:px-3">
              <GraduationCap className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Grados</span>
            </TabsTrigger>
            <TabsTrigger value="calendar" className="data-[state=active]:bg-[#8B4513] data-[state=active]:text-white text-xs sm:text-sm px-1 sm:px-3">
              <Calendar className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Calendario</span>
            </TabsTrigger>
            <TabsTrigger value="cards" className="data-[state=active]:bg-[#8B4513] data-[state=active]:text-white text-xs sm:text-sm px-1 sm:px-3">
              <CreditCard className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Tarjetas</span>
            </TabsTrigger>
            <TabsTrigger value="maintenance" className="data-[state=active]:bg-amber-600 data-[state=active]:text-white text-xs sm:text-sm px-1 sm:px-3">
              <Wrench className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Mant.</span>
            </TabsTrigger>
          </TabsList>

          {/* Pestaña de Pedidos */}
          <TabsContent value="requests" className="mt-6">
            <Card className="border-2 border-[#8B4513]/20">
              <CardHeader className="bg-gradient-to-r from-amber-50 to-orange-50">
                <div className="text-center">
                  <CardTitle className="flex items-center justify-center gap-3 text-2xl mb-3">
                    <ShoppingCart className="h-8 w-8 text-[#8B4513]" />
                    Módulo de Pedidos
                  </CardTitle>
                  <Badge className="bg-gradient-to-r from-[#8B4513] to-amber-700 text-white text-lg px-6 py-2">
                    🚧 Próximamente
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-8">
                {/* Especificaciones del Módulo */}
                <div className="space-y-6 max-w-4xl mx-auto">
                  {/* Descripción General */}
                  <div className="bg-gradient-to-br from-blue-50 to-indigo-50 p-6 rounded-xl border-2 border-blue-200">
                    <h3 className="text-xl font-black text-blue-900 mb-3 flex items-center gap-2">
                      <ShoppingCart className="h-6 w-6" />
                      ¿Qué es este módulo?
                    </h3>
                    <p className="text-blue-800 leading-relaxed">
                      El módulo de <strong>Pedidos de Suministros</strong> permitirá a los administradores de sede solicitar mercadería, ingredientes y productos desde la sede central o almacén principal de forma organizada y trazable.
                    </p>
                  </div>

                  {/* Funcionalidades */}
                  <div className="bg-gradient-to-br from-emerald-50 to-teal-50 p-6 rounded-xl border-2 border-emerald-200">
                    <h3 className="text-xl font-black text-emerald-900 mb-4 flex items-center gap-2">
                      <CheckCircle2 className="h-6 w-6" />
                      Funcionalidades Incluidas
                    </h3>
                    <ul className="space-y-3 text-emerald-800">
                      <li className="flex items-start gap-3">
                        <span className="text-emerald-600 font-bold text-xl">•</span>
                        <div>
                          <strong>Crear Pedidos:</strong> Solicitar productos del catálogo con cantidades específicas.
                        </div>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="text-emerald-600 font-bold text-xl">•</span>
                        <div>
                          <strong>Historial de Pedidos:</strong> Ver todos los pedidos realizados con su estado actual (Pendiente, En Proceso, Completado).
                        </div>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="text-emerald-600 font-bold text-xl">•</span>
                        <div>
                          <strong>Tracking en Tiempo Real:</strong> Seguimiento del estado de cada pedido desde la solicitud hasta la entrega.
                        </div>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="text-emerald-600 font-bold text-xl">•</span>
                        <div>
                          <strong>Notificaciones:</strong> Alertas cuando un pedido cambia de estado o es completado.
                        </div>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="text-emerald-600 font-bold text-xl">•</span>
                        <div>
                          <strong>Reportes:</strong> Generación de reportes de pedidos por fecha, estado o sede.
                        </div>
                      </li>
                    </ul>
                  </div>

                  {/* Requerimientos */}
                  <div className="bg-gradient-to-br from-amber-50 to-orange-50 p-6 rounded-xl border-2 border-amber-200">
                    <h3 className="text-xl font-black text-amber-900 mb-4 flex items-center gap-2">
                      <AlertTriangle className="h-6 w-6" />
                      Requerimientos del Sistema
                    </h3>
                    <ul className="space-y-3 text-amber-800">
                      <li className="flex items-start gap-3">
                        <span className="text-amber-600 font-bold text-xl">•</span>
                        <div>
                          <strong>Catálogo de Productos:</strong> Base de datos completa con todos los productos disponibles para pedido.
                        </div>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="text-amber-600 font-bold text-xl">•</span>
                        <div>
                          <strong>Control de Inventario:</strong> Integración con el módulo de logística para verificar stock disponible.
                        </div>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="text-amber-600 font-bold text-xl">•</span>
                        <div>
                          <strong>Roles y Permisos:</strong> Definir qué usuarios pueden crear, aprobar y completar pedidos.
                        </div>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="text-amber-600 font-bold text-xl">•</span>
                        <div>
                          <strong>Sistema de Aprobación:</strong> Flujo de trabajo para aprobar pedidos antes de procesarlos.
                        </div>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="text-amber-600 font-bold text-xl">•</span>
                        <div>
                          <strong>Notificaciones por Email:</strong> Configuración SMTP para enviar alertas automáticas.
                        </div>
                      </li>
                    </ul>
                  </div>

                  {/* Beneficios */}
                  <div className="bg-gradient-to-br from-purple-50 to-pink-50 p-6 rounded-xl border-2 border-purple-200">
                    <h3 className="text-xl font-black text-purple-900 mb-4 flex items-center gap-2">
                      <Clock className="h-6 w-6" />
                      Beneficios para tu Sede
                    </h3>
                    <ul className="space-y-3 text-purple-800">
                      <li className="flex items-start gap-3">
                        <span className="text-purple-600 font-bold text-xl">✓</span>
                        <div>Mayor control y trazabilidad de los pedidos realizados.</div>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="text-purple-600 font-bold text-xl">✓</span>
                        <div>Reducción de errores en la gestión de inventarios.</div>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="text-purple-600 font-bold text-xl">✓</span>
                        <div>Optimización del tiempo en la solicitud de suministros.</div>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="text-purple-600 font-bold text-xl">✓</span>
                        <div>Visibilidad completa del estado de cada pedido.</div>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="text-purple-600 font-bold text-xl">✓</span>
                        <div>Mejor planificación y previsión de necesidades.</div>
                      </li>
                    </ul>
                  </div>

                  {/* Mensaje Final */}
                  <div className="text-center bg-gradient-to-r from-slate-50 to-gray-100 p-6 rounded-xl border-2 border-slate-300">
                    <p className="text-slate-600 text-lg">
                      Este módulo estará disponible próximamente. Mientras tanto, puedes contactar al administrador para realizar pedidos manuales.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Pestaña de Grados y Salones */}
          <TabsContent value="grades" className="mt-6">
            <GradesManagement schoolId={userSchoolId} />
          </TabsContent>

          {/* Pestaña de Calendario */}
          <TabsContent value="calendar" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-6 w-6 text-[#8B4513]" />
                  Calendarios
                </CardTitle>
                <CardDescription>
                  Eventos académicos e internos
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-slate-400 text-center py-12">Próximamente: Gestión de eventos</p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Pestaña de Tarjetas ID */}
          <TabsContent value="cards" className="mt-6">
            <NFCCardsManager schoolId={userSchoolId} />
          </TabsContent>

          {/* Pestaña de Modo Mantenimiento */}
          <TabsContent value="maintenance" className="mt-6">
            <MaintenanceConfig schoolId={userSchoolId} />
          </TabsContent>
        </Tabs>

        {/* Modal de Crear Pedido */}
        <CreateSupplyRequestModal
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={loadData}
          userSchoolId={userSchoolId}
        />
      </div>
    </div>
  );
};

export default SchoolAdmin;
