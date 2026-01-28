import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { User, Mail, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

interface EditProfileModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ProfileData {
  full_name: string;
  phone_1: string;
  email: string;
}

export const EditProfileModal = ({ open, onOpenChange }: EditProfileModalProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [profileData, setProfileData] = useState<ProfileData>({
    full_name: '',
    phone_1: '',
    email: '',
  });

  useEffect(() => {
    if (open && user) {
      fetchProfileData();
    }
  }, [open, user]);

  const fetchProfileData = async () => {
    if (!user?.id) return;

    setLoadingData(true);
    try {
      console.log('📥 Cargando datos del perfil...');

      // Obtener datos del perfil
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single();

      if (profileError) {
        console.error('❌ Error al cargar perfil:', profileError);
      }

      // El email viene de auth.users, no de profiles
      const email = user.email || '';

      setProfileData({
        full_name: profile?.full_name || '',
        phone_1: '', // Los usuarios admin no tienen phone en profiles, solo en parent_profiles
        email: email,
      });

      console.log('✅ Datos del perfil cargados:', {
        full_name: profile?.full_name,
        email,
      });

    } catch (error) {
      console.error('❌ Error al cargar datos del perfil:', error);
      toast({
        variant: 'destructive',
        title: '❌ Error',
        description: 'No se pudieron cargar los datos del perfil',
      });
    } finally {
      setLoadingData(false);
    }
  };

  const handleSave = async () => {
    if (!user?.id) return;

    // Validaciones
    if (!profileData.full_name.trim()) {
      toast({
        variant: 'destructive',
        title: '⚠️ Campo Requerido',
        description: 'El nombre completo es obligatorio',
      });
      return;
    }

    setLoading(true);

    try {
      console.log('💾 Guardando cambios del perfil...');

      // Actualizar nombre en profiles
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          full_name: profileData.full_name.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (updateError) {
        console.error('❌ Error al actualizar perfil:', updateError);
        throw updateError;
      }

      console.log('✅ Perfil actualizado exitosamente');

      toast({
        title: '✅ Perfil Actualizado',
        description: 'Tus datos han sido guardados exitosamente',
      });

      onOpenChange(false);

    } catch (error: any) {
      console.error('❌ Error al guardar perfil:', error);
      toast({
        variant: 'destructive',
        title: '❌ Error',
        description: error.message || 'No se pudieron guardar los cambios',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <User className="h-6 w-6 text-[#8B4513]" />
            Editar Datos Personales
          </DialogTitle>
          <DialogDescription>
            Actualiza tu información personal
          </DialogDescription>
        </DialogHeader>

        {loadingData ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-[#8B4513]" />
          </div>
        ) : (
          <div className="space-y-4 py-4">
            {/* Nombre Completo */}
            <div className="space-y-2">
              <Label htmlFor="fullName">
                Nombre Completo <span className="text-red-500">*</span>
              </Label>
              <Input
                id="fullName"
                type="text"
                value={profileData.full_name}
                onChange={(e) => setProfileData({ ...profileData, full_name: e.target.value })}
                placeholder="Tu nombre completo"
                disabled={loading}
              />
            </div>

            {/* Email (Solo lectura) */}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Input
                  id="email"
                  type="email"
                  value={profileData.email}
                  disabled
                  className="bg-gray-100 cursor-not-allowed"
                />
                <Mail className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              </div>
              <p className="text-xs text-gray-500">
                El email no se puede modificar. Es tu identificador único en el sistema.
              </p>
            </div>

            {/* Información */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="flex gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-amber-800">
                  <strong>Importante:</strong> Si necesitas cambiar información adicional como
                  sede asignada o permisos, contacta al administrador del sistema.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Botones */}
        {!loadingData && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="flex-1"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={loading || !profileData.full_name.trim()}
              className="flex-1 bg-[#8B4513] hover:bg-[#A0522D]"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Guardar Cambios
                </>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
