import { useState, useEffect, useRef } from 'react';
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
  Check,
  User,
  Coffee,
  Cookie,
  UtensilsCrossed,
  X,
  Printer,
  Receipt,
  Users,
  Maximize2,
  Gift,
  CreditCard,
  QrCode,
  Smartphone,
  Building2,
  Banknote,
  Loader2,
  Apple,
  Sandwich,
  Cake,
  IceCream,
  Pizza,
  Salad,
  Beef,
  Fish,
  Egg,
  Milk,
  Wine,
  Beer,
  Grape,
  Cherry,
  Package,
  PackageOpen,
  Box,
  FileText
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { getProductsForSchool } from '@/lib/productPricing';

interface Student {
  id: string;
  full_name: string;
  photo_url: string | null;
  balance: number;
  grade: string;
  section: string;
  free_account?: boolean;
  limit_type?: 'none' | 'daily' | 'weekly' | 'monthly';
  daily_limit?: number;
  weekly_limit?: number;
  monthly_limit?: number;
  is_blocked?: boolean;
}

interface Product {
  id: string;
  name: string;
  description?: string;
  price: number;
  category: string;
  image_url?: string | null;
  active?: boolean;
}

interface CartItem {
  product: Product;
  quantity: number;
}

// Función para asignar iconos a categorías dinámicamente
const getCategoryIcon = (categoryName: string) => {
  const name = categoryName.toLowerCase();
  
  // Bebidas
  if (name.includes('bebida') || name.includes('refresco') || name.includes('jugo')) {
    if (name.includes('caliente') || name.includes('café') || name.includes('té')) return Coffee;
    if (name.includes('alcoh') || name.includes('cerveza')) return Beer;
    if (name.includes('vino')) return Wine;
    return Coffee; // Bebidas genéricas
  }
  
  // Snacks y dulces
  if (name.includes('snack') || name.includes('golosina') || name.includes('galleta')) return Cookie;
  if (name.includes('dulce') || name.includes('caramelo') || name.includes('chocolate')) return Gift;
  if (name.includes('helado') || name.includes('postre frio')) return IceCream;
  
  // Comidas
  if (name.includes('almuerzo') || name.includes('menú') || name.includes('comida')) return UtensilsCrossed;
  if (name.includes('sandwich') || name.includes('bocadillo')) return Sandwich;
  if (name.includes('pizza')) return Pizza;
  if (name.includes('ensalada') || name.includes('saludable')) return Salad;
  if (name.includes('carne') || name.includes('pollo')) return Beef;
  if (name.includes('pescado') || name.includes('mariscos')) return Fish;
  if (name.includes('huevo') || name.includes('tortilla')) return Egg;
  
  // Postres
  if (name.includes('postre') || name.includes('torta') || name.includes('pastel') || name.includes('queque')) return Cake;
  
  // Lácteos
  if (name.includes('leche') || name.includes('yogurt') || name.includes('lácteo')) return Milk;
  
  // Frutas
  if (name.includes('fruta')) return Apple;
  if (name.includes('uva')) return Grape;
  if (name.includes('cereza') || name.includes('fresa')) return Cherry;
  
  // Productos empacados
  if (name.includes('empaque') || name.includes('paquete')) return Package;
  if (name.includes('caja')) return Box;
  
  // Default
  return PackageOpen;
};

