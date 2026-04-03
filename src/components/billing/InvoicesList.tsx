import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2, Search, FileText, Receipt, Download, ExternalLink,
  CheckCircle2, XCircle, Clock, AlertCircle, RefreshCw,
  ChevronDown, ChevronUp, Mail, RotateCcw, Users,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

// ── Tipos para el panel de trazabilidad ──────────────────────────────────────
interface InvoiceDetailRow {
  tx_id:          string;
  amount:         number;
  payment_method: string | null;
  type:           string;
  created_at:     string;
  alumno:         string | null;
  padre:          string | null;
}

const PM_LABELS: Record<string, string> = {
  yape: 'Yape', yape_qr: 'Yape QR', yape_numero: 'Yape N°',
  plin: 'Plin', plin_qr: 'Plin QR', plin_numero: 'Plin N°',
  transferencia: 'Transferencia', transfer: 'Transferencia',
  tarjeta: 'Tarjeta', card: 'Tarjeta',
  efectivo: 'Efectivo', saldo: 'Saldo', mixto: 'Mixto', digital: 'Digital',
};

interface Invoice {
  id: string;
  school_id: string;
  invoice_type: 'boleta' | 'factura' | 'nota_credito' | 'nota_debito';
  serie: string;
  numero: number;
  full_number: string;
  client_document_type: string;
  client_document_number: string;
  client_name: string;
  client_email: string | null;
  currency: string;
  subtotal: number;
  igv_amount: number;
  total_amount: number;
  sunat_status: 'pending' | 'processing' | 'accepted' | 'rejected' | 'cancelled' | 'error';
  pdf_url: string | null;
  xml_url: string | null;
  cdr_url: string | null;
  payment_method: string | null;
  emission_date: string;
  notes: string | null;
  created_at: string;
  schools?: { name: string };
}

interface Props {
  /** Si se pasa, filtra solo para esa sede */
  schoolIdFilter?: string;
  /** Modo compacto (para Cobranzas) vs completo (para módulo Facturación) */
  compact?: boolean;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  accepted:   { label: 'Aceptada SUNAT', color: 'bg-green-100 text-green-800',   icon: <CheckCircle2 className="h-3 w-3" /> },
  pending:    { label: 'Pendiente',       color: 'bg-yellow-100 text-yellow-800', icon: <Clock className="h-3 w-3" /> },
  processing: { label: 'Procesando',      color: 'bg-blue-100 text-blue-800',    icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  rejected:   { label: 'Rechazada',       color: 'bg-red-100 text-red-800',      icon: <XCircle className="h-3 w-3" /> },
  cancelled:  { label: 'Anulada',         color: 'bg-gray-100 text-gray-600',    icon: <RotateCcw className="h-3 w-3" /> },
  error:      { label: 'Error',           color: 'bg-red-100 text-red-700',      icon: <AlertCircle className="h-3 w-3" /> },
};

const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  boleta:       { label: 'Boleta',       color: 'bg-blue-100 text-blue-700' },
  factura:      { label: 'Factura',      color: 'bg-indigo-100 text-indigo-700' },
  nota_credito: { label: 'Nota Crédito', color: 'bg-orange-100 text-orange-700' },
  nota_debito:  { label: 'Nota Débito',  color: 'bg-purple-100 text-purple-700' },
};

