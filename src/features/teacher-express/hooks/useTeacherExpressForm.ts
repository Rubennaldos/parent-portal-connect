import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useToast } from '@/hooks/use-toast';
import { createTeacherExpress } from '../services/teacherExpressService';
import { TeacherExpressServiceError } from '../types';

const teacherExpressSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(3, 'El nombre debe tener al menos 3 caracteres'),
  dni: z
    .string()
    .regex(/^\d{8}$/, 'El DNI debe tener exactamente 8 dígitos'),
  phone: z
    .string()
    .regex(/^\d{9,11}$/, 'El teléfono debe tener entre 9 y 11 dígitos'),
});

export type TeacherExpressFormValues = z.infer<typeof teacherExpressSchema>;

type UseTeacherExpressFormParams = {
  isOpen: boolean;
  onSuccess?: () => void;
  onClose?: () => void;
  userRole?: string | null;
  userSchoolId?: string | null;
  selectedSchoolFilter?: string;
};

const defaultValues: TeacherExpressFormValues = {
  full_name: '',
  dni: '',
  phone: '',
};

function digitsOnly(value: string, maxLength: number): string {
  return value.replace(/\D/g, '').slice(0, maxLength);
}

export function useTeacherExpressForm({
  isOpen,
  onSuccess,
  onClose,
  userRole,
  userSchoolId,
  selectedSchoolFilter = 'all',
}: UseTeacherExpressFormParams) {
  const { toast } = useToast();
  const isCrossSchoolRole = userRole === 'admin_general' || userRole === 'superadmin';

  const form = useForm<TeacherExpressFormValues>({
    resolver: zodResolver(teacherExpressSchema),
    defaultValues,
    mode: 'onBlur',
  });

  const resolvedSchoolId = useMemo(() => {
    if (!isCrossSchoolRole) {
      return userSchoolId ?? null;
    }
    if (selectedSchoolFilter !== 'all') {
      return selectedSchoolFilter;
    }
    return null;
  }, [isCrossSchoolRole, selectedSchoolFilter, userSchoolId]);

  useEffect(() => {
    if (!isOpen) return;
    form.reset(defaultValues);
  }, [form, isOpen]);

  const handleDniChange = (value: string) => {
    form.setValue('dni', digitsOnly(value, 8), { shouldValidate: true });
  };

  const handlePhoneChange = (value: string) => {
    form.setValue('phone', digitsOnly(value, 11), { shouldValidate: true });
  };

  const submit = form.handleSubmit(async (values) => {
    if (!resolvedSchoolId) {
      toast({
        variant: 'destructive',
        title: 'Sede requerida',
        description: isCrossSchoolRole
          ? 'Selecciona una sede en el filtro antes de registrar un profesor.'
          : 'Tu usuario no tiene sede asignada para registrar profesores.',
      });
      return;
    }

    try {
      await createTeacherExpress({
        full_name: values.full_name,
        dni: values.dni,
        phone: values.phone,
        school_id: resolvedSchoolId,
      });

      toast({
        title: 'Profesor registrado',
        description: `${values.full_name} fue agregado correctamente.`,
      });

      form.reset(defaultValues);
      onClose?.();
      onSuccess?.();
    } catch (error) {
      const message =
        error instanceof TeacherExpressServiceError
          ? error.message
          : 'No se pudo registrar al profesor. Intenta de nuevo.';

      toast({
        variant: 'destructive',
        title: 'Error al registrar',
        description: message,
      });
    }
  });

  return {
    form,
    submit,
    submitting: form.formState.isSubmitting,
    resolvedSchoolId,
    isCrossSchoolRole,
    handleDniChange,
    handlePhoneChange,
  };
}
