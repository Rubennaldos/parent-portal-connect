import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  ShoppingCart, 
  LogOut, 
  Search,
  Plus,
  Minus,
  Trash2,
  AlertCircle,
  CheckCircle2,
  User,
  Coffee,
  Cookie,
  UtensilsCrossed,
  X,
  Printer,
  Receipt,
  Users,
  Maximize2
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface Student {
  id: string;
  full_name: string;
  photo_url: string | null;
  balance: number;
  grade: string;
  section: string;
}

interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  image_url?: string | null;
  active?: boolean;
}

interface CartItem {
  product: Product;
  quantity: number;
}

const POS = () => {
  const { signOut, user } = useAuth();
  const { role } = useRole();
  const { toast } = useToast();
  const navigate = useNavigate();

  console.log('🏪 POS - Componente montado');
  console.log('👤 POS - Usuario:', user?.email);
  console.log('🎭 POS - Rol:', role);

  // Estados de cliente
  const [clientMode, setClientMode] = useState<'student' | 'generic' | null>(null);
  const [studentSearch, setStudentSearch] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [showStudentResults, setShowStudentResults] = useState(false);
  const [studentWillPay, setStudentWillPay] = useState(false); // Switch para que estudiante pague
  const [showPhotoModal, setShowPhotoModal] = useState(false); // Para ampliar foto del estudiante

  // Estados de productos
  const [productSearch, setProductSearch] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('todos');

  // Estados de carrito y venta
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Estados de pago (solo para cliente genérico)
  const [paymentMethod, setPaymentMethod] = useState<'efectivo' | 'yape' | 'tarjeta'>('efectivo');
  const [documentType, setDocumentType] = useState<'ticket' | 'boleta' | 'factura'>('ticket');
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false); // NUEVO: confirmación

  // Estado de ticket generado
  const [showTicketPrint, setShowTicketPrint] = useState(false);
  const [ticketData, setTicketData] = useState<any>(null);

  // Cargar productos al inicio
  useEffect(() => {
    fetchProducts();
  }, []);

  // Filtrar productos
  useEffect(() => {
    let filtered = products;

    if (selectedCategory !== 'todos') {
      filtered = filtered.filter(p => p.category === selectedCategory);
    }

    if (productSearch.trim()) {
      filtered = filtered.filter(p => 
        p.name.toLowerCase().includes(productSearch.toLowerCase())
      );
    }

    setFilteredProducts(filtered);
  }, [productSearch, selectedCategory, products]);

  // Buscar estudiantes
  useEffect(() => {
    if (clientMode === 'student' && studentSearch.trim().length >= 2) {
      searchStudents(studentSearch);
      setShowStudentResults(true);
    } else {
      setStudents([]);
      setShowStudentResults(false);
    }
  }, [studentSearch, clientMode]);

  const fetchProducts = async () => {
    console.log('🔵 POS - Iniciando carga de productos...');
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('active', true)
        .order('category', { ascending: true })
        .order('name', { ascending: true });

      console.log('📦 POS - Productos recibidos:', data?.length || 0);
      if (error) {
        console.error('❌ POS - Error en query de productos:', error);
        throw error;
      }
      
      setProducts(data || []);
      setFilteredProducts(data || []);
      console.log('✅ POS - Productos cargados correctamente');
    } catch (error: any) {
      console.error('💥 POS - Error crítico cargando productos:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar los productos: ' + error.message,
      });
    }
  };

  const searchStudents = async (query: string) => {
    try {
      const { data, error } = await supabase
        .from('students')
        .select('*')
        .eq('is_active', true)
        .ilike('full_name', `%${query}%`)
        .limit(5);

      if (error) throw error;
      setStudents(data || []);
    } catch (error: any) {
      console.error('Error searching students:', error);
    }
  };

  const selectStudent = (student: Student) => {
    setSelectedStudent(student);
    setStudentSearch(student.full_name);
    setShowStudentResults(false);
    setStudentWillPay(false); // Por defecto, estudiante va a crédito
  };

  const selectGenericClient = () => {
    setClientMode('generic');
    setSelectedStudent(null);
    setStudentSearch('');
  };

  const selectStudentMode = () => {
    console.log('📚 Modo Estudiante seleccionado - Limpiando búsqueda');
    setClientMode('student');
    setSelectedStudent(null);
    setStudentSearch(''); // Asegurar que empiece vacío
    setShowStudentResults(false);
  };

  const resetClient = () => {
    console.log('🧹 Limpiando estado del cliente...');
    setClientMode(null);
    setSelectedStudent(null);
    setStudentSearch('');
    setStudentWillPay(false);
    setCart([]);
    setProductSearch('');
    setSelectedCategory('todos');
    setShowStudentResults(false);
    setPaymentMethod('efectivo');
    setDocumentType('ticket');
    console.log('✅ Estado limpio - Modal de selección debe aparecer');
  };

  const addToCart = (product: Product) => {
    const existing = cart.find(item => item.product.id === product.id);
    
    if (existing) {
      setCart(cart.map(item =>
        item.product.id === product.id
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      setCart([...cart, { product, quantity: 1 }]);
    }
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart(cart.map(item => {
      if (item.product.id === productId) {
        const newQuantity = item.quantity + delta;
        return newQuantity > 0 ? { ...item, quantity: newQuantity } : item;
      }
      return item;
    }).filter(item => item.quantity > 0));
  };

  const removeFromCart = (productId: string) => {
    setCart(cart.filter(item => item.product.id !== productId));
  };

  const getTotal = () => {
    return cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
  };

  const canCheckout = () => {
    if (!clientMode) return false;
    if (cart.length === 0) return false;
    
    // Si es estudiante pagando al contado o a crédito
    if (clientMode === 'student' && selectedStudent) {
      if (studentWillPay) {
        return true; // Estudiante pagará al contado
      } else {
        // Estudiante a crédito - verificar saldo
        return selectedStudent.balance >= getTotal();
      }
    }
    
    // Si es cliente genérico
    if (clientMode === 'generic') {
      return true;
    }
    
    return false;
  };

  const handleCheckoutClick = () => {
    if (!canCheckout()) return;

    // Siempre mostrar modal de confirmación primero
    setShowConfirmDialog(true);
  };

  const handleConfirmCheckout = async (shouldPrint: boolean = false) => {
    // Si es cliente genérico, mostrar opciones de pago
    if (clientMode === 'generic') {
      setShowConfirmDialog(false);
      setShowPaymentDialog(true);
    } else {
      // Si es estudiante, procesar directo
      await processCheckout();
      
      // Si debe imprimir, hacerlo
      if (shouldPrint && ticketData) {
        setTimeout(() => {
          window.print();
        }, 300);
      }
      
      // Después de procesar, resetear automáticamente
      setShowConfirmDialog(false);
      resetClient();
    }
  };

  const processCheckout = async () => {
    setIsProcessing(true);

    try {
      const total = getTotal();
      let ticketCode = '';

      console.log('🔵 INICIANDO CHECKOUT', {
        clientMode,
        studentWillPay,
        selectedStudent: selectedStudent?.full_name,
        total,
        userId: user?.id
      });

      // Generar correlativo
      try {
        const { data: ticketNumber, error: ticketError } = await supabase
          .rpc('get_next_ticket_number', { p_user_id: user?.id });

        if (ticketError) {
          console.error('❌ Error generando correlativo:', ticketError);
          ticketCode = `TMP-${Date.now()}`;
        } else {
          console.log('✅ Correlativo generado:', ticketNumber);
          ticketCode = ticketNumber;
        }
      } catch (err) {
        console.error('❌ Error en correlativo:', err);
        ticketCode = `TMP-${Date.now()}`;
      }

      // Preparar datos del ticket
      const ticketInfo: any = {
        code: ticketCode,
        clientName: clientMode === 'student' ? selectedStudent?.full_name : 'CLIENTE GENÉRICO',
        clientType: clientMode,
        items: cart,
        total: total,
        paymentMethod: clientMode === 'generic' ? paymentMethod : (studentWillPay ? 'efectivo' : 'credito'),
        documentType: clientMode === 'generic' ? documentType : 'ticket',
        timestamp: new Date(),
        cashierEmail: user?.email || 'No disponible',
      };

      // Si es estudiante a crédito (no paga)
      if (clientMode === 'student' && !studentWillPay && selectedStudent) {
        console.log('💳 ESTUDIANTE A CRÉDITO', {
          studentId: selectedStudent.id,
          balanceActual: selectedStudent.balance,
          total,
          newBalance: selectedStudent.balance - total
        });

        const newBalance = selectedStudent.balance - total;

        // Crear transacción
        const { data: transaction, error: transError } = await supabase
          .from('transactions')
          .insert({
            student_id: selectedStudent.id,
            type: 'purchase',
            amount: -total,
            description: `Compra en POS - ${cart.length} items`,
            balance_after: newBalance,
            created_by: user?.id,
            ticket_code: ticketCode,
          })
          .select()
          .single();

        if (transError) {
          console.error('❌ Error creando transacción:', transError);
          throw transError;
        }
        console.log('✅ Transacción creada:', transaction);

        // Crear items
        const items = cart.map(item => ({
          transaction_id: transaction.id,
          product_id: item.product.id,
          product_name: item.product.name,
          quantity: item.quantity,
          unit_price: item.product.price,
          subtotal: item.product.price * item.quantity,
        }));

        const { error: itemsError } = await supabase
          .from('transaction_items')
          .insert(items);

        if (itemsError) {
          console.error('❌ Error creando items:', itemsError);
          throw itemsError;
        }
        console.log('✅ Items creados:', items.length);

        // Actualizar saldo
        console.log('💰 ACTUALIZANDO SALDO DEL ESTUDIANTE', {
          studentId: selectedStudent.id,
          oldBalance: selectedStudent.balance,
          newBalance
        });

        const { error: updateError } = await supabase
          .from('students')
          .update({ balance: newBalance })
          .eq('id', selectedStudent.id);

        if (updateError) {
          console.error('❌ Error actualizando saldo:', updateError);
          throw updateError;
        }
        console.log('✅ Saldo actualizado correctamente');

        // Actualizar el saldo en el estado local del estudiante seleccionado
        if (selectedStudent) {
          setSelectedStudent({
            ...selectedStudent,
            balance: newBalance
          });
        }

        ticketInfo.newBalance = newBalance;
      } else {
        // Cliente genérico o estudiante pagando - Solo registrar la venta (sin afectar saldo)
        const { data: transaction, error: transError } = await supabase
          .from('transactions')
          .insert({
            student_id: selectedStudent?.id || null,
            type: 'purchase',
            amount: -total,
            description: `Compra ${clientMode === 'generic' ? 'Cliente Genérico' : 'Estudiante (Efectivo)'} - ${cart.length} items`,
            balance_after: selectedStudent?.balance || 0,
            created_by: user?.id,
            ticket_code: ticketCode,
          })
          .select()
          .single();

        if (transError) throw transError;

        const items = cart.map(item => ({
          transaction_id: transaction.id,
          product_id: item.product.id,
          product_name: item.product.name,
          quantity: item.quantity,
          unit_price: item.product.price,
          subtotal: item.product.price * item.quantity,
        }));

        await supabase.from('transaction_items').insert(items);
      }

      // Mostrar notificación rápida (sin modal)
      console.log('🎫 VENTA COMPLETADA', {
        ticketCode,
        clientName: ticketInfo.clientName
      });

      toast({
        title: '✅ Venta Realizada',
        description: `Ticket: ${ticketCode}`,
        duration: 2000,
      });

      // Guardar datos del ticket para imprimir si es necesario
      setTicketData(ticketInfo);
      // NO mostramos el modal, el flujo continúa automáticamente

    } catch (error: any) {
      console.error('Error processing checkout:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo completar la venta: ' + error.message,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePrintTicket = () => {
    window.print();
  };

  const handleContinue = () => {
    console.log('🔘 BOTÓN CONTINUAR PRESIONADO');
    console.log('🔄 CONTINUANDO - Reseteando POS para siguiente cliente');
    console.log('Estado antes del reset:', {
      clientMode,
      selectedStudent: selectedStudent?.full_name,
      cart: cart.length,
      showTicketPrint
    });
    
    // Reset y preparar para siguiente cliente
    setShowTicketPrint(false);
    setTicketData(null);
    resetClient();
    
    console.log('✅ POS reseteado - Listo para nuevo cliente');
    
    // Forzar verificación del estado después del reset
    setTimeout(() => {
      console.log('Estado después del reset:', {
        clientMode,
        showTicketPrint
      });
    }, 100);
  };

  const handleLogout = async () => {
    await signOut();
  };

  const handleBackToDashboard = () => {
    navigate('/dashboard');
  };

  const total = getTotal();
  const insufficientBalance = selectedStudent && !studentWillPay && (selectedStudent.balance < total);

  const categories = [
    { id: 'todos', label: 'Todos', icon: ShoppingCart },
    { id: 'bebidas', label: 'Bebidas', icon: Coffee },
    { id: 'snacks', label: 'Snacks', icon: Cookie },
    { id: 'menu', label: 'Menú', icon: UtensilsCrossed },
  ];

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* Header */}
      <header className="bg-slate-900 text-white px-6 py-3 flex justify-between items-center shadow-lg print:hidden">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-500 rounded-lg flex items-center justify-center">
            <ShoppingCart className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-bold text-lg">PUNTO DE VENTA</h1>
            <p className="text-xs text-gray-400">{user?.email}</p>
          </div>
        </div>
        {/* Botones de navegación - Updated */}
        <div className="flex items-center gap-2">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleBackToDashboard}
            className="text-white hover:bg-slate-800"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            Volver al Panel
          </Button>
          <Button variant="ghost" size="sm" onClick={handleLogout} className="text-white hover:bg-slate-800">
            <LogOut className="h-5 w-5 mr-2" />
            Salir
          </Button>
        </div>
      </header>

      {/* Modal de Selección de Cliente (Solo si no hay cliente) */}
      {!clientMode && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold">Seleccionar Tipo de Cliente</h2>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleBackToDashboard}
                  className="text-blue-600 hover:bg-blue-50 border-blue-300"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                  Volver al Panel
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleLogout}
                  className="text-red-600 hover:bg-red-50"
                >
                  <LogOut className="h-5 w-5 mr-2" />
                  Cerrar Sesión
                </Button>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              {/* Cliente Genérico */}
              <button
                onClick={selectGenericClient}
                className="p-8 border-2 border-gray-300 rounded-xl hover:border-emerald-500 hover:bg-emerald-50 transition-all group"
              >
                <Users className="h-16 w-16 mx-auto mb-4 text-gray-400 group-hover:text-emerald-600" />
                <h3 className="text-xl font-bold mb-2">Cliente Genérico</h3>
                <p className="text-sm text-gray-600">Venta al contado (Efectivo/Yape/Tarjeta)</p>
              </button>

              {/* Estudiante */}
              <button
                onClick={selectStudentMode}
                className="p-8 border-2 border-gray-300 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-all group"
              >
                <User className="h-16 w-16 mx-auto mb-4 text-gray-400 group-hover:text-blue-600" />
                <h3 className="text-xl font-bold mb-2">Estudiante</h3>
                <p className="text-sm text-gray-600">Compra a crédito (Descuenta de saldo)</p>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Búsqueda de Estudiante */}
      {clientMode === 'student' && !selectedStudent && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold">Buscar Estudiante</h2>
              <Button 
                variant="ghost" 
                onClick={resetClient}
                className="text-gray-600 hover:bg-gray-100"
              >
                Volver
              </Button>
            </div>
            
            <div className="relative mb-4">
              <Search className="absolute left-4 top-4 h-5 w-5 text-gray-400" />
              <Input
                placeholder="Escribe el nombre del estudiante..."
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                className="pl-12 text-lg h-14 border-2"
                autoFocus
              />
            </div>

            {showStudentResults && students.length > 0 && (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {students.map((student) => (
                  <button
                    key={student.id}
                    onClick={() => selectStudent(student)}
                    className="w-full p-4 hover:bg-emerald-50 border-2 border-gray-200 hover:border-emerald-500 rounded-xl text-left flex items-center gap-4 transition-all"
                  >
                    <div className="flex-1">
                      <p className="font-bold text-lg">{student.full_name}</p>
                      <p className="text-sm text-gray-500">{student.grade} - {student.section}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Saldo</p>
                      <p className="text-2xl font-bold text-emerald-600">
                        S/ {student.balance.toFixed(2)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {studentSearch.length >= 2 && students.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <User className="h-16 w-16 mx-auto mb-3 opacity-30" />
                <p>No se encontraron estudiantes</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Layout de 3 Zonas (Solo si hay cliente seleccionado) */}
      {(clientMode === 'generic' || (clientMode === 'student' && selectedStudent)) && (
        <div className="flex-1 flex overflow-hidden print:hidden">
          
          {/* ZONA 1: CATEGORÍAS */}
          <aside className="w-[15%] bg-slate-800 p-4 flex flex-col gap-2 overflow-y-auto">
            {categories.map((cat) => {
              const Icon = cat.icon;
              const isActive = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={cn(
                    "flex flex-col items-center justify-center gap-2 py-6 rounded-xl font-semibold transition-all",
                    "hover:bg-slate-700 active:scale-95",
                    isActive 
                      ? "bg-emerald-500 text-white shadow-lg" 
                      : "bg-slate-700 text-gray-300"
                  )}
                >
                  <Icon className="h-8 w-8" />
                  <span className="text-sm">{cat.label}</span>
                </button>
              );
            })}
          </aside>

          {/* ZONA 2: PRODUCTOS */}
          <main className="w-[55%] bg-white flex flex-col">
            <div className="p-4 border-b bg-gray-50">
              <div className="relative">
                <Search className="absolute left-4 top-4 h-5 w-5 text-gray-400" />
                <Input
                  placeholder="Buscar productos..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="pl-12 h-14 text-lg border-2"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {filteredProducts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                  <Search className="h-24 w-24 mb-4 opacity-30" />
                  <p className="text-xl font-semibold">No hay productos disponibles</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  {filteredProducts.map((product) => (
                    <button
                      key={product.id}
                      onClick={() => addToCart(product)}
                      className="group bg-white border-2 rounded-2xl overflow-hidden transition-all hover:shadow-xl hover:border-emerald-500 hover:-translate-y-1 active:scale-95 p-4 min-h-[140px] flex flex-col justify-center"
                    >
                      <h3 className="font-black text-xl mb-3 line-clamp-2 leading-tight">
                        {product.name}
                      </h3>
                      <p className="text-lg font-semibold text-emerald-600">
                        S/ {product.price.toFixed(2)}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </main>

          {/* ZONA 3: CARRITO */}
          <aside className="w-[30%] bg-slate-50 flex flex-col border-l-2 border-slate-200">
            {/* Info del Cliente */}
            <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 text-white p-4">
              {clientMode === 'generic' ? (
                  <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-bold text-lg">CLIENTE GENÉRICO</h3>
                    <button
                      onClick={resetClient}
                      className="hover:bg-emerald-700 px-3 py-1.5 rounded-lg transition-colors font-semibold text-sm"
                    >
                      CAMBIAR
                    </button>
                  </div>
                  <p className="text-sm text-emerald-100">Venta al contado</p>
                </div>
              ) : selectedStudent && (
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    {/* Foto del estudiante */}
                    {selectedStudent.photo_url && (
                      <div 
                        className="relative w-16 h-16 flex-shrink-0 cursor-pointer group"
                        onClick={() => setShowPhotoModal(true)}
                      >
                        <img 
                          src={selectedStudent.photo_url} 
                          alt={selectedStudent.full_name}
                          className="w-full h-full object-cover rounded-lg border-2 border-white shadow-lg"
                        />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                          <Maximize2 className="h-6 w-6 text-white" />
                        </div>
                      </div>
                    )}
                    
                    <div className="flex-1">
                      <h3 className="font-bold text-base">{selectedStudent.full_name}</h3>
                      <p className="text-xs text-emerald-100">{selectedStudent.grade} - {selectedStudent.section}</p>
                    </div>
                    <button
                      onClick={resetClient}
                      className="hover:bg-emerald-700 px-3 py-1.5 rounded-lg transition-colors font-semibold text-sm"
                    >
                      CAMBIAR
                    </button>
                  </div>
                  <div className="flex justify-between items-center bg-emerald-700/50 rounded-lg px-3 py-2 mb-2">
                    <span className="text-sm">SALDO</span>
                    <span className="text-2xl font-black">S/ {selectedStudent.balance.toFixed(2)}</span>
                  </div>
                  
                  {/* Switch: ¿Estudiante pagará? */}
                  <div className="flex items-center justify-between bg-emerald-700/30 rounded-lg px-3 py-2">
                    <Label htmlFor="student-pay" className="text-sm cursor-pointer">
                      Estudiante pagará en efectivo
                    </Label>
                    <Switch
                      id="student-pay"
                      checked={studentWillPay}
                      onCheckedChange={setStudentWillPay}
                      className="data-[state=checked]:bg-yellow-400"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Items del Carrito */}
            <div className="flex-1 overflow-y-auto p-3">
              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                  <ShoppingCart className="h-20 w-20 mb-3 opacity-30" />
                  <p className="font-semibold">Carrito vacío</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {cart.map((item) => (
                    <div
                      key={item.product.id}
                      className="bg-white border-2 border-gray-200 rounded-xl p-3"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <p className="font-bold text-sm flex-1">{item.product.name}</p>
                        <button
                          onClick={() => removeFromCart(item.product.id)}
                          className="text-red-600 hover:bg-red-50 p-1 rounded"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                          <button
                            onClick={() => updateQuantity(item.product.id, -1)}
                            className="w-8 h-8 flex items-center justify-center bg-white rounded-md hover:bg-red-50 hover:text-red-600"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <span className="w-10 text-center font-black text-lg">{item.quantity}</span>
                          <button
                            onClick={() => updateQuantity(item.product.id, 1)}
                            className="w-8 h-8 flex items-center justify-center bg-white rounded-md hover:bg-emerald-50 hover:text-emerald-600"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                        <p className="text-lg font-bold text-emerald-600">
                          S/ {(item.product.price * item.quantity).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Total y Botón */}
            <div className="bg-white border-t-2 border-slate-300 p-4 space-y-3">
              {cart.length > 0 ? (
                <>
                  <div className="bg-slate-900 text-white rounded-xl p-4">
                    <p className="text-sm mb-1">TOTAL A PAGAR</p>
                    <p className="text-5xl font-black">S/ {total.toFixed(2)}</p>
                    <p className="text-xs text-gray-400 mt-2">{cart.length} productos</p>
                  </div>

                  {selectedStudent && !studentWillPay && insufficientBalance && (
                    <div className="bg-red-50 border-2 border-red-300 rounded-xl p-3 flex items-center gap-2">
                      <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
                      <div>
                        <p className="font-bold text-red-800 text-sm">Saldo Insuficiente</p>
                        <p className="text-xs text-red-600">Falta: S/ {(total - selectedStudent.balance).toFixed(2)}</p>
                      </div>
                    </div>
                  )}

                  <Button
                    onClick={handleCheckoutClick}
                    disabled={!canCheckout() || isProcessing}
                    className="w-full h-20 text-2xl font-black rounded-xl shadow-lg bg-emerald-500 hover:bg-emerald-600 active:scale-95 disabled:bg-gray-300"
                  >
                    {isProcessing ? 'PROCESANDO...' : 'COBRAR'}
                  </Button>
                </>
              ) : (
                <div className="text-center py-8 text-gray-400">
                  <p className="text-sm">Agrega productos para continuar</p>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* MODAL DE CONFIRMACIÓN (ANTES DE COBRAR) */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-2xl flex items-center gap-2">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              Confirmar Compra
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Info del Cliente */}
            <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
              <p className="text-sm text-blue-600 font-semibold mb-1">CLIENTE</p>
              <p className="text-xl font-bold text-blue-900">
                {clientMode === 'generic' 
                  ? 'CLIENTE GENÉRICO' 
                  : selectedStudent?.full_name}
              </p>
              {selectedStudent && (
                <p className="text-sm text-blue-700 mt-1">
                  {selectedStudent.grade} - {selectedStudent.section}
                </p>
              )}
            </div>

            {/* Detalle de Productos */}
            <div className="border-2 border-gray-200 rounded-xl p-4">
              <p className="text-sm text-gray-600 font-semibold mb-3">DETALLE DE COMPRA</p>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {cart.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
                    <div className="flex-1">
                      <p className="font-semibold text-sm">{item.product.name}</p>
                      <p className="text-xs text-gray-500">
                        {item.quantity} x S/ {item.product.price.toFixed(2)}
                      </p>
                    </div>
                    <p className="font-bold text-emerald-600">
                      S/ {(item.product.price * item.quantity).toFixed(2)}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Total */}
            <div className="bg-slate-900 text-white rounded-xl p-4">
              <div className="flex justify-between items-center">
                <span className="text-lg font-semibold">TOTAL A PAGAR</span>
                <span className="text-3xl font-black">S/ {getTotal().toFixed(2)}</span>
              </div>
              <p className="text-xs text-gray-400 mt-2">{cart.length} productos</p>
            </div>

            {/* Saldo (si es estudiante) */}
            {selectedStudent && (
              <div className="bg-emerald-50 border-2 border-emerald-200 rounded-xl p-3">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-sm text-emerald-700">Saldo Actual</p>
                    <p className="text-xl font-bold text-emerald-900">
                      S/ {selectedStudent.balance.toFixed(2)}
                    </p>
                  </div>
                  {!studentWillPay && (
                    <div className="text-right">
                      <p className="text-sm text-emerald-700">Saldo Después</p>
                      <p className="text-xl font-bold text-emerald-900">
                        S/ {(selectedStudent.balance - getTotal()).toFixed(2)}
                      </p>
                    </div>
                  )}
                </div>
                {studentWillPay && (
                  <p className="text-xs text-amber-700 mt-2 font-semibold">
                    ⚠️ Estudiante pagará en efectivo (no se descuenta saldo)
                  </p>
                )}
              </div>
            )}

            {/* Botones */}
            <div className="space-y-3">
              {/* Botón principal: Confirmar y Continuar */}
              <Button
                onClick={() => handleConfirmCheckout(false)}
                disabled={isProcessing}
                className="w-full h-14 text-xl font-bold bg-emerald-500 hover:bg-emerald-600 text-white"
              >
                {isProcessing ? 'PROCESANDO...' : '✅ Confirmar y Continuar'}
              </Button>
              
              {/* Botón secundario: Confirmar e Imprimir */}
              <Button
                onClick={() => handleConfirmCheckout(true)}
                disabled={isProcessing}
                className="w-full h-14 text-xl font-bold bg-blue-500 hover:bg-blue-600 text-white"
              >
                {isProcessing ? 'PROCESANDO...' : '🖨️ Confirmar e Imprimir'}
              </Button>
              
              {/* Botón cancelar */}
              <Button
                variant="outline"
                onClick={() => setShowConfirmDialog(false)}
                className="w-full h-10 text-sm"
              >
                Cancelar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* MODAL DE PAGO (Solo Cliente Genérico) */}
      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Opciones de Pago</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <Label className="mb-2 block">Método de Pago</Label>
              <Select value={paymentMethod} onValueChange={(v: any) => setPaymentMethod(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="efectivo">Efectivo</SelectItem>
                  <SelectItem value="yape">Yape/Plin</SelectItem>
                  <SelectItem value="tarjeta">Tarjeta</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="mb-2 block">Tipo de Documento</Label>
              <Select value={documentType} onValueChange={(v: any) => setDocumentType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ticket">Ticket</SelectItem>
                  <SelectItem value="boleta">Boleta</SelectItem>
                  <SelectItem value="factura">Factura</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={processCheckout}
              disabled={isProcessing}
              className="w-full h-14 text-xl font-bold"
            >
              {isProcessing ? 'Procesando...' : 'Confirmar Pago'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* TICKET TÉRMICO 80MM (Para impresión directa si se necesita) */}
      {ticketData && (
        <div className="hidden print:block">
          <style>{`
            @media print {
              @page {
                size: 80mm auto;
                margin: 0;
              }
              body {
                width: 80mm;
                margin: 0;
                padding: 0;
              }
            }
          `}</style>
          <div style={{ width: '80mm', fontFamily: 'monospace', fontSize: '12px', padding: '10px' }}>
            <div style={{ textAlign: 'center', marginBottom: '10px' }}>
              <h2 style={{ margin: '0', fontSize: '16px', fontWeight: 'bold' }}>LIMA CAFÉ 28</h2>
              <p style={{ margin: '2px 0', fontSize: '10px' }}>Kiosco Escolar</p>
              <p style={{ margin: '2px 0', fontSize: '10px' }}>RUC: 20XXXXXXXXX</p>
              <p style={{ margin: '2px 0', fontSize: '10px' }}>──────────────────────</p>
            </div>

            <div style={{ marginBottom: '10px' }}>
              <p style={{ margin: '2px 0' }}><strong>TICKET:</strong> {ticketData.code}</p>
              <p style={{ margin: '2px 0' }}><strong>FECHA:</strong> {ticketData.timestamp.toLocaleDateString('es-PE')} {ticketData.timestamp.toLocaleTimeString('es-PE')}</p>
              <p style={{ margin: '2px 0' }}><strong>CAJERO:</strong> {ticketData.cashierEmail}</p>
              <p style={{ margin: '2px 0' }}><strong>CLIENTE:</strong> {ticketData.clientName}</p>
              {ticketData.documentType !== 'ticket' && (
                <p style={{ margin: '2px 0' }}><strong>DOC:</strong> {ticketData.documentType.toUpperCase()}</p>
              )}
            </div>

            <p style={{ margin: '10px 0', fontSize: '10px' }}>──────────────────────</p>

            <div style={{ marginBottom: '10px' }}>
              {ticketData.items.map((item: CartItem, idx: number) => (
                <div key={idx} style={{ marginBottom: '8px' }}>
                  <p style={{ margin: '0', fontWeight: 'bold' }}>{item.product.name}</p>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{item.quantity} x S/ {item.product.price.toFixed(2)}</span>
                    <span style={{ fontWeight: 'bold' }}>S/ {(item.product.price * item.quantity).toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>

            <p style={{ margin: '10px 0', fontSize: '10px' }}>──────────────────────</p>

            <div style={{ textAlign: 'right', marginBottom: '10px' }}>
              <p style={{ margin: '4px 0', fontSize: '16px', fontWeight: 'bold' }}>
                TOTAL: S/ {ticketData.total.toFixed(2)}
              </p>
              {ticketData.paymentMethod && (
                <p style={{ margin: '2px 0', fontSize: '10px' }}>
                  Pago: {ticketData.paymentMethod.toUpperCase()}
                </p>
              )}
              {ticketData.newBalance !== undefined && (
                <p style={{ margin: '2px 0', fontSize: '10px' }}>
                  Saldo restante: S/ {ticketData.newBalance.toFixed(2)}
                </p>
              )}
            </div>

            <div style={{ textAlign: 'center', marginTop: '15px' }}>
              <p style={{ margin: '2px 0', fontSize: '10px' }}>¡Gracias por su compra!</p>
              <p style={{ margin: '2px 0', fontSize: '10px' }}>──────────────────────</p>
            </div>
          </div>
        </div>
      )}

      {/* Modal para ver foto ampliada del estudiante */}
      {selectedStudent?.photo_url && (
        <Dialog open={showPhotoModal} onOpenChange={setShowPhotoModal}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Foto de {selectedStudent.full_name}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col items-center gap-4 p-4">
              <img 
                src={selectedStudent.photo_url} 
                alt={selectedStudent.full_name}
                className="w-full max-w-md h-auto object-contain rounded-lg border-4 border-gray-200 shadow-xl"
              />
              <div className="text-center">
                <p className="text-lg font-bold text-gray-900">{selectedStudent.full_name}</p>
                <p className="text-sm text-gray-600">{selectedStudent.grade} - {selectedStudent.section}</p>
                <p className="text-sm text-gray-500 mt-2">Saldo: S/ {selectedStudent.balance.toFixed(2)}</p>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default POS;
