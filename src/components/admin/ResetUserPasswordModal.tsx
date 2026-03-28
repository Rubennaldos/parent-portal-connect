import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Lock, Eye, EyeOff, AlertCircle, CheckCircle2, Copy, RefreshCw, MessageSquare } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

interface ResetUserPasswordModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Si el padre tiene un solo correo
  userEmail?: string;
  userName?: string;
  // Si el padre tiene múltiples correos (caso de padres duplicados vinculados)
  emails?: { email: string; label?: string }[];
  onSuccess?: () => void;
}

export const ResetUserPasswordModal = ({
  open,
  onOpenChange,
  userEmail,
  userName,
  emails,
  onSuccess,
}: ResetUserPasswordModalProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [done, setDone] = useState(false);

  // Si hay múltiples correos, el admin elige cuál restablecer
  const emailOptions = emails && emails.length > 0
    ? emails
    : userEmail ? [{ email: userEmail }] : [];
  const [selectedEmail, setSelectedEmail] = useState(emailOptions[0]?.email || '');

  const generateRandomPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    let pwd = '';
    for (let i = 0; i < 8; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
    setNewPassword(pwd);
    return pwd;
  };

  // Auto-generar contraseña y resetear estado al abrir
  useEffect(() => {
    if (open) {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
      let pwd = '';
      for (let i = 0; i < 8; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
      setNewPassword(pwd);
      setDone(false);
      setShowPassword(true);
      setSelectedEmail(emailOptions[0]?.email || '');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const getFriendlyMessage = () => {
    const nombre = userName || 'Padre/Madre de Familia';
    return `Estimado/a ${nombre},\n\nLe informamos que su contraseña ha sido restablecida temporalmente.\n\n📧 Usuario: ${selectedEmail}\n🔑 Contraseña temporal: ${newPassword}\n\nAl ingresar al sistema con esta contraseña, se le pedirá que cree una nueva contraseña de su elección.\n\nSi tiene alguna duda, comuníquese con la administración de su sede.\n\nSaludos,\nEquipo Lima Café 28`;
  };

  const copyPassword = () => {
    navigator.clipboard.writeText(newPassword).catch(() => {});
    toast({ title: 'Contraseña copiada', description: newPassword });
  };

  const copyMessage = () => {
    navigator.clipboard.writeText(getFriendlyMessage()).catch(() => {});
    toast({ title: '✅ Mensaje copiado', description: 'Listo para enviar por WhatsApp o mensaje de texto.' });
  };

  const handleReset = async () => {
    if (!selectedEmail) {
      toast({ variant: 'destructive', title: 'Selecciona un correo' });
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      toast({ variant: 'destructive', title: 'La contraseña debe tener al menos 6 caracteres' });
      return;
    }

    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No hay sesión activa');

      const { data, error } = await supabase.functions.invoke('reset-user-password', {
        body: { userEmail: selectedEmail, newPassword },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Garantía adicional: marcar is_temp_password desde el frontend
      // por si el Edge Function lo omitió (ej. columna no existía antes)
      try {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('id')
          .ilike('email', selectedEmail.trim())
          .single();
        if (profileData?.id) {
          await supabase
            .from('profiles')
            .update({ is_temp_password: true })
            .eq('id', profileData.id);
          console.log('[Reset] ✅ is_temp_password marcado desde frontend para:', selectedEmail);
        }
      } catch (flagErr) {
        // No bloquear el flujo si este paso falla
        console.warn('[Reset] No se pudo marcar is_temp_password desde frontend:', flagErr);
      }

      setDone(true);
      onSuccess?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      let friendly = 'No se pudo restablecer la contraseña';
      if (msg.includes('not found')) friendly = 'Usuario no encontrado en el sistema';
      else if (msg.includes('FunctionsRelayError')) friendly = 'La función de restablecimiento no está disponible. Contacta al soporte técnico.';
      else if (msg) friendly = msg;
      toast({ variant: 'destructive', title: '❌ Error', description: friendly, duration: 7000 });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setNewPassword('');
    setDone(false);
    setShowPassword(false);
    setSelectedEmail(emailOptions[0]?.email || '');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-700">
            <Lock className="h-5 w-5" />
            Restablecer Contraseña
          </DialogTitle>
          <DialogDescription>
            Se generará una contraseña temporal. El padre deberá cambiarla al ingresar.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          /* ── Pantalla de éxito ── */
          <div className="space-y-4 py-2">
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <CheckCircle2 className="h-14 w-14 text-green-500" />
              <div>
                <p className="font-semibold text-green-700 text-lg">¡Contraseña restablecida!</p>
                <p className="text-sm text-gray-500 mt-1">
                  El padre deberá cambiarla la próxima vez que ingrese.
                </p>
              </div>
            </div>

            {/* Credenciales */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm space-y-1">
              <p><span className="text-gray-500">Correo:</span> <strong>{selectedEmail}</strong></p>
              <p className="flex items-center gap-2">
                <span className="text-gray-500">Contraseña:</span>
                <strong className="font-mono bg-yellow-100 px-2 py-0.5 rounded">{newPassword}</strong>
                <button onClick={copyPassword} title="Copiar contraseña" className="text-gray-400 hover:text-gray-600">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </p>
            </div>

            {/* Botón copiar mensaje */}
            <Button
              onClick={copyMessage}
              className="w-full bg-green-600 hover:bg-green-700 gap-2"
            >
              <MessageSquare className="h-4 w-4" />
              Copiar mensaje para el padre
            </Button>

            {/* Vista previa del mensaje */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-800 whitespace-pre-line">
              {getFriendlyMessage()}
            </div>

            <Button variant="outline" onClick={handleClose} className="w-full">
              Cerrar
            </Button>
          </div>
        ) : (
          /* ── Formulario ── */
          <div className="space-y-4 py-2">
            {/* Selector de correo si hay múltiples */}
            {emailOptions.length > 1 ? (
              <div className="space-y-2">
                <Label>¿A cuál correo restablecer?</Label>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-800 mb-1">
                  Este padre tiene {emailOptions.length} correos registrados. Elige a cuál deseas restablecer la contraseña.
                </div>
                <Select value={selectedEmail} onValueChange={setSelectedEmail}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona el correo" />
                  </SelectTrigger>
                  <SelectContent>
                    {emailOptions.map((e, i) => (
                      <SelectItem key={e.email} value={e.email}>
                        {e.email} {e.label ? `(${e.label})` : i === 0 ? '(principal)' : '(secundario)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900">
                <strong>Padre/Madre:</strong> {userName && userName !== selectedEmail ? userName : <em className="text-blue-600">Nombre no registrado</em>}<br />
                <strong>Correo:</strong> {selectedEmail}
              </div>
            )}

            {/* Advertencia */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                Al restablecer, el padre <strong>no podrá entrar con su contraseña actual</strong>.
                La contraseña temporal que generes reemplazará la anterior.
              </p>
            </div>

            {/* Generador de contraseña */}
            <div className="space-y-2">
              <Label>Contraseña temporal <span className="text-red-500">*</span></Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className="pr-16 font-mono"
                    disabled={loading}
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                    {newPassword && (
                      <button type="button" onClick={copyPassword} className="text-gray-400 hover:text-gray-600" title="Copiar">
                        <Copy className="h-4 w-4" />
                      </button>
                    )}
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="text-gray-400 hover:text-gray-600">
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <Button type="button" variant="outline" onClick={generateRandomPassword} disabled={loading} title="Generar contraseña automática">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
              {newPassword.length > 0 && newPassword.length < 6 && (
                <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> Mínimo 6 caracteres</p>
              )}
              {newPassword.length >= 6 && (
                <p className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Lista para usar</p>
              )}
            </div>

            {/* Vista previa del mensaje — SOLO visual, el botón de copiar está DESPUÉS del reset */}
            {newPassword.length >= 6 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Vista previa del mensaje</p>
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-800 whitespace-pre-line">
                  {getFriendlyMessage()}
                </div>
                <p className="text-xs text-amber-700 font-medium flex items-center gap-1">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  Primero haz clic en <strong>"Restablecer"</strong> — luego podrás copiar y enviar este mensaje.
                </p>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button variant="outline" onClick={handleClose} disabled={loading} className="flex-1">
                Cancelar
              </Button>
              <Button
                onClick={handleReset}
                disabled={loading || !newPassword || newPassword.length < 6 || !selectedEmail}
                className="flex-1 bg-red-600 hover:bg-red-700 text-base font-bold"
              >
                {loading
                  ? <span className="flex items-center gap-2"><span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" /> Procesando...</span>
                  : <span className="flex items-center gap-2"><Lock className="h-4 w-4" /> Restablecer contraseña</span>
                }
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
