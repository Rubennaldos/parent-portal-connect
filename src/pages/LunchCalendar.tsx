import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Calendar,
  ArrowLeft,
  Plus,
  ChevronLeft,
  ChevronRight,
  Upload,
  Download,
  Filter,
  MoreVertical,
  Coffee,
  Ban,
  CalendarDays,
  UtensilsCrossed,
  Eye,
  Tag
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from '@/components/ui/dropdown-menu';
import { LunchMenuModal } from '@/components/lunch/LunchMenuModal';
import { LunchCategoryWizard } from '@/components/lunch/LunchCategoryWizard';
import { CategoryManager } from '@/components/lunch/CategoryManager';
import { MassUploadModal } from '@/components/lunch/MassUploadModal';
import { SpecialDayModal } from '@/components/lunch/SpecialDayModal';
import { LunchAnalyticsDashboard } from '@/components/lunch/LunchAnalyticsDashboard';
import { LunchConfiguration } from '@/components/lunch/LunchConfiguration';
import LunchOrders from '@/pages/LunchOrders';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface School {
  id: string;
  name: string;
  color?: string;
}

interface LunchMenu {
  id: string;
  school_id: string;
  school_name: string;
  school_color?: string;
  date: string;
  starter: string | null;
  main_course: string;
  beverage: string | null;
  dessert: string | null;
  notes: string | null;
  is_special_day: boolean;
  special_day_type?: string;
  special_day_title?: string;
}

interface DayData {
  date: Date;
  menus: LunchMenu[];
  isSpecialDay: boolean;
  specialDayInfo?: {
    type: string;
    title: string;
    school_id: string | null;
  };
}

const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const SPECIAL_DAY_COLORS = {
  feriado: 'bg-red-100 border-red-300 text-red-800',
  no_laborable: 'bg-gray-100 border-gray-300 text-gray-800',
  suspension: 'bg-yellow-100 border-yellow-300 text-yellow-800',
  otro: 'bg-blue-100 border-blue-300 text-blue-800',
};

