import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Shield, Camera, Lock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

interface PhotoConsentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccept: () => void;
  studentName: string;
  parentId: string;
}

export const PhotoConsentModal = ({ 
  open, 
  onOpenChange, 
  onAccept, 
  studentName,
  parentId 
}: PhotoConsentModalProps) => {
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleAcceptConsent = async () => {
    if (!consentAccepted) {
      toast({
        variant: 'destructive',
        title: 'Consentimiento requerido',
        description: 'Debes marcar la casilla para continuar',
      });
      return;
    }

    try {
      setLoading(true);

      // Guardar consentimiento en parent_profiles
      const { error } = await supabase
        .from('parent_profiles')
        .upsert({
          user_id: parentId,
          photo_consent: true,
          photo_consent_date: new Date().toISOString(),
        }, {
          onConflict: 'user_id'
        });

      if (error) throw error;

      toast({
        title: '✅ Consentimiento Guardado',
        description: 'Ahora puedes gestionar las fotos de tus hijos',
      });

      onAccept();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error saving consent:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo guardar el consentimiento',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-3 bg-[#8B4513]/10 rounded-full">
              <Camera className="h-8 w-8 text-[#8B4513]" />
            </div>
            <div>
              <DialogTitle className="text-2xl">Autorización de Fotografía</DialogTitle>
              <DialogDescription className="text-base mt-1">
                Para {studentName}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="bg-[#FFF8E7] border-2 border-[#D2691E] rounded-lg p-3">
            <h4 className="font-bold text-[#8B4513] text-sm mb-2 flex items-center gap-2">
              <Shield className="h-4 w-4" />
              ¿Para qué se usa la fotografía?
            </h4>
            <p className="text-xs text-gray-700">
              La fotografía de tu hijo/a se utiliza <strong>exclusivamente</strong> para:
            </p>
            <ul className="text-xs text-gray-700 mt-2 space-y-0.5 list-disc list-inside ml-2">
              <li><strong>Identificación visual</strong> en el punto de venta (POS)</li>
              <li><strong>Reconocimiento rápido</strong> del estudiante por el personal del kiosco</li>
              <li><strong>Seguridad</strong> en la entrega del servicio</li>
              <li><strong>Mejor experiencia</strong> para tu hijo/a</li>
            </ul>
          </div>

          <div className="bg-green-50 border-2 border-green-200 rounded-lg p-3">
            <h4 className="font-bold text-green-900 text-sm mb-2 flex items-center gap-2">
              <Lock className="h-4 w-4" />
              Protección de Datos Personales
            </h4>
            <div className="text-xs text-green-800 space-y-0.5">
              <p>✓ Las fotos <strong>NO se comparten</strong> con terceros</p>
              <p>✓ Solo el <strong>personal autorizado</strong> puede verlas</p>
              <p>✓ Puedes <strong>cambiar o eliminar</strong> la foto en cualquier momento</p>
              <p>✓ Almacenamiento <strong>seguro y encriptado</strong> en servidores certificados</p>
              <p>✓ Cumplimos con la <strong>Ley de Protección de Datos Personales</strong> del Perú</p>
            </div>
          </div>

          <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-amber-800">
                <strong>Importante:</strong> Esta autorización es <strong>voluntaria</strong>. 
                Si decides no proporcionar la foto, tu hijo/a podrá seguir usando el servicio 
                normalmente siendo identificado por su nombre.
              </div>
            </div>
          </div>

          <div className="border-2 border-[#8B4513] rounded-lg p-3 bg-white">
            <div className="flex items-start gap-3">
              <Checkbox 
                id="consent-check" 
                checked={consentAccepted}
                onCheckedChange={(checked) => setConsentAccepted(checked as boolean)}
                className="mt-1"
              />
              <Label htmlFor="consent-check" className="text-xs leading-relaxed cursor-pointer flex-1">
                <strong className="text-[#8B4513]">Yo, {' '}</strong>
                <span className="text-gray-900">
                  en mi calidad de padre/madre/tutor legal de <strong>{studentName}</strong>, 
                  <strong className="text-[#8B4513]"> AUTORIZO</strong> expresamente a Lima Café 28 
                  el uso de la fotografía de mi hijo/a para los fines de <strong>identificación</strong> descritos. 
                  Entiendo que esta autorización puede ser <strong>revocada</strong> en cualquier momento 
                  eliminando la fotografía desde este portal.
                </span>
              </Label>
            </div>
          </div>
        </div>

        <div className="flex gap-3 pt-3 border-t">
          <Button
            onClick={() => onOpenChange(false)}
            variant="outline"
            className="flex-1 h-11 text-sm"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleAcceptConsent}
            disabled={!consentAccepted || loading}
            className="flex-1 h-11 text-sm font-bold bg-[#8B4513] hover:bg-[#A0522D]"
          >
            {loading ? 'Guardando...' : '✓ Aceptar y Continuar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

