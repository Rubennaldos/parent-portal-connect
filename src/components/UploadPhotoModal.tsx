import { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Camera, Upload, Loader2, X, AlertTriangle, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

interface UploadPhotoModalProps {
  isOpen: boolean;
  onClose: () => void;
  studentId: string;
  studentName: string;
  onSuccess: () => void;
  skipConsent?: boolean; // Nuevo prop para saltar el consentimiento
}

export const UploadPhotoModal = ({ 
  isOpen, 
  onClose, 
  studentId, 
  studentName,
  onSuccess,
  skipConsent = true // Por defecto, saltar el consentimiento (ya se validó antes)
}: UploadPhotoModalProps) => {
  const { toast } = useToast();
  const [step, setStep] = useState<'consent' | 'upload'>(skipConsent ? 'upload' : 'consent');
  const [consentAccepted, setConsentAccepted] = useState(skipConsent);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Resetear al paso correcto cuando se abre el modal
  useEffect(() => {
    if (isOpen) {
      setStep(skipConsent ? 'upload' : 'consent');
      setConsentAccepted(skipConsent);
      setPreview(null);
      setSelectedFile(null);
    }
  }, [isOpen, skipConsent]);

  const handleConsentAccept = () => {
    if (!consentAccepted) {
      toast({
        variant: 'destructive',
        title: 'Debes aceptar el consentimiento',
        description: 'Es necesario que autorices el uso de la foto para continuar',
      });
      return;
    }
    setStep('upload');
  };

  const compressImage = async (file: File): Promise<Blob> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 400;
          const MAX_HEIGHT = 400;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);

          canvas.toBlob((blob) => {
            resolve(blob!);
          }, 'image/jpeg', 0.8);
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Por favor selecciona una imagen válida',
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'La imagen es muy grande. Máximo 5MB',
      });
      return;
    }

    setSelectedFile(file);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    try {
      const compressedBlob = await compressImage(selectedFile);
      
      const fileExt = selectedFile.name.split('.').pop();
      const fileName = `${studentId}_${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('student-photos')
        .upload(filePath, compressedBlob, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('student-photos')
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from('students')
        .update({ photo_url: publicUrl })
        .eq('id', studentId);

      if (updateError) throw updateError;

      toast({
        title: '✅ Foto guardada',
        description: 'La foto se ha actualizado correctamente',
      });

      onSuccess();
      handleClose();
    } catch (error: any) {
      console.error('Error uploading photo:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo subir la foto: ' + error.message,
      });
    } finally {
      setUploading(false);
    }
  };

  const handleClose = () => {
    setStep('consent');
    setConsentAccepted(false);
    setPreview(null);
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl flex items-center gap-2">
            <Camera className="h-6 w-6 text-[#8B4513]" />
            {step === 'consent' ? 'Consentimiento de Uso de Fotografía' : `Subir Foto de ${studentName}`}
          </DialogTitle>
        </DialogHeader>

        {step === 'consent' ? (
          <div className="space-y-4">
            <div className="bg-[#FFF8E7] border-2 border-[#D2691E] rounded-lg p-4">
              <h4 className="font-bold text-[#8B4513] mb-2 flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" />
                ¿Para qué se usa la foto de mi hijo/a?
              </h4>
              <p className="text-sm text-gray-700 mb-2">
                La fotografía se utiliza <strong>exclusivamente</strong> para:
              </p>
              <ul className="text-sm text-gray-700 space-y-1 list-disc list-inside ml-2">
                <li>Identificación visual del estudiante en el punto de venta (POS)</li>
                <li>Facilitar el reconocimiento por parte del personal del kiosco</li>
                <li>Mejorar la seguridad y rapidez del servicio</li>
                <li>Evitar confusiones entre estudiantes con nombres similares</li>
              </ul>
            </div>

            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <h4 className="font-bold text-green-900 mb-2">🔒 Protección de Datos</h4>
              <div className="text-sm text-green-800 space-y-1">
                <p>✓ Las fotos <strong>NO</strong> se comparten con terceros</p>
                <p>✓ Solo el personal autorizado puede verlas</p>
                <p>✓ Puedes eliminar o cambiar la foto en cualquier momento</p>
                <p>✓ Los datos se almacenan de forma segura y encriptada</p>
                <p>✓ Cumplimos con la Ley de Protección de Datos Personales (Ley N° 29733)</p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-6 w-6 text-amber-600 flex-shrink-0 mt-1" />
                <div className="text-sm text-amber-800">
                  <p className="font-bold mb-1">Importante:</p>
                  <p>
                    Al autorizar, confirmas que eres el padre, madre o tutor legal del estudiante y que 
                    consientes el uso de su imagen en los términos descritos. Puedes revocar este 
                    consentimiento en cualquier momento eliminando la foto desde tu portal.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg border-2 border-[#8B4513]">
              <Switch 
                id="consent" 
                checked={consentAccepted}
                onCheckedChange={setConsentAccepted}
                className="mt-1"
              />
              <Label htmlFor="consent" className="text-sm leading-relaxed cursor-pointer flex-1">
                <strong className="text-[#8B4513]">AUTORIZO</strong> el uso de la fotografía de mi hijo/a{' '}
                <strong>({studentName})</strong> para fines de <strong>identificación</strong> en el 
                servicio de kiosco escolar de Lima Café 28, bajo los términos descritos. Entiendo que 
                puedo revocar este consentimiento en cualquier momento.
              </Label>
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                onClick={handleClose}
                className="flex-1"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleConsentAccept}
                disabled={!consentAccepted}
                className="flex-1 bg-[#8B4513] hover:bg-[#A0522D]"
              >
                Aceptar y Continuar
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-center">
              {preview ? (
                <div className="relative">
                  <img
                    src={preview}
                    alt="Preview"
                    className="w-48 h-48 object-cover rounded-full border-4 border-[#8B4513]"
                  />
                  <Button
                    size="icon"
                    variant="destructive"
                    className="absolute top-0 right-0"
                    onClick={() => {
                      setPreview(null);
                      setSelectedFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="w-48 h-48 bg-gradient-to-br from-[#8B4513] to-[#D2691E] rounded-full flex items-center justify-center">
                  <Camera className="h-24 w-24 text-white opacity-50" />
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="photo-upload" className="block mb-2">
                Selecciona una foto clara del rostro (máx. 5MB)
              </Label>
              <input
                ref={fileInputRef}
                id="photo-upload"
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
              />
              <Button
                variant="outline"
                className="w-full border-[#8B4513] text-[#8B4513] hover:bg-[#FFF8E7]"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Upload className="h-4 w-4 mr-2" />
                {selectedFile ? 'Cambiar foto' : 'Elegir foto'}
              </Button>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
              <p className="text-blue-800">
                💡 <strong>Consejo:</strong> Usa una foto reciente con buena iluminación y fondo claro.
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleClose}
                disabled={uploading}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1 bg-[#8B4513] hover:bg-[#A0522D]"
                onClick={handleUpload}
                disabled={!selectedFile || uploading}
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Subiendo...
                  </>
                ) : (
                  <>
                    <Camera className="h-4 w-4 mr-2" />
                    Guardar Foto
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
