import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { 
  Search, 
  FileText, 
  ArrowUpDown,
  Eye,
  Download,
  Calendar as CalendarIcon,
  Trash2,
  AlertTriangle,
  ShoppingCart,
  User,
  Clock,
  Printer,
  Edit,
  X,
  CheckSquare,
  FileCheck,
  Receipt,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, startOfDay, endOfDay, addDays, subDays } from "date-fns";
import { es } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { ThermalTicket } from "@/components/pos/ThermalTicket";

interface Transaction {
  id: string;
  created_at: string;
  student_id: string | null;
  type: string;
  amount: number;
  description: string;
  balance_after: number;
  ticket_code: string;
  created_by: string;
  is_deleted?: boolean;
  deleted_at?: string;
  deleted_by?: string;
  deletion_reason?: string;
  client_name?: string;
  client_dni?: string;
  client_ruc?: string;
  document_type?: 'ticket' | 'boleta' | 'factura';
  student?: {
    id: string;
    full_name: string;
    balance: number;
  };
  profiles?: {
    email: string;
  };
}

interface TransactionItem {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

export const SalesList = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('today');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  
  // Selección múltiple
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // Modal de detalles
  const [showDetails, setShowDetails] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [transactionItems, setTransactionItems] = useState<TransactionItem[]>([]);
  
  // Modal de editar cliente
  const [showEditClient, setShowEditClient] = useState(false);
  const [editClientName, setEditClientName] = useState('');
  const [editClientDNI, setEditClientDNI] = useState('');
  const [editClientRUC, setEditClientRUC] = useState('');
  const [editDocumentType, setEditDocumentType] = useState<'ticket' | 'boleta' | 'factura'>('ticket');
  
  // Modal de anular venta
  const [showAnnul, setShowAnnul] = useState(false);
  const [annulReason, setAnnulReason] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Modal de impresión
  const [showPrintOptions, setShowPrintOptions] = useState(false);
  const [printType, setPrintType] = useState<'individual' | 'consolidated'>('individual');

  useEffect(() => {
    fetchTransactions();
  }, [activeTab, selectedDate]);

