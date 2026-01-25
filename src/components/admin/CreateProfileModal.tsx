import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  FormDescription,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowRight, ArrowLeft, Check, Users, Building2, FileText } from 'lucide-react';

interface School {
  id: string;
  name: string;
  code: string;
}

interface CreateProfileModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

// Esquema base para todos los roles (sin validación de confirmación aún)
const baseSchemaFields = {
  email: z.string().email('Email inválido'),
  full_name: z.string().min(3, 'El nombre debe tener al menos 3 caracteres'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
  confirmPassword: z.string().min(6, 'Debe confirmar la contraseña'),
};

// Esquema base simple
const baseSchema = z.object(baseSchemaFields).refine(
  (data) => data.password === data.confirmPassword,
  {
    message: "Las contraseñas no coinciden",
    path: ["confirmPassword"],
  }
);

// Esquemas específicos por rol
const supervisorRedSchema = z.object(baseSchemaFields).refine(
  (data) => data.password === data.confirmPassword,
  {
    message: "Las contraseñas no coinciden",
    path: ["confirmPassword"],
  }
);

const gestorUnidadSchema = z.object({
  ...baseSchemaFields,
  school_id: z.string().uuid('Debe seleccionar una sede'),
}).refine(
  (data) => data.password === data.confirmPassword,
  {
    message: "Las contraseñas no coinciden",
    path: ["confirmPassword"],
  }
);

const operadorCajaSchema = z.object({
  ...baseSchemaFields,
  school_id: z.string().uuid('Debe seleccionar una sede'),
  pos_number: z.number().min(1, 'Número de caja inválido'),
  ticket_prefix: z.string().min(1, 'El prefijo es requerido').max(5, 'Máximo 5 caracteres'),
}).refine(
  (data) => data.password === data.confirmPassword,
  {
    message: "Las contraseñas no coinciden",
    path: ["confirmPassword"],
  }
);

const operadorCocinaSchema = z.object({
  ...baseSchemaFields,
  school_id: z.string().uuid('Debe seleccionar una sede'),
}).refine(
  (data) => data.password === data.confirmPassword,
  {
    message: "Las contraseñas no coinciden",
    path: ["confirmPassword"],
  }
);

const parentSchema = z.object({
  ...baseSchemaFields,
  school_id: z.string().uuid('Debe seleccionar una sede'),
  dni: z.string().min(8, 'DNI inválido').max(12, 'DNI inválido'),
  phone_1: z.string().min(9, 'Teléfono inválido'),
  address: z.string().min(5, 'Dirección inválida'),
  nickname: z.string().optional(),
}).refine(
  (data) => data.password === data.confirmPassword,
  {
    message: "Las contraseñas no coinciden",
    path: ["confirmPassword"],
  }
);

const ROLES = [
  { value: 'supervisor_red', label: 'Supervisor de Red', icon: '🌐', needsSchool: false, description: 'Puede ver todas las sedes' },
  { value: 'gestor_unidad', label: 'Gestor de Unidad', icon: '🏢', needsSchool: true, description: 'Administra una sede específica' },
  { value: 'operador_caja', label: 'Operador de Caja', icon: '💰', needsSchool: true, description: 'Cajero de una sede' },
  { value: 'operador_cocina', label: 'Operador de Cocina', icon: '👨‍🍳', needsSchool: true, description: 'Gestiona el comedor de una sede' },
  { value: 'parent', label: 'Padre de Familia', icon: '👨‍👩‍👧‍👦', needsSchool: true, description: 'Usuario padre/madre' },
];

export const CreateProfileModal = ({ open, onOpenChange, onSuccess }: CreateProfileModalProps) => {
  const [step, setStep] = useState(1);
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [selectedSchool, setSelectedSchool] = useState<string>('');
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(false);
  const [nextPosNumber, setNextPosNumber] = useState(1);
  const [suggestedPrefix, setSuggestedPrefix] = useState('');
  const { toast } = useToast();

  // Determinar el schema según el rol seleccionado
  const getSchemaForRole = () => {
    switch (selectedRole) {
      case 'supervisor_red':
        return supervisorRedSchema;
      case 'gestor_unidad':
        return gestorUnidadSchema;
      case 'operador_caja':
        return operadorCajaSchema;
      case 'operador_cocina':
        return operadorCocinaSchema;
      case 'parent':
        return parentSchema;
      default:
        return baseSchema;
    }
  };

  const form = useForm({
    resolver: zodResolver(getSchemaForRole()),
    defaultValues: {
      email: '',
      full_name: '',
      password: '',
      confirmPassword: '',
      school_id: '',
      pos_number: 1,
      ticket_prefix: '',
      dni: '',
      phone_1: '',
      address: '',
      nickname: '',
    },
  });

  // Cargar escuelas
  useEffect(() => {
    fetchSchools();
  }, []);

  // Calcular siguiente número de caja cuando se selecciona una sede (solo para cajeros)
  useEffect(() => {
    if (selectedRole === 'operador_caja' && selectedSchool) {
      calculateNextPosNumber(selectedSchool);
    }
  }, [selectedRole, selectedSchool]);

  const fetchSchools = async () => {
    try {
      const { data, error } = await supabase
        .from('schools')
        .select('*')
        .order('name');

      if (error) throw error;
      setSchools(data || []);
    } catch (error) {
      console.error('Error fetching schools:', error);
    }
  };

  const calculateNextPosNumber = async (schoolId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('pos_number')
        .eq('school_id', schoolId)
        .eq('role', 'operador_caja')
        .order('pos_number', { ascending: false })
        .limit(1);

      if (error) throw error;

      const nextNum = data && data.length > 0 ? (data[0].pos_number || 0) + 1 : 1;
      setNextPosNumber(nextNum);
      form.setValue('pos_number', nextNum);

      // Generar prefijo sugerido basado en el código de la escuela
      const school = schools.find(s => s.id === schoolId);
      if (school) {
        const prefix = school.code.substring(0, 3).toUpperCase() + nextNum;
        setSuggestedPrefix(prefix);
        form.setValue('ticket_prefix', prefix);
      }
    } catch (error) {
      console.error('Error calculating next POS number:', error);
    }
  };

  const resetModal = () => {
    setStep(1);
    setSelectedRole('');
    setSelectedSchool('');
    form.reset();
  };

  const handleRoleSelect = (role: string) => {
    setSelectedRole(role);
    const roleConfig = ROLES.find(r => r.value === role);
    
    if (roleConfig?.needsSchool) {
      setStep(2); // Ir a selección de sede
    } else {
      setStep(3); // Ir directo al formulario
    }
  };

  const handleSchoolSelect = (schoolId: string) => {
    setSelectedSchool(schoolId);
    form.setValue('school_id', schoolId);
    setStep(3);
  };

  const onSubmit = async (values: any) => {
    setLoading(true);
    try {
      // 1. Crear usuario en Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: values.email,
        password: values.password,
        options: {
          data: {
            full_name: values.full_name,
            role: selectedRole, // 🔥 Enviar el rol para que el trigger lo respete
          },
        },
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error('No se pudo crear el usuario');

      // 2. Actualizar perfil en la tabla profiles (el trigger ya lo creó)
      // Esperar un poco para que el trigger termine de ejecutarse
      await new Promise(resolve => setTimeout(resolve, 500));

      const profileData: any = {
        role: selectedRole,
        school_id: selectedRole !== 'supervisor_red' ? selectedSchool : null,
      };

      // Agregar datos específicos según el rol
      if (selectedRole === 'operador_caja') {
        profileData.pos_number = values.pos_number;
        profileData.ticket_prefix = values.ticket_prefix;
      }

      const { error: profileError } = await supabase
        .from('profiles')
        .update(profileData)
        .eq('id', authData.user.id);

      if (profileError) {
        console.error('Error actualizando perfil:', profileError);
        throw profileError;
      }

      // 3. Si es padre, crear también el parent_profile
      if (selectedRole === 'parent') {
        const { error: parentError } = await supabase
          .from('parent_profiles')
          .insert({
            user_id: authData.user.id,
            school_id: selectedSchool,
            dni: values.dni,
            phone_1: values.phone_1,
            address: values.address,
            nickname: values.nickname || null,
            full_name: values.full_name,
          });

        if (parentError) throw parentError;
      }

      toast({
        title: '✅ Perfil creado exitosamente',
        description: `El usuario ${values.full_name} ha sido registrado como ${ROLES.find(r => r.value === selectedRole)?.label}`,
      });

      resetModal();
      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      console.error('Error creating profile:', error);
      toast({
        variant: 'destructive',
        title: 'Error al crear perfil',
        description: error.message || 'Ocurrió un error inesperado',
      });
    } finally {
      setLoading(false);
    }
  };

  const roleConfig = ROLES.find(r => r.value === selectedRole);
  const selectedSchoolData = schools.find(s => s.id === selectedSchool);

  return (
    <Dialog open={open} onOpenChange={(open) => {
      if (!open) resetModal();
      onOpenChange(open);
    }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Users className="h-6 w-6 text-blue-600" />
            Crear Nuevo Perfil
          </DialogTitle>
          <DialogDescription>
            {step === 1 && 'Selecciona el rol que tendrá este usuario'}
            {step === 2 && 'Selecciona la sede a la que pertenecerá'}
            {step === 3 && 'Completa los datos del usuario'}
          </DialogDescription>
        </DialogHeader>

        {/* Indicador de pasos */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className={`flex items-center justify-center w-8 h-8 rounded-full ${step >= 1 ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>
            {step > 1 ? <Check className="h-4 w-4" /> : '1'}
          </div>
          <div className={`h-1 w-12 ${step >= 2 ? 'bg-blue-600' : 'bg-gray-200'}`} />
          <div className={`flex items-center justify-center w-8 h-8 rounded-full ${step >= 2 ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>
            {step > 2 ? <Check className="h-4 w-4" /> : '2'}
          </div>
          <div className={`h-1 w-12 ${step >= 3 ? 'bg-blue-600' : 'bg-gray-200'}`} />
          <div className={`flex items-center justify-center w-8 h-8 rounded-full ${step >= 3 ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>
            {step > 3 ? <Check className="h-4 w-4" /> : '3'}
          </div>
        </div>

        {/* PASO 1: Seleccionar Rol */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {ROLES.map((role) => (
                <button
                  key={role.value}
                  onClick={() => handleRoleSelect(role.value)}
                  className="p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-all text-left"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-3xl">{role.icon}</span>
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900">{role.label}</h3>
                      <p className="text-sm text-gray-600 mt-1">{role.description}</p>
                      {role.needsSchool && (
                        <Badge variant="outline" className="mt-2">
                          Requiere Sede
                        </Badge>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* PASO 2: Seleccionar Sede */}
        {step === 2 && roleConfig?.needsSchool && (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
              <Building2 className="h-5 w-5 text-blue-600 mt-0.5" />
              <div>
                <p className="font-medium text-blue-900">Seleccionando sede para: {roleConfig.label}</p>
                <p className="text-sm text-blue-700 mt-1">Este usuario solo podrá ver información de la sede seleccionada</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-96 overflow-y-auto">
              {schools.map((school) => (
                <button
                  key={school.id}
                  onClick={() => handleSchoolSelect(school.id)}
                  className="p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-all text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0 w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                      <Building2 className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{school.name}</h3>
                      <p className="text-sm text-gray-600">Código: {school.code}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <div className="flex justify-start">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(1)}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Volver
              </Button>
            </div>
          </div>
        )}

        {/* PASO 3: Formulario de datos */}
        {step === 3 && (
          <div className="space-y-6">
            {/* Resumen de selección */}
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center gap-3 mb-3">
                <FileText className="h-5 w-5 text-blue-600" />
                <h3 className="font-semibold text-gray-900">Resumen de selección</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="default" className="text-sm">
                  {roleConfig?.icon} {roleConfig?.label}
                </Badge>
                {selectedSchoolData && (
                  <Badge variant="outline" className="text-sm">
                    🏫 {selectedSchoolData.name}
                  </Badge>
                )}
              </div>
            </div>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                {/* Campos comunes */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="full_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nombre Completo *</FormLabel>
                        <FormControl>
                          <Input placeholder="Juan Pérez García" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email *</FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="usuario@ejemplo.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contraseña *</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Mínimo 6 caracteres" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirmar Contraseña *</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Repite la contraseña" {...field} />
                      </FormControl>
                      <FormDescription>
                        El usuario podrá cambiarla después
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Campos específicos para Operador de Caja */}
                {selectedRole === 'operador_caja' && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="pos_number"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Número de Caja *</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                {...field}
                                onChange={(e) => field.onChange(parseInt(e.target.value))}
                              />
                            </FormControl>
                            <FormDescription>
                              Próximo disponible: {nextPosNumber}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="ticket_prefix"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Prefijo de Ticket *</FormLabel>
                            <FormControl>
                              <Input placeholder="Ej: NOR1" maxLength={5} {...field} />
                            </FormControl>
                            <FormDescription>
                              Sugerido: {suggestedPrefix}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </>
                )}

                {/* Campos específicos para Padre */}
                {selectedRole === 'parent' && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="dni"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>DNI *</FormLabel>
                            <FormControl>
                              <Input placeholder="12345678" maxLength={12} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="phone_1"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Teléfono *</FormLabel>
                            <FormControl>
                              <Input placeholder="987654321" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Dirección *</FormLabel>
                          <FormControl>
                            <Input placeholder="Av. Principal 123" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="nickname"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Sobrenombre (Opcional)</FormLabel>
                          <FormControl>
                            <Input placeholder="Ej: Papá de Carlitos" {...field} />
                          </FormControl>
                          <FormDescription>
                            Ayuda a identificar al padre más fácilmente
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}

                {/* Botones de acción */}
                <div className="flex justify-between pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (roleConfig?.needsSchool) {
                        setStep(2);
                      } else {
                        setStep(1);
                      }
                    }}
                  >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Volver
                  </Button>

                  <Button type="submit" disabled={loading}>
                    {loading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Creando...
                      </>
                    ) : (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        Crear Perfil
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

