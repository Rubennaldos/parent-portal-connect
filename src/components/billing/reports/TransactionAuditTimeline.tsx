import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, Clock, PlusCircle, Edit3, Trash2, ChevronDown, ChevronUp, ShieldAlert } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Button } from '@/components/ui/button';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AuditLog {
  id: string;
  table_name: string;
  record_id: string;
  action_type: 'INSERT' | 'UPDATE' | 'DELETE';
  old_data: Record<string, any> | null;
  new_data: Record<string, any> | null;
  changed_by_user_id: string | null;
  school_id: string | null;
  created_at: string;
  // Enriquecido desde profiles
  actor_name?: string;
  actor_role?: string;
}

interface Props {
  transactionId: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  INSERT:  { label: 'Creado',      color: 'text-green-700',  bg: 'bg-green-100',  border: 'border-green-300' },
  UPDATE:  { label: 'Modificado',  color: 'text-blue-700',   bg: 'bg-blue-100',   border: 'border-blue-300'  },
  DELETE:  { label: 'Eliminado',   color: 'text-red-700',    bg: 'bg-red-100',    border: 'border-red-300'   },
};

const ROLE_LABELS: Record<string, string> = {
  admin_general: 'Administrador General',
  supervisor_red: 'Supervisor de Red',
  gestor_unidad: 'Gestor de Unidad',
  operador_caja: 'Cajero',
  kitchen: 'Cocina',
  teacher: 'Profesor',
  parent: 'Padre de Familia',
};

/** Campos que NO queremos mostrar en el diff por ser ruido técnico */
const IGNORED_FIELDS = new Set([
  'id', 'created_at', 'updated_at', 'school_id', 'student_id', 'teacher_id',
  'created_by', 'balance_after', 'metadata',
]);

/** Mapea nombres de columnas a etiquetas legibles */
const FIELD_LABELS: Record<string, string> = {
  payment_status:  'Estado de pago',
  payment_method:  'Método de pago',
  amount:          'Monto',
  is_deleted:      'Eliminado',
  description:     'Descripción',
  operation_number:'N° de operación',
  ticket_code:     'N° de ticket',
  document_type:   'Tipo de documento',
  type:            'Tipo de transacción',
};

const STATUS_LABELS: Record<string, string> = {
  pending:   '⏳ Pendiente',
  partial:   '🔸 Parcial',
  paid:      '✅ Pagado',
  cancelled: '❌ Cancelado',
};

const formatValue = (field: string, value: any): string => {
  if (value === null || value === undefined) return '—';
  if (field === 'payment_status') return STATUS_LABELS[value] || value;
  if (field === 'is_deleted') return value ? 'Sí' : 'No';
  if (field === 'amount') return `S/ ${Math.abs(Number(value)).toFixed(2)}`;
  return String(value);
};

/**
 * Compara old_data y new_data y devuelve los campos que cambiaron
 * (excluyendo campos de ruido técnico)
 */
const getDiff = (
  oldData: Record<string, any> | null,
  newData: Record<string, any> | null,
): Array<{ field: string; label: string; from: string; to: string }> => {
  if (!oldData || !newData) return [];

  return Object.keys(newData)
    .filter((key) => {
      if (IGNORED_FIELDS.has(key)) return false;
      const oldVal = JSON.stringify(oldData[key]);
      const newVal = JSON.stringify(newData[key]);
      return oldVal !== newVal;
    })
    .map((key) => ({
      field: key,
      label: FIELD_LABELS[key] || key,
      from: formatValue(key, oldData[key]),
      to:   formatValue(key, newData[key]),
    }));
};

// ─── Component ───────────────────────────────────────────────────────────────

