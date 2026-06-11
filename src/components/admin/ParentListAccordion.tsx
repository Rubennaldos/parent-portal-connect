import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  KeyRound, GitMerge, MoreVertical, ChevronDown, ChevronUp,
  SmilePlus, Ban, Trash2, Edit, Baby, Phone, Mail, MapPin,
  IdCard, User2, Loader2,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------
export type BehaviorProfile = 'amable' | 'neutro' | 'dificil';

export interface AccordionChildStudent {
  id: string;
  full_name: string;
  grade?: string;
  section?: string;
  photo_url?: string | null;
  free_account?: boolean;
  kiosk_disabled?: boolean;
  limit_type?: string | null;
  daily_limit?: number | null;
  weekly_limit?: number | null;
  monthly_limit?: number | null;
  balance?: number | null;
  school_id?: string;
}

export interface AccordionParentRow {
  id: string;
  user_id: string;
  full_name: string;
  nickname?: string;
  dni?: string;
  document_type?: string;
  phone_1?: string;
  phone_2?: string;
  email?: string;
  address?: string;
  responsible_2_full_name?: string;
  responsible_2_dni?: string;
  responsible_2_document_type?: string;
  responsible_2_phone_1?: string;
  responsible_2_email?: string;
  responsible_2_address?: string;
  school_id?: string;
  school?: { id: string; name: string; code: string } | null;
  school_name?: string;
  profile?: { email: string } | null;
  children?: AccordionChildStudent[];
  created_at?: string;
  behavior_profile?: BehaviorProfile;
  behavior_notes?: string | null;
  is_suspended?: boolean;
}

interface ParentListAccordionProps {
  parents: AccordionParentRow[];
  permissions: {
    canEditParent: boolean;
    canViewBehaviorNotes?: boolean;
  };
  onResetPassword: (parent: AccordionParentRow) => void;
  onMerge: (parent: AccordionParentRow) => void;
  onEditParent: (parent: AccordionParentRow) => void;
  onRefresh?: () => void;
}

// Estado interno del modal CRM
interface CrmModalState {
  parent: AccordionParentRow;
  profile: BehaviorProfile;
  notes: string;
}


