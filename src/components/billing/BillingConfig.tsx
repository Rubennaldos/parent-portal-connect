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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { 
  Settings,
  Save,
  Building2,
  MessageSquare,
  CreditCard,
  Loader2,
  Check,
  Clock,
  AlertTriangle,
  Zap
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

  // ✨ Delay de visibilidad
  const [delayDays, setDelayDays] = useState<number>(2);
  const [showLiveWarning, setShowLiveWarning] = useState(false);
  const [showDelayWarning, setShowDelayWarning] = useState(false);
  const [pendingDelayValue, setPendingDelayValue] = useState<number>(2);

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

      // ✅ 1. Cargar configuración de mensajes
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

      // ✅ 2. Cargar configuración de delay de visibilidad
      const { data: delayData } = await supabase
        .from('purchase_visibility_delay')
        .select('delay_days')
        .eq('school_id', selectedSchool)
        .maybeSingle();

      setDelayDays(delayData?.delay_days ?? 2);
      setPendingDelayValue(delayData?.delay_days ?? 2);
      
      console.log('📅 Delay actual:', delayData?.delay_days ?? 2);
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

  // ✅ Funciones para manejar el delay
  const handleDelayChange = (value: string) => {
    console.log('🔄 Select cambió a:', value);
    const newValue = parseInt(value);
    setPendingDelayValue(newValue);
    
    console.log('📝 Nuevo valor:', newValue, 'Valor actual:', delayDays);
    
    if (newValue === 0) {
      console.log('⚡ Abriendo modal EN VIVO');
      setShowLiveWarning(true);
    } else if (newValue !== delayDays) {
      console.log('⏱️ Abriendo modal de cambio de delay');
      setShowDelayWarning(true);
    }
  };

  const confirmLiveModeChange = async () => {
    console.log('⚡ Confirmando modo EN VIVO...');
    await saveDelayConfig(0);
    setShowLiveWarning(false);
  };

  const confirmDelayChange = async () => {
    console.log('⏱️ Confirmando cambio de delay a:', pendingDelayValue);
    await saveDelayConfig(pendingDelayValue);
    setShowDelayWarning(false);
  };

  const saveDelayConfig = async (days: number) => {
    console.log('🎯 saveDelayConfig llamado con:', { days, selectedSchool });
    
    if (!selectedSchool) {
      console.error('❌ No hay selectedSchool, abortando');
      return;
    }

    try {
      setSaving(true);
      
      console.log('💾 Guardando delay config:', { school_id: selectedSchool, delay_days: days });

      // Verificar si existe configuración
      const { data: existing } = await supabase
        .from('purchase_visibility_delay')
        .select('*')
        .eq('school_id', selectedSchool)
        .maybeSingle();

      console.log('📦 Configuración existente:', existing);

      if (existing) {
        // Actualizar
        const { error, data } = await supabase
          .from('purchase_visibility_delay')
          .update({ delay_days: days })
          .eq('school_id', selectedSchool)
          .select();

        console.log('✏️ Resultado UPDATE:', { error, data });
        if (error) throw error;
      } else {
        // Crear
        const { error, data } = await supabase
          .from('purchase_visibility_delay')
          .insert({ school_id: selectedSchool, delay_days: days })
          .select();

        console.log('➕ Resultado INSERT:', { error, data });
        if (error) throw error;
      }

      setDelayDays(days);
      setPendingDelayValue(days);
      
      console.log('✅ Delay guardado correctamente:', days);
      
      toast({
        title: days === 0 ? '⚡ MODO EN VIVO ACTIVADO' : '✅ Delay configurado',
        description: days === 0 
          ? 'Los padres verán las compras en tiempo real'
          : `Los padres verán las compras después de ${days} día${days > 1 ? 's' : ''}`,
      });
    } catch (error: any) {
      console.error('❌ Error saving delay config:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo guardar la configuración de delay',
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

      {/* ⏱️ Configuración de Delay de Visibilidad */}
      <Card className="border-2 shadow-lg bg-white">
        <CardHeader className="bg-gradient-to-r from-amber-50 to-orange-50 border-b-2">
          <CardTitle className="flex items-center gap-3 text-xl">
            <div className="p-2 bg-amber-600 rounded-lg">
              <Clock className="h-6 w-6 text-white" />
            </div>
            Delay de Visibilidad de Compras (Portal de Padres)
          </CardTitle>
          <CardDescription className="text-base mt-2">
            Controla cuántos días deben pasar antes de que los padres vean las compras de sus hijos en el portal.
            Esta configuración <strong>NO afecta</strong> al módulo de cobranzas del admin (siempre en vivo).
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <Label htmlFor="delay_days" className="text-base font-semibold">
                Días de Delay
              </Label>
              <p className="text-sm text-gray-600">
                Actualmente: <span className="font-bold text-amber-700">
                  {delayDays === 0 ? '⚡ MODO EN VIVO' : `${delayDays} día${delayDays > 1 ? 's' : ''}`}
                </span>
              </p>
            </div>
            <Select 
              value={delayDays.toString()} 
              onValueChange={handleDelayChange}
            >
              <SelectTrigger className="w-[200px] h-12 border-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0" className="font-bold text-green-600">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    <span>⚡ EN VIVO (0 días)</span>
                  </div>
                </SelectItem>
                <SelectItem value="1">1 día</SelectItem>
                <SelectItem value="2">2 días (recomendado)</SelectItem>
                <SelectItem value="3">3 días</SelectItem>
                <SelectItem value="4">4 días</SelectItem>
                <SelectItem value="5">5 días</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Explicación visual */}
          <div className="bg-gradient-to-br from-blue-50 to-cyan-50 p-6 rounded-xl border-2 border-blue-200">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-blue-500 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900 mb-2">¿Qué hace el Delay?</p>
                <ul className="text-sm text-gray-700 space-y-1 list-disc list-inside">
                  <li>Los padres verán compras hechas hace <strong>{delayDays === 0 ? '0' : delayDays}+ días</strong></li>
                  <li>Compras de hoy NO aparecen hasta dentro de <strong>{delayDays === 0 ? '0' : delayDays} día{delayDays > 1 ? 's' : ''}</strong></li>
                  <li>Útil para evitar reclamos inmediatos y dar tiempo de verificación</li>
                  {delayDays === 0 && (
                    <li className="text-green-700 font-semibold">⚡ MODO EN VIVO: Los padres ven compras al instante</li>
                  )}
                </ul>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

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

      {/* ⚡ Modal de Confirmación: MODO EN VIVO */}
      <Dialog open={showLiveWarning} onOpenChange={setShowLiveWarning}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Zap className="h-6 w-6 text-yellow-500" />
              ⚡ Activar Modo EN VIVO
            </DialogTitle>
            <DialogDescription className="text-base pt-4">
              <span className="block font-semibold text-gray-900 mb-3">
                ¿Estás seguro de activar el modo EN VIVO?
              </span>
              <span className="block bg-yellow-50 border-2 border-yellow-300 rounded-lg p-4">
                <span className="block text-sm text-gray-700 mb-2">
                  <strong>Esto significa que:</strong>
                </span>
                <span className="block text-sm text-gray-700 space-y-1">
                  <span className="block">• Los padres verán <strong>todas las compras al instante</strong></span>
                  <span className="block">• No habrá tiempo de verificación</span>
                  <span className="block">• Pueden reclamar inmediatamente</span>
                </span>
              </span>
              <span className="block text-sm text-gray-600 mt-3">
                Solo activa esto si estás seguro de que el sistema está funcionando correctamente.
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 mt-4">
            <Button
              variant="outline"
              onClick={() => {
                setShowLiveWarning(false);
                setPendingDelayValue(delayDays); // Revertir
              }}
              className="flex-1"
            >
              Cancelar
            </Button>
            <Button
              onClick={confirmLiveModeChange}
              className="flex-1 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
            >
              <Zap className="h-4 w-4 mr-2" />
              Activar EN VIVO
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ⏱️ Modal de Confirmación: Cambiar Delay */}
      <Dialog open={showDelayWarning} onOpenChange={setShowDelayWarning}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Clock className="h-6 w-6 text-amber-600" />
              Cambiar Delay de Visibilidad
            </DialogTitle>
            <DialogDescription className="text-base pt-4">
              <span className="block font-semibold text-gray-900 mb-3">
                ¿Confirmas el cambio a {pendingDelayValue} día{pendingDelayValue > 1 ? 's' : ''}?
              </span>
              <span className="block bg-amber-50 border-2 border-amber-300 rounded-lg p-4">
                <span className="block text-sm text-gray-700 mb-2">
                  <strong>Los padres verán:</strong>
                </span>
                <span className="block text-sm text-gray-700 space-y-1">
                  <span className="block">• Compras de hace <strong>{pendingDelayValue}+ días</strong></span>
                  <span className="block">• Compras de hoy NO aparecerán hasta dentro de <strong>{pendingDelayValue} día{pendingDelayValue > 1 ? 's' : ''}</strong></span>
                </span>
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 mt-4">
            <Button
              variant="outline"
              onClick={() => {
                setShowDelayWarning(false);
                setPendingDelayValue(delayDays); // Revertir
              }}
              className="flex-1"
            >
              Cancelar
            </Button>
            <Button
              onClick={confirmDelayChange}
              className="flex-1 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700"
            >
              <Check className="h-4 w-4 mr-2" />
              Confirmar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
