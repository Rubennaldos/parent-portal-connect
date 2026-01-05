import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
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
  Loader2
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

  const canViewAllSchools = role === 'admin_general';

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

      // Si no es admin_general, obtener su sede
      if (!canViewAllSchools && user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('school_id')
          .eq('id', user.id)
          .single();
        
        if (profile?.school_id) {
          setSelectedSchool(profile.school_id);
        }
      } else if (data && data.length > 0) {
        setSelectedSchool(data[0].id);
      }
    } catch (error) {
      console.error('Error fetching schools:', error);
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
      } else {
        // No hay config, usar valores por defecto
        setMessageTemplate(`🔔 *COBRANZA LIMA CAFÉ 28*

Estimado(a) {nombre_padre}

El alumno *{nombre_estudiante}* tiene un consumo pendiente del período: {periodo}

💰 Monto Total: S/ {monto}

📎 Adjuntamos el detalle completo.

Para pagar, contacte con administración.
Gracias.`);
        setBankInfo('');
        setYapeNumber('');
        setPlinNumber('');
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
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <Building2 className="h-5 w-5 text-blue-600" />
              <div className="flex-1">
                <Label>Sede a Configurar</Label>
              </div>
              <Select value={selectedSchool} onValueChange={setSelectedSchool}>
                <SelectTrigger className="w-[250px]">
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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-blue-600" />
            Plantilla de Mensaje WhatsApp
          </CardTitle>
          <CardDescription>
            Personaliza el mensaje que se enviará a los padres. Usa variables: {'{'}nombre_padre{'}'}, {'{'}nombre_estudiante{'}'}, {'{'}periodo{'}'}, {'{'}monto{'}'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="message_template">Mensaje</Label>
            <Textarea
              id="message_template"
              value={messageTemplate}
              onChange={(e) => setMessageTemplate(e.target.value)}
              rows={12}
              className="font-mono text-sm"
            />
            <p className="text-xs text-gray-500">
              Variables disponibles: {'{'}nombre_padre{'}'}, {'{'}nombre_estudiante{'}'}, {'{'}periodo{'}'}, {'{'}monto{'}'}
            </p>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg">
            <p className="text-sm font-semibold mb-2">Vista Previa:</p>
            <div className="bg-white p-3 rounded border whitespace-pre-wrap text-sm">
              {messageTemplate
                .replace('{nombre_padre}', 'María García')
                .replace('{nombre_estudiante}', 'Juan Pérez')
                .replace('{periodo}', 'Semana 1-5 Enero')
                .replace('{monto}', '45.50')}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Información de Pago */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-green-600" />
            Información de Pago
          </CardTitle>
          <CardDescription>
            Esta información aparecerá en los PDFs de estado de cuenta
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bank_info">Información Bancaria</Label>
            <Textarea
              id="bank_info"
              placeholder="Ej: Banco BCP&#10;Cuenta Corriente: 123-456-789&#10;CCI: 001-123-456-789"
              value={bankInfo}
              onChange={(e) => setBankInfo(e.target.value)}
              rows={4}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="yape_number">Número Yape</Label>
              <Input
                id="yape_number"
                placeholder="987654321"
                value={yapeNumber}
                onChange={(e) => setYapeNumber(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="plin_number">Número Plin</Label>
              <Input
                id="plin_number"
                placeholder="987654321"
                value={plinNumber}
                onChange={(e) => setPlinNumber(e.target.value)}
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
          className="bg-blue-600 hover:bg-blue-700"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Guardando...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Guardar Configuración
            </>
          )}
        </Button>
      </div>
    </div>
  );
};
