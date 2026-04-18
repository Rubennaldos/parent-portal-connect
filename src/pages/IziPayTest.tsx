/**
 * IziPayTest — Sandbox de Pruebas para Administradores
 * ─────────────────────────────────────────────────────
 * URL: /admin/test-izipay
 * Acceso: admin_general, superadmin (definido en App.tsx)
 *
 * PROPÓSITO:
 *  Permite a Beto (administrador) probar el flujo completo de pago IziPay
 *  sin necesidad de tener una cuenta de padre.
 *
 * QUÉ HACE:
 *  1. Busca alumnos de la sede del admin
 *  2. Permite seleccionar uno y definir un monto de prueba
 *  3. Abre el RechargeModal con izipayTestMode=true (bypass de mantenimiento)
 *  4. El admin experimenta exactamente el mismo flujo que verá el padre
 *
 * SEGURIDAD:
 *  - La ruta está protegida por ProtectedRoute (solo admin_general, superadmin)
 *  - No existe ningún enlace a esta ruta desde el portal de padres
 *  - Si un padre intenta ir manualmente a /admin/test-izipay, es redirigido a /
 *  - El modal usa el studentId real, por lo que si el pago se completa,
 *    el saldo del alumno SÍ se acredita (es una prueba real, no simulada)
 *    → usar montos pequeños como S/ 1.00 para probar
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { RechargeModal } from '@/components/parent/RechargeModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft,
  Search,
  Zap,
  AlertTriangle,
  User,
  FlaskConical,
  CheckCircle2,
  Info,
  ChevronRight,
} from 'lucide-react';

interface Student {
  id: string;
  full_name: string;
  grade?: string;
  section?: string;
  balance: number;
  school_id: string;
  school_name?: string;
}

const TEST_AMOUNTS = [1, 5, 10, 20];

export default function IziPayTest() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const [students, setStudents] = useState<Student[]>([]);
  const [filtered, setFiltered] = useState<Student[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [testAmount, setTestAmount] = useState('1');
  const [showModal, setShowModal] = useState(false);
  const [testCount, setTestCount] = useState(0);

  // ── Cargar alumnos de la sede del admin ──────────────────────────────────
  useEffect(() => {
    if (!user) return;
    fetchStudents();
  }, [user]);

  const fetchStudents = async () => {
    setLoading(true);
    try {
      // Obtener school_id del perfil del admin
      const { data: profile } = await supabase
        .from('profiles')
        .select('school_id')
        .eq('id', user!.id)
        .single();

      const schoolFilter = profile?.school_id
        ? supabase.from('students').select('id, full_name, grade, section, balance, school_id').eq('school_id', profile.school_id)
        : supabase.from('students').select('id, full_name, grade, section, balance, school_id');

      const { data, error } = await schoolFilter
        .eq('is_active', true)
        .order('full_name')
        .limit(200);

      if (error) throw error;

      const list = (data ?? []) as Student[];
      setStudents(list);
      setFiltered(list);
    } catch (err: any) {
      toast({ title: 'Error al cargar alumnos', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // ── Búsqueda en tiempo real ────────────────────────────────────────────
  useEffect(() => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) {
      setFiltered(students);
      return;
    }
    setFiltered(students.filter(s => s.full_name.toLowerCase().includes(term)));
  }, [searchTerm, students]);

  const handleStartTest = () => {
    if (!selectedStudent) {
      toast({ title: 'Selecciona un alumno primero', variant: 'destructive' });
      return;
    }
    const amt = parseFloat(testAmount);
    if (!amt || amt <= 0) {
      toast({ title: 'Ingresa un monto válido', variant: 'destructive' });
      return;
    }
    setShowModal(true);
  };

  const handleTestComplete = () => {
    setShowModal(false);
    setTestCount(c => c + 1);
    fetchStudents(); // Refrescar saldos
    toast({
      title: '✅ Prueba completada',
      description: `El flujo IziPay funcionó correctamente para ${selectedStudent?.full_name}.`,
    });
  };

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <button
            onClick={() => navigate('/dashboard')}
            className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
          >
            <ArrowLeft className="h-4 w-4 text-slate-600" />
          </button>

          <div className="flex items-center gap-2 flex-1">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-sm">
              <FlaskConical className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-800 leading-tight">
                Sandbox IziPay
              </h1>
              <p className="text-[10px] text-slate-400">Solo visible para administradores</p>
            </div>
          </div>

          <Badge className="bg-amber-100 text-amber-700 border border-amber-300 text-[10px] font-bold gap-1">
            <FlaskConical className="h-3 w-3" />
            MODO TEST
          </Badge>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

        {/* ── Banner informativo ─────────────────────────────────────────── */}
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Info className="h-5 w-5 text-blue-500 shrink-0" />
            <p className="text-sm font-bold text-blue-800">¿Qué es esta pantalla?</p>
          </div>
          <p className="text-xs text-blue-700 leading-relaxed">
            Esta ruta <strong>(/admin/test-izipay)</strong> es exclusiva para administradores.
            Permite probar el flujo completo de pago en línea con IziPay{' '}
            <strong>sin afectar el portal de padres</strong>.
          </p>
          <ul className="text-xs text-blue-600 space-y-1 mt-1">
            <li className="flex items-start gap-1.5">
              <span className="text-blue-400 shrink-0">•</span>
              Los padres ven el modal de mantenimiento normal (sin opción IziPay)
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-blue-400 shrink-0">•</span>
              Usa <strong>S/ 1.00</strong> para que el saldo del alumno no se vea afectado significativamente
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-blue-400 shrink-0">•</span>
              Si completas un pago real, el saldo del alumno SÍ sube (es una prueba funcional)
            </li>
          </ul>
        </div>

        {/* ── Advertencia de prueba real ─────────────────────────────────── */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-800 leading-relaxed">
            <strong>Esta es una prueba REAL</strong>, no un simulador. Si completas el formulario
            de IziPay con una tarjeta válida, se realizará un cargo real y el saldo del alumno
            se acreditará. Usa el ambiente de pruebas de IziPay (sandbox) si está configurado.
          </p>
        </div>

        {/* ── Panel principal ─────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

          {/* Sección 1: Seleccionar alumno */}
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-black">1</span>
              Seleccionar alumno
            </h2>

            {/* Buscador */}
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Buscar por nombre..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-10 text-sm"
              />
            </div>

            {/* Lista de alumnos */}
            <div className="max-h-52 overflow-y-auto space-y-1 rounded-xl border border-slate-100">
              {loading ? (
                <div className="py-8 flex items-center justify-center">
                  <div className="h-6 w-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : filtered.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">No se encontraron alumnos</p>
              ) : (
                filtered.slice(0, 30).map(student => (
                  <button
                    key={student.id}
                    onClick={() => setSelectedStudent(student)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                      selectedStudent?.id === student.id
                        ? 'bg-blue-50 border-l-4 border-l-blue-500'
                        : 'hover:bg-slate-50 border-l-4 border-l-transparent'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rose-400 to-orange-400 flex items-center justify-center shrink-0">
                      <span className="text-white text-[10px] font-bold">
                        {student.full_name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{student.full_name}</p>
                      <p className="text-[10px] text-slate-400">
                        {student.grade ? `${student.grade}${student.section ? ' · ' + student.section : ''}` : 'Sin grado'}
                        {' · '}
                        Saldo: <span className="font-semibold text-emerald-600">S/ {(student.balance ?? 0).toFixed(2)}</span>
                      </p>
                    </div>
                    {selectedStudent?.id === student.id && (
                      <CheckCircle2 className="h-4 w-4 text-blue-500 shrink-0" />
                    )}
                  </button>
                ))
              )}
              {filtered.length > 30 && (
                <p className="py-2 text-center text-xs text-slate-400">
                  Mostrando los primeros 30 — usa el buscador para filtrar
                </p>
              )}
            </div>
          </div>

          {/* Sección 2: Monto de prueba */}
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-black">2</span>
              Monto de prueba
            </h2>

            <div className="flex gap-2 flex-wrap mb-3">
              {TEST_AMOUNTS.map(amt => (
                <button
                  key={amt}
                  onClick={() => setTestAmount(String(amt))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition-all ${
                    testAmount === String(amt)
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  S/ {amt}
                </button>
              ))}
            </div>

            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">S/</span>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={testAmount}
                onChange={(e) => setTestAmount(e.target.value)}
                className="pl-9 h-10 font-mono text-base font-bold"
                placeholder="0.00"
              />
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              💡 Recomendamos S/ 1.00 para pruebas — mínimo real de IziPay
            </p>
          </div>

          {/* Sección 3: Resumen + botón ejecutar */}
          <div className="px-5 py-4">
            <h2 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-black">3</span>
              Confirmar y ejecutar
            </h2>

            {selectedStudent ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-4 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Alumno:</span>
                  <span className="font-semibold text-slate-800 truncate max-w-[180px]">{selectedStudent.full_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Saldo actual:</span>
                  <span className="font-bold text-emerald-600">S/ {(selectedStudent.balance ?? 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Monto prueba:</span>
                  <span className="font-bold text-blue-600">S/ {parseFloat(testAmount || '0').toFixed(2)}</span>
                </div>
                <div className="flex justify-between pt-1 border-t border-slate-200">
                  <span className="text-slate-500">Saldo tras prueba:</span>
                  <span className="font-bold text-slate-800">
                    S/ {((selectedStudent.balance ?? 0) + parseFloat(testAmount || '0')).toFixed(2)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="bg-slate-50 border border-dashed border-slate-300 rounded-xl p-4 mb-4 text-center">
                <User className="h-8 w-8 text-slate-300 mx-auto mb-1" />
                <p className="text-xs text-slate-400">Selecciona un alumno arriba para continuar</p>
              </div>
            )}

            <Button
              onClick={handleStartTest}
              disabled={!selectedStudent || !testAmount || parseFloat(testAmount) <= 0}
              className="w-full h-12 bg-gradient-to-br from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800 font-bold text-base gap-2 shadow-lg shadow-blue-200 disabled:opacity-50"
            >
              <Zap className="h-5 w-5" />
              Iniciar prueba IziPay
              <ChevronRight className="h-4 w-4 ml-auto" />
            </Button>

            {testCount > 0 && (
              <p className="text-xs text-emerald-600 text-center mt-2 font-semibold">
                ✅ {testCount} prueba{testCount !== 1 ? 's' : ''} completada{testCount !== 1 ? 's' : ''} en esta sesión
              </p>
            )}
          </div>
        </div>

        {/* ── Nota final ─────────────────────────────────────────────────── */}
        <p className="text-[11px] text-slate-400 text-center pb-4">
          Esta página no aparece en ningún menú del portal de padres.
          Solo accesible vía URL directa para admins.
        </p>
      </div>

      {/* ── Modal de Recarga con IziPay habilitado (modo test) ──────────── */}
      {selectedStudent && showModal && (
        <RechargeModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          onCancel={() => setShowModal(false)}
          onSuccess={handleTestComplete}
          studentName={selectedStudent.full_name}
          studentId={selectedStudent.id}
          currentBalance={selectedStudent.balance ?? 0}
          accountType="recharge"
          onRecharge={async () => {}}
          requestType="recharge"
          suggestedAmount={parseFloat(testAmount || '0')}
          izipayTestMode={true}
        />
      )}
    </div>
  );
}
