/**
 * SystemStatusControl — Panel de encendido/apagado global de sistemas.
 * Solo visible para superadmin, dentro del tab "Status" del panel SuperAdmin.
 *
 * Usa Realtime: el cambio se propaga a todos los usuarios conectados en < 1s.
 * El superadmin NUNCA es bloqueado por estos flags (guard de rutas lo excluye).
 */
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import {
  useSystemStatus,
  SystemStatus,
  PaymentMethodKey,
  PAYMENT_METHOD_KEYS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_DEFAULTS,
} from '@/hooks/useSystemStatus';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Users, ShieldCheck, AlertTriangle, Wifi, FlaskConical, X, Plus, CreditCard } from 'lucide-react';

type FlagKey = 'is_parent_portal_enabled' | 'is_admin_panel_enabled';

interface PendingChange {
  flag: FlagKey;
  value: boolean;
  label: string;
}

export function SystemStatusControl() {
  const { user }                   = useAuth();
  const { status, loading, refresh } = useSystemStatus();
  const { toast }           = useToast();

  const [saving, setSaving]       = useState<FlagKey | null>(null);
  const [pending, setPending]     = useState<PendingChange | null>(null);
  const [parentMsg, setParentMsg] = useState('');
  const [adminMsg, setAdminMsg]   = useState('');
  const [editingMsg, setEditingMsg] = useState<'parent' | 'admin' | null>(null);
  // Estado local optimista: refleja el cambio de inmediato sin esperar el poll
  const [localOverride, setLocalOverride] = useState<Partial<SystemStatus> | null>(null);
  // Bypass emails
  const [bypassOpen, setBypassOpen]         = useState(false);
  const [newParentEmail, setNewParentEmail] = useState('');
  const [newAdminEmail, setNewAdminEmail]   = useState('');
  const [savingBypass, setSavingBypass]     = useState(false);
  // Métodos de pago
  const [savingMethod, setSavingMethod]     = useState<PaymentMethodKey | null>(null);

  const effectiveStatus = localOverride ? { ...status, ...localOverride } : status;

  const handleToggle = (flag: FlagKey, newValue: boolean) => {
    const labels: Record<FlagKey, string> = {
      is_parent_portal_enabled: 'Portal de Padres',
      is_admin_panel_enabled:   'Panel de Administradores',
    };
    // Abrir diálogo de confirmación solo al apagar
    if (!newValue) {
      setPending({ flag, value: newValue, label: labels[flag] });
    } else {
      // Reactivar no requiere confirmación extra
      applyChange(flag, newValue);
    }
  };

  const applyChange = async (flag: FlagKey, value: boolean) => {
    // Actualización optimista inmediata: el switch se mueve al instante
    setLocalOverride(prev => ({ ...prev, [flag]: value }));
    setSaving(flag);
    try {
      const { error } = await supabase
        .from('system_status')
        .update({ [flag]: value, updated_by: user?.id })
        .eq('id', 1);

      if (error) throw error;

      toast({
        title: value ? '✅ Sistema reactivado' : '⚠️ Sistema pausado',
        description: `${flag === 'is_parent_portal_enabled' ? 'Portal de Padres' : 'Panel Admin'} ${value ? 'ahora está ACTIVO' : 'ahora está en MANTENIMIENTO'}. Los usuarios conectados son redirigidos automáticamente.`,
      });
      // Confirmar con los datos reales de la BD
      refresh();
    } catch (err: any) {
      // Revertir el optimista si falló
      setLocalOverride(prev => ({ ...prev, [flag]: !value }));
      toast({ title: 'Error al guardar', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(null);
      setPending(null);
    }
  };

  const saveMessage = async (type: 'parent' | 'admin') => {
    const col  = type === 'parent' ? 'parent_maintenance_msg' : 'admin_maintenance_msg';
    const msg  = type === 'parent' ? parentMsg : adminMsg;
    if (!msg.trim()) return;

    setSaving(type === 'parent' ? 'is_parent_portal_enabled' : 'is_admin_panel_enabled');
    try {
      const { error } = await supabase
        .from('system_status')
        .update({ [col]: msg.trim(), updated_by: user?.id })
        .eq('id', 1);
      if (error) throw error;
      toast({ title: 'Mensaje actualizado', description: 'El mensaje de mantenimiento se actualizó correctamente.' });
      setEditingMsg(null);
      refresh();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(null);
    }
  };

  /** Agrega un email al array de bypass (parent o admin) */
  const addBypassEmail = async (type: 'parent' | 'admin') => {
    const email = (type === 'parent' ? newParentEmail : newAdminEmail).trim().toLowerCase();
    if (!email || !email.includes('@')) {
      toast({ title: 'Email inválido', description: 'Ingresa un correo válido.', variant: 'destructive' });
      return;
    }
    const col = type === 'parent' ? 'parent_bypass_emails' : 'admin_bypass_emails';
    const current: string[] = (type === 'parent'
      ? effectiveStatus.parent_bypass_emails
      : effectiveStatus.admin_bypass_emails) ?? [];
    if (current.includes(email)) {
      toast({ title: 'Ya existe', description: 'Ese correo ya está en la lista de acceso.' });
      return;
    }
    const updated = [...current, email];
    setSavingBypass(true);
    try {
      const { error } = await supabase
        .from('system_status')
        .update({ [col]: updated, updated_by: user?.id })
        .eq('id', 1);
      if (error) throw error;
      if (type === 'parent') setNewParentEmail(''); else setNewAdminEmail('');
      toast({ title: '✅ Acceso concedido', description: `${email} puede entrar aunque el portal esté en mantenimiento.` });
      refresh();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSavingBypass(false);
    }
  };

  /** Quita un email del array de bypass */
  const removeBypassEmail = async (type: 'parent' | 'admin', email: string) => {
    const col = type === 'parent' ? 'parent_bypass_emails' : 'admin_bypass_emails';
    const current: string[] = (type === 'parent'
      ? effectiveStatus.parent_bypass_emails
      : effectiveStatus.admin_bypass_emails) ?? [];
    const updated = current.filter(e => e !== email);
    setSavingBypass(true);
    try {
      const { error } = await supabase
        .from('system_status')
        .update({ [col]: updated, updated_by: user?.id })
        .eq('id', 1);
      if (error) throw error;
      toast({ title: 'Acceso revocado', description: `${email} ya no puede entrar durante el mantenimiento.` });
      refresh();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSavingBypass(false);
    }
  };

  /** Activa / desactiva un método de pago globalmente */
  const togglePaymentMethod = async (key: PaymentMethodKey, value: boolean) => {
    const currentConfig = effectiveStatus.payment_methods_config ?? PAYMENT_METHOD_DEFAULTS;
    const updated = { ...currentConfig, [key]: value };
    // Optimismo inmediato
    setLocalOverride(prev => ({
      ...prev,
      payment_methods_config: updated,
    }));
    setSavingMethod(key);
    try {
      const { error } = await supabase
        .from('system_status')
        .update({ payment_methods_config: updated, updated_by: user?.id })
        .eq('id', 1);
      if (error) throw error;
      toast({
        title: value ? `✅ ${PAYMENT_METHOD_LABELS[key]} activado` : `⚠️ ${PAYMENT_METHOD_LABELS[key]} desactivado`,
        description: value
          ? `Los padres ya pueden ver y usar ${PAYMENT_METHOD_LABELS[key]}.`
          : `${PAYMENT_METHOD_LABELS[key]} ya no aparece en el portal de padres. Los correos de prueba sí lo ven.`,
      });
      refresh();
    } catch (err: any) {
      // Revertir optimismo si falló
      setLocalOverride(prev => ({
        ...prev,
        payment_methods_config: currentConfig,
      }));
      toast({ title: 'Error al guardar', description: err.message, variant: 'destructive' });
    } finally {
      setSavingMethod(null);
    }
  };

  if (loading) {
    return (
      <Card className="border">
        <CardContent className="py-8 text-center text-sm text-muted-foreground animate-pulse">
          Cargando estado del sistema…
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="border">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-foreground flex items-center justify-center">
              <Wifi className="h-4 w-4 text-background" />
            </div>
            <div>
              <CardTitle className="text-base">Control Global de Sistemas</CardTitle>
              <CardDescription className="text-xs">
                Los cambios se aplican de inmediato. Los usuarios son redirigidos automáticamente.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">

          {/* — Portal de Padres — */}
          <div className="flex items-start justify-between p-4 rounded-xl border bg-card hover:bg-muted/30 transition-colors">
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 w-9 h-9 rounded-lg flex items-center justify-center ${effectiveStatus.is_parent_portal_enabled ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                <Users className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-semibold text-foreground">Portal de Padres</p>
                  <Badge
                    className={effectiveStatus.is_parent_portal_enabled
                      ? 'bg-green-100 text-green-700 border-0 text-[10px] px-1.5 py-0'
                      : 'bg-amber-100 text-amber-700 border-0 text-[10px] px-1.5 py-0'}>
                    {effectiveStatus.is_parent_portal_enabled ? 'ACTIVO' : 'MANTENIMIENTO'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Afecta a todos los usuarios con rol <code className="bg-muted px-1 rounded">parent</code>.
                  El superadmin nunca es bloqueado.
                </p>
                {!effectiveStatus.is_parent_portal_enabled && (
                  <p className="text-xs text-amber-600 mt-1 font-medium">
                    Mensaje: "{effectiveStatus.parent_maintenance_msg}"
                  </p>
                )}
              </div>
            </div>
            <Switch
              checked={effectiveStatus.is_parent_portal_enabled}
              onCheckedChange={v => handleToggle('is_parent_portal_enabled', v)}
              disabled={saving === 'is_parent_portal_enabled'}
              className="data-[state=checked]:bg-green-600"
            />
          </div>

          {/* Editar mensaje del portal de padres */}
          {editingMsg === 'parent' ? (
            <div className="pl-12 space-y-2">
              <Label className="text-xs text-muted-foreground">Mensaje para los padres:</Label>
              <Textarea
                value={parentMsg}
                onChange={e => setParentMsg(e.target.value)}
                placeholder={effectiveStatus.parent_maintenance_msg}
                rows={2}
                className="text-sm resize-none"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => saveMessage('parent')} disabled={saving !== null}>Guardar</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingMsg(null)}>Cancelar</Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => { setParentMsg(effectiveStatus.parent_maintenance_msg); setEditingMsg('parent'); }}
              className="ml-12 text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            >
              Editar mensaje de mantenimiento del portal
            </button>
          )}

          <div className="border-t" />

          {/* — Panel de Administradores — */}
          <div className="flex items-start justify-between p-4 rounded-xl border bg-card hover:bg-muted/30 transition-colors">
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 w-9 h-9 rounded-lg flex items-center justify-center ${effectiveStatus.is_admin_panel_enabled ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-semibold text-foreground">Panel de Administradores</p>
                  <Badge
                    className={effectiveStatus.is_admin_panel_enabled
                      ? 'bg-green-100 text-green-700 border-0 text-[10px] px-1.5 py-0'
                      : 'bg-red-100 text-red-700 border-0 text-[10px] px-1.5 py-0'}>
                    {effectiveStatus.is_admin_panel_enabled ? 'ACTIVO' : 'BLOQUEADO'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Afecta a <code className="bg-muted px-1 rounded">admin_general</code>,{' '}
                  <code className="bg-muted px-1 rounded">gestor_unidad</code> y demás roles admin.
                  El superadmin nunca es bloqueado.
                </p>
                {!effectiveStatus.is_admin_panel_enabled && (
                  <p className="text-xs text-red-600 mt-1 font-medium">
                    Mensaje: "{effectiveStatus.admin_maintenance_msg}"
                  </p>
                )}
              </div>
            </div>
            <Switch
              checked={effectiveStatus.is_admin_panel_enabled}
              onCheckedChange={v => handleToggle('is_admin_panel_enabled', v)}
              disabled={saving === 'is_admin_panel_enabled'}
              className="data-[state=checked]:bg-green-600"
            />
          </div>

          {/* Editar mensaje del panel admin */}
          {editingMsg === 'admin' ? (
            <div className="pl-12 space-y-2">
              <Label className="text-xs text-muted-foreground">Mensaje para los administradores:</Label>
              <Textarea
                value={adminMsg}
                onChange={e => setAdminMsg(e.target.value)}
                placeholder={effectiveStatus.admin_maintenance_msg}
                rows={2}
                className="text-sm resize-none"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => saveMessage('admin')} disabled={saving !== null}>Guardar</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingMsg(null)}>Cancelar</Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => { setAdminMsg(effectiveStatus.admin_maintenance_msg); setEditingMsg('admin'); }}
              className="ml-12 text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            >
              Editar mensaje de mantenimiento del panel
            </button>
          )}

          <div className="border-t" />

          {/* — Acceso durante mantenimiento (Bypass) — */}
          <div>
            <button
              onClick={() => setBypassOpen(v => !v)}
              className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              Acceso de prueba durante mantenimiento
              <span className="ml-auto text-[10px] bg-muted px-1.5 py-0.5 rounded">
                {((effectiveStatus.parent_bypass_emails?.length ?? 0) + (effectiveStatus.admin_bypass_emails?.length ?? 0))} usuarios
              </span>
              <span>{bypassOpen ? '▲' : '▼'}</span>
            </button>

            {bypassOpen && (
              <div className="mt-3 space-y-4 pl-5 border-l-2 border-violet-200">
                <p className="text-[11px] text-muted-foreground">
                  Los correos aquí listados pueden ingresar al portal aunque esté en mantenimiento.
                  Ideal para probar cambios sin desbloquear para todos.
                </p>

                {/* Bypass Portal de Padres */}
                <div className="space-y-2">
                  <Label className="text-xs font-semibold flex items-center gap-1">
                    <Users className="h-3 w-3" /> Portal de Padres
                  </Label>
                  {(effectiveStatus.parent_bypass_emails ?? []).length === 0 && (
                    <p className="text-[11px] text-muted-foreground italic">Sin correos de prueba.</p>
                  )}
                  {(effectiveStatus.parent_bypass_emails ?? []).map(email => (
                    <div key={email} className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-1.5">
                      <span className="text-xs flex-1 font-mono">{email}</span>
                      <button
                        onClick={() => removeBypassEmail('parent', email)}
                        disabled={savingBypass}
                        className="text-red-400 hover:text-red-600 transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Input
                      type="email"
                      placeholder="correo@ejemplo.com"
                      value={newParentEmail}
                      onChange={e => setNewParentEmail(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addBypassEmail('parent')}
                      className="h-8 text-xs"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => addBypassEmail('parent')}
                      disabled={savingBypass || !newParentEmail}
                      className="h-8 px-3"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Bypass Panel Admin */}
                <div className="space-y-2">
                  <Label className="text-xs font-semibold flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3" /> Panel de Administradores
                  </Label>
                  {(effectiveStatus.admin_bypass_emails ?? []).length === 0 && (
                    <p className="text-[11px] text-muted-foreground italic">Sin correos de prueba.</p>
                  )}
                  {(effectiveStatus.admin_bypass_emails ?? []).map(email => (
                    <div key={email} className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-1.5">
                      <span className="text-xs flex-1 font-mono">{email}</span>
                      <button
                        onClick={() => removeBypassEmail('admin', email)}
                        disabled={savingBypass}
                        className="text-red-400 hover:text-red-600 transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Input
                      type="email"
                      placeholder="correo@ejemplo.com"
                      value={newAdminEmail}
                      onChange={e => setNewAdminEmail(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addBypassEmail('admin')}
                      className="h-8 text-xs"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => addBypassEmail('admin')}
                      disabled={savingBypass || !newAdminEmail}
                      className="h-8 px-3"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="border-t" />

          {/* — Pasarelas y Métodos de Pago — */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                <CreditCard className="h-4 w-4 text-blue-700" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Pasarelas y Métodos de Pago</p>
                <p className="text-xs text-muted-foreground">
                  Controla qué métodos ven los padres al realizar un pago.
                  Los correos de prueba (arriba) ven todos aunque estén desactivados.
                </p>
              </div>
            </div>

            <div className="space-y-2 pl-10">
              {PAYMENT_METHOD_KEYS.map(key => {
                const pmConfig = effectiveStatus.payment_methods_config ?? PAYMENT_METHOD_DEFAULTS;
                const isActive = pmConfig[key] ?? true;
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between p-3 rounded-xl border bg-card hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{PAYMENT_METHOD_LABELS[key]}</span>
                      <Badge
                        className={isActive
                          ? 'bg-green-100 text-green-700 border-0 text-[10px] px-1.5 py-0'
                          : 'bg-gray-100 text-gray-500 border-0 text-[10px] px-1.5 py-0'
                        }
                      >
                        {isActive ? 'ACTIVO' : 'OCULTO'}
                      </Badge>
                    </div>
                    <Switch
                      checked={isActive}
                      onCheckedChange={v => togglePaymentMethod(key, v)}
                      disabled={savingMethod === key}
                      className="data-[state=checked]:bg-green-600"
                    />
                  </div>
                );
              })}
            </div>

            <p className="pl-10 text-[11px] text-muted-foreground">
              💡 Desactivar un método lo oculta visualmente para todos los padres.
              No afecta pagos ya realizados ni la configuración por sede (Facturación → Config SUNAT).
            </p>
          </div>

          <div className="border-t" />

          {/* Aviso de seguridad */}
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              <strong>Importante:</strong> Apagar un portal redirige a los usuarios activos de inmediato.
              Solo tú (superadmin) puedes reactivarlo desde aquí.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Diálogo de confirmación para apagar */}
      <AlertDialog open={!!pending} onOpenChange={open => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              ¿Apagar {pending?.label}?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                Todos los usuarios con ese rol actualmente conectados serán redirigidos
                a la pantalla de mantenimiento <strong>de forma inmediata</strong>.
              </p>
              <p className="text-amber-700 font-medium">
                Solo tú como superadmin puedes reactivarlo.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700"
              onClick={() => pending && applyChange(pending.flag, pending.value)}
            >
              Sí, poner en mantenimiento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
