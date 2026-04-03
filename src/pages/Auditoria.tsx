import { useEffect, useMemo, useState } from 'react';
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
  Calendar,
  Building2,
  Loader2,
  CheckCircle2,
  Clock,
  Sparkles,
  Link,
  X,
  ZoomIn,
  Info,
} from 'lucide-react';
import {
  procesarVoucherConIA,
  type ResultadoAuditoria,
} from '@/services/auditService';
import { ChatAuditoria } from '@/components/audit/ChatAuditoria';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

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
  subido_por: string | null;
  creado_at: string;
  // Campos enriquecidos en el frontend
  _school_name?: string | null;
  _analista_name?: string | null;
  _is_duplicate?: boolean; // true si hay otro registro con el mismo nro_operacion
  /** Estado actual de recharge_requests (si hay id_cobranza) */
  _rr_status?: string | null;
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
    timeZone: 'America/Lima',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Devuelve true si la fecha del voucher (extraída por IA) es posterior
 * a la fecha de registro del análisis (creado_at), con un margen de 15 min.
 * Ambas fechas son UTC — comparación exacta sin depender de zonas horarias.
 */
function esFechaFutura(fechaPago: string | null, creadoAt: string): boolean {
  if (!fechaPago) return false;
  try {
    let ms: number;
    const f = fechaPago.trim();
    const tieneZona = f.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(f);
    ms = tieneZona ? new Date(f).getTime() : new Date(f + '-05:00').getTime();
    const uploadMs = new Date(creadoAt).getTime();
    return !isNaN(ms) && ms > uploadMs + 15 * 60 * 1000;
  } catch {
    return false;
  }
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
  const [filtroSede, setFiltroSede] = useState<string>('todos');
  const [schoolsList, setSchoolsList] = useState<Array<{ id: string; name: string }>>([]);
  /** Ocultar filas cuya cobranza vinculada ya está anulada (cancelled) */
  const [ocultarAnuladas, setOcultarAnuladas] = useState(true);
  const [selectedVoucherIds, setSelectedVoucherIds] = useState<Set<string>>(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);
  const [rechazandoId, setRechazandoId] = useState<string | null>(null);
  const [rejectDialog, setRejectDialog] = useState<{ voucher: AuditoriaVoucher; reason: string } | null>(null);
  /** Filas a rechazar en bloque (mismo motivo); null = rechazo de una sola fila vía rejectDialog */
  const [bulkRejectList, setBulkRejectList] = useState<AuditoriaVoucher[] | null>(null);
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
    await Promise.all([fetchSchoolsList(), fetchVouchers(), fetchLogs(), fetchStats()]);
    setLoading(false);
  };

  const fetchSchoolsList = async () => {
    try {
      const { data } = await supabase.from('schools').select('id, name').order('name');
      setSchoolsList(data ?? []);
    } catch {
      setSchoolsList([]);
    }
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
        .limit(500);

      if (filtroEstado !== 'todos') {
        query = query.eq('estado_ia', filtroEstado);
      }

      const { data, error } = await query;
      if (error) throw error;
      const rows = data ?? [];

      // ── Estados de cobranza (evita mostrar anulados si el admin ya canceló) ──
      const cobranzaIds = [...new Set(rows.map(r => r.id_cobranza).filter(Boolean))] as string[];
      const statusByCobranza = new Map<string, string>();
      const chunkSize = 120;
      for (let i = 0; i < cobranzaIds.length; i += chunkSize) {
        const chunk = cobranzaIds.slice(i, i + chunkSize);
        const { data: rrRows } = await supabase
          .from('recharge_requests')
          .select('id, status')
          .in('id', chunk);
        for (const rr of rrRows ?? []) {
          statusByCobranza.set(rr.id, rr.status);
        }
      }

      // ── Enriquecer con nombres de sede ──
      const schoolIds = [...new Set(rows.map(r => r.school_id).filter(Boolean))] as string[];
      const schoolMap = new Map<string, string>();
      if (schoolIds.length > 0) {
        const { data: schools } = await supabase
          .from('schools')
          .select('id, name')
          .in('id', schoolIds);
        for (const s of schools ?? []) schoolMap.set(s.id, s.name);
      }

      // ── Enriquecer con nombre de quien analizó (subido_por) ──
      const analistaIds = [...new Set(rows.map(r => r.subido_por).filter(Boolean))] as string[];
      const analistaMap = new Map<string, string>();
      if (analistaIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', analistaIds);
        for (const p of profiles ?? []) {
          analistaMap.set(p.id, p.full_name || p.email || 'Desconocido');
        }
      }

      // ── Marcar duplicados (mismo nro_operacion, más de 1 fila) ──
      const nroCount = new Map<string, number>();
      for (const r of rows) {
        if (r.nro_operacion) {
          nroCount.set(r.nro_operacion, (nroCount.get(r.nro_operacion) ?? 0) + 1);
        }
      }

      setVouchers(rows.map(r => ({
        ...r,
        _school_name: r.school_id ? (schoolMap.get(r.school_id) ?? null) : null,
        _analista_name: r.subido_por ? (analistaMap.get(r.subido_por) ?? r.subido_por) : null,
        _is_duplicate: r.nro_operacion ? (nroCount.get(r.nro_operacion) ?? 0) > 1 : false,
        _rr_status: r.id_cobranza ? (statusByCobranza.get(r.id_cobranza) ?? null) : null,
      })));
      setSelectedVoucherIds(new Set());
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

  /** Fila elegible para acciones masivas / check (aprobar o rechazar cobranza pendiente) */
  const filaElegibleAcciones = (v: AuditoriaVoucher) => {
    const esSospechoso = v.estado_ia === 'SOSPECHOSO';
    const esRechazado = v.estado_ia === 'RECHAZADO';
    if (!esSospechoso && !esRechazado) return false;
    if (v.analisis_ia?.es_desvio_fondos as boolean) return false;
    if (!v.id_cobranza && !v.nro_operacion) return false;
    const st = v._rr_status;
    if (st === 'approved') return false;
    if (st === 'cancelled') return false;
    return st === 'pending' || st === 'rejected' || st == null;
  };

  const vouchersFiltrados = useMemo(() => {
    return vouchers.filter(v => {
      // Ocultar cobranzas ya procesadas (anuladas O rechazadas por admin)
      if (ocultarAnuladas && (v._rr_status === 'cancelled' || v._rr_status === 'rejected')) return false;
      if (filtroSede !== 'todos' && v.school_id !== filtroSede) return false;
      if (!filtroBusqueda) return true;
      const q = filtroBusqueda.toLowerCase();
      return (
        v.nro_operacion?.toLowerCase().includes(q) ||
        v.banco_detectado?.toLowerCase().includes(q) ||
        v.hash_imagen?.toLowerCase().includes(q) ||
        (v._school_name?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [vouchers, filtroBusqueda, filtroSede, ocultarAnuladas]);

  const filasElegiblesLista = useMemo(
    () => vouchersFiltrados.filter(filaElegibleAcciones),
    [vouchersFiltrados]
  );

  const selectedElegiblesCount = useMemo(
    () => filasElegiblesLista.filter(v => selectedVoucherIds.has(v.id)).length,
    [filasElegiblesLista, selectedVoucherIds]
  );

  /** Estado del checkbox "seleccionar todos": true=todos, false=ninguno, "indeterminate"=algunos */
  const selectAllState = useMemo((): boolean | 'indeterminate' => {
    if (filasElegiblesLista.length === 0) return false;
    const selected = filasElegiblesLista.filter(v => selectedVoucherIds.has(v.id)).length;
    if (selected === 0) return false;
    if (selected === filasElegiblesLista.length) return true;
    return 'indeterminate';
  }, [filasElegiblesLista, selectedVoucherIds]);

  const toggleSelectAllElegibles = (checked: boolean) => {
    if (!checked) {
      setSelectedVoucherIds(new Set());
      return;
    }
    setSelectedVoucherIds(new Set(filasElegiblesLista.map(v => v.id)));
  };

  const toggleSelectOne = (id: string, checked: boolean) => {
    setSelectedVoucherIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  // ──────────────────────────────────────────────────────────
  // Aprobación override — desde Auditoría, sin pasar por Cobranzas
  // ──────────────────────────────────────────────────────────
  const handleAprobarOverride = async (
    v: AuditoriaVoucher,
    opts?: { silent?: boolean; skipFinalFetch?: boolean }
  ): Promise<boolean> => {
    const silent = opts?.silent ?? false;
    const skipFinalFetch = opts?.skipFinalFetch ?? false;
    setAprobandoId(v.id);
    try {
      // 1. Buscar la cobranza — primero por id_cobranza, si no hay, por nro_operacion
      // IMPORTANTE: buscamos SIN filtrar por status, porque la IA puede haber
      // marcado la cobranza como 'rejected' automáticamente. El admin tiene
      // potestad de revertir ese rechazo desde Auditoría.
      let reqData = null;
      let reqErr = null;

      if (v.id_cobranza) {
        const res = await supabase
          .from('recharge_requests')
          .select('id, student_id, amount, status, request_type, lunch_order_ids, paid_transaction_ids, payment_method, reference_code, voucher_url')
          .eq('id', v.id_cobranza)
          .single();
        reqData = res.data;
        reqErr = res.error;
      } else if (v.nro_operacion) {
        // Sin filtro de status: puede estar pending o rejected
        const res = await supabase
          .from('recharge_requests')
          .select('id, student_id, amount, status, request_type, lunch_order_ids, paid_transaction_ids, payment_method, reference_code, voucher_url')
          .eq('reference_code', v.nro_operacion)
          .in('status', ['pending', 'rejected'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        reqData = res.data;
        reqErr = res.error;
      }

      const req = reqData;

      if (reqErr || !req) {
        throw new Error('No se encontró la cobranza vinculada. Puede que ya haya sido procesada o que no tenga un ID de cobranza asociado.');
      }

      // ── Helper: saldar transacciones pendientes de almuerzo/deuda ──
      // Compartido entre el path "ya aprobado" (Bug E) y el path de aprobación nueva (Bug D)
      const saldarTransaccionesPendientes = async (r: typeof req) => {
        if (!r || (r.request_type !== 'lunch_payment' && r.request_type !== 'debt_payment')) return;

        const paymentMeta = {
          payment_approved: true,
          payment_source: r.request_type === 'debt_payment' ? 'debt_voucher_payment' : 'lunch_voucher_payment',
          recharge_request_id: r.id,
          reference_code: r.reference_code,
          approved_by: user?.id,
          approved_at: new Date().toISOString(),
          voucher_url: r.voucher_url,
        };

        const txIdsToUpdate = new Set<string>();

        // A) Por lunch_order_ids
        if (r.lunch_order_ids && r.lunch_order_ids.length > 0) {
          for (const orderId of r.lunch_order_ids) {
            const { data: matchingTxs } = await supabase
              .from('transactions')
              .select('id')
              .eq('type', 'purchase')
              .in('payment_status', ['pending', 'partial'])
              .contains('metadata', { lunch_order_id: orderId });
            (matchingTxs || []).forEach((tx: any) => txIdsToUpdate.add(tx.id));
          }
        }
        // B) Por paid_transaction_ids
        if (r.paid_transaction_ids && r.paid_transaction_ids.length > 0) {
          r.paid_transaction_ids.forEach((id: string) => txIdsToUpdate.add(id));
        }
        // C) Fallback por student_id
        if (txIdsToUpdate.size === 0 && r.student_id) {
          const { data: fallbackTxs } = await supabase
            .from('transactions')
            .select('id, amount')
            .eq('student_id', r.student_id)
            .eq('type', 'purchase')
            .in('payment_status', ['pending', 'partial'])
            .order('created_at', { ascending: true });
          if (fallbackTxs && fallbackTxs.length > 0) {
            let remaining = r.amount;
            for (const tx of fallbackTxs) {
              if (remaining <= 0.01) break;
              txIdsToUpdate.add(tx.id);
              remaining -= Math.abs(tx.amount);
            }
          }
        }

        if (txIdsToUpdate.size === 0) {
          console.warn('[Auditoria] saldarTransaccionesPendientes: no se encontraron tx pendientes para', r.id);
          return;
        }

        const { data: currentTxs, error: readErr } = await supabase
          .from('transactions')
          .select('id, metadata, payment_status')
          .in('id', Array.from(txIdsToUpdate));

        if (readErr) {
          console.error('[Auditoria] Error leyendo transacciones:', readErr);
          return;
        }

        for (const tx of (currentTxs || [])) {
          if (tx.payment_status === 'paid') continue;
          await supabase
            .from('transactions')
            .update({
              payment_status: 'paid',
              payment_method: r.payment_method || 'voucher',
              metadata: { ...(tx.metadata || {}), ...paymentMeta, last_payment_rejected: false },
            })
            .eq('id', tx.id)
            .in('payment_status', ['pending', 'partial']);
        }

        // Confirmar lunch_orders activas
        const orderIdsToConfirm = new Set<string>(r.lunch_order_ids || []);
        if (txIdsToUpdate.size > 0) {
          const { data: updatedTxMeta } = await supabase
            .from('transactions').select('metadata').in('id', Array.from(txIdsToUpdate));
          (updatedTxMeta || []).forEach((tx: any) => {
            if (tx.metadata?.lunch_order_id) orderIdsToConfirm.add(tx.metadata.lunch_order_id);
          });
        }
        if (orderIdsToConfirm.size > 0) {
          const { data: activeOrders } = await supabase
            .from('lunch_orders').select('id')
            .in('id', Array.from(orderIdsToConfirm))
            .eq('is_cancelled', false).neq('status', 'cancelled');
          const activeIds = (activeOrders || []).map((o: any) => o.id);
          if (activeIds.length > 0) {
            await supabase.from('lunch_orders').update({ status: 'confirmed' }).in('id', activeIds);
          }
        }
        console.log(`[Auditoria] saldarTransaccionesPendientes: ${txIdsToUpdate.size} tx procesadas para ${r.id}`);
      };

      // Si ya fue aprobada previamente → sincronizar auditoria_vouchers a VALIDO
      // ── BUG E FIX: también reparar transactions pendientes que no se actualizaron ──
      if (req.status === 'approved') {
        // Intentar saldar transacciones que puedan haber quedado pendientes
        await saldarTransaccionesPendientes(req);
        await supabase
          .from('auditoria_vouchers')
          .update({ estado_ia: 'VALIDO' })
          .eq('id', v.id);
        if (!silent) {
          toast({
            title: '✅ Cobranza ya aprobada',
            description: 'Esta cobranza ya había sido aprobada. Se verificaron y saldaron las deudas pendientes.',
          });
        }
        setVoucherDetalle(null);
        if (!skipFinalFetch) await fetchAll();
        setAprobandoId(null);
        return true;
      }

      // Si está cancelled, tampoco se puede reactivar
      if (req.status === 'cancelled') {
        if (!silent) {
          toast({ variant: 'destructive', title: '🚫 Cobranza cancelada', description: 'Esta cobranza fue cancelada y no puede aprobarse.' });
        }
        setAprobandoId(null);
        setVoucherDetalle(null);
        return false;
      }

      // status es 'pending' o 'rejected' → podemos proceder con el override

      // ── PASO CRÍTICO: Actualizar auditoria_vouchers a SOSPECHOSO antes de aprobar ──
      // El trigger fn_guard_voucher_approval bloquea cualquier aprobación si
      // auditoria_vouchers solo tiene registros con estado_ia = 'RECHAZADO'.
      // Al marcar como SOSPECHOSO aquí, dejamos constancia de que un admin
      // humano revisó el comprobante y decidió aprobarlo de todas formas.
      if (v.estado_ia === 'RECHAZADO') {
        const { error: overrideErr } = await supabase
          .from('auditoria_vouchers')
          .update({
            estado_ia: 'SOSPECHOSO',
            analisis_ia: {
              ...(v.analisis_ia ?? {}),
              estado: 'SOSPECHOSO',
              motivo: `[APROBACIÓN MANUAL POR ADMIN] ${(v.analisis_ia?.motivo as string) ?? 'El administrador revisó y aprobó manualmente.'}`,
              override_manual: true,
              override_at: new Date().toISOString(),
              override_by: user?.id,
            },
          })
          .eq('id', v.id);

        if (overrideErr) {
          console.error('Error actualizando estado IA a SOSPECHOSO:', overrideErr);
          throw new Error(`No se pudo preparar el override: ${overrideErr.message}`);
        }
      }

      // 2. Aprobar la cobranza — funciona tanto para 'pending' como para 'rejected'
      // El admin desde Auditoría tiene potestad de revertir rechazos automáticos de la IA.
      const { data: updated, error: updateErr } = await supabase
        .from('recharge_requests')
        .update({ status: 'approved', approved_by: user?.id, approved_at: new Date().toISOString() })
        .eq('id', req.id)
        .in('status', ['pending', 'rejected'])
        .select('id');

      if (updateErr) throw updateErr;
      if (!updated || updated.length === 0) {
        if (!silent) {
          toast({ variant: 'destructive', title: 'Ya fue procesada', description: 'Otro admin la aprobó o rechazó al mismo tiempo.' });
        }
        setAprobandoId(null);
        return false;
      }

      // 3. Efecto contable según tipo de pago
      if (req.request_type === 'recharge') {
        // Para recargas: ajustar saldo del alumno
        const { error: balanceErr } = await supabase.rpc('adjust_student_balance', {
          p_student_id: req.student_id,
          p_amount: req.amount,
        });
        if (balanceErr) throw balanceErr;
      } else if (req.request_type === 'lunch_payment' || req.request_type === 'debt_payment') {
        // ── BUG D FIX: Para pagos de deuda/almuerzo, marcar transactions como pagadas ──
        await saldarTransaccionesPendientes(req);
      }

      // 4. Marcar en auditoria_vouchers como VALIDO (el admin verificó y aprobó)
      await supabase
        .from('auditoria_vouchers')
        .update({
          estado_ia: 'VALIDO',
          analisis_ia: {
            ...(v.analisis_ia ?? {}),
            estado: 'VALIDO',
            motivo_override: `Aprobado manualmente por admin. Estado original: ${v.estado_ia}. Motivo IA: ${(v.analisis_ia?.motivo as string) ?? '—'}`,
            override_manual: true,
            override_at: new Date().toISOString(),
            override_by: user?.id,
          }
        })
        .eq('id', v.id);

      if (!silent) {
        toast({
          title: '✅ Aprobado manualmente',
          description: `Cobranza de S/ ${req.amount.toFixed(2)} aprobada tras revisión manual en Auditoría.`,
        });
      }

      setVoucherDetalle(null);
      if (!skipFinalFetch) await fetchAll();
      return true;
    } catch (err: any) {
      if (!silent) {
        toast({ variant: 'destructive', title: 'Error al aprobar', description: err.message });
      }
      return false;
    } finally {
      setAprobandoId(null);
    }
  };

  const resolverCobranzaParaVoucher = async (v: AuditoriaVoucher) => {
    let reqData = null;
    let reqErr = null;
    if (v.id_cobranza) {
      const res = await supabase
        .from('recharge_requests')
        .select('id, student_id, amount, status, request_type, lunch_order_ids, paid_transaction_ids')
        .eq('id', v.id_cobranza)
        .single();
      reqData = res.data;
      reqErr = res.error;
    } else if (v.nro_operacion) {
      const res = await supabase
        .from('recharge_requests')
        .select('id, student_id, amount, status, request_type, lunch_order_ids, paid_transaction_ids')
        .eq('reference_code', v.nro_operacion)
        .in('status', ['pending', 'rejected'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      reqData = res.data;
      reqErr = res.error;
    }
    return { req: reqData, err: reqErr };
  };

  const handleRechazarDesdeAuditoria = async (
    v: AuditoriaVoucher,
    reason: string,
    opts?: { silent?: boolean; skipFinalFetch?: boolean; skipCloseDialog?: boolean }
  ) => {
    const silent = opts?.silent ?? false;
    const skipFinalFetch = opts?.skipFinalFetch ?? false;
    if (!user) return;
    const motivo = reason.trim() || 'Rechazado desde módulo Auditoría';
    setRechazandoId(v.id);
    try {
      const { req, err } = await resolverCobranzaParaVoucher(v);
      if (err || !req) {
        throw new Error('No se encontró la cobranza vinculada.');
      }
      if (req.status === 'approved') {
        if (!silent) {
          toast({ variant: 'destructive', title: 'Ya aprobada', description: 'No se puede rechazar una cobranza ya aprobada.' });
        }
        return;
      }
      if (req.status === 'cancelled') {
        if (!silent) {
          toast({ title: 'Ya anulada', description: 'La cobranza ya estaba anulada. Solo se actualizará el registro de auditoría.' });
        }
      }

      const rejectionMeta = {
        last_payment_rejected: true,
        rejection_reason: motivo,
        rejected_at: new Date().toISOString(),
        rejected_request_id: req.id,
      };

      if (req.status === 'pending') {
        const { data: rejectResult, error: rejErr } = await supabase
          .from('recharge_requests')
          .update({
            status: 'rejected',
            rejection_reason: motivo,
            approved_by: user.id,
            approved_at: new Date().toISOString(),
          })
          .eq('id', req.id)
          .eq('status', 'pending')
          .select('id');
        if (rejErr) throw rejErr;
        if (!rejectResult?.length) {
          if (!silent) {
            toast({ title: 'Estado cambiado', description: 'Otro usuario procesó esta cobranza. Revisa la lista.' });
          }
        } else {
          if ((req.request_type === 'lunch_payment' || req.request_type === 'debt_payment') && req.lunch_order_ids?.length) {
            for (const orderId of req.lunch_order_ids) {
              const { data: existingTx } = await supabase
                .from('transactions')
                .select('id, metadata')
                .eq('type', 'purchase')
                .contains('metadata', { lunch_order_id: orderId })
                .maybeSingle();
              if (existingTx) {
                await supabase
                  .from('transactions')
                  .update({ metadata: { ...(existingTx.metadata || {}), ...rejectionMeta } })
                  .eq('id', existingTx.id);
              }
            }
          }
          if (req.request_type === 'debt_payment' && req.paid_transaction_ids?.length) {
            const handledByLunch = new Set<string>();
            if (req.lunch_order_ids) {
              for (const orderId of req.lunch_order_ids) {
                const { data: ltx } = await supabase
                  .from('transactions')
                  .select('id')
                  .contains('metadata', { lunch_order_id: orderId })
                  .maybeSingle();
                if (ltx) handledByLunch.add(ltx.id);
              }
            }
            const remaining = req.paid_transaction_ids.filter((id: string) => !handledByLunch.has(id));
            for (const txId of remaining) {
              const { data: existingTx } = await supabase
                .from('transactions')
                .select('id, metadata')
                .eq('id', txId)
                .maybeSingle();
              if (existingTx) {
                await supabase
                  .from('transactions')
                  .update({ metadata: { ...(existingTx.metadata || {}), ...rejectionMeta } })
                  .eq('id', txId);
              }
            }
          }
        }
      }

      await supabase
        .from('auditoria_vouchers')
        .update({
          estado_ia: 'RECHAZADO',
          analisis_ia: {
            ...(v.analisis_ia ?? {}),
            estado: 'RECHAZADO',
            motivo: `[RECHAZO ADMIN AUDITORÍA] ${motivo}`,
            rechazo_auditoria: true,
            rechazado_por: user.id,
            rechazado_at: new Date().toISOString(),
          },
        })
        .eq('id', v.id);

      if (!silent) {
        toast({
          title: 'Rechazo registrado',
          description: req.status === 'pending' ? 'Cobranza rechazada y auditoría actualizada.' : 'Auditoría marcada como rechazada.',
        });
      }
      if (!opts?.skipCloseDialog) {
        setRejectDialog(null);
        setBulkRejectList(null);
      }
      setVoucherDetalle(null);
      if (!skipFinalFetch) await fetchAll();
    } catch (err: any) {
      if (!silent) {
        toast({ variant: 'destructive', title: 'Error al rechazar', description: err.message });
      }
    } finally {
      setRechazandoId(null);
    }
  };

  const handleBulkAprobar = async () => {
    const ids = [...selectedVoucherIds];
    const toProcess = vouchersFiltrados.filter(v => ids.includes(v.id) && filaElegibleAcciones(v));
    if (toProcess.length === 0) {
      toast({ variant: 'destructive', title: 'Nada seleccionado', description: 'Marca filas elegibles (sospechoso/rechazado IA con cobranza pendiente).' });
      return;
    }
    setBulkWorking(true);
    let ok = 0;
    let fail = 0;
    for (const v of toProcess) {
      const success = await handleAprobarOverride(v, { silent: true, skipFinalFetch: true });
      if (success) ok++;
      else fail++;
    }
    setSelectedVoucherIds(new Set());
    await fetchAll();
    setBulkWorking(false);
    toast({
      title: 'Aprobación masiva finalizada',
      description: `${ok} correcto(s)${fail ? `, ${fail} omitido(s) o con error` : ''}.`,
    });
  };

  const handleBulkRechazarClick = () => {
    const ids = [...selectedVoucherIds];
    const toProcess = vouchersFiltrados.filter(v => ids.includes(v.id) && filaElegibleAcciones(v));
    if (toProcess.length === 0) {
      toast({ variant: 'destructive', title: 'Nada seleccionado', description: 'Marca filas elegibles para rechazar.' });
      return;
    }
    setBulkRejectList(toProcess.length > 1 ? toProcess : null);
    setRejectDialog({
      voucher: toProcess[0],
      reason: toProcess.length > 1 ? 'Rechazo masivo desde Auditoría' : '',
    });
  };

  const confirmarRechazoDialog = async () => {
    const reason = rejectDialog?.reason?.trim() ?? '';
    if (!rejectDialog) return;
    const list =
      bulkRejectList && bulkRejectList.length > 0 ? bulkRejectList : [rejectDialog.voucher];
    setBulkWorking(true);
    try {
      if (list.length > 1) {
        for (const v of list) {
          await handleRechazarDesdeAuditoria(v, reason, {
            silent: true,
            skipFinalFetch: true,
            skipCloseDialog: true,
          });
        }
        setSelectedVoucherIds(new Set());
        setRejectDialog(null);
        setBulkRejectList(null);
        await fetchAll();
        toast({
          title: 'Rechazo masivo finalizado',
          description: `Procesadas ${list.length} fila(s).`,
        });
        return;
      }
      await handleRechazarDesdeAuditoria(rejectDialog.voucher, reason);
    } finally {
      setBulkWorking(false);
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
            <CardHeader className="pb-3 space-y-3">
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
              <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between border-t border-gray-100 pt-3">
                <div className="flex flex-col sm:flex-row flex-wrap gap-2 sm:items-center">
                  <Select value={filtroSede} onValueChange={setFiltroSede}>
                    <SelectTrigger className="h-9 w-full sm:w-[220px] text-sm">
                      <SelectValue placeholder="Sede" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todas las sedes</SelectItem>
                      {schoolsList.map(s => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50/80 px-3 py-1.5 h-9">
                    <Checkbox
                      id="ocultar-anuladas-aud"
                      checked={ocultarAnuladas}
                      onCheckedChange={c => setOcultarAnuladas(c === true)}
                    />
                    <Label htmlFor="ocultar-anuladas-aud" className="text-xs font-medium text-gray-600 cursor-pointer">
                      Ocultar anuladas / rechazadas
                    </Label>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    className="h-9 gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                    disabled={bulkWorking || selectedElegiblesCount === 0}
                    onClick={handleBulkAprobar}
                  >
                    {bulkWorking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    Aprobar seleccionados ({selectedElegiblesCount})
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-9 gap-1.5"
                    disabled={bulkWorking || selectedElegiblesCount === 0}
                    onClick={handleBulkRechazarClick}
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Rechazar seleccionados
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
                        <TableHead className="w-10 pr-0 text-xs font-semibold text-gray-600">
                          <Checkbox
                            checked={selectAllState}
                            onCheckedChange={c => toggleSelectAllElegibles(c === true)}
                            disabled={bulkWorking || filasElegiblesLista.length === 0}
                            aria-label="Seleccionar todas las filas elegibles"
                          />
                        </TableHead>
                        <TableHead className="text-xs font-semibold text-gray-600">Estado IA</TableHead>
                        <TableHead className="text-xs font-semibold text-gray-600">N° Operación</TableHead>
                        <TableHead className="text-xs font-semibold text-gray-600">Banco</TableHead>
                        <TableHead className="text-xs font-semibold text-gray-600">Monto</TableHead>
                        <TableHead className="text-xs font-semibold text-gray-600">Destinatario detectado</TableHead>
                        <TableHead className="text-xs font-semibold text-gray-600 min-w-[180px]">Motivo IA / Alertas</TableHead>
                        <TableHead className="text-xs font-semibold text-gray-600">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" /> Fecha Pago
                          </span>
                        </TableHead>
                        <TableHead className="text-xs font-semibold text-gray-600">Sede</TableHead>
                        <TableHead className="text-xs font-semibold text-gray-600">Analizado por</TableHead>
                        <TableHead className="text-xs font-semibold text-gray-600">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {vouchersFiltrados.map(v => {
                        const motivo = (v.analisis_ia?.motivo as string) ?? null;
                        const alertas = (v.analisis_ia?.alertas as string[]) ?? [];
                        const destinatario = (v.analisis_ia?.destinatario_detectado as string) ?? null;
                        const esSospechoso = v.estado_ia === 'SOSPECHOSO';
                        const esRechazado = v.estado_ia === 'RECHAZADO';
                        return (
                        <TableRow
                          key={v.id}
                          className={`hover:bg-gray-50/50 ${v._is_duplicate ? 'bg-orange-50/40' : ''}`}
                        >
                          <TableCell className="w-10 pr-0 align-top pt-3">
                            {filaElegibleAcciones(v) ? (
                              <Checkbox
                                checked={selectedVoucherIds.has(v.id)}
                                onCheckedChange={c => toggleSelectOne(v.id, c === true)}
                                disabled={bulkWorking}
                                aria-label="Seleccionar fila"
                              />
                            ) : (
                              <span className="text-gray-200 text-xs select-none">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <EstadoBadge estado={v.estado_ia} />
                              {v._is_duplicate && (
                                <span
                                  title="Hay otro registro con el mismo N° de operación. Puede ser un análisis repetido."
                                  className="text-[10px] font-semibold text-orange-600 bg-orange-100 border border-orange-300 rounded px-1 cursor-help"
                                >
                                  ⚠ DUPLICADO
                                </span>
                              )}
                            </div>
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
                              <span className={`font-medium ${esRechazado ? 'text-red-600' : 'text-gray-700'}`}>
                                {destinatario}
                              </span>
                            ) : (
                              <span className="text-gray-300">No detectado</span>
                            )}
                          </TableCell>
                          {/* Motivo IA + Alertas expandidas para SOSPECHOSO/RECHAZADO */}
                          <TableCell className="text-xs text-gray-600 max-w-[250px]">
                            <div className="space-y-1">
                              {motivo ? (
                                <p
                                  title={motivo}
                                  className={`leading-tight ${(esSospechoso || esRechazado) ? 'font-medium text-red-700' : ''}`}
                                >
                                  {motivo}
                                </p>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                              {/* Alertas como badges (especialmente útil para SOSPECHOSO) */}
                              {alertas.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {alertas.map((alerta, i) => (
                                    <span
                                      key={i}
                                      title={alerta}
                                      className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded border leading-tight max-w-[200px] truncate cursor-help ${
                                        esRechazado
                                          ? 'bg-red-100 text-red-700 border-red-300'
                                          : 'bg-amber-100 text-amber-700 border-amber-300'
                                      }`}
                                    >
                                      ⚠ {alerta}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-gray-500">
                            <span className="flex items-center gap-1">
                              {formatDate(v.fecha_pago_detectada)}
                              {esFechaFutura(v.fecha_pago_detectada, v.creado_at) && (
                                <span
                                  title="⚠️ La fecha del comprobante aparece posterior al envío. Revisar manualmente."
                                  className="text-amber-500 cursor-help"
                                >
                                  ⚠️
                                </span>
                              )}
                            </span>
                          </TableCell>
                          {/* Sede */}
                          <TableCell className="text-xs text-gray-600">
                            {v._school_name ? (
                              <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 rounded px-1.5 py-0.5 font-medium">
                                {v._school_name}
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </TableCell>
                          {/* Analizado por */}
                          <TableCell className="text-xs text-gray-500">
                            {v._analista_name ?? <span className="text-gray-300">—</span>}
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
                              {/* Botón "Aprobar" para SOSPECHOSO y RECHAZADO */}
                              {/* NUNCA para desvío de fondos (fraude confirmado) */}
                              {(esSospechoso || esRechazado) &&
                                !(v.analisis_ia?.es_desvio_fondos as boolean) &&
                                (v.id_cobranza || v.nro_operacion) && (
                                <>
                                  <button
                                    onClick={() => handleAprobarOverride(v)}
                                    disabled={aprobandoId === v.id || bulkWorking}
                                    className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md disabled:opacity-50 border ${
                                      esSospechoso
                                        ? 'text-amber-700 bg-amber-100 hover:bg-amber-200 border-amber-300'
                                        : 'text-orange-700 bg-orange-100 hover:bg-orange-200 border-orange-300'
                                    }`}
                                    title={
                                      esSospechoso
                                        ? 'El comprobante tiene alertas. Verifica la imagen antes de aprobar.'
                                        : 'Aprobar manualmente ignorando el rechazo de la IA'
                                    }
                                  >
                                    {aprobandoId === v.id
                                      ? <><Loader2 className="h-3 w-3 animate-spin" /> Aprobando...</>
                                      : <><CheckCircle2 className="h-3 w-3" /> Aprobar</>
                                    }
                                  </button>
                                  {filaElegibleAcciones(v) && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setBulkRejectList(null);
                                        setRejectDialog({ voucher: v, reason: '' });
                                      }}
                                      disabled={rechazandoId === v.id || bulkWorking}
                                      className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md disabled:opacity-50 border text-red-700 bg-red-50 hover:bg-red-100 border-red-200"
                                      title="Rechazar la cobranza y marcar el voucher en auditoría"
                                    >
                                      {rechazandoId === v.id ? (
                                        <><Loader2 className="h-3 w-3 animate-spin" /> Rechazando...</>
                                      ) : (
                                        <><XCircle className="h-3 w-3" /> Rechazar</>
                                      )}
                                    </button>
                                  )}
                                </>
                              )}
                              {/* Aviso cuando es desvío de fondos — nunca se aprueba */}
                              {(v.analisis_ia?.es_desvio_fondos as boolean) && (
                                <span className="text-[10px] text-red-600 font-semibold bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
                                  🚫 Desvío — no aprobable
                                </span>
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

                {/* Aprobar / Rechazar — sospechoso o rechazado por IA, sin desvío de fondos */}
                {(v.estado_ia === 'SOSPECHOSO' || v.estado_ia === 'RECHAZADO') &&
                  !esFraude &&
                  (v.id_cobranza || v.nro_operacion) &&
                  filaElegibleAcciones(v) && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <strong>Solo si verificaste el comprobante:</strong>{' '}
                      {v.estado_ia === 'RECHAZADO'
                        ? 'esta acción aprueba el pago aunque la IA lo rechazó.'
                        : 'puedes aprobar el pago o rechazarlo con un motivo registrado.'}
                    </p>
                    <div className="flex flex-col gap-2">
                      <Button
                        size="sm"
                        className="w-full bg-amber-600 hover:bg-amber-700 text-white gap-1.5"
                        disabled={aprobandoId === v.id || bulkWorking}
                        onClick={() => handleAprobarOverride(v)}
                      >
                        {aprobandoId === v.id
                          ? <><Loader2 className="h-4 w-4 animate-spin" /> Aprobando...</>
                          : <><CheckCircle2 className="h-4 w-4" /> {v.estado_ia === 'RECHAZADO' ? 'Aprobar de todas formas' : 'Aprobar pago'}</>
                        }
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="w-full gap-1.5"
                        disabled={rechazandoId === v.id || bulkWorking}
                        onClick={() => {
                          setBulkRejectList(null);
                          setRejectDialog({ voucher: v, reason: '' });
                          setVoucherDetalle(null);
                        }}
                      >
                        <XCircle className="h-4 w-4" /> Rechazar cobranza
                      </Button>
                    </div>
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

      {/* ── Diálogo: motivo de rechazo (una fila o varias) ── */}
      <Dialog
        open={!!rejectDialog}
        onOpenChange={open => {
          if (!open) {
            setRejectDialog(null);
            setBulkRejectList(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rechazar comprobante</DialogTitle>
            <DialogDescription>
              {bulkRejectList && bulkRejectList.length > 1
                ? `Se aplicará el mismo motivo a ${bulkRejectList.length} cobranzas seleccionadas.`
                : 'Indica el motivo del rechazo; queda guardado en el registro.'}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Ej.: Datos no coinciden, voucher ilegible, duplicado..."
            value={rejectDialog?.reason ?? ''}
            onChange={e =>
              rejectDialog && setRejectDialog({ ...rejectDialog, reason: e.target.value })
            }
            rows={4}
            className="resize-none text-sm"
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setRejectDialog(null);
                setBulkRejectList(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={bulkWorking || !rejectDialog?.reason?.trim()}
              onClick={() => void confirmarRechazoDialog()}
            >
              {bulkWorking ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Procesando...
                </>
              ) : (
                'Confirmar rechazo'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
