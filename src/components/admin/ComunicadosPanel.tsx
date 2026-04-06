import { useState, useEffect, useCallback } from 'react';
import {
  Send, Bell, Loader2, CheckCircle2, Users, User,
  Info, Clock, AlertTriangle, CreditCard, Trash2,
  RefreshCw, Building2, Globe,
} from 'lucide-react';
import { Button }   from '@/components/ui/button';
import { Input }    from '@/components/ui/input';
import { Label }    from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge }    from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type NotifType = 'info' | 'reminder' | 'alert' | 'payment';

interface SentNotification {
  id:         string;
  title:      string;
  message:    string;
  type:       NotifType;
  user_id:    string | null;
  school_id:  string | null;
  created_at: string;
  school_name?: string;
}

interface ParentOption {
  id:        string;
  full_name: string;
  email:     string;
}

interface School {
  id:   string;
  name: string;
}

interface ComunicadosPanelProps {
  schoolId?:         string | null;
  canViewAllSchools?: boolean;
  schools?:          School[];
}

// ─── Configuración visual ─────────────────────────────────────────────────────

const TYPE_OPTIONS: { value: NotifType; label: string; desc: string; Icon: any; color: string; bg: string }[] = [
  { value: 'info',     label: 'Informativo', desc: 'Avisos generales del colegio',        Icon: Info,          color: 'text-blue-600',    bg: 'bg-blue-50    border-blue-200'    },
  { value: 'reminder', label: 'Recordatorio', desc: 'Fechas, eventos o tareas pendientes', Icon: Clock,         color: 'text-amber-600',   bg: 'bg-amber-50   border-amber-200'   },
  { value: 'alert',    label: 'Alerta',       desc: 'Avisos urgentes o importantes',        Icon: AlertTriangle, color: 'text-red-600',     bg: 'bg-red-50     border-red-200'     },
  { value: 'payment',  label: 'Cobranza',     desc: 'Recordatorio de pagos pendientes',     Icon: CreditCard,    color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' },
];

function timeAgo(isoDate: string) {
  const diff = (Date.now() - new Date(isoDate).getTime()) / 1000;
  if (diff < 3600)  return `Hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `Hace ${Math.floor(diff / 3600)}h`;
  return new Date(isoDate).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: '2-digit' });
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function ComunicadosPanel({
  schoolId,
  canViewAllSchools = false,
  schools = [],
}: ComunicadosPanelProps) {
  const { toast } = useToast();

  // ── Selección de sede (admin_general puede cambiarla) ──────────────────────
  const [selectedSchoolId, setSelectedSchoolId] = useState<string | null>(schoolId ?? null);

  // Sincronizar si el prop schoolId cambia en runtime
  useEffect(() => {
    if (schoolId && !selectedSchoolId) setSelectedSchoolId(schoolId);
  }, [schoolId]);

  // ── Estado del formulario ──────────────────────────────────────────────────
  const [title,          setTitle]          = useState('');
  const [message,        setMessage]        = useState('');
  const [type,           setType]           = useState<NotifType>('info');
  const [recipient,      setRecipient]      = useState<'all' | 'parent'>('all');
  const [parentSearch,   setParentSearch]   = useState('');
  const [selectedParent, setSelectedParent] = useState<ParentOption | null>(null);
  const [parentResults,  setParentResults]  = useState<ParentOption[]>([]);
  const [searching,      setSearching]      = useState(false);
  const [sending,        setSending]        = useState(false);
  const [sent,           setSent]           = useState(false);

  // ── Historial ──────────────────────────────────────────────────────────────
  const [history,        setHistory]        = useState<SentNotification[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      let query = supabase
        .from('in_app_notifications')
        .select('id, title, message, type, user_id, school_id, created_at')
        .order('created_at', { ascending: false })
        .limit(50);

      if (selectedSchoolId) {
        // Admin de sede O admin_general con sede seleccionada
        query = query.eq('school_id', selectedSchoolId);
      } else if (!canViewAllSchools) {
        // Sin sede y sin permisos globales: no mostrar nada
        setHistory([]);
        setLoadingHistory(false);
        return;
      }
      // Si canViewAllSchools y sin sede seleccionada → trae todo (RLS lo restringe igualmente)

      const { data, error } = await query;
      if (error) throw error;

      // Enriquecer con nombre de sede si hay lista de schools
      const enriched: SentNotification[] = (data ?? []).map((n: any) => ({
        ...n,
        school_name: schools.find(s => s.id === n.school_id)?.name ?? (n.school_id ? 'Otra sede' : 'Global'),
      }));
      setHistory(enriched);
    } catch (err: any) {
      console.error('Error cargando historial:', err);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo cargar el historial.' });
    } finally {
      setLoadingHistory(false);
    }
  }, [selectedSchoolId, canViewAllSchools, schools, toast]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  // ── Buscar padres ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (recipient !== 'parent') { setParentResults([]); return; }
    if (parentSearch.length < 2) { setParentResults([]); return; }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        let q = supabase
          .from('profiles')
          .select('id, full_name, email')
          .eq('role', 'parent')
          .ilike('full_name', `%${parentSearch}%`)
          .limit(8);

        // Admin de sede: filtrar solo padres con hijos en esa sede
        if (!canViewAllSchools && selectedSchoolId) {
          const { data: studentData } = await supabase
            .from('students')
            .select('parent_id')
            .eq('school_id', selectedSchoolId)
            .eq('is_active', true);
          const parentIds = (studentData ?? []).map((s: any) => s.parent_id).filter(Boolean);
          if (parentIds.length === 0) { setParentResults([]); setSearching(false); return; }
          q = q.in('id', parentIds);
        }

        const { data } = await q;
        setParentResults((data ?? []) as ParentOption[]);
      } catch { setParentResults([]); }
      finally { setSearching(false); }
    }, 350);

    return () => clearTimeout(timer);
  }, [parentSearch, recipient, canViewAllSchools, selectedSchoolId]);

  // ── Enviar comunicado ──────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!title.trim() || !message.trim()) {
      toast({ variant: 'destructive', title: 'Campos requeridos', description: 'El asunto y el mensaje son obligatorios.' });
      return;
    }
    if (recipient === 'parent' && !selectedParent) {
      toast({ variant: 'destructive', title: 'Selecciona un padre', description: 'Escribe y elige el destinatario específico.' });
      return;
    }
    // Debe haber sede seleccionada (excepto admin_general que puede enviar sin filtro)
    if (!canViewAllSchools && !selectedSchoolId) {
      toast({ variant: 'destructive', title: 'Sin sede', description: 'No se encontró la sede asignada.' });
      return;
    }

    setSending(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const payload = {
        school_id: selectedSchoolId,
        user_id:   recipient === 'parent' ? selectedParent!.id : null,
        title:     title.trim(),
        message:   message.trim(),
        type,
        is_read:   false,
        sent_by:   user?.id ?? null,
      };

      const { error } = await supabase.from('in_app_notifications').insert([payload]);
      if (error) throw error;

      setSent(true);
      const destLabel = recipient === 'all'
        ? (selectedSchoolId
            ? `todos los padres de ${schools.find(s => s.id === selectedSchoolId)?.name ?? 'la sede'}`
            : 'todos los padres del sistema')
        : selectedParent!.full_name;

      toast({ title: '✅ Comunicado enviado', description: `Mensaje enviado a ${destLabel}.` });

      setTimeout(() => {
        setTitle(''); setMessage(''); setType('info');
        setRecipient('all'); setSelectedParent(null); setParentSearch('');
        setSent(false);
        fetchHistory();
      }, 1800);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error al enviar', description: err?.message || 'No se pudo enviar el comunicado.' });
    } finally {
      setSending(false);
    }
  };

  // ── Eliminar comunicado ────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('in_app_notifications').delete().eq('id', id);
    if (!error) {
      setHistory(prev => prev.filter(n => n.id !== id));
      toast({ title: 'Comunicado eliminado' });
    }
  };

  const charLeft = 600 - message.length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

      {/* ── FORMULARIO ── */}
      <div className="lg:col-span-2 space-y-5">
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-5 shadow-sm">

          {/* Encabezado */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-100 to-blue-100 flex items-center justify-center">
              <Bell className="h-4.5 w-4.5 text-indigo-600" style={{ width: 18, height: 18 }} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">Nuevo Comunicado</h3>
              <p className="text-[11px] text-slate-400">Los padres verán el mensaje en su portal</p>
            </div>
          </div>

          {/* Selector de sede (solo admin_general) */}
          {canViewAllSchools && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Sede destino</Label>
              <select
                value={selectedSchoolId ?? ''}
                onChange={e => setSelectedSchoolId(e.target.value || null)}
                className="w-full h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                <option value="">🌐 Todas las sedes (global)</option>
                {schools.map(s => (
                  <option key={s.id} value={s.id}>🏫 {s.name}</option>
                ))}
              </select>
              {!selectedSchoolId && (
                <p className="text-[10px] text-amber-600 flex items-center gap-1">
                  <Globe className="h-3 w-3" />
                  Este comunicado será visible para todos los padres del sistema
                </p>
              )}
            </div>
          )}

          {/* Tipo de notificación */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Tipo</Label>
            <div className="grid grid-cols-2 gap-2">
              {TYPE_OPTIONS.map(t => {
                const sel = type === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setType(t.value)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-left transition-all ${
                      sel ? `${t.bg} border-current` : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <t.Icon className={`h-3.5 w-3.5 shrink-0 ${sel ? t.color : 'text-slate-400'}`} />
                    <div className="min-w-0">
                      <p className={`text-[11px] font-semibold ${sel ? t.color : 'text-slate-600'}`}>{t.label}</p>
                      <p className="text-[9px] text-slate-400 leading-tight truncate">{t.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Destinatario */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Destinatario</Label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'all',    label: 'Todos los padres', Icon: Users, desc: 'Comunicado masivo'  },
                { value: 'parent', label: 'Padre específico', Icon: User,  desc: 'Mensaje personal'   },
              ].map(r => {
                const sel = recipient === r.value;
                return (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => { setRecipient(r.value as any); setSelectedParent(null); setParentSearch(''); }}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-left transition-all ${
                      sel ? 'bg-indigo-50 border-indigo-400' : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <r.Icon className={`h-4 w-4 shrink-0 ${sel ? 'text-indigo-600' : 'text-slate-400'}`} />
                    <div>
                      <p className={`text-[11px] font-semibold ${sel ? 'text-indigo-800' : 'text-slate-600'}`}>{r.label}</p>
                      <p className="text-[9px] text-slate-400">{r.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Buscador de padre */}
            {recipient === 'parent' && (
              <div className="relative mt-2">
                <Input
                  placeholder="Buscar padre por nombre…"
                  value={selectedParent ? selectedParent.full_name : parentSearch}
                  onChange={e => { setSelectedParent(null); setParentSearch(e.target.value); }}
                  className="text-sm rounded-xl border-slate-200"
                />
                {searching && <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-slate-400" />}
                {parentResults.length > 0 && !selectedParent && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-10 overflow-hidden">
                    {parentResults.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => { setSelectedParent(p); setParentResults([]); setParentSearch(''); }}
                        className="w-full flex flex-col text-left px-3 py-2 hover:bg-indigo-50 transition-colors border-b border-slate-100 last:border-0"
                      >
                        <span className="text-xs font-semibold text-slate-800">{p.full_name}</span>
                        <span className="text-[10px] text-slate-400">{p.email}</span>
                      </button>
                    ))}
                  </div>
                )}
                {selectedParent && (
                  <div className="mt-2 flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-2">
                    <User className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-indigo-800 truncate">{selectedParent.full_name}</p>
                      <p className="text-[10px] text-indigo-500 truncate">{selectedParent.email}</p>
                    </div>
                    <button onClick={() => { setSelectedParent(null); setParentSearch(''); }} className="text-indigo-400 hover:text-red-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Asunto */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Asunto *</Label>
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Ej: Recordatorio de pago de almuerzos"
              maxLength={120}
              className="rounded-xl border-slate-200 text-sm"
            />
          </div>

          {/* Mensaje */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Mensaje *</Label>
              <span className={`text-[10px] ${charLeft < 50 ? 'text-red-400' : 'text-slate-400'}`}>{charLeft} restantes</span>
            </div>
            <Textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Escribe el contenido del comunicado para los padres…"
              maxLength={600}
              rows={4}
              className="rounded-xl border-slate-200 text-sm resize-none"
            />
          </div>

          {/* Botón enviar */}
          <Button
            onClick={handleSend}
            disabled={sending || sent || !title.trim() || !message.trim() || (recipient === 'parent' && !selectedParent)}
            className={`w-full h-11 rounded-xl font-semibold text-sm transition-all ${
              sent
                ? 'bg-emerald-500 hover:bg-emerald-500 text-white'
                : 'bg-gradient-to-r from-indigo-500 to-blue-500 hover:from-indigo-600 hover:to-blue-600 text-white shadow-md shadow-indigo-200/60'
            }`}
          >
            {sent ? (
              <><CheckCircle2 className="h-4 w-4 mr-2" />¡Enviado!</>
            ) : sending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Enviando…</>
            ) : (
              <><Send className="h-4 w-4 mr-2" />Enviar Comunicado</>
            )}
          </Button>
        </div>
      </div>

      {/* ── HISTORIAL ── */}
      <div className="lg:col-span-3">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-700">Comunicados enviados</h3>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {canViewAllSchools && !selectedSchoolId
                  ? 'Mostrando todos los comunicados del sistema'
                  : `Sede: ${schools.find(s => s.id === selectedSchoolId)?.name ?? '—'}`}
              </p>
            </div>
            <button
              onClick={fetchHistory}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors"
              title="Actualizar"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingHistory ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {loadingHistory ? (
            <div className="flex items-center justify-center py-10 gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
              <p className="text-xs text-slate-400">Cargando historial…</p>
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-400">
              <Bell className="h-8 w-8 opacity-20" />
              <p className="text-xs">Aún no se han enviado comunicados</p>
              {!canViewAllSchools && !selectedSchoolId && (
                <p className="text-[10px] text-center max-w-[200px] opacity-70">
                  No se detectó una sede asignada. Contacta al administrador general.
                </p>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-50 max-h-[600px] overflow-y-auto">
              {history.map(n => {
                const cfg = TYPE_OPTIONS.find(t => t.value === n.type) ?? TYPE_OPTIONS[0];
                const destLabel = n.user_id
                  ? 'Padre específico'
                  : n.school_id
                    ? `Sede: ${n.school_name ?? 'Sede'}`
                    : 'Global (todas las sedes)';
                const DestIcon = n.user_id ? User : n.school_id ? Building2 : Globe;
                return (
                  <div key={n.id} className="flex items-start gap-3 px-4 py-3.5 hover:bg-slate-50/60 transition-colors group">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${cfg.bg}`}>
                      <cfg.Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-bold text-slate-700 truncate">{n.title}</p>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[9px] text-slate-400 whitespace-nowrap">{timeAgo(n.created_at)}</span>
                          <button
                            onClick={() => handleDelete(n.id)}
                            className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-slate-300 hover:text-red-500 transition-all"
                            title="Eliminar"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                      {/* Mensaje completo visible */}
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed line-clamp-3">{n.message}</p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <Badge variant="outline" className={`text-[9px] h-4 px-1.5 py-0 ${cfg.color} border-current`}>
                          {cfg.label}
                        </Badge>
                        <span className="text-[9px] text-slate-400 flex items-center gap-1">
                          <DestIcon className="h-2.5 w-2.5" />{destLabel}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
