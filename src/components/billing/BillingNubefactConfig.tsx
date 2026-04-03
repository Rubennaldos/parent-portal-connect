import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Save, CheckCircle2, AlertCircle, Building2, FileText, Key, FlaskConical, Receipt, XCircle, ExternalLink, TestTube2, ToggleLeft, ToggleRight, Clock, Zap } from 'lucide-react';

interface TestResult {
  tipo: string;
  estado: 'ok' | 'error' | 'loading';
  mensaje: string;
  pdf?: string | null;
  xml?: string | null;
  serie?: string;
  numero?: number;
}

interface BillingConfig {
  id?: string;
  school_id: string;
  nubefact_ruta: string;
  nubefact_token: string;
  ruc: string;
  razon_social: string;
  direccion: string;
  igv_porcentaje: number;
  serie_boleta: string;
  serie_factura: string;
  serie_nc_boleta: string;
  serie_nc_factura: string;
  activo: boolean;
}

interface School { id: string; name: string; }

export const BillingNubefactConfig = () => {
  const { user } = useAuth();
  const { role } = useRole();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [schools, setSchools] = useState<School[]>([]);
  const [demoMode, setDemoMode] = useState(false);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [lastBoleta, setLastBoleta] = useState<{ serie: string; numero: number } | null>(null);
  const [lastFactura, setLastFactura] = useState<{ serie: string; numero: number } | null>(null);
  const [selectedSchool, setSelectedSchool] = useState('');
  const [autoBilling, setAutoBilling] = useState(false);
  const [savingAuto, setSavingAuto] = useState(false);
  const [lastCronLog, setLastCronLog] = useState<{ executed_at: string; status: string; groups_processed: number; total_amount: number } | null>(null);
  const [config, setConfig] = useState<BillingConfig>({
    school_id: '',
    nubefact_ruta: '',
    nubefact_token: '',
    ruc: '',
    razon_social: '',
    direccion: '',
    igv_porcentaje: 18,
    serie_boleta: 'B001',
    serie_factura: 'F001',
    serie_nc_boleta: 'BC01',
    serie_nc_factura: 'FC01',
    activo: true,
  });

  const canViewAll = role === 'admin_general';

  // Re-ejecutar fetchSchools cuando el rol ya esté cargado (evita race condition)
  useEffect(() => {
    if (role) fetchSchools();
  }, [role]);

  useEffect(() => {
    if (selectedSchool) fetchConfig(selectedSchool);
  }, [selectedSchool]);

  const fetchSchools = async () => {
    setLoading(true);
    try {
      if (role === 'admin_general') {
        const { data } = await supabase.from('schools').select('id, name').order('name');
        setSchools(data || []);
        if (data && data.length > 0) setSelectedSchool(data[0].id);
      } else {
        const { data: profile } = await supabase
          .from('profiles').select('school_id, schools(id, name)').eq('id', user!.id).single();
        const school = (profile as any)?.schools;
        if (school) {
          setSchools([school]);
          setSelectedSchool(school.id);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchConfig = async (schoolId: string) => {
    const { data } = await supabase
      .from('billing_config')
      .select('*')
      .eq('school_id', schoolId)
      .single();

    if (data) {
      setConfig(data);
      setAutoBilling(data.auto_billing_enabled ?? false);
      // Cargar último log del cron
      supabase
        .from('auto_billing_logs')
        .select('executed_at, status, groups_processed, total_amount')
        .eq('school_id', schoolId)
        .order('executed_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data: log }) => setLastCronLog(log ?? null));
    } else {
      setConfig({
        school_id: schoolId,
        nubefact_ruta: '',
        nubefact_token: '',
        ruc: '',
        razon_social: '',
        direccion: '',
        igv_porcentaje: 18,
        serie_boleta: 'B001',
        serie_factura: 'F001',
        serie_nc_boleta: 'BC01',
        serie_nc_factura: 'FC01',
        activo: true,
      });
    }
  };

  const handleTestDocument = async (tipo: 1 | 2 | 7) => {
    if (!selectedSchool) {
      toast({ title: 'Sin sede', description: 'Guarda la configuración primero.', variant: 'destructive' });
      return;
    }

    const labels: Record<number, string> = { 2: 'Boleta', 1: 'Factura', 7: 'Nota de Crédito' };
    const label = labels[tipo];

    // Para NC necesitamos una boleta o factura previa
    if (tipo === 7 && !lastBoleta && !lastFactura) {
      toast({ title: 'Genera primero una Boleta o Factura', description: 'La Nota de Crédito necesita un documento de referencia.', variant: 'destructive' });
      return;
    }

    setTestResults(prev => [
      { tipo: label, estado: 'loading', mensaje: 'Generando...' },
      ...prev.filter(r => r.tipo !== label),
    ]);

    try {
      const body: any = {
        school_id: selectedSchool,
        tipo,
        demo_mode: true,   // El panel de pruebas SIEMPRE es demo — nunca va a SUNAT real
        monto_total: tipo === 1 ? 118.00 : 50.00,
        cliente: tipo === 1
          ? { nombre: 'EMPRESA DE PRUEBA S.A.C.', tipo_doc: 6, numero_doc: '20100130492' }
          : { nombre: 'Cliente de Prueba', tipo_doc: 0 },
      };

      // Nota de crédito referencia la última boleta o factura
      if (tipo === 7) {
        const ref = lastBoleta || lastFactura!;
        const tipoRef = lastBoleta ? 2 : 1;
        body.doc_ref = { tipo: tipoRef, serie: ref.serie, numero: ref.numero };
        body.monto_total = 50.00;
      }

      const { data, error } = await supabase.functions.invoke('generate-document', { body });

      if (error) throw new Error(`Edge Function: ${error.message}`);
      if (data?.error) throw new Error(`Nubefact/BD: ${data.error}`);

      const doc = data?.documento;
      const nf  = data?.nubefact;
      const ok  = nf?.aceptada_por_sunat || !!nf?.enlace_del_pdf;

      // Guardar referencia para nota de crédito
      if (tipo === 2 && doc) setLastBoleta({ serie: doc.serie, numero: doc.numero });
      if (tipo === 1 && doc) setLastFactura({ serie: doc.serie, numero: doc.numero });

      setTestResults(prev => [
        {
          tipo: label,
          estado: ok ? 'ok' : 'error',
          mensaje: ok
            ? `${doc?.serie}-${String(doc?.numero).padStart(8,'0')} — ${nf?.aceptada_por_sunat ? '✅ Aceptada por SUNAT' : '⚠️ Generada (modo demo)'}`
            : (nf?.errors || 'Respuesta inesperada de Nubefact'),
          pdf: nf?.enlace_del_pdf || doc?.enlace_pdf,
          xml: nf?.enlace_del_xml || doc?.enlace_xml,
          serie: doc?.serie,
          numero: doc?.numero,
        },
        ...prev.filter(r => r.tipo !== label),
      ]);

    } catch (err: any) {
      setTestResults(prev => [
        { tipo: label, estado: 'error', mensaje: err.message || 'Error desconocido' },
        ...prev.filter(r => r.tipo !== label),
      ]);
    }
  };

  const handleSave = async () => {
    if (!selectedSchool) {
      toast({ title: 'Sin sede seleccionada', description: 'Selecciona una sede antes de guardar.', variant: 'destructive' });
      return;
    }
    if (!config.nubefact_ruta || !config.nubefact_token || !config.ruc || !config.razon_social) {
      toast({ title: 'Faltan datos', description: 'Completa RUTA, TOKEN, RUC y Razón Social.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const payload = { ...config, school_id: selectedSchool };

      if (config.id) {
        const { error } = await supabase.from('billing_config').update(payload).eq('id', config.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('billing_config').insert(payload);
        if (error) throw error;
      }

      toast({ title: '✅ Configuración guardada', description: 'Nubefact configurado correctamente.' });
      await fetchConfig(selectedSchool);
    } catch (err: any) {
      toast({ title: 'Error al guardar', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!config.nubefact_ruta || !config.nubefact_token) {
      toast({ title: 'Faltan credenciales', description: 'Ingresa RUTA y TOKEN primero.', variant: 'destructive' });
      return;
    }
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-document', {
        body: {
          test: true,
          school_id: selectedSchool || null,
          nubefact_ruta: config.nubefact_ruta,
          nubefact_token: config.nubefact_token,
        },
      });

      // Leer error del cuerpo aunque haya error de red
      const result = data || {};
      const errMsg = error?.message || result?.error;

      if (!errMsg && result?.ok) {
        toast({ title: '✅ Conexión exitosa', description: `Nubefact respondió OK (HTTP ${result.status ?? 200}).` });
      } else {
        toast({
          title: '❌ Error de conexión',
          description: errMsg || `HTTP ${result?.status}. Verifica RUTA y TOKEN en Nubefact.`,
          variant: 'destructive',
        });
      }
    } catch (err: any) {
      toast({
        title: '❌ No se pudo conectar',
        description: err?.message || 'Error inesperado.',
        variant: 'destructive',
      });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-red-600" />
      </div>
    );
  }

  const configCompleta = config.nubefact_ruta && config.nubefact_token && config.ruc && config.razon_social;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="h-5 w-5 text-red-600" />
            Facturación Electrónica — Nubefact
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Configura las credenciales de Nubefact para emitir boletas y facturas electrónicas a SUNAT.
          </p>
        </div>
        {configCompleta ? (
          <Badge className="bg-green-600 gap-1"><CheckCircle2 className="h-3 w-3" />Configurado</Badge>
        ) : (
          <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" />Sin configurar</Badge>
        )}
      </div>

      {/* Selector de sede */}
      {canViewAll && schools.length > 1 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Building2 className="h-4 w-4 text-gray-500" />
              <Label className="text-sm font-medium">Sede:</Label>
              <select
                value={selectedSchool}
                onChange={(e) => setSelectedSchool(e.target.value)}
                className="flex-1 h-9 rounded-md border border-input bg-white px-3 text-sm"
              >
                {schools.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Credenciales Nubefact */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-wide">
            <Key className="h-4 w-4 text-red-600" />
            Credenciales de API
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Banner modo demo */}
          {demoMode && (
            <div className="bg-yellow-50 border-2 border-yellow-400 rounded-lg p-3 flex items-center gap-2">
              <FlaskConical className="h-5 w-5 text-yellow-600 shrink-0" />
              <div>
                <p className="text-sm font-bold text-yellow-800">🧪 MODO DEMO ACTIVO</p>
                <p className="text-xs text-yellow-700">
                  Los comprobantes se generan en Nubefact pero <strong>NO se envían a SUNAT</strong>. Ideal para pruebas.
                </p>
              </div>
            </div>
          )}

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
            <p className="font-semibold mb-1">¿Dónde encuentro estos datos?</p>
            <p>Entra a <strong>nubefact.com → API - Integración</strong> y copia la <strong>RUTA</strong> y el <strong>TOKEN</strong> de tu local.</p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="ruta" className="text-sm font-medium">RUTA (URL de API) *</Label>
              <button
                type="button"
                onClick={() => setDemoMode(d => !d)}
                className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full border font-medium transition-colors ${
                  demoMode
                    ? 'bg-yellow-100 border-yellow-400 text-yellow-700 hover:bg-yellow-200'
                    : 'bg-gray-100 border-gray-300 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {demoMode ? <ToggleRight className="h-3 w-3" /> : <ToggleLeft className="h-3 w-3" />}
                {demoMode ? 'DEMO activo — click para PRODUCCIÓN' : 'Activar DEMO (pruebas)'}
              </button>
            </div>
            <Input
              id="ruta"
              placeholder="https://api.nubefact.com/api/v1/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={config.nubefact_ruta}
              onChange={(e) => setConfig({ ...config, nubefact_ruta: e.target.value })}
            />
            {demoMode && (
              <p className="text-xs text-yellow-600 flex items-center gap-1">
                <FlaskConical className="h-3 w-3" />
                Modo demo: se usa la misma URL pero sin enviar a SUNAT
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="token" className="text-sm font-medium">TOKEN *</Label>
            <Input
              id="token"
              type="password"
              placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              value={config.nubefact_token}
              onChange={(e) => setConfig({ ...config, nubefact_token: e.target.value })}
            />
          </div>

          <Button variant="outline" size="sm" onClick={handleTest} disabled={testing} className="gap-2">
            {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
            Probar conexión
          </Button>
        </CardContent>
      </Card>

      {/* Datos fiscales */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-wide">
            <Building2 className="h-4 w-4 text-gray-600" />
            Datos Fiscales de la Empresa
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-sm font-medium">RUC *</Label>
              <Input
                placeholder="20xxxxxxxxx"
                maxLength={11}
                value={config.ruc}
                onChange={(e) => setConfig({ ...config, ruc: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-sm font-medium">% IGV *</Label>
              <select
                value={config.igv_porcentaje}
                onChange={(e) => setConfig({ ...config, igv_porcentaje: Number(e.target.value) })}
                className="w-full h-10 rounded-md border border-input bg-white px-3 text-sm"
              >
                <option value={18}>18% — Régimen General</option>
                <option value={10.5}>10.5% — MYPE Restaurante (Ley 32219)</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-sm font-medium">Razón Social *</Label>
            <Input
              placeholder="EMPRESA SAC"
              value={config.razon_social}
              onChange={(e) => setConfig({ ...config, razon_social: e.target.value })}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-sm font-medium">Dirección Fiscal</Label>
            <Input
              placeholder="Av. Ejemplo 123, Lima"
              value={config.direccion}
              onChange={(e) => setConfig({ ...config, direccion: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Series de comprobantes */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-wide">
            <FileText className="h-4 w-4 text-gray-600" />
            Series de Comprobantes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Boletas', key: 'serie_boleta', hint: 'B001' },
              { label: 'Facturas', key: 'serie_factura', hint: 'F001' },
              { label: 'N.C. Boleta', key: 'serie_nc_boleta', hint: 'BC01' },
              { label: 'N.C. Factura', key: 'serie_nc_factura', hint: 'FC01' },
            ].map((s) => (
              <div key={s.key} className="space-y-1">
                <Label className="text-xs font-medium text-gray-600">{s.label}</Label>
                <Input
                  placeholder={s.hint}
                  value={(config as any)[s.key]}
                  onChange={(e) => setConfig({ ...config, [s.key]: e.target.value })}
                  className="text-center font-mono"
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Estas series deben coincidir con las que configuraste en Nubefact.
          </p>
        </CardContent>
      </Card>

      {/* Auto-billing toggle */}
      {config.id && (
        <Card className="border-2 border-indigo-200 bg-indigo-50/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-wide text-indigo-800">
              <Clock className="h-4 w-4" />
              Facturacion Automatica — Cron 10 PM
            </CardTitle>
            <p className="text-xs text-indigo-700">
              Genera boletas resumen automaticamente cada noche a las 10:00 PM (hora Lima) para todos los pagos digitales pendientes del dia.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg border bg-white">
              <div>
                <p className="text-sm font-semibold text-gray-800">Facturacion automatica</p>
                <p className="text-xs text-gray-500">
                  {autoBilling ? 'Activa — los pagos digitales se boletean cada noche' : 'Desactivada — usa el Cierre Mensual manual'}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={savingAuto}
                onClick={async () => {
                  setSavingAuto(true);
                  const newVal = !autoBilling;
                  const { error } = await supabase
                    .from('billing_config')
                    .update({ auto_billing_enabled: newVal })
                    .eq('school_id', selectedSchool);
                  if (!error) {
                    setAutoBilling(newVal);
                    toast({
                      title: newVal ? 'Cron activado' : 'Cron desactivado',
                      description: newVal
                        ? 'Las boletas resumen se generaran automaticamente cada noche.'
                        : 'Debes usar el Cierre Mensual manualmente.',
                    });
                  } else {
                    toast({ title: 'Error', description: error.message, variant: 'destructive' });
                  }
                  setSavingAuto(false);
                }}
                className="gap-2"
              >
                {savingAuto ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : autoBilling ? (
                  <ToggleRight className="h-8 w-8 text-indigo-600" />
                ) : (
                  <ToggleLeft className="h-8 w-8 text-gray-400" />
                )}
              </Button>
            </div>

            {lastCronLog && (
              <div className="p-3 rounded-lg border bg-white text-xs space-y-1">
                <p className="font-semibold text-gray-600">Ultima ejecucion:</p>
                <div className="flex items-center gap-3">
                  <Badge className={
                    lastCronLog.status === 'success' ? 'bg-green-100 text-green-800' :
                    lastCronLog.status === 'partial' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-red-100 text-red-800'
                  }>
                    {lastCronLog.status === 'success' ? 'Exitoso' : lastCronLog.status === 'partial' ? 'Parcial' : 'Error'}
                  </Badge>
                  <span className="text-gray-500">
                    {new Date(lastCronLog.executed_at).toLocaleString('es-PE', { timeZone: 'America/Lima' })}
                  </span>
                  <span className="text-gray-700 font-medium">
                    {lastCronLog.groups_processed} grupos — S/ {Number(lastCronLog.total_amount).toFixed(2)}
                  </span>
                </div>
              </div>
            )}

            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
              <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-800">
                El cron requiere que pg_cron y pg_net esten habilitados en Supabase (Database &gt; Extensions). 
                Si no estan activos, el toggle no tendra efecto.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Panel de pruebas */}
      {config.id && (
        <Card className="border-2 border-dashed border-yellow-300 bg-yellow-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-wide text-yellow-800">
              <TestTube2 className="h-4 w-4" />
              Panel de Pruebas — Comprobantes
              {demoMode && <Badge className="bg-yellow-500 text-white text-xs">MODO DEMO</Badge>}
            </CardTitle>
            <p className="text-xs text-yellow-700">
              Genera comprobantes de prueba para verificar que la integración funciona.
              {demoMode ? ' En modo demo no se reporta nada a SUNAT.' : ' ⚠️ En modo PRODUCCIÓN estos documentos se enviarán a SUNAT.'}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Botones de prueba */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Button
                variant="outline"
                onClick={() => handleTestDocument(2)}
                className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-50"
              >
                <Receipt className="h-4 w-4" />
                Probar Boleta
              </Button>
              <Button
                variant="outline"
                onClick={() => handleTestDocument(1)}
                className="gap-2 border-green-300 text-green-700 hover:bg-green-50"
              >
                <FileText className="h-4 w-4" />
                Probar Factura
              </Button>
              <Button
                variant="outline"
                onClick={() => handleTestDocument(7)}
                disabled={!lastBoleta && !lastFactura}
                className="gap-2 border-orange-300 text-orange-700 hover:bg-orange-50 disabled:opacity-40"
                title={!lastBoleta && !lastFactura ? 'Genera primero una boleta o factura' : ''}
              >
                <XCircle className="h-4 w-4" />
                Probar Nota Crédito
              </Button>
            </div>

            {/* Referencia para nota de crédito */}
            {(lastBoleta || lastFactura) && (
              <p className="text-xs text-gray-500">
                📎 Referencia disponible para N.C.:{' '}
                {lastBoleta && <span className="font-mono bg-white px-1 rounded border">{lastBoleta.serie}-{String(lastBoleta.numero).padStart(8,'0')}</span>}
                {lastFactura && <span className="font-mono bg-white px-1 rounded border ml-1">{lastFactura.serie}-{String(lastFactura.numero).padStart(8,'0')}</span>}
              </p>
            )}

            {/* Resultados */}
            {testResults.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-600 uppercase">Resultados:</p>
                {testResults.map((r, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-3 p-3 rounded-lg border text-sm ${
                      r.estado === 'loading' ? 'bg-white border-gray-200' :
                      r.estado === 'ok'      ? 'bg-green-50 border-green-200' :
                                               'bg-red-50 border-red-200'
                    }`}
                  >
                    {r.estado === 'loading' && <Loader2 className="h-4 w-4 animate-spin text-gray-400 mt-0.5 shrink-0" />}
                    {r.estado === 'ok'      && <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />}
                    {r.estado === 'error'   && <AlertCircle  className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold">{r.tipo}</p>
                      <p className={`text-xs mt-0.5 ${r.estado === 'error' ? 'text-red-700' : 'text-gray-600'}`}>
                        {r.mensaje}
                      </p>
                      {(r.pdf || r.xml) && (
                        <div className="flex gap-3 mt-2">
                          {r.pdf && (
                            <a href={r.pdf} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                              <ExternalLink className="h-3 w-3" /> Ver PDF
                            </a>
                          )}
                          {r.xml && (
                            <a href={r.xml} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                              <ExternalLink className="h-3 w-3" /> Ver XML
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Botón guardar */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="bg-red-600 hover:bg-red-700 gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Guardar Configuración
        </Button>
      </div>
    </div>
  );
};
