import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShoppingCart, Calendar, CreditCard, Plus, Clock, CheckCircle2, AlertTriangle, ArrowLeft } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { CreateSupplyRequestModal } from '@/components/school-admin/CreateSupplyRequestModal';

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
      
      // Obtener el school_id del usuario
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('school_id')
        .eq('id', user.id)
        .single();

      if (profileError) throw profileError;
      
      setUserSchoolId(profileData.school_id);

      // Cargar pedidos de esta sede
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
          <TabsList className="grid w-full grid-cols-3 bg-white border rounded-xl p-1">
            <TabsTrigger value="requests" className="data-[state=active]:bg-[#8B4513] data-[state=active]:text-white">
              <ShoppingCart className="h-4 w-4 mr-2" />
              Pedidos
            </TabsTrigger>
            <TabsTrigger value="calendar" className="data-[state=active]:bg-[#8B4513] data-[state=active]:text-white">
              <Calendar className="h-4 w-4 mr-2" />
              Calendario
            </TabsTrigger>
            <TabsTrigger value="cards" className="data-[state=active]:bg-[#8B4513] data-[state=active]:text-white">
              <CreditCard className="h-4 w-4 mr-2" />
              Tarjetas ID
            </TabsTrigger>
          </TabsList>

          {/* Pestaña de Pedidos */}
          <TabsContent value="requests" className="mt-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <ShoppingCart className="h-6 w-6 text-[#8B4513]" />
                      Mis Pedidos de Suministros
                    </CardTitle>
                    <CardDescription>
                      Solicita mercadería e ingredientes para tu sede
                    </CardDescription>
                  </div>
                  <Button 
                    className="bg-[#8B4513] hover:bg-[#6F370F]"
                    onClick={() => setShowCreateModal(true)}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Nuevo Pedido
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {myRequests.length > 0 ? (
                  <div className="space-y-3">
                    {myRequests.map(request => (
                      <Card key={request.id} className="border-l-4 border-l-blue-500">
                        <CardContent className="pt-4">
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <p className="font-black text-slate-800 text-lg">{request.request_number}</p>
                              <p className="text-sm text-slate-500">{request.items_count} items solicitados</p>
                              {request.notes && (
                                <p className="text-xs text-slate-400 mt-1">📝 {request.notes}</p>
                              )}
                              <p className="text-xs text-slate-400 mt-1">
                                {new Date(request.created_at).toLocaleDateString('es-PE', {
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </p>
                            </div>
                            <div>
                              {getStatusBadge(request.status)}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <ShoppingCart className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground mb-4">No has creado pedidos aún</p>
                    <Button 
                      className="bg-[#8B4513] hover:bg-[#6F370F]"
                      onClick={() => setShowCreateModal(true)}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Crear Primer Pedido
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
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
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-6 w-6 text-[#8B4513]" />
                  Tarjetas de Identificación
                </CardTitle>
                <CardDescription>
                  Activar y vincular tarjetas a estudiantes y padres
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-slate-400 text-center py-12">Próximamente: Sistema de activación de tarjetas</p>
              </CardContent>
            </Card>
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
