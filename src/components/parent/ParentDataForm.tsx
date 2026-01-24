import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, User, MapPin, Phone, FileText, Info, Users, Mail, Scale } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Separator } from '@/components/ui/separator';

interface ParentDataFormProps {
  onSuccess: () => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
}

export function ParentDataForm({ onSuccess, isLoading, setIsLoading }: ParentDataFormProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  // RESPONSABLE 1 (Principal - todos obligatorios)
  const [firstName1, setFirstName1] = useState('');
  const [lastName1, setLastName1] = useState('');
  const [email1, setEmail1] = useState('');
  const [documentType1, setDocumentType1] = useState('DNI');
  const [documentNumber1, setDocumentNumber1] = useState('');
  const [phone1, setPhone1] = useState('');
  const [address1, setAddress1] = useState('');

  // RESPONSABLE 2 (Secundario - dirección opcional)
  const [firstName2, setFirstName2] = useState('');
  const [lastName2, setLastName2] = useState('');
  const [email2, setEmail2] = useState('');
  const [documentType2, setDocumentType2] = useState('DNI');
  const [documentNumber2, setDocumentNumber2] = useState('');
  const [phone2, setPhone2] = useState('');
  const [address2, setAddress2] = useState(''); // Opcional

  // Aceptación legal
  const [legalAccepted, setLegalAccepted] = useState(false);

  // Datos de tracking (captura silenciosa)
  const [browserInfo, setBrowserInfo] = useState('');
  const [osInfo, setOsInfo] = useState('');
  const [screenResolution, setScreenResolution] = useState('');
  const [timezone, setTimezone] = useState('');
  const [language, setLanguage] = useState('');
  const [registrationIp, setRegistrationIp] = useState('');

  useEffect(() => {
    // Capturar información del navegador y sistema operativo
    setBrowserInfo(navigator.userAgent);
    setOsInfo(navigator.platform);
    setScreenResolution(`${window.screen.width}x${window.screen.height}`);
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    setLanguage(navigator.language);

    // Pre-llenar email del responsable 1 con el email del usuario
    if (user?.email) {
      setEmail1(user.email);
    }

    // Capturar IP
    const fetchIp = async () => {
      try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        setRegistrationIp(data.ip);
      } catch (error) {
        console.error('Error fetching IP:', error);
        setRegistrationIp('N/A');
      }
    };
    fetchIp();
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    if (!user) {
      toast({ variant: 'destructive', title: 'Error', description: 'Usuario no autenticado.' });
      setIsLoading(false);
      return;
    }

    // Validar Responsable 1 (todos obligatorios)
    if (!firstName1 || !lastName1 || !email1 || !documentNumber1 || !phone1 || !address1) {
      toast({ 
        variant: 'destructive', 
        title: 'Responsable 1 incompleto', 
        description: 'Por favor, completa todos los campos del primer responsable (incluyendo dirección).' 
      });
      setIsLoading(false);
      return;
    }

    // Validar Responsable 2 (email y dirección son opcionales)
    if (!firstName2 || !lastName2 || !documentNumber2 || !phone2) {
      toast({ 
        variant: 'destructive', 
        title: 'Responsable 2 incompleto', 
        description: 'Por favor, completa los datos obligatorios del segundo responsable (email y dirección son opcionales).' 
      });
      setIsLoading(false);
      return;
    }

    // Validar aceptación legal
    if (!legalAccepted) {
      toast({ 
        variant: 'destructive', 
        title: 'Aceptación requerida', 
        description: 'Debes aceptar los términos legales para continuar.' 
      });
      setIsLoading(false);
      return;
    }

    try {
      const fullName1 = `${firstName1} ${lastName1}`;
      const fullName2 = `${firstName2} ${lastName2}`;

      // Actualizar parent_profiles con ambos responsables
      const { error: parentProfileError } = await supabase
        .from('parent_profiles')
        .update({
          // Responsable 1
          full_name: fullName1,
          email: email1,
          dni: documentNumber1,
          phone_1: phone1,
          address: address1,
          document_type: documentType1,
          document_number: documentNumber1,
          
          // Responsable 2
          full_name_2: fullName2,
          email_2: email2 || null, // Opcional
          dni_2: documentNumber2,
          phone_2: phone2,
          address_2: address2 || null, // Opcional
          document_type_2: documentType2,
          document_number_2: documentNumber2,
          
          // Aceptación legal
          legal_acceptance: legalAccepted,
          legal_acceptance_date: new Date().toISOString(),
          
          // Tracking
          browser_info: browserInfo,
          os_info: osInfo,
          screen_resolution: screenResolution,
          timezone: timezone,
          language: language,
          registration_ip: registrationIp,
          registration_timestamp: new Date().toISOString(),
        })
        .eq('user_id', user.id);

      if (parentProfileError) throw parentProfileError;

      // Actualizar profiles con datos del responsable principal
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          full_name: fullName1,
          phone_1: phone1,
          address: address1,
          document_type: documentType1,
          document_number: documentNumber1,
        })
        .eq('id', user.id);

      if (profileError) throw profileError;

      toast({ 
        title: '✅ Datos guardados', 
        description: 'La información de ambos responsables ha sido registrada correctamente.' 
      });
      onSuccess();
    } catch (error: any) {
      console.error('Error al guardar datos:', error);
      toast({ 
        variant: 'destructive', 
        title: 'Error', 
        description: error.message || 'No se pudieron guardar los datos. Intenta de nuevo.' 
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-4xl mx-auto shadow-2xl border-t-4 border-t-brand-teal rounded-2xl bg-white max-h-[90vh] overflow-y-auto">
      <CardHeader className="text-center space-y-2 pb-4 sticky top-0 bg-white z-10 border-b">
        <div className="flex justify-center mb-2">
          <div className="bg-brand-teal/10 p-3 rounded-full">
            <Users className="h-8 w-8 text-brand-teal" />
          </div>
        </div>
        <CardTitle className="text-2xl font-bold text-foreground">
          Datos de Responsables de Pago
        </CardTitle>
        <CardDescription className="text-muted-foreground font-medium">
          Registra los datos de ambos responsables de pago (obligatorio)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 p-6">
        <form onSubmit={handleSubmit} className="space-y-8">
          
          {/* ========== RESPONSABLE 1 (Principal) ========== */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <User className="h-5 w-5 text-brand-teal" />
              <h3 className="text-lg font-bold text-slate-800">Responsable Principal 1</h3>
              <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full font-bold">OBLIGATORIO</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="font-semibold text-xs uppercase tracking-wider text-gray-500 ml-1">Nombres *</Label>
                <Input 
                  value={firstName1}
                  onChange={(e) => setFirstName1(e.target.value)}
                  placeholder="Ej: Juan Carlos"
                  className="h-12 border-2 focus:border-brand-teal font-medium"
                  required
                />
              </div>
              <div>
                <Label className="font-semibold text-xs uppercase tracking-wider text-gray-500 ml-1">Apellidos *</Label>
                <Input 
                  value={lastName1}
                  onChange={(e) => setLastName1(e.target.value)}
                  placeholder="Ej: Pérez García"
                  className="h-12 border-2 focus:border-brand-teal font-medium"
                  required
                />
              </div>
            </div>

            <div>
              <Label className="font-semibold text-xs uppercase tracking-wider text-gray-500 ml-1 flex items-center gap-2">
                <Mail className="h-4 w-4" /> Email *
              </Label>
              <Input 
                type="email"
                value={email1}
                onChange={(e) => setEmail1(e.target.value)}
                placeholder="Ej: juan.perez@gmail.com"
                className="h-12 border-2 focus:border-brand-teal font-medium"
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="font-semibold text-xs uppercase tracking-wider text-gray-500 ml-1">Tipo de Documento *</Label>
                <Select value={documentType1} onValueChange={setDocumentType1}>
                  <SelectTrigger className="h-12 border-2 focus:border-brand-teal font-medium">
                    <SelectValue placeholder="Selecciona" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DNI">DNI</SelectItem>
                    <SelectItem value="Pasaporte">Pasaporte</SelectItem>
                    <SelectItem value="Carnet de Extranjería">Carnet de Extranjería</SelectItem>
                    <SelectItem value="Otro">Otro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="font-semibold text-xs uppercase tracking-wider text-gray-500 ml-1">Número de Documento *</Label>
                <Input 
                  value={documentNumber1}
                  onChange={(e) => setDocumentNumber1(e.target.value)}
                  placeholder="Ej: 12345678"
                  className="h-12 border-2 focus:border-brand-teal font-medium"
                  required
                />
              </div>
            </div>

            <div>
              <Label className="font-semibold text-xs uppercase tracking-wider text-gray-500 ml-1 flex items-center gap-2">
                <Phone className="h-4 w-4" /> Teléfono *
              </Label>
              <Input 
                type="tel"
                value={phone1}
                onChange={(e) => setPhone1(e.target.value)}
                placeholder="Ej: +51 987 654 321"
                className="h-12 border-2 focus:border-brand-teal font-medium"
                required
              />
            </div>

            <div>
              <Label className="font-semibold text-xs uppercase tracking-wider text-gray-500 ml-1 flex items-center gap-2">
                <MapPin className="h-4 w-4" /> Dirección Completa *
              </Label>
              <Input 
                value={address1}
                onChange={(e) => setAddress1(e.target.value)}
                placeholder="Ej: Av. La Molina 123, Urb. Santa Patricia, Lima"
                className="h-12 border-2 focus:border-brand-teal font-medium"
                required
              />
            </div>
          </div>

          <Separator className="my-8" />

          {/* ========== RESPONSABLE 2 (Secundario) ========== */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <User className="h-5 w-5 text-blue-600" />
              <h3 className="text-lg font-bold text-slate-800">Responsable Secundario 2</h3>
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-bold">OBLIGATORIO</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="font-semibold text-xs uppercase tracking-wider text-gray-500 ml-1">Nombres *</Label>
                <Input 
                  value={firstName2}
                  onChange={(e) => setFirstName2(e.target.value)}
                  placeholder="Ej: María Elena"
                  className="h-12 border-2 focus:border-blue-500 font-medium"
                  required
                />
              </div>
              <div>
                <Label className="font-semibold text-xs uppercase tracking-wider text-gray-500 ml-1">Apellidos *</Label>
                <Input 
                  value={lastName2}
                  onChange={(e) => setLastName2(e.target.value)}
                  placeholder="Ej: López Vega"
                  className="h-12 border-2 focus:border-blue-500 font-medium"
                  required
                />
              </div>
            </div>

            <div>
              <Label className="font-semibold text-xs uppercase tracking-wider text-gray-500 ml-1 flex items-center gap-2">
                <Mail className="h-4 w-4" /> Email <span className="text-gray-400">(Opcional)</span>
              </Label>
              <Input 
                type="email"
                value={email2}
                onChange={(e) => setEmail2(e.target.value)}
                placeholder="Ej: maria.lopez@gmail.com (opcional)"
                className="h-12 border-2 focus:border-blue-500 font-medium"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="font-semibold text-xs uppercase tracking-wider text-gray-500 ml-1">Tipo de Documento *</Label>
                <Select value={documentType2} onValueChange={setDocumentType2}>
                  <SelectTrigger className="h-12 border-2 focus:border-blue-500 font-medium">
                    <SelectValue placeholder="Selecciona" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DNI">DNI</SelectItem>
                    <SelectItem value="Pasaporte">Pasaporte</SelectItem>
                    <SelectItem value="Carnet de Extranjería">Carnet de Extranjería</SelectItem>
                    <SelectItem value="Otro">Otro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="font-semibold text-xs uppercase tracking-wider text-gray-500 ml-1">Número de Documento *</Label>
                <Input 
                  value={documentNumber2}
                  onChange={(e) => setDocumentNumber2(e.target.value)}
                  placeholder="Ej: 87654321"
                  className="h-12 border-2 focus:border-blue-500 font-medium"
                  required
                />
              </div>
            </div>

            <div>
              <Label className="font-semibold text-xs uppercase tracking-wider text-gray-500 ml-1 flex items-center gap-2">
                <Phone className="h-4 w-4" /> Teléfono *
              </Label>
              <Input 
                type="tel"
                value={phone2}
                onChange={(e) => setPhone2(e.target.value)}
                placeholder="Ej: +51 912 345 678"
                className="h-12 border-2 focus:border-blue-500 font-medium"
                required
              />
            </div>

            <div>
              <Label className="font-semibold text-xs uppercase tracking-wider text-gray-500 ml-1 flex items-center gap-2">
                <MapPin className="h-4 w-4" /> Dirección Completa <span className="text-gray-400">(Opcional)</span>
              </Label>
              <Input 
                value={address2}
                onChange={(e) => setAddress2(e.target.value)}
                placeholder="Ej: Av. Javier Prado 456, La Molina, Lima (opcional)"
                className="h-12 border-2 focus:border-blue-500 font-medium"
              />
            </div>
          </div>

          <Separator className="my-8" />

          {/* ========== ACEPTACIÓN LEGAL ========== */}
          <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <Scale className="h-6 w-6 text-amber-700" />
              <h3 className="text-lg font-bold text-amber-900">Aceptación Legal</h3>
            </div>
            
            <p className="text-sm text-amber-900 leading-relaxed">
              Al registrar mis datos como responsable(s) de pago, acepto y declaro que:
            </p>
            
            <ul className="text-sm text-amber-900 space-y-2 list-disc list-inside ml-2">
              <li>Soy responsable solidario del pago de los consumos de mi(s) hijo(s) en el kiosco escolar.</li>
              <li>Autorizo el uso de mis datos personales para fines de cobranza administrativa y judicial en caso de incumplimiento de pago.</li>
              <li>Los datos proporcionados son verídicos y pueden ser verificados legalmente.</li>
              <li>En caso de morosidad, acepto procedimientos de cobranza extrajudicial o judicial según corresponda.</li>
              <li>He leído y acepto la Política de Privacidad y Términos de Uso del servicio.</li>
            </ul>

            <div className="flex items-start gap-3 bg-white p-4 rounded-lg border-2 border-amber-300 mt-4">
              <Checkbox 
                id="legal"
                checked={legalAccepted}
                onCheckedChange={(checked) => setLegalAccepted(checked === true)}
                className="mt-1"
              />
              <Label 
                htmlFor="legal" 
                className="text-sm font-bold text-slate-800 cursor-pointer leading-relaxed"
              >
                He leído y acepto las condiciones legales mencionadas. Autorizo el uso de mis datos para fines de cobranza administrativa y judicial en caso de incumplimiento de pago.
              </Label>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3 text-sm text-blue-800">
            <Info className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <span>
              Para tu seguridad y la de tus hijos, recopilamos información básica de tu dispositivo y conexión.
            </span>
          </div>

          <div className="flex justify-center pt-4">
            <Button 
              type="submit" 
              className="h-14 px-12 text-lg font-bold bg-brand-teal hover:bg-brand-teal/90 text-white shadow-lg rounded-xl" 
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin mr-2" />
                  Guardando...
                </>
              ) : (
                'Guardar y Continuar'
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
