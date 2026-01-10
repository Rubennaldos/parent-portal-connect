import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Plus, Trash2, Calendar } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';

interface School {
  id: string;
  name: string;
  color?: string;
}

interface MassUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  schools: School[];
  onSuccess: () => void;
}

interface MenuEntry {
  id: string;
  date: string;
  starter: string;
  main_course: string;
  beverage: string;
  dessert: string;
  notes: string;
}

export const MassUploadModal = ({
  isOpen,
  onClose,
  schools,
  onSuccess,
}: MassUploadModalProps) => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [selectedSchools, setSelectedSchools] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState({
    start: '',
    end: '',
  });
  const [entries, setEntries] = useState<MenuEntry[]>([
    {
      id: crypto.randomUUID(),
      date: '',
      starter: '',
      main_course: '',
      beverage: '',
      dessert: '',
      notes: '',
    },
  ]);

  const toggleSchool = (schoolId: string) => {
    setSelectedSchools((prev) =>
      prev.includes(schoolId)
        ? prev.filter((id) => id !== schoolId)
        : [...prev, schoolId]
    );
  };

  const addEntry = () => {
    setEntries((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        date: '',
        starter: '',
        main_course: '',
        beverage: '',
        dessert: '',
        notes: '',
      },
    ]);
  };

  const removeEntry = (id: string) => {
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
  };

  const updateEntry = (id: string, field: keyof MenuEntry, value: string) => {
    setEntries((prev) =>
      prev.map((entry) =>
        entry.id === id ? { ...entry, [field]: value } : entry
      )
    );
  };

  const generateDateRange = () => {
    if (!dateRange.start || !dateRange.end) {
      toast({
        title: 'Rango incompleto',
        description: 'Por favor selecciona fecha de inicio y fin',
        variant: 'destructive',
      });
      return;
    }

    const start = new Date(dateRange.start);
    const end = new Date(dateRange.end);

    if (start > end) {
      toast({
        title: 'Rango inválido',
        description: 'La fecha de inicio debe ser anterior a la fecha de fin',
        variant: 'destructive',
      });
      return;
    }

    const newEntries: MenuEntry[] = [];
    const current = new Date(start);

    while (current <= end) {
      // Solo agregar días de semana (lunes a viernes)
      const dayOfWeek = current.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        newEntries.push({
          id: crypto.randomUUID(),
          date: current.toISOString().split('T')[0],
          starter: '',
          main_course: '',
          beverage: '',
          dessert: '',
          notes: '',
        });
      }
      current.setDate(current.getDate() + 1);
    }

    setEntries(newEntries);

    toast({
      title: 'Fechas generadas',
      description: `Se generaron ${newEntries.length} días (solo días de semana)`,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (selectedSchools.length === 0) {
      toast({
        title: 'Sin sedes',
        description: 'Por favor selecciona al menos una sede',
        variant: 'destructive',
      });
      return;
    }

    // Validar que cada entrada tenga fecha y segundo plato
    const invalidEntries = entries.filter(
      (entry) => !entry.date || !entry.main_course.trim()
    );

    if (invalidEntries.length > 0) {
      toast({
        title: 'Entradas incompletas',
        description: 'Todas las entradas deben tener fecha y segundo plato',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      // Crear un menú por cada combinación de sede y entrada
      const menusToInsert = [];

      for (const schoolId of selectedSchools) {
        for (const entry of entries) {
          menusToInsert.push({
            school_id: schoolId,
            date: entry.date,
            starter: entry.starter.trim() || null,
            main_course: entry.main_course.trim(),
            beverage: entry.beverage.trim() || null,
            dessert: entry.dessert.trim() || null,
            notes: entry.notes.trim() || null,
            created_by: user?.id,
          });
        }
      }

      // Insertar todos los menús (usando upsert para evitar duplicados)
      const { error } = await supabase
        .from('lunch_menus')
        .upsert(menusToInsert, {
          onConflict: 'school_id,date',
          ignoreDuplicates: false, // Actualizar si ya existe
        });

      if (error) throw error;

      toast({
        title: 'Carga exitosa',
        description: `Se cargaron ${menusToInsert.length} menús para ${selectedSchools.length} sede(s)`,
      });

      onSuccess();
    } catch (error: any) {
      console.error('Error during mass upload:', error);
      toast({
        title: 'Error',
        description: 'No se pudieron cargar todos los menús',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Carga Masiva de Menús</DialogTitle>
          <DialogDescription>
            Carga múltiples menús a la vez para una o más sedes
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Selección de sedes */}
          <Card>
            <CardContent className="pt-6">
              <Label className="text-sm font-medium mb-3 block">
                Sedes a aplicar (selecciona múltiples)
              </Label>
              <div className="grid grid-cols-3 gap-3">
                {schools.map((school) => (
                  <div key={school.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`mass-school-${school.id}`}
                      checked={selectedSchools.includes(school.id)}
                      onCheckedChange={() => toggleSchool(school.id)}
                    />
                    <label
                      htmlFor={`mass-school-${school.id}`}
                      className="text-sm flex items-center gap-2 cursor-pointer"
                    >
                      {school.color && (
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: school.color }}
                        />
                      )}
                      <span className="truncate">{school.name}</span>
                    </label>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Generador de rango de fechas */}
          <Card>
            <CardContent className="pt-6">
              <Label className="text-sm font-medium mb-3 block">
                <Calendar className="inline h-4 w-4 mr-2" />
                Generador Rápido (solo días de semana)
              </Label>
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <Label htmlFor="start-date" className="text-xs">
                    Fecha inicio
                  </Label>
                  <Input
                    id="start-date"
                    type="date"
                    value={dateRange.start}
                    onChange={(e) =>
                      setDateRange((prev) => ({ ...prev, start: e.target.value }))
                    }
                  />
                </div>
                <div className="flex-1">
                  <Label htmlFor="end-date" className="text-xs">
                    Fecha fin
                  </Label>
                  <Input
                    id="end-date"
                    type="date"
                    value={dateRange.end}
                    onChange={(e) =>
                      setDateRange((prev) => ({ ...prev, end: e.target.value }))
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={generateDateRange}
                >
                  Generar Fechas
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Listado de menús */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">
                Menús a cargar ({entries.length})
              </Label>
              <Button type="button" variant="outline" size="sm" onClick={addEntry}>
                <Plus className="h-4 w-4 mr-2" />
                Agregar entrada manual
              </Button>
            </div>

            <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
              {entries.map((entry, index) => (
                <Card key={entry.id}>
                  <CardContent className="pt-4">
                    <div className="grid grid-cols-12 gap-3">
                      <div className="col-span-2">
                        <Label htmlFor={`date-${entry.id}`} className="text-xs">
                          Fecha *
                        </Label>
                        <Input
                          id={`date-${entry.id}`}
                          type="date"
                          value={entry.date}
                          onChange={(e) =>
                            updateEntry(entry.id, 'date', e.target.value)
                          }
                          disabled={loading}
                          required
                        />
                      </div>
                      <div className="col-span-2">
                        <Label htmlFor={`starter-${entry.id}`} className="text-xs">
                          🥗 Entrada
                        </Label>
                        <Input
                          id={`starter-${entry.id}`}
                          value={entry.starter}
                          onChange={(e) =>
                            updateEntry(entry.id, 'starter', e.target.value)
                          }
                          disabled={loading}
                          placeholder="Entrada"
                        />
                      </div>
                      <div className="col-span-3">
                        <Label htmlFor={`main-${entry.id}`} className="text-xs">
                          🍲 Segundo *
                        </Label>
                        <Input
                          id={`main-${entry.id}`}
                          value={entry.main_course}
                          onChange={(e) =>
                            updateEntry(entry.id, 'main_course', e.target.value)
                          }
                          disabled={loading}
                          placeholder="Segundo plato"
                          required
                        />
                      </div>
                      <div className="col-span-2">
                        <Label htmlFor={`beverage-${entry.id}`} className="text-xs">
                          🥤 Bebida
                        </Label>
                        <Input
                          id={`beverage-${entry.id}`}
                          value={entry.beverage}
                          onChange={(e) =>
                            updateEntry(entry.id, 'beverage', e.target.value)
                          }
                          disabled={loading}
                          placeholder="Bebida"
                        />
                      </div>
                      <div className="col-span-2">
                        <Label htmlFor={`dessert-${entry.id}`} className="text-xs">
                          🍰 Postre
                        </Label>
                        <Input
                          id={`dessert-${entry.id}`}
                          value={entry.dessert}
                          onChange={(e) =>
                            updateEntry(entry.id, 'dessert', e.target.value)
                          }
                          disabled={loading}
                          placeholder="Postre"
                        />
                      </div>
                      <div className="col-span-1 flex items-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeEntry(entry.id)}
                          disabled={loading || entries.length === 1}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cargando...
                </>
              ) : (
                `Cargar ${entries.length * selectedSchools.length} menús`
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