export const TransactionAuditTimeline = ({ transactionId }: Props) => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!transactionId) return;
    fetchLogs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionId]);

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);

    try {
      // 1. Traer los logs de auditoría para esta transacción
      const { data: auditRows, error: auditError } = await supabase
        .from('audit_billing_logs')
        .select('*')
        .eq('record_id', transactionId)
        .order('created_at', { ascending: true });

      if (auditError) throw auditError;
      if (!auditRows || auditRows.length === 0) {
        setLogs([]);
        return;
      }

      // 2. Enriquecer con nombres de usuarios (JOIN manual al frontend)
      const userIds = [...new Set(
        auditRows.map((r: any) => r.changed_by_user_id).filter(Boolean)
      )];

      const actorMap = new Map<string, { name: string; role: string }>();

      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, email, role')
          .in('id', userIds);

        profiles?.forEach((p: any) => {
          actorMap.set(p.id, {
            name: p.full_name || p.email || 'Usuario',
            role: ROLE_LABELS[p.role] || p.role || 'Usuario',
          });
        });

        // También buscar en teacher_profiles por si el actor es un profesor
        const missingIds = userIds.filter((id) => !actorMap.has(id));
        if (missingIds.length > 0) {
          const { data: teacherProfs } = await supabase
            .from('teacher_profiles')
            .select('id, full_name')
            .in('id', missingIds);

          teacherProfs?.forEach((tp: any) => {
            actorMap.set(tp.id, { name: tp.full_name || 'Profesor', role: 'Profesor' });
          });
        }
      }

      const enriched: AuditLog[] = auditRows.map((row: any) => ({
        ...row,
        actor_name: row.changed_by_user_id
          ? actorMap.get(row.changed_by_user_id)?.name || 'Usuario desconocido'
          : 'Sistema / Automático',
        actor_role: row.changed_by_user_id
          ? actorMap.get(row.changed_by_user_id)?.role || ''
          : '',
      }));

      setLogs(enriched);
    } catch (err: any) {
      console.error('[TransactionAuditTimeline] Error:', err);
      setError('No se pudo cargar el historial de auditoría.');
    } finally {
      setLoading(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="mt-2">
      {/* Cabecera colapsable */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
      >
        <span className="flex items-center gap-2 font-semibold text-slate-700 text-sm">
          <ShieldAlert className="h-4 w-4 text-slate-500" />
          Historial de Auditoría
          {!loading && logs.length > 0 && (
            <span className="bg-slate-200 text-slate-600 text-xs px-2 py-0.5 rounded-full">
              {logs.length} {logs.length === 1 ? 'evento' : 'eventos'}
            </span>
          )}
        </span>
        {expanded
          ? <ChevronUp className="h-4 w-4 text-slate-500" />
          : <ChevronDown className="h-4 w-4 text-slate-500" />
        }
      </button>

      {/* Contenido expandido */}
      {expanded && (
        <div className="mt-2 border border-slate-200 rounded-lg p-4 bg-white">
          {/* Estado de carga */}
          {loading && (
            <div className="flex items-center justify-center py-8 gap-3 text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Cargando historial...</span>
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div className="flex items-center gap-2 py-4 px-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              <ShieldAlert className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Sin registros */}
          {!loading && !error && logs.length === 0 && (
            <div className="flex items-center gap-2 py-6 text-slate-400 text-sm justify-center">
              <Clock className="h-4 w-4" />
              <span>No hay registros de auditoría para esta transacción.</span>
              <span className="text-xs text-slate-300">(Los triggers se activan desde la Fase 1 en adelante)</span>
            </div>
          )}

          {/* Línea de tiempo */}
          {!loading && !error && logs.length > 0 && (
            <ol className="relative border-l border-slate-200 ml-3 space-y-6">
              {logs.map((log, idx) => {
                const actionMeta = ACTION_LABELS[log.action_type] || ACTION_LABELS.UPDATE;
                const diff = getDiff(log.old_data, log.new_data);
                const isLast = idx === logs.length - 1;

                return (
                  <li key={log.id} className="ml-6">
                    {/* Icono del nodo */}
                    <span className={`absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full border-2 ${actionMeta.bg} ${actionMeta.border}`}>
                      {log.action_type === 'INSERT' && <PlusCircle className={`h-3.5 w-3.5 ${actionMeta.color}`} />}
                      {log.action_type === 'UPDATE' && <Edit3   className={`h-3.5 w-3.5 ${actionMeta.color}`} />}
                      {log.action_type === 'DELETE' && <Trash2  className={`h-3.5 w-3.5 ${actionMeta.color}`} />}
                    </span>

                    {/* Cabecera del evento */}
                    <div className="flex items-start justify-between flex-wrap gap-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${actionMeta.bg} ${actionMeta.color} ${actionMeta.border} border`}>
                          {actionMeta.label}
                        </span>
                        <span className="text-sm font-semibold text-slate-800">
                          {log.actor_name}
                        </span>
                        {log.actor_role && (
                          <span className="text-xs text-slate-500">({log.actor_role})</span>
                        )}
                      </div>
                      <time className="text-xs text-slate-400 whitespace-nowrap">
                        {format(new Date(log.created_at), "dd/MM/yyyy 'a las' HH:mm:ss", { locale: es })}
                      </time>
                    </div>

                    {/* INSERT: mostrar datos iniciales clave */}
                    {log.action_type === 'INSERT' && log.new_data && (
                      <div className="mt-1.5 space-y-1">
                        {(['payment_status', 'amount', 'payment_method', 'description'] as const)
                          .filter((f) => log.new_data![f] !== null && log.new_data![f] !== undefined)
                          .map((f) => (
                            <p key={f} className="text-xs text-slate-600">
                              <span className="font-medium">{FIELD_LABELS[f] || f}:</span>{' '}
                              <span className="text-slate-800">{formatValue(f, log.new_data![f])}</span>
                            </p>
                          ))}
                      </div>
                    )}

                    {/* UPDATE: mostrar diff de campos */}
                    {log.action_type === 'UPDATE' && (
                      <div className="mt-1.5">
                        {diff.length === 0 ? (
                          <p className="text-xs text-slate-400 italic">Sin cambios relevantes detectados</p>
                        ) : (
                          <ul className="space-y-1">
                            {diff.map(({ field, label, from, to }) => (
                              <li key={field} className="flex items-center gap-1.5 flex-wrap text-xs">
                                <span className="font-medium text-slate-600">{label}:</span>
                                <span className="line-through text-red-500 bg-red-50 px-1.5 py-0.5 rounded">
                                  {from}
                                </span>
                                <span className="text-slate-400">→</span>
                                <span className="text-green-700 bg-green-50 px-1.5 py-0.5 rounded font-semibold">
                                  {to}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {/* DELETE: aviso con datos anteriores */}
                    {log.action_type === 'DELETE' && (
                      <div className="mt-1.5 bg-red-50 border border-red-200 rounded px-3 py-2">
                        <p className="text-xs text-red-600 font-medium">⚠️ Registro eliminado (soft delete)</p>
                        {log.old_data?.payment_status && (
                          <p className="text-xs text-slate-600 mt-1">
                            Estado anterior: <span className="font-semibold">{formatValue('payment_status', log.old_data.payment_status)}</span>
                          </p>
                        )}
                      </div>
                    )}

                    {/* Separador visual entre eventos (no en el último) */}
                    {!isLast && <div className="mt-4" />}
                  </li>
                );
              })}
            </ol>
          )}

          {/* Botón refrescar */}
          {!loading && (
            <div className="mt-4 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-slate-500 hover:text-slate-700"
                onClick={fetchLogs}
              >
                <Clock className="h-3 w-3 mr-1" />
                Actualizar historial
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
