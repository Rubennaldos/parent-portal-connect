import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UserCircle, Phone, MapPin, FileText, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';

interface ParentDataFormProps {
  open: boolean;
  userId: string;
  onComplete: () => void;
}

export function ParentDataForm({ open, userId, onComplete }: ParentDataFormProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  
  // Datos del formulario
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [documentType, setDocumentType] = useState('dni');
  const [documentNumber, setDocumentNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  // Captura automática de datos técnicos
  const captureMetadata = () => {
    const metadata = {
      ip_address: 'pending', // Se capturará desde el backend
      user_agent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      screen_resolution: `${window.screen.width}x${window.screen.height}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      registered_at: new Date().toISOString(),
    };
    return metadata;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validaciones
    if (!firstName || !lastName || !documentNumber || !phone || !address) {
      toast({
        variant: 'destructive',
        title: 'Campos incompletos',
        description: 'Por favor completa todos los campos obligatorios.',
      });
      return;
    }

    setIsLoading(true);

    try {
      const fullName = `${firstName.trim()} ${lastName.trim()}`;
      const metadata = captureMetadata();

      // Actualizar parent_profiles con los datos
      const { error: profileError } = await supabase
        .from('parent_profiles')
        .update({
          full_name: fullName,
          document_type: documentType,
          dni: documentNumber,
          phone_1: phone,
          address: address,
          registration_metadata: metadata,
        })
        .eq('user_id', userId);

      if (profileError) throw profileError;

      // También actualizar el full_name en profiles
      const { error: profilesError } = await supabase
        .from('profiles')
        .update({ full_name: fullName })
        .eq('id', userId);

      if (profilesError) throw profilesError;

      toast({
        title: '✅ Datos guardados',
        description: 'Tus datos han sido registrados correctamente.',
      });

      onComplete();
    } catch (err: any) {
      console.error('Error guardando datos del padre:', err);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron guardar los datos. Intenta de nuevo.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center">
              <UserCircle className="h-7 w-7 text-blue-600" />
            </div>
            <div>
              <DialogTitle className="text-2xl font-black text-slate-800">
                Datos del Responsable
              </DialogTitle>
              <DialogDescription className="text-sm text-slate-500 mt-1">
                Ingresa tus datos como padre/madre responsable del pago
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {/* Nombres */}
          <div className="space-y-2">
            <Label className="font-semibold text-sm">Nombres *</Label>
            <Input
              placeholder="Ej: Juan Carlos"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="h-12"
              disabled={isLoading}
            />
          </div>

          {/* Apellidos */}
          <div className="space-y-2">
            <Label className="font-semibold text-sm">Apellidos *</Label>
            <Input
              placeholder="Ej: Pérez García"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="h-12"
              disabled={isLoading}
            />
          </div>

          {/* Tipo de Documento */}
          <div className="space-y-2">
            <Label className="font-semibold text-sm">Tipo de Documento *</Label>
            <Select value={documentType} onValueChange={setDocumentType} disabled={isLoading}>
              <SelectTrigger className="h-12">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dni">DNI</SelectItem>
                <SelectItem value="pasaporte">Pasaporte</SelectItem>
                <SelectItem value="carnet_extranjeria">Carnet de Extranjería</SelectItem>
                <SelectItem value="otro">Otro Documento</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Número de Documento */}
          <div className="space-y-2">
            <Label className="font-semibold text-sm">Número de Documento *</Label>
            <div className="relative">
              <FileText className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
              <Input
                placeholder="Ej: 12345678"
                value={documentNumber}
                onChange={(e) => setDocumentNumber(e.target.value)}
                className="h-12 pl-10"
                disabled={isLoading}
              />
            </div>
          </div>

          {/* Teléfono */}
          <div className="space-y-2">
            <Label className="font-semibold text-sm">Teléfono de Contacto *</Label>
            <div className="relative">
              <Phone className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
              <Input
                placeholder="Ej: 987654321"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="h-12 pl-10"
                disabled={isLoading}
                type="tel"
              />
            </div>
          </div>

          {/* Dirección */}
          <div className="space-y-2">
            <Label className="font-semibold text-sm">Dirección Completa *</Label>
            <div className="relative">
              <MapPin className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
              <Input
                placeholder="Ej: Av. Los Álamos 123, San Isidro, Lima"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="h-12 pl-10"
                disabled={isLoading}
              />
            </div>
          </div>

          <p className="text-xs text-slate-400 bg-slate-50 p-3 rounded-lg border border-slate-200">
            🔒 Tus datos están protegidos y se usarán únicamente para gestión de pagos y comunicación oficial del colegio.
          </p>

          <Button
            type="submit"
            className="w-full h-14 text-base font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-lg rounded-xl"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="animate-spin mr-2" />
                Guardando...
              </>
            ) : (
              'Continuar'
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
