import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { useToast } from '@/hooks/use-toast';
import { useViewAsStore } from '@/stores/viewAsStore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Settings,
  Save,
  Building2,
  MessageSquare,
  CreditCard,
  Loader2,
  Check
} from 'lucide-react';

interface School {
  id: string;
  name: string;
}

interface BillingConfig {
  id: string;
  school_id: string;
  message_template: string;
  bank_account_info: string | null;
  yape_number: string | null;
  plin_number: string | null;
  show_payment_info: boolean;
}

export const BillingConfig = () => {
  const { user } = useAuth();
  const { role } = useRole();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchool, setSelectedSchool] = useState<string>('');
  const [config, setConfig] = useState<BillingConfig | null>(null);

  // Form data
  const [messageTemplate, setMessageTemplate] = useState('');
  const [bankInfo, setBankInfo] = useState('');
  const [yapeNumber, setYapeNumber] = useState('');
  const [plinNumber, setPlinNumber] = useState('');
  const [showPaymentInfo, setShowPaymentInfo] = useState(false);

  const canViewAllSchools = role === 'admin_general';

  // Generar información de pago formateada
  const getPaymentInfoText = () => {
    if (!showPaymentInfo) return '';

    let paymentText = '\n\n📋 *FORMAS DE PAGO:*\n';
    
    if (bankInfo.trim()) {
      paymentText += `\n🏦 *Banco:*\n${bankInfo}\n`;
    }
    
    if (yapeNumber.trim() || plinNumber.trim()) {
      paymentText += '\n💳 *Pagos digitales:*\n';
      if (yapeNumber.trim()) {
        paymentText += `• Yape: ${yapeNumber}\n`;
      }
      if (plinNumber.trim()) {
        paymentText += `• Plin: ${plinNumber}\n`;
      }
    }

    return paymentText;
  };

  // Mensaje completo con información de pago
  const getCompleteMessage = () => {
    return messageTemplate + getPaymentInfoText();
  };

  useEffect(() => {
    fetchSchools();
  }, []);

  useEffect(() => {
    if (selectedSchool) {
      fetchConfig();
    }
  }, [selectedSchool]);

  const fetchSchools = async () => {
    try {
      const { data, error } = await supabase
        .from('schools')
        .select('*')
        .order('name');
      
      if (error) throw error;
      setSchools(data || []);

      if (!canViewAllSchools && user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('school_id')
          .eq('id', user.id)
          .single();
        
        if (profile?.school_id) {
          setSelectedSchool(profile.school_id);
        } else {
          setLoading(false); // Detener carga si no hay sede
        }
      } else if (data && data.length > 0) {
        setSelectedSchool(data[0].id);
      } else {
        setLoading(false); // Detener carga si no hay sedes
      }
    } catch (error) {
      console.error('Error fetching schools:', error);
      setLoading(false);
    }
  };

  const fetchConfig = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('billing_config')
        .select('*')
        .eq('school_id', selectedSchool)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        setConfig(data);
        setMessageTemplate(data.message_template);
        setBankInfo(data.bank_account_info || '');
        setYapeNumber(data.yape_number || '');
        setPlinNumber(data.plin_number || '');
        setShowPaymentInfo(data.show_payment_info || false);
      } else {
        // No hay config, usar valores por defecto
        setMessageTemplate(`🔔 *COBRANZA LIMA CAFÉ 28*
...
Para pagar, contacte con administración.
Gracias.`);
        setBankInfo('');
        setYapeNumber('');
        setPlinNumber('');
        setShowPaymentInfo(false);
      }
    } catch (error) {
      console.error('Error fetching config:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedSchool || !user) return;

    setSaving(true);

    try {
      const configData = {
        school_id: selectedSchool,
        message_template: messageTemplate,
        bank_account_info: bankInfo || null,
        yape_number: yapeNumber || null,
        plin_number: plinNumber || null,
        show_payment_info: showPaymentInfo,
        updated_by: user.id,
      };

      if (config) {
        // Actualizar
        const { error } = await supabase
          .from('billing_config')
          .update(configData)
          .eq('id', config.id);

        if (error) throw error;
      } else {
        // Crear
        const { error } = await supabase
          .from('billing_config')
          .insert(configData);

        if (error) throw error;
      }

      toast({
        title: '✅ Configuración guardada',
        description: 'Los cambios se aplicaron correctamente',
      });

      fetchConfig();
    } catch (error: any) {
      console.error('Error saving config:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo guardar la configuración',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-red-600" />
        <p className="ml-3 text-gray-600">Cargando configuración...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Selector de Sede */}
      {canViewAllSchools && schools.length > 1 && (
        <Card className="border-2 shadow-lg bg-white">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-100 rounded-lg">
                <Building2 className="h-6 w-6 text-blue-600" />
              </div>
              <div className="flex-1">
                <Label className="text-lg font-semibold">Sede a Configurar</Label>
              </div>
              <Select value={selectedSchool} onValueChange={setSelectedSchool}>
                <SelectTrigger className="w-[250px] h-12 border-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {schools.map((school) => (
                    <SelectItem key={school.id} value={school.id}>
                      {school.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Plantilla de Mensaje */}
      <Card className="border-2 shadow-lg bg-white">
        <CardHeader className="bg-gradient-to-r from-blue-50 to-cyan-50 border-b-2">
          <CardTitle className="flex items-center gap-3 text-xl">
            <div className="p-2 bg-blue-600 rounded-lg">
              <MessageSquare className="h-6 w-6 text-white" />
            </div>
            Plantilla de Mensaje WhatsApp
          </CardTitle>
          <CardDescription className="text-base mt-2">
            Personaliza el mensaje que se enviará a los padres. Usa variables: {'{'}nombre_padre{'}'}, {'{'}nombre_estudiante{'}'}, {'{'}periodo{'}'}, {'{'}monto{'}'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-6">
          <div className="space-y-2">
            <Label htmlFor="message_template" className="text-base font-semibold">Mensaje</Label>
            <Textarea
              id="message_template"
              value={messageTemplate}
              onChange={(e) => setMessageTemplate(e.target.value)}
              rows={12}
              className="font-mono text-sm border-2"
            />
            <p className="text-xs text-gray-500">
              Variables disponibles: {'{'}nombre_padre{'}'}, {'{'}nombre_estudiante{'}'}, {'{'}periodo{'}'}, {'{'}monto{'}'}
            </p>
          </div>

          <div className="bg-gradient-to-br from-gray-50 to-gray-100 p-6 rounded-xl border-2 border-dashed border-gray-300">
            <p className="text-base font-semibold mb-3 flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-blue-600" />
              Vista Previa del Mensaje Completo:
            </p>
            <div className="bg-white p-4 rounded-lg border-2 border-gray-200 shadow-inner whitespace-pre-wrap text-sm">
              {getCompleteMessage()
                .replace('{nombre_padre}', 'María García')
                .replace('{nombre_estudiante}', 'Juan Pérez')
                .replace('{periodo}', 'Semana 1-5 Enero')
                .replace('{monto}', '45.50')}
            </div>
            {showPaymentInfo && (
              <p className="text-xs text-green-600 mt-2 flex items-center gap-1">
                <Check className="h-3 w-3" />
                La información de pago se agregará automáticamente al enviar
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Información de Pago */}
      <Card className="border-2 shadow-lg bg-white">
        <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-3 text-xl">
                <div className="p-2 bg-green-600 rounded-lg">
                  <CreditCard className="h-6 w-6 text-white" />
                </div>
                Información de Pago
              </CardTitle>
              <CardDescription className="text-base mt-2">
                Esta información se agregará automáticamente al final del mensaje de WhatsApp
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <Label htmlFor="show_payment_info" className="text-base font-semibold cursor-pointer">
                {showPaymentInfo ? 'Habilitado' : 'Deshabilitado'}
              </Label>
              <Switch
                id="show_payment_info"
                checked={showPaymentInfo}
                onCheckedChange={setShowPaymentInfo}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
          <div className="space-y-2">
            <Label htmlFor="bank_info" className="text-base font-semibold">Información Bancaria</Label>
            <Textarea
              id="bank_info"
              placeholder="Ej: Banco BCP&#10;Cuenta Corriente: 123-456-789&#10;CCI: 001-123-456-789"
              value={bankInfo}
              onChange={(e) => setBankInfo(e.target.value)}
              rows={4}
              className="border-2"
              disabled={!showPaymentInfo}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="yape_number" className="text-base font-semibold">Número Yape</Label>
              <Input
                id="yape_number"
                placeholder="987654321"
                value={yapeNumber}
                onChange={(e) => setYapeNumber(e.target.value)}
                className="h-12 border-2"
                disabled={!showPaymentInfo}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="plin_number" className="text-base font-semibold">Número Plin</Label>
              <Input
                id="plin_number"
                placeholder="987654321"
                value={plinNumber}
                onChange={(e) => setPlinNumber(e.target.value)}
                className="h-12 border-2"
                disabled={!showPaymentInfo}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Botón Guardar */}
      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving}
          size="lg"
          className="bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 h-14 px-8 text-lg shadow-lg"
        >
          {saving ? (
            <>
              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
              Guardando...
            </>
          ) : (
            <>
              <Save className="h-5 w-5 mr-2" />
              Guardar Configuración
            </>
          )}
        </Button>
      </div>
    </div>
  );
};
