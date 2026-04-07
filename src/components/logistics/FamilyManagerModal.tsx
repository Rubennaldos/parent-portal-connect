import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Pencil, Trash2, ChevronRight, ChevronDown, Check, X } from 'lucide-react';

interface Family {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  subfamilies?: Subfamily[];
}

interface Subfamily {
  id: string;
  family_id: string;
  name: string;
  active: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

// ── Estado inicial de los formularios inline (para reset limpio) ──────────────
const EMPTY_FORM = {
  editFamilyId:   null as string | null,
  editFamilyName: '',
  editFamilyDesc: '',
  newFamilyName:  '',
  newFamilyDesc:  '',
  addingFamily:   false,
  editSubId:      null as string | null,
  editSubName:    '',
  addingSubFor:   null as string | null,
  newSubName:     '',
};

export const FamilyManagerModal = ({ open, onClose }: Props) => {
  const { toast } = useToast();
  const [families, setFamilies] = useState<Family[]>([]);
  const [loading, setLoading]   = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Formularios inline — reseteable en bloque
  const [form, setForm] = useState(EMPTY_FORM);

  // Loading individuales por acción (evita que un spinner bloquee toda la UI)
  const [savingFamilyEdit, setSavingFamilyEdit]   = useState(false);
  const [savingNewFamily, setSavingNewFamily]     = useState(false);
  const [savingSubEdit, setSavingSubEdit]         = useState(false);
  const [savingNewSub, setSavingNewSub]           = useState(false);
  const [deletingId, setDeletingId]               = useState<string | null>(null);

  const resetForm = useCallback(() => setForm(EMPTY_FORM), []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [resetForm, onClose]);

  useEffect(() => {
    if (open) {
      resetForm();
      loadData();
    }
  }, [open]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [{ data: fams, error: e1 }, { data: subs, error: e2 }] = await Promise.all([
        supabase.from('product_families').select('*').order('name'),
        supabase.from('product_subfamilies').select('*').order('name'),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      setFamilies((fams || []).map(f => ({
        ...f,
        subfamilies: (subs || []).filter(s => s.family_id === f.id),
      })));
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al cargar familias', description: e.message });
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (id: string) =>
    setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const setF = (patch: Partial<typeof EMPTY_FORM>) => setForm(prev => ({ ...prev, ...patch }));

  // ── Validación ────────────────────────────────────────────────────────────
  const validateName = (name: string, label: string): boolean => {
    if (!name.trim()) {
      toast({ variant: 'destructive', title: 'Campo obligatorio', description: `El nombre de ${label} no puede estar vacío.` });
      return false;
    }
    return true;
  };

  // ── Familias ─────────────────────────────────────────────────────────────
  const saveFamily = async () => {
    if (!validateName(form.editFamilyName, 'la familia')) return;
    setSavingFamilyEdit(true);
    try {
      const { error } = await supabase
        .from('product_families')
        .update({ name: form.editFamilyName.trim(), description: form.editFamilyDesc.trim() || null })
        .eq('id', form.editFamilyId!);
      if (error) throw error;
      toast({ title: '✅ Familia actualizada' });
      setF({ editFamilyId: null, editFamilyName: '', editFamilyDesc: '' });
      loadData();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al guardar', description: e.message });
    } finally {
      setSavingFamilyEdit(false);
    }
  };

  const createFamily = async () => {
    if (!validateName(form.newFamilyName, 'la familia')) return;
    setSavingNewFamily(true);
    try {
      const { error } = await supabase
        .from('product_families')
        .insert({ name: form.newFamilyName.trim(), description: form.newFamilyDesc.trim() || null });
      if (error) throw error;
      toast({ title: '✅ Familia creada' });
      setF({ newFamilyName: '', newFamilyDesc: '', addingFamily: false });
      loadData();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al crear', description: e.message });
    } finally {
      setSavingNewFamily(false);
    }
  };

  const deleteFamily = async (id: string, name: string) => {
    if (!confirm(`¿Eliminar la familia "${name}"? Esto también eliminará sus subfamilias.`)) return;
    setDeletingId(id);
    try {
      const { error } = await supabase.from('product_families').delete().eq('id', id);
      if (error) throw error;
      toast({ title: '✅ Familia eliminada' });
      loadData();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al eliminar', description: e.message });
    } finally {
      setDeletingId(null);
    }
  };

  // ── Subfamilias ───────────────────────────────────────────────────────────
  const saveSubfamily = async () => {
    if (!validateName(form.editSubName, 'la subfamilia')) return;
    setSavingSubEdit(true);
    try {
      const { error } = await supabase
        .from('product_subfamilies')
        .update({ name: form.editSubName.trim() })
        .eq('id', form.editSubId!);
      if (error) throw error;
      toast({ title: '✅ Subfamilia actualizada' });
      setF({ editSubId: null, editSubName: '' });
      loadData();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al guardar', description: e.message });
    } finally {
      setSavingSubEdit(false);
    }
  };

  const createSubfamily = async (familyId: string) => {
    if (!validateName(form.newSubName, 'la subfamilia')) return;
    setSavingNewSub(true);
    try {
      const { error } = await supabase
        .from('product_subfamilies')
        .insert({ family_id: familyId, name: form.newSubName.trim() });
      if (error) throw error;
      toast({ title: '✅ Subfamilia creada' });
      setF({ newSubName: '', addingSubFor: null });
      loadData();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al crear', description: e.message });
    } finally {
      setSavingNewSub(false);
    }
  };

  const deleteSubfamily = async (id: string, name: string) => {
    if (!confirm(`¿Eliminar subfamilia "${name}"?`)) return;
    setDeletingId(id);
    try {
      const { error } = await supabase.from('product_subfamilies').delete().eq('id', id);
      if (error) throw error;
      toast({ title: '✅ Subfamilia eliminada' });
      loadData();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error al eliminar', description: e.message });
    } finally {
      setDeletingId(null);
    }
  };

  const anyBusy = savingFamilyEdit || savingNewFamily || savingSubEdit || savingNewSub || !!deletingId;

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-lg font-black">Gestionar Familias de Productos</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-[#8B4513]" />
            </div>
          ) : (
            <>
              {families.map(fam => (
                <div key={fam.id} className="border rounded-lg overflow-hidden">
                  {/* Fila de familia */}
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50 hover:bg-slate-100">
                    <button onClick={() => toggleExpand(fam.id)} className="text-slate-400 shrink-0">
                      {expanded.has(fam.id)
                        ? <ChevronDown className="h-4 w-4" />
                        : <ChevronRight className="h-4 w-4" />}
                    </button>

                    {form.editFamilyId === fam.id ? (
                      <div className="flex-1 flex items-center gap-2">
                        <Input
                          value={form.editFamilyName}
                          onChange={e => setF({ editFamilyName: e.target.value })}
                          placeholder="Nombre"
                          className={`h-7 text-sm flex-1 ${!form.editFamilyName.trim() ? 'border-red-300' : ''}`}
                          onKeyDown={e => e.key === 'Enter' && saveFamily()}
                          disabled={savingFamilyEdit}
                        />
                        <Input
                          value={form.editFamilyDesc}
                          onChange={e => setF({ editFamilyDesc: e.target.value })}
                          placeholder="Descripción (opcional)"
                          className="h-7 text-sm flex-1"
                          disabled={savingFamilyEdit}
                        />
                        <Button
                          size="sm" className="h-7 w-7 p-0 bg-green-600 hover:bg-green-700"
                          onClick={saveFamily}
                          disabled={savingFamilyEdit || !form.editFamilyName.trim()}
                        >
                          {savingFamilyEdit
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Check className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          size="sm" variant="ghost" className="h-7 w-7 p-0"
                          onClick={() => setF({ editFamilyId: null, editFamilyName: '', editFamilyDesc: '' })}
                          disabled={savingFamilyEdit}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex-1 flex items-center justify-between">
                        <div>
                          <span className="font-semibold text-sm text-slate-800">{fam.name}</span>
                          {fam.description && <span className="text-xs text-slate-400 ml-2">{fam.description}</span>}
                          <Badge variant="outline" className="ml-2 text-[10px] h-4">
                            {fam.subfamilies?.length ?? 0} subfamilias
                          </Badge>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            size="sm" variant="ghost" className="h-6 w-6 p-0"
                            disabled={anyBusy}
                            onClick={() => setF({ editFamilyId: fam.id, editFamilyName: fam.name, editFamilyDesc: fam.description || '' })}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm" variant="ghost"
                            className="h-6 w-6 p-0 text-red-400 hover:text-red-600"
                            disabled={deletingId === fam.id || anyBusy}
                            onClick={() => deleteFamily(fam.id, fam.name)}
                          >
                            {deletingId === fam.id
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <Trash2 className="h-3 w-3" />}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Subfamilias */}
                  {expanded.has(fam.id) && (
                    <div className="pl-8 pr-3 py-2 space-y-1 bg-white border-t">
                      {fam.subfamilies?.map(sub => (
                        <div key={sub.id} className="flex items-center gap-2 py-1">
                          {form.editSubId === sub.id ? (
                            <>
                              <Input
                                value={form.editSubName}
                                onChange={e => setF({ editSubName: e.target.value })}
                                className={`h-7 text-sm flex-1 ${!form.editSubName.trim() ? 'border-red-300' : ''}`}
                                onKeyDown={e => e.key === 'Enter' && saveSubfamily()}
                                disabled={savingSubEdit}
                              />
                              <Button
                                size="sm" className="h-7 w-7 p-0 bg-green-600 hover:bg-green-700"
                                onClick={saveSubfamily}
                                disabled={savingSubEdit || !form.editSubName.trim()}
                              >
                                {savingSubEdit
                                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  : <Check className="h-3.5 w-3.5" />}
                              </Button>
                              <Button
                                size="sm" variant="ghost" className="h-7 w-7 p-0"
                                onClick={() => setF({ editSubId: null, editSubName: '' })}
                                disabled={savingSubEdit}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <span className="text-sm text-slate-700 flex-1">• {sub.name}</span>
                              <Button
                                size="sm" variant="ghost" className="h-6 w-6 p-0"
                                disabled={anyBusy}
                                onClick={() => setF({ editSubId: sub.id, editSubName: sub.name })}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm" variant="ghost"
                                className="h-6 w-6 p-0 text-red-400 hover:text-red-600"
                                disabled={deletingId === sub.id || anyBusy}
                                onClick={() => deleteSubfamily(sub.id, sub.name)}
                              >
                                {deletingId === sub.id
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : <Trash2 className="h-3 w-3" />}
                              </Button>
                            </>
                          )}
                        </div>
                      ))}

                      {form.addingSubFor === fam.id ? (
                        <div className="flex items-center gap-2 pt-1">
                          <Input
                            value={form.newSubName}
                            onChange={e => setF({ newSubName: e.target.value })}
                            placeholder="Nueva subfamilia..."
                            className={`h-7 text-sm flex-1 ${!form.newSubName.trim() && form.newSubName !== '' ? 'border-red-300' : ''}`}
                            onKeyDown={e => e.key === 'Enter' && createSubfamily(fam.id)}
                            autoFocus
                            disabled={savingNewSub}
                          />
                          <Button
                            size="sm" className="h-7 w-7 p-0 bg-green-600 hover:bg-green-700"
                            onClick={() => createSubfamily(fam.id)}
                            disabled={savingNewSub || !form.newSubName.trim()}
                          >
                            {savingNewSub
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Check className="h-3.5 w-3.5" />}
                          </Button>
                          <Button
                            size="sm" variant="ghost" className="h-7 w-7 p-0"
                            onClick={() => setF({ addingSubFor: null, newSubName: '' })}
                            disabled={savingNewSub}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setF({ addingSubFor: fam.id, newSubName: '' });
                            setExpanded(prev => new Set([...prev, fam.id]));
                          }}
                          disabled={anyBusy}
                          className="text-xs text-[#8B4513] hover:underline flex items-center gap-1 pt-1 disabled:opacity-40"
                        >
                          <Plus className="h-3 w-3" /> Añadir subfamilia
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* Nueva familia */}
              {form.addingFamily ? (
                <div className="border rounded-lg p-3 space-y-2 bg-amber-50 border-amber-200">
                  <Input
                    value={form.newFamilyName}
                    onChange={e => setF({ newFamilyName: e.target.value })}
                    placeholder="Nombre de la familia (ej: Bebidas)"
                    className={`h-8 ${!form.newFamilyName.trim() && form.newFamilyName !== '' ? 'border-red-400' : ''}`}
                    onKeyDown={e => e.key === 'Enter' && createFamily()}
                    autoFocus
                    disabled={savingNewFamily}
                  />
                  {!form.newFamilyName.trim() && form.newFamilyName !== '' && (
                    <p className="text-xs text-red-500">El nombre no puede estar vacío.</p>
                  )}
                  <Input
                    value={form.newFamilyDesc}
                    onChange={e => setF({ newFamilyDesc: e.target.value })}
                    placeholder="Descripción (opcional)"
                    className="h-8"
                    disabled={savingNewFamily}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="bg-[#8B4513] hover:bg-[#6F370F]"
                      onClick={createFamily}
                      disabled={savingNewFamily || !form.newFamilyName.trim()}
                    >
                      {savingNewFamily
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        : <Check className="h-3.5 w-3.5 mr-1" />}
                      Crear
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      onClick={() => setF({ addingFamily: false, newFamilyName: '', newFamilyDesc: '' })}
                      disabled={savingNewFamily}
                    >
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline" className="w-full border-dashed"
                  onClick={() => setF({ addingFamily: true, newFamilyName: '', newFamilyDesc: '' })}
                  disabled={anyBusy}
                >
                  <Plus className="h-4 w-4 mr-2" /> Nueva Familia
                </Button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
