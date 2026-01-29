import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Lock, Eye, EyeOff, AlertCircle, CheckCircle2, Copy, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

interface ResetUserPasswordModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userEmail: string;
  userName?: string;
  onSuccess?: () => void;
}

export const ResetUserPasswordModal = ({ 
  open, 
  onOpenChange, 
  userEmail, 
  userName,
  onSuccess 
}: ResetUserPasswordModalProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordGenerated, setPasswordGenerated] = useState(false);

  const generateRandomPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < 8; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setNewPassword(password);
    setPasswordGenerated(true);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(newPassword);
    toast({
      title: '📋 Copiado',
      description: 'Contraseña copiada al portapapeles',
    });
  };

  const handleResetPassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast({
        variant: 'destructive',
        title: '⚠️ Error',
        description: 'La contraseña debe tener al menos 6 caracteres',
      });
      return;
    }

    setLoading(true);

    try {
      console.log('🔐 Reseteando contraseña para:', userEmail);

      // Obtener el token de sesión actual
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        throw new Error('No hay sesión activa');
      }

      // Llamar a la Edge Function
      const { data, error } = await supabase.functions.invoke('reset-user-password', {
        body: { 
          userEmail: userEmail,
          newPassword: newPassword 
        },
        headers: {
          Authorization: `Bearer ${session.access_token}`
        }
      });

      if (error) {
        console.error('❌ Error en Edge Function:', error);
        throw error;
      }

      console.log('✅ Respuesta de Edge Function:', data);

      if (data.error) {
        throw new Error(data.error);
      }

      // Éxito
      toast({
        title: '✅ Contraseña Reseteada',
        description: `La contraseña de ${userName || userEmail} ha sido actualizada exitosamente.`,
      });

      // Copiar contraseña al portapapeles para compartir
      try {
        await navigator.clipboard.writeText(newPassword);
        toast({
          title: '📋 Contraseña Copiada',
          description: 'Comparte la contraseña temporal con el usuario.',
          duration: 5000,
        });
      } catch (clipError) {
        console.warn('No se pudo copiar al portapapeles:', clipError);
      }

      onSuccess?.();
      handleClose();
      
    } catch (error: any) {
      console.error('❌ Error al resetear contraseña:', error);
      
      // Mensajes de error específicos
      let errorMessage = 'No se pudo resetear la contraseña';
      
      if (error.message?.includes('not found')) {
        errorMessage = 'Usuario no encontrado en el sistema';
      } else if (error.message?.includes('FunctionsRelayError')) {
        errorMessage = 'La Edge Function no está desplegada. Por favor, despliégala en Supabase.';
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      toast({
        variant: 'destructive',
        title: '❌ Error',
        description: errorMessage,
        duration: 7000,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setNewPassword('');
    setPasswordGenerated(false);
    setShowPassword(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <Lock className="h-6 w-6 text-red-600" />
            Resetear Contraseña de Usuario
          </DialogTitle>
          <DialogDescription>
            Genera una nueva contraseña temporal para el usuario
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Información del usuario */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="text-sm text-blue-900">
              <strong>Usuario:</strong> {userName || userEmail}
              <br />
              <strong>Email:</strong> {userEmail}
            </div>
          </div>

          {/* Advertencia de seguridad */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <div className="flex gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-amber-800">
                <strong>Importante:</strong> Esta acción generará una nueva contraseña temporal.
                El usuario deberá cambiarla en su próximo inicio de sesión.
              </div>
            </div>
          </div>

          {/* Generador de contraseña */}
          <div className="space-y-2">
            <Label>Nueva Contraseña Temporal</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    setPasswordGenerated(false);
                  }}
                  placeholder="Mínimo 6 caracteres"
                  disabled={loading}
                  className="pr-20"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                  {newPassword && (
                    <button
                      type="button"
                      onClick={copyToClipboard}
                      className="text-gray-500 hover:text-gray-700"
                      title="Copiar contraseña"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-gray-500 hover:text-gray-700"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={generateRandomPassword}
                disabled={loading}
                className="flex-shrink-0"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            {newPassword && newPassword.length < 6 && (
              <p className="text-xs text-red-500 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                La contraseña debe tener al menos 6 caracteres
              </p>
            )}
            {newPassword && newPassword.length >= 6 && (
              <p className="text-xs text-green-600 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Contraseña válida
              </p>
            )}
          </div>

          {/* Instrucciones */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <h4 className="font-bold text-green-900 text-sm mb-2">Pasos a seguir:</h4>
            <ol className="text-xs text-green-800 space-y-1 list-decimal list-inside">
              <li>Genera o ingresa una contraseña temporal</li>
              <li>Haz clic en "Resetear Contraseña"</li>
              <li>Copia la contraseña (clic en el ícono 📋)</li>
              <li>Comparte la contraseña de forma segura con el usuario</li>
              <li>Indica al usuario que debe cambiarla al iniciar sesión</li>
            </ol>
          </div>

          {/* Información técnica */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="flex gap-2">
              <CheckCircle2 className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-blue-800">
                <strong>Sistema Automático:</strong> Al hacer clic en "Resetear Contraseña", 
                el sistema actualizará la contraseña del usuario inmediatamente usando una 
                Edge Function segura. La contraseña se copiará al portapapeles para que puedas compartirla.
              </div>
            </div>
          </div>
        </div>

        {/* Botones */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={loading}
            className="flex-1"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleResetPassword}
            disabled={loading || !newPassword || newPassword.length < 6}
            className="flex-1 bg-red-600 hover:bg-red-700"
          >
            {loading ? (
              <>
                <Lock className="mr-2 h-4 w-4 animate-spin" />
                Procesando...
              </>
            ) : (
              <>
                <Lock className="mr-2 h-4 w-4" />
                Resetear Contraseña
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
