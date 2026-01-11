import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface WeeklyMenuModalProps {
  isOpen: boolean;
  onClose: () => void;
  studentId: string;
}

interface LunchMenu {
  id: string;
  date: string;
  starter: string | null;
  main_course: string;
  beverage: string | null;
  dessert: string | null;
  notes: string | null;
  school_name: string;
}

interface SpecialDay {
  date: string;
  type: string;
  title: string;
  description: string | null;
}

export const WeeklyMenuModal = ({ isOpen, onClose, studentId }: WeeklyMenuModalProps) => {
  const [loading, setLoading] = useState(true);
  const [weekMenus, setWeekMenus] = useState<LunchMenu[]>([]);
  const [specialDays, setSpecialDays] = useState<SpecialDay[]>([]);
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [schoolId, setSchoolId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && studentId) {
      fetchStudentSchool();
    }
  }, [isOpen, studentId]);

  useEffect(() => {
    if (isOpen && schoolId) {
      fetchWeekMenus();
    }
  }, [isOpen, schoolId, currentWeekStart]);

  const fetchStudentSchool = async () => {
    try {
      const { data: student, error } = await supabase
        .from('students')
        .select('school_id')
        .eq('id', studentId)
        .single();

      if (error) throw error;
      setSchoolId(student?.school_id || null);
    } catch (error) {
      console.error('Error fetching student school:', error);
    }
  };

  const fetchWeekMenus = async () => {
    if (!schoolId) return;

    setLoading(true);
    try {
      const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 });

      // Usar la función que respeta límites de visibilidad para padres
      const { data: menus, error: menusError } = await supabase.rpc(
        'get_visible_lunch_menus_for_parent',
        {
          target_school_id: schoolId,
          target_date: format(new Date(), 'yyyy-MM-dd'),
        }
      );

      if (menusError) throw menusError;

      // Filtrar solo los menús de la semana actual
      const weekStart = format(currentWeekStart, 'yyyy-MM-dd');
      const weekEndStr = format(weekEnd, 'yyyy-MM-dd');
      
      const weekMenusFiltered = (menus || []).filter((menu: any) => 
        menu.date >= weekStart && menu.date <= weekEndStr
      );

      // Obtener nombre de la sede
      const { data: school } = await supabase
        .from('schools')
        .select('name')
        .eq('id', schoolId)
        .single();

      // Formatear los datos
      const formattedMenus = weekMenusFiltered.map((menu: any) => ({
        ...menu,
        school_name: school?.name || '',
      }));

      // Obtener días especiales de la semana
      const { data: special, error: specialError } = await supabase
        .from('special_days')
        .select('date, type, title, description')
        .or(`school_id.is.null,school_id.eq.${schoolId}`)
        .gte('date', weekStart)
        .lte('date', weekEndStr);

      if (specialError) throw specialError;

      setWeekMenus(formattedMenus);
      setSpecialDays(special || []);
    } catch (error) {
      console.error('Error fetching week menus:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePreviousWeek = () => {
    setCurrentWeekStart((prev) => addDays(prev, -7));
  };

  const handleNextWeek = () => {
    setCurrentWeekStart((prev) => addDays(prev, 7));
  };

  const handleToday = () => {
    setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));
  };

  const getMenuForDate = (date: Date): LunchMenu | null => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return weekMenus.find((menu) => menu.date === dateStr) || null;
  };

  const getSpecialDayForDate = (date: Date): SpecialDay | null => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return specialDays.find((day) => day.date === dateStr) || null;
  };

  const weekDays = eachDayOfInterval({
    start: currentWeekStart,
    end: addDays(currentWeekStart, 4), // Solo lunes a viernes
  });

  const SPECIAL_DAY_BADGES = {
    feriado: { label: 'Feriado', color: 'bg-red-100 text-red-800 border-red-300' },
    no_laborable: { label: 'No Laborable', color: 'bg-gray-100 text-gray-800 border-gray-300' },
    suspension: { label: 'Suspensión', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
    otro: { label: 'Evento', color: 'bg-blue-100 text-blue-800 border-blue-300' },
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Menú Semanal de Almuerzos
          </DialogTitle>
          <DialogDescription>
            Consulta el menú de la semana para tu hijo/a
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Navegación de semana */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={handlePreviousWeek}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={handleToday}>
                Hoy
              </Button>
              <Button variant="outline" size="icon" onClick={handleNextWeek}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="text-sm font-medium">
              {format(currentWeekStart, "d 'de' MMMM", { locale: es })} -{' '}
              {format(addDays(currentWeekStart, 4), "d 'de' MMMM 'de' yyyy", { locale: es })}
            </div>
          </div>

          {loading ? (
            <div className="text-center py-12 text-muted-foreground">
              Cargando menús de la semana...
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              {weekDays.map((day) => {
                const menu = getMenuForDate(day);
                const specialDay = getSpecialDayForDate(day);
                const isToday = format(day, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');

                return (
                  <Card
                    key={day.toString()}
                    className={isToday ? 'border-2 border-primary' : ''}
                  >
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">
                        {format(day, 'EEEE', { locale: es }).charAt(0).toUpperCase() +
                          format(day, 'EEEE', { locale: es }).slice(1)}
                      </CardTitle>
                      <div className="text-xs text-muted-foreground">
                        {format(day, "d 'de' MMM", { locale: es })}
                      </div>
                      {isToday && (
                        <Badge variant="default" className="w-fit text-xs">
                          Hoy
                        </Badge>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {specialDay ? (
                        <div className="space-y-2">
                          <Badge
                            variant="outline"
                            className={
                              SPECIAL_DAY_BADGES[
                                specialDay.type as keyof typeof SPECIAL_DAY_BADGES
                              ]?.color || ''
                            }
                          >
                            {
                              SPECIAL_DAY_BADGES[
                                specialDay.type as keyof typeof SPECIAL_DAY_BADGES
                              ]?.label
                            }
                          </Badge>
                          <p className="text-sm font-medium">{specialDay.title}</p>
                          {specialDay.description && (
                            <p className="text-xs text-muted-foreground">
                              {specialDay.description}
                            </p>
                          )}
                        </div>
                      ) : menu ? (
                        <div className="space-y-2 text-sm">
                          {menu.starter && (
                            <div>
                              <p className="text-xs font-semibold text-muted-foreground">
                                🥗 Entrada
                              </p>
                              <p className="text-xs">{menu.starter}</p>
                            </div>
                          )}
                          <div>
                            <p className="text-xs font-semibold text-muted-foreground">
                              🍲 Segundo
                            </p>
                            <p className="text-xs font-medium">{menu.main_course}</p>
                          </div>
                          {menu.beverage && (
                            <div>
                              <p className="text-xs font-semibold text-muted-foreground">
                                🥤 Bebida
                              </p>
                              <p className="text-xs">{menu.beverage}</p>
                            </div>
                          )}
                          {menu.dessert && (
                            <div>
                              <p className="text-xs font-semibold text-muted-foreground">
                                🍰 Postre
                              </p>
                              <p className="text-xs">{menu.dessert}</p>
                            </div>
                          )}
                          {menu.notes && (
                            <div className="pt-2 border-t">
                              <p className="text-xs text-muted-foreground italic">
                                {menu.notes}
                              </p>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground text-center py-4">
                          Sin menú disponible
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {!loading && weekMenus.length === 0 && specialDays.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  No hay menús disponibles para esta semana
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  El colegio aún no ha publicado el menú
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
