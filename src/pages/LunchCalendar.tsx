import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar, ArrowLeft, Plus, ChevronLeft, ChevronRight, Upload, Download, Filter } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LunchMenuModal } from '@/components/lunch/LunchMenuModal';
import { MassUploadModal } from '@/components/lunch/MassUploadModal';
import { SpecialDayModal } from '@/components/lunch/SpecialDayModal';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

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
  const [isMassUploadModalOpen, setIsMassUploadModalOpen] = useState(false);
  const [isSpecialDayModalOpen, setIsSpecialDayModalOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<DayData | null>(null);
  const [selectedMenuId, setSelectedMenuId] = useState<string | null>(null);

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

  const handlePreviousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const handleDayClick = (dayData: DayData) => {
    setSelectedDay(dayData);
    
    // Si hay un solo menú, abrirlo para editar
    if (dayData.menus.length === 1 && canEdit) {
      setSelectedMenuId(dayData.menus[0].id);
      setIsMenuModalOpen(true);
    } else if (dayData.menus.length === 0 && canCreate) {
      // Si no hay menús, abrir modal para crear
      setSelectedMenuId(null);
      setIsMenuModalOpen(true);
    }
  };

  const handleCreateMenu = () => {
    setSelectedDay(null);
    setSelectedMenuId(null);
    setIsMenuModalOpen(true);
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
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/dashboard')}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Volver
            </Button>
            <div className="w-10 h-10 bg-green-500/10 rounded-xl flex items-center justify-center">
              <Calendar className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <h1 className="font-semibold">Calendario de Almuerzos</h1>
              <p className="text-xs text-muted-foreground">
                Gestión de menús escolares
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canExport && (
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="h-4 w-4 mr-2" />
                Exportar
              </Button>
            )}
            {canMassUpload && (
              <Button variant="outline" size="sm" onClick={() => setIsMassUploadModalOpen(true)}>
                <Upload className="h-4 w-4 mr-2" />
                Carga Masiva
              </Button>
            )}
            {canCreate && (
              <Button size="sm" onClick={handleCreateMenu}>
                <Plus className="h-4 w-4 mr-2" />
                Nuevo Menú
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-12 gap-6">
          {/* Panel lateral de filtros */}
          <aside className="col-span-3">
            <Card>
              <CardHeader>
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

          {/* Calendario principal */}
          <div className="col-span-9">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-2xl">
                      {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
                    </CardTitle>
                    <CardDescription>
                      {selectedSchools.length} sede(s) seleccionada(s)
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handlePreviousMonth}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentDate(new Date())}
                    >
                      Hoy
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleNextMonth}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="text-center py-12 text-muted-foreground">
                    Cargando calendario...
                  </div>
                ) : (
                  <div className="grid grid-cols-7 gap-2">
                    {/* Encabezados de días */}
                    {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((day) => (
                      <div
                        key={day}
                        className="text-center text-sm font-medium text-muted-foreground py-2"
                      >
                        {day}
                      </div>
                    ))}

                    {/* Espacios vacíos antes del primer día */}
                    {Array.from({ length: firstDayOfMonth }).map((_, i) => (
                      <div key={`empty-${i}`} className="aspect-square" />
                    ))}

                    {/* Días del mes */}
                    {calendarData.map((dayData, index) => {
                      const isToday =
                        dayData.date.toDateString() === new Date().toDateString();
                      const hasMenus = dayData.menus.length > 0;

                      let bgClass = 'bg-gray-50 hover:bg-gray-100';
                      if (hasMenus) {
                        bgClass = 'bg-green-50 hover:bg-green-100 border-green-200';
                      }
                      if (dayData.isSpecialDay && dayData.specialDayInfo) {
                        bgClass = SPECIAL_DAY_COLORS[
                          dayData.specialDayInfo.type as keyof typeof SPECIAL_DAY_COLORS
                        ] || bgClass;
                      }

                      return (
                        <button
                          key={index}
                          onClick={() => handleDayClick(dayData)}
                          className={cn(
                            'aspect-square border rounded-lg p-2 transition-all',
                            bgClass,
                            isToday && 'ring-2 ring-blue-500',
                            'hover:shadow-md cursor-pointer'
                          )}
                        >
                          <div className="h-full flex flex-col">
                            <div className="text-sm font-semibold">
                              {dayData.date.getDate()}
                            </div>
                            
                            {dayData.isSpecialDay && dayData.specialDayInfo && (
                              <div className="flex-1 flex items-center justify-center">
                                <Badge variant="secondary" className="text-xs px-1 py-0">
                                  {dayData.specialDayInfo.type === 'feriado' && '🎉'}
                                  {dayData.specialDayInfo.type === 'no_laborable' && '🚫'}
                                  {dayData.specialDayInfo.type === 'suspension' && '⚠️'}
                                </Badge>
                              </div>
                            )}

                            {hasMenus && (
                              <div className="flex-1 flex flex-col gap-0.5 mt-1 overflow-hidden">
                                {dayData.menus.slice(0, 3).map((menu) => (
                                  <div
                                    key={menu.id}
                                    className="w-full h-1 rounded-full"
                                    style={{
                                      backgroundColor: menu.school_color || '#10b981',
                                    }}
                                  />
                                ))}
                                {dayData.menus.length > 3 && (
                                  <div className="text-xs text-center text-muted-foreground">
                                    +{dayData.menus.length - 3}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* Modales */}
      <LunchMenuModal
        isOpen={isMenuModalOpen}
        onClose={() => {
          setIsMenuModalOpen(false);
          setSelectedMenuId(null);
          setSelectedDay(null);
        }}
        menuId={selectedMenuId}
        initialDate={selectedDay?.date}
        schools={schools}
        userSchoolId={userSchoolId}
        onSuccess={() => {
          setIsMenuModalOpen(false);
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
    </div>
  );
};

export default LunchCalendar;

