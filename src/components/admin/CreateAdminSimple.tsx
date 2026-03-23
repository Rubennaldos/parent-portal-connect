import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

interface CreateAdminSimpleProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function CreateAdminSimple({ onSuccess, onCancel }: CreateAdminSimpleProps) {
  const { toast } = useToast();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [step, setStep] = useState<'form' | 'creating' | 'success' | 'error'>('form');
  const [errorMessage, setErrorMessage] = useState('');

  const resetForm = () => {
    setFullName('');
    setEmail('');
    setPassword('');
    setStep('form');
    setErrorMessage('');
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    // Guard anti-doble clic: si ya está procesando, ignorar
    if (creating) return;

    // Validaciones
    if (!fullName.trim()) {
      toast({ variant: 'destructive', title: 'Error', description: 'Ingresa el nombre completo' });
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      toast({ variant: 'destructive', title: 'Error', description: 'Ingresa un email válido' });
      return;
    }
    if (password.length < 6) {
      toast({ variant: 'destructive', title: 'Error', description: 'La contraseña debe tener al menos 6 caracteres' });
      return;
    }

    setCreating(true);
    setStep('creating');

    try {
      const { data: result, error: rpcError } = await supabase.rpc('create_admin_user', {
        p_email:     email.trim().toLowerCase(),
        p_password:  password,
        p_full_name: fullName.trim(),
        p_role:      'admin_general',
      });

      if (rpcError) {
        throw new Error(rpcError.message);
      }

      if (!result || !result.success) {
        const errMsg: string = result?.error || 'Error desconocido al crear el usuario';

        // Caso especial: el email ya existe (quizás el usuario fue creado
        // en un intento anterior pero la respuesta llegó con error).
        // En este caso NO es un error real — decirle al admin que verifique.
        const isDuplicateEmail =
          errMsg.toLowerCase().includes('already registered') ||
          errMsg.toLowerCase().includes('ya está registrado') ||
          errMsg.toLowerCase().includes('duplicate key') ||
          errMsg.toLowerCase().includes('unique constraint');

        if (isDuplicateEmail) {
          setStep('error');
          setErrorMessage(
            'El correo ya está registrado en el sistema. ' +
            'Es posible que el usuario haya sido creado correctamente en un intento anterior. ' +
            'Recarga la página y verifica la lista antes de intentar de nuevo.'
          );
          return;
        }

        throw new Error(errMsg);
      }

      // Éxito
      setStep('success');
      toast({
        title: '✅ Admin Creado',
        description: `${fullName} (${email}) ha sido creado como Admin General`,
        duration: 4000,
      });

      setTimeout(() => {
        resetForm();
        onSuccess();
      }, 2000);

    } catch (error: any) {
      setStep('error');
      setErrorMessage(error.message || 'Error desconocido al crear el usuario');
      toast({
        variant: 'destructive',
        title: 'Error al crear el usuario',
        description: error.message || 'No se pudo crear el usuario',
        duration: 5000,
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Estado: Formulario */}
      {step === 'form' && (
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Nombre Completo *</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Ej: Fiorella García"
              disabled={creating}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email *</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Ej: fiorella@limacafe28.com"
              disabled={creating}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Contraseña *</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres"
              disabled={creating}
              required
              minLength={6}
            />
            <p className="text-xs text-muted-foreground">
              El usuario podrá cambiar su contraseña después.
            </p>
          </div>

          <Alert>
            <AlertDescription className="text-sm">
              <strong>Importante:</strong> Este usuario tendrá acceso completo a todos los módulos del ERP como Admin General.
            </AlertDescription>
          </Alert>

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={creating}
              className="flex-1"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={creating}
              className="flex-1"
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creando...
                </>
              ) : (
                'Crear Admin'
              )}
            </Button>
          </div>
        </form>
      )}

      {/* Estado: Creando */}
      {step === 'creating' && (
        <div className="text-center py-8 space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
          <div>
            <p className="text-lg font-semibold">Creando Admin General...</p>
            <p className="text-sm text-muted-foreground mt-2">
              Esto puede tardar unos segundos
            </p>
          </div>
        </div>
      )}

      {/* Estado: Éxito */}
      {step === 'success' && (
        <div className="text-center py-8 space-y-4">
          <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
          <div>
            <p className="text-xl font-bold text-green-700">¡Usuario Creado!</p>
            <p className="text-sm text-muted-foreground mt-2">
              {fullName} ({email}) ha sido creado correctamente
            </p>
          </div>
        </div>
      )}

      {/* Estado: Error */}
      {step === 'error' && (
        <div className="space-y-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>Error:</strong> {errorMessage}
            </AlertDescription>
          </Alert>
          
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onCancel}
              className="flex-1"
            >
              Cerrar
            </Button>
            <Button
              onClick={() => setStep('form')}
              className="flex-1"
            >
              Intentar de Nuevo
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
