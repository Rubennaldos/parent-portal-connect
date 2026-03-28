import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ArrowLeft,
  ShieldCheck,
  AlertTriangle,
  XCircle,
  Activity,
  Search,
  RefreshCw,
  FileSearch,
  MousePointerClick,
  Hash,
  Image,
  Calendar,
  Building2,
  Loader2,
  CheckCircle2,
  Clock,
  Sparkles,
  Upload,
  Link,
  X,
  ZoomIn,
  ExternalLink,
  Info,
} from 'lucide-react';
import {
  procesarVoucherConIA,
  type ResultadoAuditoria,
} from '@/services/auditService';
import { ChatAuditoria } from '@/components/audit/ChatAuditoria';

// ──────────────────────────────────────────────────────────
// Tipos
// ──────────────────────────────────────────────────────────

type EstadoIA = 'VALIDO' | 'SOSPECHOSO' | 'RECHAZADO';

interface AuditoriaVoucher {
  id: string;
  id_cobranza: string | null;
  url_imagen: string;
  banco_detectado: string | null;
  monto_detectado: number | null;
  nro_operacion: string | null;
  fecha_pago_detectada: string | null;
  hash_imagen: string | null;
  estado_ia: EstadoIA;
  analisis_ia: Record<string, any> | null;
  school_id: string | null;
  creado_at: string;
}

interface HuellaLog {
  id: string;
  usuario_id: string | null;
  accion: string;
  modulo: string;
  detalles_tecnicos: Record<string, any> | null;
  contexto: Record<string, any> | null;
  school_id: string | null;
  creado_at: string;
}

interface Stats {
  total: number;
  validos: number;
  sospechosos: number;
  rechazados: number;
  logs_hoy: number;
}

// ──────────────────────────────────────────────────────────
// Helpers de UI
// ──────────────────────────────────────────────────────────

const ESTADO_CONFIG: Record<EstadoIA, { label: string; icon: React.ElementType; className: string }> = {
  VALIDO: {
    label: 'Válido',
    icon: CheckCircle2,
    className: 'bg-green-100 text-green-800 border-green-200',
  },
  SOSPECHOSO: {
    label: 'Sospechoso',
    icon: AlertTriangle,
    className: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  },
  RECHAZADO: {
    label: 'Rechazado',
    icon: XCircle,
    className: 'bg-red-100 text-red-800 border-red-200',
  },
};

