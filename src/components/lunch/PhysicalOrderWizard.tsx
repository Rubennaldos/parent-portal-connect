import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Users, CreditCard, Search, ArrowRight, ArrowLeft, Check, Loader2, AlertTriangle } from 'lucide-react';
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
}

interface LunchMenu {
  id: string;
  date: string;
  starter: string | null;
  main_course: string;
  beverage: string | null;
  dessert: string | null;
  category_id: string;
}

interface Person {
  id: string;
  full_name: string;
}

export function PhysicalOrderWizard({ isOpen, onClose, schoolId, selectedDate, onSuccess }: PhysicalOrderWizardProps) {
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Datos del wizard
  const [targetType, setTargetType] = useState<'students' | 'teachers' | null>(null);
  const [paymentType, setPaymentType] = useState<'credit' | 'cash' | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [manualName, setManualName] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<LunchCategory | null>(null);
  const [selectedMenu, setSelectedMenu] = useState<LunchMenu | null>(null);
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

  const handleClose = () => {
    setStep(1);
    setTargetType(null);
    setPaymentType(null);
    setSelectedPerson(null);
    setManualName('');
    setSelectedCategory(null);
    setSelectedMenu(null);
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
      fetchMenus();
    }
  }, [step, selectedCategory]);

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
      
      // OPCIÓN 1: Intentar con la foreign key explícita
      console.log('🔧 [fetchCategories] Intentando query con FK explícita...');
      let { data: menusData, error: menusError } = await supabase
        .from('lunch_menus')
        .select(`
          id,
          category_id,
          date,
          lunch_categories!lunch_menus_category_id_fkey (
            id,
            name,
            icon,
            color,
            price,
            display_order
          )
        `)
        .eq('school_id', schoolId)
        .eq('date', targetDate)
        .eq('target_type', targetType);

      // Si hay error, intentar sin especificar FK
      if (menusError) {
        console.log('❌ [fetchCategories] Error con FK explícita:', menusError);
        console.log('🔧 [fetchCategories] Intentando query sin FK explícita...');
        
        const result = await supabase
          .from('lunch_menus')
          .select(`
            id,
            category_id,
            date
          `)
          .eq('school_id', schoolId)
          .eq('date', targetDate)
          .eq('target_type', targetType);
          
        menusData = result.data;
        menusError = result.error;
        
        if (menusError) {
          console.log('❌ [fetchCategories] Error sin FK:', menusError);
          throw menusError;
        }
        
        console.log('✅ [fetchCategories] Menús encontrados:', menusData?.length || 0);
        
        // Si no hay error, buscar las categorías por separado
        if (menusData && menusData.length > 0) {
          const categoryIds = [...new Set(menusData.map((m: any) => m.category_id))];
          console.log('📋 [fetchCategories] IDs de categorías:', categoryIds);
          
          const { data: categoriesData, error: categoriesError } = await supabase
            .from('lunch_categories')
            .select('*')
            .in('id', categoryIds);
            
          if (categoriesError) {
            console.log('❌ [fetchCategories] Error buscando categorías:', categoriesError);
            throw categoriesError;
          }
          
          console.log('✅ [fetchCategories] Categorías encontradas:', categoriesData?.length || 0);
          setCategories(categoriesData || []);
          return;
        }
      } else {
        console.log('✅ [fetchCategories] Query con FK exitosa');
        console.log('📊 [fetchCategories] Menús encontrados:', menusData?.length || 0);
        
        // Extraer categorías únicas de los menús encontrados
        const uniqueCategories = new Map();
        menusData?.forEach((menu: any) => {
          if (menu.lunch_categories && !uniqueCategories.has(menu.lunch_categories.id)) {
            uniqueCategories.set(menu.lunch_categories.id, menu.lunch_categories);
          }
        });
        
        const categoriesArray = Array.from(uniqueCategories.values());
        console.log('📋 [fetchCategories] Categorías únicas:', categoriesArray.length);
        console.log('📝 [fetchCategories] Categorías:', categoriesArray);
        
        setCategories(categoriesArray);
      }
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
      
      // OPCIÓN 1: Intentar con la foreign key explícita
      console.log('🔧 [fetchMenus] Intentando query con FK explícita...');
      let { data, error } = await supabase
        .from('lunch_menus')
        .select(`
          *,
          lunch_categories!lunch_menus_category_id_fkey (
            id,
            name,
            icon,
            color,
            price
          )
        `)
        .eq('school_id', schoolId)
        .eq('category_id', selectedCategory?.id)
        .eq('date', targetDate)
        .eq('target_type', targetType);

      // Si hay error con FK, intentar sin FK
      if (error) {
        console.log('❌ [fetchMenus] Error con FK explícita:', error);
        console.log('🔧 [fetchMenus] Intentando query sin FK (solo menús)...');
        
        const result = await supabase
          .from('lunch_menus')
          .select('*')
          .eq('school_id', schoolId)
          .eq('category_id', selectedCategory?.id)
          .eq('date', targetDate)
          .eq('target_type', targetType);
          
        data = result.data;
        error = result.error;
        
        if (error) {
          console.log('❌ [fetchMenus] Error sin FK:', error);
          throw error;
        }
        
        console.log('✅ [fetchMenus] Menús encontrados (sin FK):', data?.length || 0);
        
        // Agregar la categoría manualmente a cada menú
        if (data && data.length > 0) {
          data = data.map((menu: any) => ({
            ...menu,
            lunch_categories: selectedCategory
          }));
          console.log('✅ [fetchMenus] Categoría agregada manualmente a los menús');
        }
      } else {
        console.log('✅ [fetchMenus] Query con FK exitosa');
        console.log('📊 [fetchMenus] Menús encontrados:', data?.length || 0);
      }
      
      console.log('📝 [fetchMenus] Menús finales:', data);
      setMenus(data || []);
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

    try {
      setLoading(true);

      // Crear pedido
      const orderData: any = {
        menu_id: selectedMenu.id,
        order_date: selectedMenu.date,
        status: 'confirmed',
        category_id: selectedCategory.id,
        school_id: schoolId, // Agregar school_id del admin que crea el pedido
      };

      if (paymentType === 'credit') {
        if (targetType === 'students') {
          orderData.student_id = selectedPerson?.id;
        } else {
          orderData.teacher_id = selectedPerson?.id;
        }
      } else {
        // Sin crédito: guardar nombre manual y detalles de pago
        orderData.manual_name = manualName;
        orderData.payment_method = cashPaymentMethod;
        
        // Solo guardar payment_details si NO es "pagar_luego"
        if (cashPaymentMethod !== 'pagar_luego') {
          orderData.payment_details = paymentDetails;
        }
      }

      const { error: orderError } = await supabase
        .from('lunch_orders')
        .insert([orderData]);

      if (orderError) throw orderError;

      // Crear transacción si es con crédito
      if (paymentType === 'credit' && selectedPerson && selectedCategory.price && selectedCategory.price > 0) {
        const transactionData: any = {
          type: 'purchase',
          amount: -Math.abs(selectedCategory.price),
          description: `Almuerzo - ${selectedCategory.name} - ${format(new Date(selectedMenu.date + 'T00:00:00'), "d 'de' MMMM", { locale: es })}`,
          payment_status: 'pending', // 📝 Deuda pendiente
          school_id: schoolId,
        };

        if (targetType === 'students') {
          transactionData.student_id = selectedPerson.id;
        } else {
          transactionData.teacher_id = selectedPerson.id;
        }

        await supabase.from('transactions').insert([transactionData]);
      }

      // 🆕 Crear transacción pendiente si es "Pagar Luego"
      if (paymentType === 'cash' && cashPaymentMethod === 'pagar_luego' && selectedCategory.price && selectedCategory.price > 0) {
        const transactionData: any = {
          type: 'purchase',
          amount: -Math.abs(selectedCategory.price),
          description: `Almuerzo - ${selectedCategory.name} - ${format(new Date(selectedMenu.date + 'T00:00:00'), "d 'de' MMMM", { locale: es })} - ${manualName}`,
          payment_status: 'pending', // 📝 Deuda pendiente (fiado)
          school_id: schoolId,
          manual_client_name: manualName, // 👤 Guardar el nombre del cliente
        };

        const { error: transactionError } = await supabase.from('transactions').insert([transactionData]);
        
        if (transactionError) {
          console.error('❌ Error creando transacción de fiado:', transactionError);
          throw transactionError;
        }

        console.log('✅ Transacción de fiado creada para:', manualName);
      }

      toast({
        title: '✅ Pedido registrado',
        description: `Almuerzo para ${paymentType === 'credit' ? selectedPerson?.full_name : manualName}${
          cashPaymentMethod === 'pagar_luego' ? ' (Pago pendiente)' : ''
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
                {categories.map((category) => (
                  <Card
                    key={category.id}
                    className={`p-4 cursor-pointer hover:shadow-lg transition-all ${
                      selectedCategory?.id === category.id ? 'ring-2 ring-green-500' : ''
                    }`}
                    style={{ backgroundColor: `${category.color}15` }}
                    onClick={() => setSelectedCategory(category)}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-2xl">{category.icon || '🍽️'}</span>
                      <h3 className="font-bold">{category.name}</h3>
                    </div>
                    {category.price && (
                      <p className="text-lg font-bold mt-2" style={{ color: category.color }}>
                        S/ {category.price.toFixed(2)}
                      </p>
                    )}
                  </Card>
                ))}
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

        {/* PASO 5: Seleccionar menú */}
        {step === 5 && (
          <div className="space-y-4 py-4">
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
                    onClick={() => setSelectedMenu(menu)}
                  >
                    <p className="font-bold mb-2">
                      {format(new Date(menu.date + 'T00:00:00'), "EEEE d 'de' MMMM", { locale: es })}
                    </p>
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
            <div className="flex justify-between gap-2 pt-4">
              <Button variant="outline" onClick={() => setStep(4)}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Atrás
              </Button>
              <Button
                onClick={() => paymentType === 'cash' ? setStep(6) : handleSubmit()}
                disabled={!selectedMenu || loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Guardando...
                  </>
                ) : paymentType === 'cash' ? (
                  <>
                    Siguiente <ArrowRight className="ml-2 h-4 w-4" />
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

        {/* PASO 6: Método de pago (solo sin crédito) */}
        {step === 6 && paymentType === 'cash' && (
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
                    S/ {selectedCategory?.price?.toFixed(2) || '0.00'}
                  </p>
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
                    S/ {selectedCategory?.price?.toFixed(2) || '0.00'}
                  </p>
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
                    S/ {selectedCategory?.price?.toFixed(2) || '0.00'}
                  </p>
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
              <Button variant="outline" onClick={() => setStep(5)}>
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
