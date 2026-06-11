import { Loader2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useTeacherExpressForm } from '../hooks/useTeacherExpressForm';

type CreateTeacherModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  userRole?: string | null;
  userSchoolId?: string | null;
  selectedSchoolFilter?: string;
};

export function CreateTeacherModal({
  open,
  onOpenChange,
  onSuccess,
  userRole,
  userSchoolId,
  selectedSchoolFilter,
}: CreateTeacherModalProps) {
  const {
    form,
    submit,
    submitting,
    resolvedSchoolId,
    isCrossSchoolRole,
    handleDniChange,
    handlePhoneChange,
  } = useTeacherExpressForm({
    isOpen: open,
    onSuccess,
    onClose: () => onOpenChange(false),
    userRole,
    userSchoolId,
    selectedSchoolFilter,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-2 border-emerald-200">
        <DialogHeader className="pb-1">
          <DialogTitle className="flex items-center gap-2 text-emerald-900">
            <UserPlus className="h-5 w-5 text-emerald-600" />
            Registro Rápido de Profesor
          </DialogTitle>
          <DialogDescription className="text-xs text-emerald-700">
            Solo 3 datos obligatorios. La activación de credenciales queda para una fase posterior.
          </DialogDescription>
        </DialogHeader>

        {isCrossSchoolRole && !resolvedSchoolId && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Selecciona una sede en el filtro de la lista antes de registrar.
          </p>
        )}

        <Form {...form}>
          <form onSubmit={submit} className="space-y-4">
            <FormField
              control={form.control}
              name="full_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre completo</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Ej. María López García"
                      className="border-emerald-300 focus-visible:ring-emerald-500"
                      autoComplete="name"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="dni"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>DNI</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      inputMode="numeric"
                      placeholder="8 dígitos"
                      maxLength={8}
                      className="border-emerald-300 focus-visible:ring-emerald-500"
                      onChange={(event) => handleDniChange(event.target.value)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Teléfono</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      inputMode="tel"
                      placeholder="Ej. 999888777"
                      maxLength={11}
                      className="border-emerald-300 focus-visible:ring-emerald-500"
                      onChange={(event) => handlePhoneChange(event.target.value)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={submitting || !resolvedSchoolId}
                className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Registrando...
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4" />
                    Agregar Profesor
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
