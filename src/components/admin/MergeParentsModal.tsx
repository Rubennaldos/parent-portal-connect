import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  GitMerge, Search, User, Baby, AlertTriangle, CheckCircle2,
  ExternalLink, ChevronRight, Loader2, XCircle, ShieldAlert
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';

interface Student {
  id: string;
  full_name: string;
  grade: string;
  section: string;
  balance: number;
  school_id: string;
  school_name?: string;
  parent_id: string;
}

interface ParentProfile {
  id?: string;
  user_id?: string;
  full_name?: string;
  email?: string;
  profile?: { email?: string; full_name?: string } | null;
  children?: Student[];
}

interface MergeParentsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceParent: ParentProfile;
  onMergeComplete: () => void;
}

export const MergeParentsModal = ({
  open,
  onOpenChange,
  sourceParent,
  onMergeComplete,
}: MergeParentsModalProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<ParentProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [targetParent, setTargetParent] = useState<ParentProfile | null>(null);
  const [targetChildren, setTargetChildren] = useState<Student[]>([]);
  const [loadingTarget, setLoadingTarget] = useState(false);

  const [studentsToDeactivate, setStudentsToDeactivate] = useState<Set<string>>(new Set());

  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  const sourceEmail = sourceParent.profile?.email || sourceParent.email || '';
  const sourceName = sourceParent.full_name || sourceEmail;
  const sourceChildren: Student[] = sourceParent.children || [];

  // Reset al abrir/cerrar
  useEffect(() => {
    if (open) {
      setSearchTerm('');
      setSearchResults([]);
      setTargetParent(null);
      setTargetChildren([]);
      setStudentsToDeactivate(new Set());
      setDone(false);
    }
  }, [open]);

  const handleSearch = async () => {
    if (!searchTerm.trim() || searchTerm.trim().length < 2) return;
    setSearching(true);
    setSearchResults([]);
    try {
      const term = searchTerm.trim();
      let query = supabase
        .from('parent_profiles')
        .select('id, user_id, full_name, email')
        .or(`full_name.ilike.%${term}%,email.ilike.%${term}%`);
      // Excluir al padre origen si tiene user_id válido
      if (sourceParent.user_id) {
        query = query.neq('user_id', sourceParent.user_id);
      }
      const { data, error } = await query.limit(10);
      if (error) throw error;
      setSearchResults(data || []);
    } catch (err: unknown) {
      toast({ variant: 'destructive', title: 'Error buscando padre', description: (err as Error).message });
    } finally {
      setSearching(false);
    }
  };

  const handleSelectTarget = async (parent: ParentProfile) => {
    setTargetParent(parent);
    setLoadingTarget(true);
    try {
      if (!parent.user_id) {
        setTargetChildren([]);
        return;
      }
      const { data, error } = await supabase
        .from('students')
        .select('id, full_name, grade, section, balance, school_id, parent_id')
        .eq('parent_id', parent.user_id)
        .eq('is_active', true);
      if (error) throw error;
      setTargetChildren(data || []);
    } catch (err: unknown) {
      toast({ variant: 'destructive', title: 'Error cargando hijos', description: (err as Error).message });
    } finally {
      setLoadingTarget(false);
    }
    setSearchResults([]);
    setSearchTerm('');
  };

  const toggleDeactivate = (studentId: string) => {
    setStudentsToDeactivate(prev => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  const allChildren = [
    ...sourceChildren.map(s => ({ ...s, owner: 'source' as const })),
    ...targetChildren.map(s => ({ ...s, owner: 'target' as const })),
  ];

  const totalBalance = allChildren.reduce((sum, s) => sum + (s.balance || 0), 0);
  const totalDebt = allChildren.filter(s => (s.balance || 0) < 0).reduce((sum, s) => sum + s.balance, 0);

  const targetEmail = targetParent?.profile?.email || targetParent?.email || '';
  const targetName = targetParent?.full_name || targetEmail;

  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const studentsToDeactivateNames = allChildren
    .filter(s => studentsToDeactivate.has(s.id))
    .map(s => s.full_name);

  const handleConfirm = async () => {
    if (studentsToDeactivate.size === 0) {
      toast({ variant: 'destructive', title: 'Selecciona al menos un alumno duplicado para desactivar' });
      return;
    }
    // Mostrar diálogo de confirmación antes de ejecutar
    setShowConfirmDialog(true);
  };

  const executeDeactivation = async () => {
    if (confirming) return; // Prevenir doble click
    setShowConfirmDialog(false);
    setConfirming(true);
    try {
      const ids = Array.from(studentsToDeactivate);
      const { error } = await supabase
        .from('students')
        .update({ is_active: false })
        .in('id', ids);
      if (error) throw error;
      setDone(true);
      toast({
        title: '✅ Duplicados resueltos',
        description: `${ids.length} registro(s) desactivados. El alumno ya no aparecerá duplicado en el POS.`,
      });
    } catch (err: unknown) {
      toast({ variant: 'destructive', title: 'Error al resolver', description: (err as Error).message });
    } finally {
      setConfirming(false);
    }
  };

  const goToBilling = () => {
    navigate('/cobranzas');
    onOpenChange(false);
  };

  return (
    <>
    {/* Diálogo de confirmación antes de desactivar */}
    <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-700">
            <ShieldAlert className="h-5 w-5" />
            ¿Confirmas la desactivación?
          </DialogTitle>
          <DialogDescription>
            Los siguientes alumnos quedarán INACTIVOS y dejarán de aparecer en el POS:
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-1 my-2">
          {studentsToDeactivateNames.map((name, i) => (
            <li key={i} className="flex items-center gap-2 bg-red-50 border border-red-200 rounded px-3 py-1.5 text-sm text-red-800">
              <XCircle className="h-4 w-4 text-red-500 shrink-0" />
              <strong>{name}</strong>
            </li>
          ))}
        </ul>
        <p className="text-xs text-gray-500">Esta acción se puede revertir contactando al soporte técnico.</p>
        <DialogFooter className="gap-2 mt-2">
          <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
            Cancelar
          </Button>
          <Button onClick={executeDeactivation} className="bg-red-600 hover:bg-red-700 gap-2">
            <XCircle className="h-4 w-4" />
            Sí, desactivar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-orange-700">
            <GitMerge className="h-5 w-5" />
            Resolver Duplicado de Alumno
          </DialogTitle>
          <DialogDescription>
            Busca el segundo padre que también registró al mismo alumno. Luego marca cuál registro es el duplicado para desactivarlo.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          /* ── Pantalla de éxito ── */
          <div className="space-y-4 py-4 text-center">
            <CheckCircle2 className="h-14 w-14 text-green-500 mx-auto" />
            <p className="font-bold text-green-700 text-lg">¡Duplicados resueltos!</p>
            <p className="text-sm text-gray-500">
              Los registros seleccionados fueron desactivados. El alumno ya no aparecerá repetido en el POS.
            </p>
            <div className="flex gap-2 justify-center">
              <Button onClick={goToBilling} variant="outline" className="gap-2">
                <ExternalLink className="h-4 w-4" />
                Ver deudas en Cobranzas
              </Button>
              <Button onClick={onMergeComplete} className="bg-orange-600 hover:bg-orange-700">
                Cerrar y actualizar
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-5 py-2">
            {/* Padre origen */}
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
              <div className="flex items-center gap-2 mb-2">
                <User className="h-4 w-4 text-blue-600" />
                <span className="font-semibold text-blue-800 text-sm">Padre 1 (seleccionado)</span>
              </div>
              <p className="text-sm font-medium text-gray-800">{sourceName}</p>
              <p className="text-xs text-gray-500">{sourceEmail}</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {sourceChildren.map(c => (
                  <Badge key={c.id} variant="outline" className="text-xs border-blue-300 text-blue-700">
                    {c.full_name} — {c.grade} {c.section}
                  </Badge>
                ))}
                {sourceChildren.length === 0 && <span className="text-xs text-gray-400">Sin hijos registrados</span>}
              </div>
            </div>

            {/* Buscar segundo padre */}
            {!targetParent && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-gray-700">Buscar segundo padre:</p>
                <div className="flex gap-2">
                  <Input
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Nombre o correo del segundo padre..."
                    onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  />
                  <Button onClick={handleSearch} disabled={searching || searchTerm.trim().length < 2} variant="outline">
                    {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </Button>
                </div>
                {searchResults.length > 0 && (
                  <div className="border rounded-lg divide-y bg-white shadow-sm">
                    {searchResults.map(p => (
                      <button
                        key={p.id || p.user_id}
                        onClick={() => handleSelectTarget(p)}
                        className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 text-left"
                      >
                        <div>
                          <p className="text-sm font-medium text-gray-800">{p.full_name || '(Sin nombre)'}</p>
                          <p className="text-xs text-gray-500">{p.email}</p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-gray-400" />
                      </button>
                    ))}
                  </div>
                )}
                {searchResults.length === 0 && searchTerm && !searching && (
                  <p className="text-xs text-gray-400 text-center">Sin resultados. Prueba con otro nombre o correo.</p>
                )}
              </div>
            )}

            {/* Padre destino seleccionado */}
            {targetParent && (
              <>
                <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-orange-600" />
                      <span className="font-semibold text-orange-800 text-sm">Padre 2 (encontrado)</span>
                    </div>
                    <button
                      onClick={() => { setTargetParent(null); setTargetChildren([]); }}
                      className="text-xs text-orange-500 hover:text-orange-700 underline"
                    >
                      Cambiar
                    </button>
                  </div>
                  {loadingTarget ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <Loader2 className="h-4 w-4 animate-spin" /> Cargando hijos...
                    </div>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-gray-800">{targetName}</p>
                      <p className="text-xs text-gray-500">{targetEmail}</p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {targetChildren.map(c => (
                          <Badge key={c.id} variant="outline" className="text-xs border-orange-300 text-orange-700">
                            {c.full_name} — {c.grade} {c.section}
                          </Badge>
                        ))}
                        {targetChildren.length === 0 && <span className="text-xs text-gray-400">Sin hijos registrados</span>}
                      </div>
                    </>
                  )}
                </div>

                {/* Resumen combinado */}
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 grid grid-cols-2 gap-3 text-center">
                  <div>
                    <p className="text-xs text-gray-500">Alumnos combinados</p>
                    <p className="text-xl font-bold text-gray-800">{allChildren.length}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Deuda total</p>
                    <p className={`text-xl font-bold ${totalDebt < 0 ? 'text-red-600' : 'text-green-600'}`}>
                      S/ {Math.abs(totalDebt).toFixed(2)}
                    </p>
                  </div>
                </div>

                {/* Marcar duplicados para desactivar */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-red-500" />
                    <p className="text-sm font-semibold text-gray-700">
                      Marca los registros DUPLICADOS a desactivar:
                    </p>
                  </div>
                  <p className="text-xs text-gray-500">
                    Solo marca el que está de más. El POS dejará de mostrarlo. El otro permanece activo.
                  </p>

                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {allChildren.map(student => {
                      const isSelected = studentsToDeactivate.has(student.id);
                      return (
                        <button
                          key={student.id}
                          onClick={() => toggleDeactivate(student.id)}
                          className={`w-full flex items-center gap-3 p-2 rounded-lg border text-left transition-all ${
                            isSelected
                              ? 'border-red-300 bg-red-50'
                              : 'border-gray-200 bg-white hover:border-gray-300'
                          }`}
                        >
                          <div className={`w-5 h-5 rounded flex items-center justify-center border-2 shrink-0 ${
                            isSelected ? 'border-red-500 bg-red-500' : 'border-gray-300'
                          }`}>
                            {isSelected && <XCircle className="h-3 w-3 text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium truncate ${isSelected ? 'text-red-700 line-through' : 'text-gray-800'}`}>
                              {student.full_name}
                            </p>
                            <p className="text-xs text-gray-500">{student.grade} {student.section}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className={`text-sm font-bold ${(student.balance || 0) < 0 ? 'text-red-500' : 'text-green-600'}`}>
                              S/ {(student.balance || 0).toFixed(2)}
                            </p>
                            <Badge variant="outline" className={`text-xs ${student.owner === 'source' ? 'border-blue-200 text-blue-600' : 'border-orange-200 text-orange-600'}`}>
                              {student.owner === 'source' ? 'Padre 1' : 'Padre 2'}
                            </Badge>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Advertencia */}
                {studentsToDeactivate.size > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-800">
                      Se desactivarán <strong>{studentsToDeactivate.size}</strong> registro(s). Esta acción se puede revertir contactando al soporte técnico.
                    </p>
                  </div>
                )}

                {/* Botones */}
                <div className="flex gap-2">
                  <Button variant="outline" onClick={goToBilling} className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-50">
                    <ExternalLink className="h-4 w-4" />
                    Ver deudas en Cobranzas
                  </Button>
                  <Button
                    onClick={handleConfirm}
                    disabled={confirming || studentsToDeactivate.size === 0}
                    className="flex-1 bg-orange-600 hover:bg-orange-700 gap-2"
                  >
                    {confirming
                      ? <><Loader2 className="h-4 w-4 animate-spin" /> Procesando...</>
                      : <><GitMerge className="h-4 w-4" /> Desactivar duplicados ({studentsToDeactivate.size})</>
                    }
                  </Button>
                </div>
              </>
            )}

            {!targetParent && (
              <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full">
                Cancelar
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
};