export const InvoicesList = ({ schoolIdFilter, compact = false }: Props) => {
  const { user } = useAuth();
  const { role } = useRole();
  const { toast } = useToast();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterDate, setFilterDate] = useState('');
  const [schools, setSchools] = useState<{ id: string; name: string }[]>([]);
  const [selectedSchool, setSelectedSchool] = useState(schoolIdFilter || '');
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = compact ? 10 : 20;

  // ── Estado del panel de trazabilidad ─────────────────────────────────────
  const [expandedId, setExpandedId]     = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState<Set<string>>(new Set());
  const [detailCache, setDetailCache]   = useState<Map<string, InvoiceDetailRow[]>>(new Map());

  /** Trae las transacciones vinculadas a una boleta y enriquece con alumno/padre */
  const fetchDetail = async (invoiceId: string) => {
    if (detailCache.has(invoiceId)) return; // ya en caché
    setDetailLoading(prev => new Set([...prev, invoiceId]));
    try {
      // 1. Transacciones de esta boleta
      const { data: txRows, error: txErr } = await supabase
        .from('transactions')
        .select('id, amount, payment_method, type, created_at, student_id')
        .eq('invoice_id', invoiceId)
        .order('created_at', { ascending: true });

      if (txErr) throw txErr;
      if (!txRows || txRows.length === 0) {
        setDetailCache(prev => new Map(prev).set(invoiceId, []));
        return;
      }

      // 2. Nombres de alumnos + parent_id (para llegar al padre)
      const studentIds = [...new Set(txRows.map((r: any) => r.student_id).filter(Boolean))];
      let studentMap = new Map<string, { name: string; parent_id: string | null }>();
      if (studentIds.length > 0) {
        const { data: students } = await supabase
          .from('students')
          .select('id, full_name, parent_id')
          .in('id', studentIds);
        (students ?? []).forEach((s: any) => studentMap.set(s.id, { name: s.full_name, parent_id: s.parent_id }));
      }

      // 3. Nombres de los padres (profiles)
      const parentIds = [...new Set([...studentMap.values()].map(s => s.parent_id).filter(Boolean))] as string[];
      let parentMap = new Map<string, string>();
      if (parentIds.length > 0) {
        const { data: parents } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', parentIds);
        (parents ?? []).forEach((p: any) => parentMap.set(p.id, p.full_name));
      }

      // 4. Armar filas finales
      const rows: InvoiceDetailRow[] = txRows.map((tx: any) => {
        const student = tx.student_id ? studentMap.get(tx.student_id) : null;
        const parentName = student?.parent_id ? parentMap.get(student.parent_id) ?? null : null;
        return {
          tx_id:          tx.id,
          amount:         Math.abs(tx.amount),
          payment_method: tx.payment_method,
          type:           tx.type,
          created_at:     tx.created_at,
          alumno:         student?.name ?? null,
          padre:          parentName,
        };
      });

      setDetailCache(prev => new Map(prev).set(invoiceId, rows));
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error al cargar detalle', description: err.message });
    } finally {
      setDetailLoading(prev => { const n = new Set(prev); n.delete(invoiceId); return n; });
    }
  };

  const toggleDetail = (invoiceId: string) => {
    if (expandedId === invoiceId) {
      setExpandedId(null);
    } else {
      setExpandedId(invoiceId);
      fetchDetail(invoiceId);
    }
  };

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from('invoices')
        .select('*, schools(name)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

      // Filtros
      if (selectedSchool) query = query.eq('school_id', selectedSchool);
      if (filterType !== 'all') query = query.eq('invoice_type', filterType);
      if (filterStatus !== 'all') query = query.eq('sunat_status', filterStatus);
      if (filterDate) {
        const [year, month] = filterDate.split('-');
        const startDate = `${year}-${month}-01`;
        const endDate = new Date(Number(year), Number(month), 0).toISOString().split('T')[0];
        query = query.gte('emission_date', startDate).lte('emission_date', endDate);
      }
      if (search.trim()) {
        query = query.or(`client_name.ilike.%${search}%,client_document_number.ilike.%${search}%,full_number.ilike.%${search}%`);
      }

      const { data, error, count } = await query;
      if (error) throw error;
      setInvoices(data || []);
      setTotalPages(Math.ceil((count || 0) / PAGE_SIZE));
    } catch (err: any) {
      console.error('Error cargando comprobantes:', err);
      toast({ title: 'Error al cargar comprobantes', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [page, selectedSchool, filterType, filterStatus, filterDate, search]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  useEffect(() => {
    if (role === 'admin_general' || role === 'superadmin') {
      supabase.from('schools').select('id, name').order('name').then(({ data }) => {
        setSchools(data || []);
      });
    }
  }, [role]);

  const handleSendEmail = async (invoice: Invoice) => {
    if (!invoice.client_email) {
      toast({ title: 'Sin email', description: 'Este cliente no tiene email registrado.', variant: 'destructive' });
      return;
    }
    toast({ title: '📧 Enviando...', description: `Enviando PDF a ${invoice.client_email}` });
    // TODO: invocar edge function de envío de email
  };

  // Totales del período
  const totalEmitido = invoices.filter(i => i.sunat_status === 'accepted').reduce((s, i) => s + i.total_amount, 0);
  const totalIGV     = invoices.filter(i => i.sunat_status === 'accepted').reduce((s, i) => s + i.igv_amount, 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <FileText className="h-5 w-5 text-indigo-600" />
            Comprobantes Electrónicos
          </h2>
          <p className="text-sm text-gray-500">Boletas, facturas y notas de crédito emitidas</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchInvoices} className="gap-2 self-end sm:self-auto">
          <RefreshCw className="h-4 w-4" /> Actualizar
        </Button>
      </div>

      {/* Resumen rápido */}
      {!compact && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total emitido', value: `S/ ${totalEmitido.toFixed(2)}`, color: 'text-green-700', bg: 'bg-green-50 border-green-200' },
            { label: 'IGV del período', value: `S/ ${totalIGV.toFixed(2)}`, color: 'text-indigo-700', bg: 'bg-indigo-50 border-indigo-200' },
            { label: 'Documentos', value: invoices.length.toString(), color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
            { label: 'Aceptadas SUNAT', value: invoices.filter(i => i.sunat_status === 'accepted').length.toString(), color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
          ].map((stat) => (
            <div key={stat.label} className={`rounded-xl border p-3 ${stat.bg}`}>
              <p className="text-xs text-gray-500">{stat.label}</p>
              <p className={`text-xl font-bold ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Buscar por nombre, RUC/DNI o número..."
            className="pl-9"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <Input
          type="month"
          value={filterDate}
          onChange={(e) => { setFilterDate(e.target.value); setPage(1); }}
          className="w-40"
        />
        <select
          value={filterType}
          onChange={(e) => { setFilterType(e.target.value); setPage(1); }}
          className="h-10 rounded-md border border-input bg-white px-3 text-sm"
        >
          <option value="all">Todos los tipos</option>
          <option value="boleta">Boletas</option>
          <option value="factura">Facturas</option>
          <option value="nota_credito">Notas de Crédito</option>
        </select>
        <select
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
          className="h-10 rounded-md border border-input bg-white px-3 text-sm"
        >
          <option value="all">Todos los estados</option>
          <option value="accepted">Aceptadas SUNAT</option>
          <option value="pending">Pendientes</option>
          <option value="processing">Procesando</option>
          <option value="rejected">Rechazadas</option>
          <option value="error">Error de sistema</option>
          <option value="cancelled">Anuladas</option>
        </select>
        {(role === 'admin_general' || role === 'superadmin') && !schoolIdFilter && schools.length > 0 && (
          <select
            value={selectedSchool}
            onChange={(e) => { setSelectedSchool(e.target.value); setPage(1); }}
            className="h-10 rounded-md border border-input bg-white px-3 text-sm"
          >
            <option value="">Todas las sedes</option>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Tabla */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        </div>
      ) : invoices.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No hay comprobantes para los filtros seleccionados</p>
          <p className="text-sm mt-1">Genera una boleta o factura desde el POS o Cobranzas</p>
        </div>
      ) : (
        <div className="space-y-2">
          {invoices.map((inv) => {
            const status     = STATUS_CONFIG[inv.sunat_status] || STATUS_CONFIG['pending'];
            const type       = TYPE_CONFIG[inv.invoice_type]   || TYPE_CONFIG['boleta'];
            const isExpanded = expandedId === inv.id;
            const isLoadingDetail = detailLoading.has(inv.id);
            const detailRows = detailCache.get(inv.id) ?? null;
            const isResumen  = inv.client_name === 'Consumidor Final';

            return (
              <Card key={inv.id} className={`border transition-shadow ${isExpanded ? 'shadow-md' : 'hover:shadow-md'}`}>
                <CardContent className="p-3 sm:p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    {/* Número y tipo */}
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={`rounded-lg p-2 shrink-0 ${inv.invoice_type === 'factura' ? 'bg-indigo-100' : 'bg-blue-100'}`}>
                        {inv.invoice_type === 'factura'
                          ? <FileText className="h-5 w-5 text-indigo-600" />
                          : <Receipt className="h-5 w-5 text-blue-600" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-sm">{inv.full_number || `${inv.serie}-${String(inv.numero).padStart(8,'0')}`}</span>
                          <Badge className={`text-[10px] px-1.5 py-0 ${type.color}`}>{type.label}</Badge>
                          <Badge className={`text-[10px] px-1.5 py-0 flex items-center gap-1 ${status.color}`}>
                            {status.icon} {status.label}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-700 font-medium truncate mt-0.5">{inv.client_name}</p>
                        <p className="text-xs text-gray-400">
                          {inv.client_document_type?.toUpperCase()} {inv.client_document_number} •{' '}
                          {format(parseISO(inv.emission_date), 'dd MMM yyyy', { locale: es })}
                          {inv.schools?.name && ` • ${inv.schools.name}`}
                        </p>
                      </div>
                    </div>

                    {/* Monto */}
                    <div className="text-right shrink-0">
                      <p className="text-lg font-bold text-gray-900">S/ {inv.total_amount.toFixed(2)}</p>
                      <p className="text-xs text-gray-400">IGV: S/ {inv.igv_amount.toFixed(2)}</p>
                    </div>

                    {/* Acciones */}
                    <div className="flex items-center gap-2 shrink-0">
                      {inv.pdf_url && (
                        <a href={inv.pdf_url} target="_blank" rel="noopener noreferrer" title="Ver PDF">
                          <Button variant="outline" size="sm" className="gap-1 text-blue-600 border-blue-300 hover:bg-blue-50">
                            <Download className="h-3.5 w-3.5" /> PDF
                          </Button>
                        </a>
                      )}
                      {inv.xml_url && (
                        <a href={inv.xml_url} target="_blank" rel="noopener noreferrer" title="Descargar XML">
                          <Button variant="outline" size="sm" className="gap-1 text-gray-600">
                            <ExternalLink className="h-3.5 w-3.5" /> XML
                          </Button>
                        </a>
                      )}
                      {inv.client_email && inv.pdf_url && (
                        <Button
                          variant="outline" size="sm"
                          onClick={() => handleSendEmail(inv)}
                          title={`Enviar a ${inv.client_email}`}
                          className="gap-1 text-emerald-600 border-emerald-300 hover:bg-emerald-50"
                        >
                          <Mail className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {/* Botón de trazabilidad — solo boletas con invoice_id vinculado */}
                      <Button
                        variant="outline" size="sm"
                        onClick={() => toggleDetail(inv.id)}
                        title="Ver pagos vinculados a esta boleta"
                        className={`gap-1 ${isExpanded
                          ? 'text-indigo-700 border-indigo-400 bg-indigo-50'
                          : 'text-indigo-600 border-indigo-300 hover:bg-indigo-50'}`}
                      >
                        {isLoadingDetail
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : isExpanded
                            ? <ChevronUp className="h-3.5 w-3.5" />
                            : <ChevronDown className="h-3.5 w-3.5" />}
                        <Users className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Nota si hay error o modo demo */}
                  {inv.notes && (
                    <p className="text-xs text-amber-600 mt-2 bg-amber-50 rounded px-2 py-1">{inv.notes}</p>
                  )}

                  {/* ── Panel de Trazabilidad de Auditoría ─────────────────────── */}
                  {isExpanded && (
                    <div className="mt-3 border-t pt-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Users className="h-4 w-4 text-indigo-500" />
                        <span className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">
                          Pagos vinculados a esta boleta
                        </span>
                        {isResumen && (
                          <Badge className="text-[10px] px-1.5 py-0 bg-gray-100 text-gray-500">
                            Boleta Resumen
                          </Badge>
                        )}
                      </div>

                      {isLoadingDetail ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="h-5 w-5 animate-spin text-indigo-400" />
                        </div>
                      ) : !detailRows || detailRows.length === 0 ? (
                        <p className="text-xs text-gray-400 italic py-2 text-center">
                          No hay transacciones vinculadas a esta boleta en la base de datos.
                        </p>
                      ) : (
                        <>
                          <div className="overflow-x-auto rounded-md border border-gray-100">
                            <table className="w-full text-xs">
                              <thead className="bg-gray-50 text-gray-500 uppercase tracking-wide">
                                <tr>
                                  <th className="px-3 py-2 text-left font-semibold">Alumno</th>
                                  <th className="px-3 py-2 text-left font-semibold">Padre / Tutor</th>
                                  <th className="px-3 py-2 text-left font-semibold">Método</th>
                                  <th className="px-3 py-2 text-left font-semibold">Tipo</th>
                                  <th className="px-3 py-2 text-right font-semibold">Monto S/</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-50">
                                {detailRows.map((row) => (
                                  <tr key={row.tx_id} className="hover:bg-indigo-50/40">
                                    <td className="px-3 py-2 text-gray-800">
                                      {row.alumno ?? <span className="text-gray-400 italic">—</span>}
                                    </td>
                                    <td className="px-3 py-2 text-gray-600">
                                      {row.padre ?? <span className="text-gray-400 italic">—</span>}
                                    </td>
                                    <td className="px-3 py-2">
                                      <span className="inline-block bg-blue-50 text-blue-700 rounded px-1.5 py-0.5 font-medium">
                                        {PM_LABELS[row.payment_method ?? ''] ?? row.payment_method ?? '—'}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2 text-gray-500 capitalize">{row.type}</td>
                                    <td className="px-3 py-2 text-right font-semibold text-gray-800">
                                      {row.amount.toFixed(2)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot className="bg-indigo-50 border-t border-indigo-100">
                                <tr>
                                  <td colSpan={4} className="px-3 py-2 text-xs font-semibold text-indigo-700">
                                    Total vinculado ({detailRows.length} pago{detailRows.length !== 1 ? 's' : ''})
                                  </td>
                                  <td className="px-3 py-2 text-right font-bold text-indigo-800">
                                    {detailRows.reduce((s, r) => s + r.amount, 0).toFixed(2)}
                                  </td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                          <p className="text-[10px] text-gray-400 mt-1.5 text-right">
                            ID boleta: <span className="font-mono">{inv.id}</span>
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
            ← Anterior
          </Button>
          <span className="text-sm text-gray-500">Página {page} de {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
            Siguiente →
          </Button>
        </div>
      )}
    </div>
  );
};
