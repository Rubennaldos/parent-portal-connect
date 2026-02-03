import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Users,
  Briefcase,
  Utensils,
  Salad,
  Coins,
  Leaf,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  Calendar,
  Check,
  ArrowRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

// Mapeo de iconos
const ICON_MAP: Record<string, any> = {
  utensils: Utensils,
  salad: Salad,
  coins: Coins,
  leaf: Leaf,
  briefcase: Briefcase,
  sparkles: Sparkles,
};

interface LunchCategory {
  id: string;
  school_id: string;
  name: string;
  description: string | null;
  target_type: 'students' | 'teachers' | 'both';
  color: string;
  icon: string;
  price: number | null;
  is_active: boolean;
  display_order: number;
}

interface LunchCategoryWizardProps {
  open: boolean;
  onClose: () => void;
  schoolId: string;
  selectedDate: Date;
  onComplete: (categoryId: string, targetType: 'students' | 'teachers', categoryName: string) => void;
}

export function LunchCategoryWizard({
  open,
  onClose,
  schoolId,
  selectedDate,
  onComplete
}: LunchCategoryWizardProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedTargetType, setSelectedTargetType] = useState<'students' | 'teachers' | null>(null);
  const [categories, setCategories] = useState<LunchCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<LunchCategory | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && selectedTargetType) {
      fetchCategories();
    }
  }, [open, selectedTargetType, schoolId]);

  const fetchCategories = async () => {
    if (!selectedTargetType) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('lunch_categories')
        .select('*')
        .eq('school_id', schoolId)
        .eq('is_active', true)
        .or(`target_type.eq.${selectedTargetType},target_type.eq.both`)
        .order('display_order', { ascending: true });

      if (error) throw error;
      setCategories(data || []);
    } catch (error: any) {
      console.error('Error fetching categories:', error);
      toast({
        variant: 'destructive',
        title: 'Error al cargar categorías',
        description: error.message || 'Intenta nuevamente'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleTargetTypeSelect = (targetType: 'students' | 'teachers') => {
    setSelectedTargetType(targetType);
    setStep(2);
  };

  const handleCategorySelect = (category: LunchCategory) => {
    setSelectedCategory(category);
  };

  const handleComplete = () => {
    if (!selectedCategory || !selectedTargetType) return;
    
    onComplete(selectedCategory.id, selectedTargetType, selectedCategory.name);
    handleClose();
  };

  const handleClose = () => {
    setStep(1);
    setSelectedTargetType(null);
    setSelectedCategory(null);
    setCategories([]);
    onClose();
  };

  const handleBack = () => {
    if (step === 2) {
      setStep(1);
      setSelectedCategory(null);
      setSelectedTargetType(null); // Limpiar también el tipo seleccionado
    }
  };

  const getIconComponent = (iconName: string) => {
    return ICON_MAP[iconName] || Utensils;
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <DialogTitle className="text-2xl font-bold flex items-center gap-2">
                <Sparkles className="h-6 w-6 text-yellow-500" />
                Crear Nuevo Menú del Día
              </DialogTitle>
              <DialogDescription>
                Sigue los pasos para crear el menú de almuerzo para el{' '}
                <strong>{selectedDate.toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</strong>
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-600"
            >
              Cancelar
            </Button>
          </div>
        </DialogHeader>

        {/* Indicador de pasos - Mejorado */}
        <div className="flex items-center justify-center gap-2 my-4">
          <button
            onClick={() => step === 2 && handleBack()}
            disabled={step === 1}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg transition-all",
              step === 1 ? "bg-blue-100 border-2 border-blue-500" : "bg-gray-100 hover:bg-gray-200 cursor-pointer"
            )}
          >
            <div className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center font-bold",
              step === 1 ? "bg-blue-500 text-white" : "bg-gray-300 text-gray-600"
            )}>
              {step === 1 ? "1" : "✓"}
            </div>
            <span className="font-semibold hidden sm:inline">¿Para quién?</span>
            <span className="font-semibold sm:hidden">Paso 1</span>
          </button>
          
          <ChevronRight className="h-5 w-5 text-gray-400" />
          
          <div className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-lg transition-all",
            step === 2 ? "bg-blue-100 border-2 border-blue-500" : "bg-gray-100"
          )}>
            <div className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center font-bold",
              step === 2 ? "bg-blue-500 text-white" : "bg-gray-300 text-gray-600"
            )}>
              2
            </div>
            <span className="font-semibold hidden sm:inline">¿Qué tipo de almuerzo?</span>
            <span className="font-semibold sm:hidden">Paso 2</span>
          </div>
        </div>

        {/* Paso 1: Seleccionar público objetivo */}
        {step === 1 && (
          <div className="space-y-4 py-4">
            <div className="text-center mb-6">
              <h3 className="text-xl font-bold mb-2">¿Para quién es este almuerzo?</h3>
              <p className="text-gray-600">Selecciona si el menú será para alumnos o profesores</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Opción: Alumnos */}
              <button
                onClick={() => handleTargetTypeSelect('students')}
                className="group relative overflow-hidden rounded-2xl border-2 border-gray-200 hover:border-blue-500 transition-all duration-300 hover:shadow-xl hover:scale-105 active:scale-95 p-8"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-cyan-50 opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative z-10 flex flex-col items-center gap-4">
                  <div className="w-20 h-20 rounded-full bg-blue-100 group-hover:bg-blue-500 flex items-center justify-center transition-colors">
                    <Users className="h-10 w-10 text-blue-600 group-hover:text-white" />
                  </div>
                  <div className="text-center">
                    <h4 className="text-2xl font-bold mb-2 group-hover:text-blue-600">Alumnos</h4>
                    <p className="text-gray-600">Menú para estudiantes</p>
                  </div>
                  <div className="flex items-center gap-2 text-blue-600 font-semibold">
                    <span>Continuar</span>
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </div>
              </button>

              {/* Opción: Profesores */}
              <button
                onClick={() => handleTargetTypeSelect('teachers')}
                className="group relative overflow-hidden rounded-2xl border-2 border-gray-200 hover:border-purple-500 transition-all duration-300 hover:shadow-xl hover:scale-105 active:scale-95 p-8"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-purple-50 to-pink-50 opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative z-10 flex flex-col items-center gap-4">
                  <div className="w-20 h-20 rounded-full bg-purple-100 group-hover:bg-purple-500 flex items-center justify-center transition-colors">
                    <Briefcase className="h-10 w-10 text-purple-600 group-hover:text-white" />
                  </div>
                  <div className="text-center">
                    <h4 className="text-2xl font-bold mb-2 group-hover:text-purple-600">Profesores</h4>
                    <p className="text-gray-600">Menú para docentes</p>
                  </div>
                  <div className="flex items-center gap-2 text-purple-600 font-semibold">
                    <span>Continuar</span>
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Paso 2: Seleccionar categoría */}
        {step === 2 && (
          <div className="space-y-4 py-4">
            <div className="text-center mb-6">
              <div className="inline-flex items-center gap-2 bg-blue-100 px-4 py-2 rounded-full mb-3">
                {selectedTargetType === 'students' ? (
                  <>
                    <Users className="h-4 w-4 text-blue-600" />
                    <span className="font-semibold text-blue-600">Para Alumnos</span>
                  </>
                ) : (
                  <>
                    <Briefcase className="h-4 w-4 text-purple-600" />
                    <span className="font-semibold text-purple-600">Para Profesores</span>
                  </>
                )}
              </div>
              <h3 className="text-xl font-bold mb-2">¿Qué tipo de almuerzo deseas crear?</h3>
              <p className="text-gray-600">Selecciona una categoría de menú</p>
            </div>

            {loading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
                <p className="text-gray-600 mt-4">Cargando categorías...</p>
              </div>
            ) : categories.length === 0 ? (
              <div className="text-center py-8">
                <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600">No hay categorías disponibles para este tipo de almuerzo</p>
                <p className="text-sm text-gray-500 mt-2">Contacta al administrador para crear categorías</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {categories.map((category) => {
                  const IconComponent = getIconComponent(category.icon);
                  const isSelected = selectedCategory?.id === category.id;

                  return (
                    <button
                      key={category.id}
                      onClick={() => handleCategorySelect(category)}
                      className={cn(
                        "group relative overflow-hidden rounded-xl border-2 transition-all duration-300 hover:shadow-lg hover:scale-105 active:scale-95 p-6",
                        isSelected 
                          ? "border-green-500 bg-green-50" 
                          : "border-gray-200 hover:border-gray-300"
                      )}
                      style={{
                        borderColor: isSelected ? category.color : undefined
                      }}
                    >
                      {isSelected && (
                        <div className="absolute top-2 right-2 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                          <Check className="h-4 w-4 text-white" />
                        </div>
                      )}
                      
                      <div className="flex flex-col items-center gap-3">
                        <div 
                          className="w-16 h-16 rounded-full flex items-center justify-center transition-all group-hover:scale-110"
                          style={{ 
                            backgroundColor: `${category.color}20`,
                          }}
                        >
                          <IconComponent 
                            className="h-8 w-8" 
                            style={{ color: category.color }}
                          />
                        </div>
                        
                        <div className="text-center">
                          <h4 className="font-bold text-lg mb-1">{category.name}</h4>
                          {category.description && (
                            <p className="text-xs text-gray-600 line-clamp-2">
                              {category.description}
                            </p>
                          )}
                          {category.price && (
                            <Badge variant="secondary" className="mt-2">
                              S/ {category.price.toFixed(2)}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Botones de navegación */}
            <div className="flex justify-between pt-6 border-t gap-3">
              <Button
                variant="outline"
                onClick={handleBack}
                className="gap-2 flex-1 sm:flex-none"
                size="lg"
              >
                <ChevronLeft className="h-5 w-5" />
                Volver atrás
              </Button>

              <Button
                onClick={handleComplete}
                disabled={!selectedCategory}
                className="gap-2 bg-green-600 hover:bg-green-700 flex-1 sm:flex-none"
                size="lg"
              >
                Continuar con este menú
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
