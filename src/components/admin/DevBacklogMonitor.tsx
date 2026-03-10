import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Bug,
  RefreshCw,
  Copy,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Search,
  Trash2,
  ExternalLink,
  Loader2,
  Eye,
  X,
  Terminal,
  Zap,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';

interface BacklogItem {
  id: string;
  reporter_email: string;
  reporter_role: string;
  reporter_school_name: string | null;
  page_url: string;
  console_errors: any[];
  user_message: string;
  screenshot_url: string | null;
  ai_classification: string;
  ai_response: string;
  ai_technical_analysis: string | null;
  cursor_fix_prompt: string | null;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'bg-red-600 text-white',
  high: 'bg-orange-500 text-white',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-gray-100 text-gray-600',
};

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-red-100 text-red-700',
  in_progress: 'bg-blue-100 text-blue-700',
  fixed: 'bg-green-100 text-green-700',
  wont_fix: 'bg-gray-100 text-gray-500',
  duplicate: 'bg-purple-100 text-purple-600',
};

const CLASS_ICONS: Record<string, string> = {
  system_error: '🐛',
  ui_bug: '🎨',
  user_error: '✅',
  feature_request: '💡',
  unknown: '❓',
};

// ─── Mapeo de roles legible ──────────────────────────────────
const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  admin_general: { label: 'Admin General', color: 'bg-indigo-100 text-indigo-700' },
  gestor_unidad: { label: 'Admin de Sede', color: 'bg-teal-100 text-teal-700' },
  operador_caja: { label: 'Cajero', color: 'bg-amber-100 text-amber-700' },
  operador_cocina: { label: 'Cocina', color: 'bg-orange-100 text-orange-700' },
  superadmin: { label: 'SuperAdmin', color: 'bg-gray-800 text-white' },
  supervisor_red: { label: 'Supervisor', color: 'bg-cyan-100 text-cyan-700' },
};

