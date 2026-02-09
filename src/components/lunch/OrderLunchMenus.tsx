import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { 
  UtensilsCrossed, 
  Calendar,
  ChevronRight,
  Check,
  Loader2,
  Users,
  Clock,
  ShoppingCart,
  AlertCircle,
  Sparkles,
  Package
} from 'lucide-react';
import { format, addDays, startOfWeek, endOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

interface LunchCategory {
  id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  price: number | null;
  target_type: 'students' | 'teachers' | 'both';
}

interface LunchMenu {
  id: string;
  date: string;
  starter: string | null;
  main_course: string;
  beverage: string | null;
  dessert: string | null;
  notes: string | null;
  category_id: string | null;
  category?: LunchCategory | null;
}

interface Student {
  id: string;
  full_name: string;
  photo_url: string | null;
  school_id: string;
}

interface CategoryAddon {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price: number;
  is_active: boolean;
}

interface OrderLunchMenusProps {
  userType: 'parent' | 'teacher';
  userId: string;
  userSchoolId: string;
}

// Mapeo de iconos
const ICON_MAP: Record<string, any> = {
  utensils: UtensilsCrossed,
  salad: Sparkles,
  coins: ShoppingCart,
  leaf: Sparkles,
  briefcase: Users,
  sparkles: Sparkles,
};

export function OrderLunchMenus({ userType, userId, userSchoolId }: OrderLunchMenusProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [weekMenus, setWeekMenus] = useState<LunchMenu[]>([]);
  const [selectedMenu, setSelectedMenu] = useState<LunchMenu | null>(null);
  const [orderDialogOpen, setOrderDialogOpen] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  
  // Estados para agregados
  const [availableAddons, setAvailableAddons] = useState<CategoryAddon[]>([]);
  const [selectedAddons, setSelectedAddons] = useState<Set<string>>(new Set());
  const [loadingAddons, setLoadingAddons] = useState(false);

  // ⏰ Estado para configuración de hora límite
  const [lunchConfig, setLunchConfig] = useState<{ order_deadline_time?: string; order_deadline_days?: number } | null>(null);

  // Cargar estudiantes (solo para padres)
  useEffect(() => {
    if (userType === 'parent') {
      fetchStudents();
    } else {
      setLoading(false);
    }
  }, [userType, userId]);

  // Cargar menús de la semana
  useEffect(() => {
    if ((userType === 'teacher') || (userType === 'parent' && selectedStudent)) {
      fetchWeekMenus();
      fetchLunchConfig();
    }
  }, [selectedStudent, currentWeekStart, userType]);

  // Cargar agregados cuando se selecciona un menú
  useEffect(() => {
    console.log('🔍 Verificando agregados:', {
      selectedMenu: selectedMenu?.id,
      category_id: selectedMenu?.category_id,
      category: selectedMenu?.category,
      orderDialogOpen
    });
    
    if (selectedMenu && selectedMenu.category_id && orderDialogOpen) {
      console.log('✅ Condiciones cumplidas, cargando agregados...');
      fetchAddons(selectedMenu.category_id);
    } else {
      console.log('❌ No se cumplen condiciones para cargar agregados:', {
        hasSelectedMenu: !!selectedMenu,
        hasCategoryId: !!selectedMenu?.category_id,
        isDialogOpen: orderDialogOpen
      });
      setAvailableAddons([]);
      setSelectedAddons(new Set());
    }
  }, [selectedMenu, orderDialogOpen]);

  const fetchStudents = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('students')
        .select('id, full_name, photo_url, school_id')
        .eq('parent_id', userId)
        .eq('is_active', true);

      if (error) throw error;
      setStudents(data || []);
      if (data && data.length > 0) {
        setSelectedStudent(data[0]);
      }
    } catch (error: any) {
      console.error('Error fetching students:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar los estudiantes'
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchAddons = async (categoryId: string) => {
    try {
      setLoadingAddons(true);
      console.log('📦 Cargando agregados para categoría:', categoryId);
      
      const { data, error } = await supabase
        .from('lunch_category_addons')
        .select('*')
        .eq('category_id', categoryId)
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (error) throw error;
      
      console.log('✅ Agregados cargados:', data);
      setAvailableAddons(data || []);
    } catch (error: any) {
      console.error('❌ Error fetching addons:', error);
      // No mostrar toast de error, simplemente no cargar agregados
      setAvailableAddons([]);
    } finally {
      setLoadingAddons(false);
    }
  };

  const toggleAddon = (addonId: string) => {
    setSelectedAddons(prev => {
      const newSet = new Set(prev);
      if (newSet.has(addonId)) {
        newSet.delete(addonId);
      } else {
        newSet.add(addonId);
      }
      return newSet;
    });
  };

  const calculateTotalPrice = () => {
    const basePrice = selectedMenu?.category?.price || 0;
    const addonsPrice = availableAddons
      .filter(addon => selectedAddons.has(addon.id))
      .reduce((sum, addon) => sum + addon.price, 0);
    return basePrice + addonsPrice;
  };

  // ⏰ Cargar configuración de límites de horario
  const fetchLunchConfig = async () => {
    try {
      const schoolId = userType === 'parent' ? selectedStudent?.school_id : userSchoolId;
      if (!schoolId) return;

      const { data, error } = await supabase
        .from('lunch_configuration')
        .select('order_deadline_time, order_deadline_days')
        .eq('school_id', schoolId)
        .maybeSingle();

      if (error) {
        console.error('Error loading lunch config:', error);
      } else {
        setLunchConfig(data);
      }
    } catch (error) {
      console.error('Error fetching lunch config:', error);
    }
  };

  // ⏰ Validar si se puede hacer pedido según la hora límite
  const canOrderForDate = (targetDate: string): { canOrder: boolean; message?: string; isWarning?: boolean } => {
    if (!lunchConfig || !lunchConfig.order_deadline_time || lunchConfig.order_deadline_days === undefined) {
      return { canOrder: true };
    }

    const now = new Date();
    const target = new Date(targetDate + 'T00:00:00-05:00'); // Zona horaria Perú
    
    // Calcular el deadline
    const deadlineDate = new Date(target);
    deadlineDate.setDate(deadlineDate.getDate() - lunchConfig.order_deadline_days);
    
    // Parsear la hora límite (formato "HH:MM:SS")
    const [hours, minutes] = lunchConfig.order_deadline_time.split(':').map(Number);
    deadlineDate.setHours(hours, minutes, 0, 0);

    // Si ya pasó el deadline
    if (now > deadlineDate) {
      return {
        canOrder: false,
        message: `Ya no puedes hacer pedidos. La hora límite era ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}.`
      };
    }

    // Si faltan menos de 30 minutos para el deadline (advertencia)
    const timeUntilDeadline = deadlineDate.getTime() - now.getTime();
    const minutesUntilDeadline = Math.floor(timeUntilDeadline / (1000 * 60));

    if (minutesUntilDeadline <= 30 && minutesUntilDeadline > 0) {
      return {
        canOrder: true,
        isWarning: true,
        message: `¡Apúrate! Solo quedan ${minutesUntilDeadline} minutos para hacer tu pedido hasta las ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}.`
      };
    }

    return { canOrder: true };
  };

  const fetchWeekMenus = async () => {
    try {
      setLoading(true);
      const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 });
      
      const schoolId = userType === 'parent' ? selectedStudent?.school_id : userSchoolId;
      if (!schoolId) return;

      const { data: menusData, error: menusError } = await supabase
        .from('lunch_menus')
        .select(`
          id,
          date,
          starter,
          main_course,
          beverage,
          dessert,
          notes,
          category_id,
          target_type
        `)
        .eq('school_id', schoolId)
        .gte('date', format(currentWeekStart, 'yyyy-MM-dd'))
        .lte('date', format(weekEnd, 'yyyy-MM-dd'))
        .order('date', { ascending: true });

      if (menusError) throw menusError;

      console.log('📊 Menús cargados desde DB:', menusData);
      console.log('👤 Tipo de usuario:', userType);

      // Filtrar menús según el tipo de usuario
      const targetType = userType === 'parent' ? 'students' : 'teachers';
      console.log('🎯 Filtrando por target_type:', targetType);
      
      const filteredMenus = (menusData || []).filter(
        menu => menu.target_type === targetType
      );

      console.log('✅ Menús después del filtro:', filteredMenus);

      // Cargar categorías
      if (filteredMenus.length > 0) {
        const categoryIds = filteredMenus
          .map(m => m.category_id)
          .filter(Boolean) as string[];

        if (categoryIds.length > 0) {
          const { data: categoriesData } = await supabase
            .from('lunch_categories')
            .select('*')
            .in('id', categoryIds);

          console.log('📂 Categorías cargadas:', categoriesData);

          const categoriesMap = new Map(
            (categoriesData || []).map(cat => [cat.id, cat])
          );

          const menusWithCategories = filteredMenus.map(menu => ({
            ...menu,
            category: menu.category_id ? categoriesMap.get(menu.category_id) : null
          }));

          console.log('🍽️ Menús con categorías:', menusWithCategories);

          setWeekMenus(menusWithCategories);
        } else {
          setWeekMenus(filteredMenus);
        }
      } else {
        setWeekMenus([]);
      }
    } catch (error: any) {
      console.error('Error fetching menus:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar los menús'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleOrderMenu = async () => {
    if (!selectedMenu) return;

    const studentId = userType === 'parent' ? selectedStudent?.id : null;
    const teacherId = userType === 'teacher' ? userId : null;

    if (!studentId && !teacherId) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo identificar el usuario'
      });
      return;
    }

    // ⏰ VALIDACIÓN: Verificar si se puede hacer el pedido (solo para profesores)
    if (userType === 'teacher') {
      const validation = canOrderForDate(selectedMenu.date);
      if (!validation.canOrder) {
        toast({
          variant: 'destructive',
          title: '❌ Pedido no permitido',
          description: validation.message,
          duration: 6000,
        });
        return;
      }

      // Si hay advertencia, mostrarla pero permitir continuar
      if (validation.isWarning && validation.message) {
        toast({
          title: '⚠️ Aviso Importante',
          description: validation.message,
          duration: 6000,
        });
      }
    }

    // 🔔 ADVERTENCIA 1: Confirmar fecha del pedido
    // Usar fecha en zona horaria de Perú para evitar desfase
    const [year, month, day] = selectedMenu.date.split('-').map(Number);
    const orderDate = new Date(year, month - 1, day); // Crear fecha en hora local
    const dayOfWeek = orderDate.toLocaleDateString('es-PE', { weekday: 'long', timeZone: 'America/Lima' });
    const formattedDate = orderDate.toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Lima' });
    
    const confirmOrder = window.confirm(
      `¿Desea confirmar el pedido de almuerzo para el ${dayOfWeek}, ${formattedDate}?`
    );

    if (!confirmOrder) {
      return; // Usuario canceló
    }

    setOrdering(true);
    try {
      // Verificar si ya existe un pedido para esta fecha
      const { data: existingOrder } = await supabase
        .from('lunch_orders')
        .select('id')
        .eq('order_date', selectedMenu.date)
        .eq(userType === 'parent' ? 'student_id' : 'teacher_id', userType === 'parent' ? studentId : teacherId)
        .single();

      if (existingOrder) {
        toast({
          variant: 'destructive',
          title: 'Pedido ya existe',
          description: 'Ya tienes un pedido para este día'
        });
        return;
      }

      // Crear el pedido
      const basePrice = selectedMenu.category?.price || 0;
      const addonsPrice = availableAddons
        .filter(addon => selectedAddons.has(addon.id))
        .reduce((sum, addon) => sum + addon.price, 0);
      const totalPrice = basePrice + addonsPrice;

      const orderData: any = {
        menu_id: selectedMenu.id,
        order_date: selectedMenu.date,
        status: 'pending',
        category_id: selectedMenu.category_id,
        school_id: userSchoolId || selectedMenu.school_id,
        base_price: basePrice,
        addons_total: addonsPrice,
        final_price: totalPrice,
      };

      if (userType === 'parent') {
        orderData.student_id = studentId;
      } else {
        orderData.teacher_id = teacherId;
      }

      const { data: insertedOrder, error } = await supabase
        .from('lunch_orders')
        .insert([orderData])
        .select()
        .single();

      if (error) throw error;

      // Guardar agregados seleccionados
      if (selectedAddons.size > 0 && insertedOrder) {
        const addonsToInsert = availableAddons
          .filter(addon => selectedAddons.has(addon.id))
          .map(addon => ({
            order_id: insertedOrder.id,
            addon_id: addon.id,
            addon_name: addon.name,
            addon_price: addon.price,
            quantity: 1,
            subtotal: addon.price
          }));

        const { error: addonsError } = await supabase
          .from('lunch_order_addons')
          .insert(addonsToInsert);

        if (addonsError) {
          console.error('Error inserting addons:', addonsError);
          // No lanzar error, el pedido ya se creó
        }
      }

      // Crear transacción (cargo) si hay categoría con precio
      if (totalPrice > 0) {
        let description = `Almuerzo - ${selectedMenu.category?.name || 'Menú'} - ${format(new Date(selectedMenu.date + 'T00:00:00'), "d 'de' MMMM", { locale: es })}`;
        
        // Agregar detalles de agregados a la descripción
        if (selectedAddons.size > 0) {
          const addonNames = availableAddons
            .filter(addon => selectedAddons.has(addon.id))
            .map(addon => addon.name)
            .join(', ');
          description += ` + Agregados: ${addonNames}`;
        }

        console.log('🔍 [OrderLunchMenus] Creando transacción con payment_status: pending');
        const transactionData: any = {
          type: 'purchase',
          amount: -Math.abs(totalPrice), // Negativo = cargo/deuda
          description,
          created_by: userId,
          school_id: userSchoolId || selectedMenu.school_id,
          payment_status: 'pending',
          payment_method: null,
        };

        if (userType === 'parent') {
          transactionData.student_id = studentId;
        } else {
          transactionData.teacher_id = teacherId;
        }

        const { error: transactionError } = await supabase
          .from('transactions')
          .insert([transactionData]);

        if (transactionError) {
          console.error('Error creating transaction:', transactionError);
          // No lanzar error, el pedido ya se creó
        }
      }

      toast({
        title: '✅ Pedido realizado',
        description: `Tu almuerzo para el ${format(new Date(selectedMenu.date + 'T00:00:00'), "d 'de' MMMM", { locale: es })} ha sido registrado`
      });

      setOrderDialogOpen(false);
      setSelectedMenu(null);
      setSelectedAddons(new Set());
      fetchWeekMenus();
    } catch (error: any) {
      console.error('Error ordering menu:', error);
      toast({
        variant: 'destructive',
        title: 'Error al realizar pedido',
        description: error.message || 'Intenta nuevamente'
      });
    } finally {
      setOrdering(false);
    }
  };

  const getIconComponent = (iconName: string) => {
    return ICON_MAP[iconName] || UtensilsCrossed;
  };

  const nextWeek = () => {
    setCurrentWeekStart(addDays(currentWeekStart, 7));
  };

  const prevWeek = () => {
    setCurrentWeekStart(addDays(currentWeekStart, -7));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-green-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <UtensilsCrossed className="h-5 w-5 sm:h-6 sm:w-6 text-green-600" />
            Pedir Almuerzos
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Selecciona tus almuerzos de la semana
          </p>
        </div>

        {/* Selector de estudiante (solo para padres) */}
        {userType === 'parent' && students.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-2 sm:pb-0">
            {students.map((student) => (
              <button
                key={student.id}
                onClick={() => setSelectedStudent(student)}
                className={`px-3 py-2 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition-all ${
                  selectedStudent?.id === student.id
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-100 hover:bg-gray-200'
                }`}
              >
                {student.full_name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Navegación de semana */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={prevWeek}>
              ← Anterior
            </Button>
            <CardTitle className="text-sm sm:text-base">
              Semana del {format(currentWeekStart, "d 'de' MMMM", { locale: es })}
            </CardTitle>
            <Button variant="outline" size="sm" onClick={nextWeek}>
              Siguiente →
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Menús de la semana */}
      {weekMenus.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600 font-medium">No hay menús disponibles para esta semana</p>
            <p className="text-sm text-gray-500 mt-2">Intenta con otra semana</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {weekMenus.map((menu) => {
            const IconComponent = menu.category ? getIconComponent(menu.category.icon) : UtensilsCrossed;
            const menuDate = new Date(menu.date + 'T00:00:00');
            const isToday = format(menuDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
            const isPast = menuDate < new Date() && !isToday;

            return (
              <Card 
                key={menu.id}
                className={`overflow-hidden transition-all hover:shadow-lg ${
                  isPast ? 'opacity-60' : ''
                } ${
                  isToday ? 'ring-2 ring-green-500' : ''
                }`}
              >
                {/* Header con categoría */}
                {menu.category && (
                  <div 
                    className="p-3 sm:p-4"
                    style={{ backgroundColor: `${menu.category.color}15` }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center"
                          style={{ backgroundColor: `${menu.category.color}30` }}
                        >
                          <IconComponent 
                            className="h-4 w-4 sm:h-5 sm:w-5" 
                            style={{ color: menu.category.color }}
                          />
                        </div>
                        <div>
                          <h3 className="font-bold text-sm sm:text-base">{menu.category.name}</h3>
                          {menu.category.price && (
                            <p className="text-xs sm:text-sm font-semibold" style={{ color: menu.category.color }}>
                              S/ {menu.category.price.toFixed(2)}
                            </p>
                          )}
                        </div>
                      </div>
                      {isToday && (
                        <Badge className="bg-green-600">Hoy</Badge>
                      )}
                    </div>
                  </div>
                )}

                <CardHeader className="pb-2">
                  <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    {format(menuDate, "EEEE d 'de' MMMM", { locale: es })}
                  </CardTitle>
                </CardHeader>

                <CardContent className="space-y-2">
                  {menu.starter && (
                    <div className="text-xs sm:text-sm">
                      <span className="font-medium text-gray-600">Entrada:</span>
                      <p className="text-gray-900">{menu.starter}</p>
                    </div>
                  )}
                  <div className="text-xs sm:text-sm">
                    <span className="font-medium text-green-700">Segundo:</span>
                    <p className="font-bold text-green-800">{menu.main_course}</p>
                  </div>
                  {menu.beverage && (
                    <div className="text-xs sm:text-sm">
                      <span className="font-medium text-gray-600">Bebida:</span>
                      <p className="text-gray-900">{menu.beverage}</p>
                    </div>
                  )}
                  {menu.dessert && (
                    <div className="text-xs sm:text-sm">
                      <span className="font-medium text-gray-600">Postre:</span>
                      <p className="text-gray-900">{menu.dessert}</p>
                    </div>
                  )}

                  <Button 
                    className="w-full mt-3 gap-2"
                    size="sm"
                    disabled={isPast}
                    onClick={() => {
                      console.log('🎯 Menú seleccionado:', menu);
                      console.log('📋 Category ID:', menu.category_id);
                      console.log('📦 Category object:', menu.category);
                      setSelectedMenu(menu);
                      setOrderDialogOpen(true);
                    }}
                  >
                    <ShoppingCart className="h-4 w-4" />
                    {isPast ? 'Ya pasó' : 'Pedir este menú'}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Dialog de confirmación */}
      <Dialog open={orderDialogOpen} onOpenChange={setOrderDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar pedido</DialogTitle>
            <DialogDescription>
              ¿Estás seguro de que deseas pedir este almuerzo?
            </DialogDescription>
          </DialogHeader>

          {selectedMenu && (
            <div className="space-y-4 py-4">
              {/* ⚠️ ADVERTENCIA DE HORA LÍMITE (solo para profesores) */}
              {userType === 'teacher' && (() => {
                const validation = canOrderForDate(selectedMenu.date);
                if (!validation.canOrder || validation.isWarning) {
                  return (
                    <div className={`p-3 rounded-lg border-2 flex items-start gap-2 ${
                      !validation.canOrder 
                        ? 'bg-red-50 border-red-300' 
                        : 'bg-yellow-50 border-yellow-300'
                    }`}>
                      <AlertCircle className={`h-5 w-5 mt-0.5 flex-shrink-0 ${
                        !validation.canOrder ? 'text-red-600' : 'text-yellow-600'
                      }`} />
                      <p className={`text-sm font-medium ${
                        !validation.canOrder ? 'text-red-800' : 'text-yellow-800'
                      }`}>
                        {validation.message}
                      </p>
                    </div>
                  );
                }
                return null;
              })()}

              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4" />
                <span className="font-medium">
                  {format(new Date(selectedMenu.date + 'T00:00:00'), "EEEE d 'de' MMMM", { locale: es })}
                </span>
              </div>
              
              {selectedMenu.category && (
                <div className="p-3 rounded-lg" style={{ backgroundColor: `${selectedMenu.category.color}15` }}>
                  <p className="font-bold">{selectedMenu.category.name}</p>
                  {selectedMenu.category.price && (
                    <p className="text-lg font-bold mt-1" style={{ color: selectedMenu.category.color }}>
                      S/ {selectedMenu.category.price.toFixed(2)}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-1 text-sm">
                <p><strong>Menú:</strong></p>
                {selectedMenu.starter && <p>• Entrada: {selectedMenu.starter}</p>}
                <p>• Segundo: {selectedMenu.main_course}</p>
                {selectedMenu.beverage && <p>• Bebida: {selectedMenu.beverage}</p>}
                {selectedMenu.dessert && <p>• Postre: {selectedMenu.dessert}</p>}
              </div>

              {/* Sección de agregados */}
              {loadingAddons ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-green-600" />
                </div>
              ) : availableAddons.length > 0 ? (
                <div className="space-y-3 border-t pt-4">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-green-600" />
                    <h4 className="font-semibold text-sm">Agregados disponibles</h4>
                  </div>
                  
                  <div className="space-y-2 max-h-[200px] overflow-y-auto">
                    {availableAddons.map(addon => (
                      <label
                        key={addon.id}
                        className="flex items-center gap-3 p-3 rounded-lg border hover:bg-gray-50 cursor-pointer transition-colors"
                      >
                        <Checkbox
                          checked={selectedAddons.has(addon.id)}
                          onCheckedChange={() => toggleAddon(addon.id)}
                        />
                        <div className="flex-1">
                          <p className="font-medium text-sm">{addon.name}</p>
                          {addon.description && (
                            <p className="text-xs text-gray-500">{addon.description}</p>
                          )}
                        </div>
                        <span className="font-bold text-green-600">
                          + S/ {addon.price.toFixed(2)}
                        </span>
                      </label>
                    ))}
                  </div>

                  {/* Total con agregados */}
                  {selectedAddons.size > 0 && (
                    <div className="pt-3 border-t space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Precio base:</span>
                        <span>S/ {(selectedMenu.category?.price || 0).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-sm text-green-600">
                        <span>Agregados:</span>
                        <span>+ S/ {availableAddons
                          .filter(addon => selectedAddons.has(addon.id))
                          .reduce((sum, addon) => sum + addon.price, 0)
                          .toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between font-bold text-base pt-2 border-t">
                        <span>Total:</span>
                        <span className="text-green-600">S/ {calculateTotalPrice().toFixed(2)}</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOrderDialogOpen(false)} disabled={ordering}>
              Cancelar
            </Button>
            <Button onClick={handleOrderMenu} disabled={ordering} className="gap-2">
              {ordering ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Procesando...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Confirmar pedido
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
