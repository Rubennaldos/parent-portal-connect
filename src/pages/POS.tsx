import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { useBillingSync, useDebouncedSync } from '@/stores/billingSync';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useMaintenanceGuard } from '@/hooks/useMaintenanceGuard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { UserProfileMenu } from '@/components/admin/UserProfileMenu';
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
  FileText,
  Wifi,
  WifiOff,
  CloudOff,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { InvoiceClientModal, type InvoiceClientData, type InvoiceType } from '@/components/billing/InvoiceClientModal';
import { generarComprobante } from '@/lib/nubefact';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { getProductsForSchool } from '@/lib/productPricing';
import { printPOSSale } from '@/lib/posPrinterService';
import { CashOpeningModal } from '@/components/cash-register/CashOpeningModal';
import {
  preloadPOSData,
  cacheStudents,
  cacheProducts,
  searchCachedStudents,
  getCachedProducts,
  findNFCCardByUID,
  getCachedStudents,
  addToOfflineQueue,
  getPendingOfflineTransactions,
  syncOfflineTransactions,
  type OfflineTransaction,
} from '@/lib/offlineStorage';

interface Student {
  id: string;
  full_name: string;
  photo_url: string | null;
  balance: number;
  grade: string;
  section: string;
  school_id?: string;
  free_account?: boolean;
  kiosk_disabled?: boolean;
  limit_type?: 'none' | 'daily' | 'weekly' | 'monthly';
  daily_limit?: number;
  weekly_limit?: number;
  monthly_limit?: number;
}

interface Product {
  id: string;
  barcode?: string;
  name: string;
  description?: string;
  price: number;
  category: string;
  image_url?: string | null;
  active?: boolean;
}

interface LimitDetail {
  type: 'daily' | 'weekly' | 'monthly';
  label: string;
  limit: number;
  spent: number;
  remaining: number;
  renewalText: string;
  isActive: boolean; // true if this is the enforced limit_type
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
  const { full_name } = useUserProfile();
  const { isOnline, checkConnection } = useOnlineStatus();
  const { toast } = useToast();
  const navigate = useNavigate();
  const emitSync = useBillingSync((s) => s.emit);
  const balanceSyncTs = useDebouncedSync('balances', 500);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const nfcPosInputRef = useRef<HTMLInputElement>(null);
  // Estado NFC en el POS
  const [nfcScanning, setNfcScanning] = useState(false);
  const [nfcError, setNfcError] = useState<string | null>(null);
  const nfcPosBuffer = useRef('');
  const nfcPosTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nfcPosLastKeyTime = useRef<number>(0);

  console.log('🏪 POS - Componente montado');
  console.log('👤 POS - Usuario:', user?.email);
  console.log('🎭 POS - Rol:', role);

  // ── Estado OFFLINE ─────────────────────────────────────────────
  const [offlinePendingCount, setOfflinePendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [offlineDataReady, setOfflineDataReady] = useState(false);
  const [offlinePreloadMsg, setOfflinePreloadMsg] = useState<string | null>(null);

  // Estado para la sede del usuario (cajero)
  const [userSchoolId, setUserSchoolId] = useState<string | null>(null);
  const maintenance = useMaintenanceGuard('pos_admin', userSchoolId);

  // ── Guard de caja ────────────────────────────────────────────────
  const [cashGuardLoading, setCashGuardLoading] = useState(true);
  const [posOpenRegister, setPosOpenRegister] = useState<any | null>(null);
  const [posHasUnclosed, setPosHasUnclosed] = useState(false);
  const [posPreviousUnclosed, setPosPreviousUnclosed] = useState<any | null>(null);
  const [posLastClosedAmount, setPosLastClosedAmount] = useState<number | null>(null);

  // Estados de cliente
  const [clientMode, setClientMode] = useState<'student' | 'generic' | 'teacher' | null>(null);
  const [studentSearch, setStudentSearch] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [studentAccountStatuses, setStudentAccountStatuses] = useState<Map<string, { canPurchase: boolean; statusText: string; statusColor: string; reason?: string }>>(new Map());
  const [showStudentResults, setShowStudentResults] = useState(false);

  // Estados de profesor
  const [teacherSearch, setTeacherSearch] = useState('');
  const [selectedTeacher, setSelectedTeacher] = useState<any | null>(null);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [showTeacherResults, setShowTeacherResults] = useState(false);
  const [showPhotoModal, setShowPhotoModal] = useState(false); // Para ampliar foto del estudiante
  const [studentLimitsDetail, setStudentLimitsDetail] = useState<LimitDetail[]>([]);
  const [loadingLimits, setLoadingLimits] = useState(false);

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
  const [showCreditConfirmDialog, setShowCreditConfirmDialog] = useState(false); // Modal para cuenta de crédito

  // NUEVO: Campo "Con cuánto paga" para calcular vuelto
  const [cashGiven, setCashGiven] = useState('');

  // NUEVO: Pago Mixto
  interface PaymentSplit {
    method: string;
    amount: number;
    operationCode?: string; // para tarjeta, transferencia, yape_qr, plin_qr
    phoneNumber?: string;   // para yape_numero, plin_numero
  }
  const [paymentSplits, setPaymentSplits] = useState<PaymentSplit[]>([]);
  const [currentSplitMethod, setCurrentSplitMethod] = useState('');
  const [currentSplitAmount, setCurrentSplitAmount] = useState('');
  const [currentSplitOperationCode, setCurrentSplitOperationCode] = useState('');
  const [currentSplitPhoneNumber, setCurrentSplitPhoneNumber] = useState('');

  // Modal para seleccionar tipo de comprobante
  const [showDocumentTypeDialog, setShowDocumentTypeDialog] = useState(false);
  const [selectedDocumentType, setSelectedDocumentType] = useState('');

  // Modal de datos del cliente para boleta/factura electrónica
  const [showInvoiceClientModal, setShowInvoiceClientModal] = useState(false);
  const [pendingInvoiceType, setPendingInvoiceType] = useState<InvoiceType>('boleta');
  /** true = el tipo ya fue elegido en el dialog anterior → no mostrar selector en el modal */
  const [invoiceTypeLocked, setInvoiceTypeLocked] = useState(false);
  const [invoiceClientData, setInvoiceClientData] = useState<InvoiceClientData | null>(null);
  const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false);
  /** URL del PDF del último comprobante emitido (para compartir por WhatsApp) */
  const [lastInvoicePdfUrl, setLastInvoicePdfUrl] = useState<string | null>(null);

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

  // ── OFFLINE: Precarga y Sincronización ──────────────────────────
  // Precargar datos para uso offline cuando hay conexión
  useEffect(() => {
    if (!userSchoolId || !isOnline) return;

    const preload = async () => {
      try {
        setOfflinePreloadMsg('Precargando datos offline...');
        const result = await preloadPOSData(userSchoolId);
        setOfflineDataReady(true);
        setOfflinePreloadMsg(null);
        console.log(`✅ Datos offline listos: ${result.students} alumnos, ${result.products} productos, ${result.nfcCards} NFC`);
      } catch (err) {
        console.warn('⚠️ Error precargando datos offline:', err);
        setOfflinePreloadMsg(null);
      }
    };

    preload();
  }, [userSchoolId, isOnline]);

  // Verificar ventas pendientes de sincronizar
  useEffect(() => {
    const checkPending = async () => {
      const pending = await getPendingOfflineTransactions();
      setOfflinePendingCount(pending.length);
    };
    checkPending();
  }, []);

  // Sincronizar automáticamente al recuperar conexión
  useEffect(() => {
    if (!isOnline || offlinePendingCount === 0) return;

    const autoSync = async () => {
      setIsSyncing(true);
      try {
        const result = await syncOfflineTransactions();
        if (result.synced > 0) {
          toast({
            title: `✅ ${result.synced} venta(s) sincronizada(s)`,
            description: result.failed > 0 ? `${result.failed} fallaron — revisa el historial` : 'Todas las ventas offline se subieron correctamente',
            duration: 5000,
          });
        }
        if (result.failed > 0) {
          toast({
            variant: 'destructive',
            title: `❌ ${result.failed} venta(s) no se pudieron sincronizar`,
            description: result.errors.join(', '),
            duration: 8000,
          });
        }
        const remaining = await getPendingOfflineTransactions();
        setOfflinePendingCount(remaining.length);
      } catch (err) {
        console.error('Error en sincronización automática:', err);
      } finally {
        setIsSyncing(false);
      }
    };

    // Esperar 3 segundos para que la conexión se estabilice
    const timer = setTimeout(autoSync, 3000);
    return () => clearTimeout(timer);
  }, [isOnline, offlinePendingCount]);

  // Sincronización manual
  const handleManualSync = useCallback(async () => {
    const reallyOnline = await checkConnection();
    if (!reallyOnline) {
      toast({
        variant: 'destructive',
        title: 'Sin conexión',
        description: 'Aún no hay internet. Las ventas se sincronizarán automáticamente cuando vuelva.',
      });
      return;
    }
    setIsSyncing(true);
    try {
      const result = await syncOfflineTransactions();
      toast({
        title: result.synced > 0 ? `✅ ${result.synced} sincronizada(s)` : 'No hay ventas pendientes',
        description: result.failed > 0 ? `${result.failed} con error` : undefined,
      });
      const remaining = await getPendingOfflineTransactions();
      setOfflinePendingCount(remaining.length);
    } finally {
      setIsSyncing(false);
    }
  }, [checkConnection, toast]);

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

  // Buscar profesores
  useEffect(() => {
    if (clientMode === 'teacher' && teacherSearch.trim().length >= 2) {
      searchTeachers(teacherSearch);
      setShowTeacherResults(true);
    } else {
      setTeachers([]);
      setShowTeacherResults(false);
    }
  }, [teacherSearch, clientMode]);

  // Efecto para Escucha Global de Teclado (Pistola de Código de Barras + Atajos)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Si estamos en un modo de venta
      if (clientMode) {
        const target = e.target as HTMLElement;
        const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

        // ⌨️ ATAJOS DE TECLADO
        
        // ENTER → Cobrar (finalizar compra) - SOLO si NO estás escribiendo en un input
        if (e.key === 'Enter' && cart.length > 0 && clientMode && !isInput) {
          e.preventDefault();
          // Verificar si se puede hacer checkout
          const canProceed = 
            (clientMode === 'generic') || 
            (clientMode === 'student' && selectedStudent && canCheckout()) ||
            (clientMode === 'teacher' && selectedTeacher);
          
          if (canProceed) {
            handleCheckoutClick();
          }
          return;
        }

        // + (teclado numérico) → Aumentar cantidad del primer item del carrito
        if ((e.key === '+' || e.key === 'Add') && cart.length > 0 && !isInput) {
          e.preventDefault();
          const firstItem = cart[0];
          setCart(cart.map((item, idx) => 
            idx === 0 ? { ...item, quantity: item.quantity + 1 } : item
          ));
          return;
        }

        // - (teclado numérico) → Disminuir cantidad del primer item del carrito
        if ((e.key === '-' || e.key === 'Subtract') && cart.length > 0 && !isInput) {
          e.preventDefault();
          const firstItem = cart[0];
          if (firstItem.quantity > 1) {
            setCart(cart.map((item, idx) => 
              idx === 0 ? { ...item, quantity: item.quantity - 1 } : item
            ));
          } else {
            // Si cantidad es 1, eliminar el item
            setCart(cart.filter((_, idx) => idx !== 0));
          }
          return;
        }

        // DELETE o D → Borrar primer producto del carrito
        if ((e.key === 'Delete' || e.key.toLowerCase() === 'd') && cart.length > 0 && !isInput) {
          e.preventDefault();
          setCart(cart.filter((_, idx) => idx !== 0));
          return;
        }

        // Si no estamos escribiendo en un cuadro de texto y presionamos una tecla alfanumérica
        // O si es una pistola que envía prefijos, esto capturará la primera tecla y enfocará
        if (!isInput && /^[a-zA-Z0-9]$/.test(e.key)) {
          searchInputRef.current?.focus();
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [clientMode, cart, selectedStudent]);

  // Auto-focus cuando se selecciona un cliente
  useEffect(() => {
    if (clientMode === 'generic' || selectedStudent) {
      // Dar un pequeño respiro para que el DOM se actualice
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 200);
    }
  }, [clientMode, selectedStudent]);

  // ── Verificar estado de caja cuando cambia la sede ──────────────
  useEffect(() => {
    const checkCash = async () => {
      if (!userSchoolId) return;
      // Si estamos offline, no bloquear con el guard de caja
      if (!navigator.onLine) {
        setCashGuardLoading(false);
        setPosOpenRegister({ id: 'offline-mode', status: 'open' }); // simular caja abierta
        return;
      }
      setCashGuardLoading(true);
      try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const { data: openRegs } = await supabase
          .from('cash_registers')
          .select('*')
          .eq('school_id', userSchoolId)
          .eq('status', 'open')
          .order('opened_at', { ascending: false })
          .limit(1);

        const current = openRegs?.[0] || null;
        if (current) {
          const openedDate = new Date(current.opened_at);
          openedDate.setHours(0, 0, 0, 0);
          if (openedDate < todayStart) {
            setPosHasUnclosed(true);
            setPosPreviousUnclosed(current);
            setPosOpenRegister(null);
          } else {
            setPosOpenRegister(current);
            setPosHasUnclosed(false);
            setPosPreviousUnclosed(null);
          }
        } else {
          setPosOpenRegister(null);
          const { data: unclosed } = await supabase
            .from('cash_registers')
            .select('*')
            .eq('school_id', userSchoolId)
            .eq('status', 'open')
            .lt('opened_at', todayStart.toISOString())
            .order('opened_at', { ascending: false })
            .limit(1);
          if (unclosed && unclosed.length > 0) {
            setPosHasUnclosed(true);
            setPosPreviousUnclosed(unclosed[0]);
          } else {
            setPosHasUnclosed(false);
            setPosPreviousUnclosed(null);
          }
        }

        // Último cierre para referencia
        const { data: lastClosure } = await supabase
          .from('cash_closures')
          .select('actual_final')
          .eq('school_id', userSchoolId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        setPosLastClosedAmount(lastClosure?.actual_final ?? null);
      } finally {
        setCashGuardLoading(false);
      }
    };
    checkCash();
  }, [userSchoolId]);

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
      
