import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { 
  UtensilsCrossed, 
  Calendar, 
  Clock,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  X
} from 'lucide-react';
import { format, addWeeks, startOfWeek, addDays } from 'date-fns';
import { es } from 'date-fns/locale';

interface WeeklyMenu {
  id: string;
  school_id: string;
  week_start_date: string;
  is_active: boolean;
  monday_menu: any;
  tuesday_menu: any;
  wednesday_menu: any;
  thursday_menu: any;
  friday_menu: any;
}

interface MenuModalProps {
  isOpen: boolean;
  onClose: () => void;
  schoolId: string;
}

export function WeeklyMenuModal({ isOpen, onClose, schoolId }: MenuModalProps) {
  const [currentWeekStart, setCurrentWeekStart] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [menu, setMenu] = useState<WeeklyMenu | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen) {
      fetchMenu();
    }
  }, [isOpen, currentWeekStart, schoolId]);

  const fetchMenu = async () => {
    setLoading(true);
    try {
      const weekStartStr = format(currentWeekStart, 'yyyy-MM-dd');
      
      const { data, error } = await supabase
        .from('weekly_menus')
        .select('*')
        .eq('school_id', schoolId)
        .eq('week_start_date', weekStartStr)
        .eq('is_active', true)
        .maybeSingle();

      if (error) throw error;
      setMenu(data);
    } catch (error) {
      console.error('Error fetching menu:', error);
    } finally {
      setLoading(false);
    }
  };

  const days = [
    { key: 'monday_menu', name: 'Lunes', date: addDays(currentWeekStart, 0) },
    { key: 'tuesday_menu', name: 'Martes', date: addDays(currentWeekStart, 1) },
    { key: 'wednesday_menu', name: 'Miércoles', date: addDays(currentWeekStart, 2) },
    { key: 'thursday_menu', name: 'Jueves', date: addDays(currentWeekStart, 3) },
    { key: 'friday_menu', name: 'Viernes', date: addDays(currentWeekStart, 4) },
  ];

  const goToPreviousWeek = () => {
    setCurrentWeekStart(addWeeks(currentWeekStart, -1));
  };

  const goToNextWeek = () => {
    setCurrentWeekStart(addWeeks(currentWeekStart, 1));
  };

  const goToCurrentWeek = () => {
    setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));
  };

  const renderDishCard = (dish: any, type: 'entrada' | 'principal' | 'postre') => {
    if (!dish) return null;

    const typeColors = {
      entrada: 'bg-green-50 border-green-200 text-green-700',
      principal: 'bg-orange-50 border-orange-200 text-orange-700',
      postre: 'bg-pink-50 border-pink-200 text-pink-700'
    };

    const typeLabels = {
      entrada: 'Entrada',
      principal: 'Plato Principal',
      postre: 'Postre'
    };

    return (
      <div className={`border-2 rounded-lg p-3 ${typeColors[type]}`}>
        <Badge className="mb-2 text-xs" variant="secondary">
          {typeLabels[type]}
        </Badge>
        <p className="font-semibold text-sm">{dish.nombre || dish.name}</p>
        {dish.precio && (
          <p className="text-xs mt-1">S/ {dish.precio.toFixed(2)}</p>
        )}
      </div>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[95vh] overflow-y-auto">
        {/* Header con botón de cerrar prominente */}
        <div className="flex items-center justify-between sticky top-0 bg-white z-10 pb-4 border-b">
          <DialogHeader>
            <DialogTitle className="text-3xl font-bold flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-red-500 rounded-xl flex items-center justify-center">
                <UtensilsCrossed className="h-6 w-6 text-white" />
              </div>
              Menú Semanal
            </DialogTitle>
          </DialogHeader>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-10 w-10"
          >
            <X className="h-6 w-6" />
          </Button>
        </div>

        {/* Navegación de semanas */}
        <div className="flex items-center justify-between bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-4">
          <Button
            variant="outline"
            onClick={goToPreviousWeek}
            className="h-10"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Anterior
          </Button>

          <div className="text-center">
            <div className="flex items-center gap-2 justify-center">
              <Calendar className="h-5 w-5 text-blue-600" />
              <p className="text-lg font-bold text-gray-900">
                {format(currentWeekStart, "d 'de' MMMM", { locale: es })} 
                {' - '}
                {format(addDays(currentWeekStart, 4), "d 'de' MMMM, yyyy", { locale: es })}
              </p>
            </div>
            <Button
              variant="link"
              onClick={goToCurrentWeek}
              className="text-xs h-auto p-0 mt-1"
            >
              Ir a semana actual
            </Button>
          </div>

          <Button
            variant="outline"
            onClick={goToNextWeek}
            className="h-10"
          >
            Siguiente
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>

        {/* Contenido del menú */}
        {loading ? (
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-500">Cargando menú...</p>
            </div>
          </div>
        ) : !menu ? (
          <Card className="bg-yellow-50 border-yellow-200 p-8">
            <div className="text-center">
              <AlertCircle className="h-16 w-16 text-yellow-600 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-yellow-900 mb-2">
                No hay menú disponible
              </h3>
              <p className="text-yellow-700">
                El menú para esta semana aún no ha sido publicado.
                <br />
                Por favor, intenta más tarde o contacta con el colegio.
              </p>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {days.map((day) => {
              const dayMenu = menu[day.key as keyof WeeklyMenu] as any;
              const isToday = format(day.date, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');

              return (
                <Card
                  key={day.key}
                  className={`overflow-hidden ${
                    isToday 
                      ? 'ring-4 ring-blue-500 shadow-lg' 
                      : 'border-2'
                  }`}
                >
                  {/* Header del día */}
                  <div className={`p-4 text-center ${
                    isToday 
                      ? 'bg-gradient-to-br from-blue-500 to-purple-500 text-white' 
                      : 'bg-gradient-to-br from-gray-100 to-gray-200'
                  }`}>
                    <p className={`text-xs font-semibold uppercase tracking-wide ${
                      isToday ? 'text-blue-100' : 'text-gray-600'
                    }`}>
                      {day.name}
                    </p>
                    <p className={`text-2xl font-bold ${
                      isToday ? 'text-white' : 'text-gray-900'
                    }`}>
                      {format(day.date, 'd')}
                    </p>
                    {isToday && (
                      <Badge className="mt-2 bg-white text-blue-600 text-xs">
                        Hoy
                      </Badge>
                    )}
                  </div>

                  {/* Menú del día */}
                  <div className="p-4 space-y-3">
                    {dayMenu ? (
                      <>
                        {dayMenu.entrada && renderDishCard(dayMenu.entrada, 'entrada')}
                        {dayMenu.principal && renderDishCard(dayMenu.principal, 'principal')}
                        {dayMenu.postre && renderDishCard(dayMenu.postre, 'postre')}
                        
                        {!dayMenu.entrada && !dayMenu.principal && !dayMenu.postre && (
                          <div className="text-center py-8 text-gray-400">
                            <UtensilsCrossed className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            <p className="text-xs">Sin menú</p>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-center py-8 text-gray-400">
                        <UtensilsCrossed className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p className="text-xs">Sin menú</p>
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* Footer informativo */}
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
          <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-blue-900">
            <p className="font-semibold mb-1">Información importante:</p>
            <ul className="text-xs space-y-1 text-blue-700">
              <li>• El menú está sujeto a disponibilidad de ingredientes</li>
              <li>• Los precios pueden variar sin previo aviso</li>
              <li>• Si tu hijo tiene alergias, verifica los ingredientes antes de comprar</li>
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