// ---------------------------------------------------------------------------
// Sub-componente: tarjeta compacta de alumno (dentro del acordeón)
// ---------------------------------------------------------------------------
function ChildStudentCard({ child }: { child: AccordionChildStudent }) {
  const kioskOff = child.kiosk_disabled === true;
  const limitType = (child.limit_type ?? 'none').toLowerCase();
  const dailyLimit = Number(child.daily_limit ?? 0);
  const weeklyLimit = Number(child.weekly_limit ?? 0);

  // Reglas visuales estrictas (sin alterar el estado real en DB):
  // 1) kiosk_disabled=true  -> solo "Solo Almuerzos"
  // 2) kiosk abierto + sin límite real (none o <10) -> "Consumo Libre"
  // 3) kiosk abierto + tope válido (>=10) -> mostrar únicamente badge de monto
  const hasValidWeeklyLimit = !kioskOff && limitType === 'weekly' && weeklyLimit >= 10;
  const hasValidDailyLimit = !kioskOff && limitType === 'daily' && dailyLimit >= 10;
  const hasLegacyOrInvalidLimit =
    !kioskOff &&
    ((limitType === 'daily' && dailyLimit < 10) || (limitType === 'weekly' && weeklyLimit < 10));
  const shouldShowFreeConsumption = !kioskOff && (limitType === 'none' || hasLegacyOrInvalidLimit);

  return (
    <div className="flex items-start gap-2.5 p-2.5 bg-white rounded-lg border border-slate-200">
      <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center bg-emerald-100 overflow-hidden">
        {child.photo_url
          ? <img src={child.photo_url} alt={child.full_name} className="w-full h-full object-cover" />
          : <span className="text-emerald-700 font-bold text-xs">{child.full_name.charAt(0).toUpperCase()}</span>
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-slate-800 truncate">{child.full_name}</p>
        <p className="text-xs text-slate-400">{child.grade} {child.section}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {kioskOff && (
            <Badge className="text-[10px] px-1.5 py-0 bg-slate-100 text-slate-600 border-slate-300">
              🚫 Solo Almuerzos
            </Badge>
          )}

          {shouldShowFreeConsumption && (
            <Badge className="text-[10px] px-1.5 py-0 bg-emerald-100 text-emerald-700 border-emerald-300">
              ✅ Consumo Libre
            </Badge>
          )}

          {hasValidWeeklyLimit && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-300 text-amber-700 bg-amber-50">
              {`Sem: S/${weeklyLimit.toFixed(2)}`}
            </Badge>
          )}

          {hasValidDailyLimit && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-300 text-amber-700 bg-amber-50">
              {`Día: S/${dailyLimit.toFixed(2)}`}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
export function ParentListAccordion({
  parents,
  permissions,
  onResetPassword,
  onMerge,
  onEditParent,
  onRefresh,
}: ParentListAccordionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { toast } = useToast();

  // ── Estado modal Semáforo CRM ──────────────────────────────────────────────
  const [crmModal, setCrmModal] = useState<CrmModalState | null>(null);
  const [crmSaving, setCrmSaving] = useState(false);

  // ── Estado modal Suspensión ────────────────────────────────────────────────
  const [suspendModal, setSuspendModal] = useState<AccordionParentRow | null>(null);
  const [suspendSaving, setSuspendSaving] = useState(false);

  // ── Estado modal Eliminar Padre Fantasma ───────────────────────────────────
  const [deleteModal, setDeleteModal] = useState<AccordionParentRow | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);

  // ── Handler: guardar semáforo CRM ─────────────────────────────────────────
  const handleSaveBehavior = async () => {
    if (!crmModal) return;
    setCrmSaving(true);
    try {
      const { error } = await supabase.rpc('rpc_admin_update_parent_behavior', {
        p_parent_id: crmModal.parent.id,   // ← PK de parent_profiles (no user_id)
        p_profile:   crmModal.profile,
        p_notes:     crmModal.notes,
      });
      if (error) throw error;
      toast({ title: '✅ Semáforo actualizado', description: `Trato de ${crmModal.parent.full_name} guardado.` });
      setCrmModal(null);
      onRefresh?.();
    } catch (err: any) {
      const msg = err?.message?.includes('ACCESS_DENIED')
        ? 'No tienes permisos para esta acción.'
        : 'No se pudo guardar el cambio. Intenta nuevamente.';
      toast({ variant: 'destructive', title: 'Error al calificar trato', description: msg });
    } finally {
      setCrmSaving(false);
    }
  };

  // ── Handler: alternar suspensión ──────────────────────────────────────────
  const handleToggleSuspension = async () => {
    if (!suspendModal) return;
    setSuspendSaving(true);
    const newState = !suspendModal.is_suspended;
    try {
      const { error } = await supabase.rpc('rpc_admin_toggle_parent_suspension', {
        p_parent_id: suspendModal.id,   // ← PK de parent_profiles (no user_id)
        p_suspend:   newState,
      });
      if (error) throw error;
      toast({
        title: newState ? '⚠️ Cuenta suspendida' : '✅ Cuenta reactivada',
        description: `La cuenta de ${suspendModal.full_name} fue ${newState ? 'suspendida' : 'reactivada'}.`,
      });
      setSuspendModal(null);
      onRefresh?.();
    } catch (err: any) {
      const msg = err?.message?.includes('ACCESS_DENIED')
        ? 'No tienes permisos para esta acción.'
        : 'No se pudo cambiar el estado. Intenta nuevamente.';
      toast({ variant: 'destructive', title: 'Error al cambiar estado', description: msg });
    } finally {
      setSuspendSaving(false);
    }
  };

  // ── Handler: soft delete de padre sin hijos ───────────────────────────────
  const handleSoftDelete = async () => {
    if (!deleteModal) return;
    setDeleteSaving(true);
    try {
      const { error } = await supabase.rpc('rpc_admin_soft_delete_orphan_parent', {
        p_parent_id: deleteModal.id,   // ← PK de parent_profiles (no user_id)
      });
      if (error) throw error;
      toast({
        title: '🗑️ Padre eliminado',
        description: `${deleteModal.full_name} fue eliminado del sistema. El registro queda en auditoría.`,
      });
      setDeleteModal(null);
      onRefresh?.();
    } catch (err: any) {
      const raw = err?.message ?? '';
      const msg = raw.includes('ACCESS_DENIED')
        ? 'No tienes permisos para eliminar perfiles.'
        : raw.includes('PARENT_HAS_CHILDREN')
          ? 'Este padre tiene alumnos vinculados. Desvincula los alumnos primero.'
          : raw.includes('PARENT_NOT_FOUND')
            ? 'El padre ya fue eliminado o no existe.'
            : 'No se pudo eliminar el perfil. Intenta nuevamente.';
      toast({ variant: 'destructive', title: 'Error al eliminar', description: msg });
    } finally {
      setDeleteSaving(false);
    }
  };

  if (parents.length === 0) return null;

  return (
    <>
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden divide-y divide-slate-100 shadow-sm">
      {/* Cabecera de tabla */}
      <div className="hidden md:flex items-center gap-3 px-4 py-2 bg-slate-50 border-b border-slate-200">
        <span className="w-9 flex-shrink-0" />
        <span className="flex-1 text-xs font-semibold text-slate-500 uppercase tracking-wider">Padre / Apoderado</span>
        <span className="w-44 flex-shrink-0 text-xs font-semibold text-slate-500 uppercase tracking-wider">Correo</span>
        <span className="hidden lg:block w-32 flex-shrink-0 text-xs font-semibold text-slate-500 uppercase tracking-wider">Sede</span>
        <span className="w-28 flex-shrink-0" />
      </div>

      {parents.map((parent) => {
        const isExpanded      = expandedId === parent.id;
        const email           = parent.email || parent.profile?.email;
        const schoolName      = parent.school?.name || parent.school_name;
        const childCount      = parent.children?.length ?? 0;
        const hasResponsible2 = Boolean(parent.responsible_2_full_name);
        const canViewBehaviorNotes = permissions.canViewBehaviorNotes ?? permissions.canEditParent;
        const behaviorNotes = parent.behavior_notes?.trim() ?? '';
        const showBehaviorNotes = canViewBehaviorNotes && behaviorNotes.length > 0;
        const bp              = parent.behavior_profile ?? 'neutro';

        return (
          <div key={parent.id}>
            {/* ── Fila principal ── */}
            <div
              className={`flex items-center gap-3 px-4 py-3 cursor-pointer select-none transition-colors hover:bg-slate-50 ${isExpanded ? 'bg-emerald-50/40' : ''}`}
              onClick={() => setExpandedId(isExpanded ? null : parent.id)}
            >
              {/* Avatar limpio (sin anillo) */}
              <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-sm flex-shrink-0">
                {parent.full_name.charAt(0).toUpperCase()}
              </div>

              {/* Nombre + indicadores */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center flex-wrap gap-1.5">
                  <span className="font-semibold text-slate-900 text-sm">{parent.full_name}</span>

                  {/* Carita CRM — solo amable o difícil, neutro = nada */}
                  {bp === 'amable' && (
                    <span title="Trato: Amable" className="text-base leading-none select-none">😊</span>
                  )}
                  {bp === 'dificil' && (
                    <span title="Trato: Difícil" className="text-base leading-none select-none">😤</span>
                  )}

                  {/* Badge hijos */}
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-blue-50 border-blue-200 text-blue-700 flex items-center gap-0.5">
                    <Baby className="h-2.5 w-2.5" />
                    {childCount}
                  </Badge>

                  {/* Suspendido */}
                  {parent.is_suspended && (
                    <Badge className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-700 border-amber-200">
                      🚫 Susp.
                    </Badge>
                  )}
                </div>
                {parent.nickname && (
                  <p className="text-xs text-slate-400 truncate mt-0.5">"{parent.nickname}"</p>
                )}
              </div>

              {/* Email */}
              <p className="hidden md:block text-xs text-slate-500 w-44 truncate flex-shrink-0">
                {email || '—'}
              </p>

              {/* Sede */}
              <p className="hidden lg:block text-xs text-slate-500 w-32 truncate flex-shrink-0">
                {schoolName || '—'}
              </p>

              {/* Acciones inline (detienen propagación del acordeón) */}
              <div
                className="flex items-center gap-0.5 flex-shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <Button
                  size="icon" variant="ghost"
                  className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50"
                  onClick={() => onResetPassword(parent)}
                  title="Restablecer contraseña"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon" variant="ghost"
                  className="h-8 w-8 text-slate-400 hover:text-orange-600 hover:bg-orange-50"
                  onClick={() => onMerge(parent)}
                  title="Unir con duplicado"
                >
                  <GitMerge className="h-3.5 w-3.5" />
                </Button>

                {/* Menú de 3 puntos */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon" variant="ghost"
                      className="h-8 w-8 text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                    >
                      <MoreVertical className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuLabel className="text-xs text-slate-500">Gestión</DropdownMenuLabel>

                    {permissions.canEditParent && (
                      <DropdownMenuItem onClick={() => onEditParent(parent)}>
                        <Edit className="mr-2 h-4 w-4 text-slate-500" />
                        Editar datos
                      </DropdownMenuItem>
                    )}

                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs text-slate-500">Mini-CRM</DropdownMenuLabel>

                    <DropdownMenuItem
                      onClick={() => setCrmModal({
                        parent,
                        profile: parent.behavior_profile ?? 'neutro',
                        notes:   parent.behavior_notes ?? '',
                      })}
                      className="text-indigo-700 focus:text-indigo-700 focus:bg-indigo-50"
                    >
                      <SmilePlus className="mr-2 h-4 w-4" />
                      Calificar Trato
                    </DropdownMenuItem>

                    <DropdownMenuSeparator />

                    <DropdownMenuItem
                      onClick={() => setSuspendModal(parent)}
                      className="text-amber-700 focus:text-amber-700 focus:bg-amber-50"
                    >
                      <Ban className="mr-2 h-4 w-4" />
                      {parent.is_suspended ? 'Reactivar Cuenta' : 'Suspender Cuenta'}
                    </DropdownMenuItem>

                    {childCount === 0 ? (
                      <DropdownMenuItem
                        onClick={() => setDeleteModal(parent)}
                        className="text-red-600 focus:text-red-600 focus:bg-red-50"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Eliminar Padre
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        disabled
                        className="text-red-400 opacity-50 cursor-not-allowed"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Eliminar Padre
                        <span className="ml-auto text-[10px] text-slate-400">Con hijos</span>
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Chevron acordeón */}
              <div className="text-slate-300 flex-shrink-0 pointer-events-none">
                {isExpanded
                  ? <ChevronUp   className="h-4 w-4" />
                  : <ChevronDown className="h-4 w-4" />
                }
              </div>
            </div>

            {/* ── Panel expandido ── */}
            {isExpanded && (
              <div className="bg-slate-50/60 border-t border-slate-100 px-6 py-5">
                <div className={`grid gap-6 ${hasResponsible2 ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1 md:grid-cols-2'}`}>

                  {/* Responsable Principal */}
                  <div>
                    <h4 className="text-xs font-bold text-emerald-800 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <User2 className="h-3.5 w-3.5" />
                      Responsable Principal
                    </h4>
                    <div className="space-y-2 text-sm">
                      {parent.dni && (
                        <div className="flex items-center gap-2 text-slate-700">
                          <IdCard className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                          <span>{parent.document_type || 'DNI'}: <strong>{parent.dni}</strong></span>
                        </div>
                      )}
                      {parent.phone_1 && (
                        <div className="flex items-center gap-2 text-slate-700">
                          <Phone className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                          <span>{parent.phone_1}</span>
                        </div>
                      )}
                      {parent.phone_2 && (
                        <div className="flex items-center gap-2 text-slate-700">
                          <Phone className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                          <span>{parent.phone_2} <span className="text-slate-400 text-xs">(alt.)</span></span>
                        </div>
                      )}
                      {email && (
                        <div className="flex items-center gap-2 text-slate-700">
                          <Mail className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                          <span className="break-all text-xs">{email}</span>
                        </div>
                      )}
                      {parent.address && (
                        <div className="flex items-start gap-2 text-slate-700">
                          <MapPin className="h-3.5 w-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
                          <span className="text-xs">{parent.address}</span>
                        </div>
                      )}

                      {showBehaviorNotes && (
                        <div className="rounded-md border border-indigo-200 bg-indigo-50/70 px-3 py-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                            Nota administrativa:
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-xs text-slate-700">
                            {behaviorNotes}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Segundo Responsable (solo si existe) */}
                  {hasResponsible2 && (
                    <div>
                      <h4 className="text-xs font-bold text-teal-800 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                        <User2 className="h-3.5 w-3.5" />
                        Segundo Responsable
                      </h4>
                      <div className="space-y-2 text-sm">
                        <p className="font-semibold text-slate-800">{parent.responsible_2_full_name}</p>
                        {parent.responsible_2_dni && (
                          <div className="flex items-center gap-2 text-slate-700">
                            <IdCard className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                            <span>{parent.responsible_2_document_type || 'DNI'}: <strong>{parent.responsible_2_dni}</strong></span>
                          </div>
                        )}
                        {parent.responsible_2_phone_1 && (
                          <div className="flex items-center gap-2 text-slate-700">
                            <Phone className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                            <span>{parent.responsible_2_phone_1}</span>
                          </div>
                        )}
                        {parent.responsible_2_email && (
                          <div className="flex items-center gap-2 text-slate-700">
                            <Mail className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                            <span className="break-all text-xs">{parent.responsible_2_email}</span>
                          </div>
                        )}
                        {parent.responsible_2_address && (
                          <div className="flex items-start gap-2 text-slate-700">
                            <MapPin className="h-3.5 w-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
                            <span className="text-xs">{parent.responsible_2_address}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Hijos */}
                  <div className={!hasResponsible2 ? '' : ''}>
                    <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <Baby className="h-3.5 w-3.5" />
                      Hijos ({childCount})
                    </h4>
                    {childCount > 0 ? (
                      <div className="space-y-2">
                        {(parent.children ?? []).map((child) => (
                          <ChildStudentCard key={child.id} child={child} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">Sin hijos registrados.</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>

    {/* ── Modal: Semáforo CRM ─────────────────────────────────────────── */}
    <Dialog open={!!crmModal} onOpenChange={(open) => { if (!open && !crmSaving) setCrmModal(null); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SmilePlus className="h-5 w-5 text-indigo-600" />
            Calificar Trato
          </DialogTitle>
          <DialogDescription>
            {crmModal?.parent.full_name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="crm-profile">Actitud del padre</Label>
            <Select
              value={crmModal?.profile ?? 'neutro'}
              onValueChange={(v) =>
                crmModal && setCrmModal({ ...crmModal, profile: v as BehaviorProfile })
              }
            >
              <SelectTrigger id="crm-profile">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="amable">🟢 Amable</SelectItem>
                <SelectItem value="neutro">⚪ Neutro</SelectItem>
                <SelectItem value="dificil">🔴 Difícil</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="crm-notes">
              Nota interna <span className="text-slate-400 font-normal">(solo admins)</span>
            </Label>
            <Textarea
              id="crm-notes"
              placeholder="Ej: Exige boleta al instante, tratar con paciencia..."
              value={crmModal?.notes ?? ''}
              onChange={(e) =>
                crmModal && setCrmModal({ ...crmModal, notes: e.target.value })
              }
              rows={3}
              className="resize-none"
              disabled={crmSaving}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setCrmModal(null)} disabled={crmSaving}>
            Cancelar
          </Button>
          <Button
            onClick={handleSaveBehavior}
            disabled={crmSaving}
            className="bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {crmSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* ── Modal: Eliminar Padre Fantasma (soft delete auditado) ───────── */}
    <Dialog open={!!deleteModal} onOpenChange={(open) => { if (!open && !deleteSaving) setDeleteModal(null); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-700">
            <Trash2 className="h-5 w-5" />
            Eliminar Padre
          </DialogTitle>
          <DialogDescription className="space-y-2 pt-1">
            <span className="block">
              ¿Estás seguro de eliminar a <strong>{deleteModal?.full_name}</strong>?
            </span>
            <span className="block text-xs text-slate-500">
              El padre desaparecerá del sistema, pero su registro quedará guardado en la base de datos para auditoría. Esta acción solo es posible porque este padre no tiene alumnos vinculados.
            </span>
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setDeleteModal(null)}
            disabled={deleteSaving}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSoftDelete}
            disabled={deleteSaving}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {deleteSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Eliminar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* ── Modal: Suspender / Reactivar ─────────────────────────────────── */}
    <Dialog open={!!suspendModal} onOpenChange={(open) => { if (!open && !suspendSaving) setSuspendModal(null); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {suspendModal?.is_suspended
              ? <span className="text-lg">↩️</span>
              : <Ban className="h-5 w-5 text-amber-600" />
            }
            {suspendModal?.is_suspended ? 'Reactivar Cuenta' : 'Suspender Cuenta'}
          </DialogTitle>
          <DialogDescription>
            {suspendModal?.is_suspended
              ? `¿Deseas reactivar la cuenta de ${suspendModal?.full_name}? Podrá volver a iniciar sesión y realizar pagos.`
              : `¿Estás seguro de suspender la cuenta de ${suspendModal?.full_name}? No podrá iniciar sesión ni realizar pagos hasta que se reactive.`
            }
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setSuspendModal(null)}
            disabled={suspendSaving}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleToggleSuspension}
            disabled={suspendSaving}
            className={
              suspendModal?.is_suspended
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-amber-600 hover:bg-amber-700 text-white'
            }
          >
            {suspendSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {suspendModal?.is_suspended ? 'Reactivar' : 'Suspender'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
