import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, UserCheck, Users, Scale, ShieldCheck } from 'lucide-react';

interface ParentDataFormProps {
  onSuccess: () => void;
  isLoading?: boolean;
  setIsLoading?: (loading: boolean) => void;
}

export function ParentDataForm({ onSuccess, isLoading: externalLoading, setIsLoading: setExternalLoading }: ParentDataFormProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [internalLoading, setInternalLoading] = useState(false);
  
  const isLoading = externalLoading !== undefined ? externalLoading : internalLoading;
  const setIsLoading = setExternalLoading || setInternalLoading;

  // RESPONSABLE PRINCIPAL (quien se registra)
  const [fullName, setFullName] = useState('');
  const [documentType, setDocumentType] = useState('DNI');
  const [dni, setDni] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  // SEGUNDO RESPONSABLE DE PAGO
  const [resp2FullName, setResp2FullName] = useState('');
  const [resp2Email, setResp2Email] = useState('');
  const [resp2DocumentType, setResp2DocumentType] = useState('DNI');
  const [resp2Dni, setResp2Dni] = useState('');
  const [resp2Phone, setResp2Phone] = useState('');
  const [resp2Address, setResp2Address] = useState('');

  // CLÁUSULA LEGAL
  const [legalAcceptance, setLegalAcceptance] = useState(false);

  // Función para capturar metadata del navegador de forma automática y sutil
  const captureMetadata = () => {
    try {
      const metadata = {
        // Información del navegador
        userAgent: navigator.userAgent,
        browser: getBrowserInfo(),
        os: getOSInfo(),
        
        // Información de pantalla
        screenResolution: `${window.screen.width}x${window.screen.height}`,
        viewportSize: `${window.innerWidth}x${window.innerHeight}`,
        colorDepth: window.screen.colorDepth,
        
        // Información de localización
        language: navigator.language,
        languages: navigator.languages,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timezoneOffset: new Date().getTimezoneOffset(),
        
        // Información temporal
        registrationTimestamp: new Date().toISOString(),
        localTime: new Date().toLocaleString('es-PE'),
        
        // Información de dispositivo
        isMobile: /Mobile|Android|iPhone/i.test(navigator.userAgent),
        isTablet: /iPad|Android/i.test(navigator.userAgent) && !/Mobile/i.test(navigator.userAgent),
        
        // Información de conexión (si está disponible)
        ...(navigator.connection && {
          connectionType: (navigator.connection as any).effectiveType,
          downlink: (navigator.connection as any).downlink,
        }),
      };

      console.log('📊 Metadata capturada automáticamente:', metadata);
      return metadata;
    } catch (error) {
      console.error('Error capturando metadata:', error);
      return {};
    }
  };

  const getBrowserInfo = () => {
    const ua = navigator.userAgent;
    if (ua.includes('Chrome')) return 'Chrome';
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Safari')) return 'Safari';
    if (ua.includes('Edge')) return 'Edge';
    if (ua.includes('Opera')) return 'Opera';
    return 'Unknown';
  };

  const getOSInfo = () => {
    const ua = navigator.userAgent;
    if (ua.includes('Windows')) return 'Windows';
    if (ua.includes('Mac')) return 'MacOS';
    if (ua.includes('Linux')) return 'Linux';
    if (ua.includes('Android')) return 'Android';
    if (ua.includes('iOS') || ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
    return 'Unknown';
  };

  const handleNextStep = () => {
    // Validar Paso 1: Datos del responsable principal
    if (step === 1) {
      if (!fullName || !dni || !phone || !address) {
        toast({
          variant: 'destructive',
          title: 'Campos incompletos',
          description: 'Por favor completa todos los campos del responsable principal.',
        });
        return;
      }
      setStep(2);
    }
    // Validar Paso 2: Segundo responsable
    else if (step === 2) {
      if (!resp2FullName || !resp2Dni || !resp2Phone) {
        toast({
          variant: 'destructive',
          title: 'Campos incompletos',
          description: 'Por favor completa los datos del segundo responsable (email y dirección son opcionales).',
        });
        return;
      }
      setStep(3);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!legalAcceptance) {
      toast({
        variant: 'destructive',
        title: 'Aceptación requerida',
        description: 'Debes aceptar la cláusula legal para continuar.',
      });
      return;
    }

    if (!user?.id) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo identificar al usuario.',
      });
      return;
    }

    setIsLoading(true);

    try {
      // Capturar metadata automáticamente
      const metadata = captureMetadata();

      console.log('💾 Guardando datos del padre...');
      
      const { error } = await supabase
        .from('parent_profiles')
        .update({
          // Responsable principal
          full_name: fullName,
          document_type: documentType,
          dni: dni,
          phone_1: phone,
          address: address,
          
          // Segundo responsable
          responsible_2_full_name: resp2FullName,
          responsible_2_email: resp2Email || null,
          responsible_2_document_type: resp2DocumentType,
          responsible_2_dni: resp2Dni,
          responsible_2_phone_1: resp2Phone,
          responsible_2_address: resp2Address || null,
          
          // Cláusula legal
          legal_acceptance: legalAcceptance,
          legal_acceptance_timestamp: new Date().toISOString(),
          
          // Metadata capturada automáticamente
          registration_metadata: metadata,
          
          // Timestamp de actualización
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id);

      if (error) {
        console.error('❌ Error guardando datos:', error);
        throw error;
      }

      console.log('✅ Datos guardados exitosamente');

      toast({
        title: '✅ Datos guardados',
        description: 'Tus datos han sido registrados correctamente.',
      });

      onSuccess();
    } catch (error: any) {
      console.error('Error en handleSubmit:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudieron guardar los datos.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto shadow-xl border border-stone-200/50 bg-white">
      <CardHeader className="text-center space-y-3 pb-6 pt-8">
        <div className="flex justify-center mb-2">
          <div className="bg-gradient-to-br from-[#8B7355]/10 to-[#6B5744]/10 p-4 rounded-2xl">
            {step === 1 && <UserCheck className="h-8 w-8 text-[#8B7355]" />}
            {step === 2 && <Users className="h-8 w-8 text-[#8B7355]" />}
            {step === 3 && <Scale className="h-8 w-8 text-[#8B7355]" />}
          </div>
        </div>
        <CardTitle className="text-2xl font-light text-stone-800 tracking-wide">
          {step === 1 && 'Datos del Responsable Principal'}
          {step === 2 && 'Segundo Responsable de Pago'}
          {step === 3 && 'Aceptación Legal'}
        </CardTitle>
        <CardDescription className="text-stone-500 font-normal text-sm tracking-wide">
          {step === 1 && 'Información de quien crea la cuenta'}
          {step === 2 && 'Datos adicionales del segundo responsable (email y dirección opcionales)'}
          {step === 3 && 'Confirma los términos para continuar'}
        </CardDescription>
        
        {/* Indicador de pasos */}
        <div className="flex justify-center gap-2 pt-4">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`h-2 rounded-full transition-all duration-300 ${
                s === step ? 'w-8 bg-[#8B7355]' : s < step ? 'w-2 bg-[#8B7355]/50' : 'w-2 bg-stone-200'
              }`}
            />
          ))}
        </div>
      </CardHeader>

      <CardContent className="px-8 pb-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* PASO 1: RESPONSABLE PRINCIPAL */}
          {step === 1 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label className="font-medium text-xs text-stone-600 uppercase tracking-wider">
                  Nombres Completos *
                </Label>
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ej: Juan Carlos"
                  className="h-12 border border-stone-200 focus:border-[#8B7355] rounded-xl"
                  disabled={isLoading}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="font-medium text-xs text-stone-600 uppercase tracking-wider">
                    Tipo de Documento *
                  </Label>
                  <Select value={documentType} onValueChange={setDocumentType} disabled={isLoading}>
                    <SelectTrigger className="h-12 border border-stone-200 focus:border-[#8B7355] rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DNI">DNI</SelectItem>
                      <SelectItem value="Pasaporte">Pasaporte</SelectItem>
                      <SelectItem value="Otro">Otro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="font-medium text-xs text-stone-600 uppercase tracking-wider">
                    Número de Documento *
                  </Label>
                  <Input
                    value={dni}
                    onChange={(e) => setDni(e.target.value)}
                    placeholder="Ej: 12345678"
                    className="h-12 border border-stone-200 focus:border-[#8B7355] rounded-xl"
                    disabled={isLoading}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="font-medium text-xs text-stone-600 uppercase tracking-wider">
                  Teléfono *
                </Label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Ej: 987654321"
                  className="h-12 border border-stone-200 focus:border-[#8B7355] rounded-xl"
                  disabled={isLoading}
                />
              </div>

              <div className="space-y-2">
                <Label className="font-medium text-xs text-stone-600 uppercase tracking-wider">
                  Dirección *
                </Label>
                <Input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Ej: Av. Principal 123, Lima"
                  className="h-12 border border-stone-200 focus:border-[#8B7355] rounded-xl"
                  disabled={isLoading}
                />
              </div>

              <Button
                type="button"
                onClick={handleNextStep}
                className="w-full h-14 text-base font-medium bg-gradient-to-r from-[#8B7355] to-[#6B5744] hover:from-[#6B5744] hover:to-[#5B4734] text-white shadow-md rounded-xl tracking-wide"
                disabled={isLoading}
              >
                Continuar
              </Button>
            </div>
          )}

          {/* PASO 2: SEGUNDO RESPONSABLE */}
          {step === 2 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label className="font-medium text-xs text-stone-600 uppercase tracking-wider">
                  Nombres Completos *
                </Label>
                <Input
                  value={resp2FullName}
                  onChange={(e) => setResp2FullName(e.target.value)}
                  placeholder="Ej: María Elena"
                  className="h-12 border border-stone-200 focus:border-[#8B7355] rounded-xl"
                  disabled={isLoading}
                />
              </div>

              <div className="space-y-2">
                <Label className="font-medium text-xs text-stone-600 uppercase tracking-wider flex items-center gap-2">
                  Email <span className="text-stone-400 text-[10px] normal-case">(opcional)</span>
                </Label>
                <Input
                  type="email"
                  value={resp2Email}
                  onChange={(e) => setResp2Email(e.target.value)}
                  placeholder="Ej: maria@email.com"
                  className="h-12 border border-stone-200 focus:border-[#8B7355] rounded-xl"
                  disabled={isLoading}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="font-medium text-xs text-stone-600 uppercase tracking-wider">
                    Tipo de Documento *
                  </Label>
                  <Select value={resp2DocumentType} onValueChange={setResp2DocumentType} disabled={isLoading}>
                    <SelectTrigger className="h-12 border border-stone-200 focus:border-[#8B7355] rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DNI">DNI</SelectItem>
                      <SelectItem value="Pasaporte">Pasaporte</SelectItem>
                      <SelectItem value="Otro">Otro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="font-medium text-xs text-stone-600 uppercase tracking-wider">
                    Número de Documento *
                  </Label>
                  <Input
                    value={resp2Dni}
                    onChange={(e) => setResp2Dni(e.target.value)}
                    placeholder="Ej: 87654321"
                    className="h-12 border border-stone-200 focus:border-[#8B7355] rounded-xl"
                    disabled={isLoading}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="font-medium text-xs text-stone-600 uppercase tracking-wider">
                  Teléfono *
                </Label>
                <Input
                  value={resp2Phone}
                  onChange={(e) => setResp2Phone(e.target.value)}
                  placeholder="Ej: 912345678"
                  className="h-12 border border-stone-200 focus:border-[#8B7355] rounded-xl"
                  disabled={isLoading}
                />
              </div>

              <div className="space-y-2">
                <Label className="font-medium text-xs text-stone-600 uppercase tracking-wider flex items-center gap-2">
                  Dirección <span className="text-stone-400 text-[10px] normal-case">(opcional)</span>
                </Label>
                <Input
                  value={resp2Address}
                  onChange={(e) => setResp2Address(e.target.value)}
                  placeholder="Ej: Av. Secundaria 456, Lima"
                  className="h-12 border border-stone-200 focus:border-[#8B7355] rounded-xl"
                  disabled={isLoading}
                />
              </div>

              <div className="flex gap-3">
                <Button
                  type="button"
                  onClick={() => setStep(1)}
                  variant="outline"
                  className="flex-1 h-12 border border-stone-200 rounded-xl"
                  disabled={isLoading}
                >
                  Atrás
                </Button>
                <Button
                  type="button"
                  onClick={handleNextStep}
                  className="flex-1 h-14 text-base font-medium bg-gradient-to-r from-[#8B7355] to-[#6B5744] hover:from-[#6B5744] hover:to-[#5B4734] text-white shadow-md rounded-xl tracking-wide"
                  disabled={isLoading}
                >
                  Continuar
                </Button>
              </div>
            </div>
          )}

          {/* PASO 3: CLÁUSULA LEGAL */}
          {step === 3 && (
            <div className="space-y-6">
              <div className="bg-stone-50/50 border border-stone-200/50 rounded-2xl p-6 space-y-4">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="h-6 w-6 text-[#8B7355] flex-shrink-0 mt-1" />
                  <div className="space-y-2">
                    <h4 className="font-medium text-sm text-stone-800 tracking-wide">
                      Cláusula Legal - Cobranza Judicial
                    </h4>
                    <p className="text-xs text-stone-600 leading-relaxed">
                      Al aceptar estos términos, reconozco que en caso de incumplimiento de pago de los consumos realizados
                      por mi(s) hijo(s) en el kiosco escolar <span className="font-medium">Lima Café 28</span>, autorizo
                      expresamente a la institución a iniciar las acciones legales de cobranza judicial que correspondan,
                      incluyendo el cobro de intereses moratorios y gastos administrativos.
                    </p>
                    <p className="text-xs text-stone-600 leading-relaxed">
                      Los datos proporcionados serán utilizados exclusivamente para fines de gestión de pagos y comunicación
                      con los responsables de pago, conforme a la Ley de Protección de Datos Personales.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-4 bg-white border border-stone-200 rounded-xl">
                <Checkbox
                  id="legal"
                  checked={legalAcceptance}
                  onCheckedChange={(checked) => setLegalAcceptance(checked as boolean)}
                  className="mt-0.5"
                  disabled={isLoading}
                />
                <label
                  htmlFor="legal"
                  className="text-sm text-stone-700 leading-relaxed cursor-pointer"
                >
                  He leído y acepto la cláusula legal de cobranza judicial en caso de impago, y confirmo que los datos
                  proporcionados son correctos y veraces.
                </label>
              </div>

              <div className="flex gap-3">
                <Button
                  type="button"
                  onClick={() => setStep(2)}
                  variant="outline"
                  className="flex-1 h-12 border border-stone-200 rounded-xl"
                  disabled={isLoading}
                >
                  Atrás
                </Button>
                <Button
                  type="submit"
                  className="flex-1 h-14 text-base font-medium bg-gradient-to-r from-[#8B7355] to-[#6B5744] hover:from-[#6B5744] hover:to-[#5B4734] text-white shadow-md rounded-xl tracking-wide"
                  disabled={isLoading || !legalAcceptance}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="animate-spin mr-2" />
                      Guardando...
                    </>
                  ) : (
                    'Confirmar y Continuar'
                  )}
                </Button>
              </div>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