  const fetchTransactions = async () => {
    try {
      setLoading(true);
      
      const startDate = startOfDay(selectedDate).toISOString();
      const endDate = endOfDay(selectedDate).toISOString();

      console.log('🔍 INICIANDO BÚSQUEDA DE TRANSACCIONES:', {
        date: format(selectedDate, 'dd/MM/yyyy'),
        activeTab
      });

      let query = supabase
        .from('transactions')
        .select(`
          *,
          student:students(id, full_name, balance)
        `)
        .eq('type', 'purchase') // ✅ SOLO VENTAS (no recargas)
        .gte('created_at', startDate)
        .lte('created_at', endDate)
        .order('created_at', { ascending: false });

      // Filtrar según pestaña
      if (activeTab === 'deleted') {
        query = query.eq('is_deleted', true);
      } else if (activeTab === 'today') {
        query = query.or('is_deleted.is.null,is_deleted.eq.false');
      }

      const { data, error } = await query;

      if (error) {
        console.error('❌ Error:', error);
        throw error;
      }
      
      console.log('✅ Ventas obtenidas:', data?.length || 0);
      setTransactions(data || []);
    } catch (error: any) {
      console.error('Error fetching transactions:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar las ventas',
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchTransactionItems = async (transactionId: string) => {
    try {
      const { data, error } = await supabase
        .from('transaction_items')
        .select('*')
        .eq('transaction_id', transactionId);

      if (error) throw error;
      setTransactionItems(data || []);
    } catch (error: any) {
      console.error('Error fetching items:', error);
    }
  };

  // ========== MANEJO DE SELECCIÓN MÚLTIPLE ==========
  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const selectAll = () => {
    if (selectedIds.size === filteredTransactions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredTransactions.map(t => t.id)));
    }
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  // ========== EDITAR DATOS DEL CLIENTE ==========
  const handleOpenEditClient = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setEditClientName(transaction.client_name || transaction.student?.full_name || 'CLIENTE GENÉRICO');
    setEditClientDNI(transaction.client_dni || '');
    setEditClientRUC(transaction.client_ruc || '');
    setEditDocumentType(transaction.document_type || 'ticket');
    setShowEditClient(true);
  };

  const handleSaveClientData = async () => {
    if (!selectedTransaction) return;

    setIsProcessing(true);
    try {
      const { error } = await supabase
        .from('transactions')
        .update({
          client_name: editClientName.trim() || null,
          client_dni: editClientDNI.trim() || null,
          client_ruc: editClientRUC.trim() || null,
          document_type: editDocumentType,
        })
        .eq('id', selectedTransaction.id);

      if (error) throw error;

      toast({
        title: '✅ Datos Actualizados',
        description: 'La información del cliente fue actualizada correctamente',
      });

      setShowEditClient(false);
      fetchTransactions();
    } catch (error: any) {
      console.error('Error updating client data:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo actualizar la información',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // ========== ANULAR VENTA ==========
  const handleOpenAnnul = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setAnnulReason('');
    setShowAnnul(true);
  };

  const handleAnnulSale = async () => {
    if (!selectedTransaction || !annulReason.trim()) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Debes ingresar un motivo de anulación',
      });
      return;
    }

    setIsProcessing(true);
    try {
      // 1. Marcar como anulada
      const { error: updateError } = await supabase
        .from('transactions')
        .update({
          is_deleted: true,
          deleted_at: new Date().toISOString(),
          deleted_by: user?.id,
          deletion_reason: annulReason.trim(),
        })
        .eq('id', selectedTransaction.id);

      if (updateError) throw updateError;

      // 2. Si es venta de estudiante, devolver saldo
      if (selectedTransaction.student_id && selectedTransaction.student) {
        const amountToReturn = Math.abs(selectedTransaction.amount);
        const newBalance = selectedTransaction.student.balance + amountToReturn;

        const { error: balanceError } = await supabase
          .from('students')
          .update({ balance: newBalance })
          .eq('id', selectedTransaction.student_id);

        if (balanceError) throw balanceError;

        toast({
          title: '✅ Venta Anulada',
          description: `Saldo devuelto: S/ ${amountToReturn.toFixed(2)}. Nuevo saldo: S/ ${newBalance.toFixed(2)}`,
        });
      } else {
        toast({
          title: '✅ Venta Anulada',
          description: 'La venta fue marcada como anulada',
        });
      }

      setShowAnnul(false);
      fetchTransactions();
    } catch (error: any) {
      console.error('Error annulling sale:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo anular la venta',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // ========== REIMPRIMIR TICKET ==========
  const handleViewDetails = async (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    await fetchTransactionItems(transaction.id);
    setShowDetails(true);
  };

  const handleReprint = async (transaction: Transaction) => {
    try {
      // 1. Cargamos los datos y abrimos el modal para que se vea el ticket integrado
      setSelectedTransaction(transaction);
      await fetchTransactionItems(transaction.id);
      setShowDetails(true);
      
      // 2. Damos un pequeño respiro para que el modal se dibuje y luego lanzamos la impresión
      toast({
        title: "Preparando ticket...",
        description: "Abriendo vista previa e impresión",
      });
      
      setTimeout(() => {
        window.print();
      }, 500);
    } catch (error) {
      console.error("Error al reimprimir:", error);
    }
  };

  // ========== IMPRESIÓN MÚLTIPLE ==========
  const handlePrintSelected = () => {
    if (selectedIds.size === 0) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Selecciona al menos una venta',
      });
      return;
    }
    setShowPrintOptions(true);
  };

  const executePrint = () => {
    if (printType === 'individual') {
      // Imprimir tickets uno por uno (se abrirán múltiples ventanas de impresión)
      toast({
        title: 'Imprimiendo...',
        description: `Se imprimirán ${selectedIds.size} tickets`,
      });
      // TODO: Implementar impresión secuencial
    } else {
      // Consolidado (TODO: generar reporte PDF)
      toast({
        title: 'Generando consolidado...',
        description: 'Próximamente disponible',
      });
    }
    setShowPrintOptions(false);
  };

