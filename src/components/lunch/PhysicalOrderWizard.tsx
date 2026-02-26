import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { Users, CreditCard, Search, ArrowRight, ArrowLeft, Check, Loader2, AlertTriangle, AlertCircle, Plus, Minus } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface PhysicalOrderWizardProps {
  isOpen: boolean;
  onClose: () => void;
  schoolId: string;
  selectedDate?: string; // Fecha seleccionada desde el calendario
  onSuccess: () => void;
}

interface LunchCategory {
  id: string;
  name: string;
  color: string;
  icon: string;
  price: number;
  target_type: 'students' | 'teachers';
  menu_mode?: 'standard' | 'configurable';
}

interface ConfigPlateGroup {
  id: string;
  name: string;
  is_required: boolean;
  options: Array<{ id: string; name: string }>;
}

interface LunchMenu {
  id: string;
  date: string;
  starter: string | null;
  main_course: string;
  beverage: string | null;
  dessert: string | null;
  category_id: string;
  allows_modifiers?: boolean;
  garnishes?: string[];
}

interface MenuModifierGroup {
  id: string;
  name: string;
  is_required: boolean;
  options: Array<{ id: string; name: string; is_default: boolean }>;
}

interface Person {
  id: string;
  full_name: string;
}

export function PhysicalOrderWizard({ isOpen, onClose, schoolId, selectedDate, onSuccess }: PhysicalOrderWizardProps) {
  const { toast } = useToast();
  const { user } = useAuth(); // 🔑 Obtener usuario actual para ticket_code
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const isSubmittingRef = useRef(false); // 🔒 Lock sincrónico anti doble-clic

  // Datos del wizard
  const [targetType, setTargetType] = useState<'students' | 'teachers' | null>(null);
  const [paymentType, setPaymentType] = useState<'credit' | 'cash' | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [manualName, setManualName] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<LunchCategory | null>(null);
  const [selectedMenu, setSelectedMenu] = useState<LunchMenu | null>(null);
  const [quantity, setQuantity] = useState(1); // 🆕 CANTIDAD DE MENÚS
  const [existingOrders, setExistingOrders] = useState<any[]>([]); // 🆕 PEDIDOS EXISTENTES
  const [cashPaymentMethod, setCashPaymentMethod] = useState<'efectivo' | 'tarjeta' | 'yape' | 'transferencia' | null>(null);
  
  // Detalles de pago
  const [paymentDetails, setPaymentDetails] = useState({
    // Efectivo
    currency: 'soles',
    amountReceived: '',
    change: 0,
    // Tarjeta
    operationNumber: '',
    cardType: '',
    // Yape/Plin
    yapeType: 'yape',
    // Transferencia
    bankName: '',
  });

  // Listas
  const [people, setPeople] = useState<Person[]>([]);
  const [categories, setCategories] = useState<LunchCategory[]>([]);
  const [menus, setMenus] = useState<LunchMenu[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  // ── Modificadores / Personalización ──
  const [menuModifiers, setMenuModifiers] = useState<MenuModifierGroup[]>([]);
  const [selectedModifiers, setSelectedModifiers] = useState<Array<{
    group_id: string; group_name: string; selected_option_id: string; selected_name: string;
  }>>([]);
  const [loadingModifiers, setLoadingModifiers] = useState(false);

  // ── Guarniciones ──
  const [availableGarnishes, setAvailableGarnishes] = useState<string[]>([]);
  const [selectedGarnishes, setSelectedGarnishes] = useState<Set<string>>(new Set());

  // ── Plato Configurable ──
  const [configPlateGroups, setConfigPlateGroups] = useState<ConfigPlateGroup[]>([]);
  const [configSelections, setConfigSelections] = useState<Array<{ group_name: string; selected: string }>>([]);

  const handleClose = () => {
    setStep(1);
    setTargetType(null);
    setPaymentType(null);
    setSelectedPerson(null);
    setManualName('');
    setSelectedCategory(null);
    setSelectedMenu(null);
    setQuantity(1); // 🆕 RESETEAR CANTIDAD
    setExistingOrders([]); // 🆕 LIMPIAR PEDIDOS EXISTENTES
    setCashPaymentMethod(null);
    setPaymentDetails({
      currency: 'soles',
      amountReceived: '',
      change: 0,
      operationNumber: '',
      cardType: '',
      yapeType: 'yape',
      bankName: '',
    });
    setPeople([]);
    setCategories([]);
    setMenus([]);
    setSearchTerm('');
    setMenuModifiers([]);
    setSelectedModifiers([]);
    setAvailableGarnishes([]);
    setSelectedGarnishes(new Set());
    setConfigPlateGroups([]);
    setConfigSelections([]);
    onClose();
  };

  // Calcular vuelto automáticamente
  useEffect(() => {
    if (cashPaymentMethod === 'efectivo' && selectedCategory?.price && paymentDetails.amountReceived) {
      const received = parseFloat(paymentDetails.amountReceived) || 0;
      const price = selectedCategory.price;
      const change = received - price;
      setPaymentDetails(prev => ({ ...prev, change: change >= 0 ? change : 0 }));
    }
  }, [paymentDetails.amountReceived, selectedCategory, cashPaymentMethod]);

  const isPaymentDetailsComplete = () => {
    if (!cashPaymentMethod) return false;

    switch (cashPaymentMethod) {
      case 'efectivo':
        return paymentDetails.amountReceived && paymentDetails.change >= 0;
      case 'tarjeta':
        return paymentDetails.cardType && paymentDetails.operationNumber.trim();
      case 'yape':
        return paymentDetails.operationNumber.trim();
      case 'transferencia':
        return paymentDetails.bankName.trim() && paymentDetails.operationNumber.trim();
      case 'pagar_luego':
        return true; // ✅ Siempre válido para "Pagar Luego"
      default:
        return false;
    }
  };

  // ── Cargar opciones de plato configurable ──
  const loadConfigurableGroups = async (categoryId: string) => {
    try {
      const { data: groups } = await supabase
        .from('configurable_plate_groups')
        .select('id, name, is_required')
        .eq('category_id', categoryId)
        .order('display_order', { ascending: true });

      if (!groups || groups.length === 0) {
        setConfigPlateGroups([]);
        setConfigSelections([]);
        return;
      }

      const groupIds = groups.map(g => g.id);
      const { data: options } = await supabase
        .from('configurable_plate_options')
        .select('id, group_id, name')
        .in('group_id', groupIds)
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      const fullGroups: ConfigPlateGroup[] = groups.map(g => ({
        ...g,
        options: (options || []).filter(o => o.group_id === g.id),
      }));

      setConfigPlateGroups(fullGroups);
      setConfigSelections(fullGroups.map(g => ({
        group_name: g.name,
        selected: g.options.length > 0 ? g.options[0].name : '',
      })));
    } catch (err) {
      console.error('Error loading configurable groups:', err);
      setConfigPlateGroups([]);
      setConfigSelections([]);
    }
  };

  // ── Cargar modificadores cuando se selecciona un menú ──
  const loadModifiersForMenu = async (menu: LunchMenu) => {
    setMenuModifiers([]);
    setSelectedModifiers([]);
    
    // Cargar guarniciones
    const garnishes = (menu.garnishes as string[]) || [];
    setAvailableGarnishes(garnishes);
    setSelectedGarnishes(new Set());

    if (!menu.allows_modifiers) return;

    setLoadingModifiers(true);
    try {
      const { data: groups } = await supabase
        .from('menu_modifier_groups')
        .select('id, name, is_required, max_selections')
        .eq('menu_id', menu.id)
        .order('display_order', { ascending: true });

      if (!groups?.length) return;

      const groupIds = groups.map(g => g.id);
      const { data: options } = await supabase
        .from('menu_modifier_options')
        .select('id, group_id, name, is_default')
        .in('group_id', groupIds)
        .order('display_order', { ascending: true });

      const enriched = groups.map(g => ({
        ...g,
        options: (options || []).filter(o => o.group_id === g.id),
      }));

      setMenuModifiers(enriched);

      // Pre-seleccionar valores por defecto
      const defaults = enriched.map(g => {
        const def = g.options.find(o => o.is_default) || g.options[0];
        return { group_id: g.id, group_name: g.name, selected_option_id: def?.id || '', selected_name: def?.name || '' };
      });
      setSelectedModifiers(defaults);
    } catch (err) {
      console.error('Error loading modifiers:', err);
    } finally {
      setLoadingModifiers(false);
    }
  };

  // Paso 2: Cargar personas
  useEffect(() => {
    if (step === 3 && paymentType === 'credit' && targetType) {
      fetchPeople();
    }
  }, [step, paymentType, targetType]);

  // Paso 4: Cargar categorías (necesita selectedDate)
  useEffect(() => {
    if (step === 4 && targetType && selectedDate) {
      fetchCategories();
    }
  }, [step, targetType, selectedDate]);

  // Paso 5: Cargar menús
  useEffect(() => {
    if (step === 5 && selectedCategory) {
      fetchMenus().then(() => {
        // Si es configurable, auto-seleccionar el primer menú
        if (selectedCategory.menu_mode === 'configurable') {
          // El auto-select se hace después de que fetchMenus actualice el estado
          loadConfigurableGroups(selectedCategory.id);
        } else {
          setConfigPlateGroups([]);
          setConfigSelections([]);
        }
      });
    }
  }, [step, selectedCategory]);

  // Auto-seleccionar primer menú para categorías configurables
  useEffect(() => {
    if (selectedCategory?.menu_mode === 'configurable' && menus.length > 0 && !selectedMenu) {
      setSelectedMenu(menus[0]);
    }
  }, [menus, selectedCategory, selectedMenu]);

  // 🆕 NUEVO: Cargar pedidos existentes cuando se selecciona una persona (Step 3)
  useEffect(() => {
    const fetchExistingOrders = async () => {
      if (!selectedPerson || !selectedDate || paymentType !== 'credit') {
        setExistingOrders([]);
        return;
      }
      
      setLoading(true);
      try {
        // Formatear la fecha correctamente
        let targetDate = selectedDate;
        if (typeof selectedDate !== 'string') {
          targetDate = format(new Date(selectedDate), 'yyyy-MM-dd');
        }

        // ✅ SOLUCIÓN: Consultas separadas (sin FK join) para evitar PGRST200
        let query = supabase
          .from('lunch_orders')
          .select('id, order_date, status, quantity, is_cancelled, category_id, menu_id')
          .eq('order_date', targetDate)
          .eq('is_cancelled', false);

        if (targetType === 'students') {
          query = query.eq('student_id', selectedPerson.id);
        } else if (targetType === 'teachers') {
          query = query.eq('teacher_id', selectedPerson.id);
        }

        const { data, error } = await query;

        if (error) {
          console.error('❌ Error en query:', error);
          throw error;
        }
        
        // 🆕 Si hay pedidos, enriquecer con categorías y menús (consultas separadas)
        if (data && data.length > 0) {
          const categoryIds = [...new Set(data.map((order: any) => order.category_id).filter(Boolean))];
          const menuIds = [...new Set(data.map((order: any) => order.menu_id).filter(Boolean))];
          
          let categoriesMap: Record<string, string> = {};
          let menusMap: Record<string, string> = {};
          
          if (categoryIds.length > 0) {
            const { data: cats } = await supabase
              .from('lunch_categories')
              .select('id, name')
              .in('id', categoryIds);
            cats?.forEach((c: any) => { categoriesMap[c.id] = c.name; });
          }
          
          if (menuIds.length > 0) {
            const { data: menuData } = await supabase
              .from('lunch_menus')
              .select('id, main_course')
              .in('id', menuIds);
            menuData?.forEach((m: any) => { menusMap[m.id] = m.main_course; });
          }
          
          const ordersWithDetails = data.map((order: any) => ({
            ...order,
            lunch_menus: {
              main_course: menusMap[order.menu_id] || 'Sin detalles',
              lunch_categories: {
                name: categoriesMap[order.category_id] || 'Sin categoría'
              }
            }
          }));
          
          console.log('✅ Pedidos con detalles:', ordersWithDetails);
          setExistingOrders(ordersWithDetails || []);
        } else {
          console.log('ℹ️ No hay pedidos existentes para este día');
          setExistingOrders([]);
        }
      } catch (error: any) {
        console.error('💥 Error fetching existing orders:', error);
        // ⚠️ No mostrar toast si no hay pedidos, solo en caso de error real
        if (error.code !== 'PGRST116') { // PGRST116 = No rows found (normal)
          toast({ 
            title: 'Error', 
            description: error.message || 'No se pudieron cargar los pedidos existentes', 
            variant: 'destructive' 
          });
        }
      } finally {
        setLoading(false);
      }
    };

    if (step === 3 && selectedPerson && paymentType === 'credit') {
      fetchExistingOrders();
    }
  }, [step, selectedPerson, selectedDate, targetType, paymentType]);

  const fetchPeople = async () => {
    try {
      setLoading(true);
      const table = targetType === 'students' ? 'students' : 'teacher_profiles';
      
      let query = supabase
        .from(table)
        .select('id, full_name');
      
      // Filtrar por escuela
      if (targetType === 'students') {
        query = query.eq('school_id', schoolId);
      } else {
        // Para profesores, usar school_id_1
        query = query.eq('school_id_1', schoolId);
      }
      
      const { data, error } = await query.order('full_name');

      if (error) throw error;
      setPeople(data || []);
    } catch (error) {
      console.error('Error fetching people:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      setLoading(true);
      
      // Usar la fecha seleccionada o la fecha de hoy
      let targetDate = selectedDate || format(new Date(), 'yyyy-MM-dd');
      
      // Si selectedDate es un objeto Date, formatearlo
      if (selectedDate && typeof selectedDate !== 'string') {
        targetDate = format(new Date(selectedDate), 'yyyy-MM-dd');
      }
      
      console.log('🔍 [fetchCategories] Inicio');
      console.log('📅 [fetchCategories] Fecha objetivo:', targetDate);
      console.log('🏫 [fetchCategories] School ID:', schoolId);
      console.log('👥 [fetchCategories] Target type:', targetType);
      
      // Buscar menús sin FK (método más confiable)
      console.log('🔧 [fetchCategories] Buscando menús...');
      const { data: menusData, error: menusError } = await supabase
        .from('lunch_menus')
        .select('id, category_id, date, starter, main_course, beverage, dessert, allows_modifiers, garnishes')
        .eq('school_id', schoolId)
        .eq('date', targetDate)
        .or(`target_type.eq.${targetType},target_type.eq.both,target_type.is.null`);
        
      if (menusError) {
        console.log('❌ [fetchCategories] Error buscando menús:', menusError);
        throw menusError;
      }
      
      console.log('✅ [fetchCategories] Menús encontrados:', menusData?.length || 0);
      console.log('📋 [fetchCategories] Menús:', menusData);
      
      // Si no hay menús, no hay categorías
      if (!menusData || menusData.length === 0) {
        console.log('⚠️ [fetchCategories] No hay menús disponibles');
        setCategories([]);
        return;
      }
      
      // Extraer IDs de categorías únicas
      const categoryIds = [...new Set(menusData.map((m: any) => m.category_id).filter(Boolean))];
      console.log('📋 [fetchCategories] IDs de categorías:', categoryIds);
      
      if (categoryIds.length === 0) {
        console.log('⚠️ [fetchCategories] No hay categorías asignadas');
        setCategories([]);
        return;
      }
      
      // Buscar las categorías
      const { data: categoriesData, error: categoriesError } = await supabase
        .from('lunch_categories')
        .select('*')
        .in('id', categoryIds)
        .order('display_order');
        
      if (categoriesError) {
        console.log('❌ [fetchCategories] Error buscando categorías:', categoriesError);
        throw categoriesError;
      }
      
      console.log('✅ [fetchCategories] Categorías encontradas:', categoriesData?.length || 0);
      console.log('📝 [fetchCategories] Categorías:', categoriesData);
      
      setCategories(categoriesData || []);
    } catch (error) {
      console.error('💥 [fetchCategories] Error fatal:', error);
      toast({
        title: 'Error',
        description: 'No se pudieron cargar las categorías disponibles',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
      console.log('🏁 [fetchCategories] Fin');
    }
  };

  const fetchMenus = async () => {
    try {
      setLoading(true);
      // Usar la fecha seleccionada o la fecha de hoy
      let targetDate = selectedDate || format(new Date(), 'yyyy-MM-dd');
      
      // Si selectedDate es un objeto Date, formatearlo
      if (selectedDate && typeof selectedDate !== 'string') {
        targetDate = format(new Date(selectedDate), 'yyyy-MM-dd');
      }
      
      console.log('🔍 [fetchMenus] Inicio');
      console.log('📅 [fetchMenus] Fecha objetivo:', targetDate);
      console.log('📂 [fetchMenus] Categoría seleccionada:', selectedCategory?.id, selectedCategory?.name);
      console.log('🏫 [fetchMenus] School ID:', schoolId);
      console.log('👥 [fetchMenus] Target type:', targetType);
      
      // Buscar menús sin FK (método más confiable)
      console.log('🔧 [fetchMenus] Buscando menús...');
      const { data, error } = await supabase
        .from('lunch_menus')
        .select('*')
        .eq('school_id', schoolId)
        .eq('category_id', selectedCategory?.id)
        .eq('date', targetDate)
        .or(`target_type.eq.${targetType},target_type.eq.both,target_type.is.null`);
        
      if (error) {
        console.log('❌ [fetchMenus] Error buscando menús:', error);
        throw error;
      }
      
      console.log('✅ [fetchMenus] Menús encontrados:', data?.length || 0);
      
      // Agregar la categoría manualmente a cada menú
      const menusWithCategory = (data || []).map((menu: any) => ({
        ...menu,
        lunch_categories: selectedCategory
      }));
      
      console.log('📝 [fetchMenus] Menús finales:', menusWithCategory);
      setMenus(menusWithCategory);
    } catch (error) {
      console.error('💥 [fetchMenus] Error fatal:', error);
      toast({
        title: 'Error',
        description: 'No se pudieron cargar los menús disponibles',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
      console.log('🏁 [fetchMenus] Fin');
    }
  };

  const handleSubmit = async () => {
    if (!selectedMenu || !selectedCategory) return;

    // 🔒 Lock sincrónico: previene doble-clic / doble envío
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setLoading(true);

    // ── Guard de caja: solo aplica cuando es un pago inmediato (cash/yape/tarjeta) ──
    const isImmediatePayment =
      paymentType === 'cash' &&
      cashPaymentMethod &&
      cashPaymentMethod !== 'pagar_luego';

    if (isImmediatePayment && schoolId) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const { data: openReg } = await supabase
        .from('cash_registers')
        .select('id')
        .eq('school_id', schoolId)
        .eq('status', 'open')
        .gte('opened_at', todayStart.toISOString())
        .limit(1)
        .maybeSingle();

      if (!openReg) {
        toast({
          variant: 'destructive',
          title: '⛔ Caja no abierta',
          description:
            'Debes abrir la caja del día antes de registrar un pago en efectivo, Yape o tarjeta. ' +
            'Ve al módulo de Cierre de Caja y declara el monto inicial.',
        });
        setLoading(false);
        isSubmittingRef.current = false; // 🔓 Liberar lock en salida temprana
        return;
      }
    }

    try {
      // 🆕 Calcular precio total basado en cantidad
      const totalPrice = (selectedCategory.price || 0) * quantity;

      // ── 🔍 VERIFICAR SI YA EXISTE UN PEDIDO para esta persona + fecha + categoría ──
      let existingOrderForCategory: any = null;
      if (paymentType === 'credit' && selectedPerson) {
        const personField = targetType === 'students' ? 'student_id' : 'teacher_id';
        const targetDate = typeof selectedMenu.date === 'string' ? selectedMenu.date : format(new Date(selectedMenu.date), 'yyyy-MM-dd');
        
        const { data: existingData } = await supabase
          .from('lunch_orders')
          .select('id, quantity, base_price, final_price')
          .eq(personField, selectedPerson.id)
          .eq('order_date', targetDate)
          .eq('category_id', selectedCategory.id)
          .eq('is_cancelled', false)
          .maybeSingle();
        
        existingOrderForCategory = existingData;
      } else if (paymentType === 'cash' && manualName.trim()) {
        // Para pedidos sin crédito con nombre manual, verificar también
        const targetDate = typeof selectedMenu.date === 'string' ? selectedMenu.date : format(new Date(selectedMenu.date), 'yyyy-MM-dd');
        
        const { data: existingData } = await supabase
          .from('lunch_orders')
          .select('id, quantity, base_price, final_price')
          .eq('manual_name', manualName.trim())
          .eq('order_date', targetDate)
          .eq('category_id', selectedCategory.id)
          .eq('is_cancelled', false)
          .maybeSingle();
        
        existingOrderForCategory = existingData;
      }

      let insertedOrderId: string;

      // ── Si ya existe, ACTUALIZAR CANTIDAD en vez de crear nuevo ──
      if (existingOrderForCategory) {
        const newQuantity = (existingOrderForCategory.quantity || 1) + quantity;
        const newFinalPrice = (selectedCategory.price || 0) * newQuantity;

        const { error: updateError } = await supabase
          .from('lunch_orders')
          .update({
            quantity: newQuantity,
            final_price: newFinalPrice,
            menu_id: selectedMenu.id, // Actualizar al menú más reciente
          })
          .eq('id', existingOrderForCategory.id);

        if (updateError) throw updateError;
        
        insertedOrderId = existingOrderForCategory.id;
        console.log(`✅ Pedido existente actualizado: cantidad ${existingOrderForCategory.quantity || 1} → ${newQuantity}`);
      } else {
        // ── Crear pedido NUEVO ──
        // Solo incluir columnas opcionales si tienen datos (evita error si la migración no se ejecutó)
        const orderData: any = {
          menu_id: selectedMenu.id,
          order_date: selectedMenu.date,
          status: 'confirmed',
          category_id: selectedCategory.id,
          school_id: schoolId,
          quantity,
          base_price: selectedCategory.price || 0,
          final_price: totalPrice,
        };
        if (selectedModifiers.length > 0) {
          orderData.selected_modifiers = selectedModifiers;
        }
        if (selectedGarnishes.size > 0) {
          orderData.selected_garnishes = Array.from(selectedGarnishes);
        }
        if (configSelections.length > 0) {
          orderData.configurable_selections = configSelections;
        }

        if (paymentType === 'credit') {
          if (targetType === 'students') {
            orderData.student_id = selectedPerson?.id;
          } else {
            orderData.teacher_id = selectedPerson?.id;
          }
        } else {
          orderData.manual_name = manualName;
          orderData.payment_method = cashPaymentMethod;
          
          if (cashPaymentMethod !== 'pagar_luego') {
            orderData.payment_details = paymentDetails;
          }
        }

        let insertedOrderResult: { id: string } | null = null;
        const { data: insertedOrder, error: orderError } = await supabase
          .from('lunch_orders')
          .insert([orderData])
          .select('id')
          .single();

        if (orderError) {
          // 🔧 Si falla por columna no encontrada (migración no ejecutada), reintentar sin columnas opcionales
          if (orderError.code === 'PGRST204' || orderError.message?.includes('column')) {
            console.warn('⚠️ Columna opcional no existe, reintentando sin columnas JSONB opcionales...');
            delete orderData.selected_modifiers;
            delete orderData.selected_garnishes;
            delete orderData.configurable_selections;

            const { data: retryData, error: retryError } = await supabase
              .from('lunch_orders')
              .insert([orderData])
              .select('id')
              .single();

            if (retryError) throw retryError;
            insertedOrderResult = retryData;
          } else {
            throw orderError;
          }
        } else {
          insertedOrderResult = insertedOrder;
        }
        if (!insertedOrderResult) throw new Error('No se pudo crear el pedido');
        insertedOrderId = insertedOrderResult.id;
      }

      // 🎫 Generar ticket_code para TODAS las transacciones (crédito, fiado Y pago inmediato)
      let ticketCode: string | null = null;
      if (totalPrice > 0) {
        try {
          const { data: ticketNumber, error: ticketErr } = await supabase
            .rpc('get_next_ticket_number', { p_user_id: user?.id || null });
          if (!ticketErr && ticketNumber) {
            ticketCode = ticketNumber;
          }
        } catch (err) {
          console.warn('⚠️ No se pudo generar ticket_code:', err);
        }
      }

      // Crear transacción si es con crédito
      if (paymentType === 'credit' && selectedPerson && totalPrice > 0) {
        // Si actualizamos un pedido existente, actualizar la transacción existente
        if (existingOrderForCategory) {
          const newTotalAmount = (selectedCategory.price || 0) * ((existingOrderForCategory.quantity || 1) + quantity);
          
          // Buscar transacción existente vinculada a este pedido
          const { data: existingTx } = await supabase
            .from('transactions')
            .select('id, amount, metadata')
            .eq('metadata->>lunch_order_id', existingOrderForCategory.id)
            .maybeSingle();
          
          if (existingTx) {
            await supabase
              .from('transactions')
              .update({
                amount: -Math.abs(newTotalAmount),
                description: `Almuerzo - ${selectedCategory.name} (${(existingOrderForCategory.quantity || 1) + quantity}x) - ${format(new Date(selectedMenu.date + 'T00:00:00'), "d 'de' MMMM", { locale: es })}`,
                metadata: {
                  ...(existingTx.metadata || {}),
                  quantity: (existingOrderForCategory.quantity || 1) + quantity,
                  updated_at: new Date().toISOString(),
                }
              })
              .eq('id', existingTx.id);
            console.log('✅ Transacción existente actualizada');
          } else {
            // No se encontró transacción previa, crear una nueva
            const transactionData: any = {
              type: 'purchase',
              amount: -Math.abs(totalPrice),
              description: `Almuerzo - ${selectedCategory.name}${quantity > 1 ? ` (${quantity}x)` : ''} - ${format(new Date(selectedMenu.date + 'T00:00:00'), "d 'de' MMMM", { locale: es })} (adicional)`,
              payment_status: 'pending',
              school_id: schoolId,
              ticket_code: ticketCode,
              metadata: {
                lunch_order_id: insertedOrderId,
                source: 'physical_order_wizard',
                order_date: selectedMenu.date,
                category_name: selectedCategory.name,
                quantity,
                is_additional: true,
              }
            };
            if (targetType === 'students') transactionData.student_id = selectedPerson.id;
            else transactionData.teacher_id = selectedPerson.id;
            await supabase.from('transactions').insert([transactionData]);
          }
        } else {
          // Pedido nuevo → transacción nueva
          const transactionData: any = {
            type: 'purchase',
            amount: -Math.abs(totalPrice),
            description: `Almuerzo - ${selectedCategory.name}${quantity > 1 ? ` (${quantity}x)` : ''} - ${format(new Date(selectedMenu.date + 'T00:00:00'), "d 'de' MMMM", { locale: es })}`,
            payment_status: 'pending',
            school_id: schoolId,
            ticket_code: ticketCode,
            metadata: {
              lunch_order_id: insertedOrderId,
              source: 'physical_order_wizard',
              order_date: selectedMenu.date,
              category_name: selectedCategory.name,
              quantity
            }
          };

          if (targetType === 'students') {
            transactionData.student_id = selectedPerson.id;
          } else {
            transactionData.teacher_id = selectedPerson.id;
          }

          await supabase.from('transactions').insert([transactionData]);
        }
      }

      // 🆕 Crear transacción pendiente si es "Pagar Luego"
      if (paymentType === 'cash' && cashPaymentMethod === 'pagar_luego' && totalPrice > 0) {
        const transactionData: any = {
          type: 'purchase',
          amount: -Math.abs(totalPrice),
          description: `Almuerzo - ${selectedCategory.name}${quantity > 1 ? ` (${quantity}x)` : ''} - ${format(new Date(selectedMenu.date + 'T00:00:00'), "d 'de' MMMM", { locale: es })} - ${manualName}`,
          payment_status: 'pending',
          school_id: schoolId,
          manual_client_name: manualName,
          ticket_code: ticketCode,
          metadata: {
            lunch_order_id: insertedOrderId,
            source: 'physical_order_wizard_fiado',
            order_date: selectedMenu.date,
            category_name: selectedCategory.name,
            quantity
          }
        };

        const { error: transactionError } = await supabase.from('transactions').insert([transactionData]);
        
        if (transactionError) {
          console.error('❌ Error creando transacción de fiado:', transactionError);
          throw transactionError;
        }

        console.log('✅ Transacción de fiado creada para:', manualName);
      }

      // 🆕 Crear transacción PAGADA para pagos inmediatos (efectivo, tarjeta, yape, transferencia)
      if (paymentType === 'cash' && cashPaymentMethod && cashPaymentMethod !== 'pagar_luego' && totalPrice > 0) {
        const transactionData: any = {
          type: 'purchase',
          amount: -Math.abs(totalPrice),
          description: `Almuerzo - ${selectedCategory.name}${quantity > 1 ? ` (${quantity}x)` : ''} - ${format(new Date(selectedMenu.date + 'T00:00:00'), "d 'de' MMMM", { locale: es })} - ${manualName}`,
          payment_status: 'paid',
          payment_method: cashPaymentMethod,
          school_id: schoolId,
          manual_client_name: manualName,
          ticket_code: ticketCode,
          metadata: {
            lunch_order_id: insertedOrderId,
            source: 'physical_order_wizard_paid',
            order_date: selectedMenu.date,
            category_name: selectedCategory.name,
            quantity,
            payment_details: paymentDetails
          }
        };

        const { error: transactionError } = await supabase.from('transactions').insert([transactionData]);
        
        if (transactionError) {
          console.error('❌ Error creando transacción pagada:', transactionError);
        } else {
          console.log('✅ Transacción PAGADA creada para:', manualName, 'con método:', cashPaymentMethod, 'ticket:', ticketCode);
        }
      }

      const wasUpdated = !!existingOrderForCategory;
      toast({
        title: wasUpdated ? '✅ Pedido actualizado' : '✅ Pedido registrado',
        description: wasUpdated
          ? `Se agregó ${quantity} menú(s) al pedido de ${selectedCategory.name} para ${paymentType === 'credit' ? selectedPerson?.full_name : manualName}. Nuevo total: ${(existingOrderForCategory.quantity || 1) + quantity} menú(s)`
          : `${quantity}x ${selectedCategory.name} para ${paymentType === 'credit' ? selectedPerson?.full_name : manualName}${
            cashPaymentMethod === 'pagar_luego' ? ' (Pago pendiente)' : ticketCode ? ` (Ticket: ${ticketCode})` : ''
          }`
      });

      handleClose();
      onSuccess();
    } catch (error: any) {
      console.error('Error creating order:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo registrar el pedido'
      });
    } finally {
      setLoading(false);
      isSubmittingRef.current = false; // 🔓 Liberar lock
    }
  };

  const filteredPeople = people.filter(p =>
    p.full_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Nuevo Pedido de Almuerzo</DialogTitle>
          {selectedDate && (
            <p className="text-sm text-gray-600 mt-2">
              📅 Pedido para el día: <span className="font-semibold">
                {typeof selectedDate === 'string' 
                  ? format(new Date(selectedDate + 'T00:00:00'), "dd 'de' MMMM, yyyy", { locale: es })
                  : format(selectedDate, "dd 'de' MMMM, yyyy", { locale: es })
                }
              </span>
            </p>
          )}
        </DialogHeader>

        {/* PASO 1: ¿Para quién? */}
        {step === 1 && (
          <div className="space-y-4 py-4">
            <p className="text-center text-gray-600">¿Para quién es el pedido?</p>
            <div className="grid grid-cols-2 gap-4">
              <Card
                className={`p-6 cursor-pointer hover:shadow-lg transition-all ${
                  targetType === 'students' ? 'ring-2 ring-green-500' : ''
                }`}
                onClick={() => setTargetType('students')}
              >
                <div className="text-center">
                  <Users className="h-12 w-12 mx-auto mb-3 text-blue-600" />
                  <h3 className="font-bold text-lg">Alumno</h3>
                </div>
              </Card>
              <Card
                className={`p-6 cursor-pointer hover:shadow-lg transition-all ${
                  targetType === 'teachers' ? 'ring-2 ring-green-500' : ''
                }`}
                onClick={() => setTargetType('teachers')}
              >
                <div className="text-center">
                  <Users className="h-12 w-12 mx-auto mb-3 text-purple-600" />
                  <h3 className="font-bold text-lg">Profesor</h3>
                </div>
              </Card>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={handleClose}>Cancelar</Button>
              <Button onClick={() => setStep(2)} disabled={!targetType}>
                Siguiente <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* PASO 2: ¿Cómo paga? */}
        {step === 2 && (
          <div className="space-y-4 py-4">
            <p className="text-center text-gray-600">¿Cómo desea pagar?</p>
            <div className="grid grid-cols-2 gap-4">
              <Card
                className={`p-6 cursor-pointer hover:shadow-lg transition-all ${
                  paymentType === 'credit' ? 'ring-2 ring-green-500' : ''
                }`}
                onClick={() => setPaymentType('credit')}
              >
                <div className="text-center">
                  <CreditCard className="h-12 w-12 mx-auto mb-3 text-orange-600" />
                  <h3 className="font-bold text-lg">Con Crédito</h3>
                  <p className="text-sm text-gray-500 mt-1">Se carga a su cuenta</p>
                </div>
              </Card>
              <Card
                className={`p-6 cursor-pointer hover:shadow-lg transition-all ${
                  paymentType === 'cash' ? 'ring-2 ring-green-500' : ''
                }`}
                onClick={() => setPaymentType('cash')}
              >
                <div className="text-center">
                  <CreditCard className="h-12 w-12 mx-auto mb-3 text-green-600" />
                  <h3 className="font-bold text-lg">Sin Crédito</h3>
                  <p className="text-sm text-gray-500 mt-1">Pago en efectivo/tarjeta</p>
                </div>
              </Card>
            </div>
            <div className="flex justify-between gap-2 pt-4">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Atrás
              </Button>
              <Button onClick={() => setStep(3)} disabled={!paymentType}>
                Siguiente <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* PASO 3: Seleccionar persona */}
        {step === 3 && (
          <div className="space-y-4 py-4">
            {paymentType === 'credit' ? (
              <>
                <p className="text-center text-gray-600">Selecciona la persona</p>
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Buscar por nombre..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {loading ? (
                    <div className="text-center py-8">
                      <Loader2 className="h-8 w-8 animate-spin mx-auto text-gray-400" />
                    </div>
                  ) : filteredPeople.length === 0 ? (
                    <p className="text-center text-gray-500 py-8">No se encontraron personas</p>
                  ) : (
                    filteredPeople.map((person) => (
                      <Card
                        key={person.id}
                        className={`p-3 cursor-pointer hover:bg-gray-50 ${
                          selectedPerson?.id === person.id ? 'ring-2 ring-green-500' : ''
                        }`}
                        onClick={() => setSelectedPerson(person)}
                      >
                        <p className="font-medium">{person.full_name}</p>
                      </Card>
                    ))
                  )}
                </div>

                {/* 🆕 ADVERTENCIA DE PEDIDOS EXISTENTES - AHORA EN STEP 3 */}
                {selectedPerson && existingOrders.length > 0 && (
                  <div className="bg-orange-50 border-2 border-orange-300 rounded-lg p-4 mt-4 animate-in slide-in-from-top-2">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="h-6 w-6 text-orange-600 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <h4 className="font-bold text-orange-900 text-lg mb-2">
                          ⚠️ {selectedPerson.full_name} ya tiene {existingOrders.length} pedido(s) para este día
                        </h4>
                        <div className="space-y-2 mb-3">
                          {existingOrders.map((order: any, idx: number) => (
                            <div key={order.id} className="bg-white rounded border border-orange-200 p-3 text-sm">
                              <p className="font-semibold text-gray-900">
                                Pedido #{idx + 1}: {order.lunch_menus?.lunch_categories?.name || 'Menú'}
                                {order.quantity > 1 && ` (${order.quantity}x)`}
                              </p>
                              <p className="text-gray-600 text-xs mt-1">
                                🍽️ {order.lunch_menus?.main_course || 'Sin detalles'}
                              </p>
                            </div>
                          ))}
                        </div>
                        <p className="text-sm text-orange-800 font-medium bg-orange-100 rounded px-3 py-2">
                          💡 ¿Deseas agregarle <span className="font-bold">OTRO</span> pedido a {selectedPerson.full_name}?
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="text-center text-gray-600">Escribe el nombre</p>
                <div>
                  <Label>Nombre completo</Label>
                  <Input
                    placeholder="Ej: Juan Pérez"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    className="mt-2"
                  />
                </div>
              </>
            )}
            <div className="flex justify-between gap-2 pt-4">
              <Button variant="outline" onClick={() => setStep(2)}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Atrás
              </Button>
              <Button
                onClick={() => setStep(4)}
                disabled={paymentType === 'credit' ? !selectedPerson : !manualName.trim()}
              >
                Siguiente <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* PASO 4: Seleccionar categoría */}
        {step === 4 && (
          <div className="space-y-4 py-4">
            <p className="text-center text-gray-600">Selecciona el tipo de almuerzo</p>
            {loading ? (
              <div className="text-center py-8">
                <Loader2 className="h-8 w-8 animate-spin mx-auto text-gray-400" />
              </div>
            ) : categories.length === 0 ? (
              <p className="text-center text-gray-500 py-8">No hay categorías disponibles</p>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {categories.map((category) => {
                  const alreadyOrdered = existingOrders.find((o: any) => o.category_id === category.id);
                  return (
                    <Card
                      key={category.id}
                      className={`p-4 cursor-pointer hover:shadow-lg transition-all relative ${
                        selectedCategory?.id === category.id ? 'ring-2 ring-green-500' : ''
                      } ${alreadyOrdered ? 'ring-1 ring-orange-300' : ''}`}
                      style={{ backgroundColor: `${category.color}15` }}
                      onClick={() => setSelectedCategory(category)}
                    >
                      {alreadyOrdered && (
                        <div className="absolute -top-2 -right-2 bg-orange-500 text-white text-[10px] px-2 py-0.5 rounded-full font-bold shadow-sm">
                          Ya pedido ({alreadyOrdered.quantity || 1}x)
                        </div>
                      )}
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-2xl">{category.icon || '🍽️'}</span>
                        <h3 className="font-bold">{category.name}</h3>
                      </div>
                      {category.price && (
                        <p className="text-lg font-bold mt-2" style={{ color: category.color }}>
                          S/ {category.price.toFixed(2)}
                        </p>
                      )}
                      {alreadyOrdered && (
                        <p className="text-xs text-orange-600 mt-1">Seleccionar para agregar más</p>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
            <div className="flex justify-between gap-2 pt-4">
              <Button variant="outline" onClick={() => setStep(3)}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Atrás
              </Button>
              <Button onClick={() => setStep(5)} disabled={!selectedCategory}>
                Siguiente <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* PASO 5: Seleccionar menú (o opciones de plato configurable) */}
        {step === 5 && (
          <div className="space-y-4 py-4">
            {/* ── Plato Configurable: mostrar opciones ── */}
            {selectedCategory?.menu_mode === 'configurable' ? (
              <>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="font-semibold text-amber-900">🍽️ {selectedCategory.name}</p>
                  <p className="text-xs text-amber-700">Selecciona las opciones para este plato</p>
                </div>

                {loading ? (
                  <div className="text-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-amber-400" />
                  </div>
                ) : configPlateGroups.length === 0 ? (
                  <div className="text-center py-6 text-gray-500">
                    <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-amber-400" />
                    <p className="text-sm">No hay opciones configuradas para esta categoría</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {configPlateGroups.map((group) => {
                      const currentSel = configSelections.find(s => s.group_name === group.name);
                      return (
                        <div key={group.id} className="bg-white rounded-lg border-2 border-amber-200 p-3 space-y-2">
                          <p className="font-semibold text-sm text-amber-900">
                            {group.name}
                            {group.is_required && <span className="text-red-500 ml-1">*</span>}
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            {group.options.map(opt => {
                              const isSelected = currentSel?.selected === opt.name;
                              return (
                                <button
                                  key={opt.id}
                                  type="button"
                                  onClick={() => {
                                    setConfigSelections(prev =>
                                      prev.map(s => s.group_name === group.name ? { ...s, selected: opt.name } : s)
                                    );
                                  }}
                                  className={`p-2.5 rounded-lg border-2 text-xs text-left transition-all ${
                                    isSelected
                                      ? 'border-amber-500 bg-amber-50 text-amber-900 font-semibold'
                                      : 'border-gray-200 hover:border-amber-300 text-gray-700'
                                  }`}
                                >
                                  {isSelected ? '✓ ' : ''}{opt.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Info: se auto-selecciona el primer menú disponible */}
              </>
            ) : (
              /* ── Menú Estándar: selector normal ── */
              <>
                <p className="text-center text-gray-600">
                  Selecciona el menú 
                  {selectedDate && ` del ${format(new Date((typeof selectedDate === 'string' ? selectedDate : format(selectedDate, 'yyyy-MM-dd')) + 'T00:00:00'), "dd 'de' MMMM", { locale: es })}`}
                </p>
                {loading ? (
                  <div className="text-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-gray-400" />
                  </div>
                ) : menus.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-gray-500 mb-2">❌ No hay menús disponibles</p>
                    {selectedDate && (
                      <p className="text-sm text-gray-400">
                        Para el día {format(new Date((typeof selectedDate === 'string' ? selectedDate : format(selectedDate, 'yyyy-MM-dd')) + 'T00:00:00'), "dd 'de' MMMM, yyyy", { locale: es })}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {menus.map((menu: any) => (
                      <Card
                        key={menu.id}
                        className={`p-4 cursor-pointer hover:shadow-lg transition-all ${
                          selectedMenu?.id === menu.id ? 'ring-2 ring-green-500' : ''
                        }`}
                        onClick={() => { setSelectedMenu(menu); loadModifiersForMenu(menu); }}
                      >
                        <div className="flex items-start justify-between">
                          <p className="font-bold mb-2">
                            {format(new Date(menu.date + 'T00:00:00'), "EEEE d 'de' MMMM", { locale: es })}
                          </p>
                          {menu.allows_modifiers && (
                            <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-semibold">✨ Personalizable</span>
                          )}
                        </div>
                        <div className="text-sm space-y-1">
                          {menu.starter && <p>• Entrada: {menu.starter}</p>}
                          <p className="font-medium text-green-700">• Segundo: {menu.main_course}</p>
                          {menu.beverage && <p>• Bebida: {menu.beverage}</p>}
                          {menu.dessert && <p>• Postre: {menu.dessert}</p>}
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* ── Opciones de personalización (si el menú las tiene) ── */}
            {selectedMenu && loadingModifiers && (
              <div className="text-center py-3">
                <Loader2 className="h-5 w-5 animate-spin mx-auto text-purple-500" />
                <p className="text-xs text-gray-500 mt-1">Cargando opciones...</p>
              </div>
            )}
            {selectedMenu && !loadingModifiers && menuModifiers.length > 0 && (
              <div className="space-y-3 border-t pt-3 mt-1">
                <p className="text-sm font-semibold text-purple-700">✨ Personaliza el pedido:</p>
                {menuModifiers.map(group => {
                  const sel = selectedModifiers.find(m => m.group_id === group.id);
                  const fieldEmoji: Record<string, string> = {
                    'Entrada': '🥗', 'Segundo Plato': '🍲', 'Bebida': '🥤', 'Postre': '🍰',
                  };
                  return (
                    <div key={group.id} className="bg-gray-50 rounded-lg p-3 space-y-2">
                      <p className="text-sm font-medium text-gray-700">{fieldEmoji[group.name] || '🍽️'} {group.name}</p>
                      <div className="grid grid-cols-2 gap-2">
                        {group.options.map(opt => {
                          const isSelected = sel?.selected_option_id === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => setSelectedModifiers(prev =>
                                prev.map(m => m.group_id === group.id
                                  ? { ...m, selected_option_id: opt.id, selected_name: opt.name }
                                  : m
                                )
                              )}
                              className={`p-2 rounded-lg border-2 text-xs text-left transition-all ${
                                isSelected ? 'border-purple-500 bg-purple-50 text-purple-900 font-semibold' : 'border-gray-200 hover:border-purple-300 text-gray-700'
                              }`}
                            >
                              {isSelected ? '✓ ' : ''}{opt.name}
                            </button>
                          );
                        })}
                        {/* Botón quitar */}
                        <button
                          type="button"
                          onClick={() => setSelectedModifiers(prev =>
                            prev.map(m => m.group_id === group.id
                              ? { ...m, selected_option_id: 'skip', selected_name: `Sin ${group.name.toLowerCase()}` }
                              : m
                            )
                          )}
                          className={`p-2 rounded-lg border-2 text-xs text-left transition-all ${
                            sel?.selected_option_id === 'skip'
                              ? 'border-gray-500 bg-gray-100 text-gray-700 font-semibold'
                              : 'border-dashed border-gray-300 hover:border-gray-400 text-gray-400'
                          }`}
                        >
                          {sel?.selected_option_id === 'skip' ? '✓ ' : ''}Sin {group.name.toLowerCase()}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Guarniciones opcionales ── */}
            {selectedMenu && availableGarnishes.length > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 space-y-2">
                <p className="text-sm font-semibold text-orange-800">🍟 Guarniciones opcionales:</p>
                <div className="flex flex-wrap gap-2">
                  {availableGarnishes.map((garnish) => {
                    const isSelected = selectedGarnishes.has(garnish);
                    return (
                      <button
                        key={garnish}
                        type="button"
                        onClick={() => {
                          setSelectedGarnishes(prev => {
                            const newSet = new Set(prev);
                            if (newSet.has(garnish)) {
                              newSet.delete(garnish);
                            } else {
                              newSet.add(garnish);
                            }
                            return newSet;
                          });
                        }}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                          isSelected
                            ? 'bg-orange-600 text-white border-2 border-orange-700'
                            : 'bg-white text-orange-700 border-2 border-orange-300 hover:border-orange-500'
                        }`}
                      >
                        {isSelected ? '✓ ' : ''}{garnish}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex justify-between gap-2 pt-4">
              <Button variant="outline" onClick={() => setStep(4)}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Atrás
              </Button>
              <Button
                onClick={async () => {
                  // 🆕 Verificar pedidos existentes antes de continuar (SIN FK join)
                  if (selectedPerson && selectedDate) {
                    setLoading(true);
                    try {
                      const targetDate = typeof selectedDate === 'string' ? selectedDate : format(selectedDate, 'yyyy-MM-dd');
                      const personField = targetType === 'students' ? 'student_id' : 'teacher_id';
                      
                      const { data: orders, error } = await supabase
                        .from('lunch_orders')
                        .select('id, order_date, status, quantity, is_cancelled, category_id, menu_id')
                        .eq(personField, selectedPerson.id)
                        .eq('order_date', targetDate)
                        .eq('is_cancelled', false);

                      if (error) throw error;
                      
                      // Enriquecer con nombres de categorías (consulta separada)
                      if (orders && orders.length > 0) {
                        const categoryIds = [...new Set(orders.map(o => o.category_id).filter(Boolean))];
                        const menuIds = [...new Set(orders.map(o => o.menu_id).filter(Boolean))];
                        
                        let categoriesMap: Record<string, string> = {};
                        let menusMap: Record<string, string> = {};
                        
                        if (categoryIds.length > 0) {
                          const { data: cats } = await supabase
                            .from('lunch_categories')
                            .select('id, name')
                            .in('id', categoryIds);
                          cats?.forEach(c => { categoriesMap[c.id] = c.name; });
                        }
                        
                        if (menuIds.length > 0) {
                          const { data: menus } = await supabase
                            .from('lunch_menus')
                            .select('id, main_course')
                            .in('id', menuIds);
                          menus?.forEach(m => { menusMap[m.id] = m.main_course; });
                        }
                        
                        const enriched = orders.map(o => ({
                          ...o,
                          lunch_menus: {
                            main_course: menusMap[o.menu_id] || 'Sin detalles',
                            lunch_categories: {
                              name: categoriesMap[o.category_id] || 'Sin categoría'
                            }
                          }
                        }));
                        setExistingOrders(enriched);
                      } else {
                        setExistingOrders([]);
                      }
                    } catch (error) {
                      console.error('Error al verificar pedidos existentes:', error);
                    } finally {
                      setLoading(false);
                    }
                  }
                  setStep(6); // 🔧 Ir a paso 6 (cantidad)
                }}
                disabled={!selectedMenu || loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verificando...
                  </>
                ) : (
                  <>
                    Siguiente <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* PASO 6: Cantidad y advertencia de pedidos existentes */}
        {step === 6 && paymentType === 'credit' && (
          <div className="space-y-4 py-4">
            {/* 🆕 Aviso si ya existe un pedido de esta categoría */}
            {(() => {
              const existingForCat = existingOrders.find((o: any) => o.category_id === selectedCategory?.id);
              if (existingForCat) {
                return (
                  <div className="bg-orange-50 border border-orange-300 rounded-lg p-3 text-sm">
                    <p className="font-semibold text-orange-900 flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" />
                      {selectedPerson?.full_name} ya tiene {existingForCat.quantity || 1} menú(s) de {selectedCategory?.name}
                    </p>
                    <p className="text-orange-700 mt-1">
                      Los menús que agregues se <strong>sumarán</strong> al pedido existente.
                    </p>
                  </div>
                );
              }
              return null;
            })()}

            {/* Selector de cantidad */}
            <div className="space-y-3">
              <Label className="text-lg font-semibold">
                {existingOrders.find((o: any) => o.category_id === selectedCategory?.id)
                  ? '¿Cuántos menús adicionales?'
                  : '¿Cuántos menús desea ordenar?'}
              </Label>
              <div className="flex items-center justify-center gap-4 py-6">
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  disabled={quantity <= 1}
                  className="h-16 w-16 rounded-full"
                >
                  <Minus className="h-6 w-6" />
                </Button>
                
                <div className="text-center min-w-[120px]">
                  <p className="text-5xl font-bold text-blue-600">{quantity}</p>
                  <p className="text-sm text-gray-500 mt-1">
                    {quantity === 1 ? 'menú' : 'menús'}
                    {existingOrders.find((o: any) => o.category_id === selectedCategory?.id) && ' adicional(es)'}
                  </p>
                </div>
                
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => setQuantity(Math.min(10, quantity + 1))}
                  disabled={quantity >= 10}
                  className="h-16 w-16 rounded-full"
                >
                  <Plus className="h-6 w-6" />
                </Button>
              </div>

              {/* Resumen del precio total */}
              <div className="bg-blue-50 rounded-lg p-4 text-center">
                <p className="text-sm text-gray-600 mb-1">Precio por menú:</p>
                <p className="text-lg font-semibold text-gray-900">
                  S/ {selectedCategory?.price?.toFixed(2) || '0.00'}
                </p>
                <div className="border-t border-blue-200 mt-2 pt-2">
                  <p className="text-sm text-gray-600 mb-1">Total a pagar:</p>
                  <p className="text-3xl font-bold text-blue-700">
                    S/ {((selectedCategory?.price || 0) * quantity).toFixed(2)}
                  </p>
                </div>
                {(() => {
                  const existingForCat = existingOrders.find((o: any) => o.category_id === selectedCategory?.id);
                  if (existingForCat) {
                    const newTotal = (existingForCat.quantity || 1) + quantity;
                    return (
                      <div className="border-t border-blue-200 mt-2 pt-2">
                        <p className="text-xs text-gray-500">Nuevo total del pedido: <strong>{newTotal} menú(s)</strong></p>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            </div>

            <div className="flex justify-between gap-2 pt-4">
              <Button variant="outline" onClick={() => setStep(5)}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Atrás
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Confirmar Pedido
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* PASO 6: Cantidad y advertencia (para "Sin Crédito" también) */}
        {step === 6 && paymentType === 'cash' && (
          <div className="space-y-4 py-4">
            {/* Selector de cantidad */}
            <div className="space-y-3">
              <Label className="text-lg font-semibold">¿Cuántos menús desea ordenar?</Label>
              <div className="flex items-center justify-center gap-4 py-6">
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  disabled={quantity <= 1}
                  className="h-16 w-16 rounded-full"
                >
                  <Minus className="h-6 w-6" />
                </Button>
                
                <div className="text-center min-w-[120px]">
                  <p className="text-5xl font-bold text-blue-600">{quantity}</p>
                  <p className="text-sm text-gray-500 mt-1">
                    {quantity === 1 ? 'menú' : 'menús'}
                  </p>
                </div>
                
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => setQuantity(Math.min(10, quantity + 1))}
                  disabled={quantity >= 10}
                  className="h-16 w-16 rounded-full"
                >
                  <Plus className="h-6 w-6" />
                </Button>
              </div>

              {/* Resumen del precio total */}
              <div className="bg-blue-50 rounded-lg p-4 text-center">
                <p className="text-sm text-gray-600 mb-1">Precio por menú:</p>
                <p className="text-lg font-semibold text-gray-900">
                  S/ {selectedCategory?.price?.toFixed(2) || '0.00'}
                </p>
                <div className="border-t border-blue-200 mt-2 pt-2">
                  <p className="text-sm text-gray-600 mb-1">Total a pagar:</p>
                  <p className="text-3xl font-bold text-blue-700">
                    S/ {((selectedCategory?.price || 0) * quantity).toFixed(2)}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-between gap-2 pt-4">
              <Button variant="outline" onClick={() => setStep(5)}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Atrás
              </Button>
              <Button
                onClick={() => setStep(7)} // 🔧 Ir a paso 7 (método de pago)
                disabled={loading}
              >
                Siguiente <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* PASO 7: Método de pago (solo sin crédito) - RENUMERADO */}
        {step === 7 && paymentType === 'cash' && (
          <div className="space-y-4 py-4">
            <p className="text-center text-gray-600 font-medium">Selecciona el método de pago</p>
            
            {/* Selector de método */}
            {!cashPaymentMethod && (
              <div className="grid grid-cols-2 gap-4">
                {[
                  { value: 'efectivo', label: 'Efectivo', icon: '💵' },
                  { value: 'tarjeta', label: 'Tarjeta', icon: '💳' },
                  { value: 'yape', label: 'Yape/Plin', icon: '📱' },
                  { value: 'transferencia', label: 'Transferencia', icon: '🏦' },
                  { value: 'pagar_luego', label: 'Pagar Luego', icon: '📝', highlight: true },
                ].map((method) => (
                  <Card
                    key={method.value}
                    className={`p-4 cursor-pointer hover:shadow-lg transition-all ${
                      method.highlight ? 'border-2 border-orange-400 bg-orange-50' : ''
                    }`}
                    onClick={() => setCashPaymentMethod(method.value as any)}
                  >
                    <div className="text-center">
                      <span className="text-3xl mb-2 block">{method.icon}</span>
                      <p className={`font-medium ${method.highlight ? 'text-orange-700' : ''}`}>
                        {method.label}
                      </p>
                    </div>
                  </Card>
                ))}
              </div>
            )}

            {/* FORMULARIO: EFECTIVO */}
            {cashPaymentMethod === 'efectivo' && (
              <div className="space-y-4 border-t pt-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-lg">💵 Pago en Efectivo</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCashPaymentMethod(null);
                      setPaymentDetails(prev => ({ ...prev, currency: 'soles', amountReceived: '', change: 0 }));
                    }}
                  >
                    Cambiar
                  </Button>
                </div>

                {/* Monto del almuerzo */}
                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-sm text-gray-600">Monto a pagar:</p>
                  <p className="text-2xl font-bold text-blue-700">
                    S/ {(((selectedCategory?.price || 0) * quantity).toFixed(2))}
                  </p>
                  {quantity > 1 && (
                    <p className="text-xs text-gray-500 mt-1">
                      {quantity} menús × S/ {selectedCategory?.price?.toFixed(2)}
                    </p>
                  )}
                </div>

                {/* Tipo de moneda */}
                <div>
                  <Label>Tipo de moneda</Label>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <Button
                      type="button"
                      variant={paymentDetails.currency === 'soles' ? 'default' : 'outline'}
                      onClick={() => setPaymentDetails(prev => ({ ...prev, currency: 'soles' }))}
                    >
                      🇵🇪 Soles (S/)
                    </Button>
                    <Button
                      type="button"
                      variant={paymentDetails.currency === 'dolares' ? 'default' : 'outline'}
                      onClick={() => setPaymentDetails(prev => ({ ...prev, currency: 'dolares' }))}
                    >
                      🇺🇸 Dólares ($)
                    </Button>
                  </div>
                </div>

                {/* Monto recibido */}
                <div>
                  <Label>Monto recibido</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={paymentDetails.amountReceived}
                    onChange={(e) => setPaymentDetails(prev => ({ ...prev, amountReceived: e.target.value }))}
                    className="mt-2 text-lg"
                  />
                </div>

                {/* Vuelto (calculado automáticamente) */}
                {paymentDetails.amountReceived && (
                  <div className={`p-4 rounded-lg ${paymentDetails.change >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                    <p className="text-sm text-gray-600 mb-1">Vuelto:</p>
                    <p className={`text-3xl font-bold ${paymentDetails.change >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      S/ {paymentDetails.change.toFixed(2)}
                    </p>
                    {paymentDetails.change < 0 && (
                      <p className="text-sm text-red-600 mt-2">⚠️ Monto insuficiente</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* FORMULARIO: TARJETA */}
            {cashPaymentMethod === 'tarjeta' && (
              <div className="space-y-4 border-t pt-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-lg">💳 Pago con Tarjeta</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCashPaymentMethod(null);
                      setPaymentDetails(prev => ({ ...prev, operationNumber: '', cardType: '' }));
                    }}
                  >
                    Cambiar
                  </Button>
                </div>

                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-sm text-gray-600">Monto:</p>
                  <p className="text-2xl font-bold text-blue-700">
                    S/ {(((selectedCategory?.price || 0) * quantity).toFixed(2))}
                  </p>
                  {quantity > 1 && (
                    <p className="text-xs text-gray-500 mt-1">
                      {quantity} menús × S/ {selectedCategory?.price?.toFixed(2)}
                    </p>
                  )}
                </div>

                <div>
                  <Label>Tipo de tarjeta</Label>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {['Visa', 'Mastercard', 'American Express', 'Otra'].map((card) => (
                      <Button
                        key={card}
                        type="button"
                        variant={paymentDetails.cardType === card ? 'default' : 'outline'}
                        onClick={() => setPaymentDetails(prev => ({ ...prev, cardType: card }))}
                        className="text-sm"
                      >
                        {card}
                      </Button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label>Número de operación</Label>
                  <Input
                    type="text"
                    placeholder="Ej: 123456789"
                    value={paymentDetails.operationNumber}
                    onChange={(e) => setPaymentDetails(prev => ({ ...prev, operationNumber: e.target.value }))}
                    className="mt-2"
                  />
                </div>
              </div>
            )}

            {/* FORMULARIO: YAPE/PLIN */}
            {cashPaymentMethod === 'yape' && (
              <div className="space-y-4 border-t pt-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-lg">📱 Yape / Plin</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCashPaymentMethod(null);
                      setPaymentDetails(prev => ({ ...prev, operationNumber: '', yapeType: 'yape' }));
                    }}
                  >
                    Cambiar
                  </Button>
                </div>

                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-sm text-gray-600">Monto:</p>
                  <p className="text-2xl font-bold text-blue-700">
                    S/ {selectedCategory?.price?.toFixed(2) || '0.00'}
                  </p>
                </div>

                <div>
                  <Label>Tipo de pago</Label>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <Button
                      type="button"
                      variant={paymentDetails.yapeType === 'yape' ? 'default' : 'outline'}
                      onClick={() => setPaymentDetails(prev => ({ ...prev, yapeType: 'yape' }))}
                    >
                      Yape
                    </Button>
                    <Button
                      type="button"
                      variant={paymentDetails.yapeType === 'plin' ? 'default' : 'outline'}
                      onClick={() => setPaymentDetails(prev => ({ ...prev, yapeType: 'plin' }))}
                    >
                      Plin
                    </Button>
                  </div>
                </div>

                <div>
                  <Label>Número de operación</Label>
                  <Input
                    type="text"
                    placeholder="Ej: 987654321"
                    value={paymentDetails.operationNumber}
                    onChange={(e) => setPaymentDetails(prev => ({ ...prev, operationNumber: e.target.value }))}
                    className="mt-2"
                  />
                </div>
              </div>
            )}

            {/* FORMULARIO: TRANSFERENCIA */}
            {cashPaymentMethod === 'transferencia' && (
              <div className="space-y-4 border-t pt-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-lg">🏦 Transferencia Bancaria</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCashPaymentMethod(null);
                      setPaymentDetails(prev => ({ ...prev, operationNumber: '', bankName: '' }));
                    }}
                  >
                    Cambiar
                  </Button>
                </div>

                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-sm text-gray-600">Monto:</p>
                  <p className="text-2xl font-bold text-blue-700">
                    S/ {selectedCategory?.price?.toFixed(2) || '0.00'}
                  </p>
                </div>

                <div>
                  <Label>Banco</Label>
                  <Input
                    type="text"
                    placeholder="Ej: BCP, Interbank, BBVA..."
                    value={paymentDetails.bankName}
                    onChange={(e) => setPaymentDetails(prev => ({ ...prev, bankName: e.target.value }))}
                    className="mt-2"
                  />
                </div>

                <div>
                  <Label>Número de operación</Label>
                  <Input
                    type="text"
                    placeholder="Ej: 123456789"
                    value={paymentDetails.operationNumber}
                    onChange={(e) => setPaymentDetails(prev => ({ ...prev, operationNumber: e.target.value }))}
                    className="mt-2"
                  />
                </div>
              </div>
            )}

            {/* FORMULARIO: PAGAR LUEGO */}
            {cashPaymentMethod === 'pagar_luego' && (
              <div className="space-y-4 border-t pt-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-lg">📝 Pagar Luego (Fiado)</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCashPaymentMethod(null);
                    }}
                  >
                    Cambiar
                  </Button>
                </div>

                <Alert className="bg-orange-50 border-orange-200">
                  <AlertTriangle className="h-4 w-4 text-orange-600" />
                  <AlertDescription className="text-orange-800">
                    Este pedido se registrará como <strong>deuda pendiente</strong> y aparecerá en el módulo de Cobranzas para su posterior pago.
                  </AlertDescription>
                </Alert>

                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-sm text-gray-600">Monto a pagar después:</p>
                  <p className="text-2xl font-bold text-blue-700">
                    S/ {(((selectedCategory?.price || 0) * quantity).toFixed(2))}
                  </p>
                  {quantity > 1 && (
                    <p className="text-xs text-gray-500 mt-1">
                      {quantity} menús × S/ {selectedCategory?.price?.toFixed(2)}
                    </p>
                  )}
                </div>

                <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-200">
                  <p className="text-sm font-medium text-yellow-800">
                    ✓ El pedido quedará registrado a nombre de: <strong>{manualName}</strong>
                  </p>
                  <p className="text-xs text-yellow-600 mt-1">
                    Podrá pagar en el módulo de Cobranzas cuando lo desee
                  </p>
                </div>
              </div>
            )}

            {/* Botones de navegación */}
            <div className="flex justify-between gap-2 pt-4 border-t">
              <Button variant="outline" onClick={() => setStep(6)}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Atrás
              </Button>
              <Button 
                onClick={handleSubmit} 
                disabled={!cashPaymentMethod || loading || !isPaymentDetailsComplete()}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Confirmar Pedido
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
