import { useCallback, useEffect, useState } from 'react';
import { Building2, Loader2, Save, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { SUPPORT_TECH_WHATSAPP } from '@/config/support.config';

interface SchoolDirectoryRow {
  id: string;
  name: string;
  admin_name: string | null;
  admin_whatsapp: string | null;
}

interface SchoolDraft {
  adminName: string;
  adminWhatsapp: string;
}

function normalizeWhatsappInput(value: string): string {
  const cleaned = value.replace(/[^\d+]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('+')) {
    return `+${cleaned.slice(1).replace(/\+/g, '')}`;
  }
  return cleaned.replace(/\+/g, '');
}

function isValidWhatsapp(value: string): boolean {
  if (!value.trim()) return true;
  return /^\+?\d+$/.test(value.trim());
}

export function SupportDirectoryPanel() {
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [savingBySchoolId, setSavingBySchoolId] = useState<Record<string, boolean>>({});

  const [schools, setSchools] = useState<SchoolDirectoryRow[]>([]);
  const [schoolDrafts, setSchoolDrafts] = useState<Record<string, SchoolDraft>>({});

  const fetchSupportDirectory = useCallback(async () => {
    setLoading(true);
    try {
      const { data: schoolsData, error: schoolsError } = await supabase
        .from('schools')
        .select('id, name, admin_name, admin_whatsapp')
        .order('name', { ascending: true });
      if (schoolsError) throw schoolsError;

      const rows = (schoolsData ?? []) as SchoolDirectoryRow[];
      setSchools(rows);

      const drafts = rows.reduce<Record<string, SchoolDraft>>((acc, row) => {
        acc[row.id] = {
          adminName: row.admin_name ?? '',
          adminWhatsapp: normalizeWhatsappInput(row.admin_whatsapp ?? ''),
        };
        return acc;
      }, {});
      setSchoolDrafts(drafts);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error cargando directorio',
        description: error?.message ?? 'No se pudo cargar la configuración de soporte.',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchSupportDirectory();
  }, [fetchSupportDirectory]);

  const handleSaveSchool = async (schoolId: string) => {
    const draft = schoolDrafts[schoolId];
    if (!draft) return;
    const normalizedWhatsapp = normalizeWhatsappInput(draft.adminWhatsapp);

    if (!isValidWhatsapp(normalizedWhatsapp)) {
      toast({
        variant: 'destructive',
        title: 'WhatsApp inválido',
        description: 'El WhatsApp solo puede contener números y opcionalmente "+" al inicio.',
      });
      return;
    }

    setSavingBySchoolId((prev) => ({ ...prev, [schoolId]: true }));
    try {
      const payload = {
        admin_name: draft.adminName.trim() || null,
        admin_whatsapp: normalizedWhatsapp || null,
      };

      const { error } = await supabase
        .from('schools')
        .update(payload)
        .eq('id', schoolId);
      if (error) throw error;

      setSchools((prev) =>
        prev.map((row) =>
          row.id === schoolId
            ? {
                ...row,
                admin_name: payload.admin_name,
                admin_whatsapp: payload.admin_whatsapp,
              }
            : row
        )
      );

      toast({ title: 'Sede actualizada', description: 'Los datos de soporte de la sede fueron guardados.' });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'No se pudo guardar la sede',
        description: error?.message ?? 'Intenta nuevamente.',
      });
    } finally {
      setSavingBySchoolId((prev) => ({ ...prev, [schoolId]: false }));
    }
  };

  return (
    <div className="space-y-5 rounded-2xl border border-emerald-100 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-100 to-violet-100">
          <ShieldCheck className="h-4 w-4 text-emerald-700" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-800">Directorio de Soporte por Sede</h3>
          <p className="text-xs text-slate-500">
            Gestiona nombre de administradora y WhatsApp de soporte por colegio.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-4 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando configuración de soporte...
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-violet-100 bg-violet-50/40 p-4">
            <div className="mb-1">
              <h4 className="text-sm font-semibold text-violet-800">Soporte Técnico General (Admin)</h4>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-violet-200 bg-white px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">Responsable</p>
                <p className="text-sm font-semibold text-slate-800">Admin</p>
              </div>
              <div className="rounded-lg border border-violet-200 bg-white px-3 py-2 md:col-span-2">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">WhatsApp técnico (solo lectura)</p>
                <p className="text-sm font-semibold text-slate-800">{SUPPORT_TECH_WHATSAPP || 'No configurado'}</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-emerald-100 bg-emerald-50/30 p-4">
            <div className="mb-3">
              <h4 className="text-sm font-semibold text-emerald-800">Administradoras por Sede</h4>
              <p className="text-xs text-emerald-700/80">
                Edita nombre y WhatsApp de cada sede activa.
              </p>
            </div>

            <Table>
              <TableHeader>
                <TableRow className="bg-emerald-50/50">
                  <TableHead className="text-[11px] font-semibold text-emerald-900">Sede</TableHead>
                  <TableHead className="text-[11px] font-semibold text-emerald-900">Administradora</TableHead>
                  <TableHead className="text-[11px] font-semibold text-emerald-900">WhatsApp</TableHead>
                  <TableHead className="w-[140px] text-right text-[11px] font-semibold text-emerald-900">
                    Acción
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schools.map((school) => {
                  const draft = schoolDrafts[school.id] ?? { adminName: '', adminWhatsapp: '' };
                  const saving = !!savingBySchoolId[school.id];
                  const hasChanges =
                    draft.adminName.trim() !== (school.admin_name ?? '').trim() ||
                    normalizeWhatsappInput(draft.adminWhatsapp) !== normalizeWhatsappInput(school.admin_whatsapp ?? '');

                  return (
                    <TableRow key={school.id}>
                      <TableCell className="text-xs font-medium text-slate-700">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-3.5 w-3.5 text-emerald-600" />
                          {school.name}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Input
                          value={draft.adminName}
                          onChange={(e) =>
                            setSchoolDrafts((prev) => ({
                              ...prev,
                              [school.id]: {
                                ...prev[school.id],
                                adminName: e.target.value,
                              },
                            }))
                          }
                          placeholder="Nombre administradora"
                          className="h-9 border-emerald-200 bg-white text-sm"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={draft.adminWhatsapp}
                          onChange={(e) =>
                            setSchoolDrafts((prev) => ({
                              ...prev,
                              [school.id]: {
                                ...prev[school.id],
                                adminWhatsapp: normalizeWhatsappInput(e.target.value),
                              },
                            }))
                          }
                          inputMode="tel"
                          placeholder="+51999999999"
                          className="h-9 border-emerald-200 bg-white text-sm"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                          disabled={saving || !hasChanges}
                          onClick={() => handleSaveSchool(school.id)}
                          title="Guardar soporte de sede"
                        >
                          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
