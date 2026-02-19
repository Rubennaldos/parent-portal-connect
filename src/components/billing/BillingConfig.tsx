import { useState, useEffect } from 'react';
import { BillingNubefactConfig } from './BillingNubefactConfig';
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
// Select de Radix removido - se usa <select> nativo para evitar error removeChild en algunos navegadores
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

interface SchoolDelayConfig {
  school_id: string;
  school_name: string;
  enabled: boolean;
  delay_days: number;
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
  const { role, canViewAllSchools: canViewAllSchoolsFromHook } = useRole();
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

  // ✨ Delay de visibilidad - NUEVO: Lista de todas las sedes
  const [schoolDelays, setSchoolDelays] = useState<SchoolDelayConfig[]>([]);
  const [savingDelays, setSavingDelays] = useState(false);

  console.log('🎭 Rol actual:', role);
  console.log('🔐 canViewAllSchools del hook:', canViewAllSchoolsFromHook);
  
  // Usar el canViewAllSchools del hook en lugar de calcularlo aquí
  const canViewAllSchools = canViewAllSchoolsFromHook;

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

  // ✅ Esperar a que el rol esté cargado antes de cargar sedes
  useEffect(() => {
    if (role) {
      console.log('🚀 Rol listo:', role, '- canViewAllSchools:', canViewAllSchools);
      fetchSchools();
      fetchAllSchoolDelays();
    }
  }, [role, canViewAllSchools]);

  useEffect(() => {
    if (selectedSchool) {
      fetchConfig();
    }
  }, [selectedSchool]);

  const fetchSchools = async () => {
    try {
      console.log('🏫 Cargando sedes... canViewAllSchools:', canViewAllSchools);
      const { data, error } = await supabase
        .from('schools')
        .select('*')
        .order('name');
      
      if (error) throw error;
      console.log('📦 Sedes obtenidas:', data?.length);
      setSchools(data || []);

      if (canViewAllSchools) {
        // Admin General: seleccionar la primera sede
        if (data && data.length > 0) {
          console.log('✅ Admin General - Seleccionando primera sede:', data[0].name);
          setSelectedSchool(data[0].id);
        } else {
          console.log('❌ No hay sedes disponibles');
          setLoading(false);
        }
      } else if (user) {
        // Admin de sede: buscar su sede
        console.log('👤 Buscando sede del usuario...');
        const { data: profile } = await supabase
          .from('profiles')
          .select('school_id')
          .eq('id', user.id)
          .single();
        
        console.log('🎯 Profile del usuario:', profile);
        
        if (profile?.school_id) {
          console.log('✅ Estableciendo selectedSchool:', profile.school_id);
          setSelectedSchool(profile.school_id);
        } else {
          console.log('❌ Usuario sin sede asignada');
          setLoading(false);
        }
      } else {
        console.log('❌ No hay usuario');
        setLoading(false);
      }
    } catch (error) {
      console.error('❌ Error fetching schools:', error);
      setLoading(false);
    }
  };

