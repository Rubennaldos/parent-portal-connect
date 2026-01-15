import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Package, 
  TruckIcon, 
  HardDrive, 
  BarChart3, 
  Search,
  Plus,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowLeft
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { ProcessRequestModal } from '@/components/logistics/ProcessRequestModal';

interface InventoryItem {
  id: string;
  code: string;
  name: string;
  category: {
    name: string;
    color: string;
    icon: string;
  };
  unit: string;
  min_stock: number;
  cost_per_unit: number;
  central_stock: number;
  is_active: boolean;
}

interface SupplyRequest {
  id: string;
  request_number: string;
  requesting_school: {
    name: string;
  };
  requested_by: {
    full_name: string;
  };
  status: string;
  created_at: string;
  items_count: number;
}

const Logistics = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [supplyRequests, setSupplyRequests] = useState<SupplyRequest[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  
  // Modal de procesamiento
  const [showProcessModal, setShowProcessModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<{
    id: string;
    number: string;
    school: string;
  } | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);

      // Cargar items de inventario con stock central
      const { data: items, error: itemsError } = await supabase
        .from('inventory_items')
        .select(`
          *,
          category:inventory_categories(name, color, icon),
          central_stock:inventory_stock!inner(quantity)
        `)
        .eq('inventory_stock.school_id', null)
        .eq('is_active', true)
        .order('name');

      if (itemsError) throw itemsError;

      const formattedItems = items?.map(item => ({
        ...item,
        central_stock: item.central_stock?.[0]?.quantity || 0
      })) || [];

      setInventoryItems(formattedItems);

      // Cargar pedidos pendientes
      const { data: requests, error: requestsError } = await supabase
        .from('supply_requests')
        .select(`
          *,
          requesting_school:schools(name),
          requested_by:profiles(full_name),
          items:supply_request_items(count)
        `)
        .in('status', ['pending', 'processing'])
        .order('created_at', { ascending: false });

      if (requestsError) throw requestsError;

      const formattedRequests = requests?.map(req => ({
        ...req,
        items_count: req.items?.[0]?.count || 0
      })) || [];

      setSupplyRequests(formattedRequests);

    } catch (error: any) {
      console.error('Error loading logistics data:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo cargar la información de logística',
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      pending: { label: 'Pendiente', color: 'bg-yellow-100 text-yellow-700', icon: Clock },
      processing: { label: 'En Proceso', color: 'bg-blue-100 text-blue-700', icon: TruckIcon },
      partially_fulfilled: { label: 'Parcial', color: 'bg-orange-100 text-orange-700', icon: AlertTriangle },
      fulfilled: { label: 'Completado', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
      cancelled: { label: 'Cancelado', color: 'bg-red-100 text-red-700', icon: XCircle },
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

  const getLowStockItems = () => {
    return inventoryItems.filter(item => item.central_stock <= item.min_stock);
  };

  const handleOpenProcessModal = (request: SupplyRequest) => {
    setSelectedRequest({
      id: request.id,
      number: request.request_number,
      school: request.requesting_school.name
    });
    setShowProcessModal(true);
  };

  const handleCloseProcessModal = () => {
    setShowProcessModal(false);
    setSelectedRequest(null);
  };

  const handleProcessSuccess = () => {
    loadData(); // Recargar datos después de procesar
  };

  const filteredItems = inventoryItems.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.code.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || item.category.name === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#8B4513] mx-auto"></div>
          <p className="mt-4 text-slate-600">Cargando sistema de logística...</p>
        </div>
      </div>
    );
  }

  const lowStockItems = getLowStockItems();

  return (
    <div className="min-h-screen bg-[#FDFCFB] p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-black text-slate-800 flex items-center gap-3">
              <Package className="h-8 w-8 text-[#8B4513]" />
              Logística y Almacén
            </h1>
            <p className="text-slate-400 font-medium mt-1">
              Gestión de inventarios, pedidos y órdenes de compra
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

        {/* Alertas de Stock Bajo */}
        {lowStockItems.length > 0 && (
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            <AlertDescription className="text-red-800 font-medium">
              ⚠️ {lowStockItems.length} producto(s) con stock bajo o agotado
            </AlertDescription>
          </Alert>
        )}

        {/* Estadísticas Rápidas */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="border-l-4 border-l-blue-500">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500 font-medium">Total Items</p>
                  <p className="text-3xl font-black text-slate-800">{inventoryItems.length}</p>
                </div>
                <Package className="h-10 w-10 text-blue-500 opacity-20" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-yellow-500">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500 font-medium">Pedidos Pendientes</p>
                  <p className="text-3xl font-black text-slate-800">{supplyRequests.length}</p>
                </div>
                <Clock className="h-10 w-10 text-yellow-500 opacity-20" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-red-500">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500 font-medium">Stock Bajo</p>
                  <p className="text-3xl font-black text-slate-800">{lowStockItems.length}</p>
                </div>
                <AlertTriangle className="h-10 w-10 text-red-500 opacity-20" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-green-500">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500 font-medium">Valor Total</p>
                  <p className="text-3xl font-black text-slate-800">
                    S/ {inventoryItems.reduce((sum, item) => sum + (item.central_stock * item.cost_per_unit), 0).toFixed(2)}
                  </p>
                </div>
                <BarChart3 className="h-10 w-10 text-green-500 opacity-20" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs Principales */}
        <Tabs defaultValue="inventory" className="w-full">
          <TabsList className="grid w-full grid-cols-4 bg-white border rounded-xl p-1">
            <TabsTrigger value="inventory" className="data-[state=active]:bg-[#8B4513] data-[state=active]:text-white">
              <Package className="h-4 w-4 mr-2" />
              Inventario
            </TabsTrigger>
            <TabsTrigger value="requests" className="data-[state=active]:bg-[#8B4513] data-[state=active]:text-white">
              <TruckIcon className="h-4 w-4 mr-2" />
              Pedidos
            </TabsTrigger>
            <TabsTrigger value="assets" className="data-[state=active]:bg-[#8B4513] data-[state=active]:text-white">
              <HardDrive className="h-4 w-4 mr-2" />
              Activos
            </TabsTrigger>
            <TabsTrigger value="analytics" className="data-[state=active]:bg-[#8B4513] data-[state=active]:text-white">
              <BarChart3 className="h-4 w-4 mr-2" />
              Analytics
            </TabsTrigger>
          </TabsList>

          {/* Pestaña de Inventario */}
          <TabsContent value="inventory" className="mt-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Package className="h-6 w-6 text-[#8B4513]" />
                      Inventario Central
                    </CardTitle>
                    <CardDescription>
                      Gestiona el stock de productos en el almacén central
                    </CardDescription>
                  </div>
                  <Button className="bg-[#8B4513] hover:bg-[#6F370F]">
                    <Plus className="h-4 w-4 mr-2" />
                    Nuevo Producto
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {/* Búsqueda y Filtros */}
                <div className="flex gap-4 mb-6">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar por nombre o código..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>

                {/* Lista de Items */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredItems.map(item => {
                    const isLowStock = item.central_stock <= item.min_stock;
                    
                    return (
                      <Card key={item.id} className={`border-l-4 ${isLowStock ? 'border-l-red-500 bg-red-50' : 'border-l-blue-500'}`}>
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <CardTitle className="text-lg">{item.name}</CardTitle>
                              <p className="text-sm text-slate-500">{item.code}</p>
                            </div>
                            <Badge style={{ backgroundColor: item.category.color }} className="text-white">
                              {item.category.name}
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-slate-600">Stock Central:</span>
                            <span className={`text-2xl font-black ${isLowStock ? 'text-red-600' : 'text-slate-800'}`}>
                              {item.central_stock} {item.unit}
                            </span>
                          </div>
                          
                          {isLowStock && (
                            <Alert className="bg-red-100 border-red-300">
                              <AlertTriangle className="h-4 w-4 text-red-600" />
                              <AlertDescription className="text-red-700 text-xs">
                                Stock mínimo: {item.min_stock} {item.unit}
                              </AlertDescription>
                            </Alert>
                          )}

                          <div className="pt-2 text-xs text-slate-500">
                            <p>Costo unitario: S/ {item.cost_per_unit}</p>
                            <p>Valor total: S/ {(item.central_stock * item.cost_per_unit).toFixed(2)}</p>
                          </div>

                          <Button variant="outline" size="sm" className="w-full mt-2">
                            Ver Detalles
                          </Button>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                {filteredItems.length === 0 && (
                  <div className="text-center py-12">
                    <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">No se encontraron productos.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Pestaña de Pedidos */}
          <TabsContent value="requests" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TruckIcon className="h-6 w-6 text-[#8B4513]" />
                  Pedidos de Suministros
                </CardTitle>
                <CardDescription>
                  Procesa solicitudes de las sedes con checklist inteligente
                </CardDescription>
              </CardHeader>
              <CardContent>
                {supplyRequests.length > 0 ? (
                  <div className="space-y-4">
                    {supplyRequests.map(request => (
                      <Card key={request.id} className="border-l-4 border-l-yellow-500">
                        <CardContent className="pt-6">
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <p className="font-black text-slate-800 text-lg">{request.request_number}</p>
                              <p className="text-sm text-slate-500">
                                {request.requesting_school.name} • {request.items_count} items
                              </p>
                              <p className="text-xs text-slate-400">
                                Solicitado por: {request.requested_by.full_name}
                              </p>
                              <p className="text-xs text-slate-400">
                                {new Date(request.created_at).toLocaleDateString('es-PE')}
                              </p>
                            </div>
                            <div className="text-right space-y-2">
                              {getStatusBadge(request.status)}
                              <Button 
                                size="sm" 
                                className="bg-[#8B4513] hover:bg-[#6F370F] w-full"
                                onClick={() => handleOpenProcessModal(request)}
                              >
                                Procesar Pedido
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <TruckIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">No hay pedidos pendientes</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Pestaña de Activos */}
          <TabsContent value="assets" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <HardDrive className="h-6 w-6 text-[#8B4513]" />
                  Inventario de Activos
                </CardTitle>
                <CardDescription>
                  Máquinas, equipos y mobiliario
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-slate-400 text-center py-12">Próximamente: Gestión de activos fijos</p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Pestaña de Analytics */}
          <TabsContent value="analytics" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-6 w-6 text-[#8B4513]" />
                  Analytics de Inventario
                </CardTitle>
                <CardDescription>
                  Reportes de rotación de stock y costos
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-slate-400 text-center py-12">Próximamente: Reportes y gráficos con Lima Analytics</p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Modal de Procesamiento */}
        {selectedRequest && (
          <ProcessRequestModal
            requestId={selectedRequest.id}
            requestNumber={selectedRequest.number}
            schoolName={selectedRequest.school}
            open={showProcessModal}
            onClose={handleCloseProcessModal}
            onSuccess={handleProcessSuccess}
          />
        )}
      </div>
    </div>
  );
};

export default Logistics;