      // Guardar el school_id del usuario para filtrar estudiantes
      setUserSchoolId(schoolId);
      // Persistir para uso offline
      if (schoolId) localStorage.setItem('pos_user_school_id', schoolId);

      // Usar la función de pricing inteligente
      const productsData = await getProductsForSchool(schoolId);
      
      console.log('📦 POS - Productos recibidos:', productsData.length);
      console.log('💰 POS - Productos con precio personalizado:', productsData.filter(p => p.is_custom_price).length);
      
      setProducts(productsData);
      setFilteredProducts(productsData);
      // Cachear para uso offline
      if (schoolId) {
        cacheProducts(productsData, schoolId).catch(() => {});
      }
      console.log('✅ POS - Productos cargados correctamente con precios de sede');
    } catch (error: any) {
      console.error('💥 POS - Error cargando productos, intentando caché offline...');
      // ── FALLBACK OFFLINE: cargar desde caché ──
      const offlineSchoolId = userSchoolId || localStorage.getItem('pos_user_school_id');
      if (offlineSchoolId) {
        if (!userSchoolId) setUserSchoolId(offlineSchoolId); // restaurar school_id desde localStorage
        try {
          const cached = await getCachedProducts(offlineSchoolId);
          if (cached.length > 0) {
            setProducts(cached);
            setFilteredProducts(cached);
            toast({
              title: '📦 Productos cargados desde caché',
              description: `${cached.length} productos disponibles (modo offline)`,
              duration: 4000,
            });
            return;
          }
        } catch {}
      }
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
        .eq('school_id', profile.school_id)
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
      console.log('🏫 Filtrando por sede:', userSchoolId);
      
      // Construir la consulta base
      let studentsQuery = supabase
        .from('students')
        .select('id, full_name, photo_url, balance, grade, section, free_account, kiosk_disabled, limit_type, daily_limit, weekly_limit, monthly_limit, school_id')
        .eq('is_active', true)
        .ilike('full_name', `%${query}%`);
      
      // Si el usuario tiene una sede asignada, filtrar solo estudiantes de esa sede
      if (userSchoolId) {
        studentsQuery = studentsQuery.eq('school_id', userSchoolId);
        console.log('✅ Aplicando filtro de sede:', userSchoolId);
      } else {
        console.warn('⚠️ Usuario sin sede asignada, mostrando todos los estudiantes');
      }
      
      const { data, error } = await studentsQuery.limit(5);

      if (error) {
        console.error('❌ Error en consulta de estudiantes:', error);
        throw error;
      }

      console.log('✅ Estudiantes encontrados:', data?.length || 0);
      setStudents(data || []);
      // Cachear resultados para offline
      if (data && data.length > 0 && userSchoolId) {
        cacheStudents(data, userSchoolId).catch(() => {});
      }

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
      console.error('❌ Error buscando estudiantes, intentando caché offline...');
      // ── FALLBACK OFFLINE: buscar en caché local ──
      const offlineSchoolId = userSchoolId || localStorage.getItem('pos_user_school_id');
      if (offlineSchoolId) {
        try {
          const cachedResults = await searchCachedStudents(query, offlineSchoolId);
          if (cachedResults.length > 0) {
            setStudents(cachedResults);
            // Calcular estados básicos sin consulta a BD
            const statusMap = new Map();
            for (const s of cachedResults) {
              statusMap.set(s.id, {
                canPurchase: !s.kiosk_disabled,
                statusText: s.kiosk_disabled ? '🚫 Kiosco desactivado' : `💰 S/ ${(s.balance || 0).toFixed(2)} (offline)`,
                statusColor: s.kiosk_disabled ? 'text-red-500' : 'text-emerald-600',
              });
            }
            setStudentAccountStatuses(statusMap);
            console.log(`📱 ${cachedResults.length} alumnos encontrados en caché offline`);
            return;
          }
        } catch {}
      }
      toast({
        variant: 'destructive',
        title: 'Error al buscar estudiantes',
        description: !isOnline ? 'Sin conexión y no hay datos en caché' : (error.message || 'No se pudo realizar la búsqueda'),
      });
    }
  };

  const searchTeachers = async (query: string) => {
    try {
      console.log('🔍 Buscando profesores con query:', query);
      console.log('🏫 Filtrando por sede:', userSchoolId);
      
      // Construir la consulta base
      let teachersQuery = supabase
        .from('teacher_profiles_with_schools')
        .select('*')
        .ilike('full_name', `%${query}%`);
      
      // Si el usuario tiene una sede asignada, filtrar profesores de esa sede
      if (userSchoolId) {
        teachersQuery = teachersQuery.or(`school_1_id.eq.${userSchoolId},school_2_id.eq.${userSchoolId}`);
        console.log('✅ Aplicando filtro de sede:', userSchoolId);
      } else {
        console.warn('⚠️ Usuario sin sede asignada, mostrando todos los profesores');
      }
      
      const { data, error } = await teachersQuery.limit(5);

      if (error) {
        console.error('❌ Error en consulta de profesores:', error);
        throw error;
      }

      console.log('✅ Profesores encontrados:', data?.length || 0);
      setTeachers(data || []);
    } catch (error: any) {
      console.error('❌ Error crítico buscando profesores:', error);
      toast({
        variant: 'destructive',
        title: 'Error al buscar profesores',
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
    // 0. Cuenta del kiosco desactivada por el padre
    if (student.kiosk_disabled) {
      return {
        canPurchase: false,
        statusText: '🍽️ Sin cuenta — Solo almuerzo',
        statusColor: 'text-orange-600',
        reason: 'El padre desactivó la cuenta del kiosco. Solo puede pedir almuerzo desde el calendario.',
      };
    }

    // 1. Cuenta Libre (free_account = true o null)
    if (student.free_account !== false) {
      const balance = student.balance || 0;
      const limitText = student.daily_limit && student.daily_limit > 0 
        ? `Tope: S/ ${student.daily_limit.toFixed(2)}`
        : 'Sin tope';
      
      // Si tiene saldo de recarga, mostrarlo para que el cajero sepa
      const balanceText = balance > 0 
        ? ` | 💰 Saldo: S/ ${balance.toFixed(2)}`
        : '';
      
      return {
        canPurchase: true,
        statusText: `✨ Libre - ${limitText}${balanceText}`,
        statusColor: 'text-emerald-600'
      };
    }

    // 2. Con Recargas (sin cuenta libre)
    const balance = student.balance || 0;

    // 3. Con Topes activos — verificar TODOS los topes con valor > 0
    // ⚠️ IMPORTANTE: Verificar topes ANTES de bloquear por saldo,
    //    porque un alumno con tope puede comprar a crédito aunque tenga saldo 0
    const hasAnyLimit = (student.daily_limit || 0) > 0 || (student.weekly_limit || 0) > 0 || (student.monthly_limit || 0) > 0;
    if (hasAnyLimit) {
      try {
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        const startOfWeek = new Date(now);
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
        startOfWeek.setHours(0, 0, 0, 0);
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        startOfMonth.setHours(0, 0, 0, 0);

        // Una sola consulta para todo el mes (incluye día y semana)
        const { data: monthTx } = await supabase
          .from('transactions')
          .select('amount, metadata, created_at')
          .eq('student_id', student.id)
          .eq('type', 'purchase')
          .gte('created_at', startOfMonth.toISOString())
          .eq('is_deleted', false)
          .neq('payment_status', 'cancelled');

        const kioscoTx = (monthTx || []).filter(t => !(t.metadata as any)?.lunch_order_id);

        const spentToday = kioscoTx.filter(t => t.created_at >= todayStr).reduce((s, t) => s + Math.abs(t.amount), 0);
        const spentWeek = kioscoTx.filter(t => t.created_at >= startOfWeek.toISOString()).reduce((s, t) => s + Math.abs(t.amount), 0);
        const spentMonth = kioscoTx.reduce((s, t) => s + Math.abs(t.amount), 0);

        // Construir resumen de topes
        const parts: string[] = [];
        let anyExceeded = false;
        let lowestRemaining = Infinity;
        let lowestPeriod = '';

        if ((student.daily_limit || 0) > 0) {
          const rem = student.daily_limit! - spentToday;
          if (rem <= 0) { anyExceeded = true; lowestPeriod = 'Diario'; }
          if (rem < lowestRemaining) { lowestRemaining = rem; lowestPeriod = 'Diario'; }
          parts.push(`D: S/${Math.max(0, rem).toFixed(0)}/${student.daily_limit!.toFixed(0)}`);
        }
        if ((student.weekly_limit || 0) > 0) {
          const rem = student.weekly_limit! - spentWeek;
          if (rem <= 0 && !anyExceeded) { anyExceeded = true; lowestPeriod = 'Semanal'; }
          if (rem < lowestRemaining) { lowestRemaining = rem; lowestPeriod = 'Semanal'; }
          parts.push(`S: S/${Math.max(0, rem).toFixed(0)}/${student.weekly_limit!.toFixed(0)}`);
        }
        if ((student.monthly_limit || 0) > 0) {
          const rem = student.monthly_limit! - spentMonth;
          if (rem <= 0 && !anyExceeded) { anyExceeded = true; lowestPeriod = 'Mensual'; }
          if (rem < lowestRemaining) { lowestRemaining = rem; lowestPeriod = 'Mensual'; }
          parts.push(`M: S/${Math.max(0, rem).toFixed(0)}/${student.monthly_limit!.toFixed(0)}`);
        }

        if (anyExceeded) {
          return {
            canPurchase: false,
            statusText: `🚫 Tope ${lowestPeriod} Alcanzado`,
            statusColor: 'text-red-600',
            reason: `Topes: ${parts.join(' · ')}`
          };
        }

        return {
          canPurchase: true,
          statusText: `📊 ${parts.join(' · ')}`,
          statusColor: lowestRemaining < (student.daily_limit || student.weekly_limit || student.monthly_limit || 0) * 0.3 ? 'text-orange-600' : 'text-blue-600'
        };
      } catch (error) {
        console.error('Error calculating limits:', error);
      }
    }

    // 4. Sin topes y sin saldo → bloquear
    if (balance <= 0) {
      return {
        canPurchase: false,
        statusText: '💳 Sin Saldo - S/ 0.00',
        statusColor: 'text-red-600',
        reason: 'Sin saldo disponible'
      };
    }

    // 5. Sin límites pero con saldo (default)
    return {
      canPurchase: true,
      statusText: `💰 Saldo: S/ ${balance.toFixed(2)}`,
      statusColor: 'text-emerald-600'
    };
  };

  // ═══════════════════════════════════════════════════════════════════
  // 📊 Obtener TODOS los topes del alumno (diario, semanal, mensual)
  // ═══════════════════════════════════════════════════════════════════
  const fetchStudentLimits = async (student: Student) => {
    setLoadingLimits(true);
    try {
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];

      const startOfWeek = new Date(now);
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      startOfWeek.setHours(0, 0, 0, 0);

      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      startOfMonth.setHours(0, 0, 0, 0);

      // Traer TODAS las transacciones del mes (incluye diarias y semanales)
      const { data: monthTx } = await supabase
        .from('transactions')
        .select('amount, metadata, created_at')
        .eq('student_id', student.id)
        .eq('type', 'purchase')
        .gte('created_at', startOfMonth.toISOString())
        .eq('is_deleted', false)
        .neq('payment_status', 'cancelled');

      const kioscoTx = (monthTx || []).filter(t => !(t.metadata as any)?.lunch_order_id);

      const spentToday = kioscoTx
        .filter(t => t.created_at >= todayStr)
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);

      const spentWeek = kioscoTx
        .filter(t => t.created_at >= startOfWeek.toISOString())
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);

      const spentMonth = kioscoTx
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);

      // Calcular fechas de renovación
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = `Mañana ${tomorrow.toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric' })} a las 00:00`;

      const nextMonday = new Date(now);
      nextMonday.setDate(nextMonday.getDate() + (7 - nextMonday.getDay()) % 7 || 7);
      const nextMondayStr = `Lunes ${nextMonday.toLocaleDateString('es-PE', { day: 'numeric', month: 'short' })}`;

      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const nextMonthStr = `1 de ${nextMonth.toLocaleDateString('es-PE', { month: 'long' })}`;

      const limits: LimitDetail[] = [];
      const activeType = student.limit_type || 'none';

      // Agregar cada tope que tenga valor > 0
      if ((student.daily_limit || 0) > 0) {
        const lim = student.daily_limit!;
        limits.push({
          type: 'daily',
          label: 'Diario',
          limit: lim,
          spent: spentToday,
          remaining: Math.max(0, lim - spentToday),
          renewalText: tomorrowStr,
          isActive: activeType === 'daily',
        });
      }
      if ((student.weekly_limit || 0) > 0) {
        const lim = student.weekly_limit!;
        limits.push({
          type: 'weekly',
          label: 'Semanal',
          limit: lim,
          spent: spentWeek,
          remaining: Math.max(0, lim - spentWeek),
          renewalText: nextMondayStr,
          isActive: activeType === 'weekly',
        });
      }
      if ((student.monthly_limit || 0) > 0) {
        const lim = student.monthly_limit!;
        limits.push({
          type: 'monthly',
          label: 'Mensual',
          limit: lim,
          spent: spentMonth,
          remaining: Math.max(0, lim - spentMonth),
          renewalText: nextMonthStr,
          isActive: activeType === 'monthly',
        });
      }

      setStudentLimitsDetail(limits);
    } catch (err) {
      console.error('Error fetching student limits:', err);
      setStudentLimitsDetail([]);
    } finally {
      setLoadingLimits(false);
    }
  };

  const selectStudent = (student: Student) => {
    setSelectedStudent(student);
    setStudentSearch(student.full_name);
    setShowStudentResults(false);
    fetchStudentLimits(student);
  };

  const balanceFetchId = useRef(0);
  useEffect(() => {
    if (balanceSyncTs <= 0 || !selectedStudent) return;
    const reqId = ++balanceFetchId.current;
    const studentId = selectedStudent.id;
    const studentName = selectedStudent.full_name;
    (async () => {
      const { data } = await supabase
        .from('students')
        .select('balance, free_account, kiosk_disabled')
        .eq('id', studentId)
        .single();
      if (reqId !== balanceFetchId.current) return;
      if (data) {
        setSelectedStudent((prev) => prev ? { ...prev, ...data } : prev);
        toast({ title: '🔄 Saldo actualizado', description: `${studentName}: S/ ${data.balance.toFixed(2)}`, duration: 3000 });
      }
    })();
  }, [balanceSyncTs]);

  const selectTeacher = (teacher: any) => {
    console.log('👨‍🏫 Profesor seleccionado:', teacher);
    setSelectedTeacher(teacher);
    setTeacherSearch(teacher.full_name);
    setShowTeacherResults(false);
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

  const selectTeacherMode = () => {
    console.log('👨‍🏫 Modo Profesor seleccionado');
    setClientMode('teacher');
    setSelectedTeacher(null);
    setTeacherSearch('');
    setShowTeacherResults(false);
  };

  const resetClient = () => {
    console.log('🧹 Limpiando estado del cliente...');
    setClientMode(null);
    setSelectedStudent(null);
    setStudentSearch('');
    setSelectedTeacher(null);
    setTeacherSearch('');
    setCart([]);
    setProductSearch('');
    setSelectedCategory('todos');
    setShowStudentResults(false);
    setShowTeacherResults(false);
    setPaymentMethod(null);
    setYapeNumber('');
    setPlinNumber('');
    setTransactionCode('');
    setRequiresInvoice(false);
    setStudentLimitsDetail([]);
    console.log('✅ Estado limpio - Modal de selección debe aparecer');
  };

  // ══════════════════════════════════════════════════════════
  // 📡 NFC: listener global en la pantalla de selección
  // Activo solo cuando no hay clientMode (modal de selección)
  // ══════════════════════════════════════════════════════════
  useEffect(() => {
    if (clientMode) return; // Solo activo en la pantalla de selección

    const handleNFCKey = (e: KeyboardEvent) => {
      const now = Date.now();
      const timeSinceLast = now - nfcPosLastKeyTime.current;
      nfcPosLastKeyTime.current = now;

      if (e.key === 'Enter') {
        const uid = nfcPosBuffer.current.trim();
        nfcPosBuffer.current = '';
        if (nfcPosTimer.current) clearTimeout(nfcPosTimer.current);
        // Procesar solo si vino rápido (era el lector, no tecla Enter manual)
        if (uid.length >= 4 && timeSinceLast < 200) {
          handleNFCScanPOS(uid);
        }
        return;
      }
      // Acumular solo chars que lleguen rápido (< 80ms = lector HID)
      if (e.key.length === 1 && (timeSinceLast < 80 || nfcPosBuffer.current.length === 0)) {
        nfcPosBuffer.current += e.key;
        if (nfcPosTimer.current) clearTimeout(nfcPosTimer.current);
        nfcPosTimer.current = setTimeout(() => { nfcPosBuffer.current = ''; }, 200);
      }
    };

    window.addEventListener('keydown', handleNFCKey, true); // capture=true
    return () => {
      window.removeEventListener('keydown', handleNFCKey, true);
      if (nfcPosTimer.current) clearTimeout(nfcPosTimer.current);
    };
  }, [clientMode]);

  // ══════════════════════════════════════════════════════════
  // 📡 NFC: procesar UID escaneado por el lector USB
  // ══════════════════════════════════════════════════════════
  const handleNFCScanPOS = async (uid: string) => {
    if (!uid.trim()) return;
    setNfcScanning(true);
    setNfcError(null);
    const normalizedUID = uid.trim().toUpperCase();

    try {
      let holder: any = null;

      if (isOnline) {
        // ── Online: consultar RPC en Supabase ──
        const { data, error } = await supabase
          .rpc('get_nfc_holder', { p_card_uid: normalizedUID });
        if (error) throw error;
        if (data && data.length > 0) holder = data[0];
      } else {
        // ── Offline: buscar en caché local de NFC + alumnos ──
        const cachedCard = await findNFCCardByUID(normalizedUID);
        if (cachedCard && cachedCard.is_active) {
          if (cachedCard.holder_type === 'student' && cachedCard.student_id && userSchoolId) {
            const cachedStudents = await getCachedStudents(userSchoolId);
            const student = cachedStudents.find((s: any) => s.id === cachedCard.student_id);
            if (student) {
              holder = {
                holder_type: 'student',
                student_id: student.id,
                student_name: student.full_name,
                student_grade: student.grade,
                student_section: student.section,
                student_balance: student.balance,
                student_free_account: student.free_account,
                student_kiosk_disabled: student.kiosk_disabled,
                student_limit_type: student.limit_type,
                student_daily_limit: student.daily_limit,
                student_weekly_limit: student.weekly_limit,
                student_monthly_limit: student.monthly_limit,
                student_school_id: student.school_id,
                card_number: cachedCard.card_number,
                is_active: true,
              };
            }
          } else if (cachedCard.holder_type === 'teacher') {
            holder = {
              holder_type: 'teacher',
              teacher_id: cachedCard.teacher_id,
              teacher_name: `Profesor (tarjeta ${cachedCard.card_number || normalizedUID})`,
              is_active: true,
            };
          }
        }
      }

      if (!holder) {
        setNfcError('Tarjeta no registrada en el sistema');
        toast({ variant: 'destructive', title: '❌ Tarjeta no encontrada', description: 'Esta tarjeta no está asignada a ningún alumno ni profesor.' });
        return;
      }

      if (!holder.is_active) {
        setNfcError('Esta tarjeta está desactivada');
        toast({ variant: 'destructive', title: '🔴 Tarjeta inactiva', description: 'Contacta al administrador de sede.' });
        return;
      }

      if (holder.holder_type === 'student') {
        const student: Student = {
          id: holder.student_id,
          full_name: holder.student_name,
          photo_url: null,
          balance: holder.student_balance ?? 0,
          grade: holder.student_grade,
          section: holder.student_section,
          school_id: holder.student_school_id,
          free_account: holder.student_free_account,
          kiosk_disabled: holder.student_kiosk_disabled,
          limit_type: holder.student_limit_type as any,
          daily_limit: holder.student_daily_limit,
          weekly_limit: holder.student_weekly_limit,
          monthly_limit: holder.student_monthly_limit,
        };
        setClientMode('student');
        selectStudent(student);
        const hasLim = (student.daily_limit && student.daily_limit > 0) || (student.weekly_limit && student.weekly_limit > 0) || (student.monthly_limit && student.monthly_limit > 0);
        const nfcInfo = hasLim 
          ? `${student.grade} - ${student.section} · Tope diario: S/ ${(student.daily_limit || student.weekly_limit || student.monthly_limit || 0).toFixed(2)}`
          : `${student.grade} - ${student.section} · Saldo: S/ ${student.balance.toFixed(2)}`;
        const offlineTag = !isOnline ? ' (offline)' : '';
        toast({ title: `👋 ¡Hola, ${student.full_name}!${offlineTag}`, description: nfcInfo });
      } else if (holder.holder_type === 'teacher') {
        setClientMode('teacher');
        setSelectedTeacher({ id: holder.teacher_id, full_name: holder.teacher_name });
        setTeacherSearch(holder.teacher_name);
        setShowTeacherResults(false);
        const offlineTag = !isOnline ? ' (offline)' : '';
        toast({ title: `👨‍🏫 Profesor identificado${offlineTag}`, description: holder.teacher_name });
      }
    } catch (err: any) {
      setNfcError('Error al leer la tarjeta');
      toast({ variant: 'destructive', title: 'Error NFC', description: err.message });
    } finally {
      setNfcScanning(false);
      if (nfcPosInputRef.current) nfcPosInputRef.current.value = '';
    }
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
    
    if (clientMode === 'student' && selectedStudent) {
      // Cuenta libre (free_account = true o null) → siempre puede comprar (genera deuda si no tiene saldo)
      if (selectedStudent.free_account !== false) {
        return true;
      }
      // Con Recargas (free_account = false) → REQUIERE saldo suficiente, nunca genera deuda
      if (selectedStudent.balance >= getTotal()) {
        return true;
      }
      return false;
    }
    
    // Si es profesor (siempre cuenta libre, sin límites)
    if (clientMode === 'teacher' && selectedTeacher) {
      return true;
    }
    
    // Si es cliente genérico, permitir (el documento se elige en el modal de pago)
    if (clientMode === 'generic') {
      return true;
    }
    
    return false;
  };

  const handleCheckoutClick = () => {
    if (!canCheckout()) return;

    // Decidir qué modal mostrar según el tipo de cliente
    if (clientMode === 'student' || clientMode === 'teacher') {
      // Cuenta de crédito (estudiante o profesor): Modal simple de confirmación (sin métodos de pago)
      setShowCreditConfirmDialog(true);
    } else {
      // Cliente genérico: Modal de selección de método de pago
      setShowConfirmDialog(true);
    }
  };

  const handleConfirmCheckout = async (shouldPrint: boolean = false) => {
    // Procesar directamente (ya no hay segundo modal)
    await processCheckout();
    
    // La impresión ahora la maneja posPrinterService automáticamente
    // No necesitamos window.print() aquí ya que interfiere con el ticket HTML
      
    // Después de procesar, resetear automáticamente
    setShowConfirmDialog(false);
    setShowCreditConfirmDialog(false);
    resetClient();
  };

  /** Genera comprobante electrónico (boleta/factura) después de procesar la venta */
  const handleGenerateInvoice = async (clientData: InvoiceClientData) => {
    setInvoiceClientData(clientData);
    setShowInvoiceClientModal(false);
    setIsGeneratingInvoice(true);

    try {
      // Procesar la venta primero
      await processCheckout();

      // Luego generar el comprobante electrónico
      const result = await generarComprobante({
        school_id: userSchoolId || '',
        tipo: clientData.tipo === 'factura' ? 1 : 2,
        cliente: {
          nombre:     clientData.razon_social,
          tipo_doc:   clientData.doc_type === 'ruc' ? 6 : clientData.doc_type === 'dni' ? 1 : 0,
          numero_doc: clientData.doc_number !== '-' ? clientData.doc_number : undefined,
          email:      clientData.email,
        },
        monto_total: getTotal(),
      });

      if (result.success) {
        const pdfUrl = result.nubefact?.enlace_del_pdf as string | undefined;
        if (pdfUrl) setLastInvoicePdfUrl(pdfUrl);

        const serie = result.documento
          ? `${result.documento.serie}-${String(result.documento.numero).padStart(8, '0')}`
          : null;
        const waMsg = pdfUrl
          ? `https://wa.me/?text=${encodeURIComponent(
              `Hola, aquí tienes tu comprobante electrónico 🧾\n` +
              (serie ? `N° ${serie}\n` : '') +
              `PDF: ${pdfUrl}`
            )}`
          : null;

        toast({
          title: `✅ ${clientData.tipo === 'factura' ? 'Factura' : 'Boleta'} generada`,
          description: serie
            ? `${serie} — ${result.nubefact?.aceptada_por_sunat ? 'Aceptada por SUNAT ✔' : 'Generada'}`
            : 'Comprobante generado correctamente.',
        });

        // Abrir PDF en nueva pestaña
        if (pdfUrl) {
          window.open(pdfUrl, '_blank');
        }

        // Mostrar toast con enlace de WhatsApp
        if (waMsg) {
          setTimeout(() => {
            toast({
              title: '📲 Compartir comprobante',
              description: '¿Deseas enviar el PDF por WhatsApp al cliente?',
              action: (
                <a
                  href={waMsg}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-green-500 hover:bg-green-600 text-white"
                >
                  📱 WhatsApp
                </a>
              ) as any,
            });
          }, 800);
        }
      } else {
        toast({
          title: '⚠️ Venta procesada, error en comprobante',
          description: result.error || 'La venta se realizó pero no se pudo generar el comprobante electrónico.',
          variant: 'destructive',
        });
      }
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Error al procesar la venta.',
        variant: 'destructive',
      });
    } finally {
      setIsGeneratingInvoice(false);
      setShowConfirmDialog(false);
      setShowCreditConfirmDialog(false);
      setShowDocumentTypeDialog(false);
      resetClient();
    }
  };

  // ── Checkout OFFLINE: guardar en cola local ────────────────────
  const processOfflineCheckout = async () => {
    const total = getTotal();
    const tempTicket = `OFF-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const offlineTx: OfflineTransaction = {
      offline_id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      status: 'pending',
      client_mode: clientMode || 'generic',
      student_id: selectedStudent?.id,
      student_name: selectedStudent?.full_name,
      teacher_id: selectedTeacher?.id,
      teacher_name: selectedTeacher?.full_name,
      school_id: userSchoolId || undefined,
      cashier_id: user?.id || '',
      cashier_email: user?.email || '',
      total,
      cart: cart.map(item => ({
        product_id: item.product.id,
        product_name: item.product.name,
        quantity: item.quantity,
        unit_price: item.product.price,
        subtotal: item.product.price * item.quantity,
        barcode: item.product.barcode,
      })),
      payment_method: paymentMethod || undefined,
      payment_details: { source: 'pos', offline: true },
      balance_before: selectedStudent?.balance,
      should_use_balance: selectedStudent ? (selectedStudent.balance >= total) : false,
      is_free_account: selectedStudent?.free_account,
      has_configured_limit: !!(selectedStudent?.daily_limit || selectedStudent?.weekly_limit || selectedStudent?.monthly_limit),
      temp_ticket_code: tempTicket,
    };

    await addToOfflineQueue(offlineTx);
    const pending = await getPendingOfflineTransactions();
    setOfflinePendingCount(pending.length);

    toast({
      title: '📤 Venta guardada offline',
      description: `Ticket temporal: ${tempTicket}. Se sincronizará al volver internet.`,
      duration: 5000,
    });

    // Imprimir ticket aunque estemos offline
    const schoolIdForPrint = selectedStudent?.school_id || userSchoolId;
    if (schoolIdForPrint) {
      printPOSSale({
        ticketCode: tempTicket,
        clientName: selectedStudent?.full_name || selectedTeacher?.full_name || 'CLIENTE GENÉRICO',
        cart,
        total,
        paymentMethod: clientMode === 'student' ? 'credit' : clientMode === 'teacher' ? 'teacher' : 'cash',
        saleType: clientMode === 'teacher' ? 'teacher' : clientMode === 'student' ? 'credit' : 'general',
        schoolId: schoolIdForPrint,
      }).catch(err => console.error('Error en impresión offline:', err));
    }

    // Limpiar carrito
    setCart([]);
    setClientMode(null);
    setSelectedStudent(null);
    setSelectedTeacher(null);
    setStudentSearch('');
    setTeacherSearch('');
    setPaymentMethod(null);
  };

  const processCheckout = async () => {
    if (!user?.id) {
      toast({
        variant: 'destructive',
        title: 'Error de sesión',
        description: 'No se puede procesar la venta sin un usuario autenticado. Cierra sesión y vuelve a iniciar.',
      });
      return;
    }

    setIsProcessing(true);

    try {
      const total = getTotal();

      if (!isOnline) {
        await processOfflineCheckout();
        return;
      }

      let ticketCode = '';

      console.log('🔵 INICIANDO CHECKOUT', {
        clientMode,
        selectedStudent: selectedStudent?.full_name,
        selectedTeacher: selectedTeacher?.full_name,
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

      // Obtener school_id del cajero (para impresión)
      const { data: cashierProfile } = await supabase
        .from('profiles')
        .select('school_id')
        .eq('id', user?.id)
        .single();

      // Preparar datos del ticket
      const clientName = clientMode === 'student' ? selectedStudent?.full_name :
                        clientMode === 'teacher' ? selectedTeacher?.full_name :
                        'CLIENTE GENÉRICO';

      const ticketInfo: any = {
        code: ticketCode,
        clientName: clientName,
        clientType: clientMode,
        items: cart,
        total: total,
        paymentMethod: clientMode === 'generic' ? paymentMethod : 'credito',
        documentType: clientMode === 'generic' ? (requiresInvoice ? 'factura' : 'ticket') : 'ticket',
        timestamp: new Date(),
        cashierEmail: user?.email || 'No disponible',
      };

      // Si es estudiante
      if (clientMode === 'student' && selectedStudent) {
        // ══════════════════════════════════════════════════════════
        // 🔒 PASO 1: Leer datos FRESCOS del estudiante desde la BD
        //    (evita usar datos viejos si el admin aprobó una recarga)
        // ══════════════════════════════════════════════════════════
        const { data: freshStudent, error: freshErr } = await supabase
          .from('students')
          .select('balance, free_account, kiosk_disabled')
          .eq('id', selectedStudent.id)
          .single();

        if (freshErr) {
          console.error('Error leyendo saldo fresco:', freshErr);
          throw new Error('No se pudo verificar el saldo del estudiante. Intenta de nuevo.');
        }

        if (freshStudent?.kiosk_disabled) {
          throw new Error('Este alumno tiene el kiosco desactivado. Solo puede pedir almuerzos.');
        }

        const currentBalance = freshStudent?.balance ?? selectedStudent.balance;
        const isFreeAccount = freshStudent?.free_account !== false; // true o null = cuenta libre

        // ══════════════════════════════════════════════════════════
        // 🔒 PASO 2: Verificar topes de consumo
        // ══════════════════════════════════════════════════════════
        const { data: limitCheck, error: limitError } = await supabase
          .rpc('check_student_spending_limit', {
            p_student_id: selectedStudent.id,
            p_amount: total
          });

        if (limitError) {
          console.error('Error checking spending limit:', limitError);
          // 🔴 CRÍTICO: Si la función RPC falla, BLOQUEAR la venta
          // Antes se ignoraba y la venta pasaba sin verificar topes
          throw new Error(
            '⚠️ No se pudo verificar el tope de gasto.\n' +
            'Intente de nuevo. Si el problema persiste, contacte al administrador.'
          );
        } else if (limitCheck && limitCheck.length > 0 && !limitCheck[0].can_purchase) {
          const limitInfo = limitCheck[0];
          const limitTypeText = limitInfo.limit_type === 'daily' ? 'diario' : 
                               limitInfo.limit_type === 'weekly' ? 'semanal' : 'mensual';
          throw new Error(
            `⚠️ Límite ${limitTypeText} excedido.\n` +
            `Gastado: S/ ${limitInfo.current_spent?.toFixed(2) || '0.00'}\n` +
            `Límite: S/ ${limitInfo.limit_amount?.toFixed(2) || '0.00'}\n` +
            `No se puede procesar esta compra de S/ ${total.toFixed(2)}`
          );
        }

        // ══════════════════════════════════════════════════════════
        // 🔒 PASO 2B: Verificar TODOS los topes configurados (backup)
        //    La función RPC solo verifica el limit_type activo.
        //    Aquí verificamos daily + weekly + monthly si tienen valor > 0
        // ══════════════════════════════════════════════════════════
        const allLimitsToCheck = [
          { type: 'daily', limit: selectedStudent.daily_limit || 0, label: 'diario' },
          { type: 'weekly', limit: selectedStudent.weekly_limit || 0, label: 'semanal' },
          { type: 'monthly', limit: selectedStudent.monthly_limit || 0, label: 'mensual' },
        ].filter(l => l.limit > 0);

        if (allLimitsToCheck.length > 0) {
          const now = new Date();
          const todayStr = now.toISOString().split('T')[0];
          const startOfWeek = new Date(now);
          startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
          startOfWeek.setHours(0, 0, 0, 0);
          const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
          startOfMonth.setHours(0, 0, 0, 0);

          const { data: recentTx } = await supabase
            .from('transactions')
            .select('amount, metadata, created_at')
            .eq('student_id', selectedStudent.id)
            .eq('type', 'purchase')
            .gte('created_at', startOfMonth.toISOString())
            .eq('is_deleted', false)
            .neq('payment_status', 'cancelled');

          const kioscoTx = (recentTx || []).filter(t => !(t.metadata as any)?.lunch_order_id);

          for (const lim of allLimitsToCheck) {
            let spent = 0;
            if (lim.type === 'daily') {
              spent = kioscoTx.filter(t => t.created_at >= todayStr).reduce((s, t) => s + Math.abs(t.amount), 0);
            } else if (lim.type === 'weekly') {
              spent = kioscoTx.filter(t => t.created_at >= startOfWeek.toISOString()).reduce((s, t) => s + Math.abs(t.amount), 0);
            } else {
              spent = kioscoTx.reduce((s, t) => s + Math.abs(t.amount), 0);
            }

            if ((spent + total) > lim.limit) {
              throw new Error(
                `⚠️ Límite ${lim.label} excedido.\n` +
                `Gastado: S/ ${spent.toFixed(2)}\n` +
                `Límite: S/ ${lim.limit.toFixed(2)}\n` +
                `Restante: S/ ${Math.max(0, lim.limit - spent).toFixed(2)}\n` +
                `No se puede procesar esta compra de S/ ${total.toFixed(2)}`
              );
            }
          }
        }

        // ══════════════════════════════════════════════════════════
        // 💰 PASO 3: Decidir cómo cobrar — LÓGICA:
        //
        //   ¿Tiene saldo >= total?
        //     SÍ → Descontar del saldo (sea cuenta libre o no)
        //     NO → ¿Es cuenta libre O tiene tope configurado?
        //           SÍ → Crear deuda (pending)
        //           NO → Saldo insuficiente (bloquear)
        // ══════════════════════════════════════════════════════════
        const shouldUseBalance = currentBalance >= total;

        // Lógica de deuda: SOLO cuenta libre puede crear deuda.
        // Con Recargas (free_account=false) NUNCA crea deuda — solo gasta saldo.
        const canProceedAsDebt = isFreeAccount;

        if (!shouldUseBalance && !canProceedAsDebt) {
          if (!isFreeAccount) {
            throw new Error(
              `💳 Saldo insuficiente.\n` +
              `Saldo actual: S/ ${currentBalance.toFixed(2)}\n` +
              `Total compra: S/ ${total.toFixed(2)}\n` +
              `Recarga la cuenta para poder comprar.`
            );
          }
          throw new Error(
            `💳 Saldo insuficiente.\n` +
            `Saldo actual: S/ ${currentBalance.toFixed(2)}\n` +
            `Total compra: S/ ${total.toFixed(2)}\n` +
            `Faltan: S/ ${(total - currentBalance).toFixed(2)}`
          );
        }

        const newBalance = shouldUseBalance 
          ? currentBalance - total 
          : currentBalance; // Cuenta libre sin saldo → no tocar balance

        console.log('💳 PROCESANDO VENTA ESTUDIANTE', {
          studentId: selectedStudent.id,
          isFreeAccount,
          shouldUseBalance,
          total,
          saldoFresco: currentBalance,
          newBalance,
          modo: shouldUseBalance ? 'DESCONTAR SALDO' : 'DEUDA (cuenta libre)',
        });

        // ══════════════════════════════════════════════════════════
        // 📝 PASO 4: Crear transacción
        // ══════════════════════════════════════════════════════════
        const studentPaymentDetails: any = { source: 'pos' };
        if (paymentMethod) studentPaymentDetails.payment_method_detail = paymentMethod;
        if (transactionCode) studentPaymentDetails.operation_number = transactionCode;
        if (yapeNumber) studentPaymentDetails.yape_number = yapeNumber;
        if (plinNumber) studentPaymentDetails.plin_number = plinNumber;
        if (cashGiven) studentPaymentDetails.cash_given = parseFloat(cashGiven);
        if (paymentSplits.length > 0) studentPaymentDetails.payment_splits = paymentSplits;
        if (shouldUseBalance) studentPaymentDetails.paid_from_balance = true;

        // Calcular montos por método para pago mixto
        const isMixedPayment = paymentMethod === 'mixto' && paymentSplits.length > 0;
        const mixedCashAmount = isMixedPayment
          ? paymentSplits.filter(p => p.method === 'efectivo').reduce((s, p) => s + p.amount, 0)
          : 0;
        const mixedCardAmount = isMixedPayment
          ? paymentSplits.filter(p => p.method === 'tarjeta').reduce((s, p) => s + p.amount, 0)
          : 0;
        const mixedYapeAmount = isMixedPayment
          ? paymentSplits.filter(p => ['yape', 'yape_qr', 'yape_numero', 'plin', 'plin_qr', 'plin_numero', 'transferencia'].includes(p.method)).reduce((s, p) => s + p.amount, 0)
          : 0;

        // ══════════════════════════════════════════════════════════
        // 💰 PASO 4a: Si hay que descontar saldo, hacerlo PRIMERO (antes de la transacción)
        // ══════════════════════════════════════════════════════════
        let actualNewBalance = newBalance;
        if (shouldUseBalance) {
          const { data: updatedBalance, error: rpcError } = await supabase
            .rpc('adjust_student_balance', {
              p_student_id: selectedStudent.id,
              p_amount: -total,
            });

          if (rpcError) throw rpcError;
          actualNewBalance = updatedBalance ?? newBalance;
          console.log(`✅ Saldo descontado atómicamente: → S/ ${actualNewBalance.toFixed(2)}`);
        }

        // Descripción clara
        const txDescription = shouldUseBalance
          ? `Compra POS (Saldo) - S/ ${total.toFixed(2)}`
          : `Compra POS (Cuenta Libre - Deuda) - S/ ${total.toFixed(2)}`;

        const { data: transaction, error: transError} = await supabase
          .from('transactions')
          .insert({
            student_id: selectedStudent.id,
            school_id: selectedStudent.school_id,
            type: 'purchase',
            amount: -total,
            description: txDescription,
            balance_after: actualNewBalance,
            created_by: user?.id,
            ticket_code: ticketCode,
            payment_status: shouldUseBalance ? 'paid' : 'pending',
            payment_method: shouldUseBalance ? (paymentMethod || 'saldo') : null,
            metadata: studentPaymentDetails,
            paid_with_mixed: isMixedPayment,
            cash_amount: mixedCashAmount,
            card_amount: mixedCardAmount,
            yape_amount: mixedYapeAmount,
          })
          .select()
          .single();

        if (transError) {
          console.error('❌ Error creando transacción:', transError);
          if (shouldUseBalance) {
            // Revertir el descuento de saldo si la transacción falla
            await supabase.rpc('adjust_student_balance', {
              p_student_id: selectedStudent.id,
              p_amount: total,
            });
          }
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

        // Registrar en tabla SALES para módulo de Finanzas
        const salesItems = cart.map(item => ({
          product_id: item.product.id,
          product_name: item.product.name,
          barcode: item.product.barcode || null,
          quantity: item.quantity,
          price: item.product.price,
          subtotal: item.product.price * item.quantity,
        }));

        await supabase
          .from('sales')
          .insert({
            transaction_id: transaction.id,
            student_id: selectedStudent.id,
            school_id: selectedStudent.school_id,
            cashier_id: user?.id,
            total: total,
            subtotal: total,
            discount: 0,
            payment_method: shouldUseBalance ? (paymentMethod || 'saldo') : 'debt',
            cash_received: shouldUseBalance && (paymentMethod === 'efectivo' || !paymentMethod) ? (parseFloat(cashGiven) || total) : null,
            change_given: shouldUseBalance && (paymentMethod === 'efectivo' || !paymentMethod) ? ((parseFloat(cashGiven) || total) - total) : null,
            items: salesItems,
          });

        // Actualizar estado local con el saldo ya descontado
        if (shouldUseBalance) {
          setSelectedStudent({
            ...selectedStudent,
            balance: actualNewBalance
          });
        }

        ticketInfo.newBalance = actualNewBalance;
        ticketInfo.amountToDeduct = shouldUseBalance ? total : 0;
        ticketInfo.isFreeAccount = isFreeAccount;
        ticketInfo.paidFromBalance = shouldUseBalance;
      } else if (clientMode === 'teacher' && selectedTeacher) {
        // Profesor - Cuenta libre sin límites
        console.log('👨‍🏫 Procesando compra de profesor');

        // Crear transacción
        const { data: transaction, error: transError } = await supabase
          .from('transactions')
          .insert({
            student_id: null,
            teacher_id: selectedTeacher.id,
            school_id: selectedTeacher.school_1_id || null, // ✅ Corregido: la vista usa school_1_id (no school_id_1)
            type: 'purchase',
            amount: -total,
            description: `Compra Profesor: ${selectedTeacher.full_name} - ${cart.length} items`,
            balance_after: 0, // Profesores no tienen balance
            created_by: user?.id,
            ticket_code: ticketCode,
            payment_status: 'pending', // 🔥 CRÉDITO: Iniciar como pending
            payment_method: null, // Sin método de pago inicial
          })
          .select()
          .single();

        if (transError) {
          console.error('❌ Error creando transacción de profesor:', transError);
          throw transError;
        }

        console.log('✅ Transacción creada:', transaction.id);

        // Insertar items de la transacción
        const items = cart.map(item => ({
          transaction_id: transaction.id,
          product_id: item.product.id,
          product_name: item.product.name,
          quantity: item.quantity,
          unit_price: item.product.price,
          subtotal: item.product.price * item.quantity,
        }));

        await supabase.from('transaction_items').insert(items);

        // Registrar en tabla SALES para módulo de Finanzas
        const salesItems = cart.map(item => ({
          product_id: item.product.id,
          product_name: item.product.name,
          barcode: item.product.barcode || null,
          quantity: item.quantity,
          price: item.product.price,
          subtotal: item.product.price * item.quantity,
        }));

        await supabase
          .from('sales')
          .insert({
            transaction_id: transaction.id,            // ✅ UUID real de la transacción
            teacher_id: selectedTeacher.id,
            school_id: selectedTeacher.school_1_id || null,
            cashier_id: user?.id,
            total: total,
            subtotal: total,
            discount: 0,
            payment_method: 'teacher_account',
            cash_received: null,
            change_given: null,
            items: salesItems,
          });

        ticketInfo.isFreeAccount = true;
        ticketInfo.teacherName = selectedTeacher.full_name;
      } else {
        // Cliente genérico - Solo registrar la venta (PAGADA)
        const genericPaymentDetails: any = { source: 'pos' };
        if (transactionCode) genericPaymentDetails.operation_number = transactionCode;
        if (yapeNumber) genericPaymentDetails.yape_number = yapeNumber;
        if (plinNumber) genericPaymentDetails.plin_number = plinNumber;
        if (cashGiven) genericPaymentDetails.cash_given = parseFloat(cashGiven);
        if (paymentSplits.length > 0) genericPaymentDetails.payment_splits = paymentSplits;

        // ✅ Calcular montos por método para pago mixto
        const isMixedGeneric = paymentMethod === 'mixto' && paymentSplits.length > 0;
        const genericMixedCash = isMixedGeneric
          ? paymentSplits.filter(p => p.method === 'efectivo').reduce((s, p) => s + p.amount, 0)
          : 0;
        const genericMixedCard = isMixedGeneric
          ? paymentSplits.filter(p => p.method === 'tarjeta').reduce((s, p) => s + p.amount, 0)
          : 0;
        const genericMixedYape = isMixedGeneric
          ? paymentSplits.filter(p => ['yape', 'yape_qr', 'yape_numero', 'plin', 'plin_qr', 'plin_numero', 'transferencia'].includes(p.method)).reduce((s, p) => s + p.amount, 0)
          : 0;

        const { data: transaction, error: transError } = await supabase
          .from('transactions')
          .insert({
            student_id: null,
            school_id: userSchoolId, // ✅ Agregar school_id del cajero
            type: 'purchase',
            amount: -total,
            description: `Compra Cliente Genérico - ${cart.length} items`,
            balance_after: 0,
            created_by: user?.id,
            ticket_code: ticketCode,
            payment_status: 'paid', // 🔥 Cliente genérico PAGA en el momento
            payment_method: paymentMethod || 'efectivo', // Método de pago real
            metadata: genericPaymentDetails,
            // ✅ Columnas para pago mixto (usadas por calculate_daily_totals)
            paid_with_mixed: isMixedGeneric,
            cash_amount: genericMixedCash,
            card_amount: genericMixedCard,
            yape_amount: genericMixedYape,
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

        // **NUEVO: Registrar en tabla SALES para módulo de Finanzas**
        const salesItems = cart.map(item => ({
          product_id: item.product.id,
          product_name: item.product.name,
          barcode: item.product.barcode || null,
          quantity: item.quantity,
          price: item.product.price,
          subtotal: item.product.price * item.quantity,
        }));

        await supabase
          .from('sales')
          .insert({
            transaction_id: transaction.id,            // ✅ UUID real de la transacción
            student_id: null,
            school_id: cashierProfile?.school_id || null,
            cashier_id: user?.id,
            total: total,
            subtotal: total,
            discount: 0,
            payment_method: paymentMethod || 'efectivo',
            cash_received: (paymentMethod === 'efectivo' || !paymentMethod) ? (parseFloat(cashGiven) || total) : null,
            change_given: (paymentMethod === 'efectivo' || !paymentMethod) ? ((parseFloat(cashGiven) || total) - total) : null,
            items: salesItems,
          });
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
      emitSync(['transactions', 'balances', 'dashboard', 'debtors']);

      // 🖨️ IMPRIMIR AUTOMÁTICAMENTE según configuración
      const schoolIdForPrint = selectedStudent?.school_id || selectedTeacher?.school_1_id || cashierProfile?.school_id;
      
      if (schoolIdForPrint) {
        // Determinar tipo de venta y método de pago basado en clientMode
        let saleType: 'general' | 'credit' | 'teacher';
        let paymentMethodForPrint: 'cash' | 'card' | 'credit' | 'teacher';
        
        if (clientMode === 'teacher') {
          saleType = 'teacher';
          paymentMethodForPrint = 'teacher';
        } else if (clientMode === 'student') {
          saleType = 'credit';
          paymentMethodForPrint = 'credit';
        } else {
          saleType = 'general';
          paymentMethodForPrint = (paymentMethod === 'card' ? 'card' : 'cash') as 'cash' | 'card';
        }
        
        printPOSSale({
          ticketCode,
          clientName: ticketInfo.clientName,
          cart,
          total,
          paymentMethod: paymentMethodForPrint,
          saleType: saleType,
          schoolId: schoolIdForPrint
        }).catch(err => console.error('Error en impresión:', err));
      }

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

  // ⚠️ NO declarar total como constante - calcularlo dinámicamente con getTotal()
  
  // Verificar saldo insuficiente en useEffect
  useEffect(() => {
    if (!selectedStudent) { setInsufficientBalance(false); return; }
    const isFree = selectedStudent.free_account !== false; // null o true = cuenta libre
    const hasLimit =
      (selectedStudent.daily_limit && selectedStudent.daily_limit > 0) ||
      (selectedStudent.weekly_limit && selectedStudent.weekly_limit > 0) ||
      (selectedStudent.monthly_limit && selectedStudent.monthly_limit > 0);
    // Solo mostrar error si: NO es cuenta libre, NO tiene tope, y saldo no alcanza
    const insufficient = !isFree && !hasLimit && (selectedStudent.balance < getTotal());
    setInsufficientBalance(!!insufficient);
  }, [selectedStudent, cart]); // ✅ Dependencia en 'cart' en lugar de 'total'

  // ─── GUARD: Bloquear POS si no hay caja abierta ─────────────────
  const needsCashDeclaration =
    !cashGuardLoading &&
    userSchoolId &&
    !posOpenRegister &&
    !posHasUnclosed;

  if (maintenance.blocked) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-6">
          <div className="w-20 h-20 mx-auto bg-red-100 rounded-full flex items-center justify-center">
            <AlertCircle className="h-10 w-10 text-red-600" />
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

  return (
    <>
    {/* Modal bloqueante de apertura de caja */}
    {userSchoolId && !cashGuardLoading && (!posOpenRegister || posHasUnclosed) && (
      <CashOpeningModal
        schoolId={userSchoolId}
        lastClosedAmount={posLastClosedAmount}
        hasUnclosedPrevious={posHasUnclosed}
        previousUnclosed={posPreviousUnclosed}
        onOpened={() => {
          setPosHasUnclosed(false);
          setPosPreviousUnclosed(null);
          // Recargar estado de caja
          supabase
            .from('cash_registers')
            .select('*')
            .eq('school_id', userSchoolId)
            .eq('status', 'open')
            .order('opened_at', { ascending: false })
            .limit(1)
            .maybeSingle()
            .then(({ data }) => setPosOpenRegister(data));
        }}
      />
    )}
    <div className="h-screen flex flex-col bg-gray-100">
      {/* Header */}
      <header className="bg-slate-900 text-white px-3 sm:px-4 lg:px-6 py-2 sm:py-3 flex justify-between items-center shadow-lg print:hidden">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="w-8 h-8 sm:w-10 sm:h-10 bg-emerald-500 rounded-lg flex items-center justify-center">
            <ShoppingCart className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
          <div>
            <h1 className="font-bold text-base sm:text-lg">PUNTO DE VENTA</h1>
            <p className="text-xs text-gray-400 hidden sm:block">{user?.email}</p>
          </div>
        </div>
        {/* Botones de navegación - Updated */}
        <div className="flex items-center gap-1 sm:gap-2">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleBackToDashboard}
            className="text-white hover:bg-slate-800 px-2 sm:px-4"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 sm:h-5 sm:w-5 sm:mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            <span className="hidden sm:inline">Volver al Panel</span>
          </Button>
          <div className="text-white">
            <UserProfileMenu
              userEmail={user?.email || ''}
              userName={full_name || undefined}
              onLogout={handleLogout}
            />
          </div>
        </div>
      </header>

      {/* ── Banner de estado de conexión ─────────────────────────── */}
      {(!isOnline || offlinePendingCount > 0 || isSyncing) && (
        <div className={cn(
          "px-3 py-2 flex items-center justify-between text-sm print:hidden",
          !isOnline 
            ? "bg-red-600 text-white" 
            : isSyncing 
              ? "bg-blue-600 text-white"
              : "bg-amber-500 text-white"
        )}>
          <div className="flex items-center gap-2">
            {!isOnline ? (
              <>
                <WifiOff className="h-4 w-4 animate-pulse" />
                <span className="font-medium">
                  SIN CONEXIÓN — Las ventas se guardan localmente
                  {offlineDataReady && ' (datos offline listos ✓)'}
                </span>
              </>
            ) : isSyncing ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span className="font-medium">Sincronizando ventas offline...</span>
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                <span className="font-medium">{offlinePendingCount} venta(s) pendiente(s) de sincronizar</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isOnline && offlinePendingCount > 0 && !isSyncing && (
              <button
                onClick={handleManualSync}
                className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-md text-xs font-semibold transition-colors"
              >
                Sincronizar ahora
              </button>
            )}
            {isOnline && (
              <Wifi className="h-4 w-4 opacity-70" />
            )}
          </div>
        </div>
      )}

      {/* Modal de Selección de Cliente (Solo si no hay cliente) */}
      {!clientMode && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 sm:mb-6 gap-3">
              <h2 className="text-xl sm:text-2xl font-bold">Seleccionar Tipo de Cliente</h2>
              <div className="flex gap-2 w-full sm:w-auto">
                <Button
                  variant="outline"
                  onClick={handleBackToDashboard}
                  className="text-blue-600 hover:bg-blue-50 border-blue-300 flex-1 sm:flex-none text-sm sm:text-base"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 sm:h-5 sm:w-5 mr-1 sm:mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                  <span className="hidden sm:inline">Volver al Panel</span>
                  <span className="sm:hidden">Panel</span>
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleLogout}
                  className="text-red-600 hover:bg-red-50 flex-1 sm:flex-none text-sm sm:text-base"
                >
                  <LogOut className="h-4 w-4 sm:h-5 sm:w-5 mr-1 sm:mr-2" />
                  <span className="hidden sm:inline">Cerrar Sesión</span>
                  <span className="sm:hidden">Salir</span>
                </Button>
              </div>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              {/* Cliente Genérico */}
              <button
                onClick={selectGenericClient}
                className="p-4 sm:p-8 border-2 border-gray-300 rounded-xl hover:border-emerald-500 hover:bg-emerald-50 transition-all group"
              >
                <Users className="h-10 w-10 sm:h-16 sm:w-16 mx-auto mb-2 sm:mb-4 text-gray-400 group-hover:text-emerald-600" />
                <h3 className="text-base sm:text-xl font-bold mb-1 sm:mb-2">Cliente Genérico</h3>
                <p className="text-xs sm:text-sm text-gray-600">Venta al contado (Efectivo/Yape/Tarjeta)</p>
              </button>

              {/* Crédito */}
              <button
                onClick={selectStudentMode}
                className="p-4 sm:p-8 border-2 border-gray-300 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-all group"
              >
                <User className="h-10 w-10 sm:h-16 sm:w-16 mx-auto mb-2 sm:mb-4 text-gray-400 group-hover:text-blue-600" />
                <h3 className="text-base sm:text-xl font-bold mb-1 sm:mb-2">Crédito</h3>
                <p className="text-xs sm:text-sm text-gray-600">Compra a crédito (Descuenta de saldo)</p>
              </button>

              {/* Profesor */}
              <button
                onClick={selectTeacherMode}
                className="p-4 sm:p-8 border-2 border-gray-300 rounded-xl hover:border-purple-500 hover:bg-purple-50 transition-all group"
              >
                <UtensilsCrossed className="h-10 w-10 sm:h-16 sm:w-16 mx-auto mb-2 sm:mb-4 text-gray-400 group-hover:text-purple-600" />
                <h3 className="text-base sm:text-xl font-bold mb-1 sm:mb-2">Profesor</h3>
                <p className="text-xs sm:text-sm text-gray-600">Cuenta libre (Sin límites)</p>
              </button>
            </div>

            {/* ── Sección NFC ── */}
            <div className="mt-4 pt-4 border-t border-gray-200">
              <div
                className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-all cursor-pointer ${
                  nfcScanning
                    ? 'border-blue-400 bg-blue-50'
                    : nfcError
                    ? 'border-red-300 bg-red-50'
                    : 'border-dashed border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50'
                }`}
                onClick={() => { setNfcError(null); nfcPosInputRef.current?.focus(); }}
              >
                <div className={`h-12 w-12 rounded-full flex items-center justify-center flex-shrink-0 ${nfcScanning ? 'bg-blue-200' : nfcError ? 'bg-red-100' : 'bg-gray-200'}`}>
                  {nfcScanning ? (
                    <Loader2 className="h-6 w-6 text-blue-600 animate-spin" />
                  ) : nfcError ? (
                    <AlertCircle className="h-6 w-6 text-red-500" />
                  ) : (
                    <Smartphone className="h-6 w-6 text-gray-500" />
                  )}
                </div>
                <div>
                  <p className={`font-bold text-sm ${nfcScanning ? 'text-blue-700' : nfcError ? 'text-red-700' : 'text-gray-600'}`}>
                    {nfcScanning
                      ? 'Leyendo tarjeta...'
                      : nfcError
                      ? nfcError
                      : '📡 Pasar tarjeta NFC'}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {nfcScanning
                      ? 'Acerca la tarjeta al lector'
                      : 'Acerca la tarjeta al lector USB para identificar al alumno o profesor automáticamente'}
                  </p>
                </div>
              </div>
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
                  
                  const isKioskDisabled = student.kiosk_disabled;
                  return (
                    <button
                      key={student.id}
                      onClick={() => canPurchase && selectStudent(student)}
                      disabled={!canPurchase}
                      className={cn(
                        "w-full p-4 border-2 rounded-xl text-left flex items-center gap-4 transition-all",
                        canPurchase
                          ? "hover:bg-emerald-50 border-gray-200 hover:border-emerald-500 cursor-pointer"
                          : isKioskDisabled
                          ? "bg-orange-50 border-orange-200 cursor-not-allowed"
                          : "bg-gray-50 border-red-200 cursor-not-allowed opacity-70"
                      )}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className={cn("font-bold text-lg", !canPurchase && "text-gray-600")}>
                            {student.full_name}
                          </p>
                          {isKioskDisabled && (
                            <span className="text-[10px] bg-orange-100 text-orange-700 border border-orange-300 px-1.5 py-0.5 rounded-full font-semibold">
                              Sin cuenta kiosco
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500">
                          {student.grade} - {student.section}
                        </p>
                        {!canPurchase && accountStatus?.reason && (
                          <p className={cn("text-xs mt-1 font-medium", isKioskDisabled ? "text-orange-600" : "text-red-600")}>
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

      {/* Modal de Búsqueda de Profesor */}
      {clientMode === 'teacher' && !selectedTeacher && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold">Buscar Profesor</h2>
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
                placeholder="Escribe el nombre del profesor..."
                value={teacherSearch}
                onChange={(e) => setTeacherSearch(e.target.value)}
                className="pl-12 text-lg h-14 border-2"
                autoFocus
              />
            </div>

            {showTeacherResults && teachers.length > 0 && (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {teachers.map((teacher) => (
                  <button
                    key={teacher.id}
                    onClick={() => selectTeacher(teacher)}
                    className="w-full p-4 border-2 rounded-xl text-left flex items-center gap-4 transition-all hover:bg-purple-50 border-gray-200 hover:border-purple-500 cursor-pointer"
                  >
                    <div className="flex-1">
                      <p className="font-bold text-lg">
                        {teacher.full_name}
                      </p>
                      <p className="text-sm text-gray-500">
                        {teacher.area && `${teacher.area.charAt(0).toUpperCase() + teacher.area.slice(1)}`}
                        {teacher.school_1_name && ` • ${teacher.school_1_name}`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500 mb-1">Estado</p>
                      <p className="text-sm font-bold text-purple-600">
                        ✅ Cuenta Libre
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {teacherSearch.length >= 2 && teachers.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <User className="h-16 w-16 mx-auto mb-3 opacity-30" />
                <p>No se encontraron profesores</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Layout de 3 Zonas (Solo si hay cliente seleccionado) */}
      {(clientMode === 'generic' || (clientMode === 'student' && selectedStudent) || (clientMode === 'teacher' && selectedTeacher)) && (
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden print:hidden h-[calc(100vh-64px)]">
          
          {/* ZONA 1: CATEGORÍAS - Compacto en móvil */}
          <aside className="w-full lg:w-[15%] bg-slate-800 p-1 sm:p-2 lg:p-4 flex lg:flex-col gap-1 sm:gap-2 overflow-x-auto lg:overflow-y-auto scrollbar-thin flex-shrink-0">
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
                    "flex flex-col items-center justify-center gap-0.5 py-1.5 px-2 sm:py-4 sm:px-4 lg:py-8 lg:px-6 rounded-md sm:rounded-xl font-semibold transition-all cursor-move select-none touch-manipulation shrink-0",
                    "hover:bg-slate-700 active:scale-95",
                    isActive 
                      ? "bg-emerald-500 text-white shadow-lg" 
                      : "bg-slate-700 text-gray-300"
                  )}
                  style={{ minHeight: '50px' }}
                >
                  <Icon className="h-4 w-4 sm:h-6 sm:w-6 lg:h-8 lg:w-8" />
                  <span className="text-[9px] sm:text-xs lg:text-sm whitespace-nowrap">{cat.label}</span>
                </button>
              );
            })}
          </aside>

          {/* ZONA 2: PRODUCTOS - Más compacto en móvil */}
          <main className="w-full lg:w-[55%] bg-white flex flex-col overflow-hidden">
            <div className="p-1.5 sm:p-2 border-b bg-gray-50 flex-shrink-0">
              <div className="relative">
                <Search className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 h-3 w-3 sm:h-4 sm:w-4 text-gray-400" />
                <Input
                  ref={searchInputRef}
                  placeholder="Buscar productos..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="pl-7 sm:pl-9 h-7 sm:h-10 lg:h-12 text-xs sm:text-base border-2"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-1 sm:p-2">
              {filteredProducts.length === 0 && combos.length === 0 && selectedCategory !== 'combos' ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                  <Search className="h-8 w-8 sm:h-16 sm:w-16 mb-2 sm:mb-4 opacity-30" />
                  <p className="text-xs sm:text-lg font-semibold">No hay productos disponibles</p>
                </div>
              ) : selectedCategory === 'combos' ? (
                <div className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-3 gap-1 sm:gap-2">
                  {combos.map((combo) => (
                    <button
                      key={combo.id}
                      onClick={() => addComboToCart(combo)}
                      className="group bg-gradient-to-br from-purple-50 to-pink-50 border-2 border-purple-200 rounded-md sm:rounded-xl overflow-hidden transition-all hover:shadow-xl hover:border-purple-400 active:scale-95 p-1 sm:p-3 min-h-[65px] sm:min-h-[120px] flex flex-col justify-center"
                    >
                      <div className="flex items-center gap-0.5 sm:gap-2 mb-0.5 sm:mb-1">
                        <Gift className="h-2.5 w-2.5 sm:h-4 sm:w-4 text-purple-600 flex-shrink-0" />
                        <h3 className="font-bold text-[8px] sm:text-base line-clamp-2 leading-tight text-left">
                          {combo.name}
                        </h3>
                      </div>
                      <p className="text-[10px] sm:text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-600 to-pink-600">
                        S/ {combo.combo_price.toFixed(2)}
                      </p>
                      <p className="text-[8px] sm:text-xs text-gray-500 mt-0.5">
                        {combo.combo_items?.length || 0} productos
                      </p>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-3 gap-1 sm:gap-2">{filteredProducts.map((product) => (
                    <button
                      key={product.id}
                      onClick={() => addToCart(product)}
                      className="group bg-white border-2 rounded-md sm:rounded-xl overflow-hidden transition-all hover:shadow-xl hover:border-emerald-500 active:scale-95 p-1 sm:p-3 min-h-[65px] sm:min-h-[130px] flex flex-col justify-between"
                    >
                      <div>
                        <h3 className="font-bold text-[8px] sm:text-base mb-0.5 sm:mb-1 line-clamp-2 leading-tight">
                          {product.name}
                        </h3>
                        {product.description && (
                          <p className="text-[7px] sm:text-xs text-gray-500 mb-0.5 sm:mb-2 line-clamp-1">
                            {product.description}
                          </p>
                        )}
                      </div>
                      <p className="text-[9px] sm:text-base font-semibold text-emerald-600">
                        S/ {product.price.toFixed(2)}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </main>

          {/* ZONA 3: CARRITO - Más compacto y visible en móvil */}
          <aside className="w-full lg:w-[30%] bg-slate-50 flex flex-col border-t-2 lg:border-t-0 lg:border-l-2 border-slate-200 max-h-[45vh] lg:max-h-none">
            {/* Info del Cliente - Compacta en móvil */}
            <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 text-white p-2 sm:p-3">
              {clientMode === 'generic' ? (
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-xs sm:text-base text-white">CLIENTE GENÉRICO</h3>
                    <button
                      onClick={resetClient}
                      className="hover:bg-emerald-700 px-2 py-1 rounded-lg transition-colors font-semibold text-[10px] sm:text-xs text-white border border-emerald-400"
                    >
                      CAMBIAR
                    </button>
                  </div>
                </div>
              ) : clientMode === 'student' && selectedStudent ? (
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    {/* Foto del estudiante - más pequeña en móvil */}
                    {selectedStudent.photo_url && (
                      <div 
                        className="relative w-12 h-12 sm:w-16 sm:h-16 flex-shrink-0 cursor-pointer group"
                        onClick={() => setShowPhotoModal(true)}
                      >
                        <img 
                          src={selectedStudent.photo_url} 
                          alt={selectedStudent.full_name}
                          className="w-full h-full object-cover rounded-lg border-2 border-white shadow-lg"
                        />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                          <Maximize2 className="h-4 w-4 text-white" />
                        </div>
                      </div>
                    )}
                    
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-xs sm:text-lg text-white leading-tight truncate">{selectedStudent.full_name}</h3>
                      <p className="text-[10px] sm:text-xs text-emerald-100 font-medium">{selectedStudent.grade} - {selectedStudent.section}</p>
                      {selectedStudent.free_account !== false && (
                        <div className="mt-1">
                          <span className="text-[8px] sm:text-xs bg-green-400 text-green-900 px-2 py-0.5 rounded-full font-bold shadow-md">
                            ✓ CUENTA LIBRE
                          </span>
                        </div>
                      )}
                    </div>
                    
                    {/* Botón CAMBIAR más pequeño en móvil */}
                    <button
                      onClick={resetClient}
                      className="w-10 h-10 sm:w-14 sm:h-14 rounded-full bg-white/20 hover:bg-white/30 border-2 border-white/40 flex items-center justify-center transition-all hover:scale-105 shadow-lg backdrop-blur-sm shrink-0"
                      title="Cambiar estudiante"
                    >
                      <div className="text-center">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 sm:h-5 sm:w-5 text-white mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                        </svg>
                        <span className="text-[7px] sm:text-[9px] font-bold text-white uppercase">Cambiar</span>
                      </div>
                    </button>
                  </div>
                </div>
              ) : clientMode === 'teacher' && selectedTeacher ? (
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-xs sm:text-lg text-white leading-tight truncate">{selectedTeacher.full_name}</h3>
                      <p className="text-[10px] sm:text-xs text-purple-100 font-medium">
                        {selectedTeacher.area && `${selectedTeacher.area.charAt(0).toUpperCase() + selectedTeacher.area.slice(1)}`}
                      </p>
                      <div className="mt-1">
                        <span className="text-[8px] sm:text-xs bg-purple-400 text-purple-900 px-2 py-0.5 rounded-full font-bold shadow-md">
                          ✓ CUENTA LIBRE
                        </span>
                      </div>
                    </div>
                    
                    {/* Botón CAMBIAR más pequeño en móvil */}
                    <button
                      onClick={resetClient}
                      className="w-10 h-10 sm:w-14 sm:h-14 rounded-full bg-white/20 hover:bg-white/30 border-2 border-white/40 flex items-center justify-center transition-all hover:scale-105 shadow-lg backdrop-blur-sm shrink-0"
                      title="Cambiar profesor"
                    >
                      <div className="text-center">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 sm:h-5 sm:w-5 text-white mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                        </svg>
                        <span className="text-[7px] sm:text-[9px] font-bold text-white uppercase">Cambiar</span>
                      </div>
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            {/* ═══ Panel de Topes de Gasto ═══ */}
            {clientMode === 'student' && selectedStudent && studentLimitsDetail.length > 0 && (
              <div className="bg-gradient-to-r from-slate-50 to-blue-50 border-b border-slate-200 px-2 py-1.5 sm:px-3 sm:py-2">
                <p className="text-[8px] sm:text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                  📊 Topes de Gasto
                </p>
                <div className="space-y-1">
                  {studentLimitsDetail.map((lim) => {
                    const pct = lim.limit > 0 ? Math.min(100, (lim.spent / lim.limit) * 100) : 0;
                    const isExceeded = lim.remaining <= 0;
                    const isWarning = pct >= 70 && !isExceeded;
                    const barColor = isExceeded ? 'bg-red-500' : isWarning ? 'bg-orange-400' : 'bg-emerald-500';
                    const textColor = isExceeded ? 'text-red-700' : isWarning ? 'text-orange-700' : 'text-slate-700';

                    return (
                      <div key={lim.type} className="flex items-center gap-1.5 sm:gap-2">
                        {/* Etiqueta */}
                        <div className="w-[52px] sm:w-[68px] flex-shrink-0">
                          <span className={`text-[8px] sm:text-[10px] font-bold ${lim.isActive ? 'text-blue-700' : 'text-slate-400'}`}>
                            {lim.isActive ? '🔒 ' : ''}{lim.label}
                          </span>
                        </div>
                        {/* Barra de progreso */}
                        <div className="flex-1 h-2.5 sm:h-3 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${barColor}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        {/* Info de restante */}
                        <div className="w-[85px] sm:w-[110px] text-right flex-shrink-0">
                          <span className={`text-[8px] sm:text-[10px] font-bold ${textColor}`}>
                            {isExceeded ? '🚫 Agotado' : `S/ ${lim.remaining.toFixed(2)}`}
                          </span>
                          <span className="text-[7px] sm:text-[9px] text-slate-400 ml-0.5">
                            / {lim.limit.toFixed(0)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* Info de renovación */}
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  {studentLimitsDetail.map((lim) => (
                    <span key={lim.type} className="text-[7px] sm:text-[8px] text-slate-400">
                      🔄 {lim.label}: {lim.renewalText}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Saldo del alumno - siempre visible */}
            {clientMode === 'student' && selectedStudent && (() => {
              // Si tiene topes cargados, mostrar el disponible del tope más restrictivo
              const hasLimits = studentLimitsDetail.length > 0;
              if (hasLimits) {
                // Tomar el tope con menos disponible (el más restrictivo)
                const minRemaining = Math.min(...studentLimitsDetail.map(l => l.remaining));
                const limitingLim = studentLimitsDetail.find(l => l.remaining === minRemaining)!;
                const isExceeded = minRemaining <= 0;
                const isWarning = minRemaining < getTotal();
                return (
                  <div className={`border-b px-2 py-1 sm:px-3 sm:py-1.5 flex items-center justify-between ${
                    isExceeded ? 'bg-red-50 border-red-200' : isWarning ? 'bg-orange-50 border-orange-200' : 'bg-white border-slate-200'
                  }`}>
                    <span className={`text-[9px] sm:text-xs font-medium ${
                      isExceeded ? 'text-red-600' : isWarning ? 'text-orange-600' : 'text-slate-500'
                    }`}>
                      🔒 Disponible ({limitingLim.label}):
                    </span>
                    <span className={`text-[10px] sm:text-sm font-bold ${
                      isExceeded ? 'text-red-700' : isWarning ? 'text-orange-700' : 'text-emerald-600'
                    }`}>
                      S/ {Math.max(0, minRemaining).toFixed(2)}
                    </span>
                  </div>
                );
              }
              // Sin topes: mostrar saldo normal
              return (
                <div className="bg-white border-b border-slate-200 px-2 py-1 sm:px-3 sm:py-1.5 flex items-center justify-between">
                  <span className="text-[9px] sm:text-xs text-slate-500 font-medium">💰 Saldo disponible:</span>
                  <span className={`text-[10px] sm:text-sm font-bold ${selectedStudent.balance > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                    S/ {(selectedStudent.balance || 0).toFixed(2)}
                  </span>
                </div>
              );
            })()}

            {/* Items del Carrito - Más compacto en móvil */}
            <div className="flex-1 overflow-y-auto p-1.5 sm:p-2">
              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                  <ShoppingCart className="h-8 w-8 sm:h-16 sm:w-16 mb-2 opacity-30" />
                  <p className="font-semibold text-xs sm:text-sm">Carrito vacío</p>
                </div>
              ) : (
                <div className="space-y-1 sm:space-y-2">
                  {cart.map((item) => (
                    <div
                      key={item.product.id}
                      className="bg-white border-2 border-gray-200 rounded-lg p-1 sm:p-2"
                    >
                      <div className="flex justify-between items-start mb-0.5 sm:mb-1">
                        <p className="font-bold text-[9px] sm:text-sm flex-1 leading-tight">{item.product.name}</p>
                        <button
                          onClick={() => removeFromCart(item.product.id)}
                          className="text-red-600 hover:bg-red-50 p-0.5 sm:p-1 rounded-full shrink-0"
                          title="Eliminar del carrito"
                        >
                          <Trash2 className="h-3 w-3 sm:h-4 sm:w-4" />
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-0.5 sm:gap-1 bg-gray-100 rounded-lg p-0.5">
                          <button
                            onClick={() => updateQuantity(item.product.id, -1)}
                            className="w-5 h-5 sm:w-8 sm:h-8 flex items-center justify-center bg-white rounded-md shadow-sm hover:bg-red-50 hover:text-red-600 transition-colors"
                          >
                            <Minus className="h-2.5 w-2.5 sm:h-4 sm:w-4" />
                          </button>
                          <span className="w-7 sm:w-10 text-center font-bold text-[10px] sm:text-base">{item.quantity}</span>
                          <button
                            onClick={() => updateQuantity(item.product.id, 1)}
                            className="w-5 h-5 sm:w-8 sm:h-8 flex items-center justify-center bg-white rounded-md shadow-sm hover:bg-emerald-50 hover:text-emerald-600 transition-colors"
                          >
                            <Plus className="h-2.5 w-2.5 sm:h-4 sm:w-4" />
                          </button>
                        </div>
                        <p className="text-[10px] sm:text-sm font-bold text-emerald-600">
                          S/ {(item.product.price * item.quantity).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Total y Botón */}
            <div className="bg-white border-t-2 border-slate-300 p-1.5 sm:p-3 lg:p-4 space-y-1.5 sm:space-y-3">
              {cart.length > 0 ? (
                <>
                  <div className="bg-slate-900 text-white rounded-xl p-2 sm:p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-[9px] sm:text-sm mb-0.5 sm:mb-1 uppercase font-bold text-gray-400">Total Compra</p>
                        <p className="text-lg sm:text-3xl lg:text-4xl font-black">S/ {getTotal().toFixed(2)}</p>
                      </div>
                    </div>
                    <p className="text-[9px] sm:text-xs text-gray-400 mt-1 sm:mt-2">{cart.length} productos</p>
                  </div>

                  {selectedStudent && insufficientBalance && (
                    <div className="bg-red-50 border-2 border-red-300 rounded-xl p-1.5 sm:p-3 flex items-center gap-1.5 sm:gap-2">
                      <AlertCircle className="h-3 w-3 sm:h-5 sm:w-5 text-red-600 flex-shrink-0" />
                      <div>
                        <p className="font-bold text-red-800 text-[9px] sm:text-sm">Saldo Insuficiente</p>
                        <p className="text-[8px] sm:text-xs text-red-600">
                          Falta: S/ {(getTotal() - selectedStudent.balance).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Alumno con tope configurado y sin saldo suficiente → compra autorizada */}
                  {selectedStudent &&
                    !insufficientBalance &&
                    selectedStudent.free_account === false &&
                    selectedStudent.balance < getTotal() &&
                    ((selectedStudent.daily_limit && selectedStudent.daily_limit > 0) ||
                     (selectedStudent.weekly_limit && selectedStudent.weekly_limit > 0) ||
                     (selectedStudent.monthly_limit && selectedStudent.monthly_limit > 0)) && (
                    <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl p-1.5 sm:p-3 flex items-center gap-1.5 sm:gap-2">
                      <Check className="h-3 w-3 sm:h-5 sm:w-5 text-yellow-600 flex-shrink-0" />
                      <div>
                        <p className="font-bold text-yellow-800 text-[9px] sm:text-sm">✓ Compra dentro del tope</p>
                        <p className="text-[8px] sm:text-xs text-yellow-700">
                          Se registrará como deuda pendiente
                        </p>
                      </div>
                    </div>
                  )}
                  
                  {selectedStudent && selectedStudent.free_account !== false && (
                    <div className={`border-2 rounded-xl p-1.5 sm:p-3 flex items-center gap-1.5 sm:gap-2 ${
                      selectedStudent.balance >= getTotal() 
                        ? 'bg-blue-50 border-blue-300' 
                        : 'bg-green-50 border-green-300'
                    }`}>
                      <Check className={`h-3 w-3 sm:h-5 sm:w-5 flex-shrink-0 ${
                        selectedStudent.balance >= getTotal() ? 'text-blue-600' : 'text-green-600'
                      }`} />
                      <div>
                        {selectedStudent.balance >= getTotal() ? (
                          <>
                            <p className="font-bold text-blue-800 text-[9px] sm:text-sm">💰 Se descontará del saldo</p>
                            <p className="text-[8px] sm:text-xs text-blue-700">
                              Saldo: S/ {selectedStudent.balance.toFixed(2)} → S/ {(selectedStudent.balance - getTotal()).toFixed(2)}
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="font-bold text-green-800 text-[9px] sm:text-sm">✓ Cuenta Libre</p>
                            <p className="text-[8px] sm:text-xs text-green-700">
                              Se registrará como deuda pendiente
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  <Button
                    onClick={handleCheckoutClick}
                    disabled={!canCheckout() || isProcessing}
                    className="w-full h-12 sm:h-16 lg:h-20 text-base sm:text-xl lg:text-2xl font-black rounded-xl shadow-lg bg-emerald-500 hover:bg-emerald-600 active:scale-95 disabled:bg-gray-300"
                  >
                    {isProcessing ? 'PROCESANDO...' : 'COBRAR'}
                  </Button>
                </>
              ) : (
                <div className="text-center py-4 sm:py-8 text-gray-400">
                  <p className="text-xs sm:text-sm">Agrega productos para continuar</p>
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
                    onKeyDown={(e) => {
                      // ENTER → Continuar (si el monto es suficiente)
                      if (e.key === 'Enter' && parseFloat(cashGiven) >= getTotal()) {
                        e.preventDefault();
                        // Simular click en el botón CONTINUAR
                        setShowConfirmDialog(false);
                        setShowDocumentTypeDialog(true);
                      }
                    }}
                    placeholder="Ej: 50.00"
                    className="h-20 text-3xl font-bold text-center border-emerald-300"
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
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          {split.method === 'efectivo' && <Banknote className="h-5 w-5 text-emerald-600 shrink-0" />}
                          {split.method === 'tarjeta' && <CreditCard className="h-5 w-5 text-blue-600 shrink-0" />}
                          {(split.method === 'yape_qr' || split.method === 'yape_numero') && <Smartphone className="h-5 w-5 text-purple-600 shrink-0" />}
                          {(split.method === 'plin_qr' || split.method === 'plin_numero') && <Smartphone className="h-5 w-5 text-pink-600 shrink-0" />}
                          {split.method === 'transferencia' && <CreditCard className="h-5 w-5 text-amber-600 shrink-0" />}
                          <div className="min-w-0">
                            <span className="font-bold text-sm block capitalize">
                              {split.method === 'yape_qr' ? 'Yape QR' : split.method === 'yape_numero' ? 'Yape Número' : split.method === 'plin_qr' ? 'Plin QR' : split.method === 'plin_numero' ? 'Plin Número' : split.method === 'tarjeta' ? 'Tarjeta' : split.method === 'transferencia' ? 'Transferencia' : 'Efectivo'}
                            </span>
                            {split.operationCode && <span className="text-xs text-gray-500">Op: {split.operationCode}</span>}
                            {split.phoneNumber && <span className="text-xs text-gray-500">Cel: {split.phoneNumber}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
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
                    
                    {/* Botones de métodos — mismos que el pago independiente */}
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: 'efectivo',     label: 'Efectivo',       color: 'emerald' },
                        { id: 'tarjeta',      label: 'Tarjeta',        color: 'blue'    },
                        { id: 'yape_qr',      label: 'Yape QR',        color: 'purple'  },
                        { id: 'yape_numero',  label: 'Yape Número',    color: 'purple'  },
                        { id: 'plin_qr',      label: 'Plin QR',        color: 'pink'    },
                        { id: 'plin_numero',  label: 'Plin Número',    color: 'pink'    },
                        { id: 'transferencia',label: 'Transferencia',  color: 'amber'   },
                      ].map(({ id, label }) => (
                        <button
                          key={id}
                          onClick={() => {
                            setCurrentSplitMethod(id);
                            setCurrentSplitOperationCode('');
                            setCurrentSplitPhoneNumber('');
                          }}
                          className={`p-2 border-2 rounded-lg text-xs font-bold transition-all ${
                            currentSplitMethod === id
                              ? 'border-orange-500 bg-orange-100 text-orange-900'
                              : 'border-gray-200 text-gray-600 hover:border-orange-300'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {/* Campo extra: Número de celular para Yape Número */}
                    {currentSplitMethod === 'yape_numero' && (
                      <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                        <Label className="text-xs font-bold text-purple-900 mb-1 block">Número de Celular (Yape)</Label>
                        <Input
                          type="text"
                          value={currentSplitPhoneNumber}
                          onChange={(e) => setCurrentSplitPhoneNumber(e.target.value)}
                          placeholder="999 999 999"
                          className="h-10 text-sm font-semibold"
                          maxLength={9}
                        />
                      </div>
                    )}

                    {/* Campo extra: Número de celular para Plin Número */}
                    {currentSplitMethod === 'plin_numero' && (
                      <div className="bg-pink-50 border border-pink-200 rounded-lg p-3">
                        <Label className="text-xs font-bold text-pink-900 mb-1 block">Número de Celular (Plin)</Label>
                        <Input
                          type="text"
                          value={currentSplitPhoneNumber}
                          onChange={(e) => setCurrentSplitPhoneNumber(e.target.value)}
                          placeholder="999 999 999"
                          className="h-10 text-sm font-semibold"
                          maxLength={9}
                        />
                      </div>
                    )}

                    {/* Campo extra: Código de operación para tarjeta, transferencia, yape_qr, plin_qr */}
                    {(currentSplitMethod === 'tarjeta' || currentSplitMethod === 'transferencia' || currentSplitMethod === 'yape_qr' || currentSplitMethod === 'plin_qr') && (
                      <div className={`border rounded-lg p-3 ${
                        currentSplitMethod === 'tarjeta' ? 'bg-blue-50 border-blue-200' : 'bg-amber-50 border-amber-200'
                      }`}>
                        <Label className={`text-xs font-bold mb-1 block ${
                          currentSplitMethod === 'tarjeta' ? 'text-blue-900' : 'text-amber-900'
                        }`}>
                          {currentSplitMethod === 'tarjeta' ? 'Nº de Operación (Voucher)' : 'Código de Operación'}
                        </Label>
                        <Input
                          type="text"
                          value={currentSplitOperationCode}
                          onChange={(e) => setCurrentSplitOperationCode(e.target.value)}
                          placeholder={currentSplitMethod === 'tarjeta' ? 'Ej: 123456' : 'Ej: OP12345678'}
                          className="h-10 text-sm font-semibold uppercase"
                        />
                      </div>
                    )}

                    {/* Monto */}
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
                          // Validar campos extra requeridos
                          if ((currentSplitMethod === 'yape_numero' || currentSplitMethod === 'plin_numero') && !currentSplitPhoneNumber) {
                            toast({ variant: 'destructive', title: 'Error', description: 'Ingresa el número de celular' });
                            return;
                          }
                          const amount = parseFloat(currentSplitAmount);
                          const totalPaid = paymentSplits.reduce((sum, p) => sum + p.amount, 0);
                          if (totalPaid + amount <= getTotal()) {
                            const newSplit: PaymentSplit = { method: currentSplitMethod, amount };
                            if (currentSplitOperationCode) newSplit.operationCode = currentSplitOperationCode;
                            if (currentSplitPhoneNumber) newSplit.phoneNumber = currentSplitPhoneNumber;
                            setPaymentSplits([...paymentSplits, newSplit]);
                            setCurrentSplitMethod('');
                            setCurrentSplitAmount('');
                            setCurrentSplitOperationCode('');
                            setCurrentSplitPhoneNumber('');
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

            {(paymentMethod === 'transferencia' || paymentMethod === 'yape_qr' || paymentMethod === 'plin_qr' || paymentMethod === 'tarjeta') && (
              <div className={`border-2 rounded-xl p-4 ${
                paymentMethod === 'tarjeta' 
                  ? 'bg-blue-50 border-blue-200' 
                  : 'bg-amber-50 border-amber-200'
              }`}>
                <Label className={`text-sm font-bold mb-2 block ${
                  paymentMethod === 'tarjeta' ? 'text-blue-900' : 'text-amber-900'
                }`}>
                  {paymentMethod === 'tarjeta' ? 'Nº de Operación (Voucher)' : 'Código de Operación'}
                </Label>
                <Input
                  type="text"
                  value={transactionCode}
                  onChange={(e) => setTransactionCode(e.target.value)}
                  placeholder={paymentMethod === 'tarjeta' ? 'Ej: 123456' : 'Ej: OP12345678'}
                  className="h-14 text-lg font-semibold uppercase"
                />
                <p className={`text-xs mt-2 ${
                  paymentMethod === 'tarjeta' ? 'text-blue-700' : 'text-amber-700'
                }`}>
                  {paymentMethod === 'tarjeta' 
                    ? 'Ingresa el número de operación del voucher de la tarjeta' 
                    : 'Ingresa el código de la transacción para validar el pago'}
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

                  // Si el pago NO es efectivo puro → boleta/factura obligatoria,
                  // saltar directo al modal de datos del cliente (sin pasar por el diálogo de tipo)
                  const esEfectivoUnico = paymentMethod === 'efectivo';
                  if (!esEfectivoUnico) {
                    setShowConfirmDialog(false);
                    setPendingInvoiceType('boleta'); // por defecto boleta, puede cambiar a factura
                    setInvoiceTypeLocked(false);     // permitir elegir boleta o factura en el modal
                    setShowInvoiceClientModal(true);
                    return;
                  }

                  // Efectivo: mostrar selector de comprobante (Ticket / Boleta / Factura)
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

      {/* MODAL DE CONFIRMACIÓN PARA CUENTA DE CRÉDITO */}
      <Dialog open={showCreditConfirmDialog} onOpenChange={setShowCreditConfirmDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold flex items-center gap-2">
              <CheckCircle2 className="h-7 w-7 text-emerald-600" />
              Confirmar Compra a Crédito
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-6">
            {/* Resumen de Compra */}
            <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white rounded-2xl p-6">
              <div className="text-center">
                <p className="text-sm text-gray-300 uppercase font-semibold mb-2">Total a Cobrar</p>
                <p className="text-5xl font-black mb-3">S/ {getTotal().toFixed(2)}</p>
                <div className="bg-emerald-500 text-white px-4 py-2 rounded-full inline-block">
                  <p className="text-sm font-bold">PAGO A CRÉDITO</p>
                </div>
              </div>
            </div>

            {/* Información del Cliente */}
            {selectedStudent && (
              <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
                <div className="flex items-center gap-3">
                  <User className="h-8 w-8 text-blue-600" />
                  <div>
                    <p className="text-sm text-gray-600 font-semibold">Cliente</p>
                    <p className="text-lg font-bold text-gray-900">{selectedStudent.full_name}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Detalle de Productos */}
            <div className="bg-gray-50 rounded-xl p-4 max-h-48 overflow-y-auto">
              <p className="text-sm font-bold text-gray-700 mb-3">Productos ({cart.length})</p>
              <div className="space-y-2">
                {cart.map((item, index) => (
                  <div key={index} className="flex justify-between text-sm">
                    <span className="text-gray-700">
                      {item.quantity}x {item.product.name}
                    </span>
                    <span className="font-bold text-gray-900">
                      S/ {(item.product.price * item.quantity).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Botones de Acción */}
            <div className="grid grid-cols-2 gap-3">
              <Button
                onClick={async () => {
                  await handleConfirmCheckout(false); // Sin imprimir
                }}
                disabled={isProcessing}
                className="h-14 text-base font-bold bg-emerald-500 hover:bg-emerald-600"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    Procesando...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-5 w-5 mr-2" />
                    Confirmar
                  </>
                )}
              </Button>

              <Button
                onClick={async () => {
                  await handleConfirmCheckout(true); // Con impresión
                }}
                disabled={isProcessing}
                variant="outline"
                className="h-14 text-base font-bold border-2 border-blue-500 text-blue-600 hover:bg-blue-50"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    Procesando...
                  </>
                ) : (
                  <>
                    <Printer className="h-5 w-5 mr-2" />
                    Confirmar e Imprimir
                  </>
                )}
              </Button>
            </div>

            <Button
              variant="ghost"
              onClick={() => {
                setShowCreditConfirmDialog(false);
              }}
              disabled={isProcessing}
              className="w-full"
            >
              Cancelar
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

      {/* MODAL DE SELECCIÓN DE COMPROBANTE */}
      <Dialog open={showDocumentTypeDialog} onOpenChange={setShowDocumentTypeDialog}>
        <DialogContent className="sm:max-w-[700px]">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-center">
              Selecciona Tipo de Comprobante
            </DialogTitle>
          </DialogHeader>
          
          <div className="grid grid-cols-3 gap-6 py-8">
            {/* TICKET */}
            <button
              onClick={() => {
                setSelectedDocumentType('ticket');
                setShowDocumentTypeDialog(false);
                handleConfirmCheckout(true);
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
            
            {/* BOLETA */}
            <button
              onClick={() => {
                setSelectedDocumentType('boleta');
                setPendingInvoiceType('boleta');
                setInvoiceTypeLocked(true); // ya se eligió → no preguntar en el modal
                setShowDocumentTypeDialog(false);
                setShowInvoiceClientModal(true);
              }}
              className="flex flex-col items-center gap-4 p-8 border-4 border-blue-300 bg-blue-50 rounded-2xl hover:bg-blue-100 hover:border-blue-400 transition-all hover:scale-105 shadow-lg hover:shadow-xl"
            >
              <Printer className="h-20 w-20 text-blue-600" />
              <div className="text-center">
                <p className="font-black text-xl text-blue-900">BOLETA</p>
                <p className="text-xs text-blue-700 mt-2">Persona natural / DNI</p>
                <Badge className="mt-2 bg-blue-600 text-white text-xs">✓ Disponible</Badge>
              </div>
            </button>
            
            {/* FACTURA */}
            <button
              onClick={() => {
                setSelectedDocumentType('factura');
                setPendingInvoiceType('factura');
                setInvoiceTypeLocked(true); // ya se eligió → no preguntar en el modal
                setShowDocumentTypeDialog(false);
                setShowInvoiceClientModal(true);
              }}
              className="flex flex-col items-center gap-4 p-8 border-4 border-indigo-300 bg-indigo-50 rounded-2xl hover:bg-indigo-100 hover:border-indigo-400 transition-all hover:scale-105 shadow-lg hover:shadow-xl"
            >
              <FileText className="h-20 w-20 text-indigo-600" />
              <div className="text-center">
                <p className="font-black text-xl text-indigo-900">FACTURA</p>
                <p className="text-xs text-indigo-700 mt-2">Empresa / RUC</p>
                <Badge className="mt-2 bg-indigo-600 text-white text-xs">✓ Disponible</Badge>
              </div>
            </button>
          </div>

          <Button
            variant="outline"
            onClick={() => {
              setShowDocumentTypeDialog(false);
              setShowConfirmDialog(true);
            }}
            className="w-full"
          >
            ← Volver a Métodos de Pago
          </Button>
        </DialogContent>
      </Dialog>

      {/* MODAL DE DATOS DEL CLIENTE (BOLETA / FACTURA) */}
      <InvoiceClientModal
        open={showInvoiceClientModal}
        onClose={() => {
          setShowInvoiceClientModal(false);
          // Si el tipo estaba bloqueado venía del dialog de tipo → volver a él
          // Si no estaba bloqueado venía directo de pago no-efectivo → volver al confirm dialog
          if (invoiceTypeLocked) {
            setShowDocumentTypeDialog(true);
          } else {
            setShowConfirmDialog(true);
          }
        }}
        defaultType={pendingInvoiceType}
        lockedType={invoiceTypeLocked}
        defaultName={
          clientMode === 'student' ? selectedStudent?.full_name :
          clientMode === 'teacher' ? selectedTeacher?.full_name : ''
        }
        totalAmount={getTotal()}
        schoolId={userSchoolId || undefined}
        onConfirm={handleGenerateInvoice}
      />
    </div>
    </>
  );
};

export default POS;