  // ✨ NUEVA FUNCIÓN: Cargar delays de TODAS las sedes
  const fetchAllSchoolDelays = async () => {
    try {
      // 1. Obtener todas las sedes
      const { data: schoolsData, error: schoolsError } = await supabase
        .from('schools')
        .select('id, name')
        .order('name');

      if (schoolsError) throw schoolsError;

      if (!schoolsData || schoolsData.length === 0) {
        setSchoolDelays([]);
        return;
      }

      // 2. Obtener configuraciones de delay existentes
      const { data: delaysData, error: delaysError } = await supabase
        .from('purchase_visibility_delay')
        .select('school_id, delay_days');

      if (delaysError) throw delaysError;

      // 3. Crear mapa de delays
      const delaysMap = new Map<string, number>();
      delaysData?.forEach(d => {
        delaysMap.set(d.school_id, d.delay_days);
      });

      // 4. Combinar sedes con sus delays
      const configs: SchoolDelayConfig[] = schoolsData.map(school => ({
        school_id: school.id,
        school_name: school.name,
        enabled: delaysMap.has(school.id) && delaysMap.get(school.id)! > 0,
        delay_days: delaysMap.get(school.id) ?? 0,
      }));

      setSchoolDelays(configs);
      console.log('✅ Delays de todas las sedes cargados:', configs);
    } catch (error) {
      console.error('❌ Error loading school delays:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar las configuraciones de delay',
      });
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

      // ✅ 2. Ya no necesitamos cargar delay aquí, se carga en fetchAllSchoolDelays
      console.log('📅 Config cargado para sede:', selectedSchool);
    } catch (error) {
      console.error('Error fetching config:', error);
    } finally {
      setLoading(false);
    }
  };

  // ✅ NUEVA FUNCIÓN: Cambiar switch de delay para una sede
  const handleDelayToggle = async (schoolId: string, enabled: boolean) => {
    try {
      const newDelayDays = enabled ? 2 : 0; // Si activa, usa 2 días por defecto; si desactiva, 0 días

      await saveSchoolDelay(schoolId, newDelayDays);
      
      // Actualizar estado local
      setSchoolDelays(prev => prev.map(s => 
        s.school_id === schoolId 
          ? { ...s, enabled, delay_days: newDelayDays }
          : s
      ));
    } catch (error) {
      console.error('Error toggling delay:', error);
    }
  };

  // ✅ NUEVA FUNCIÓN: Cambiar días de delay para una sede
  const handleDelayDaysChange = async (schoolId: string, days: number) => {
    try {
      await saveSchoolDelay(schoolId, days);
      
      // Actualizar estado local
      setSchoolDelays(prev => prev.map(s => 
        s.school_id === schoolId 
          ? { ...s, delay_days: days, enabled: days > 0 }
          : s
      ));
    } catch (error) {
      console.error('Error changing delay days:', error);
    }
  };

  // ✅ NUEVA FUNCIÓN: Guardar delay de una sede en la base de datos
  const saveSchoolDelay = async (schoolId: string, days: number) => {
    try {
      console.log('💾 Guardando delay:', { schoolId, days });

      const { data, error } = await supabase
        .from('purchase_visibility_delay')
        .upsert({
          school_id: schoolId,
          delay_days: days,
        }, {
          onConflict: 'school_id'
        });

      if (error) throw error;

      const school = schoolDelays.find(s => s.school_id === schoolId);
      toast({
        title: '✅ Delay actualizado',
        description: `${school?.school_name}: ${days === 0 ? 'EN VIVO' : `${days} día(s)`}`,
      });

      console.log('✅ Delay guardado correctamente');
    } catch (error) {
      console.error('❌ Error guardando delay:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo guardar el delay',
      });
    }
  };

  const handleSave = async () => {
    console.log('💾 handleSave called - selectedSchool:', selectedSchool, 'user:', !!user, 'config:', config?.id);
    
    if (!selectedSchool) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se ha seleccionado ninguna sede. Recarga la página.',
      });
      return;
    }
    if (!user) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se detectó usuario autenticado.',
      });
      return;
    }

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

      console.log('💾 Datos a guardar:', configData);
      console.log('💾 Config existente:', config ? `id=${config.id}` : 'NULL (insert)');

      if (config) {
        // Actualizar
        const { error } = await supabase
          .from('billing_config')
          .update(configData)
          .eq('id', config.id);

        if (error) {
          console.error('❌ Error en UPDATE billing_config:', error);
          throw error;
        }
        console.log('✅ UPDATE exitoso');
      } else {
        // Crear
        const { error } = await supabase
          .from('billing_config')
          .insert(configData);

        if (error) {
          console.error('❌ Error en INSERT billing_config:', error);
          throw error;
        }
        console.log('✅ INSERT exitoso');
      }

      toast({
        title: '✅ Configuración guardada',
        description: 'Los cambios se aplicaron correctamente',
      });

      fetchConfig();
    } catch (error: any) {
      console.error('❌ Error saving config:', error);
      toast({
        variant: 'destructive',
        title: 'Error al guardar',
        description: error?.message || 'No se pudo guardar la configuración',
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
              <select
                value={selectedSchool}
                onChange={(e) => setSelectedSchool(e.target.value)}
                className="w-[250px] h-12 border-2 rounded-md bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {schools.map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.name}
                  </option>
                ))}
              </select>
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
        <CardContent className="p-6 space-y-4">
          {/* Explicación */}
          <div className="bg-gradient-to-br from-blue-50 to-cyan-50 p-4 rounded-lg border-2 border-blue-200">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-blue-500 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900 mb-1">¿Qué hace el Delay?</p>
                <ul className="text-sm text-gray-700 space-y-1">
                  <li>• <strong>Switch OFF (0 días):</strong> Los padres ven las compras al instante ⚡</li>
                  <li>• <strong>Switch ON:</strong> Las compras aparecen después del número de días configurado</li>
                  <li>• Útil para dar tiempo de verificación antes de que los padres reclamen</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Lista de sedes */}
          <div className="space-y-3">
            {schoolDelays.map((school) => (
              <div 
                key={school.school_id} 
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border-2 hover:border-amber-300 transition-colors"
              >
                {/* Nombre de la sede */}
                <div className="flex items-center gap-3 flex-1">
                  <Building2 className="h-5 w-5 text-gray-400" />
                  <span className="font-semibold text-gray-900">{school.school_name}</span>
                </div>

                {/* Switch ON/OFF */}
                <div className="flex items-center gap-2">
                  <Label htmlFor={`delay-switch-${school.school_id}`} className="text-sm text-gray-600 cursor-pointer">
                    {school.enabled ? 'Activado' : 'Desactivado'}
                  </Label>
                  <Switch
                    id={`delay-switch-${school.school_id}`}
                    checked={school.enabled}
                    onCheckedChange={(checked) => handleDelayToggle(school.school_id, checked)}
                  />
                </div>

                {/* Selector de días */}
                <select 
                  value={school.delay_days.toString()} 
                  onChange={(e) => handleDelayDaysChange(school.school_id, parseInt(e.target.value))}
                  disabled={!school.enabled}
                  className={`w-[140px] ml-4 h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${!school.enabled ? 'opacity-50' : ''}`}
                >
                  <option value="0">0 días (EN VIVO)</option>
                  <option value="1">1 día</option>
                  <option value="2">2 días</option>
                  <option value="3">3 días</option>
                  <option value="4">4 días</option>
                  <option value="5">5 días</option>
                </select>
              </div>
            ))}

            {schoolDelays.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <Building2 className="h-12 w-12 mx-auto mb-2 text-gray-300" />
                <p>No hay sedes configuradas</p>
              </div>
            )}
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

      {/* ===== SECCIÓN NUBEFACT ===== */}
      <hr className="border-gray-200" />
      <BillingNubefactConfig />
    </div>
  );
};