  // Búsqueda inteligente
  const filteredTransactions = transactions.filter(t => {
    if (!searchTerm.trim()) return true;
    
    const search = searchTerm.toLowerCase();
    return (
      t.ticket_code?.toLowerCase().includes(search) ||
      t.student?.full_name?.toLowerCase().includes(search) ||
      t.client_name?.toLowerCase().includes(search) ||
      t.description?.toLowerCase().includes(search) ||
      Math.abs(t.amount).toString().includes(search)
    );
  });

  const getTotalSales = () => {
    return filteredTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  };

  return (
    <div className="space-y-4">
      <Card className="border shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
            <div>
              <CardTitle className="text-xl flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-emerald-600" />
                Módulo de Ventas
              </CardTitle>
              <CardDescription className="flex items-center gap-2 mt-1">
                <CalendarIcon className="h-3 w-3" />
                {format(selectedDate, "EEEE, dd 'de' MMMM yyyy", { locale: es })}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Filtro de Fecha */}
              <div className="flex items-center bg-muted rounded-lg p-1 mr-2">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8"
                  onClick={() => setSelectedDate(prev => subDays(prev, 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                
                <Popover>
                  <PopoverTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 font-bold px-2 hover:bg-transparent"
                    >
                      {format(selectedDate, "dd/MM/yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={(date) => date && setSelectedDate(date)}
                      initialFocus
                      locale={es}
                    />
                  </PopoverContent>
                </Popover>

                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8"
                  onClick={() => setSelectedDate(prev => addDays(prev, 1))}
                  disabled={startOfDay(selectedDate).getTime() >= startOfDay(new Date()).getTime()}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {selectedIds.size > 0 && (
                <>
                  <Badge variant="secondary" className="text-sm">
                    {selectedIds.size} seleccionadas
                  </Badge>
                  <Button variant="outline" size="sm" onClick={handlePrintSelected}>
                    <Printer className="h-4 w-4 mr-2" />
                    Imprimir
                  </Button>
                  <Button variant="ghost" size="sm" onClick={clearSelection}>
                    <X className="h-4 w-4" />
                  </Button>
                </>
              )}
              <Button variant="outline" size="sm" onClick={fetchTransactions}>
                <ArrowUpDown className="h-4 w-4 mr-2" />
                Actualizar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Estadísticas */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card className="bg-emerald-50 border-emerald-200">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-emerald-600 font-semibold uppercase">Total Ventas</p>
                    <p className="text-2xl font-black text-emerald-900">S/ {getTotalSales().toFixed(2)}</p>
                  </div>
                  <FileText className="h-8 w-8 text-emerald-600 opacity-50" />
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-blue-600 font-semibold uppercase">Transacciones</p>
                    <p className="text-2xl font-black text-blue-900">{filteredTransactions.length}</p>
                  </div>
                  <ShoppingCart className="h-8 w-8 text-blue-600 opacity-50" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-purple-50 border-purple-200">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-purple-600 font-semibold uppercase">Promedio</p>
                    <p className="text-2xl font-black text-purple-900">
                      S/ {filteredTransactions.length > 0 ? (getTotalSales() / filteredTransactions.length).toFixed(2) : '0.00'}
                    </p>
                  </div>
                  <ArrowUpDown className="h-8 w-8 text-purple-600 opacity-50" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Buscador */}
          <div className="relative mb-6">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="🔍 Buscar: ticket, cliente, monto..."
              className="pl-10 h-12 text-base border-2 focus:border-emerald-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <Badge variant="secondary" className="text-xs">
                  {filteredTransactions.length} resultados
                </Badge>
              </div>
            )}
          </div>

          {/* Pestañas */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <div className="flex items-center justify-between">
              <TabsList className="grid grid-cols-2 h-auto">
                <TabsTrigger value="today" className="flex items-center gap-2 py-3">
                  <Clock className="h-4 w-4" />
                  <span>Ventas del Día</span>
                </TabsTrigger>
                <TabsTrigger value="deleted" className="flex items-center gap-2 py-3">
                  <Trash2 className="h-4 w-4" />
                  <span>Anuladas</span>
                </TabsTrigger>
              </TabsList>
              
              {filteredTransactions.length > 0 && (
                <Button variant="outline" size="sm" onClick={selectAll}>
                  <CheckSquare className="h-4 w-4 mr-2" />
                  {selectedIds.size === filteredTransactions.length ? 'Deseleccionar todo' : 'Seleccionar todo'}
                </Button>
              )}
            </div>

            <TabsContent value={activeTab} className="space-y-3">
              {loading ? (
                <div className="text-center py-12">
                  <p className="text-muted-foreground">Cargando ventas...</p>
                </div>
              ) : filteredTransactions.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="h-16 w-16 mx-auto mb-3 text-muted-foreground opacity-30" />
                  <p className="text-muted-foreground">
                    {searchTerm ? 'No se encontraron resultados' : 'No hay ventas hoy'}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {filteredTransactions.map((t) => (
                    <Card 
                      key={t.id} 
                      className={`hover:shadow-md transition-all border-l-4 ${
                        selectedIds.has(t.id) ? 'bg-blue-50 border-blue-500' : ''
                      }`}
                      style={{
                        borderLeftColor: t.is_deleted ? '#ef4444' : '#10b981'
                      }}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={selectedIds.has(t.id)}
                            onCheckedChange={() => toggleSelection(t.id)}
                          />
                          
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <Badge variant="outline" className="font-mono text-xs font-bold">
                                {t.ticket_code || '---'}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {format(new Date(t.created_at), "HH:mm", { locale: es })}
                              </span>
                              {t.is_deleted && (
                                <Badge variant="destructive" className="text-[10px]">ANULADA</Badge>
                              )}
                              {t.document_type && t.document_type !== 'ticket' && (
                                <Badge variant="secondary" className="text-[10px]">
                                  {t.document_type.toUpperCase()}
                                </Badge>
                              )}
                            </div>
                            
                            <div className="flex items-center gap-2 mb-1">
                              <User className="h-4 w-4 text-muted-foreground" />
                              <span className="font-semibold text-sm">
                                {t.client_name || t.student?.full_name || 'CLIENTE GENÉRICO'}
                              </span>
                            </div>
                          </div>
                          
                          <div className="text-right">
                            <p className="text-2xl font-black text-emerald-600">
                              S/ {Math.abs(t.amount).toFixed(2)}
                            </p>
                            <div className="flex gap-1 mt-2">
                              {/* Botón Integrado: Ver y Reimprimir */}
                              <Button 
                                variant="outline" 
                                size="sm"
                                className="h-8 gap-1 border-blue-200 hover:bg-blue-50 text-blue-700"
                                onClick={() => handleReprint(t)}
                                title="Ver y Reimprimir Ticket"
                              >
                                <Printer className="h-3.5 w-3.5" />
                                <span className="text-[10px] font-bold">TICKET</span>
                              </Button>

                              {!t.is_deleted && (
                                <>
                                  <Button 
                                    variant="ghost" 
                                    size="sm"
                                    className="h-8 w-8 p-0"
                                    onClick={() => handleOpenEditClient(t)}
                                    title="Editar datos del cliente"
                                  >
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                  <Button 
                                    variant="ghost" 
                                    size="sm"
                                    className="h-8 w-8 p-0"
                                    onClick={() => handleOpenAnnul(t)}
                                    title="Anular venta"
                                  >
                                    <Trash2 className="h-4 w-4 text-red-600" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* MODAL: Editar Datos del Cliente */}
      <Dialog open={showEditClient} onOpenChange={setShowEditClient}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="h-5 w-5 text-blue-600" />
              Editar Datos del Cliente
            </DialogTitle>
            <DialogDescription>
              Ticket: {selectedTransaction?.ticket_code}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <Label htmlFor="docType">Tipo de Documento</Label>
              <Select value={editDocumentType} onValueChange={(v: any) => setEditDocumentType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ticket">Ticket (Interno)</SelectItem>
                  <SelectItem value="boleta">Boleta Electrónica</SelectItem>
                  <SelectItem value="factura">Factura Electrónica</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="clientName">Nombre del Cliente</Label>
              <Input
                id="clientName"
                value={editClientName}
                onChange={(e) => setEditClientName(e.target.value)}
                placeholder="Nombre completo o Razón Social"
              />
            </div>

            {editDocumentType === 'boleta' && (
              <div>
                <Label htmlFor="clientDNI">DNI (8 dígitos)</Label>
                <Input
                  id="clientDNI"
                  value={editClientDNI}
                  onChange={(e) => setEditClientDNI(e.target.value)}
                  placeholder="12345678"
                  maxLength={8}
                />
              </div>
            )}

            {editDocumentType === 'factura' && (
              <div>
                <Label htmlFor="clientRUC">RUC (11 dígitos)</Label>
                <Input
                  id="clientRUC"
                  value={editClientRUC}
                  onChange={(e) => setEditClientRUC(e.target.value)}
                  placeholder="20XXXXXXXXX"
                  maxLength={11}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditClient(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveClientData} disabled={isProcessing}>
              {isProcessing ? 'Guardando...' : 'Guardar Cambios'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL: Anular Venta */}
      <Dialog open={showAnnul} onOpenChange={setShowAnnul}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Anular Venta
            </DialogTitle>
            <DialogDescription>
              Ticket: {selectedTransaction?.ticket_code}
              {selectedTransaction?.student && (
                <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded text-sm">
                  ⚠️ Se devolverá S/ {Math.abs(selectedTransaction.amount).toFixed(2)} a {selectedTransaction.student.full_name}
                </div>
              )}
            </DialogDescription>
          </DialogHeader>
          
          <div>
            <Label htmlFor="reason">Motivo de Anulación *</Label>
            <Textarea
              id="reason"
              value={annulReason}
              onChange={(e) => setAnnulReason(e.target.value)}
              placeholder="Ej: Error en el pedido, producto incorrecto, cliente canceló..."
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAnnul(false)}>
              Cancelar
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleAnnulSale} 
              disabled={isProcessing || !annulReason.trim()}
            >
              {isProcessing ? 'Anulando...' : 'Confirmar Anulación'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL: Detalles de Venta (DISEÑO TICKET REAL) */}
      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-[400px] p-0 bg-gray-100 overflow-hidden">
          <DialogHeader className="p-4 bg-white border-b">
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-blue-600" />
              Vista de Comprobante
            </DialogTitle>
          </DialogHeader>
          
          <div className="p-6 overflow-y-auto max-h-[70vh]">
            {selectedTransaction && (
              <ThermalTicket
                ticketCode={selectedTransaction.ticket_code}
                date={new Date(selectedTransaction.created_at)}
                cashierEmail={selectedTransaction.profiles?.email || 'sistema'}
                clientName={selectedTransaction.client_name || selectedTransaction.student?.full_name || 'CLIENTE GENÉRICO'}
                documentType={selectedTransaction.document_type || 'ticket'}
                items={transactionItems}
                total={Math.abs(selectedTransaction.amount)}
                clientDNI={selectedTransaction.client_dni}
                clientRUC={selectedTransaction.client_ruc}
                isReprint={false}
                showOnScreen={true} // ✅ Se muestra como ticket en pantalla
              />
            )}
          </div>

          <DialogFooter className="p-4 bg-white border-t flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setShowDetails(false)}>
              Cerrar
            </Button>
            <Button className="flex-1 gap-2" onClick={() => selectedTransaction && handleReprint(selectedTransaction)}>
              <Printer className="h-4 w-4" />
              Imprimir Real
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* TICKET TÉRMICO (Oculto, para impresión) */}
      {selectedTransaction && transactionItems.length > 0 && (
        <ThermalTicket
          ticketCode={selectedTransaction.ticket_code}
          date={new Date(selectedTransaction.created_at)}
          cashierEmail="sistema" // TODO: obtener del created_by
          clientName={selectedTransaction.client_name || selectedTransaction.student?.full_name || 'CLIENTE GENÉRICO'}
          documentType={selectedTransaction.document_type || 'ticket'}
          items={transactionItems}
          total={Math.abs(selectedTransaction.amount)}
          clientDNI={selectedTransaction.client_dni}
          clientRUC={selectedTransaction.client_ruc}
          isReprint={true}
        />
      )}
    </div>
  );
};
