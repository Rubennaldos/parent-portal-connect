import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

interface TempPasswordFormProps {
  onDone: () => Promise<void>;
}

export function TempPasswordForm({ onDone }: TempPasswordFormProps) {
  const { toast } = useToast();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);

  const valid = newPassword.length >= 8 && newPassword === confirmPassword;

  const handleSubmit = async () => {
    if (!valid || loading || passwordChanged) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      // Marcar que la contraseña se cambió exitosamente — esto evita doble submit
      setPasswordChanged(true);
      // clearTempPasswordFlag cierra el diálogo (actualización optimista)
      await onDone();
      toast({ title: '✅ Contraseña actualizada', description: 'Ya puedes usar el sistema normalmente.' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      // Mensajes amigables para errores comunes de Supabase
      let friendly = msg;
      if (msg.includes('New password should be different')) {
        friendly = 'La nueva contraseña no puede ser igual a la anterior. Elige una diferente.';
      } else if (msg.includes('Password should be at least')) {
        friendly = 'La contraseña debe tener al menos 8 caracteres.';
      } else if (msg.includes('network') || msg.includes('fetch')) {
        friendly = 'Sin conexión. Revisa tu internet e intenta de nuevo.';
      }
      toast({ variant: 'destructive', title: 'No se pudo cambiar la contraseña', description: friendly });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 py-2">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 flex gap-2">
        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
        <span>Esta pantalla no se puede cerrar hasta que crees tu nueva contraseña.</span>
      </div>

      <div className="space-y-2">
        <Label>Nueva contraseña <span className="text-red-500">*</span></Label>
        <div className="relative">
          <Input
            type={showNew ? 'text' : 'password'}
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            placeholder="Mínimo 8 caracteres"
            className="pr-10"
          />
          <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
            {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {newPassword.length > 0 && newPassword.length < 8 && (
          <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> Mínimo 8 caracteres</p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Confirmar contraseña <span className="text-red-500">*</span></Label>
        <div className="relative">
          <Input
            type={showConfirm ? 'text' : 'password'}
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            placeholder="Repite tu nueva contraseña"
            className="pr-10"
          />
          <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
            {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {confirmPassword.length > 0 && newPassword !== confirmPassword && (
          <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> Las contraseñas no coinciden</p>
        )}
        {valid && (
          <p className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Listo</p>
        )}
      </div>

      <Button onClick={handleSubmit} disabled={!valid || loading || passwordChanged} className="w-full bg-amber-600 hover:bg-amber-700">
        {loading
          ? <span className="flex items-center gap-2"><span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" /> Guardando...</span>
          : passwordChanged
            ? <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> Guardado — cerrando...</span>
            : 'Guardar nueva contraseña'}
      </Button>
    </div>
  );
}
