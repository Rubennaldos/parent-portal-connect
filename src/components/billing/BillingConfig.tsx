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
  Zap,
  UtensilsCrossed,
  Coffee,
} from 'lucide-react';

const PERUVIAN_BANKS = [
  'BCP - Banco de Crédito del Perú',
  'BBVA Perú',
  'Interbank',
  'Scotiabank Perú',
  'BanBif',
  'Banco Pichincha',
  'Mibanco',
  'Banco de la Nación',
  'GNB Sudameris',
  'Banco Falabella',
  'Banco Ripley',
  'CrediScotia Financiera',
  'Banco Santander Perú',
  'Banco Azteca',
  'CMAC Arequipa',
  'CMAC Huancayo',
  'CMAC Piura',
  'CMAC Sullana',
  'CMAC Trujillo',
  'CMAC Cusco',
  'Financiera Oh!',
  'Compartamos Banco',
  'Alfin Banco',
];

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
  bank_account_holder: string | null;
  yape_number: string | null;
  yape_holder: string | null;
  yape_enabled: boolean;
  plin_number: string | null;
  plin_holder: string | null;
  plin_enabled: boolean;
  show_payment_info: boolean;
  transferencia_enabled: boolean;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_cci: string | null;
}

export const BillingConfig = () => {
  const { user } = useAuth();
  const { role, canViewAllSchools: canViewAllSchoolsFromHook } = useRole();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [savingMessage, setSavingMessage] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchool, setSelectedSchool] = useState<string>('');
  const [config, setConfig] = useState<BillingConfig | null>(null);

  // Form data — Mensaje (3 plantillas)
  const [messageTemplate, setMessageTemplate] = useState('');
  const [lunchMessageTemplate, setLunchMessageTemplate] = useState('');
  const [cafeteriaMessageTemplate, setCafeteriaMessageTemplate] = useState('');
  const [activeTemplateTab, setActiveTemplateTab] = useState<'all' | 'lunch' | 'cafeteria'>('all');
  // Form data — Pago
  const [bankInfo, setBankInfo] = useState('');
  const [bankHolder, setBankHolder] = useState('');
  const [yapeNumber, setYapeNumber] = useState('');
  const [yapeHolder, setYapeHolder] = useState('');
  const [yapeEnabled, setYapeEnabled] = useState(true);
  const [plinNumber, setPlinNumber] = useState('');
  const [plinHolder, setPlinHolder] = useState('');
  const [plinEnabled, setPlinEnabled] = useState(true);
  const [showPaymentInfo, setShowPaymentInfo] = useState(false);
  const [transferenciaEnabled, setTransferenciaEnabled] = useState(true);
  const [bankName, setBankName] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankCCI, setBankCCI] = useState('');

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

  const getCompleteMessage = () => {
    const tpl = activeTemplateTab === 'lunch' ? lunchMessageTemplate
      : activeTemplateTab === 'cafeteria' ? cafeteriaMessageTemplate
      : messageTemplate;
    return tpl + getPaymentInfoText();
  };

  const getActiveTemplate = () => {
    if (activeTemplateTab === 'lunch') return lunchMessageTemplate;
    if (activeTemplateTab === 'cafeteria') return cafeteriaMessageTemplate;
    return messageTemplate;
  };

  const setActiveTemplate = (val: string) => {
    if (activeTemplateTab === 'lunch') setLunchMessageTemplate(val);
    else if (activeTemplateTab === 'cafeteria') setCafeteriaMessageTemplate(val);
    else setMessageTemplate(val);
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
        setLunchMessageTemplate(data.lunch_message_template || '');
        setCafeteriaMessageTemplate(data.cafeteria_message_template || '');
        setBankInfo(data.bank_account_info || '');
        setBankHolder(data.bank_account_holder || '');
        setYapeNumber(data.yape_number || '');
        setYapeHolder(data.yape_holder || '');
        setYapeEnabled(data.yape_enabled ?? true);
        setPlinNumber(data.plin_number || '');
        setPlinHolder(data.plin_holder || '');
        setPlinEnabled(data.plin_enabled ?? true);
        setShowPaymentInfo(data.show_payment_info || false);
        setTransferenciaEnabled(data.transferencia_enabled ?? true);
        setBankName(data.bank_name || '');
        setBankAccountNumber(data.bank_account_number || '');
        setBankCCI(data.bank_cci || '');
      } else {
        // No hay config, usar valores por defecto
        setMessageTemplate(`🔔 *COBRANZA LIMA CAFÉ 28*
...
Para pagar, contacte con administración.
Gracias.`);
        setLunchMessageTemplate('');
        setCafeteriaMessageTemplate('');
        setBankInfo('');
        setBankHolder('');
        setYapeNumber('');
        setYapeHolder('');
        setYapeEnabled(true);
        setPlinNumber('');
        setPlinHolder('');
        setPlinEnabled(true);
        setShowPaymentInfo(false);
        setTransferenciaEnabled(true);
        setBankName('');
        setBankAccountNumber('');
        setBankCCI('');
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

  // ── Guardar solo plantilla de mensaje ──
  const handleSaveMessage = async () => {
    if (!selectedSchool || !user) return;
    setSavingMessage(true);
    try {
      const payload = {
        school_id: selectedSchool,
        message_template: messageTemplate,
        lunch_message_template: lunchMessageTemplate || null,
        cafeteria_message_template: cafeteriaMessageTemplate || null,
        updated_by: user.id,
      };
      // Upsert: crea si no existe, actualiza si ya existe (evita fallo silencioso de RLS)
      const { error } = await supabase
        .from('billing_config')
        .upsert(payload, { onConflict: 'school_id' });
      if (error) throw error;
      toast({ title: '✅ Plantilla guardada', description: 'Mensaje de WhatsApp actualizado.' });
      fetchConfig();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error al guardar', description: error?.message });
    } finally {
      setSavingMessage(false);
    }
  };

  // ── Guardar solo información de pago ──
  const handleSavePayment = async () => {
    if (!selectedSchool || !user) return;
    setSavingPayment(true);
    try {
      const payload = {
        school_id: selectedSchool,
        bank_account_holder: bankHolder || null,
        yape_number: yapeNumber || null,
        yape_holder: yapeHolder || null,
        yape_enabled: yapeEnabled,
        plin_number: plinNumber || null,
        plin_holder: plinHolder || null,
        plin_enabled: plinEnabled,
        show_payment_info: showPaymentInfo,
        transferencia_enabled: transferenciaEnabled,
        bank_name: bankName || null,
        bank_account_number: bankAccountNumber || null,
        bank_cci: bankCCI || null,
        updated_by: user.id,
      };
      // Upsert: crea si no existe, actualiza si ya existe (evita fallo silencioso de RLS)
      const { error } = await supabase
        .from('billing_config')
        .upsert(payload, { onConflict: 'school_id' });
      if (error) throw error;
      toast({ title: '✅ Datos de pago guardados', description: 'Los padres podrán ver esta info al recargar.' });
      fetchConfig();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error al guardar', description: error?.message });
    } finally {
      setSavingPayment(false);
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
      {/* ── Selector inline de sede (helper reutilizable dentro de cards) ── */}
      {/* Nota: el selector se renderiza dentro de cada Card que lo necesite */}

      {/* ⏱️ Configuración de Delay de Visibilidad */}
      <Card className="border-2 shadow-lg bg-white">
        <CardHeader className="bg-gradient-to-r from-amber-50 to-orange-50 border-b-2 p-4 sm:p-6">
          <CardTitle className="flex items-center gap-3 text-base sm:text-xl">
            <div className="p-2 bg-amber-600 rounded-lg shrink-0">
              <Clock className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
            </div>
            Delay de Visibilidad de Compras (Portal de Padres)
          </CardTitle>
          <CardDescription className="text-sm sm:text-base mt-2">
            Controla cuántos días deben pasar antes de que los padres vean las compras de sus hijos en el portal.
            Esta configuración <strong>NO afecta</strong> al módulo de cobranzas del admin (siempre en vivo).
          </CardDescription>
        </CardHeader>
        <CardContent className="p-3 sm:p-6 space-y-4">
          {/* Explicación */}
          <div className="bg-gradient-to-br from-blue-50 to-cyan-50 p-3 sm:p-4 rounded-lg border-2 border-blue-200">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-blue-500 rounded-lg shrink-0">
                <AlertTriangle className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900 mb-1 text-sm sm:text-base">¿Qué hace el Delay?</p>
                <ul className="text-xs sm:text-sm text-gray-700 space-y-1">
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
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 sm:p-4 bg-gray-50 rounded-lg border-2 hover:border-amber-300 transition-colors"
              >
                {/* Nombre de la sede */}
                <div className="flex items-center gap-3 flex-1">
                  <Building2 className="h-4 w-4 sm:h-5 sm:w-5 text-gray-400 shrink-0" />
                  <span className="font-semibold text-gray-900 text-sm sm:text-base">{school.school_name}</span>
                </div>

                {/* Controles: switch + selector — en mobile lado a lado */}
                <div className="flex items-center justify-between sm:justify-end gap-3">
                  {/* Switch ON/OFF */}
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`delay-switch-${school.school_id}`} className="text-xs sm:text-sm text-gray-600 cursor-pointer">
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
                    className={`w-[130px] sm:w-[140px] sm:ml-2 h-9 sm:h-10 rounded-md border border-input bg-background px-2 sm:px-3 py-1 sm:py-2 text-xs sm:text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${!school.enabled ? 'opacity-50' : ''}`}
                  >
                    <option value="0">0 días (EN VIVO)</option>
                    <option value="1">1 día</option>
                    <option value="2">2 días</option>
                    <option value="3">3 días</option>
                    <option value="4">4 días</option>
                    <option value="5">5 días</option>
                  </select>
                </div>
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
        <CardHeader className="bg-gradient-to-r from-blue-50 to-cyan-50 border-b-2 p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="flex-1">
              <CardTitle className="flex items-center gap-3 text-base sm:text-xl">
                <div className="p-2 bg-blue-600 rounded-lg shrink-0">
                  <MessageSquare className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                </div>
                Plantillas de Mensaje WhatsApp
              </CardTitle>
              <CardDescription className="text-sm sm:text-base mt-2">
                Configura mensajes distintos para almuerzos, cafetería o todo junto.
              </CardDescription>
            </div>
            {canViewAllSchools && schools.length > 1 && (
              <div className="flex items-center gap-2 shrink-0">
                <Building2 className="h-4 w-4 text-blue-500 shrink-0" />
                <select
                  value={selectedSchool}
                  onChange={(e) => setSelectedSchool(e.target.value)}
                  className="h-9 border-2 rounded-md bg-white px-2 py-1 text-xs sm:text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-3 sm:p-6">
          {/* Tabs de tipo de plantilla */}
          <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
            {([
              { key: 'all' as const, label: 'Todo', icon: MessageSquare, color: 'blue' },
              { key: 'lunch' as const, label: 'Almuerzos', icon: UtensilsCrossed, color: 'orange' },
              { key: 'cafeteria' as const, label: 'Cafetería', icon: Coffee, color: 'purple' },
            ]).map(({ key, label, icon: Icon, color }) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTemplateTab(key)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs sm:text-sm font-medium transition-all ${
                  activeTemplateTab === key
                    ? `bg-white shadow-sm text-${color}-700 ring-1 ring-${color}-200`
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          {activeTemplateTab !== 'all' && !getActiveTemplate().trim() && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
              Si esta plantilla está vacía, se usará la plantilla "Todo" como respaldo al copiar el mensaje.
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-base font-semibold">
              {activeTemplateTab === 'lunch' ? 'Mensaje de Almuerzos' : activeTemplateTab === 'cafeteria' ? 'Mensaje de Cafetería' : 'Mensaje General (Todo)'}
            </Label>
            <Textarea
              value={getActiveTemplate()}
              onChange={(e) => setActiveTemplate(e.target.value)}
              rows={10}
              className="font-mono text-sm border-2"
              placeholder={activeTemplateTab === 'all'
                ? 'Escribe la plantilla para cobranza general...'
                : `Escribe la plantilla para cobranza de ${activeTemplateTab === 'lunch' ? 'almuerzos' : 'cafetería'}... (dejar vacío para usar plantilla general)`}
            />
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-1">
              <p className="text-xs font-semibold text-blue-800">Variables disponibles:</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { var: '{nombre_padre}', desc: 'Padre' },
                  { var: '{nombre_estudiante}', desc: 'Alumno' },
                  { var: '{periodo}', desc: 'Período' },
                  { var: '{monto}', desc: 'Monto' },
                  { var: '{monto_almuerzo}', desc: 'Monto almuerzo' },
                  { var: '{monto_cafeteria}', desc: 'Monto cafetería' },
                  { var: '{numero_cuenta}', desc: 'Cuenta' },
                  { var: '{numero_cci}', desc: 'CCI' },
                  { var: '{numero_yape}', desc: 'Yape' },
                  { var: '{numero_plin}', desc: 'Plin' },
                ].map(({ var: v, desc }) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setActiveTemplate(getActiveTemplate() + v)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-blue-300 rounded text-xs font-mono text-blue-700 hover:bg-blue-100 transition-colors cursor-pointer"
                    title={`Insertar: ${desc}`}
                  >
                    <span>{v}</span>
                    <span className="text-gray-400 font-sans text-[10px]">{desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-gray-50 to-gray-100 p-4 rounded-xl border-2 border-dashed border-gray-300">
            <p className="text-sm font-semibold mb-2 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-blue-600" />
              Vista Previa:
            </p>
            <div className="bg-white p-3 rounded-lg border-2 border-gray-200 shadow-inner whitespace-pre-wrap text-sm max-h-60 overflow-y-auto">
              {getCompleteMessage()
                .replace(/\{nombre_padre\}/g, 'María García')
                .replace(/\{nombre_estudiante\}/g, 'Juan Pérez')
                .replace(/\{periodo\}/g, 'Semana 1-5 Enero')
                .replace(/\{monto\}/g, '45.50')
                .replace(/\{monto_almuerzo\}/g, '30.00')
                .replace(/\{monto_cafeteria\}/g, '15.50')
                .replace(/\{numero_cuenta\}/g, bankAccountNumber || '(sin configurar)')
                .replace(/\{numero_cci\}/g, bankCCI || '(sin configurar)')
                .replace(/\{numero_yape\}/g, yapeNumber || '(sin configurar)')
                .replace(/\{numero_plin\}/g, plinNumber || '(sin configurar)')}
            </div>
            {showPaymentInfo && (
              <p className="text-xs text-green-600 mt-2 flex items-center gap-1">
                <Check className="h-3 w-3" />
                La información de pago se agregará automáticamente al enviar
              </p>
            )}
          </div>

          <div className="flex justify-end pt-2">
            <Button
              onClick={handleSaveMessage}
              disabled={savingMessage || !selectedSchool}
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 gap-2"
            >
              {savingMessage ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Guardando...</>
              ) : (
                <><Save className="h-4 w-4" /> Guardar las 3 plantillas</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Información de Pago */}
      <Card className="border-2 shadow-lg bg-white">
        <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b-2 p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1">
                <CardTitle className="flex items-center gap-3 text-base sm:text-xl">
                  <div className="p-2 bg-green-600 rounded-lg shrink-0">
                    <CreditCard className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                  </div>
                  Información de Pago
                </CardTitle>
                {/* Habilitado switch */}
                <div className="flex items-center gap-2 ml-auto sm:ml-0">
                  <Label htmlFor="show_payment_info" className="text-xs sm:text-sm font-semibold cursor-pointer whitespace-nowrap">
                    {showPaymentInfo ? 'Visible al padre' : 'Oculto'}
                  </Label>
                  <Switch
                    id="show_payment_info"
                    checked={showPaymentInfo}
                    onCheckedChange={setShowPaymentInfo}
                  />
                </div>
              </div>
              <CardDescription className="text-xs sm:text-sm mt-1">
                Los padres verán estos datos al recargar saldo. Pueden <strong>copiar</strong> cada campo desde su celular.
              </CardDescription>
            </div>
            {/* ── Selector de sede inline ── */}
            {canViewAllSchools && schools.length > 1 && (
              <div className="flex items-center gap-2 shrink-0">
                <Building2 className="h-4 w-4 text-green-600 shrink-0" />
                <select
                  value={selectedSchool}
                  onChange={(e) => setSelectedSchool(e.target.value)}
                  className="h-9 border-2 rounded-md bg-white px-2 py-1 text-xs sm:text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-5 p-3 sm:p-6">

          {/* ── Yape ── */}
          <div className={`border-2 rounded-xl p-4 space-y-3 transition-all ${yapeEnabled ? 'bg-purple-50 border-purple-200' : 'bg-gray-50 border-gray-200 opacity-60'}`}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-purple-700 flex items-center gap-2">💜 Yape</p>
              <div className="flex items-center gap-2">
                <Label htmlFor="yape_enabled" className="text-xs text-gray-600 cursor-pointer">
                  {yapeEnabled ? 'Activo' : 'Inactivo'}
                </Label>
                <Switch
                  id="yape_enabled"
                  checked={yapeEnabled}
                  onCheckedChange={setYapeEnabled}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="yape_number" className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Número de teléfono</Label>
                <Input
                  id="yape_number"
                  placeholder="987 654 321"
                  value={yapeNumber}
                  onChange={(e) => setYapeNumber(e.target.value)}
                  className="h-10 border-2 font-mono"
                  disabled={!yapeEnabled}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="yape_holder" className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Nombre del titular</Label>
                <Input
                  id="yape_holder"
                  placeholder="Ej: UFRASAC CATERING S.A.C"
                  value={yapeHolder}
                  onChange={(e) => setYapeHolder(e.target.value)}
                  className="h-10 border-2"
                  disabled={!yapeEnabled}
                />
              </div>
            </div>
          </div>

          {/* ── Plin ── */}
          <div className={`border-2 rounded-xl p-4 space-y-3 transition-all ${plinEnabled ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200 opacity-60'}`}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-green-700 flex items-center gap-2">💚 Plin</p>
              <div className="flex items-center gap-2">
                <Label htmlFor="plin_enabled" className="text-xs text-gray-600 cursor-pointer">
                  {plinEnabled ? 'Activo' : 'Inactivo'}
                </Label>
                <Switch
                  id="plin_enabled"
                  checked={plinEnabled}
                  onCheckedChange={setPlinEnabled}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="plin_number" className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Número de teléfono</Label>
                <Input
                  id="plin_number"
                  placeholder="987 654 321"
                  value={plinNumber}
                  onChange={(e) => setPlinNumber(e.target.value)}
                  className="h-10 border-2 font-mono"
                  disabled={!plinEnabled}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="plin_holder" className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Nombre del titular</Label>
                <Input
                  id="plin_holder"
                  placeholder="Ej: UFRASAC CATERING S.A.C"
                  value={plinHolder}
                  onChange={(e) => setPlinHolder(e.target.value)}
                  className="h-10 border-2"
                  disabled={!plinEnabled}
                />
              </div>
            </div>
          </div>

          {/* ── Transferencia Bancaria ── */}
          <div className={`border-2 rounded-xl p-4 space-y-3 transition-all ${transferenciaEnabled ? 'bg-orange-50 border-orange-200' : 'bg-gray-50 border-gray-200 opacity-60'}`}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-orange-700 flex items-center gap-2">🏦 Transferencia Bancaria</p>
              <div className="flex items-center gap-2">
                <Label htmlFor="transferencia_enabled" className="text-xs text-gray-600 cursor-pointer">
                  {transferenciaEnabled ? 'Activo' : 'Inactivo'}
                </Label>
                <Switch
                  id="transferencia_enabled"
                  checked={transferenciaEnabled}
                  onCheckedChange={setTransferenciaEnabled}
                />
              </div>
            </div>
            <div className="space-y-3">
              {/* Banco */}
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Banco</Label>
                <select
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  disabled={!transferenciaEnabled}
                  className="w-full h-10 rounded-md border-2 border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  <option value="">— Seleccionar banco —</option>
                  {PERUVIAN_BANKS.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
              {/* Titular */}
              <div className="space-y-1">
                <Label htmlFor="bank_holder" className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Nombre del titular / razón social</Label>
                <Input
                  id="bank_holder"
                  placeholder="Ej: UFRASAC CATERING S.A.C"
                  value={bankHolder}
                  onChange={(e) => setBankHolder(e.target.value)}
                  className="h-10 border-2"
                  disabled={!transferenciaEnabled}
                />
              </div>
              {/* Cuenta Corriente */}
              <div className="space-y-1">
                <Label htmlFor="bank_account_number" className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Cuenta Corriente</Label>
                <Input
                  id="bank_account_number"
                  placeholder="Ej: 123-456789-0-12"
                  value={bankAccountNumber}
                  onChange={(e) => setBankAccountNumber(e.target.value)}
                  className="h-10 border-2 font-mono"
                  disabled={!transferenciaEnabled}
                />
              </div>
              {/* CCI */}
              <div className="space-y-1">
                <Label htmlFor="bank_cci" className="text-xs font-semibold text-gray-600 uppercase tracking-wide">CCI (Código de Cuenta Interbancario)</Label>
                <Input
                  id="bank_cci"
                  placeholder="Ej: 00212345678901234"
                  value={bankCCI}
                  onChange={(e) => setBankCCI(e.target.value)}
                  className="h-10 border-2 font-mono"
                  disabled={!transferenciaEnabled}
                />
              </div>
              <p className="text-xs text-gray-400">📱 Los padres solo podrán copiar los números de cuenta y CCI.</p>
            </div>
          </div>

          {/* ── Botón Guardar Pago ── */}
          <div className="flex justify-end pt-1">
            <Button
              onClick={handleSavePayment}
              disabled={savingPayment || !selectedSchool}
              className="w-full sm:w-auto bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 gap-2 h-11 px-6 shadow-md"
            >
              {savingPayment ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Guardando...</>
              ) : (
                <><Save className="h-4 w-4" /> Guardar datos de pago</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ===== SECCIÓN NUBEFACT ===== */}
      <hr className="border-gray-200" />
      <BillingNubefactConfig />
    </div>
  );
};