const LunchCalendar = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchools, setSelectedSchools] = useState<string[]>([]);
  const [calendarData, setCalendarData] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string>('');
  const [userSchoolId, setUserSchoolId] = useState<string | null>(null);

  // Permisos
  const [canCreate, setCanCreate] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [canMassUpload, setCanMassUpload] = useState(false);
  const [canManageSpecialDays, setCanManageSpecialDays] = useState(false);
  const [canExport, setCanExport] = useState(false);
  const [canViewAllSchools, setCanViewAllSchools] = useState(false);

  // Modales
  const [isMenuModalOpen, setIsMenuModalOpen] = useState(false);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isCategoryManagerOpen, setIsCategoryManagerOpen] = useState(false);
  const [isMassUploadModalOpen, setIsMassUploadModalOpen] = useState(false);
  const [isSpecialDayModalOpen, setIsSpecialDayModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isCreateAnotherMenuOpen, setIsCreateAnotherMenuOpen] = useState(false); // Nuevo modal
  const [selectedDay, setSelectedDay] = useState<DayData | null>(null);
  const [selectedMenuId, setSelectedMenuId] = useState<string | null>(null);
  
  // Estado del wizard
  const [wizardCategoryId, setWizardCategoryId] = useState<string | null>(null);
  const [wizardTargetType, setWizardTargetType] = useState<'students' | 'teachers' | null>(null);
  const [wizardCategoryName, setWizardCategoryName] = useState<string | null>(null);

  // Cargar permisos y datos del usuario
  useEffect(() => {
    const loadUserPermissions = async () => {
      if (!user) return;

      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role, school_id')
          .eq('id', user.id)
          .single();

        if (!profile) return;

        setUserRole(profile.role);
        setUserSchoolId(profile.school_id);

        // Consultar permisos
        const { data: userPermissions } = await supabase
          .from('role_permissions')
          .select(`
            permission_id,
            granted,
            permissions:permission_id (
              id,
              module,
              action,
              name
            )
          `)
          .eq('role', profile.role)
          .eq('granted', true);

        const permMap = new Map<string, boolean>();
        userPermissions?.forEach((perm: any) => {
          const permission = perm.permissions;
          if (permission?.module === 'almuerzos') {
            permMap.set(permission.action, true);
          }
        });

        setCanCreate(permMap.get('crear_menu') || false);
        setCanEdit(permMap.get('editar_menu') || false);
        setCanDelete(permMap.get('eliminar_menu') || false);
        setCanMassUpload(permMap.get('carga_masiva') || false);
        setCanManageSpecialDays(permMap.get('gestionar_dias_especiales') || false);
        setCanExport(permMap.get('exportar') || false);
        setCanViewAllSchools(permMap.get('ver_todas_sedes') || false);

      } catch (error) {
        console.error('Error loading permissions:', error);
      }
    };

    loadUserPermissions();
  }, [user]);

  // Cargar escuelas
  useEffect(() => {
    const loadSchools = async () => {
      try {
        let query = supabase.from('schools').select('id, name, color').order('name');

        // Si el usuario solo puede ver su sede
        if (!canViewAllSchools && userSchoolId) {
          query = query.eq('id', userSchoolId);
        }

        const { data, error } = await query;

        if (error) throw error;

        setSchools(data || []);
        
        // Seleccionar todas las escuelas por defecto
        setSelectedSchools(data?.map((s) => s.id) || []);
      } catch (error) {
        console.error('Error loading schools:', error);
        toast({
          title: 'Error',
          description: 'No se pudieron cargar las sedes',
          variant: 'destructive',
        });
      }
    };

    loadSchools();
  }, [canViewAllSchools, userSchoolId, toast]);

  // Cargar menús del mes
  useEffect(() => {
    const loadMonthlyMenus = async () => {
      if (selectedSchools.length === 0) {
        setCalendarData([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const month = currentDate.getMonth() + 1;
        const year = currentDate.getFullYear();

        const { data, error } = await supabase.rpc('get_monthly_lunch_menus', {
          target_month: month,
          target_year: year,
          target_school_ids: selectedSchools,
        });

        if (error) throw error;

        // Construir estructura de calendario
        const daysInMonth = new Date(year, month, 0).getDate();
        const calendarDays: DayData[] = [];

        for (let day = 1; day <= daysInMonth; day++) {
          const date = new Date(year, month - 1, day);
          const dateStr = date.toISOString().split('T')[0];

          const menusForDay = (data || []).filter(
            (m: LunchMenu) => m.date === dateStr
          );

          const specialDay = menusForDay.find((m) => m.is_special_day);

          calendarDays.push({
            date,
            menus: menusForDay,
            isSpecialDay: !!specialDay,
            specialDayInfo: specialDay
              ? {
                  type: specialDay.special_day_type || '',
                  title: specialDay.special_day_title || '',
                }
              : undefined,
          });
        }

        setCalendarData(calendarDays);
      } catch (error) {
        console.error('Error loading monthly menus:', error);
        toast({
          title: 'Error',
          description: 'No se pudieron cargar los menús del mes',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    };

    loadMonthlyMenus();
  }, [currentDate, selectedSchools, toast]);

  const handleSetDayState = async (date: Date, type: string, schoolIds: string[] | null) => {
    try {
      const { error } = await supabase.rpc('set_day_state', {
        p_date: date.toISOString().split('T')[0],
        p_type: type,
        p_school_ids: schoolIds,
      });

      if (error) throw error;

      toast({
        title: 'Estado actualizado',
        description: `El día se marcó como ${type.replace('_', ' ')}`,
      });

      // Recargar datos
      setCurrentDate(new Date(currentDate));
    } catch (error) {
      console.error('Error setting day state:', error);
      toast({
        title: 'Error',
        description: 'No se pudo cambiar el estado del día',
        variant: 'destructive',
      });
    }
  };

  const handlePreviousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const handleDayClick = (dayData: DayData) => {
    setSelectedDay(dayData);
    
    // Si es día especial (feriado/no laborable), no hacer nada al hacer clic
    if (dayData.isSpecialDay) {
      return;
    }
    
    // Si hay menús de varias sedes, mostrar opciones
    if (dayData.menus.length > 1) {
      // Preguntar si quiere ver los menús existentes o crear uno nuevo
      if (canCreate) {
        setIsCreateAnotherMenuOpen(true);
      } else {
        setIsDetailModalOpen(true);
      }
    } else if (dayData.menus.length === 1) {
      // Si hay 1 menú, preguntar si quiere crear otro o editar el existente
      if (canCreate) {
        setIsCreateAnotherMenuOpen(true);
      } else if (canEdit) {
        // Si solo puede editar, abrir el menú existente
        setSelectedMenuId(dayData.menus[0].id);
        setIsMenuModalOpen(true);
      }
    } else if (dayData.menus.length === 0 && canCreate) {
      // Si no hay menús, abrir wizard para seleccionar categoría
      setSelectedMenuId(null);
      setIsWizardOpen(true);
    }
  };

  const handleCreateAnotherMenu = () => {
    setIsCreateAnotherMenuOpen(false);
    setSelectedMenuId(null);
    setIsWizardOpen(true);
  };

  const handleViewExistingMenus = () => {
    setIsCreateAnotherMenuOpen(false);
    if (selectedDay?.menus.length === 1) {
      setSelectedMenuId(selectedDay.menus[0].id);
      setIsMenuModalOpen(true);
    } else if (selectedDay && selectedDay.menus.length > 1) {
      setIsDetailModalOpen(true);
    }
  };

  const handleCreateMenu = () => {
    setSelectedDay(null);
    setSelectedMenuId(null);
    setIsWizardOpen(true);  // Abrir wizard en lugar del modal directo
  };

  const handleWizardComplete = (categoryId: string, targetType: 'students' | 'teachers', categoryName: string) => {
    setWizardCategoryId(categoryId);
    setWizardTargetType(targetType);
    setWizardCategoryName(categoryName);
    setIsWizardOpen(false);
    setIsMenuModalOpen(true);  // Ahora sí abrir el modal del menú con los datos del wizard
  };

  const handleMarkSpecialDay = () => {
    if (!selectedDay) return;
    setIsSpecialDayModalOpen(true);
  };

  const toggleSchool = (schoolId: string) => {
    setSelectedSchools((prev) =>
      prev.includes(schoolId)
        ? prev.filter((id) => id !== schoolId)
        : [...prev, schoolId]
    );
  };

  const handleExport = async () => {
    // TODO: Implementar exportación a Excel/PDF
    toast({
      title: 'Exportar',
      description: 'Funcionalidad de exportación próximamente',
    });
  };

  // Obtener el primer día de la semana del mes (0 = Domingo, 1 = Lunes, etc.)
  const firstDayOfMonth = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    1
  ).getDay();

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-green-50 dark:via-green-950/20 to-background">
      <header className="bg-background/80 backdrop-blur-sm border-b sticky top-0 z-10">
        <div className="container mx-auto px-2 sm:px-4 py-2 sm:py-4">
          {/* Header Mobile/Desktop */}
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 sm:gap-0">
            {/* Título y botón volver */}
            <div className="flex items-center gap-2 sm:gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/dashboard')}
                className="h-8 px-2 sm:px-3"
              >
                <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-2" />
                <span className="hidden sm:inline">Volver</span>
              </Button>
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-green-500/10 rounded-xl flex items-center justify-center">
                <Calendar className="h-4 w-4 sm:h-5 sm:w-5 text-green-600" />
              </div>
              <div>
                <h1 className="font-semibold text-sm sm:text-base">Calendario de Almuerzos</h1>
                <p className="text-[10px] sm:text-xs text-muted-foreground hidden sm:block">
                  Gestión de menús escolares
                </p>
              </div>
            </div>

            {/* Botones de acción - Responsive */}
            <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto pb-2 sm:pb-0">
              {canExport && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleExport}
                  className="h-7 sm:h-9 text-xs px-2 sm:px-3 shrink-0"
                >
                  <Download className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-2" />
                  <span className="hidden md:inline">Exportar</span>
                </Button>
              )}
              {canMassUpload && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setIsMassUploadModalOpen(true)}
                  className="h-7 sm:h-9 text-xs px-2 sm:px-3 shrink-0"
                >
                  <Upload className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-2" />
                  <span className="hidden md:inline">Carga Masiva</span>
                </Button>
              )}
              {canCreate && (
                <>
                  <Button 
                    size="sm" 
                    variant="outline" 
                    onClick={() => setIsCategoryManagerOpen(true)}
                    className="h-7 sm:h-9 text-xs px-2 sm:px-3 shrink-0"
                  >
                    <Tag className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-2" />
                    <span className="hidden lg:inline">Categorías</span>
                  </Button>
                  <Button 
                    size="sm" 
                    onClick={handleCreateMenu}
                    className="h-7 sm:h-9 text-xs px-2 sm:px-3 shrink-0 bg-green-600 hover:bg-green-700"
                  >
                    <Plus className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Nuevo Menú</span>
                    <span className="sm:hidden">Nuevo</span>
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-2 sm:px-4 py-4 sm:py-8">
        <Tabs defaultValue="calendar" className="w-full">
          {/* Tabs responsive */}
          <TabsList className="grid w-full grid-cols-4 mb-4 sm:mb-6 h-auto">
            <TabsTrigger value="calendar" className="text-[10px] sm:text-sm py-2 sm:py-3 px-1 sm:px-3">
              <span className="hidden sm:inline">📅 Calendario</span>
              <span className="sm:hidden">📅</span>
            </TabsTrigger>
            <TabsTrigger value="orders" className="text-[10px] sm:text-sm py-2 sm:py-3 px-1 sm:px-3">
              <span className="hidden sm:inline">🍽️ Pedidos</span>
              <span className="sm:hidden">🍽️</span>
            </TabsTrigger>
            <TabsTrigger value="analytics" className="text-[10px] sm:text-sm py-2 sm:py-3 px-1 sm:px-3">
              <span className="hidden sm:inline">📊 Analytics</span>
              <span className="sm:hidden">📊</span>
            </TabsTrigger>
            <TabsTrigger value="config" className="text-[10px] sm:text-sm py-2 sm:py-3 px-1 sm:px-3">
              <span className="hidden sm:inline">⚙️ Config</span>
              <span className="sm:hidden">⚙️</span>
            </TabsTrigger>
          </TabsList>

          {/* Tab: Calendario */}
          <TabsContent value="calendar">
            {/* Layout responsive: columna única en móvil, 2 columnas en tablet, 12 columnas en desktop */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6">
          {/* Panel lateral de filtros - Oculto en móvil, visible en desktop */}
          <aside className="hidden lg:block lg:col-span-3">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Filter className="h-4 w-4" />
                  Filtros
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-xs font-medium mb-2 block">
                    Sedes a Mostrar
                  </Label>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {schools.map((school) => (
                      <div key={school.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`school-${school.id}`}
                          checked={selectedSchools.includes(school.id)}
                          onCheckedChange={() => toggleSchool(school.id)}
                        />
                        <label
                          htmlFor={`school-${school.id}`}
                          className="text-sm flex items-center gap-2 cursor-pointer"
                        >
                          {school.color && (
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: school.color }}
                            />
                          )}
                          {school.name}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-4 border-t">
                  <Label className="text-xs font-medium mb-2 block">
                    Leyenda
                  </Label>
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-green-100 border border-green-300 rounded" />
                      <span>Con menú</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-gray-50 border border-gray-200 rounded" />
                      <span>Sin menú</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-red-100 border border-red-300 rounded" />
                      <span>Feriado</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-gray-100 border border-gray-300 rounded" />
                      <span>No laborable</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </aside>

          {/* Calendario principal - Full width en móvil/tablet */}
          <div className="lg:col-span-9">
            {/* Filtro de sedes para móvil/tablet */}
            <Card className="mb-4 lg:hidden">
              <CardContent className="p-3">
                <Label className="text-xs font-medium mb-2 block">
                  Filtrar por sede:
                </Label>
                <div className="flex flex-wrap gap-2">
                  {schools.map((school) => (
                    <button
                      key={school.id}
                      onClick={() => toggleSchool(school.id)}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-xs font-medium transition-all border",
                        selectedSchools.includes(school.id)
                          ? "bg-green-100 border-green-300 text-green-800"
                          : "bg-gray-50 border-gray-200 text-gray-600"
                      )}
                    >
                      {school.color && (
                        <span
                          className="inline-block w-2 h-2 rounded-full mr-1.5"
                          style={{ backgroundColor: school.color }}
                        />
                      )}
                      {school.name}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3 sm:pb-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg sm:text-2xl">
                      {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
                    </CardTitle>
                    <CardDescription className="text-xs sm:text-sm">
                      {selectedSchools.length} sede(s) seleccionada(s)
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handlePreviousMonth}
                      className="h-8 w-8 sm:h-10 sm:w-10"
                    >
                      <ChevronLeft className="h-3 w-3 sm:h-4 sm:w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentDate(new Date())}
                      className="h-8 px-2 sm:h-9 sm:px-3 text-xs sm:text-sm"
                    >
                      Hoy
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleNextMonth}
                      className="h-8 w-8 sm:h-10 sm:w-10"
                    >
                      <ChevronRight className="h-3 w-3 sm:h-4 sm:w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-2 sm:p-6">
                {loading ? (
                  <div className="text-center py-12 text-muted-foreground text-sm">
                    Cargando calendario...
                  </div>
                ) : (
                  <div className="grid grid-cols-7 gap-1 sm:gap-2">
                    {/* Encabezados de días - Texto más pequeño en móvil */}
                    {['D', 'L', 'M', 'M', 'J', 'V', 'S'].map((day, idx) => (
                      <div
                        key={day + idx}
                        className="text-center text-[10px] sm:text-sm font-medium text-muted-foreground py-1 sm:py-2"
                      >
                        <span className="sm:hidden">{day}</span>
                        <span className="hidden sm:inline">
                          {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][idx]}
                        </span>
                      </div>
                    ))}

                    {/* Espacios vacíos antes del primer día */}
                    {Array.from({ length: firstDayOfMonth }).map((_, i) => (
                      <div key={`empty-${i}`} className="aspect-square" />
                    ))}

                    {/* Días del mes - Responsive */}
                    {calendarData.map((dayData, index) => {
                      const isToday =
                        dayData.date.toDateString() === new Date().toDateString();
                      const hasMenus = dayData.menus.length > 0;
                      const dayOfWeek = dayData.date.getDay();
                      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                      const isSpecialDay = dayData.isSpecialDay && dayData.specialDayInfo;

                      let bgClass = 'bg-white hover:bg-gray-50';
                      
                      // Prioridad: días especiales > menús > weekend > default
                      if (isSpecialDay) {
                        if (dayData.specialDayInfo!.type === 'feriado') {
                          bgClass = 'bg-red-100 hover:bg-red-200 border-red-300';
                        } else if (dayData.specialDayInfo!.type === 'no_laborable') {
                          bgClass = 'bg-gray-300 hover:bg-gray-400 border-gray-500';
                        }
                      } else if (hasMenus) {
                        bgClass = 'bg-green-100 hover:bg-green-200 border-green-300';
                      } else if (isWeekend) {
                        bgClass = 'bg-gray-200/50 hover:bg-gray-200';
                      }

                      return (
                        <div
                          key={index}
                          className={cn(
                            'aspect-square border rounded-md sm:rounded-lg p-1 sm:p-2 transition-all relative group',
                            bgClass,
                            isToday && 'ring-1 sm:ring-2 ring-blue-500',
                            'shadow-sm hover:shadow-md cursor-pointer'
                          )}
                          onClick={() => handleDayClick(dayData)}
                        >
                          <div className="h-full flex flex-col">
                            <div className="flex justify-between items-start">
                              <span className={cn(
                                "text-[11px] sm:text-sm font-bold",
                                isWeekend && "text-gray-600"
                              )}>
                                {dayData.date.getDate()}
                              </span>
                              
                              {/* Menú desplegable - Solo visible en hover en desktop, siempre visible en móvil */}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-5 w-5 sm:h-6 sm:w-6 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                    <MoreVertical className="h-3 w-3 sm:h-4 sm:w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-48">
                                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleDayClick(dayData); }}>
                                    <Eye className="h-4 w-4 mr-2" />
                                    Ver Detalle
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  
                                  {/* Submenú para cambiar estado */}
                                  <DropdownMenuSub>
                                    <DropdownMenuSubTrigger>
                                      <CalendarDays className="h-4 w-4 mr-2" />
                                      Marcar como...
                                    </DropdownMenuSubTrigger>
                                    <DropdownMenuPortal>
                                      <DropdownMenuSubContent>
                                        <DropdownMenuItem onClick={(e) => { 
                                          e.stopPropagation(); 
                                          handleSetDayState(dayData.date, 'con_menu', null); 
                                        }}>
                                          <UtensilsCrossed className="h-4 w-4 mr-2 text-green-600" />
                                          Con menú (Default)
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={(e) => { 
                                          e.stopPropagation(); 
                                          handleSetDayState(dayData.date, 'sin_menu', null); 
                                        }}>
                                          <Ban className="h-4 w-4 mr-2 text-gray-400" />
                                          Sin menú
                                        </DropdownMenuItem>
                                        
                                        <DropdownMenuSeparator />
                                        
                                        {/* Aplicar a todas o individuales */}
                                        <DropdownMenuSub>
                                          <DropdownMenuSubTrigger>
                                            <Badge variant="outline" className="mr-2 text-red-600 border-red-200 bg-red-50">Feriado</Badge>
                                          </DropdownMenuSubTrigger>
                                          <DropdownMenuPortal>
                                            <DropdownMenuSubContent>
                                              <DropdownMenuItem onClick={(e) => { 
                                                e.stopPropagation(); 
                                                handleSetDayState(dayData.date, 'feriado', null); 
                                              }}>
                                                Todas las sedes
                                              </DropdownMenuItem>
                                              {canViewAllSchools && (
                                                <>
                                                  <DropdownMenuSeparator />
                                                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                                                    Sedes individuales:
                                                  </div>
                                                  {schools.map(school => (
                                                    <DropdownMenuItem 
                                                      key={school.id}
                                                      onClick={(e) => { 
                                                        e.stopPropagation(); 
                                                        handleSetDayState(dayData.date, 'feriado', [school.id]); 
                                                      }}
                                                    >
                                                      <div className="flex items-center gap-2">
                                                        <div 
                                                          className="w-2 h-2 rounded-full"
                                                          style={{ backgroundColor: school.color || '#999' }}
                                                        />
                                                        {school.name}
                                                      </div>
                                                    </DropdownMenuItem>
                                                  ))}
                                                </>
                                              )}
                                              {!canViewAllSchools && userSchoolId && (
                                                <DropdownMenuItem onClick={(e) => { 
                                                  e.stopPropagation(); 
                                                  handleSetDayState(dayData.date, 'feriado', [userSchoolId]); 
                                                }}>
                                                  Solo mi sede
                                                </DropdownMenuItem>
                                              )}
                                            </DropdownMenuSubContent>
                                          </DropdownMenuPortal>
                                        </DropdownMenuSub>

                                        <DropdownMenuSub>
                                          <DropdownMenuSubTrigger>
                                            <Badge variant="outline" className="mr-2 text-gray-600 border-gray-300 bg-gray-100">No Laborable</Badge>
                                          </DropdownMenuSubTrigger>
                                          <DropdownMenuPortal>
                                            <DropdownMenuSubContent>
                                              <DropdownMenuItem onClick={(e) => { 
                                                e.stopPropagation(); 
                                                handleSetDayState(dayData.date, 'no_laborable', null); 
                                              }}>
                                                Todas las sedes
                                              </DropdownMenuItem>
                                              {canViewAllSchools && (
                                                <>
                                                  <DropdownMenuSeparator />
                                                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                                                    Sedes individuales:
                                                  </div>
                                                  {schools.map(school => (
                                                    <DropdownMenuItem 
                                                      key={school.id}
                                                      onClick={(e) => { 
                                                        e.stopPropagation(); 
                                                        handleSetDayState(dayData.date, 'no_laborable', [school.id]); 
                                                      }}
                                                    >
                                                      <div className="flex items-center gap-2">
                                                        <div 
                                                          className="w-2 h-2 rounded-full"
                                                          style={{ backgroundColor: school.color || '#999' }}
                                                        />
                                                        {school.name}
                                                      </div>
                                                    </DropdownMenuItem>
                                                  ))}
                                                </>
                                              )}
                                              {!canViewAllSchools && userSchoolId && (
                                                <DropdownMenuItem onClick={(e) => { 
                                                  e.stopPropagation(); 
                                                  handleSetDayState(dayData.date, 'no_laborable', [userSchoolId]); 
                                                }}>
                                                  Solo mi sede
                                                </DropdownMenuItem>
                                              )}
                                            </DropdownMenuSubContent>
                                          </DropdownMenuPortal>
                                        </DropdownMenuSub>

                                      </DropdownMenuSubContent>
                                    </DropdownMenuPortal>
                                  </DropdownMenuSub>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                            
                            {isSpecialDay ? (
                              <div className="flex-1 flex items-center justify-center px-1">
                                <span className="text-xs font-bold text-center leading-tight uppercase">
                                  {dayData.specialDayInfo!.title}
                                </span>
                              </div>
                            ) : hasMenus ? (
                              <div className="flex-1 flex flex-col gap-0.5 sm:gap-1 mt-1 sm:mt-2 overflow-hidden">
                                {dayData.menus.slice(0, 3).map((menu) => (
                                  <div
                                    key={menu.id}
                                    className="w-full flex items-center gap-1"
                                  >
                                    <div 
                                      className="w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full shrink-0"
                                      style={{ backgroundColor: menu.school_color || '#10b981' }}
                                    />
                                    <span className="text-[8px] sm:text-[9px] truncate text-muted-foreground">
                                      {menu.school_name}
                                    </span>
                                  </div>
                                ))}
                                {dayData.menus.length > 3 && (
                                  <div className="text-[7px] sm:text-[9px] text-center font-medium text-muted-foreground bg-gray-100 rounded px-0.5">
                                    +{dayData.menus.length - 3}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="flex-1 flex items-center justify-center">
                                <span className="text-[8px] sm:text-[10px] text-muted-foreground hidden sm:inline">Sin menú</span>
                                <span className="text-[8px] text-muted-foreground sm:hidden">-</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
          </TabsContent>

          {/* Tab: Pedidos */}
          <TabsContent value="orders">
            <LunchOrders />
          </TabsContent>

          {/* Tab: Analytics */}
          <TabsContent value="analytics">
            <LunchAnalyticsDashboard
              selectedSchool={selectedSchools.length === schools.length ? 'all' : selectedSchools[0] || 'all'}
              canViewAllSchools={canViewAllSchools}
            />
          </TabsContent>

          {/* Tab: Configuración */}
          <TabsContent value="config">
            <LunchConfiguration
              schoolId={userSchoolId}
              canEdit={canEdit || canCreate}
            />
          </TabsContent>
        </Tabs>
      </main>

      {/* Modales */}
      {/* Wizard de Categorías - Nuevo flujo intuitivo */}
      <LunchCategoryWizard
        open={isWizardOpen}
        onClose={() => {
          setIsWizardOpen(false);
          setWizardCategoryId(null);
          setWizardTargetType(null);
          setWizardCategoryName(null);
        }}
        schoolId={userSchoolId || ''}
        selectedDate={selectedDay?.date || new Date()}
        onComplete={handleWizardComplete}
      />

      {/* Gestor de Categorías */}
      {userSchoolId && (
        <CategoryManager
          schoolId={userSchoolId}
          open={isCategoryManagerOpen}
          onClose={() => setIsCategoryManagerOpen(false)}
        />
      )}

      {/* Modal de Menú (ahora con datos del wizard) */}
      <LunchMenuModal
        isOpen={isMenuModalOpen}
        onClose={() => {
          setIsMenuModalOpen(false);
          setSelectedMenuId(null);
          setSelectedDay(null);
          setWizardCategoryId(null);
          setWizardTargetType(null);
          setWizardCategoryName(null);
        }}
        menuId={selectedMenuId}
        initialDate={selectedDay?.date}
        schools={schools}
        userSchoolId={userSchoolId}
        preSelectedCategoryId={wizardCategoryId || undefined}
        preSelectedTargetType={wizardTargetType || undefined}
        preSelectedCategoryName={wizardCategoryName || undefined}
        onSuccess={() => {
          setIsMenuModalOpen(false);
          setWizardCategoryId(null);
          setWizardTargetType(null);
          setWizardCategoryName(null);
          // Recargar datos
          setCurrentDate(new Date(currentDate));
        }}
      />

      <MassUploadModal
        isOpen={isMassUploadModalOpen}
        onClose={() => setIsMassUploadModalOpen(false)}
        schools={schools}
        onSuccess={() => {
          setIsMassUploadModalOpen(false);
          setCurrentDate(new Date(currentDate));
        }}
      />

      <SpecialDayModal
        isOpen={isSpecialDayModalOpen}
        onClose={() => {
          setIsSpecialDayModalOpen(false);
          setSelectedDay(null);
        }}
        date={selectedDay?.date}
        schools={schools}
        onSuccess={() => {
          setIsSpecialDayModalOpen(false);
          setCurrentDate(new Date(currentDate));
        }}
      />

      {/* Modal para preguntar si crear otro menú */}
      <Dialog open={isCreateAnotherMenuOpen} onOpenChange={setIsCreateAnotherMenuOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <UtensilsCrossed className="h-6 w-6 text-green-600" />
              Este día ya tiene menú creado
            </DialogTitle>
          </DialogHeader>
          
          <div className="py-4 space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-gray-700">
                {selectedDay && selectedDay.menus.length > 1 
                  ? `Este día ya tiene ${selectedDay.menus.length} menús registrados.`
                  : 'Este día ya tiene un menú creado.'
                }
              </p>
              <p className="text-sm text-gray-600 mt-2">
                ¿Qué deseas hacer?
              </p>
            </div>

            <div className="space-y-2">
              <Button 
                onClick={handleCreateAnotherMenu}
                className="w-full gap-2 bg-green-600 hover:bg-green-700"
                size="lg"
              >
                <Plus className="h-5 w-5" />
                Crear un nuevo menú adicional
              </Button>
              
              <Button 
                onClick={handleViewExistingMenus}
                variant="outline"
                className="w-full gap-2"
                size="lg"
              >
                <Eye className="h-5 w-5" />
                {selectedDay && selectedDay.menus.length > 1 
                  ? 'Ver los menús existentes'
                  : 'Editar el menú existente'
                }
              </Button>

              <Button 
                onClick={() => setIsCreateAnotherMenuOpen(false)}
                variant="ghost"
                className="w-full"
              >
                Cancelar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de Detalle de Menús del Día */}
      <Dialog open={isDetailModalOpen} onOpenChange={setIsDetailModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-2xl">
              <UtensilsCrossed className="h-6 w-6 text-green-600" />
              Menús del {selectedDay && format(selectedDay.date, "EEEE d 'de' MMMM", { locale: es })}
            </DialogTitle>
          </DialogHeader>
          
          <div className="mt-6 space-y-6">
            {selectedDay?.menus.length === 0 ? (
              <div className="text-center py-12 bg-gray-50 rounded-xl border-2 border-dashed">
                <Coffee className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 font-medium">No hay menús registrados para este día.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {selectedDay?.menus.map((menu) => (
                  <Card key={menu.id} className="overflow-hidden border-l-4" style={{ borderLeftColor: menu.school_color || '#10b981' }}>
                    <CardHeader className="bg-muted/30 py-3 flex flex-row items-center justify-between space-y-0">
                      <CardTitle className="text-sm font-bold flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: menu.school_color || '#10b981' }} />
                        {menu.school_name}
                      </CardTitle>
                      {canEdit && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-8 text-xs"
                          onClick={() => {
                            setSelectedMenuId(menu.id);
                            setIsDetailModalOpen(false);
                            setIsMenuModalOpen(true);
                          }}
                        >
                          Editar
                        </Button>
                      )}
                    </CardHeader>
                    <CardContent className="pt-4 space-y-3">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Entrada</p>
                          <p className="font-medium">{menu.starter || '—'}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider text-green-700">Segundo</p>
                          <p className="font-bold text-green-700">{menu.main_course}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Bebida</p>
                          <p className="font-medium">{menu.beverage || '—'}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Postre</p>
                          <p className="font-medium">{menu.dessert || '—'}</p>
                        </div>
                      </div>
                      {menu.notes && (
                        <div className="mt-2 pt-2 border-t border-dashed">
                          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Notas</p>
                          <p className="text-xs text-muted-foreground italic mt-1">{menu.notes}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
            
            <div className="flex justify-end pt-4">
              <Button onClick={() => setIsDetailModalOpen(false)}>
                Cerrar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LunchCalendar;

