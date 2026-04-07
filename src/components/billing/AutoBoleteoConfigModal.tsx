import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2, Settings2, Clock, CheckCircle2,
  AlertCircle, Calendar, Info,
} from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  schoolId: string;
  schoolName: string;
}

interface LogEntry {
  fecha_proceso: string;
  estado: string;
  dias_emitidos: number;
  monto_total: number;
  detalle?: { errores?: string[] };
}

export function AutoBoleteoConfigModal({ open, onClose, schoolId, schoolName }: Props) {
  const { toast } = useToast();
  const [activa, setActiva]       = useState(false);
  const [hora, setHora]           = useState('23:00');
  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [logs, setLogs]           = useState<LogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // ── Cargar configuración actual y últimos logs al abrir ──────────────────────
  useEffect(() => {
    if (!open || !schoolId) return;

    setLoading(true);
    Promise.all([
      supabase
        .from('schools')
        .select('auto_facturacion_activa, hora_cierre_diario')
        .eq('id', schoolId)
        .single(),
      fetchLogs(),
    ]).then(([{ data }]) => {
      if (data) {
        setActiva(data.auto_facturacion_activa ?? false);
        // hora_cierre_diario llega como 'HH:MM:SS' desde Postgres → recortar a 'HH:MM'
        setHora((data.hora_cierre_diario as string | null)?.slice(0, 5) ?? '23:00');
      }
    }).finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, schoolId]);

  const fetchLogs = async () => {
    setLoadingLogs(true);
    const hace7dias = new Date();
    hace7dias.setDate(hace7dias.getDate() - 7);
    const { data } = await supabase
      .from('logs_auto_facturacion')
      .select('fecha_proceso, estado, dias_emitidos, monto_total, detalle')
      .eq('school_id', schoolId)
      .gte('fecha_proceso', hace7dias.toISOString().split('T')[0])
      .order('fecha_proceso', { ascending: false })
      .limit(7);
    setLogs(data ?? []);
    setLoadingLogs(false);
  };

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('schools')
      .update({
        auto_facturacion_activa: activa,
        hora_cierre_diario:      hora + ':00',
      })
      .eq('id', schoolId);
    setSaving(false);

    if (error) {
      toast({ variant: 'destructive', title: 'Error al guardar', description: error.message });
      return;
    }

    toast({
      title: activa ? '✅ Auto-boleteo activado' : '⏸ Auto-boleteo desactivado',
      description: activa
        ? `Se emitirán las boletas pendientes todos los días a las ${hora} (hora Lima).`
        : `El boleteo automático está pausado para ${schoolName}.`,
    });
    onClose();
  };

  const estadoBadge = (estado: string) => {
    const map: Record<string, { label: string; className: string }> = {
      ok:             { label: 'OK',            className: 'bg-green-100 text-green-800 border-green-200' },
      error:          { label: 'Error',         className: 'bg-red-100 text-red-800 border-red-200' },
      sin_pendientes: { label: 'Sin pendientes',className: 'bg-gray-100 text-gray-600 border-gray-200' },
      ya_procesado:   { label: 'Ya procesado',  className: 'bg-blue-100 text-blue-700 border-blue-200' },
    };
    const cfg = map[estado] ?? { label: estado, className: 'bg-gray-100 text-gray-600' };
    return (
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cfg.className}`}>
        {cfg.label}
      </span>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Settings2 className="h-5 w-5 text-indigo-600" />
            Auto-Boleteo Diario
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
          </div>
        ) : (
          <div className="space-y-5 py-1">
            {/* Sede */}
            <p className="text-sm text-gray-500">
              Sede: <strong className="text-gray-800">{schoolName}</strong>
            </p>

            {/* Switch principal */}
            <div className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div>
                <Label className="text-sm font-semibold text-gray-800">
                  Boleteo Automático
                </Label>
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                  El sistema emitirá automáticamente todas las boletas pendientes
                  del mes a la hora que configures.
                </p>
              </div>
              <Switch
                checked={activa}
                onCheckedChange={setActiva}
                className="shrink-0 mt-0.5"
              />
            </div>

            {/* Hora — solo visible si está activo */}
            {activa && (
              <div className="space-y-1.5">
                <Label htmlFor="hora-cierre" className="text-sm font-semibold flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-indigo-500" />
                  Hora del cierre (hora Lima — UTC-5)
                </Label>
                <input
                  id="hora-cierre"
                  type="time"
                  value={hora}
                  onChange={(e) => setHora(e.target.value)}
                  className="h-9 w-full rounded-md border border-indigo-300 px-3 text-sm bg-white text-indigo-800 font-medium"
                />
                <div className="flex items-start gap-1.5 rounded-md bg-indigo-50 border border-indigo-100 p-2">
                  <Info className="h-3.5 w-3.5 text-indigo-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-indigo-700">
                    El sistema procesará todos los días del mes que tengan
                    ventas digitales pendientes (Yape, Plin, Transferencia, Tarjeta).
                    Si no hay pendientes, no hace nada.
                  </p>
                </div>
              </div>
            )}

            {/* Últimos logs */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-600 flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  Últimas ejecuciones (7 días)
                </p>
                <button
                  onClick={fetchLogs}
                  className="text-xs text-indigo-600 hover:underline"
                  type="button"
                >
                  Actualizar
                </button>
              </div>

              {loadingLogs ? (
                <div className="flex justify-center py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                </div>
              ) : logs.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-3">
                  Sin ejecuciones registradas aún.
                </p>
              ) : (
                <div className="divide-y divide-gray-100 rounded-md border border-gray-200 overflow-hidden">
                  {logs.map((log) => (
                    <div key={log.fecha_proceso} className="flex items-center justify-between px-3 py-2 bg-white">
                      <div>
                        <p className="text-xs font-medium text-gray-700">{log.fecha_proceso}</p>
                        {log.estado === 'ok' && (
                          <p className="text-xs text-gray-500">
                            {log.dias_emitidos} día{log.dias_emitidos !== 1 ? 's' : ''} · S/ {Number(log.monto_total).toFixed(2)}
                          </p>
                        )}
                        {log.detalle?.errores && log.detalle.errores.length > 0 && (
                          <p className="text-xs text-red-600 mt-0.5 truncate max-w-[220px]" title={log.detalle.errores[0]}>
                            {log.detalle.errores[0]}
                          </p>
                        )}
                      </div>
                      {estadoBadge(log.estado)}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Botones */}
            <div className="flex justify-end gap-2 pt-1 border-t border-gray-100">
              <Button variant="outline" size="sm" onClick={onClose}>
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                {saving
                  ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Guardando…</>
                  : <><CheckCircle2 className="h-4 w-4 mr-1.5" /> Guardar</>
                }
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
