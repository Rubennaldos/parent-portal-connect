import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { Loader2 } from 'lucide-react';

interface AddStudentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStudentAdded: () => void;
  parentId: string;
}

export function AddStudentModal({ open, onOpenChange, onStudentAdded, parentId }: AddStudentModalProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [formData, setFormData] = useState({
    full_name: '',
    grade: '',
    section: '',
    balance: '0',
    daily_limit: '15',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.full_name.trim()) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'El nombre completo es obligatorio',
      });
      return;
    }

    if (!formData.grade) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Selecciona un grado',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase
        .from('students')
        .insert({
          full_name: formData.full_name.trim(),
          grade: formData.grade,
          section: formData.section || 'A',
          balance: parseFloat(formData.balance) || 0,
          daily_limit: parseFloat(formData.daily_limit) || 15,
          parent_id: parentId,
          is_active: true,
        });

      if (error) throw error;

      toast({
        title: '✅ Estudiante Registrado',
        description: `${formData.full_name} ha sido agregado correctamente`,
      });

      // Limpiar formulario
      setFormData({
        full_name: '',
        grade: '',
        section: '',
        balance: '0',
        daily_limit: '15',
      });

      onStudentAdded();
      onOpenChange(false);

    } catch (error: any) {
      console.error('Error adding student:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo registrar al estudiante: ' + error.message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar Estudiante</DialogTitle>
          <DialogDescription>
            Agrega los datos de tu hijo para gestionar su cuenta del kiosco
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Nombre Completo */}
          <div>
            <Label htmlFor="full_name">Nombre Completo *</Label>
            <Input
              id="full_name"
              placeholder="Ej: Carlos Pérez López"
              value={formData.full_name}
              onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              required
            />
          </div>

          {/* Grado */}
          <div>
            <Label htmlFor="grade">Grado *</Label>
            <Select value={formData.grade} onValueChange={(value) => setFormData({ ...formData, grade: value })}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona el grado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Inicial 3 años">Inicial 3 años</SelectItem>
                <SelectItem value="Inicial 4 años">Inicial 4 años</SelectItem>
                <SelectItem value="Inicial 5 años">Inicial 5 años</SelectItem>
                <SelectItem value="1ro Primaria">1ro Primaria</SelectItem>
                <SelectItem value="2do Primaria">2do Primaria</SelectItem>
                <SelectItem value="3ro Primaria">3ro Primaria</SelectItem>
                <SelectItem value="4to Primaria">4to Primaria</SelectItem>
                <SelectItem value="5to Primaria">5to Primaria</SelectItem>
                <SelectItem value="6to Primaria">6to Primaria</SelectItem>
                <SelectItem value="1ro Secundaria">1ro Secundaria</SelectItem>
                <SelectItem value="2do Secundaria">2do Secundaria</SelectItem>
                <SelectItem value="3ro Secundaria">3ro Secundaria</SelectItem>
                <SelectItem value="4to Secundaria">4to Secundaria</SelectItem>
                <SelectItem value="5to Secundaria">5to Secundaria</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Sección */}
          <div>
            <Label htmlFor="section">Sección</Label>
            <Input
              id="section"
              placeholder="Ej: A, B, C"
              maxLength={2}
              value={formData.section}
              onChange={(e) => setFormData({ ...formData, section: e.target.value.toUpperCase() })}
            />
          </div>

          {/* Saldo Inicial */}
          <div>
            <Label htmlFor="balance">Saldo Inicial (S/)</Label>
            <Input
              id="balance"
              type="number"
              step="0.01"
              min="0"
              value={formData.balance}
              onChange={(e) => setFormData({ ...formData, balance: e.target.value })}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Puedes dejarlo en 0 y recargar después
            </p>
          </div>

          {/* Límite Diario */}
          <div>
            <Label htmlFor="daily_limit">Límite de Gasto Diario (S/)</Label>
            <Input
              id="daily_limit"
              type="number"
              step="0.01"
              min="0"
              value={formData.daily_limit}
              onChange={(e) => setFormData({ ...formData, daily_limit: e.target.value })}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Monto máximo que puede gastar por día
            </p>
          </div>

          {/* Botones */}
          <div className="flex gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                'Registrar Estudiante'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}


