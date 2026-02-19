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
import { Loader2, Save, CheckCircle2, AlertCircle, Building2, FileText, Key } from 'lucide-react';

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
  const [selectedSchool, setSelectedSchool] = useState('');
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

  useEffect(() => {
    fetchSchools();
  }, []);

  useEffect(() => {
    if (selectedSchool) fetchConfig(selectedSchool);
  }, [selectedSchool]);

  const fetchSchools = async () => {
    setLoading(true);
    try {
      if (canViewAll) {
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

  const handleSave = async () => {
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
      const res = await fetch(config.nubefact_ruta, {
        method: 'GET',
        headers: { 'Authorization': `Token ${config.nubefact_token}` },
      });
      if (res.ok || res.status === 405) {
        toast({ title: '✅ Conexión exitosa', description: 'Las credenciales de Nubefact son válidas.' });
      } else {
        toast({ title: '❌ Error de conexión', description: `Código: ${res.status}. Verifica RUTA y TOKEN.`, variant: 'destructive' });
      }
    } catch {
      toast({ title: '❌ No se pudo conectar', description: 'Verifica que la RUTA sea correcta.', variant: 'destructive' });
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
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
            <p className="font-semibold mb-1">¿Dónde encuentro estos datos?</p>
            <p>Entra a <strong>nubefact.com → API - Integración</strong> y copia la <strong>RUTA</strong> y el <strong>TOKEN</strong> de tu local.</p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="ruta" className="text-sm font-medium">RUTA (URL de API) *</Label>
            <Input
              id="ruta"
              placeholder="https://api.nubefact.com/api/v1/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={config.nubefact_ruta}
              onChange={(e) => setConfig({ ...config, nubefact_ruta: e.target.value })}
            />
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
