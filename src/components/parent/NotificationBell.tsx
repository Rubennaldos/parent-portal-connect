import { useState, useEffect, useCallback } from 'react';
import { Bell, X, Info, AlertTriangle, Clock, CreditCard, CheckCheck, Loader2 } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type NotifType = 'info' | 'reminder' | 'alert' | 'payment';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: NotifType;
  is_read: boolean;
  created_at: string;
  user_id: string | null;
}

// ─── Helpers de estilo por tipo ───────────────────────────────────────────────

const TYPE_CONFIG: Record<NotifType, { label: string; Icon: any; dot: string; bg: string; border: string; text: string }> = {
  info:     { label: 'Info',         Icon: Info,          dot: 'bg-blue-500',    bg: 'bg-blue-50',    border: 'border-blue-200',    text: 'text-blue-700'    },
  reminder: { label: 'Recordatorio', Icon: Clock,         dot: 'bg-amber-500',   bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-700'   },
  alert:    { label: 'Alerta',        Icon: AlertTriangle, dot: 'bg-red-500',     bg: 'bg-red-50',     border: 'border-red-200',     text: 'text-red-700'     },
  payment:  { label: 'Cobranza',      Icon: CreditCard,    dot: 'bg-emerald-500', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700' },
};

function timeAgo(isoDate: string): string {
  const diff = (Date.now() - new Date(isoDate).getTime()) / 1000;
  if (diff < 60)     return 'Hace un momento';
  if (diff < 3600)   return `Hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400)  return `Hace ${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `Hace ${Math.floor(diff / 86400)} días`;
  return new Date(isoDate).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' });
}

// ═══════════════════════════════════════════════════════════════
// Hook reutilizable: conteo de no leídos
// ═══════════════════════════════════════════════════════════════

export function useUnreadNotifCount() {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { count: c } = await supabase
        .from('in_app_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('is_read', false)
        .or(`user_id.eq.${user.id},user_id.is.null`);
      setCount(c ?? 0);
    } catch {
      // Silenciar: tabla puede no existir aún
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { count, refresh };
}

// ═══════════════════════════════════════════════════════════════
// Panel de notificaciones (Sheet) — exportado para uso standalone
// ═══════════════════════════════════════════════════════════════

interface NotificationsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReadAll?: () => void; // callback para resetear el badge externo
}

export function NotificationsSheet({ open, onOpenChange, onReadAll }: NotificationsSheetProps) {
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading,       setLoading]       = useState(false);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from('in_app_notifications')
        .select('id, title, message, type, is_read, created_at, user_id')
        .or(`user_id.eq.${user.id},user_id.is.null`)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setNotifications((data as Notification[]) ?? []);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err?.message || 'No se pudieron cargar las notificaciones.' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const markAsRead = useCallback(async (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    await supabase.from('in_app_notifications').update({ is_read: true }).eq('id', id);
  }, []);

  const markAllAsRead = useCallback(async () => {
    const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id);
    if (!unreadIds.length) return;
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    await supabase.from('in_app_notifications').update({ is_read: true }).in('id', unreadIds);
    onReadAll?.();
  }, [notifications, onReadAll]);

  useEffect(() => {
    if (open) fetchNotifications();
  }, [open, fetchNotifications]);

  const unread = notifications.filter(n => !n.is_read);
  const read   = notifications.filter(n => n.is_read);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="flex items-center gap-2.5 text-base font-bold text-slate-800">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center">
                <Bell className="h-4 w-4 text-blue-600" />
              </div>
              Buzón de mensajes
              {unread.length > 0 && (
                <Badge className="bg-red-500 text-white text-[10px] px-2 py-0 h-5 rounded-full">{unread.length}</Badge>
              )}
            </SheetTitle>
            <button
              onClick={() => onOpenChange(false)}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {unread.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={markAllAsRead}
              className="self-start mt-1 h-7 text-[11px] text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-2 gap-1.5"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Marcar todas como leídas
            </Button>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
              <p className="text-sm text-slate-400">Cargando mensajes…</p>
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
              <Bell className="h-10 w-10 opacity-20" />
              <p className="text-sm font-medium">Sin mensajes por ahora</p>
              <p className="text-[11px] text-center max-w-[200px]">El colegio te enviará comunicados importantes aquí.</p>
            </div>
          ) : (
            <div className="p-3 space-y-2">
              {unread.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1 pt-1">Nuevos</p>
                  {unread.map(n => <NotifCard key={n.id} n={n} onRead={markAsRead} />)}
                </div>
              )}
              {read.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-300 px-1 pt-2">Anteriores</p>
                  {read.map(n => <NotifCard key={n.id} n={n} onRead={markAsRead} />)}
                </div>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Tarjeta individual ───────────────────────────────────────────────────────

function NotifCard({ n, onRead }: { n: Notification; onRead: (id: string) => void }) {
  const cfg = TYPE_CONFIG[n.type as NotifType] ?? TYPE_CONFIG.info;
  const { Icon } = cfg;
  const [expanded, setExpanded] = useState(false);

  const handleClick = () => {
    setExpanded(e => !e);
    if (!n.is_read) onRead(n.id);
  };

  return (
    <button
      onClick={handleClick}
      className={`w-full text-left rounded-2xl border p-3.5 transition-all ${
        n.is_read ? 'bg-white border-slate-100 opacity-70 hover:opacity-100' : `${cfg.bg} ${cfg.border} shadow-sm`
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${n.is_read ? 'bg-slate-100' : cfg.bg}`}>
          <Icon className={`h-4 w-4 ${n.is_read ? 'text-slate-400' : cfg.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className={`text-xs font-bold leading-tight ${n.is_read ? 'text-slate-500' : 'text-slate-800'}`}>{n.title}</p>
            {!n.is_read && <span className={`w-2 h-2 rounded-full ${cfg.dot} shrink-0 mt-1`} />}
          </div>
          <p className={`text-[11px] mt-0.5 leading-relaxed ${n.is_read ? 'text-slate-400' : 'text-slate-600'} ${expanded ? '' : 'line-clamp-2'}`}>
            {n.message}
          </p>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[9px] text-slate-400">{timeAgo(n.created_at)}</span>
            <span className={`text-[9px] font-semibold uppercase tracking-wider ${n.is_read ? 'text-slate-300' : cfg.text}`}>{cfg.label}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════
// NotificationBell — campanita con sheet integrado (uso en header)
// ═══════════════════════════════════════════════════════════════

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { count, refresh } = useUnreadNotifCount();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative p-2 rounded-xl hover:bg-stone-100 transition-colors"
        aria-label={`Notificaciones${count > 0 ? ` — ${count} sin leer` : ''}`}
      >
        <Bell className="h-5 w-5 text-stone-500" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center px-1 shadow-sm animate-pulse">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      <NotificationsSheet open={open} onOpenChange={setOpen} onReadAll={refresh} />
    </>
  );
}
