import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
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
import { Loader2 } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

interface School {
  id: string;
  name: string;
  color?: string;
}

interface SpecialDayModalProps {
  isOpen: boolean;
  onClose: () => void;
  date?: Date;
  schools: School[];
  onSuccess: () => void;
}

export const SpecialDayModal = ({
  isOpen,
  onClose,
  date,
  schools,
  onSuccess,
}: SpecialDayModalProps) => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    date: date ? date.toISOString().split('T')[0] : '',
    type: 'feriado' as 'feriado' | 'no_laborable' | 'suspension' | 'otro',
    title: '',
    description: '',
    scope: 'all' as 'all' | 'specific',
    school_id: '',
  });

  useEffect(() => {
    if (date && isOpen) {
      setFormData((prev) => ({
        ...prev,
        date: date.toISOString().split('T')[0],
      }));
    }
  }, [date, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.date || !formData.title.trim()) {
      toast({
        title: 'Campos incompletos',
        description: 'Por favor completa la fecha y el título',
        variant: 'destructive',
      });
      return;
    }

    if (formData.scope === 'specific' && !formData.school_id) {
      toast({
        title: 'Sede no seleccionada',
        description: 'Por favor selecciona una sede específica',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const payload = {
        date: formData.date,
        type: formData.type,
        title: formData.title.trim(),
        description: formData.description.trim() || null,
        school_id: formData.scope === 'all' ? null : formData.school_id,
        created_by: user?.id,
      };

      const { error } = await supabase
        .from('special_days')
        .upsert([payload], {
          onConflict: 'date,school_id',
        });

      if (error) throw error;

      toast({
        title: 'Día especial marcado',
        description: `Se marcó el ${formData.date} como ${formData.type}`,
      });

      onSuccess();
    } catch (error: any) {
      console.error('Error saving special day:', error);
      
      let errorMessage = 'No se pudo marcar el día especial';
      if (error.code === '23505') {
        errorMessage = 'Ya existe un día especial marcado para esta fecha y sede';
      }

      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Marcar Día Especial</DialogTitle>
          <DialogDescription>
            Define feriados, días no laborables u otros eventos especiales
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="special-date">Fecha *</Label>
            <Input
              id="special-date"
              type="date"
              value={formData.date}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, date: e.target.value }))
              }
              disabled={loading}
              required
            />
          </div>

          <div>
            <Label>Tipo de día especial *</Label>
            <RadioGroup
              value={formData.type}
              onValueChange={(value: any) =>
                setFormData((prev) => ({ ...prev, type: value }))
              }
              disabled={loading}
              className="mt-2 space-y-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="feriado" id="feriado" />
                <label htmlFor="feriado" className="text-sm cursor-pointer">
                  🎉 Feriado
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="no_laborable" id="no_laborable" />
                <label htmlFor="no_laborable" className="text-sm cursor-pointer">
                  🚫 Día no laborable
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="suspension" id="suspension" />
                <label htmlFor="suspension" className="text-sm cursor-pointer">
                  ⚠️ Suspensión de clases
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="otro" id="otro" />
                <label htmlFor="otro" className="text-sm cursor-pointer">
                  📅 Otro evento
                </label>
              </div>
            </RadioGroup>
          </div>

          <div>
            <Label htmlFor="special-title">Título *</Label>
            <Input
              id="special-title"
              placeholder="Ej: Día de la Independencia"
              value={formData.title}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, title: e.target.value }))
              }
              disabled={loading}
              required
            />
          </div>

          <div>
            <Label htmlFor="special-description">Descripción</Label>
            <Textarea
              id="special-description"
              placeholder="Información adicional..."
              value={formData.description}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, description: e.target.value }))
              }
              disabled={loading}
              rows={3}
            />
          </div>

          <div>
            <Label>Alcance *</Label>
            <RadioGroup
              value={formData.scope}
              onValueChange={(value: any) =>
                setFormData((prev) => ({ ...prev, scope: value, school_id: '' }))
              }
              disabled={loading}
              className="mt-2 space-y-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="all" id="scope-all" />
                <label htmlFor="scope-all" className="text-sm cursor-pointer">
                  Todas las sedes
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="specific" id="scope-specific" />
                <label htmlFor="scope-specific" className="text-sm cursor-pointer">
                  Sede específica
                </label>
              </div>
            </RadioGroup>
          </div>

          {formData.scope === 'specific' && (
            <div>
              <Label htmlFor="special-school">Sede *</Label>
              <Select
                value={formData.school_id}
                onValueChange={(value) =>
                  setFormData((prev) => ({ ...prev, school_id: value }))
                }
                disabled={loading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona una sede" />
                </SelectTrigger>
                <SelectContent>
                  {schools.map((school) => (
                    <SelectItem key={school.id} value={school.id}>
                      <div className="flex items-center gap-2">
                        {school.color && (
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: school.color }}
                          />
                        )}
                        {school.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                'Marcar Día'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

