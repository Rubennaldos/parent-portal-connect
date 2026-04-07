import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  CreditCard,
  Search,
  Plus,
  Wifi,
  WifiOff,
  RefreshCw,
  User,
  GraduationCap,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  Pencil,
  RotateCcw,
  Building2,
} from 'lucide-react';

// ──────────────────────────────────────────────
// Tipos
// ──────────────────────────────────────────────
interface NFCCard {
  id: string;
  card_uid: string;
  card_number: string | null;
  holder_type: 'student' | 'teacher' | null;
  student_id: string | null;
  teacher_id: string | null;
  school_id: string;
  is_active: boolean;
  assigned_at: string | null;
  notes: string | null;
  // joins
  student?: { full_name: string; grade: string; section: string } | null;
  teacher?: { full_name: string } | null;
  school?: { name: string } | null;
}

interface StudentResult {
  id: string;
  full_name: string;
  grade: string;
  section: string;
  school_id: string;
}

interface TeacherResult {
  id: string;
  full_name: string;
  school_1_id?: string;
  school_2_id?: string;
}

interface NFCCardsManagerProps {
  /** Si se pasa, filtra tarjetas de esa sede. Si no, muestra todas (superadmin). */
  schoolId: string | null;
}

// ──────────────────────────────────────────────
// Componente principal
// ──────────────────────────────────────────────
export function NFCCardsManager({ schoolId }: NFCCardsManagerProps) {
  const { user } = useAuth();
  const { role } = useRole();
  const { toast } = useToast();

  // Lista de tarjetas
  const [cards, setCards] = useState<NFCCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'student' | 'teacher' | 'unassigned'>('all');
  const [filterSchool, setFilterSchool] = useState<string>('all');
  const [schools, setSchools] = useState<{ id: string; name: string }[]>([]);

  // Modal: Asignar / Registrar tarjeta
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [editingCard, setEditingCard] = useState<NFCCard | null>(null); // null = nueva tarjeta
  const [scannedUID, setScannedUID] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [holderType, setHolderType] = useState<'student' | 'teacher'>('student');
  const [holderSearch, setHolderSearch] = useState('');
  const [holderResults, setHolderResults] = useState<(StudentResult | TeacherResult)[]>([]);
  const [selectedHolder, setSelectedHolder] = useState<StudentResult | TeacherResult | null>(null);
  const [scanWaiting, setScanWaiting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalSchoolId, setModalSchoolId] = useState<string>('');

  const nfcInputRef = useRef<HTMLInputElement>(null);
  // Buffer para captura HID global (el lector escribe muy rápido, < 50 ms entre chars)
  const nfcBuffer = useRef('');
  const nfcTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [nfcListening, setNfcListening] = useState(false);

  // ────────────────────────────────────────────
  // Carga inicial
  // ────────────────────────────────────────────
  useEffect(() => {
    fetchCards();
    if (!schoolId) fetchSchools(); // superadmin
  }, [schoolId]);

  const fetchSchools = async () => {
    const { data } = await supabase.from('schools').select('id, name').order('name');
    setSchools(data || []);
  };

  const fetchCards = async () => {
    setLoading(true);
    try {
      let q = supabase
        .from('nfc_cards')
        .select(`
          *,
          student:students(full_name, grade, section),
          teacher:profiles(full_name),
          school:schools(name)
        `)
        .order('created_at', { ascending: false });

      if (schoolId) q = q.eq('school_id', schoolId);

      const { data, error } = await q;
      if (error) throw error;
      setCards((data as NFCCard[]) || []);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setLoading(false);
    }
  };

  // ────────────────────────────────────────────
  // Captura HID global (buffer por velocidad)
  //
  // El lector NFC actúa como teclado HID:
  //   - Envía cada carácter en < 30 ms
  //   - Termina con Enter
  //
  // Distinguimos lector vs escritura humana
  // midiendo el tiempo entre teclas.
  // Se activa automáticamente al abrir el modal.
  // ────────────────────────────────────────────
  const lastKeyTime = useRef<number>(0);

  useEffect(() => {
    if (!showAssignModal) return;

    // Activar escucha automáticamente
    setNfcListening(true);
    nfcBuffer.current = '';

    const handleKey = (e: KeyboardEvent) => {
      // Si ya tenemos un UID escaneado, no necesitamos seguir capturando
      if (!scanWaiting) return;

      const now = Date.now();
      const timeSinceLast = now - lastKeyTime.current;
      lastKeyTime.current = now;

      if (e.key === 'Enter') {
        const uid = nfcBuffer.current.trim();
        nfcBuffer.current = '';
        if (nfcTimer.current) clearTimeout(nfcTimer.current);

        // Solo procesar si el buffer vino rápido (era el lector, no el usuario)
        if (uid.length >= 4 && timeSinceLast < 200) {
          // Si el UID fue al campo de número de tarjeta, limpiarlo también
          setCardNumber('');
          setScannedUID(uid.toUpperCase());
          setScanWaiting(false);
          setNfcListening(false);
          toast({ title: '✅ Tarjeta detectada', description: `UID: ${uid.toUpperCase()}` });

          // Si el foco estaba en un input, limpiar su valor (era el lector, no el usuario)
          const target = e.target as HTMLInputElement;
          if (target.tagName === 'INPUT' && target !== document.querySelector('input[placeholder*="Ej: 001"]')) {
            // Solo limpiar si NO es el campo de número de tarjeta que el usuario pudo haber llenado antes
          }
        }
        return;
      }

      // Acumular solo si los chars llegan rápido (< 80 ms = lector HID)
      if (e.key.length === 1) {
        if (timeSinceLast < 80 || nfcBuffer.current.length === 0) {
          nfcBuffer.current += e.key;
          if (nfcTimer.current) clearTimeout(nfcTimer.current);
          // Si pasan 200 ms sin más chars, resetear (no era el lector)
          nfcTimer.current = setTimeout(() => { nfcBuffer.current = ''; }, 200);
        }
      }
    };

    window.addEventListener('keydown', handleKey, true); // capture = true para interceptar antes que inputs
    return () => {
      window.removeEventListener('keydown', handleKey, true);
      setNfcListening(false);
      if (nfcTimer.current) clearTimeout(nfcTimer.current);
    };
  }, [showAssignModal, scanWaiting]);

  // ────────────────────────────────────────────
  // Búsqueda de titulares (estudiantes / profesores)
  // ────────────────────────────────────────────
  useEffect(() => {
    if (holderSearch.length < 2) { setHolderResults([]); return; }
    const t = setTimeout(() => searchHolders(), 300);
    return () => clearTimeout(t);
  }, [holderSearch, holderType, modalSchoolId]);

  const searchHolders = async () => {
    if (holderType === 'student') {
      let q = supabase
        .from('students')
        .select('id, full_name, grade, section, school_id')
        .eq('is_active', true)
        .ilike('full_name', `%${holderSearch}%`)
        .limit(8);
      if (modalSchoolId) q = q.eq('school_id', modalSchoolId);
      const { data } = await q;
      setHolderResults(data || []);
    } else {
      let q = supabase
        .from('teacher_profiles_with_schools')
        .select('id, full_name, school_1_id, school_2_id')
        .ilike('full_name', `%${holderSearch}%`)
        .limit(8);
      const { data } = await q;
      // Filtrar por sede si aplica
      let results = data || [];
      if (modalSchoolId) {
        results = results.filter(
          (t: any) => t.school_1_id === modalSchoolId || t.school_2_id === modalSchoolId
        );
      }
      setHolderResults(results);
    }
  };

  // ────────────────────────────────────────────
  // Abrir modal nueva tarjeta
  // ────────────────────────────────────────────
  const openNewCard = () => {
    setEditingCard(null);
    setScannedUID('');
    setCardNumber('');
    setHolderType('student');
    setHolderSearch('');
    setHolderResults([]);
    setSelectedHolder(null);
    setScanWaiting(true);
    setModalSchoolId(schoolId || '');
    setShowAssignModal(true);
  };

  // Abrir modal editar / reemplazar tarjeta existente
  const openEditCard = (card: NFCCard) => {
    setEditingCard(card);
    setScannedUID(card.card_uid);
    setCardNumber(card.card_number || '');
    setHolderType((card.holder_type as 'student' | 'teacher') || 'student');
    setHolderSearch(
      card.holder_type === 'student'
        ? (card.student?.full_name || '')
        : (card.teacher?.full_name || '')
    );
    setHolderResults([]);
    setSelectedHolder(null);
    setScanWaiting(false);
    setModalSchoolId(card.school_id);
    setShowAssignModal(true);
  };

  // ────────────────────────────────────────────
  // Guardar (nueva o edición)
  // ────────────────────────────────────────────
  const saveCard = async () => {
    if (!scannedUID.trim()) {
      toast({ variant: 'destructive', title: 'Falta el UID', description: 'Escanea la tarjeta primero' });
      return;
    }
    if (!selectedHolder && !editingCard) {
      toast({ variant: 'destructive', title: 'Falta el titular', description: 'Selecciona un estudiante o profesor' });
      return;
    }
    if (!modalSchoolId) {
      toast({ variant: 'destructive', title: 'Falta la sede', description: 'Selecciona la sede de la tarjeta' });
      return;
    }

    setSaving(true);
    try {
      const isStudent = holderType === 'student';
      const payload: any = {
        card_uid: scannedUID.trim().toUpperCase(),
        card_number: cardNumber.trim() || null,
        holder_type: selectedHolder ? holderType : (editingCard?.holder_type ?? null),
        student_id: (isStudent && selectedHolder) ? (selectedHolder as StudentResult).id : (editingCard?.student_id ?? null),
        teacher_id: (!isStudent && selectedHolder) ? (selectedHolder as TeacherResult).id : (editingCard?.teacher_id ?? null),
        school_id: modalSchoolId,
        is_active: true,
        assigned_at: selectedHolder ? new Date().toISOString() : (editingCard?.assigned_at ?? null),
        assigned_by: user?.id ?? null,
      };

      // Si cambió el tipo de titular, limpiar el anterior
      if (selectedHolder && isStudent)  payload.teacher_id = null;
      if (selectedHolder && !isStudent) payload.student_id = null;

      let error;
      if (editingCard) {
        ({ error } = await supabase.from('nfc_cards').update(payload).eq('id', editingCard.id));
      } else {
        ({ error } = await supabase.from('nfc_cards').insert(payload));
      }

      if (error) throw error;

      toast({
        title: editingCard ? '✅ Tarjeta actualizada' : '✅ Tarjeta registrada',
        description: selectedHolder
          ? `Asignada a ${(selectedHolder as any).full_name}`
          : 'Cambios guardados',
      });
      setShowAssignModal(false);
      fetchCards();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error al guardar', description: err.message });
    } finally {
      setSaving(false);
    }
  };

  // ────────────────────────────────────────────
  // Activar / Desactivar tarjeta
  // ────────────────────────────────────────────
  const toggleActive = async (card: NFCCard) => {
    const { error } = await supabase
      .from('nfc_cards')
      .update({ is_active: !card.is_active })
      .eq('id', card.id);
    if (error) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } else {
      toast({
        title: card.is_active ? '🔴 Tarjeta desactivada' : '🟢 Tarjeta activada',
        description: `Nº ${card.card_number || card.card_uid.slice(0, 8)}`,
      });
      fetchCards();
    }
  };

  // ────────────────────────────────────────────
  // Filtrado local
  // ────────────────────────────────────────────
  const filtered = cards.filter((c) => {
    const name =
      c.holder_type === 'student'
        ? c.student?.full_name || ''
        : c.teacher?.full_name || '';

    const matchSearch =
      !searchQuery ||
      name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.card_number || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.card_uid.toLowerCase().includes(searchQuery.toLowerCase());

    const matchType =
      filterType === 'all' ||
      (filterType === 'unassigned' && !c.holder_type) ||
      c.holder_type === filterType;

    const matchSchool =
      filterSchool === 'all' || c.school_id === filterSchool;

    return matchSearch && matchType && matchSchool;
  });

  // ────────────────────────────────────────────
  // Estadísticas rápidas
  // ────────────────────────────────────────────
  const stats = {
    total: cards.length,
    active: cards.filter((c) => c.is_active).length,
    assigned: cards.filter((c) => c.holder_type).length,
    unassigned: cards.filter((c) => !c.holder_type).length,
  };

  // ────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* ── Encabezado ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-[#8B4513]" />
            Tarjetas NFC
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Vincula tarjetas físicas a estudiantes y profesores para el cobro rápido
          </p>
        </div>
        <Button
          onClick={openNewCard}
          className="bg-[#8B4513] hover:bg-[#6d3510] text-white gap-2"
        >
          <Plus className="h-4 w-4" />
          Registrar Tarjeta
        </Button>
      </div>

      {/* ── Estadísticas ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: stats.total, color: 'bg-slate-100 text-slate-700' },
          { label: 'Activas', value: stats.active, color: 'bg-green-100 text-green-700' },
          { label: 'Asignadas', value: stats.assigned, color: 'bg-blue-100 text-blue-700' },
          { label: 'Sin asignar', value: stats.unassigned, color: 'bg-amber-100 text-amber-700' },
        ].map((s) => (
          <Card key={s.label} className={`${s.color} border-0`}>
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-black">{s.value}</p>
              <p className="text-xs font-medium mt-0.5">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Filtros ── */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Buscar por nombre o número..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {(['all', 'student', 'teacher', 'unassigned'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilterType(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                filterType === f
                  ? 'bg-[#8B4513] text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {f === 'all' ? 'Todas' : f === 'student' ? 'Alumnos' : f === 'teacher' ? 'Profesores' : 'Sin asignar'}
            </button>
          ))}
        </div>
        {/* Filtro de sede (solo superadmin) */}
        {!schoolId && schools.length > 0 && (
          <select
            value={filterSchool}
            onChange={(e) => setFilterSchool(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm text-slate-700"
          >
            <option value="all">Todas las sedes</option>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
        <Button variant="ghost" size="icon" onClick={fetchCards} title="Recargar">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* ── Tabla de tarjetas ── */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-[#8B4513]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <CreditCard className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No hay tarjetas registradas aún</p>
          <p className="text-sm mt-1">Haz clic en "Registrar Tarjeta" para comenzar</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((card) => {
            const holderName =
              card.holder_type === 'student'
                ? card.student?.full_name
                : card.holder_type === 'teacher'
                ? card.teacher?.full_name
                : null;

            const holderSub =
              card.holder_type === 'student' && card.student
                ? `${card.student.grade} - ${card.student.section}`
                : card.holder_type === 'teacher'
                ? 'Profesor'
                : 'Sin asignar';

            return (
              <div
                key={card.id}
                className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${
                  card.is_active
                    ? 'bg-white border-slate-200 hover:border-[#8B4513]/30'
                    : 'bg-slate-50 border-slate-100 opacity-60'
                }`}
              >
                {/* Icono tipo */}
                <div
                  className={`h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                    card.holder_type === 'student'
                      ? 'bg-blue-100 text-blue-600'
                      : card.holder_type === 'teacher'
                      ? 'bg-purple-100 text-purple-600'
                      : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {card.holder_type === 'student' ? (
                    <GraduationCap className="h-5 w-5" />
                  ) : card.holder_type === 'teacher' ? (
                    <User className="h-5 w-5" />
                  ) : (
                    <CreditCard className="h-5 w-5" />
                  )}
                </div>

                {/* Datos */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-slate-800 truncate">
                      {holderName || 'Sin titular'}
                    </span>
                    {card.card_number && (
                      <Badge variant="outline" className="text-xs">
                        #{card.card_number}
                      </Badge>
                    )}
                    {card.is_active ? (
                      <Badge className="bg-green-100 text-green-700 border-0 text-xs">Activa</Badge>
                    ) : (
                      <Badge className="bg-red-100 text-red-700 border-0 text-xs">Inactiva</Badge>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {holderSub}
                    {card.school && !schoolId && (
                      <span className="ml-2 text-slate-400">· {card.school.name}</span>
                    )}
                  </p>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">
                    UID: {card.card_uid}
                  </p>
                </div>

                {/* Acciones */}
                <div className="flex gap-2 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-slate-500 hover:text-[#8B4513]"
                    title="Editar / Reemplazar tarjeta"
                    onClick={() => openEditCard(card)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-8 w-8 ${card.is_active ? 'text-red-500 hover:text-red-700' : 'text-green-500 hover:text-green-700'}`}
                    title={card.is_active ? 'Desactivar tarjeta' : 'Activar tarjeta'}
                    onClick={() => toggleActive(card)}
                  >
                    {card.is_active ? (
                      <XCircle className="h-4 w-4" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ════════════════════════════════════════
          MODAL: Registrar / Editar Tarjeta
      ════════════════════════════════════════ */}
      <Dialog open={showAssignModal} onOpenChange={setShowAssignModal}>
        <DialogContent className="max-w-lg" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <CreditCard className="h-5 w-5 text-[#8B4513]" />
              {editingCard ? 'Editar Tarjeta' : 'Registrar Nueva Tarjeta'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">

            {/* ── PASO 1: Escanear tarjeta ── */}
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">
                1. Escanear tarjeta NFC
              </label>

              {scannedUID ? (
                <div className="flex items-center gap-3 p-3 bg-green-50 border-2 border-green-300 rounded-xl">
                  <CheckCircle2 className="h-6 w-6 text-green-600 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-green-800">Tarjeta detectada</p>
                    <p className="text-xs font-mono text-green-600">UID: {scannedUID}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-slate-500 text-xs"
                    onClick={() => { setScannedUID(''); setScanWaiting(true); }}
                  >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Cambiar
                  </Button>
                </div>
              ) : (
                <div className="w-full p-5 border-2 border-dashed border-blue-400 bg-blue-50 rounded-xl text-center">
                  <Wifi className="h-8 w-8 mx-auto mb-2 text-blue-500 animate-pulse" />
                  <p className="font-bold text-blue-700">
                    👂 Listo — pasa la tarjeta por el lector
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    El sistema captura el UID automáticamente en cuanto escanes
                  </p>
                </div>
              )}
            </div>

            {/* ── PASO 2: Número de tarjeta ── */}
            <div className="space-y-1">
              <label className="text-sm font-bold text-slate-700">
                2. Número de tarjeta <span className="text-slate-400 font-normal">(opcional)</span>
              </label>
              <Input
                placeholder="Ej: 001, 042, ..."
                value={cardNumber}
                onChange={(e) => setCardNumber(e.target.value)}
              />
              <p className="text-xs text-slate-400">El número que tiene impreso la tarjeta físicamente</p>
            </div>

            {/* ── PASO 3: Sede (solo superadmin sin schoolId) ── */}
            {!schoolId && (
              <div className="space-y-1">
                <label className="text-sm font-bold text-slate-700">3. Sede</label>
                <select
                  value={modalSchoolId}
                  onChange={(e) => setModalSchoolId(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm text-slate-700"
                >
                  <option value="">Selecciona una sede...</option>
                  {schools.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* ── PASO 4: Tipo de titular ── */}
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">
                {!schoolId ? '4.' : '3.'} Tipo de titular
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(['student', 'teacher'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => { setHolderType(t); setHolderSearch(''); setHolderResults([]); setSelectedHolder(null); }}
                    className={`p-3 rounded-xl border-2 flex items-center gap-2 transition-all ${
                      holderType === t
                        ? t === 'student'
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-purple-500 bg-purple-50 text-purple-700'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {t === 'student' ? <GraduationCap className="h-4 w-4" /> : <User className="h-4 w-4" />}
                    <span className="font-bold text-sm">{t === 'student' ? 'Estudiante' : 'Profesor'}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ── PASO 5: Buscar titular ── */}
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700">
                {!schoolId ? '5.' : '4.'} {holderType === 'student' ? 'Buscar estudiante' : 'Buscar profesor'}
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  placeholder={`Escribe el nombre del ${holderType === 'student' ? 'estudiante' : 'profesor'}...`}
                  value={holderSearch}
                  onChange={(e) => { setHolderSearch(e.target.value); setSelectedHolder(null); }}
                  className="pl-9"
                />
              </div>

              {/* Seleccionado */}
              {selectedHolder && (
                <div className="flex items-center gap-2 p-2 bg-emerald-50 border border-emerald-300 rounded-lg">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span className="text-sm font-bold text-emerald-800">{(selectedHolder as any).full_name}</span>
                  {holderType === 'student' && (
                    <span className="text-xs text-emerald-600">
                      {(selectedHolder as StudentResult).grade} - {(selectedHolder as StudentResult).section}
                    </span>
                  )}
                  <button
                    className="ml-auto text-xs text-slate-400 hover:text-red-500"
                    onClick={() => { setSelectedHolder(null); setHolderSearch(''); }}
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Resultados */}
              {!selectedHolder && holderResults.length > 0 && (
                <div className="border rounded-xl overflow-hidden shadow-sm max-h-48 overflow-y-auto">
                  {holderResults.map((h: any) => (
                    <button
                      key={h.id}
                      onClick={() => { setSelectedHolder(h); setHolderSearch(h.full_name); setHolderResults([]); }}
                      className="w-full px-4 py-2.5 text-left hover:bg-slate-50 flex items-center gap-3 border-b last:border-b-0"
                    >
                      <div className={`h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0 ${holderType === 'student' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'}`}>
                        {holderType === 'student' ? <GraduationCap className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{h.full_name}</p>
                        {holderType === 'student' && (
                          <p className="text-xs text-slate-400">{h.grade} - {h.section}</p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {!selectedHolder && holderSearch.length >= 2 && holderResults.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-2">No se encontraron resultados</p>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowAssignModal(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button
              onClick={saveCard}
              disabled={saving || !scannedUID}
              className="bg-[#8B4513] hover:bg-[#6d3510] text-white"
            >
              {saving ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Guardando...</>
              ) : (
                <><CheckCircle2 className="h-4 w-4 mr-2" /> Guardar</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default NFCCardsManager;