const POS = () => {
  const { signOut, user } = useAuth();
  const { role } = useRole();
  const { toast } = useToast();
  const navigate = useNavigate();
  const searchInputRef = useRef<HTMLInputElement>(null);

  console.log('🏪 POS - Componente montado');
  console.log('👤 POS - Usuario:', user?.email);
  console.log('🎭 POS - Rol:', role);

  // Estados de cliente
  const [clientMode, setClientMode] = useState<'student' | 'generic' | null>(null);
  const [studentSearch, setStudentSearch] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [studentAccountStatuses, setStudentAccountStatuses] = useState<Map<string, { canPurchase: boolean; statusText: string; statusColor: string; reason?: string }>>(new Map());
  const [showStudentResults, setShowStudentResults] = useState(false);
  const [studentWillPay, setStudentWillPay] = useState(false); // Switch para que estudiante pague
  const [cashAmount, setCashAmount] = useState<number>(0); // Cantidad que el estudiante abona en efectivo
  const [showPhotoModal, setShowPhotoModal] = useState(false); // Para ampliar foto del estudiante

  // Estados de productos
  const [productSearch, setProductSearch] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('todos');
  const [combos, setCombos] = useState<any[]>([]); // Combos activos

  // Estados de carrito y venta
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [insufficientBalance, setInsufficientBalance] = useState(false);

  // Estados de pago mejorados (Cliente Genérico)
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null); // 'efectivo', 'yape_qr', 'yape_numero', 'plin_qr', 'plin_numero', 'tarjeta', 'transferencia', 'mixto'
  const [yapeNumber, setYapeNumber] = useState('');
  const [plinNumber, setPlinNumber] = useState('');
  const [transactionCode, setTransactionCode] = useState('');
  const [requiresInvoice, setRequiresInvoice] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // NUEVO: Campo "Con cuánto paga" para calcular vuelto
  const [cashGiven, setCashGiven] = useState('');

  // NUEVO: Pago Mixto
  interface PaymentSplit {
    method: string;
    amount: number;
  }
  const [paymentSplits, setPaymentSplits] = useState<PaymentSplit[]>([]);
  const [currentSplitMethod, setCurrentSplitMethod] = useState('');
  const [currentSplitAmount, setCurrentSplitAmount] = useState('');

  // NUEVO: Modal para seleccionar tipo de comprobante
  const [showDocumentTypeDialog, setShowDocumentTypeDialog] = useState(false);
  const [selectedDocumentType, setSelectedDocumentType] = useState('');

  // Estado de ticket generado
  const [showTicketPrint, setShowTicketPrint] = useState(false);
  const [ticketData, setTicketData] = useState<any>(null);

  // --- CATEGORÍAS DINÁMICAS ---
  const [orderedCategories, setOrderedCategories] = useState<Array<{ id: string; label: string; icon: any }>>([
    { id: 'todos', label: 'Todos', icon: ShoppingCart },
  ]);
  const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null);

  // Generar categorías dinámicamente desde productos
  useEffect(() => {
    if (products.length === 0) return;

    // Extraer categorías únicas
    const uniqueCategories = Array.from(
      new Set(products.map(p => p.category).filter(Boolean))
    ).sort();

    // Crear categorías con iconos inteligentes
    const dynamicCategories = [
      { id: 'todos', label: 'Todos', icon: ShoppingCart },
      ...uniqueCategories.map(cat => ({
        id: cat,
        label: cat,
        icon: getCategoryIcon(cat)
      }))
    ];

    console.log('📂 Categorías generadas:', dynamicCategories);
    setOrderedCategories(dynamicCategories);

    // Intentar restaurar orden guardado
    const savedOrder = localStorage.getItem('pos_category_order');
    if (savedOrder) {
      try {
        const orderIds = JSON.parse(savedOrder);
        const reordered = orderIds
          .map((id: string) => dynamicCategories.find(c => c.id === id))
          .filter(Boolean);

        // Agregar nuevas categorías que no estaban guardadas
        dynamicCategories.forEach(c => {
          if (!orderIds.includes(c.id)) reordered.push(c);
        });

        setOrderedCategories(reordered);
      } catch (e) {
        console.error('Error cargando orden de categorías:', e);
      }
    }
  }, [products]);

  const onDragStart = (e: React.DragEvent, index: number) => {
    setDraggedItemIndex(index);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      const target = e.target as HTMLElement;
      target.style.opacity = '0.4';
    }
  };

  const onDragEnd = (e: React.DragEvent) => {
    const target = e.target as HTMLElement;
    target.style.opacity = '1';
    setDraggedItemIndex(null);
  };

  const onDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedItemIndex === null || draggedItemIndex === index) return;

    const newList = [...orderedCategories];
    const draggedItem = newList[draggedItemIndex];
    newList.splice(draggedItemIndex, 1);
    newList.splice(index, 0, draggedItem);
    
    setDraggedItemIndex(index);
    setOrderedCategories(newList);
    localStorage.setItem('pos_category_order', JSON.stringify(newList.map(c => c.id)));
  };

  // Cargar productos al inicio
  useEffect(() => {
    fetchProducts();
    fetchCombos();
  }, []);

  // Filtrar productos
  useEffect(() => {
    let filtered = products;

    // Si se selecciona la categoría de combos
    if (selectedCategory === 'combos') {
      setFilteredProducts([]); // No mostramos productos normales, solo combos
      return;
    }

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

  // Efecto para Escucha Global de Teclado (Pistola de Código de Barras)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Si estamos en un modo de venta y el foco no está en un input
      if (clientMode) {
        const target = e.target as HTMLElement;
        const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

        // Si no estamos escribiendo en un cuadro de texto y presionamos una tecla alfanumérica
        // O si es una pistola que envía prefijos, esto capturará la primera tecla y enfocará
        if (!isInput && /^[a-zA-Z0-9]$/.test(e.key)) {
          searchInputRef.current?.focus();
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [clientMode]);

  // Auto-focus cuando se selecciona un cliente
  useEffect(() => {
    if (clientMode === 'generic' || selectedStudent) {
      // Dar un pequeño respiro para que el DOM se actualice
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 200);
    }
  }, [clientMode, selectedStudent]);

  const fetchProducts = async () => {
    console.log('🔵 POS - Iniciando carga de productos...');
    try {
      // Obtener el school_id del usuario actual
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('school_id')
        .eq('id', user?.id)
        .single();

      if (profileError) {
        console.warn('⚠️ POS - No se pudo obtener school_id del usuario, usando precios base');
      }

      const schoolId = profile?.school_id || null;
      console.log('🏫 POS - Sede del usuario:', schoolId);

      // Usar la función de pricing inteligente
      const productsData = await getProductsForSchool(schoolId);
      
      console.log('📦 POS - Productos recibidos:', productsData.length);
      console.log('💰 POS - Productos con precio personalizado:', productsData.filter(p => p.is_custom_price).length);
      
      setProducts(productsData);
      setFilteredProducts(productsData);
      console.log('✅ POS - Productos cargados correctamente con precios de sede');
    } catch (error: any) {
      console.error('💥 POS - Error crítico cargando productos:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar los productos: ' + error.message,
      });
    }
  };

  const fetchCombos = async () => {
    try {
      // Obtener el school_id del usuario actual
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('school_id')
        .eq('id', user?.id)
        .single();

      if (profileError || !profile?.school_id) {
        console.warn('⚠️ POS - No se pudo obtener school_id para filtrar combos');
        return;
      }

      const { data, error } = await supabase
        .from('combos')
        .select('*')
        .eq('active', true)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching combos:', error);
        return;
      }

      // Cargar items de cada combo
      const combosWithItems = await Promise.all(
        (data || []).map(async (combo) => {
          const { data: items } = await supabase
            .from('combo_items')
            .select('quantity, product_id')
            .eq('combo_id', combo.id);

          const productIds = (items || []).map(item => item.product_id);
          
          if (productIds.length === 0) {
            return { ...combo, combo_items: [] };
          }

          const { data: products } = await supabase
            .from('products')
            .select('id, name, price_sale, has_stock')
            .in('id', productIds);

          const combo_items = (items || []).map(item => ({
            quantity: item.quantity,
            product: products?.find(p => p.id === item.product_id)
          }));

          return { ...combo, combo_items };
        })
      );

      // Filtrar combos que aplican a esta sede
      const filteredCombos = combosWithItems.filter(combo => {
        if (!combo.school_ids || combo.school_ids.length === 0) return true;
        return combo.school_ids.includes(profile.school_id);
      });

      setCombos(filteredCombos);
      
      // Si hay combos, agregar categoría
      if (filteredCombos.length > 0) {
        setOrderedCategories(prev => {
          const hasComboCategory = prev.some(c => c.id === 'combos');
          if (!hasComboCategory) {
            return [
              ...prev,
              { id: 'combos', label: 'Combos', icon: Gift }
            ];
          }
          return prev;
        });
      }
    } catch (error) {
      console.error('Error cargando combos:', error);
    }
  };

  const searchStudents = async (query: string) => {
    try {
      console.log('🔍 Buscando estudiantes con query:', query);
      
      const { data, error } = await supabase
        .from('students')
        .select('id, full_name, photo_url, balance, grade, section, free_account, limit_type, daily_limit, weekly_limit, monthly_limit, is_blocked')
        .eq('is_active', true)
        .ilike('full_name', `%${query}%`)
        .limit(5);

      if (error) {
        console.error('❌ Error en consulta de estudiantes:', error);
        throw error;
      }

      console.log('✅ Estudiantes encontrados:', data?.length || 0);
      setStudents(data || []);

      // Calcular estado de cuenta para cada estudiante (con manejo robusto de errores)
      if (data && data.length > 0) {
        const statusMap = new Map();
        
        // Procesar cada estudiante de forma segura
        const statusPromises = data.map(async (student) => {
          try {
            const status = await getAccountStatus(student);
            statusMap.set(student.id, status);
          } catch (err) {
            console.warn(`⚠️ Error calculando estado para ${student.full_name}:`, err);
            // Estado por defecto si falla
            statusMap.set(student.id, {
              canPurchase: true,
              statusText: `💰 Saldo: S/ ${student.balance?.toFixed(2) || '0.00'}`,
              statusColor: 'text-emerald-600'
            });
          }
        });

        await Promise.all(statusPromises);
        setStudentAccountStatuses(statusMap);
      }
    } catch (error: any) {
      console.error('❌ Error crítico buscando estudiantes:', error);
      console.error('Detalles del error:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });
      toast({
        variant: 'destructive',
        title: 'Error al buscar estudiantes',
        description: error.message || 'No se pudo realizar la búsqueda'
      });
    }
  };

  // ✅ Función helper para determinar el estado de cuenta del estudiante
  const getAccountStatus = async (student: Student): Promise<{
    canPurchase: boolean;
    statusText: string;
    statusColor: string;
    reason?: string;
  }> => {
    // 1. Verificar si está bloqueado
    if (student.is_blocked) {
      return {
        canPurchase: false,
        statusText: '🚫 Cuenta Bloqueada',
        statusColor: 'text-red-600',
        reason: 'Cuenta bloqueada por el padre'
      };
    }

    // 2. Cuenta Libre (sin topes)
    if (student.free_account) {
      const limitText = student.daily_limit && student.daily_limit > 0 
        ? `Tope Diario: S/ ${student.daily_limit.toFixed(2)}`
        : 'Sin tope';
      
      return {
        canPurchase: true,
        statusText: `✨ Cuenta Libre - ${limitText}`,
        statusColor: 'text-emerald-600'
      };
    }

    // 3. Con Recargas (sin cuenta libre)
    const balance = student.balance || 0;
    
    if (balance <= 0) {
      return {
        canPurchase: false,
        statusText: '💳 Sin Saldo - S/ 0.00',
        statusColor: 'text-red-600',
        reason: 'Sin saldo disponible'
      };
    }

    // 4. Con Topes activos
    if (student.limit_type && student.limit_type !== 'none') {
      try {
        const today = new Date().toISOString().split('T')[0];
        const startOfWeek = new Date();
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
        const startOfMonth = new Date();
        startOfMonth.setDate(1);

        let limitAmount = 0;
        let spentAmount = 0;
        let periodText = '';

        switch (student.limit_type) {
          case 'daily':
            limitAmount = student.daily_limit || 0;
            const { data: todayData } = await supabase
              .from('transactions')
              .select('amount')
              .eq('student_id', student.id)
              .eq('type', 'purchase')
              .gte('created_at', today);
            spentAmount = todayData?.reduce((sum, t) => sum + Math.abs(t.amount), 0) || 0;
            periodText = 'Diario';
            break;

          case 'weekly':
            limitAmount = student.weekly_limit || 0;
            const { data: weekData } = await supabase
              .from('transactions')
              .select('amount')
              .eq('student_id', student.id)
              .eq('type', 'purchase')
              .gte('created_at', startOfWeek.toISOString());
            spentAmount = weekData?.reduce((sum, t) => sum + Math.abs(t.amount), 0) || 0;
            periodText = 'Semanal';
            break;

          case 'monthly':
            limitAmount = student.monthly_limit || 0;
            const { data: monthData } = await supabase
              .from('transactions')
              .select('amount')
              .eq('student_id', student.id)
              .eq('type', 'purchase')
              .gte('created_at', startOfMonth.toISOString());
            spentAmount = monthData?.reduce((sum, t) => sum + Math.abs(t.amount), 0) || 0;
            periodText = 'Mensual';
            break;
        }

        const remaining = limitAmount - spentAmount;

        if (remaining <= 0) {
          return {
            canPurchase: false,
            statusText: `🚫 Tope ${periodText} Alcanzado`,
            statusColor: 'text-red-600',
            reason: `Ya alcanzó su límite de S/ ${limitAmount.toFixed(2)}`
          };
        }

        return {
          canPurchase: true,
          statusText: `📊 Tope ${periodText}: S/ ${remaining.toFixed(2)} de S/ ${limitAmount.toFixed(2)}`,
          statusColor: remaining < limitAmount * 0.3 ? 'text-orange-600' : 'text-blue-600'
        };
      } catch (error) {
        console.error('Error calculating limits:', error);
      }
    }

    // 5. Sin límites pero con saldo (default)
    return {
      canPurchase: true,
      statusText: `💰 Saldo: S/ ${balance.toFixed(2)}`,
      statusColor: 'text-emerald-600'
    };
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
    setPaymentMethod(null);
    setYapeNumber('');
    setPlinNumber('');
    setTransactionCode('');
    setRequiresInvoice(false);
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

  const addComboToCart = (combo: any) => {
    // Crear un "producto virtual" para el combo
    const comboProduct: Product = {
      id: `combo_${combo.id}`,
      name: `🎁 ${combo.name}`,
      price: combo.combo_price,
      category: 'combos',
    };

    const existing = cart.find(item => item.product.id === comboProduct.id);
    
    if (existing) {
      setCart(cart.map(item =>
        item.product.id === comboProduct.id
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      setCart([...cart, { product: comboProduct, quantity: 1 }]);
    }

    toast({
      title: '🎁 Combo agregado',
      description: `${combo.name} - S/ ${combo.combo_price.toFixed(2)}`,
    });
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
    
    // Si es estudiante
    if (clientMode === 'student' && selectedStudent) {
      // Si tiene cuenta libre, siempre puede comprar
      if (selectedStudent.free_account) {
        return true;
      }
      // Si no tiene cuenta libre, verificar saldo
      const amountToDeduct = studentWillPay ? Math.max(0, getTotal() - cashAmount) : getTotal();
      return selectedStudent.balance >= amountToDeduct;
    }
    
    // Si es cliente genérico, permitir (el documento se elige en el modal de pago)
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
    // Procesar directamente (ya no hay segundo modal)
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

      // ✅ Generar correlativo ÚNICO para TODOS los usuarios
      try {
        const { data: ticketNumber, error: ticketError } = await supabase
          .rpc('get_next_ticket_number', { p_user_id: user?.id });

        if (ticketError) {
          console.error('❌ Error generando correlativo:', ticketError);
          // Fallback temporal
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
        documentType: clientMode === 'generic' ? (requiresInvoice ? 'factura' : 'ticket') : 'ticket',
        timestamp: new Date(),
        cashierEmail: user?.email || 'No disponible',
      };

      // Si es estudiante
      if (clientMode === 'student' && selectedStudent) {
        const isFreeAccount = selectedStudent.free_account !== false; // Por defecto true
        
        // **VERIFICAR LÍMITES DE GASTO**
        const { data: limitCheck, error: limitError } = await supabase
          .rpc('check_student_spending_limit', {
            p_student_id: selectedStudent.id,
            p_amount: total
          });

        if (limitError) {
          console.error('Error checking spending limit:', limitError);
          // Si hay error verificando, continuamos (no bloqueamos la venta)
        } else if (limitCheck && limitCheck.length > 0 && !limitCheck[0].can_purchase) {
          // Límite excedido - BLOQUEAR VENTA
          const limitInfo = limitCheck[0];
          const limitTypeText = limitInfo.limit_type === 'daily' ? 'diario' : 
                               limitInfo.limit_type === 'weekly' ? 'semanal' : 'mensual';
          
          throw new Error(
            `⚠️ Límite ${limitTypeText} excedido.\n` +
            `Gastado: S/ ${limitInfo.current_spent.toFixed(2)}\n` +
            `Límite: S/ ${limitInfo.limit_amount.toFixed(2)}\n` +
            `No se puede procesar esta compra de S/ ${total.toFixed(2)}`
          );
        }
        
        // Calcular montos
        const amountToDeduct = studentWillPay ? Math.max(0, total - cashAmount) : total;
        const cashPaid = studentWillPay ? cashAmount : 0;
        
        // Si es cuenta libre, no descontamos del saldo, solo registramos como pendiente
        const newBalance = isFreeAccount ? selectedStudent.balance : selectedStudent.balance - amountToDeduct;

        console.log('💳 PROCESANDO VENTA ESTUDIANTE', {
          studentId: selectedStudent.id,
          isFreeAccount,
          total,
          cashPaid,
          amountToDeduct,
          balanceActual: selectedStudent.balance,
          newBalance
        });

        // Crear transacción
        const { data: transaction, error: transError} = await supabase
          .from('transactions')
          .insert({
            student_id: selectedStudent.id,
            type: 'purchase',
            amount: -total,
            description: `Compra POS${isFreeAccount ? ' (Cuenta Libre)' : ''} - Total: S/ ${total.toFixed(2)}${cashPaid > 0 ? ` (Abono efectivo: S/ ${cashPaid.toFixed(2)})` : ''}`,
            balance_after: newBalance,
            created_by: user?.id,
            ticket_code: ticketCode,
            payment_status: isFreeAccount ? 'pending' : 'paid', // Si es cuenta libre, queda pendiente
          })
          .select()
          .single();

        if (transError) {
          console.error('❌ Error creando transacción:', transError);
          throw transError;
        }
        console.log('✅ Transacción creada:', transaction.id);

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

        if (itemsError) throw itemsError;

        // Actualizar saldo solo si NO es cuenta libre y hubo descuento
        if (!isFreeAccount && amountToDeduct > 0) {
          const { error: updateError } = await supabase
            .from('students')
            .update({ balance: newBalance })
            .eq('id', selectedStudent.id);

          if (updateError) throw updateError;
          
          // Actualizar estado local
          setSelectedStudent({
            ...selectedStudent,
            balance: newBalance
          });
        }

        ticketInfo.newBalance = newBalance;
        ticketInfo.cashPaid = cashPaid;
        ticketInfo.amountToDeduct = amountToDeduct;
        ticketInfo.isFreeAccount = isFreeAccount;
      } else {
        // Cliente genérico - Solo registrar la venta
        const { data: transaction, error: transError } = await supabase
          .from('transactions')
          .insert({
            student_id: null,
            type: 'purchase',
            amount: -total,
            description: `Compra Cliente Genérico - ${cart.length} items`,
            balance_after: 0,
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
      
      // Cerrar modales
      setShowPaymentDialog(false);
      
      // Resetear POS automáticamente para siguiente venta
      setTimeout(() => {
        resetClient();
      }, 500);

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
  
  // Verificar saldo insuficiente en useEffect
  useEffect(() => {
    const insufficient = selectedStudent && !studentWillPay && (selectedStudent.balance < total);
    setInsufficientBalance(insufficient);
  }, [selectedStudent, studentWillPay, total]);

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

              {/* Crédito */}
              <button
                onClick={selectStudentMode}
                className="p-8 border-2 border-gray-300 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-all group"
              >
                <User className="h-16 w-16 mx-auto mb-4 text-gray-400 group-hover:text-blue-600" />
                <h3 className="text-xl font-bold mb-2">Crédito</h3>
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
                {students.map((student) => {
                  const accountStatus = studentAccountStatuses.get(student.id);
                  const canPurchase = accountStatus?.canPurchase ?? true;
                  const statusText = accountStatus?.statusText || `💰 Saldo: S/ ${student.balance.toFixed(2)}`;
                  const statusColor = accountStatus?.statusColor || 'text-emerald-600';
                  
                  return (
                    <button
                      key={student.id}
                      onClick={() => canPurchase && selectStudent(student)}
                      disabled={!canPurchase}
                      className={cn(
                        "w-full p-4 border-2 rounded-xl text-left flex items-center gap-4 transition-all",
                        canPurchase 
                          ? "hover:bg-emerald-50 border-gray-200 hover:border-emerald-500 cursor-pointer"
                          : "bg-gray-50 border-red-200 cursor-not-allowed opacity-70"
                      )}
                    >
                      <div className="flex-1">
                        <p className={cn("font-bold text-lg", !canPurchase && "text-gray-500")}>
                          {student.full_name}
                        </p>
                        <p className="text-sm text-gray-500">
                          {student.grade} - {student.section}
                        </p>
                        {!canPurchase && accountStatus?.reason && (
                          <p className="text-xs text-red-600 mt-1 font-medium">
                            {accountStatus.reason}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500 mb-1">Estado</p>
                        <p className={cn("text-sm font-bold", statusColor)}>
                          {statusText}
                        </p>
                      </div>
                    </button>
                  );
                })}
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
            {orderedCategories.map((cat, index) => {
              const Icon = cat.icon;
              const isActive = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  draggable
                  onDragStart={(e) => onDragStart(e, index)}
                  onDragEnd={onDragEnd}
                  onDragOver={(e) => onDragOver(e, index)}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={cn(
                    "flex flex-col items-center justify-center gap-2 py-8 rounded-xl font-semibold transition-all cursor-move select-none touch-manipulation",
                    "hover:bg-slate-700 active:scale-95",
                    isActive 
                      ? "bg-emerald-500 text-white shadow-lg" 
                      : "bg-slate-700 text-gray-300"
                  )}
                  style={{ minHeight: '100px' }}
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
                  ref={searchInputRef}
                  placeholder="Buscar productos..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="pl-12 h-14 text-lg border-2"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {filteredProducts.length === 0 && combos.length === 0 && selectedCategory !== 'combos' ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                  <Search className="h-24 w-24 mb-4 opacity-30" />
                  <p className="text-xl font-semibold">No hay productos disponibles</p>
                </div>
              ) : selectedCategory === 'combos' ? (
                <div className="grid grid-cols-3 gap-4">
                  {combos.map((combo) => (
                    <button
                      key={combo.id}
                      onClick={() => addComboToCart(combo)}
                      className="group bg-gradient-to-br from-purple-50 to-pink-50 border-2 border-purple-200 rounded-2xl overflow-hidden transition-all hover:shadow-xl hover:border-purple-400 hover:-translate-y-1 active:scale-95 p-4 min-h-[140px] flex flex-col justify-center"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Gift className="h-5 w-5 text-purple-600" />
                        <h3 className="font-black text-xl line-clamp-2 leading-tight text-left">
                          {combo.name}
                        </h3>
                      </div>
                      <p className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-pink-600">
                        S/ {combo.combo_price.toFixed(2)}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {combo.combo_items?.length || 0} productos
                      </p>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  {filteredProducts.map((product) => (
                    <button
                      key={product.id}
                      onClick={() => addToCart(product)}
                      className="group bg-white border-2 rounded-2xl overflow-hidden transition-all hover:shadow-xl hover:border-emerald-500 hover:-translate-y-1 active:scale-95 p-4 min-h-[160px] flex flex-col justify-between"
                    >
                      <div>
                        <h3 className="font-black text-xl mb-2 line-clamp-1 leading-tight">
                          {product.name}
                        </h3>
                        {product.description && (
                          <p className="text-sm text-gray-500 mb-3 line-clamp-2">
                            {product.description}
                          </p>
                        )}
                      </div>
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
                    <h3 className="font-bold text-lg text-white">CLIENTE GENÉRICO</h3>
                    <button
                      onClick={resetClient}
                      className="hover:bg-emerald-700 px-3 py-1.5 rounded-lg transition-colors font-semibold text-sm text-white border border-emerald-400"
                    >
                      CAMBIAR
                    </button>
                  </div>
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
                      {selectedStudent.free_account !== false && (
                        <div className="mt-1">
                          <span className="text-[10px] bg-green-400 text-green-900 px-2 py-0.5 rounded-full font-bold">
                            ✓ CUENTA LIBRE
                          </span>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={resetClient}
                      className="hover:bg-emerald-700 px-3 py-1.5 rounded-lg transition-colors font-semibold text-sm"
                    >
                      CAMBIAR
                    </button>
                  </div>
                  <div className="flex justify-between items-center bg-emerald-700/50 rounded-lg px-3 py-2 mb-2">
                    <span className="text-sm">{selectedStudent.free_account !== false ? 'CONSUMO' : 'SALDO'}</span>
                    <span className="text-2xl font-black">S/ {selectedStudent.balance.toFixed(2)}</span>
                  </div>
                  
                  {/* Switch: ¿Estudiante pagará? */}
                  <div className="space-y-2 bg-emerald-700/30 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="student-pay" className="text-sm cursor-pointer uppercase font-bold">
                        abonar al total
                      </Label>
                      <Switch
                        id="student-pay"
                        checked={studentWillPay}
                        onCheckedChange={(checked) => {
                          setStudentWillPay(checked);
                          if (!checked) setCashAmount(0);
                        }}
                        className="data-[state=checked]:bg-yellow-400"
                      />
                    </div>
                    
                    {studentWillPay && (
                      <div className="pt-2 border-t border-emerald-600/30 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-emerald-100 uppercase font-bold">Abono Efectivo</span>
                          <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-emerald-900 font-bold">S/</span>
                            <input
                              type="number"
                              value={cashAmount || ''}
                              onChange={(e) => setCashAmount(Number(e.target.value))}
                              className="w-24 bg-white text-emerald-900 rounded px-2 py-1 pl-7 text-right font-bold text-sm focus:ring-2 focus:ring-yellow-400 outline-none"
                              placeholder="0.00"
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-xs text-emerald-100">
                          <span className="uppercase font-bold">Saldo por pagar</span>
                          <span className="font-bold">S/ {Math.max(0, getTotal() - cashAmount).toFixed(2)}</span>
                        </div>
                      </div>
                    )}
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
                          className="text-red-600 hover:bg-red-50 p-2 rounded-full"
                          title="Eliminar del carrito"
                        >
                          <Trash2 className="h-6 w-6" />
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 bg-gray-100 rounded-xl p-1.5">
                          <button
                            onClick={() => updateQuantity(item.product.id, -1)}
                            className="w-12 h-12 flex items-center justify-center bg-white rounded-lg shadow-sm hover:bg-red-50 hover:text-red-600 transition-colors"
                          >
                            <Minus className="h-6 w-6" />
                          </button>
                          <span className="w-14 text-center font-black text-2xl">{item.quantity}</span>
                          <button
                            onClick={() => updateQuantity(item.product.id, 1)}
                            className="w-12 h-12 flex items-center justify-center bg-white rounded-lg shadow-sm hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
                          >
                            <Plus className="h-6 w-6" />
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
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-sm mb-1 uppercase font-bold text-gray-400">Total Compra</p>
                        <p className="text-4xl font-black">S/ {total.toFixed(2)}</p>
                      </div>
                      {studentWillPay && cashAmount > 0 && (
                        <div className="text-right">
                          <p className="text-sm mb-1 uppercase font-bold text-emerald-400">Abono Efectivo</p>
                          <p className="text-2xl font-black text-emerald-400">- S/ {cashAmount.toFixed(2)}</p>
                        </div>
                      )}
                    </div>
                    {studentWillPay && cashAmount > 0 && (
                      <div className="mt-2 pt-2 border-t border-slate-700 flex justify-between items-center">
                        <p className="text-xs uppercase font-bold text-yellow-400 text-gray-400">Por Cobrar del Saldo</p>
                        <p className="text-xl font-black text-yellow-400">S/ {Math.max(0, total - cashAmount).toFixed(2)}</p>
                      </div>
                    )}
                    <p className="text-xs text-gray-400 mt-2">{cart.length} productos</p>
                  </div>

                  {selectedStudent && insufficientBalance && !selectedStudent.free_account && (
                    <div className="bg-red-50 border-2 border-red-300 rounded-xl p-3 flex items-center gap-2">
                      <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
                      <div>
                        <p className="font-bold text-red-800 text-sm">Saldo Insuficiente</p>
                        <p className="text-xs text-red-600">
                          Falta: S/ {( (studentWillPay ? Math.max(0, total - cashAmount) : total) - selectedStudent.balance).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  )}
                  
                  {selectedStudent && selectedStudent.free_account && (
                    <div className="bg-green-50 border-2 border-green-300 rounded-xl p-3 flex items-center gap-2">
                      <Check className="h-5 w-5 text-green-600 flex-shrink-0" />
                      <div>
                        <p className="font-bold text-green-800 text-sm">✓ Cuenta Libre</p>
                        <p className="text-xs text-green-700">
                          La compra se registrará como deuda para pagar después
                        </p>
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

      {/* MODAL DE MEDIOS DE PAGO (CLIENTE GENÉRICO) */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold flex items-center gap-2">
              <CreditCard className="h-7 w-7 text-emerald-600" />
              Selecciona Método de Pago
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6">
            {/* Resumen de Compra */}
            <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white rounded-2xl p-6">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm text-gray-300 uppercase font-semibold mb-1">Total a Cobrar</p>
                  <p className="text-5xl font-black">S/ {getTotal().toFixed(2)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400">{cart.length} productos</p>
                  <p className="text-lg font-bold text-emerald-400 mt-1">
                    {clientMode === 'generic' ? 'Cliente Genérico' : selectedStudent?.full_name}
                  </p>
                </div>
              </div>
            </div>

            {/* Medios de Pago - Botones Grandes */}
            <div className="space-y-3">
              <p className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">💳 Medios de Pago</p>
              
              <div className="grid grid-cols-2 gap-3">
                {/* Efectivo */}
                <button
                  onClick={() => setPaymentMethod('efectivo')}
                  className={`p-6 border-3 rounded-2xl transition-all hover:scale-105 hover:shadow-lg ${
                    paymentMethod === 'efectivo'
                      ? 'border-emerald-500 bg-emerald-50 shadow-emerald-200'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex flex-col items-center gap-3">
                    <Banknote className={`h-12 w-12 ${paymentMethod === 'efectivo' ? 'text-emerald-600' : 'text-gray-400'}`} />
                    <span className={`text-lg font-bold ${paymentMethod === 'efectivo' ? 'text-emerald-700' : 'text-gray-700'}`}>
                      Efectivo
                    </span>
                  </div>
                </button>

                {/* Yape QR */}
                <button
                  onClick={() => setPaymentMethod('yape_qr')}
                  className={`p-6 border-3 rounded-2xl transition-all hover:scale-105 hover:shadow-lg ${
                    paymentMethod === 'yape_qr'
                      ? 'border-purple-500 bg-purple-50 shadow-purple-200'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex flex-col items-center gap-3">
                    <QrCode className={`h-12 w-12 ${paymentMethod === 'yape_qr' ? 'text-purple-600' : 'text-gray-400'}`} />
                    <span className={`text-lg font-bold ${paymentMethod === 'yape_qr' ? 'text-purple-700' : 'text-gray-700'}`}>
                      Yape (QR)
                    </span>
                  </div>
                </button>

                {/* Yape Número */}
                <button
                  onClick={() => setPaymentMethod('yape_numero')}
                  className={`p-6 border-3 rounded-2xl transition-all hover:scale-105 hover:shadow-lg ${
                    paymentMethod === 'yape_numero'
                      ? 'border-purple-500 bg-purple-50 shadow-purple-200'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex flex-col items-center gap-3">
                    <Smartphone className={`h-12 w-12 ${paymentMethod === 'yape_numero' ? 'text-purple-600' : 'text-gray-400'}`} />
                    <span className={`text-lg font-bold ${paymentMethod === 'yape_numero' ? 'text-purple-700' : 'text-gray-700'}`}>
                      Yape (Número)
                    </span>
                  </div>
                </button>

                {/* Plin QR */}
                <button
                  onClick={() => setPaymentMethod('plin_qr')}
                  className={`p-6 border-3 rounded-2xl transition-all hover:scale-105 hover:shadow-lg ${
                    paymentMethod === 'plin_qr'
                      ? 'border-pink-500 bg-pink-50 shadow-pink-200'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex flex-col items-center gap-3">
                    <QrCode className={`h-12 w-12 ${paymentMethod === 'plin_qr' ? 'text-pink-600' : 'text-gray-400'}`} />
                    <span className={`text-lg font-bold ${paymentMethod === 'plin_qr' ? 'text-pink-700' : 'text-gray-700'}`}>
                      Plin (QR)
                    </span>
                  </div>
                </button>

                {/* Plin Número */}
                <button
                  onClick={() => setPaymentMethod('plin_numero')}
                  className={`p-6 border-3 rounded-2xl transition-all hover:scale-105 hover:shadow-lg ${
                    paymentMethod === 'plin_numero'
                      ? 'border-pink-500 bg-pink-50 shadow-pink-200'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex flex-col items-center gap-3">
                    <Smartphone className={`h-12 w-12 ${paymentMethod === 'plin_numero' ? 'text-pink-600' : 'text-gray-400'}`} />
                    <span className={`text-lg font-bold ${paymentMethod === 'plin_numero' ? 'text-pink-700' : 'text-gray-700'}`}>
                      Plin (Número)
                    </span>
                  </div>
                </button>

                {/* Tarjeta */}
                <button
                  onClick={() => setPaymentMethod('tarjeta')}
                  className={`p-6 border-3 rounded-2xl transition-all hover:scale-105 hover:shadow-lg ${
                    paymentMethod === 'tarjeta'
                      ? 'border-blue-500 bg-blue-50 shadow-blue-200'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex flex-col items-center gap-3">
                    <CreditCard className={`h-12 w-12 ${paymentMethod === 'tarjeta' ? 'text-blue-600' : 'text-gray-400'}`} />
                    <span className={`text-lg font-bold ${paymentMethod === 'tarjeta' ? 'text-blue-700' : 'text-gray-700'}`}>
                      Tarjeta
                    </span>
                    <span className="text-xs text-gray-500">Visa/Mastercard</span>
                  </div>
                </button>

                {/* Transferencia Bancaria */}
                <button
                  onClick={() => setPaymentMethod('transferencia')}
                  className={`p-6 border-3 rounded-2xl transition-all hover:scale-105 hover:shadow-lg ${
                    paymentMethod === 'transferencia'
                      ? 'border-cyan-500 bg-cyan-50 shadow-cyan-200'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex flex-col items-center gap-3">
                    <Building2 className={`h-12 w-12 ${paymentMethod === 'transferencia' ? 'text-cyan-600' : 'text-gray-400'}`} />
                    <span className={`text-lg font-bold ${paymentMethod === 'transferencia' ? 'text-cyan-700' : 'text-gray-700'}`}>
                      Transferencia
                    </span>
                  </div>
                </button>

                {/* PAGO MIXTO */}
                <button
                  onClick={() => setPaymentMethod('mixto')}
                  className={`p-6 border-3 rounded-2xl transition-all hover:scale-105 hover:shadow-lg ${
                    paymentMethod === 'mixto'
                      ? 'border-orange-500 bg-orange-50 shadow-orange-200'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex flex-col items-center gap-3">
                    <div className="relative">
                      <CreditCard className={`h-12 w-12 ${paymentMethod === 'mixto' ? 'text-orange-600' : 'text-gray-400'}`} />
                      <Banknote className={`h-6 w-6 absolute -bottom-1 -right-1 ${paymentMethod === 'mixto' ? 'text-orange-500' : 'text-gray-300'}`} />
                    </div>
                    <span className={`text-lg font-bold ${paymentMethod === 'mixto' ? 'text-orange-700' : 'text-gray-700'}`}>
                      Pago Mixto
                    </span>
                    <span className="text-xs text-gray-500">Efectivo + Tarjeta</span>
                  </div>
                </button>
              </div>
            </div>

            {/* Campos adicionales según método seleccionado */}
            
            {/* EFECTIVO: Con cuánto paga */}
            {paymentMethod === 'efectivo' && (
              <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-5 space-y-4">
                <div className="bg-white rounded-lg p-4 border-2 border-emerald-200">
                  <p className="text-sm font-bold text-emerald-900 uppercase mb-1">Total a Cobrar</p>
                  <p className="text-4xl font-black text-emerald-600">S/ {getTotal().toFixed(2)}</p>
                </div>
                
                <div>
                  <Label className="text-base font-bold text-emerald-900 mb-2 block">¿Con cuánto paga el cliente?</Label>
                  <Input
                    type="number"
                    step="0.50"
                    value={cashGiven}
                    onChange={(e) => setCashGiven(e.target.value)}
                    placeholder="Ej: 50.00"
                    className="h-16 text-2xl font-bold text-center border-emerald-300"
                    autoFocus
                  />
                  <p className="text-xs text-emerald-700 mt-2 text-center">
                    💡 Ingresa el monto en efectivo que entrega el cliente
                  </p>
                </div>
                
                {parseFloat(cashGiven) > 0 && (
                  <>
                    {parseFloat(cashGiven) >= getTotal() ? (
                      <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-2xl p-6 shadow-xl">
                        <p className="text-sm font-bold uppercase mb-2 opacity-90">💵 Vuelto a Entregar</p>
                        <p className="text-5xl font-black">
                          S/ {(parseFloat(cashGiven) - getTotal()).toFixed(2)}
                        </p>
                      </div>
                    ) : (
                      <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4">
                        <p className="text-sm font-bold text-red-900">⚠️ Monto Insuficiente</p>
                        <p className="text-sm text-red-700 mt-1">
                          Falta: S/ {(getTotal() - parseFloat(cashGiven)).toFixed(2)}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            
            {/* PAGO MIXTO: Dividir entre métodos */}
            {paymentMethod === 'mixto' && (
              <div className="bg-orange-50 border-2 border-orange-300 rounded-xl p-5 space-y-4">
                <div className="bg-white rounded-lg p-4 border-2 border-orange-200">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm font-bold text-orange-900 uppercase">Total a Cobrar</p>
                      <p className="text-3xl font-black text-orange-600">S/ {getTotal().toFixed(2)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-gray-600">Pagado</p>
                      <p className="text-2xl font-bold text-emerald-600">
                        S/ {paymentSplits.reduce((sum, p) => sum + p.amount, 0).toFixed(2)}
                      </p>
                      <p className="text-xs font-bold text-red-600 mt-1">
                        Falta: S/ {(getTotal() - paymentSplits.reduce((sum, p) => sum + p.amount, 0)).toFixed(2)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Lista de pagos agregados */}
                {paymentSplits.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-bold text-orange-900">Métodos Agregados:</p>
                    {paymentSplits.map((split, index) => (
                      <div key={index} className="bg-white border-2 border-orange-200 rounded-lg p-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {split.method === 'efectivo' && <Banknote className="h-5 w-5 text-emerald-600" />}
                          {split.method === 'tarjeta' && <CreditCard className="h-5 w-5 text-blue-600" />}
                          {split.method === 'yape' && <Smartphone className="h-5 w-5 text-purple-600" />}
                          {split.method === 'plin' && <Smartphone className="h-5 w-5 text-pink-600" />}
                          <span className="font-bold text-sm capitalize">{split.method}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-black text-lg">S/ {split.amount.toFixed(2)}</span>
                          <button
                            onClick={() => setPaymentSplits(paymentSplits.filter((_, i) => i !== index))}
                            className="text-red-600 hover:bg-red-50 p-1 rounded"
                          >
                            <X className="h-5 w-5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Formulario para agregar método */}
                {paymentSplits.reduce((sum, p) => sum + p.amount, 0) < getTotal() && (
                  <div className="bg-white border-2 border-orange-300 rounded-lg p-4 space-y-3">
                    <p className="text-sm font-bold text-orange-900">Agregar Método de Pago</p>
                    
                    <div className="grid grid-cols-4 gap-2">
                      {['efectivo', 'tarjeta', 'yape', 'plin'].map((method) => (
                        <button
                          key={method}
                          onClick={() => setCurrentSplitMethod(method)}
                          className={`p-3 border-2 rounded-lg text-xs font-bold capitalize transition-all ${
                            currentSplitMethod === method
                              ? 'border-orange-500 bg-orange-100 text-orange-900'
                              : 'border-gray-200 text-gray-600 hover:border-orange-300'
                          }`}
                        >
                          {method}
                        </button>
                      ))}
                    </div>

                    <div>
                      <Label className="text-sm font-bold text-gray-700">Monto</Label>
                      <Input
                        type="number"
                        step="0.50"
                        value={currentSplitAmount}
                        onChange={(e) => setCurrentSplitAmount(e.target.value)}
                        placeholder="0.00"
                        className="h-12 text-xl font-bold text-center"
                      />
                    </div>

                    <Button
                      onClick={() => {
                        if (currentSplitMethod && parseFloat(currentSplitAmount) > 0) {
                          const amount = parseFloat(currentSplitAmount);
                          const totalPaid = paymentSplits.reduce((sum, p) => sum + p.amount, 0);
                          
                          if (totalPaid + amount <= getTotal()) {
                            setPaymentSplits([...paymentSplits, { method: currentSplitMethod, amount }]);
                            setCurrentSplitMethod('');
                            setCurrentSplitAmount('');
                          } else {
                            toast({
                              variant: 'destructive',
                              title: 'Error',
                              description: 'El monto total no puede exceder el total a pagar',
                            });
                          }
                        }
                      }}
                      disabled={!currentSplitMethod || !currentSplitAmount || parseFloat(currentSplitAmount) <= 0}
                      className="w-full bg-orange-500 hover:bg-orange-600"
                    >
                      <Plus className="h-5 w-5 mr-2" />
                      Agregar
                    </Button>
                  </div>
                )}

                {paymentSplits.reduce((sum, p) => sum + p.amount, 0) === getTotal() && (
                  <div className="bg-emerald-50 border-2 border-emerald-500 rounded-xl p-4 text-center">
                    <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto mb-2" />
                    <p className="font-bold text-emerald-900">¡Pago Completo!</p>
                    <p className="text-sm text-emerald-700">Puedes proceder con la venta</p>
                  </div>
                )}
              </div>
            )}
            
            {paymentMethod === 'yape_numero' && (
              <div className="bg-purple-50 border-2 border-purple-200 rounded-xl p-4">
                <Label className="text-sm font-bold text-purple-900 mb-2 block">Número de Celular (Yape)</Label>
                <Input
                  type="text"
                  value={yapeNumber}
                  onChange={(e) => setYapeNumber(e.target.value)}
                  placeholder="999 999 999"
                  className="h-14 text-lg font-semibold"
                  maxLength={9}
                />
              </div>
            )}

            {paymentMethod === 'plin_numero' && (
              <div className="bg-pink-50 border-2 border-pink-200 rounded-xl p-4">
                <Label className="text-sm font-bold text-pink-900 mb-2 block">Número de Celular (Plin)</Label>
                <Input
                  type="text"
                  value={plinNumber}
                  onChange={(e) => setPlinNumber(e.target.value)}
                  placeholder="999 999 999"
                  className="h-14 text-lg font-semibold"
                  maxLength={9}
                />
              </div>
            )}

            {(paymentMethod === 'transferencia' || paymentMethod === 'yape_qr' || paymentMethod === 'plin_qr') && (
              <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-4">
                <Label className="text-sm font-bold text-amber-900 mb-2 block">Código de Operación</Label>
                <Input
                  type="text"
                  value={transactionCode}
                  onChange={(e) => setTransactionCode(e.target.value)}
                  placeholder="Ej: OP12345678"
                  className="h-14 text-lg font-semibold uppercase"
                />
                <p className="text-xs text-amber-700 mt-2">
                  Ingresa el código de la transacción para validar el pago
                </p>
              </div>
            )}

            {/* Botones de Acción */}
            <div className="space-y-3">
              <Button
                onClick={() => {
                  // Validar según método de pago
                  if (paymentMethod === 'efectivo') {
                    if (!cashGiven || parseFloat(cashGiven) < getTotal()) {
                      toast({
                        variant: 'destructive',
                        title: 'Error',
                        description: 'Ingresa el monto en efectivo que entrega el cliente',
                      });
                      return;
                    }
                  }
                  
                  if (paymentMethod === 'mixto') {
                    const totalPaid = paymentSplits.reduce((sum, p) => sum + p.amount, 0);
                    if (totalPaid < getTotal()) {
                      toast({
                        variant: 'destructive',
                        title: 'Error',
                        description: `Faltan S/ ${(getTotal() - totalPaid).toFixed(2)} por asignar`,
                      });
                      return;
                    }
                  }
                  
                  // Abrir modal de selección de comprobante
                  setShowConfirmDialog(false);
                  setShowDocumentTypeDialog(true);
                }}
                disabled={!paymentMethod || isProcessing}
                className="w-full h-16 text-xl font-black bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-300"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-6 w-6 mr-2 animate-spin" />
                    PROCESANDO...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-6 w-6 mr-2" />
                    CONTINUAR
                  </>
                )}
              </Button>

              <Button
                variant="outline"
                onClick={() => {
                  setShowConfirmDialog(false);
                  setPaymentMethod(null);
                  setYapeNumber('');
                  setPlinNumber('');
                  setTransactionCode('');
                  setRequiresInvoice(false);
                }}
                className="w-full h-12 text-base"
              >
                Cancelar
              </Button>
            </div>
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

      {/* MODAL DE SELECCIÓN DE COMPROBANTE */}
      <Dialog open={showDocumentTypeDialog} onOpenChange={setShowDocumentTypeDialog}>
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-center">
              Selecciona Tipo de Comprobante
            </DialogTitle>
          </DialogHeader>
          
          <div className="grid grid-cols-3 gap-6 py-8">
            {/* TICKET - DISPONIBLE */}
            <button
              onClick={() => {
                setSelectedDocumentType('ticket');
                setShowDocumentTypeDialog(false);
                handleConfirmCheckout(true); // Procesar venta e imprimir
              }}
              className="flex flex-col items-center gap-4 p-8 border-4 border-emerald-300 bg-emerald-50 rounded-2xl hover:bg-emerald-100 hover:border-emerald-400 transition-all hover:scale-105 shadow-lg hover:shadow-xl"
            >
              <Receipt className="h-20 w-20 text-emerald-600" />
              <div className="text-center">
                <p className="font-black text-xl text-emerald-900">TICKET</p>
                <p className="text-xs text-emerald-700 mt-2">Sin datos fiscales</p>
                <p className="text-xs text-emerald-600 font-semibold mt-1">✓ Disponible</p>
              </div>
            </button>
            
            {/* BOLETA - PRÓXIMAMENTE */}
            <button
              disabled
              className="flex flex-col items-center gap-4 p-8 border-4 border-gray-200 bg-gray-50 rounded-2xl opacity-50 cursor-not-allowed"
            >
              <Printer className="h-20 w-20 text-gray-400" />
              <div className="text-center">
                <p className="font-black text-xl text-gray-600">BOLETA</p>
                <Badge variant="secondary" className="mt-2">Próximamente</Badge>
                <p className="text-xs text-gray-500 mt-1">Requiere SUNAT</p>
              </div>
            </button>
            
            {/* FACTURA - PRÓXIMAMENTE */}
            <button
              disabled
              className="flex flex-col items-center gap-4 p-8 border-4 border-gray-200 bg-gray-50 rounded-2xl opacity-50 cursor-not-allowed"
            >
              <FileText className="h-20 w-20 text-gray-400" />
              <div className="text-center">
                <p className="font-black text-xl text-gray-600">FACTURA</p>
                <Badge variant="secondary" className="mt-2">Próximamente</Badge>
                <p className="text-xs text-gray-500 mt-1">Requiere SUNAT</p>
              </div>
            </button>
          </div>

          <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
            <p className="text-sm text-blue-900">
              <strong>ℹ️ Nota:</strong> Por ahora solo está disponible la impresión de tickets. 
              Boleta y Factura electrónicas estarán disponibles una vez conectado a SUNAT.
            </p>
          </div>

          <Button
            variant="outline"
            onClick={() => {
              setShowDocumentTypeDialog(false);
              setShowConfirmDialog(true); // Volver al modal de pago
            }}
            className="w-full"
          >
            ← Volver a Métodos de Pago
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default POS;
