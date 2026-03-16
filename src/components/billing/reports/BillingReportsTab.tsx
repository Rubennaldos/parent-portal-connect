import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { useToast } from '@/hooks/use-toast';
import { useDebouncedSync } from '@/stores/billingSync';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Building2,
  Loader2,
  Search,
  CheckCircle2,
  Eye,
  Download,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FileSpreadsheet,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import * as XLSX from 'xlsx';
import limaCafeLogo from '@/assets/lima-cafe-logo.png';

// ─── Types ───────────────────────────────────────────────────────────────────

interface School {
  id: string;
  name: string;
}

interface BillingReportsTabProps {
  schools: School[];
  userSchoolId: string | null;
  canViewAllSchools: boolean;
  /** Usado por el modal de detalles del padre (BillingCollection) */
  onOpenDetails?: (transaction: any) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const normalize = (str: string) =>
  str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const todayStr = () => new Date().toISOString().split('T')[0];

const mondayStr = () => {
  const now = new Date();
  const d = new Date(now);
  d.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
  return d.toISOString().split('T')[0];
};

// ─── Component ───────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 50;

export const BillingReportsTab = ({
  schools,
  userSchoolId,
  canViewAllSchools,
  onOpenDetails,
}: BillingReportsTabProps) => {
  const { user } = useAuth();
  const { role } = useRole();
  const { toast } = useToast();

  // Realtime sync: cuando se aprueba un pago en otra pestaña/PC, recargar
  const txSyncTs = useDebouncedSync('transactions', 600);

  // ── Filtros ────────────────────────────────────────────────────────────────
  const [selectedSchool, setSelectedSchool] = useState<string>(
    canViewAllSchools ? 'all' : userSchoolId || 'all'
  );
  const [dateFrom, setDateFrom] = useState(mondayStr());
  const [dateTo, setDateTo] = useState(todayStr());
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // ── Paginación server-side ─────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  // ── Datos ──────────────────────────────────────────────────────────────────
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Anti-race-condition: solo procesar la respuesta del fetch más reciente
  const fetchRequestId = useRef(0);

  // ── Fetch central ──────────────────────────────────────────────────────────

  const fetchTransactions = async (page: number = currentPage) => {
    const requestId = ++fetchRequestId.current;
    setLoading(true);

    try {
      const schoolIdFilter =
        !canViewAllSchools || selectedSchool !== 'all'
          ? selectedSchool !== 'all'
            ? selectedSchool
            : userSchoolId
          : null;

      const from = (page - 1) * ITEMS_PER_PAGE;
      const to = from + ITEMS_PER_PAGE - 1;
      const normalizedSearch = normalize(searchTerm.trim());

      const applySharedFilters = (q: any) => {
        let query = q;
        if (statusFilter !== 'all') query = query.eq('payment_status', statusFilter);
        if (schoolIdFilter) query = query.eq('school_id', schoolIdFilter);
        if (dateFrom) query = query.gte('created_at', `${dateFrom}T00:00:00`);
        if (dateTo) query = query.lte('created_at', `${dateTo}T23:59:59`);
        return query;
      };

      // ✅ Búsqueda server-side: filtrar por nombre/ticket/descripción en BD
      // Usamos or() con ilike para buscar en student name, teacher name, description, ticket
      if (normalizedSearch) {
        const searchPattern = `%${searchTerm.trim()}%`;

        // 1. Buscar IDs de estudiantes que coinciden
        const { data: matchStudents } = await supabase
          .from('students')
          .select('id')
          .ilike('full_name', searchPattern);

        // 2. Buscar IDs de profesores que coinciden
        const { data: matchTeachers } = await supabase
          .from('teacher_profiles')
          .select('id')
          .ilike('full_name', searchPattern);

        if (requestId !== fetchRequestId.current) return;

        const studentIds = (matchStudents || []).map((s: any) => s.id);
        const teacherIds = (matchTeachers || []).map((t: any) => t.id);

        // 3. Construir filtro OR: por student_id, teacher_id, description, ticket_code
        const orParts: string[] = [];
        if (studentIds.length > 0) orParts.push(`student_id.in.(${studentIds.join(',')})`);
        if (teacherIds.length > 0) orParts.push(`teacher_id.in.(${teacherIds.join(',')})`);
        orParts.push(`description.ilike.${searchPattern}`);
        orParts.push(`ticket_code.ilike.${searchPattern}`);
        orParts.push(`manual_client_name.ilike.${searchPattern}`);

        const orFilter = orParts.join(',');

        // Count
        let countQ = supabase
          .from('transactions')
          .select('id', { count: 'exact', head: true })
          .eq('type', 'purchase')
          .eq('is_deleted', false)
          .neq('payment_status', 'cancelled')
          .or(orFilter);

        countQ = applySharedFilters(countQ);
        const { count } = await countQ;
        if (requestId !== fetchRequestId.current) return;
        setTotalCount(count || 0);

        // Data (paginated)
        let dataQ = supabase
          .from('transactions')
          .select(`
            *,
            students(id, full_name, parent_id),
            teacher_profiles(id, full_name),
            schools(id, name)
          `)
          .eq('type', 'purchase')
          .eq('is_deleted', false)
          .neq('payment_status', 'cancelled')
          .or(orFilter)
          .order('created_at', { ascending: false })
          .range(from, to);

        dataQ = applySharedFilters(dataQ);
        const { data, error } = await dataQ;
        if (error) throw error;
        if (requestId !== fetchRequestId.current) return;

        // Filtrar pedidos cancelados
        const lunchOrderIds = (data || [])
          .map((t: any) => t.metadata?.lunch_order_id)
          .filter(Boolean);

        let cancelledOrderIds = new Set<string>();
        let existingLunchOrderIds = new Set<string>();

        if (lunchOrderIds.length > 0) {
          const uniqueIds = [...new Set<string>(lunchOrderIds)];
          const allExisting: any[] = [];
          const CHUNK = 200;
          for (let i = 0; i < uniqueIds.length; i += CHUNK) {
            const batch = uniqueIds.slice(i, i + CHUNK);
            const { data: bd } = await supabase
              .from('lunch_orders')
              .select('id, is_cancelled')
              .in('id', batch);
            if (bd) allExisting.push(...bd);
          }
          cancelledOrderIds = new Set(
            allExisting.filter((o: any) => o.is_cancelled).map((o: any) => o.id)
          );
          existingLunchOrderIds = new Set(allExisting.map((o: any) => o.id));
        }

        const validTx = (data || []).filter((t: any) => {
          if (t.metadata?.lunch_order_id) {
            if (cancelledOrderIds.has(t.metadata.lunch_order_id)) return false;
            if (!existingLunchOrderIds.has(t.metadata.lunch_order_id)) return false;
          }
          return true;
        });

        // Enriquecer con created_by
        const userIds = [
          ...new Set(
            validTx
              .map((t: any) => t.created_by)
              .filter((v: any) => typeof v === 'string' && isUuid(v))
          ),
        ];
        const createdByMap = new Map<string, any>();

        if (userIds.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, full_name, email, role, school_id, schools:school_id(id, name)')
            .in('id', userIds);

          profiles?.forEach((p: any) => {
            createdByMap.set(p.id, { ...p, school_name: p.schools?.name || null });
          });

          const { data: teacherProfiles } = await supabase
            .from('teacher_profiles')
            .select('id, full_name, school_id_1, schools:school_id_1(id, name)')
            .in('id', userIds);

          teacherProfiles?.forEach((tp: any) => {
            const existing = createdByMap.get(tp.id);
            if (existing) {
              createdByMap.set(tp.id, {
                ...existing,
                teacher_school_name: tp.schools?.name || null,
                teacher_school_id: tp.school_id_1,
              });
            } else {
              createdByMap.set(tp.id, {
                id: tp.id,
                full_name: tp.full_name,
                role: 'teacher',
                school_id: tp.school_id_1,
                school_name: tp.schools?.name || null,
              });
            }
          });
        }

        const enriched = validTx.map((t: any) => ({
          ...t,
          created_by_profile: createdByMap.get(t.created_by) || null,
        }));

        if (requestId !== fetchRequestId.current) return;
        setTransactions(enriched);
        return;
      }

      // 1. Contar total (query liviana, sin datos)
      let countQ = supabase
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .eq('type', 'purchase')
        .eq('is_deleted', false)
        .neq('payment_status', 'cancelled');

      countQ = applySharedFilters(countQ);

      const { count } = await countQ;
      if (requestId !== fetchRequestId.current) return;
      setTotalCount(count || 0);

      // 2. Traer solo la página actual con .range()
      let dataQ = supabase
        .from('transactions')
        .select(`
          *,
          students(id, full_name, parent_id),
          teacher_profiles(id, full_name),
          schools(id, name)
        `)
        .eq('type', 'purchase')
        .eq('is_deleted', false)
        .neq('payment_status', 'cancelled')
        .order('created_at', { ascending: false })
        .range(from, to);

      dataQ = applySharedFilters(dataQ);

      const { data, error } = await dataQ;
      if (error) throw error;
      if (requestId !== fetchRequestId.current) return;

      // 3. Filtrar transacciones de pedidos de almuerzo cancelados
      const lunchOrderIds = (data || [])
        .map((t: any) => t.metadata?.lunch_order_id)
        .filter(Boolean);

      let cancelledOrderIds = new Set<string>();
      let existingLunchOrderIds = new Set<string>();

      if (lunchOrderIds.length > 0) {
        const uniqueIds = [...new Set<string>(lunchOrderIds)];
        const allExisting: any[] = [];
        const CHUNK = 200;
        for (let i = 0; i < uniqueIds.length; i += CHUNK) {
          const batch = uniqueIds.slice(i, i + CHUNK);
          const { data: bd } = await supabase
            .from('lunch_orders')
            .select('id, is_cancelled')
            .in('id', batch);
          if (bd) allExisting.push(...bd);
        }
        cancelledOrderIds = new Set(
          allExisting.filter((o: any) => o.is_cancelled).map((o: any) => o.id)
        );
        existingLunchOrderIds = new Set(allExisting.map((o: any) => o.id));
      }

      const validTx = (data || []).filter((t: any) => {
        if (t.metadata?.lunch_order_id) {
          if (cancelledOrderIds.has(t.metadata.lunch_order_id)) return false;
          if (!existingLunchOrderIds.has(t.metadata.lunch_order_id)) return false;
        }
        return true;
      });

      // 4. Enriquecer con datos del creador
      const userIds = [
        ...new Set(
          validTx
            .map((t: any) => t.created_by)
            .filter((v: any) => typeof v === 'string' && isUuid(v))
        ),
      ];
      const createdByMap = new Map<string, any>();

      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, email, role, school_id, schools:school_id(id, name)')
          .in('id', userIds);

        profiles?.forEach((p: any) => {
          createdByMap.set(p.id, { ...p, school_name: p.schools?.name || null });
        });

        const { data: teacherProfiles } = await supabase
          .from('teacher_profiles')
          .select('id, full_name, school_id_1, schools:school_id_1(id, name)')
          .in('id', userIds);

        teacherProfiles?.forEach((tp: any) => {
          const existing = createdByMap.get(tp.id);
          if (existing) {
            createdByMap.set(tp.id, {
              ...existing,
              teacher_school_name: tp.schools?.name || null,
              teacher_school_id: tp.school_id_1,
            });
          } else {
            createdByMap.set(tp.id, {
              id: tp.id,
              full_name: tp.full_name,
              role: 'teacher',
              school_id: tp.school_id_1,
              school_name: tp.schools?.name || null,
            });
          }
        });
      }

      const enriched = validTx.map((t: any) => ({
        ...t,
        created_by_profile: createdByMap.get(t.created_by) || null,
      }));

      if (requestId !== fetchRequestId.current) return;
      setTransactions(enriched);
    } catch (err) {
      if (requestId !== fetchRequestId.current) return;
      console.error('[BillingReportsTab] Error:', err);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar los reportes',
      });
    } finally {
      if (requestId === fetchRequestId.current) setLoading(false);
    }
  };

  // ── Effects ────────────────────────────────────────────────────────────────

  // Re-fetch cuando cambian filtros (resetea a página 1)
  useEffect(() => {
    setCurrentPage(1);
    fetchTransactions(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSchool, dateFrom, dateTo, statusFilter, searchTerm, userSchoolId, canViewAllSchools]);

  // Re-fetch cuando cambia la página (sin resetear)
  useEffect(() => {
    fetchTransactions(currentPage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage]);

  // Sincronización realtime entre pestañas/dispositivos
  useEffect(() => {
    if (txSyncTs > 0) {
      fetchTransactions(currentPage);
      toast({
        title: '🔄 Datos actualizados',
        description: 'Los reportes se actualizaron automáticamente.',
        duration: 3000,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txSyncTs]);

  // ── Helpers de UI ──────────────────────────────────────────────────────────

  const getUserRoleDescription = (profile: any, schoolName: string) => {
    if (!profile) return null;
    const name = profile.full_name || profile.email || 'Usuario';
    const finalSchoolName = profile.school_name || profile.teacher_school_name || schoolName;
    let roleDescription = '';
    switch (profile.role) {
      case 'admin_general':    roleDescription = 'Administrador General'; break;
      case 'supervisor_red':   roleDescription = 'Supervisor de Red'; break;
      case 'gestor_unidad':    roleDescription = `Gestor de Unidad - ${finalSchoolName}`; break;
      case 'operador_caja':    roleDescription = `Cajero - ${finalSchoolName}`; break;
      case 'kitchen':          roleDescription = `Cocina - ${finalSchoolName}`; break;
      case 'teacher':          roleDescription = `Profesor - ${finalSchoolName}`; break;
      case 'parent':           roleDescription = 'Padre de Familia'; break;
      default:                 roleDescription = `${profile.role || 'Usuario'} - ${finalSchoolName}`;
    }
    return { name, role: roleDescription, fullDescription: `${name} (${roleDescription})` };
  };

  const generatePaymentReceipt = async (transaction: any) => {
    try {
      const doc = new jsPDF();
      let logoBase64 = '';
      try {
        const response = await fetch(limaCafeLogo);
        const blob = await response.blob();
        logoBase64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        console.error('Error cargando logo:', e);
      }

      const pageWidth = doc.internal.pageSize.width;
      const pageHeight = doc.internal.pageSize.height;
      if (logoBase64) doc.addImage(logoBase64, 'PNG', 15, 15, 30, 30);

      doc.setFontSize(20);
      doc.setTextColor(34, 139, 34);
      doc.text('COMPROBANTE DE PAGO', pageWidth / 2, 25, { align: 'center' });
      doc.setFontSize(12);
      doc.setTextColor(100, 100, 100);
      doc.text('Lima Café - Sistema de Cobranzas', pageWidth / 2, 32, { align: 'center' });
      doc.setDrawColor(34, 139, 34);
      doc.setLineWidth(0.5);
      doc.line(15, 50, pageWidth - 15, 50);

      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      let y = 60;

      const row = (label: string, value: string) => {
        doc.setFont('helvetica', 'bold');
        doc.text(label, 15, y);
        doc.setFont('helvetica', 'normal');
        doc.text(value, 70, y);
        y += 7;
      };

      row('FECHA DE PAGO:', format(new Date(transaction.created_at), 'dd/MM/yyyy', { locale: es }));
      row('HORA DE PAGO:', format(new Date(transaction.created_at), 'HH:mm:ss', { locale: es }));

      const clientName =
        transaction.students?.full_name ||
        transaction.teacher_profiles?.full_name ||
        transaction.manual_client_name ||
        'Cliente Genérico Sin Cuenta';
      row('CLIENTE:', clientName);

      const clientType = transaction.student_id
        ? 'Estudiante'
        : transaction.teacher_id
        ? 'Profesor'
        : transaction.manual_client_name
        ? 'Cliente Sin Cuenta'
        : 'Cliente Genérico Sin Cuenta';
      row('CATEGORÍA:', clientType);
      row('SEDE:', transaction.schools?.name || 'Sin sede');

      if (transaction.created_by_profile) {
        const ui = getUserRoleDescription(transaction.created_by_profile, transaction.schools?.name || '');
        if (ui) {
          row('REGISTRADO POR:', ui.name);
          doc.setFont('helvetica', 'bold');
          doc.text('CARGO:', 15, y);
          doc.setFont('helvetica', 'normal');
          const roleLines = doc.splitTextToSize(ui.role, pageWidth - 80);
          doc.text(roleLines, 70, y);
          y += 7 * roleLines.length;
        }
      }

      const methodText = transaction.payment_method
        ? transaction.payment_method === 'teacher_account'
          ? 'CUENTA PROFESOR'
          : transaction.payment_method === 'mixto'
          ? 'PAGO MIXTO/DIVIDIDO'
          : transaction.payment_method
        : transaction.ticket_code
        ? 'PAGO DIRECTO EN CAJA'
        : 'NO REGISTRADO';
      row('MÉTODO DE PAGO:', methodText.toUpperCase());

      if (transaction.metadata?.payment_breakdown && Array.isArray(transaction.metadata.payment_breakdown)) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.text('DESGLOSE DE PAGOS:', 15, y);
        y += 6;
        doc.setFont('helvetica', 'normal');
        transaction.metadata.payment_breakdown.forEach((entry: any, idx: number) => {
          const line = `  Pago ${idx + 1}: ${String(entry.method).toUpperCase()} - S/ ${Number(entry.amount).toFixed(2)}${entry.operation_number ? ` (Nº ${entry.operation_number})` : ''}`;
          doc.text(line, 15, y);
          y += 5;
        });
        doc.setFontSize(10);
        y += 2;
      }

      if (transaction.ticket_code) row('Nº TICKET:', transaction.ticket_code);
      if (transaction.operation_number) row('Nº OPERACIÓN:', transaction.operation_number);
      if (transaction.document_type) row('TIPO DOCUMENTO:', transaction.document_type.toUpperCase());

      y += 3;
      doc.setFillColor(59, 130, 246);
      doc.rect(15, y - 2, pageWidth - 30, 8, 'F');
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text('🍽️ DETALLE DE CONSUMO', 18, y + 4);
      y += 12;

      doc.setFillColor(240, 245, 255);
      doc.setDrawColor(59, 130, 246);
      doc.setLineWidth(0.5);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      const descLines = doc.splitTextToSize(transaction.description || 'Sin descripción', pageWidth - 40);
      const descH = descLines.length * 5 + 8;
      doc.rect(15, y - 2, pageWidth - 30, descH, 'FD');
      doc.text(descLines, 20, y + 3);
      y += descH + 5;

      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.3);
      doc.line(15, y, pageWidth - 15, y);
      y += 10;

      doc.setFillColor(34, 139, 34);
      doc.rect(15, y - 5, pageWidth - 30, 15, 'F');
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255, 255, 255);
      doc.text('MONTO PAGADO:', 20, y + 5);
      doc.setFontSize(18);
      doc.text(`S/ ${Math.abs(transaction.amount).toFixed(2)}`, pageWidth - 20, y + 5, { align: 'right' });

      const footerY = pageHeight - 30;
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.setFont('helvetica', 'italic');
      doc.text('Este es un comprobante interno generado por el sistema Lima Café', pageWidth / 2, footerY, { align: 'center' });
      doc.text(`Generado el: ${format(new Date(), "dd/MM/yyyy 'a las' HH:mm", { locale: es })}`, pageWidth / 2, footerY + 5, { align: 'center' });
      doc.text('Para consultas: contacto@limacafe.pe', pageWidth / 2, footerY + 10, { align: 'center' });

      const fileName = `Comprobante_Pago_${clientName.replace(/\s+/g, '_')}_${format(new Date(transaction.created_at), 'ddMMyyyy_HHmm')}.pdf`;
      doc.save(fileName);

      toast({ title: '✅ Comprobante generado', description: 'Se descargó el comprobante exitosamente' });
    } catch (err) {
      console.error('Error generando comprobante:', err);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo generar el comprobante' });
    }
  };

  // ── Exportar a Excel ───────────────────────────────────────────────────────

  const exportToExcel = async () => {
    // Necesitamos TODOS los registros filtrados, no solo la página actual
    // Hacemos un fetch sin paginación con los mismos filtros activos
    toast({ title: '⏳ Preparando Excel...', description: 'Obteniendo todos los registros filtrados.' });

    try {
      const schoolIdFilter =
        !canViewAllSchools || selectedSchool !== 'all'
          ? selectedSchool !== 'all' ? selectedSchool : userSchoolId
          : null;

      let query = supabase
        .from('transactions')
        .select(`*, students(id, full_name), teacher_profiles(id, full_name), schools(id, name)`)
        .eq('type', 'purchase')
        .eq('is_deleted', false)
        .neq('payment_status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(5000);

      if (statusFilter !== 'all') query = query.eq('payment_status', statusFilter);
      if (schoolIdFilter) query = query.eq('school_id', schoolIdFilter);
      if (dateFrom) query = query.gte('created_at', `${dateFrom}T00:00:00`);
      if (dateTo) query = query.lte('created_at', `${dateTo}T23:59:59`);

      const { data: allData, error } = await query;
      if (error) throw error;

      const rows = (allData || []);

      // ── Datos del encabezado ──
      const ahora = new Date();
      const fechaReporte = format(ahora, "dd/MM/yyyy 'a las' HH:mm", { locale: es });
      const quienExporto = user?.email || 'Desconocido';
      const rangoFechas = `Del ${format(new Date(dateFrom + 'T00:00:00'), "dd/MM/yyyy", { locale: es })} al ${format(new Date(dateTo + 'T00:00:00'), "dd/MM/yyyy", { locale: es })}`;
      const estadoLabel = statusFilter === 'all' ? 'Todos' : statusFilter === 'paid' ? 'Pagados' : statusFilter === 'pending' ? 'Pendientes' : 'Parciales';
      const montoTotal = rows.reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);

      // ── Construir filas de datos ──
      const dataRows = rows.map((t) => {
        const nombreMenor = t.students?.full_name || t.teacher_profiles?.full_name || t.manual_client_name || 'Sin nombre';
        const deuda = Math.abs(t.amount || 0);
        const observaciones = t.description || '';
        const comprobante = t.ticket_code || t.operation_number || '';
        const fechaComp = t.created_at ? format(new Date(t.created_at), 'dd/MM/yyyy', { locale: es }) : '';
        const mes = t.created_at ? format(new Date(t.created_at), 'MMMM yyyy', { locale: es }) : '';

        return {
          'Nombre y Apellidos del Menor': nombreMenor,
          'Deuda (S/)': deuda,
          'Observaciones': observaciones,
          'Comprobante (N° Ticket)': comprobante,
          'Fecha del Comprobante': fechaComp,
          'Mes': mes,
          'Estado': '',          // lo llena la dueña
          'Método de Pago': '',  // lo llena la dueña
          'Forma de Pago': '',   // lo llena la dueña
          'Porque (Motivo)': t.metadata?.rejection_reason || '',
        };
      });

      // ── Crear libro Excel ──
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([]);

      // Fila 1: Título principal
      XLSX.utils.sheet_add_aoa(ws, [['REPORTE DE DEUDAS — PORTAL DE PADRES']], { origin: 'A1' });
      // Fila 2: Rango de fechas
      XLSX.utils.sheet_add_aoa(ws, [[rangoFechas]], { origin: 'A2' });
      // Fila 3: Monto total
      XLSX.utils.sheet_add_aoa(ws, [[`Monto Total: S/ ${montoTotal.toFixed(2)}   |   Estado filtrado: ${estadoLabel}   |   Total registros: ${rows.length}`]], { origin: 'A3' });
      // Fila 4: Generado por
      XLSX.utils.sheet_add_aoa(ws, [[`Generado el: ${fechaReporte}   |   Por: ${quienExporto}`]], { origin: 'A4' });
      // Fila 5: en blanco
      XLSX.utils.sheet_add_aoa(ws, [['']], { origin: 'A5' });
      // Fila 6: Encabezados de columnas
      const headers = Object.keys(dataRows[0] || {});
      XLSX.utils.sheet_add_aoa(ws, [headers], { origin: 'A6' });
      // Fila 7 en adelante: datos
      XLSX.utils.sheet_add_json(ws, dataRows, { origin: 'A7', skipHeader: true });

      // ── Estilos de ancho de columnas ──
      ws['!cols'] = [
        { wch: 35 }, // Nombre
        { wch: 12 }, // Deuda
        { wch: 45 }, // Observaciones
        { wch: 20 }, // Comprobante
        { wch: 20 }, // Fecha comp
        { wch: 14 }, // Mes
        { wch: 14 }, // Estado (vacío)
        { wch: 16 }, // Método de pago (vacío)
        { wch: 16 }, // Forma de pago (vacío)
        { wch: 30 }, // Porque
      ];

      // Fusionar celdas del título (A1 a J1)
      const lastCol = String.fromCharCode(64 + headers.length);
      ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } },
        { s: { r: 2, c: 0 }, e: { r: 2, c: headers.length - 1 } },
        { s: { r: 3, c: 0 }, e: { r: 3, c: headers.length - 1 } },
      ];

      XLSX.utils.book_append_sheet(wb, ws, 'Reporte Deudas');

      // ── Nombre del archivo ──
      const nombreArchivo = `Reporte_Deudas_${dateFrom}_al_${dateTo}.xlsx`;
      XLSX.writeFile(wb, nombreArchivo);

      toast({ title: '✅ Excel generado', description: `${rows.length} registros exportados correctamente.` });
    } catch (err) {
      console.error('Error exportando Excel:', err);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo generar el Excel. Intenta de nuevo.' });
    }
  };

  // ── Filtro local de búsqueda (solo sobre la página actual) ─────────────────

  const filtered = transactions.filter((t) => {
    if (!searchTerm) return true;
    const s = normalize(searchTerm);
    return (
      normalize(t.students?.full_name || t.teacher_profiles?.full_name || t.manual_client_name || '').includes(s) ||
      normalize(t.schools?.name || '').includes(s) ||
      normalize(t.created_by_profile?.full_name || '').includes(s) ||
      normalize(t.created_by_profile?.email || '').includes(s) ||
      normalize(t.description || '').includes(s) ||
      normalize(t.ticket_code || '').includes(s) ||
      normalize(t.operation_number || '').includes(s)
    );
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="mt-0">
      {/* ── Filtros ── */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* Sede — solo admin_general */}
            {canViewAllSchools && (
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Sede</Label>
                <select
                  value={selectedSchool}
                  onChange={(e) => { setSelectedSchool(e.target.value); setCurrentPage(1); }}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="all">Todas las sedes</option>
                  {schools.map((school) => (
                    <option key={school.id} value={school.id}>{school.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Desde */}
            <div className="space-y-1">
              <Label className="text-xs text-gray-500">Desde</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setCurrentPage(1); }}
              />
            </div>

            {/* Hasta */}
            <div className="space-y-1">
              <Label className="text-xs text-gray-500">Hasta</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setCurrentPage(1); }}
              />
            </div>

            {/* Estado */}
            <div className="space-y-1">
              <Label className="text-xs text-gray-500">Estado</Label>
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="all">Todos</option>
                <option value="paid">Pagados</option>
                <option value="pending">Pendientes</option>
                <option value="partial">Parciales</option>
              </select>
            </div>

            {/* Buscar */}
            <div className="space-y-1">
              <Label className="text-xs text-gray-500">Buscar</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Nombre, ticket, sede..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Accesos rápidos */}
            <div className="space-y-1">
              <Label className="text-xs text-gray-500">Rápido</Label>
              <div className="flex gap-1">
                <Button
                  variant="outline" size="sm" className="flex-1 text-xs"
                  onClick={() => { const t = todayStr(); setDateFrom(t); setDateTo(t); setCurrentPage(1); }}
                >
                  Hoy
                </Button>
                <Button
                  variant="outline" size="sm" className="flex-1 text-xs"
                  onClick={() => { setDateFrom(mondayStr()); setDateTo(todayStr()); setCurrentPage(1); }}
                >
                  Semana
                </Button>
                <Button
                  variant="outline" size="sm" className="flex-1 text-xs"
                  onClick={() => {
                    const now = new Date();
                    const first = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
                    setDateFrom(first); setDateTo(todayStr()); setCurrentPage(1);
                  }}
                >
                  Mes
                </Button>
              </div>
            </div>
          </div>

          {/* Resumen rápido */}
          <div className="flex items-center justify-between gap-3 mt-3">
            <div className="flex items-center gap-3 text-sm text-gray-600">
              <span className="font-medium">{totalCount} registros encontrados</span>
              {searchTerm && (
                <span>• {totalCount} coinciden con "{searchTerm}"</span>
              )}
            </div>
            <Button
              onClick={exportToExcel}
              className="bg-green-600 hover:bg-green-700 text-white gap-2 text-sm font-semibold"
              size="sm"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Exportar Excel
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Lista ── */}
      {loading ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Loader2 className="h-8 w-8 mx-auto mb-4 animate-spin text-blue-600" />
            <p className="text-gray-500">Cargando reportes...</p>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="h-16 w-16 mx-auto mb-4 text-gray-400" />
            <h3 className="text-lg font-semibold text-gray-700 mb-2">
              {searchTerm ? 'No se encontraron resultados' : 'No hay registros'}
            </h3>
            <p className="text-gray-500">
              {searchTerm ? 'Intenta con otro término de búsqueda' : 'Los pagos registrados aparecerán aquí'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filtered.map((transaction) => {
            const clientName =
              transaction.students?.full_name ||
              transaction.teacher_profiles?.full_name ||
              transaction.manual_client_name ||
              null;
            const isGenericSale = !clientName && !transaction.student_id && !transaction.teacher_id;
            const displayName = isGenericSale ? '🛒 Cliente Genérico Sin Cuenta' : clientName;
            const clientType = transaction.student_id
              ? 'student'
              : transaction.teacher_id
              ? 'teacher'
              : isGenericSale
              ? 'generic'
              : 'manual';
            const schoolName = transaction.schools?.name || 'Sin sede';

            return (
              <Card
                key={transaction.id}
                className={`hover:shadow-lg transition-shadow border-l-4 ${
                  transaction.payment_status === 'paid'    ? 'border-l-green-500' :
                  transaction.payment_status === 'pending' ? 'border-l-red-500' :
                  transaction.payment_status === 'partial' ? 'border-l-yellow-500' :
                  'border-l-gray-300'
                }`}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      {/* Nombre + badges */}
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-bold text-xl text-gray-900">{displayName}</h3>
                        {clientType === 'teacher' && (
                          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">👨‍🏫 Profesor</Badge>
                        )}
                        {clientType === 'generic' && (
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">🛒 Sin Cliente</Badge>
                        )}
                        {clientType === 'manual' && (
                          <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">📝 Sin Cuenta</Badge>
                        )}
                        {transaction.payment_status === 'paid' && (
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">✅ Pagado</Badge>
                        )}
                        {transaction.payment_status === 'pending' && (
                          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">⏳ Pendiente</Badge>
                        )}
                        {transaction.payment_status === 'partial' && (
                          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">🔸 Parcial</Badge>
                        )}
                      </div>

                      {/* Sede */}
                      <div className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700 mt-1 bg-blue-50 px-2 py-1 rounded-md mb-3">
                        <Building2 className="h-4 w-4" />
                        {schoolName}
                      </div>

                      <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                        {/* Detalle de consumo */}
                        <div className="bg-white border-l-4 border-l-blue-500 rounded-md p-3 mb-3">
                          <p className="text-gray-500 text-sm font-semibold mb-1">🍽️ Detalle de Consumo:</p>
                          <p className="font-bold text-gray-900 text-base">
                            {transaction.description || 'Sin descripción'}
                          </p>
                        </div>

                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <p className="text-gray-500">📅 Fecha de pago:</p>
                            <p className="font-semibold text-gray-900">
                              {format(new Date(transaction.created_at), 'dd/MM/yyyy', { locale: es })}
                            </p>
                          </div>
                          <div>
                            <p className="text-gray-500">🕐 Hora de pago:</p>
                            <p className="font-semibold text-gray-900">
                              {format(new Date(transaction.created_at), 'HH:mm', { locale: es })}
                            </p>
                          </div>
                          <div>
                            <p className="text-gray-500">💳 Método de pago:</p>
                            <p className="font-semibold text-gray-900 capitalize">
                              {transaction.payment_method
                                ? transaction.payment_method === 'teacher_account'
                                  ? 'Cuenta Profesor'
                                  : transaction.payment_method === 'mixto'
                                  ? '🔀 Pago Mixto'
                                  : transaction.payment_method
                                : transaction.ticket_code
                                ? 'Pago directo en caja'
                                : 'Método no registrado'}
                            </p>
                            {!transaction.payment_method && (
                              <p className="text-xs text-amber-600 mt-0.5">
                                ⚠️ Transacción anterior al sistema de cobros
                              </p>
                            )}
                            {/* Desglose pago mixto */}
                            {transaction.metadata?.payment_breakdown && Array.isArray(transaction.metadata.payment_breakdown) && (
                              <div className="mt-2 space-y-1 bg-indigo-50 rounded p-2 border border-indigo-200">
                                <p className="text-xs font-semibold text-indigo-700">📋 Desglose:</p>
                                {transaction.metadata.payment_breakdown.map((entry: any, i: number) => (
                                  <div key={i} className="flex items-center justify-between text-sm">
                                    <span className="capitalize text-gray-700">
                                      {entry.method}
                                      {entry.operation_number && (
                                        <span className="text-gray-500 ml-1">(#{entry.operation_number})</span>
                                      )}
                                    </span>
                                    <span className="font-bold text-gray-900">S/ {Number(entry.amount).toFixed(2)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          {transaction.operation_number && (
                            <div>
                              <p className="text-gray-500">🔢 N° de operación:</p>
                              <p className="font-semibold text-gray-900">{transaction.operation_number}</p>
                            </div>
                          )}
                          {transaction.ticket_code && (
                            <div>
                              <p className="text-gray-500">🎫 N° de ticket:</p>
                              <p className="font-bold text-indigo-700">{transaction.ticket_code}</p>
                            </div>
                          )}
                        </div>

                        {/* Registrado por */}
                        {transaction.created_by_profile && (() => {
                          const userInfo = getUserRoleDescription(transaction.created_by_profile, schoolName);
                          return userInfo ? (
                            <div className="border-t pt-2 mt-2">
                              <p className="text-gray-500 text-sm">👤 Registrado por:</p>
                              <p className="font-semibold text-gray-900">{userInfo.name}</p>
                              <p className="text-xs text-gray-600 mt-1">{userInfo.role}</p>
                            </div>
                          ) : null;
                        })()}

                        {transaction.document_type && (
                          <div className="border-t pt-2 mt-2">
                            <p className="text-gray-500 text-sm">📄 Tipo de documento:</p>
                            <p className="font-semibold text-gray-900 capitalize">{transaction.document_type}</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Acciones + monto */}
                    <div className="text-right ml-4 flex flex-col items-end">
                      <p className="text-3xl font-bold text-green-600 mb-2">
                        S/ {Math.abs(transaction.amount).toFixed(2)}
                      </p>
                      <div className="flex flex-col gap-2 w-full mt-3">
                        {onOpenDetails && (
                          <Button
                            onClick={() => onOpenDetails(transaction)}
                            variant="outline"
                            size="sm"
                            className="w-full border-blue-600 text-blue-600 hover:bg-blue-50"
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            Ver Detalles
                          </Button>
                        )}
                        <Button
                          onClick={() => generatePaymentReceipt(transaction)}
                          variant="outline"
                          size="sm"
                          className="w-full border-green-600 text-green-600 hover:bg-green-50"
                        >
                          <Download className="h-4 w-4 mr-2" />
                          Comprobante
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Paginación server-side ── */}
      {totalCount > ITEMS_PER_PAGE && (
        <div className="flex items-center justify-between px-1 pt-4 text-sm text-gray-500">
          <span>
            Mostrando {(currentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, totalCount)} de {totalCount} registros
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost" size="icon" className="h-8 w-8"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage(1)}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline" size="sm"
              disabled={currentPage <= 1}
              onClick={() => { setCurrentPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Anterior
            </Button>
            <span className="px-3 font-medium text-gray-700">
              {currentPage} / {totalPages}
            </span>
            <Button
              variant="outline" size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => { setCurrentPage(p => p + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            >
              Siguiente
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
            <Button
              variant="ghost" size="icon" className="h-8 w-8"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage(totalPages)}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