export default function DevBacklogMonitor() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<BacklogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterSchool, setFilterSchool] = useState<string>('all');
  const [filterRole, setFilterRole] = useState<string>('all');
  const [selectedItem, setSelectedItem] = useState<BacklogItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // ─── Listas únicas para filtros ─────────────────────────────
  const uniqueSchools = [...new Set(items.map((i) => i.reporter_school_name).filter(Boolean))] as string[];
  const uniqueRoles = [...new Set(items.map((i) => i.reporter_role).filter(Boolean))] as string[];

  // ─── Stats ──────────────────────────────────────────────────
  const stats = {
    total: items.length,
    open: items.filter((i) => i.status === 'open').length,
    critical: items.filter((i) => i.priority === 'critical' && i.status === 'open').length,
    withPrompt: items.filter((i) => i.cursor_fix_prompt && i.status === 'open').length,
  };

  // ─── Fetch ──────────────────────────────────────────────────
  useEffect(() => {
    fetchItems();
  }, []);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase!
        .from('dev_backlog')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      setItems(data || []);
    } catch (err) {
      console.error('Error fetching dev_backlog:', err);
    } finally {
      setLoading(false);
    }
  };

  // ─── Actualizar estado ──────────────────────────────────────
  const updateStatus = async (id: string, newStatus: string) => {
    try {
      const updateData: any = { status: newStatus };
      if (newStatus === 'fixed') {
        updateData.resolved_at = new Date().toISOString();
        updateData.resolved_by = user?.id;
      }

      const { error } = await supabase!
        .from('dev_backlog')
        .update(updateData)
        .eq('id', id);

      if (error) throw error;
      
      setItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, ...updateData } : item
        )
      );

      toast({
        title: '✅ Estado actualizado',
        description: `Ticket marcado como "${newStatus}"`,
      });
    } catch (err) {
      console.error('Error updating status:', err);
    }
  };

  // ─── Eliminar ───────────────────────────────────────────────
  const deleteItem = async (id: string) => {
    if (!confirm('¿Eliminar este ticket? Esta acción no se puede deshacer.')) return;
    try {
      const { error } = await supabase!.from('dev_backlog').delete().eq('id', id);
      if (error) throw error;
      setItems((prev) => prev.filter((i) => i.id !== id));
      if (selectedItem?.id === id) setSelectedItem(null);
      toast({ title: '🗑️ Ticket eliminado' });
    } catch (err) {
      console.error('Error deleting:', err);
    }
  };

  // ─── Copiar prompt para Cursor ──────────────────────────────
  const copyPromptForCursor = async (item: BacklogItem) => {
    if (!item.cursor_fix_prompt) return;

    const fullPrompt = `🔧 TICKET DE SOPORTE IA — ${format(new Date(item.created_at), 'dd/MM/yyyy HH:mm')}

📍 Página: ${item.page_url}
👤 Reportó: ${item.reporter_email} (${item.reporter_role})
🏫 Sede: ${item.reporter_school_name || 'N/A'}
🔴 Prioridad: ${item.priority.toUpperCase()}
📝 Problema: ${item.user_message}

${item.ai_technical_analysis ? `🔍 Análisis técnico:\n${item.ai_technical_analysis}\n` : ''}
${item.console_errors?.length > 0 ? `⚠️ Errores de consola:\n${item.console_errors.map((e: any) => `  - ${e.message}`).join('\n')}\n` : ''}
🛠️ FIX SOLICITADO:
${item.cursor_fix_prompt}`;

    try {
      await navigator.clipboard.writeText(fullPrompt);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 2000);
      toast({
        title: '📋 ¡Copiado!',
        description: 'Prompt listo para pegar en Cursor',
      });
    } catch {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = fullPrompt;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  // ─── Filtros ────────────────────────────────────────────────
  const filteredItems = items.filter((item) => {
    const matchesSearch =
      searchTerm === '' ||
      item.user_message.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.reporter_email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.page_url.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.ai_technical_analysis || '').toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = filterStatus === 'all' || item.status === filterStatus;
    const matchesPriority = filterPriority === 'all' || item.priority === filterPriority;
    const matchesSchool = filterSchool === 'all' || item.reporter_school_name === filterSchool;
    const matchesRole = filterRole === 'all' || item.reporter_role === filterRole;

    return matchesSearch && matchesStatus && matchesPriority && matchesSchool && matchesRole;
  });

  // ─── Render ─────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header con stats */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Terminal className="h-6 w-6 text-violet-600" />
            Monitor de Errores IA
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Tickets generados por el Agente de Soporte Inteligente
          </p>
        </div>
        <Button variant="outline" onClick={fetchItems} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-l-4 border-l-gray-400">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">Total</p>
            <p className="text-2xl font-bold">{stats.total}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">Abiertos</p>
            <p className="text-2xl font-bold text-red-600">{stats.open}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-orange-500">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium">Críticos</p>
            <p className="text-2xl font-bold text-orange-600">{stats.critical}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-violet-500">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
              <Zap className="h-3 w-3" /> Con Fix para Cursor
            </p>
            <p className="text-2xl font-bold text-violet-600">{stats.withPrompt}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Buscar por mensaje, email, URL..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="border rounded-md px-3 py-2 text-sm bg-white"
        >
          <option value="all">Todos los estados</option>
          <option value="open">🔴 Abierto</option>
          <option value="in_progress">🔵 En progreso</option>
          <option value="fixed">✅ Arreglado</option>
          <option value="wont_fix">⬜ No se arreglará</option>
          <option value="duplicate">🟣 Duplicado</option>
        </select>
        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
          className="border rounded-md px-3 py-2 text-sm bg-white"
        >
          <option value="all">Todas las prioridades</option>
          <option value="critical">🔴 Crítica</option>
          <option value="high">🟠 Alta</option>
          <option value="medium">🟡 Media</option>
          <option value="low">⬜ Baja</option>
        </select>
        <select
          value={filterSchool}
          onChange={(e) => setFilterSchool(e.target.value)}
          className="border rounded-md px-3 py-2 text-sm bg-white"
        >
          <option value="all">🏫 Todas las sedes</option>
          {uniqueSchools.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={filterRole}
          onChange={(e) => setFilterRole(e.target.value)}
          className="border rounded-md px-3 py-2 text-sm bg-white"
        >
          <option value="all">👤 Todos los roles</option>
          {uniqueRoles.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]?.label || r}</option>
          ))}
        </select>
      </div>

      {/* Lista de tickets */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-violet-600" />
        </div>
      ) : filteredItems.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Bug className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <h3 className="font-semibold text-gray-500">No hay tickets</h3>
            <p className="text-sm text-gray-400 mt-1">
              Los tickets aparecerán aquí cuando el Agente de Soporte IA detecte errores del sistema.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => (
            <Card
              key={item.id}
              className={`border transition-shadow hover:shadow-md ${
                item.status === 'fixed' ? 'opacity-60' : ''
              } ${item.priority === 'critical' ? 'border-red-300 bg-red-50/30' : ''}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  {/* Info principal */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className="text-lg">{CLASS_ICONS[item.ai_classification] || '❓'}</span>
                      <Badge className={PRIORITY_COLORS[item.priority] || 'bg-gray-100'}>
                        {item.priority.toUpperCase()}
                      </Badge>
                      <Badge className={STATUS_COLORS[item.status] || 'bg-gray-100'}>
                        {item.status === 'open' && '🔴 Abierto'}
                        {item.status === 'in_progress' && '🔵 En progreso'}
                        {item.status === 'fixed' && '✅ Arreglado'}
                        {item.status === 'wont_fix' && 'No se arreglará'}
                        {item.status === 'duplicate' && 'Duplicado'}
                      </Badge>
                      <span className="text-[10px] text-gray-400">
                        {format(new Date(item.created_at), "dd/MM/yyyy HH:mm", { locale: es })}
                      </span>
                    </div>

                    <p className="text-sm font-medium text-gray-800 line-clamp-2">
                      {item.user_message}
                    </p>

                    <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-500 flex-wrap">
                      {/* Rol del Reportero */}
                      <Badge className={`text-[10px] px-1.5 py-0 ${ROLE_LABELS[item.reporter_role]?.color || 'bg-gray-100 text-gray-600'}`}>
                        {ROLE_LABELS[item.reporter_role]?.label || item.reporter_role}
                      </Badge>
                      <span>📍 {item.page_url}</span>
                      <span>👤 {item.reporter_email}</span>
                      {item.reporter_school_name && (
                        <span>🏫 {item.reporter_school_name}</span>
                      )}
                    </div>
                  </div>

                  {/* Acciones */}
                  <div className="flex flex-col gap-1.5 flex-shrink-0">
                    {/* Botón principal: Copiar comando para Cursor */}
                    {item.cursor_fix_prompt && (
                      <Button
                        size="sm"
                        onClick={() => copyPromptForCursor(item)}
                        className={`text-xs ${
                          copiedId === item.id
                            ? 'bg-green-600 hover:bg-green-700'
                            : 'bg-violet-600 hover:bg-violet-700'
                        } text-white`}
                      >
                        {copiedId === item.id ? (
                          <>
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            ¡Copiado!
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3 mr-1" />
                            Copiar para Cursor
                          </>
                        )}
                      </Button>
                    )}

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedItem(item)}
                      className="text-xs"
                    >
                      <Eye className="h-3 w-3 mr-1" />
                      Ver detalle
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Modal de detalle */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            {/* Header del modal */}
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between z-10">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{CLASS_ICONS[selectedItem.ai_classification]}</span>
                <div>
                  <h3 className="font-bold text-lg">Detalle del Ticket</h3>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(selectedItem.created_at), "dd MMMM yyyy, HH:mm", { locale: es })}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedItem(null)}
                className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Meta info */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 font-medium">Reportó</p>
                  <p className="text-sm font-semibold">{selectedItem.reporter_email}</p>
                  <p className="text-xs text-gray-400">{selectedItem.page_url}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 font-medium">Rol del Reportero</p>
                  <Badge className={`mt-1 ${ROLE_LABELS[selectedItem.reporter_role]?.color || 'bg-gray-100 text-gray-600'}`}>
                    {ROLE_LABELS[selectedItem.reporter_role]?.label || selectedItem.reporter_role}
                  </Badge>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 font-medium">Sede</p>
                  <p className="text-sm font-semibold">{selectedItem.reporter_school_name || 'Sin sede asignada'}</p>
                </div>
              </div>

              {/* Badges */}
              <div className="flex gap-2 flex-wrap">
                <Badge className={PRIORITY_COLORS[selectedItem.priority]}>
                  {selectedItem.priority.toUpperCase()}
                </Badge>
                <Badge className={STATUS_COLORS[selectedItem.status]}>
                  {selectedItem.status}
                </Badge>
                <Badge variant="outline">
                  {selectedItem.ai_classification}
                </Badge>
              </div>

              {/* Mensaje del usuario */}
              <div>
                <h4 className="font-semibold text-sm mb-1.5">📝 Mensaje del usuario</h4>
                <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-900">
                  {selectedItem.user_message}
                </div>
              </div>

              {/* Captura adjunta */}
              {selectedItem.screenshot_url && selectedItem.screenshot_url.startsWith('http') && (
                <div>
                  <h4 className="font-semibold text-sm mb-1.5">📸 Captura adjunta</h4>
                  <div className="bg-gray-50 rounded-lg p-3">
                    {selectedItem.screenshot_url.match(/\.(mp4|webm)$/i) ? (
                      <video
                        src={selectedItem.screenshot_url}
                        controls
                        className="max-h-64 rounded-lg w-full"
                      />
                    ) : (
                      <a href={selectedItem.screenshot_url} target="_blank" rel="noopener noreferrer">
                        <img
                          src={selectedItem.screenshot_url}
                          alt="Captura del error"
                          className="max-h-64 rounded-lg object-contain cursor-pointer hover:opacity-80 transition-opacity"
                        />
                      </a>
                    )}
                    <p className="text-[10px] text-gray-400 mt-1 truncate">{selectedItem.screenshot_url}</p>
                  </div>
                </div>
              )}

              {/* Respuesta de la IA */}
              <div>
                <h4 className="font-semibold text-sm mb-1.5">🤖 Respuesta de la IA</h4>
                <div className="bg-gray-50 rounded-lg p-3 text-sm whitespace-pre-wrap">
                  {selectedItem.ai_response}
                </div>
              </div>

              {/* Análisis técnico */}
              {selectedItem.ai_technical_analysis && (
                <div>
                  <h4 className="font-semibold text-sm mb-1.5">🔍 Análisis Técnico</h4>
                  <div className="bg-orange-50 rounded-lg p-3 text-sm whitespace-pre-wrap text-orange-900">
                    {selectedItem.ai_technical_analysis}
                  </div>
                </div>
              )}

              {/* Errores de consola */}
              {selectedItem.console_errors?.length > 0 && (
                <div>
                  <h4 className="font-semibold text-sm mb-1.5">⚠️ Errores de Consola</h4>
                  <div className="bg-red-50 rounded-lg p-3 space-y-1.5">
                    {selectedItem.console_errors.map((err: any, i: number) => (
                      <div key={i} className="text-xs font-mono text-red-800 border-l-2 border-red-300 pl-2">
                        <span className="text-red-400">[{err.timestamp}]</span> {err.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* CURSOR FIX PROMPT — El más importante */}
              {selectedItem.cursor_fix_prompt && (
                <div className="border-2 border-violet-300 rounded-xl overflow-hidden">
                  <div className="bg-violet-600 text-white px-4 py-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Terminal className="h-4 w-4" />
                      <span className="font-semibold text-sm">Comando para Cursor AI</span>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => copyPromptForCursor(selectedItem)}
                      className="text-xs h-7"
                    >
                      {copiedId === selectedItem.id ? (
                        <>
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          ¡Copiado!
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3 mr-1" />
                          Copiar
                        </>
                      )}
                    </Button>
                  </div>
                  <div className="bg-gray-900 text-green-400 p-4 text-sm font-mono whitespace-pre-wrap">
                    {selectedItem.cursor_fix_prompt}
                  </div>
                </div>
              )}

              {/* Acciones */}
              <div className="flex gap-2 flex-wrap pt-2 border-t">
                {selectedItem.status === 'open' && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => {
                        updateStatus(selectedItem.id, 'in_progress');
                        setSelectedItem({ ...selectedItem, status: 'in_progress' });
                      }}
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      <Clock className="h-3.5 w-3.5 mr-1.5" />
                      Marcar En Progreso
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        updateStatus(selectedItem.id, 'fixed');
                        setSelectedItem({ ...selectedItem, status: 'fixed' });
                      }}
                      className="bg-green-600 hover:bg-green-700 text-white"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                      Marcar Arreglado
                    </Button>
                  </>
                )}
                {selectedItem.status === 'in_progress' && (
                  <Button
                    size="sm"
                    onClick={() => {
                      updateStatus(selectedItem.id, 'fixed');
                      setSelectedItem({ ...selectedItem, status: 'fixed' });
                    }}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                    Marcar Arreglado
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => deleteItem(selectedItem.id)}
                  className="text-red-600 border-red-200 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Eliminar
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