function EstadoBadge({ estado }: { estado: EstadoIA }) {
  const cfg = ESTADO_CONFIG[estado];
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${cfg.className}`}
    >
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function truncate(str: string | null | undefined, len = 24) {
  if (!str) return '—';
  return str.length > len ? str.slice(0, len) + '…' : str;
}

// ──────────────────────────────────────────────────────────
// Componente principal
// ──────────────────────────────────────────────────────────

type Tab = 'vouchers' | 'logs';

const Auditoria = () => {
  const { user } = useAuth();
  const { role } = useRole();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [tab, setTab] = useState<Tab>('vouchers');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats>({ total: 0, validos: 0, sospechosos: 0, rechazados: 0, logs_hoy: 0 });

  // Panel de análisis manual
  const [urlPrueba, setUrlPrueba] = useState('');
  const [analizando, setAnalizando] = useState(false);
  const [ultimoResultado, setUltimoResultado] = useState<ResultadoAuditoria | null>(null);

  // Vouchers
  const [vouchers, setVouchers] = useState<AuditoriaVoucher[]>([]);
  const [filtroEstado, setFiltroEstado] = useState<string>('todos');
  const [filtroBusqueda, setFiltroBusqueda] = useState('');
  // Visor de imagen in-page
  const [imagenAbierta, setImagenAbierta] = useState<string | null>(null);
  // Panel de detalle de voucher
  const [voucherDetalle, setVoucherDetalle] = useState<AuditoriaVoucher | null>(null);
  // Aprobación override desde Auditoría
  const [aprobandoId, setAprobandoId] = useState<string | null>(null);

  // Logs
  const [logs, setLogs] = useState<HuellaLog[]>([]);
  const [filtroAccion, setFiltroAccion] = useState<string>('todos');
  const [filtroModulo, setFiltroModulo] = useState<string>('todos');

  // Guardia de rol: solo admin_general puede entrar
  useEffect(() => {
    if (role && role !== 'admin_general' && role !== 'superadmin') {
      toast({
        variant: 'destructive',
        title: 'Acceso denegado',
        description: 'Solo los administradores generales pueden acceder al módulo de Auditoría.',
      });
      navigate('/dashboard');
    }
  }, [role]);

  useEffect(() => {
    if (user && (role === 'admin_general' || role === 'superadmin')) {
      fetchAll();
    }
  }, [user, role]);

  const fetchAll = async () => {
    setLoading(true);
    await Promise.all([fetchVouchers(), fetchLogs(), fetchStats()]);
    setLoading(false);
  };

  const fetchStats = async () => {
    try {
      const { data: v } = await supabase
        .from('auditoria_vouchers')
        .select('estado_ia');

      if (v) {
        const total = v.length;
        const validos = v.filter(x => x.estado_ia === 'VALIDO').length;
        const sospechosos = v.filter(x => x.estado_ia === 'SOSPECHOSO').length;
        const rechazados = v.filter(x => x.estado_ia === 'RECHAZADO').length;

        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        const { count } = await supabase
          .from('huella_digital_logs')
          .select('*', { count: 'exact', head: true })
          .gte('creado_at', hoy.toISOString());

        setStats({ total, validos, sospechosos, rechazados, logs_hoy: count ?? 0 });
      }
    } catch (err) {
      console.error('Error cargando stats de auditoría:', err);
    }
  };

  const fetchVouchers = async () => {
    try {
      let query = supabase
        .from('auditoria_vouchers')
        .select('*')
        .order('creado_at', { ascending: false })
        .limit(200);

      if (filtroEstado !== 'todos') {
        query = query.eq('estado_ia', filtroEstado);
      }

      const { data, error } = await query;
      if (error) throw error;
      setVouchers(data ?? []);
    } catch (err: any) {
      console.error('Error cargando vouchers:', err);
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    }
  };

  const handleAnalizarVoucher = async () => {
    if (!urlPrueba.trim()) {
      toast({ variant: 'destructive', title: 'Falta la URL', description: 'Pega la URL de un comprobante para analizarlo.' });
      return;
    }
    setAnalizando(true);
    setUltimoResultado(null);
    try {
      const resultado = await procesarVoucherConIA(urlPrueba.trim(), {
        usuarioId: user?.id,
        autoAprobarSiValido: false,
      });
      setUltimoResultado(resultado);
      if (resultado.ok) {
        toast({
          title: resultado.estado_ia === 'VALIDO' ? '✅ Voucher válido' : resultado.estado_ia === 'SOSPECHOSO' ? '⚠️ Voucher sospechoso' : '❌ Voucher rechazado',
          description: `Banco: ${resultado.banco_detectado ?? '?'} | Monto: ${resultado.monto_detectado != null ? `S/ ${resultado.monto_detectado.toFixed(2)}` : '?'}`,
        });
        await fetchAll();
      } else {
        toast({ variant: 'destructive', title: resultado.es_duplicado ? '🚨 Duplicado detectado' : 'Error', description: resultado.error });
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error inesperado', description: err.message });
    } finally {
      setAnalizando(false);
    }
  };

  const fetchLogs = async () => {
    try {
      let query = supabase
        .from('huella_digital_logs')
        .select('*')
        .order('creado_at', { ascending: false })
        .limit(200);

      if (filtroAccion !== 'todos') query = query.eq('accion', filtroAccion);
      if (filtroModulo !== 'todos') query = query.eq('modulo', filtroModulo);

      const { data, error } = await query;
      if (error) throw error;
      setLogs(data ?? []);
    } catch (err: any) {
      console.error('Error cargando logs:', err);
    }
  };

  // Filtro local por búsqueda de texto en vouchers
  const vouchersFiltrados = vouchers.filter(v => {
    if (!filtroBusqueda) return true;
    const q = filtroBusqueda.toLowerCase();
    return (
      v.nro_operacion?.toLowerCase().includes(q) ||
      v.banco_detectado?.toLowerCase().includes(q) ||
      v.hash_imagen?.toLowerCase().includes(q)
    );
  });

  // ──────────────────────────────────────────────────────────
  // Aprobación override — desde Auditoría, sin pasar por Cobranzas
  // ──────────────────────────────────────────────────────────
  const handleAprobarOverride = async (v: AuditoriaVoucher) => {
    setAprobandoId(v.id);
    try {
      // 1. Buscar la cobranza — primero por id_cobranza, si no hay, por nro_operacion
      let reqQuery = supabase
        .from('recharge_requests')
        .select('id, student_id, amount, status, request_type')
        .eq('status', 'pending');

      let reqData = null;
      let reqErr = null;

      if (v.id_cobranza) {
        const res = await supabase
          .from('recharge_requests')
          .select('id, student_id, amount, status, request_type')
          .eq('id', v.id_cobranza)
          .single();
        reqData = res.data;
        reqErr = res.error;
      } else if (v.nro_operacion) {
        const res = await supabase
          .from('recharge_requests')
          .select('id, student_id, amount, status, request_type')
          .eq('reference_code', v.nro_operacion)
          .eq('status', 'pending')
          .maybeSingle();
        reqData = res.data;
        reqErr = res.error;
      }

      // Silenciar warning de variable no usada
      void reqQuery;

      const req = reqData;

      if (reqErr || !req) throw new Error('No se encontró la cobranza vinculada.');
      if (req.status !== 'pending') {
        toast({ title: '⚠️ Ya fue procesada', description: 'Esta cobranza ya fue aprobada o rechazada.' });
        setAprobandoId(null);
        setVoucherDetalle(null);
        return;
      }

      // 2. Aprobar la cobranza (guard: solo si sigue pendiente)
      const { data: updated, error: updateErr } = await supabase
        .from('recharge_requests')
        .update({ status: 'approved', approved_by: user?.id, approved_at: new Date().toISOString() })
        .eq('id', req.id)
        .eq('status', 'pending')
        .select('id');

      if (updateErr) throw updateErr;
      if (!updated || updated.length === 0) {
        toast({ variant: 'destructive', title: 'Ya fue procesada', description: 'Otro admin la aprobó o rechazó al mismo tiempo.' });
        setAprobandoId(null);
        return;
      }

      // 3. Para recargas: ajustar saldo del alumno
      if (req.request_type === 'recharge') {
        const { error: balanceErr } = await supabase.rpc('adjust_student_balance', {
          p_student_id: req.student_id,
          p_amount: req.amount,
        });
        if (balanceErr) throw balanceErr;
      }

      // 4. Actualizar el estado en auditoria_vouchers a VALIDO (override manual)
      await supabase
        .from('auditoria_vouchers')
        .update({ estado_ia: 'VALIDO' })
        .eq('id', v.id);

      toast({
        title: '✅ Aprobado manualmente',
        description: `Cobranza de S/ ${req.amount.toFixed(2)} aprobada con override de Auditoría. Registrado en logs.`,
      });

      setVoucherDetalle(null);
      // Refrescar vouchers y stats
      const { data: refreshed } = await supabase
        .from('auditoria_vouchers')
        .select('*')
        .order('creado_at', { ascending: false })
        .limit(200);
      if (refreshed) setVouchers(refreshed as AuditoriaVoucher[]);

    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error al aprobar', description: err.message });
    } finally {
      setAprobandoId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50 to-slate-50">

      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10 shadow-sm">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/dashboard')}
            className="rounded-full"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <ShieldCheck className="h-6 w-6 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Módulo de Auditoría</h1>
              <p className="text-xs text-gray-500">Análisis IA de comprobantes · Rastro de actividad</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 text-xs">
              Solo Admin General
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchAll}
              disabled={loading}
              className="gap-2"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Actualizar
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-6">

        {/* ── Stats Cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <Card className="border-0 shadow-sm bg-white">
            <CardContent className="pt-5 pb-4 px-5">
              <p className="text-xs text-gray-500 mb-1">Total Vouchers</p>
              <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
              <div className="flex items-center gap-1 mt-1">
                <FileSearch className="h-3.5 w-3.5 text-gray-400" />
                <span className="text-xs text-gray-400">analizados</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm bg-green-50">
            <CardContent className="pt-5 pb-4 px-5">
              <p className="text-xs text-green-700 mb-1">Válidos</p>
              <p className="text-2xl font-bold text-green-800">{stats.validos}</p>
              <div className="flex items-center gap-1 mt-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                <span className="text-xs text-green-600">confirmados</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm bg-yellow-50">
            <CardContent className="pt-5 pb-4 px-5">
              <p className="text-xs text-yellow-700 mb-1">Sospechosos</p>
              <p className="text-2xl font-bold text-yellow-800">{stats.sospechosos}</p>
              <div className="flex items-center gap-1 mt-1">
                <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
                <span className="text-xs text-yellow-600">revisar</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm bg-red-50">
            <CardContent className="pt-5 pb-4 px-5">
              <p className="text-xs text-red-700 mb-1">Rechazados</p>
              <p className="text-2xl font-bold text-red-800">{stats.rechazados}</p>
              <div className="flex items-center gap-1 mt-1">
                <XCircle className="h-3.5 w-3.5 text-red-500" />
                <span className="text-xs text-red-600">bloqueados</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm bg-indigo-50">
            <CardContent className="pt-5 pb-4 px-5">
              <p className="text-xs text-indigo-700 mb-1">Acciones Hoy</p>
              <p className="text-2xl font-bold text-indigo-800">{stats.logs_hoy}</p>
              <div className="flex items-center gap-1 mt-1">
                <Activity className="h-3.5 w-3.5 text-indigo-500" />
                <span className="text-xs text-indigo-600">registradas</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Panel de Análisis Manual ── */}
        <Card className="border-0 shadow-sm bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
          <CardContent className="pt-5 pb-5 px-6">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="h-5 w-5 text-yellow-300" />
              <p className="font-semibold text-base">Analizar Voucher con IA</p>
              <Badge className="bg-white/20 text-white border-0 text-xs">GPT-4o Vision</Badge>
            </div>
            <p className="text-indigo-100 text-xs mb-4 leading-relaxed">
              Pega la URL de un comprobante subido a Supabase Storage. La IA lo analiza en segundos y detecta banco, monto, número de operación y posibles ediciones fraudulentas.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Link className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-indigo-300" />
                <Input
                  placeholder="https://tu-proyecto.supabase.co/storage/v1/object/public/vouchers/..."
                  value={urlPrueba}
                  onChange={e => setUrlPrueba(e.target.value)}
                  className="pl-9 bg-white/10 border-white/20 text-white placeholder:text-indigo-300 h-10 text-sm focus:bg-white/20"
                />
              </div>
              <Button
                onClick={handleAnalizarVoucher}
                disabled={analizando || !urlPrueba.trim()}
                className="bg-white text-indigo-700 hover:bg-indigo-50 font-semibold h-10 gap-2 px-5 flex-shrink-0"
              >
                {analizando ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Analizando...</>
                ) : (
                  <><Sparkles className="h-4 w-4" /> Analizar</>
                )}
              </Button>
            </div>

            {/* Resultado del último análisis */}
            {ultimoResultado && (
              <div className={`mt-4 rounded-xl p-4 border ${
                ultimoResultado.es_duplicado
                  ? 'bg-red-900/40 border-red-400/40'
                  : ultimoResultado.estado_ia === 'VALIDO'
                  ? 'bg-green-900/40 border-green-400/40'
                  : ultimoResultado.estado_ia === 'SOSPECHOSO'
                  ? 'bg-yellow-900/40 border-yellow-400/40'
                  : 'bg-red-900/40 border-red-400/40'
              }`}>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <EstadoBadge estado={ultimoResultado.es_duplicado ? 'RECHAZADO' : ultimoResultado.estado_ia} />
                  {ultimoResultado.es_duplicado && (
                    <span className="text-xs font-bold text-red-300">🚨 DUPLICADO BLOQUEADO</span>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs mb-2">
                  <div className={`col-span-2 sm:col-span-3 rounded-lg px-3 py-2 ${
                    ultimoResultado.es_desvio_fondos
                      ? 'bg-red-800/50 border border-red-400'
                      : ultimoResultado.destinatario_detectado
                      ? 'bg-green-800/30 border border-green-500/40'
                      : 'bg-yellow-800/30 border border-yellow-500/40'
                  }`}>
                    <p className="text-indigo-200 mb-0.5">Destinatario del pago</p>
                    <p className="font-bold text-white text-sm">
                      {ultimoResultado.destinatario_detectado ?? '⚠️ No detectado — revisar manualmente'}
                    </p>
                    {ultimoResultado.es_desvio_fondos && (
                      <p className="text-red-300 text-[11px] mt-1 font-medium">
                        🚨 El pago NO fue a UFRASAC — BLOQUEADO POR DESVÍO DE FONDOS
                      </p>
                    )}
                    {!ultimoResultado.es_desvio_fondos && ultimoResultado.destinatario_detectado && (
                      <p className="text-green-300 text-[11px] mt-1">✅ Destinatario autorizado</p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <p className="text-indigo-300">Banco</p>
                    <p className="font-semibold text-white">{ultimoResultado.banco_detectado ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-indigo-300">Monto</p>
                    <p className="font-semibold text-white">
                      {ultimoResultado.monto_detectado != null ? `S/ ${ultimoResultado.monto_detectado.toFixed(2)}` : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-indigo-300">N° Operación</p>
                    <p className="font-semibold text-white font-mono">{ultimoResultado.nro_operacion ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-indigo-300">Fecha Pago</p>
                    <p className="font-semibold text-white">
                      {ultimoResultado.fecha_pago_detectada ? formatDate(ultimoResultado.fecha_pago_detectada) : '—'}
                    </p>
                  </div>
                </div>
                {ultimoResultado.analisis_ia?.motivo && (
                  <p className="mt-2 text-xs text-indigo-200 italic">
                    "{ultimoResultado.analisis_ia.motivo as string}"
                  </p>
                )}
                {ultimoResultado.es_duplicado && ultimoResultado.motivo_duplicado && (
                  <p className="mt-2 text-xs text-red-300 font-medium">{ultimoResultado.motivo_duplicado}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Tabs ── */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
          <button
            onClick={() => setTab('vouchers')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === 'vouchers'
                ? 'bg-white shadow-sm text-indigo-700'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <FileSearch className="h-4 w-4" />
            Vouchers Auditados
          </button>
          <button
            onClick={() => setTab('logs')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === 'logs'
                ? 'bg-white shadow-sm text-indigo-700'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <MousePointerClick className="h-4 w-4" />
            Logs de Actividad
          </button>
        </div>

        {/* ── Contenido del tab ── */}

        {tab === 'vouchers' && (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
                <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
                  <Hash className="h-4 w-4 text-indigo-500" />
                  Comprobantes analizados por IA
                </CardTitle>
                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                  {/* Búsqueda */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Buscar N° operación, banco, hash..."
                      value={filtroBusqueda}
                      onChange={e => setFiltroBusqueda(e.target.value)}
                      className="pl-9 h-9 text-sm w-full sm:w-64"
                    />
                  </div>
                  {/* Filtro estado */}
                  <Select
                    value={filtroEstado}
                    onValueChange={v => { setFiltroEstado(v); }}
                  >
                    <SelectTrigger className="h-9 w-full sm:w-40 text-sm">
                      <SelectValue placeholder="Estado IA" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos los estados</SelectItem>
                      <SelectItem value="VALIDO">✅ Válido</SelectItem>
                      <SelectItem value="SOSPECHOSO">⚠️ Sospechoso</SelectItem>
                      <SelectItem value="RECHAZADO">❌ Rechazado</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" onClick={fetchVouchers} className="h-9 gap-1">
                    <RefreshCw className="h-3.5 w-3.5" />
                    Aplicar
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
                </div>
              ) : vouchersFiltrados.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                  <ShieldCheck className="h-12 w-12 mb-3 opacity-30" />
                  <p className="text-sm font-medium">No hay vouchers auditados aún</p>
                  <p className="text-xs mt-1">Los comprobantes analizados por la IA aparecerán aquí</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-50 hover:bg-gray-50">
                        <TableHead className="text-xs font-semibold text-gray-600">Estado IA</TableHead>
                        <TableHead className="text-xs font-semibold text-gray-600">N° Operación</TableHead>
                        <TableHead className="text-xs font-semibold text-gray-600">Banco</TableHead>
                        <TableHead className="text-xs font-semibold text-gray-600">Monto</TableHead>
                        <TableHead className="text-xs font-semibold text-gray-600">Destinatario detectado</TableHead>
                        <TableHead className="text-xs font-semibold text-gray-600">Motivo IA</TableHead>
                        <TableHead className="text-xs font-semibold text-gray-600">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" /> Fecha Pago
                          </span>
                        </TableHead>
                        <TableHead className="text-xs font-semibold text-gray-600">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {vouchersFiltrados.map(v => {
                        const motivo = (v.analisis_ia?.motivo as string) ?? null;
                        const destinatario = (v.analisis_ia?.destinatario_detectado as string) ?? null;
                        return (
                        <TableRow key={v.id} className="hover:bg-gray-50/50">
                          <TableCell>
                            <EstadoBadge estado={v.estado_ia} />
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-xs text-gray-700">
                              {v.nro_operacion ?? '—'}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm text-gray-700">
                            {v.banco_detectado ?? '—'}
                          </TableCell>
                          <TableCell className="text-sm font-semibold text-gray-900">
                            {v.monto_detectado != null
                              ? `S/ ${Number(v.monto_detectado).toFixed(2)}`
                              : '—'}
                          </TableCell>
                          <TableCell className="text-xs">
                            {destinatario ? (
                              <span className={`font-medium ${v.estado_ia === 'RECHAZADO' ? 'text-red-600' : 'text-gray-700'}`}>
                                {destinatario}
                              </span>
                            ) : (
                              <span className="text-gray-300">No detectado</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-gray-600 max-w-[220px]">
                            {motivo ? (
                              <span title={motivo} className="line-clamp-2 cursor-help">
                                {motivo}
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-gray-500">
                            {formatDate(v.fecha_pago_detectada)}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center gap-2">
                                {v.url_imagen && (
                                  <button
                                    onClick={() => setImagenAbierta(v.url_imagen)}
                                    className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"
                                    title="Ver comprobante"
                                  >
                                    <ZoomIn className="h-3.5 w-3.5" /> Imagen
                                  </button>
                                )}
                                <button
                                  onClick={() => setVoucherDetalle(v)}
                                  className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 hover:underline"
                                  title="Ver análisis completo"
                                >
                                  <Info className="h-3.5 w-3.5" /> Detalle
                                </button>
                              </div>
                              {/* Botón de aprobación directamente en la tabla */}
                              {v.estado_ia === 'RECHAZADO' &&
                                !(v.analisis_ia?.es_desvio_fondos as boolean) &&
                                (v.id_cobranza || v.nro_operacion) && (
                                <button
                                  onClick={() => handleAprobarOverride(v)}
                                  disabled={aprobandoId === v.id}
                                  className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-100 hover:bg-amber-200 border border-amber-300 px-2 py-0.5 rounded-md disabled:opacity-50"
                                  title="Aprobar manualmente ignorando el rechazo de la IA"
                                >
                                  {aprobandoId === v.id
                                    ? <><Loader2 className="h-3 w-3 animate-spin" /> Aprobando...</>
                                    : <><CheckCircle2 className="h-3 w-3" /> Aprobar</>
                                  }
                                </button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              {vouchersFiltrados.length > 0 && (
                <div className="px-4 py-3 border-t bg-gray-50 text-xs text-gray-400">
                  Mostrando {vouchersFiltrados.length} registro{vouchersFiltrados.length !== 1 ? 's' : ''}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {tab === 'logs' && (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
                <CardTitle className="text-base font-semibold text-gray-800 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-indigo-500" />
                  Rastro de clics y acciones del sistema
                </CardTitle>
                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                  <Select value={filtroAccion} onValueChange={setFiltroAccion}>
                    <SelectTrigger className="h-9 w-full sm:w-48 text-sm">
                      <SelectValue placeholder="Acción" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todas las acciones</SelectItem>
                      <SelectItem value="SUBIDA_VOUCHER">Subida de Voucher</SelectItem>
                      <SelectItem value="APROBACION_MANUAL">Aprobación Manual</SelectItem>
                      <SelectItem value="RECHAZO_VOUCHER">Rechazo de Voucher</SelectItem>
                      <SelectItem value="INICIO_SESION">Inicio de Sesión</SelectItem>
                      <SelectItem value="CAMBIO_SALDO">Cambio de Saldo</SelectItem>
                      <SelectItem value="EXPORTAR_REPORTE">Exportar Reporte</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={filtroModulo} onValueChange={setFiltroModulo}>
                    <SelectTrigger className="h-9 w-full sm:w-40 text-sm">
                      <SelectValue placeholder="Módulo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos los módulos</SelectItem>
                      <SelectItem value="COBRANZAS">Cobranzas</SelectItem>
                      <SelectItem value="RECARGAS">Recargas</SelectItem>
                      <SelectItem value="POS">POS</SelectItem>
                      <SelectItem value="AUDITORIA">Auditoría</SelectItem>
                      <SelectItem value="FINANZAS">Finanzas</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant="outline" onClick={fetchLogs} className="h-9 gap-1">
                    <RefreshCw className="h-3.5 w-3.5" />
                    Aplicar
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
                </div>
              ) : logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                  <MousePointerClick className="h-12 w-12 mb-3 opacity-30" />
                  <p className="text-sm font-medium">No hay logs registrados aún</p>
                  <p className="text-xs mt-1">Las acciones del sistema aparecerán aquí automáticamente</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-gray-50 hover:bg-gray-50">
                        <TableHead className="text-xs font-semibold text-gray-600">Fecha</TableHead>
                        <TableHead className="text-xs font-semibold text-gray-600">Acción</TableHead>
                        <TableHead className="text-xs font-semibold text-gray-600">Módulo</TableHead>
                        <TableHead className="text-xs font-semibold text-gray-600">Usuario</TableHead>
                        <TableHead className="text-xs font-semibold text-gray-600">IP</TableHead>
                        <TableHead className="text-xs font-semibold text-gray-600">Fingerprint</TableHead>
                        <TableHead className="text-xs font-semibold text-gray-600">Contexto</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.map(log => (
                        <TableRow key={log.id} className="hover:bg-gray-50/50">
                          <TableCell className="text-xs text-gray-500 whitespace-nowrap">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3 text-gray-300" />
                              {formatDate(log.creado_at)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
                              {log.accion}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                              <Building2 className="h-3 w-3 text-gray-300" />
                              {log.modulo}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-[10px] text-gray-400">
                              {truncate(log.usuario_id, 12)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-xs text-gray-600">
                              {log.detalles_tecnicos?.ip ?? '—'}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span
                              className="font-mono text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded"
                              title={log.detalles_tecnicos?.fingerprint}
                            >
                              {truncate(log.detalles_tecnicos?.fingerprint, 14)}
                            </span>
                          </TableCell>
                          <TableCell>
                            {log.contexto ? (
                              <span
                                className="text-[10px] text-gray-500 cursor-help"
                                title={JSON.stringify(log.contexto, null, 2)}
                              >
                                {truncate(JSON.stringify(log.contexto), 30)}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-300">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {logs.length > 0 && (
                <div className="px-4 py-3 border-t bg-gray-50 text-xs text-gray-400">
                  Mostrando {logs.length} registro{logs.length !== 1 ? 's' : ''} más recientes
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Nota informativa ── */}
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex gap-3">
          <ShieldCheck className="h-5 w-5 text-indigo-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-indigo-800">Sobre este módulo</p>
            <p className="text-xs text-indigo-600 mt-1 leading-relaxed">
              La tabla <strong>auditoria_vouchers</strong> guarda el análisis de IA sobre cada comprobante: banco detectado, monto, número único de operación y hash del archivo para prevenir duplicados.
              La tabla <strong>huella_digital_logs</strong> registra el rastro de cada acción crítica con IP, User-Agent y fingerprint del dispositivo.
              Ambas tablas están protegidas por RLS — solo los administradores generales pueden ver estos datos.
            </p>
          </div>
        </div>

      </main>

      {/* ── Modal de detalle completo del voucher ── */}
      {voucherDetalle && (() => {
        const v = voucherDetalle;
        const motivo = (v.analisis_ia?.motivo as string) ?? '—';
        const alertas = v.analisis_ia?.alertas as string[] | undefined;
        const confianza = v.analisis_ia?.confianza as number | undefined;
        const destinatario = (v.analisis_ia?.destinatario_detectado as string) ?? null;
        const esFraude = (v.analisis_ia?.es_desvio_fondos as boolean) ?? false;
        return (
          <div
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
            onClick={() => setVoucherDetalle(null)}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <EstadoBadge estado={v.estado_ia} />
                  <span className="text-sm font-semibold text-gray-700">Análisis completo de la IA</span>
                </div>
                <button onClick={() => setVoucherDetalle(null)} className="text-gray-400 hover:text-gray-700">
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Datos detectados */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-400 mb-0.5">Banco detectado</p>
                  <p className="font-medium text-gray-800">{v.banco_detectado ?? '—'}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-400 mb-0.5">Monto detectado</p>
                  <p className="font-semibold text-gray-900">
                    {v.monto_detectado != null ? `S/ ${Number(v.monto_detectado).toFixed(2)}` : '—'}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-400 mb-0.5">N° Operación</p>
                  <p className="font-mono text-xs text-gray-700">{v.nro_operacion ?? '—'}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-400 mb-0.5">Confianza IA</p>
                  <p className="font-medium text-gray-800">
                    {confianza != null ? `${Math.round(confianza * 100)}%` : '—'}
                  </p>
                </div>
              </div>

              {/* Destinatario */}
              <div className={`rounded-lg p-3 text-sm ${esFraude ? 'bg-red-50 border border-red-200' : 'bg-gray-50'}`}>
                <p className="text-xs text-gray-400 mb-0.5">Destinatario detectado</p>
                <p className={`font-semibold ${esFraude ? 'text-red-700' : 'text-gray-800'}`}>
                  {destinatario ?? 'No se pudo detectar'}
                </p>
                {esFraude && (
                  <p className="text-xs text-red-600 mt-1">⚠️ Este destinatario no está autorizado</p>
                )}
              </div>

              {/* Motivo */}
              <div className={`rounded-xl p-4 text-sm ${v.estado_ia === 'RECHAZADO' ? 'bg-red-50 border border-red-200 text-red-800' : v.estado_ia === 'SOSPECHOSO' ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-green-50 border border-green-200 text-green-800'}`}>
                <p className="font-semibold mb-1">Motivo del veredicto:</p>
                <p>{motivo}</p>
              </div>

              {/* Alertas */}
              {alertas && alertas.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Señales de alerta:</p>
                  {alertas.map((a, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-gray-700 bg-amber-50 rounded-lg px-3 py-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                      <span>{a}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Acciones */}
              <div className="flex flex-col gap-2 pt-1">
                {v.url_imagen && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-1"
                    onClick={() => { setVoucherDetalle(null); setImagenAbierta(v.url_imagen); }}
                  >
                    <ZoomIn className="h-4 w-4" /> Ver comprobante
                  </Button>
                )}

                {/* Aprobar de todas formas — si no es desvío de fondos */}
                {v.estado_ia === 'RECHAZADO' && !esFraude && (v.id_cobranza || v.nro_operacion) && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <strong>Solo si verificaste el comprobante:</strong> esta acción aprueba el pago aunque la IA lo rechazó. Queda registrado en los logs.
                    </p>
                    <Button
                      size="sm"
                      className="w-full bg-amber-600 hover:bg-amber-700 text-white gap-1.5"
                      disabled={aprobandoId === v.id}
                      onClick={() => handleAprobarOverride(v)}
                    >
                      {aprobandoId === v.id
                        ? <><Loader2 className="h-4 w-4 animate-spin" /> Aprobando...</>
                        : <><CheckCircle2 className="h-4 w-4" /> Aprobar de todas formas</>
                      }
                    </Button>
                  </div>
                )}

                {/* Desvío de fondos — no se puede aprobar */}
                {v.estado_ia === 'RECHAZADO' && esFraude && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
                    <strong>No se puede aprobar.</strong> El destinatario no es UFRASAC. Contacta al padre para que envíe un comprobante correcto.
                  </div>
                )}

                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => setVoucherDetalle(null)}
                >
                  Cerrar
                </Button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── FioBot — Asistente Financiero flotante ── */}
      <ChatAuditoria />

      {/* ── Visor de imagen in-page (cierra con X o clic fuera) ── */}
      {imagenAbierta && (
        <div
          className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4"
          onClick={() => setImagenAbierta(null)}
        >
          <div
            className="relative max-w-xl w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setImagenAbierta(null)}
              className="absolute -top-10 right-0 text-white hover:text-gray-300 flex items-center gap-1 text-sm"
            >
              <X className="h-5 w-5" /> Cerrar
            </button>
            <img
              src={imagenAbierta}
              alt="Comprobante auditado"
              className="w-full rounded-xl shadow-2xl"
            />
            <p className="mt-3 text-center text-xs text-gray-400">
              Haz clic fuera de la imagen o en "Cerrar" para salir
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Auditoria;
