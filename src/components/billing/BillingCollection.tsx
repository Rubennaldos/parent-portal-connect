import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { 
  DollarSign,
  Users,
  Send,
  Download,
  Copy,
  CheckCircle2,
  Search,
  Filter,
  Calendar,
  Building2,
  Loader2,
  FileText,
  MessageSquare
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { generateBillingPDF } from '@/utils/pdfGenerator';

interface School {
  id: string;
  name: string;
  code: string;
}

interface BillingPeriod {
  id: string;
  period_name: string;
  start_date: string;
  end_date: string;
  school_id: string;
}

interface DebtorStudent {
  student_id: string;
  student_name: string;
  parent_id: string;
  parent_name: string;
  parent_phone: string;
  parent_email: string;
  school_id: string;
  school_name: string;
  total_amount: number;
  transaction_count: number;
  transactions: any[];
}

export const BillingCollection = () => {
  const { user } = useAuth();
  const { role } = useRole();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [schools, setSchools] = useState<School[]>([]);
  const [periods, setPeriods] = useState<BillingPeriod[]>([]);
  const [debtors, setDebtors] = useState<DebtorStudent[]>([]);
  const [userSchoolId, setUserSchoolId] = useState<string | null>(null);
  
  // Filtros
  const [selectedSchool, setSelectedSchool] = useState<string>('all');
  const [selectedPeriod, setSelectedPeriod] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Selección múltiple
  const [selectedDebtors, setSelectedDebtors] = useState<Set<string>>(new Set());
  
  // Modal de pago
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [currentDebtor, setCurrentDebtor] = useState<DebtorStudent | null>(null);
  const [paymentData, setPaymentData] = useState({
    paid_amount: 0,
    payment_method: 'efectivo',
    operation_number: '',
    document_type: 'ticket' as 'ticket' | 'boleta' | 'factura',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  // Modal de envío masivo
  const [showMassiveModal, setShowMassiveModal] = useState(false);
  const [generatingExport, setGeneratingExport] = useState(false);

  const canViewAllSchools = role === 'admin_general';

  useEffect(() => {
    fetchSchools();
    fetchUserSchool();
  }, []);

  useEffect(() => {
    if (selectedPeriod) {
      fetchDebtors();
    }
  }, [selectedSchool, selectedPeriod]);

  const fetchSchools = async () => {
    try {
      const { data, error } = await supabase
        .from('schools')
        .select('*')
        .order('name');
      
      if (error) throw error;
      setSchools(data || []);
    } catch (error) {
      console.error('Error fetching schools:', error);
    }
  };

  const fetchUserSchool = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('school_id')
        .eq('id', user.id)
        .single();
      
      if (error) throw error;
      setUserSchoolId(data?.school_id || null);
      
      if (!canViewAllSchools && data?.school_id) {
        setSelectedSchool(data.school_id);
        fetchPeriods(data.school_id);
      }
    } catch (error) {
      console.error('Error fetching user school:', error);
    }
  };

  const fetchPeriods = async (schoolId?: string) => {
    try {
      const targetSchoolId = schoolId || (canViewAllSchools && selectedSchool !== 'all' ? selectedSchool : userSchoolId);
      
      if (!targetSchoolId && !canViewAllSchools) return;

      let query = supabase
        .from('billing_periods')
        .select('*')
        .eq('status', 'open')
        .order('start_date', { ascending: false });

      if (targetSchoolId) {
        query = query.eq('school_id', targetSchoolId);
      }

      const { data, error } = await query;

      if (error) throw error;
      setPeriods(data || []);
      
      if (data && data.length > 0 && !selectedPeriod) {
        setSelectedPeriod(data[0].id);
      }
    } catch (error) {
      console.error('Error fetching periods:', error);
    }
  };

  useEffect(() => {
    if (selectedSchool) {
      fetchPeriods();
    }
  }, [selectedSchool]);

  const fetchDebtors = async () => {
    try {
      setLoading(true);

      const period = periods.find(p => p.id === selectedPeriod);
      if (!period) return;

      // Obtener transacciones del período que NO están facturadas
      let query = supabase
        .from('transactions')
        .select(`
          *,
          students(
            id,
            full_name,
            parent_id,
            parent_profiles(
              user_id,
              full_name,
              phone_1,
              profiles(email)
            )
          ),
          schools(id, name)
        `)
        .eq('type', 'purchase')
        .eq('is_billed', false)
        .gte('created_at', period.start_date)
        .lte('created_at', period.end_date)
        .order('created_at', { ascending: false });

      if (!canViewAllSchools || selectedSchool !== 'all') {
        const schoolId = selectedSchool !== 'all' ? selectedSchool : userSchoolId;
        if (schoolId) {
          query = query.eq('school_id', schoolId);
        }
      }

      const { data: transactions, error } = await query;

      if (error) throw error;

      // Agrupar por estudiante
      const debtorsMap: { [key: string]: DebtorStudent } = {};

      transactions?.forEach((transaction: any) => {
        const studentId = transaction.student_id;
        if (!studentId || !transaction.students) return;

        const student = transaction.students;
        const parentProfile = student.parent_profiles;
        
        if (!debtorsMap[studentId]) {
          debtorsMap[studentId] = {
            student_id: studentId,
            student_name: student.full_name,
            parent_id: parentProfile?.user_id || '',
            parent_name: parentProfile?.full_name || 'Sin padre asignado',
            parent_phone: parentProfile?.phone_1 || '',
            parent_email: parentProfile?.profiles?.email || '',
            school_id: transaction.school_id,
            school_name: transaction.schools?.name || '',
            total_amount: 0,
            transaction_count: 0,
            transactions: [],
          };
        }

        debtorsMap[studentId].total_amount += transaction.amount;
        debtorsMap[studentId].transaction_count += 1;
        debtorsMap[studentId].transactions.push(transaction);
      });

      setDebtors(Object.values(debtorsMap));
    } catch (error) {
      console.error('Error fetching debtors:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudieron cargar los deudores',
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredDebtors = debtors.filter(debtor => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      debtor.student_name.toLowerCase().includes(search) ||
      debtor.parent_name.toLowerCase().includes(search) ||
      debtor.parent_email.toLowerCase().includes(search)
    );
  });

  const toggleSelection = (studentId: string) => {
    const newSelected = new Set(selectedDebtors);
    if (newSelected.has(studentId)) {
      newSelected.delete(studentId);
    } else {
      newSelected.add(studentId);
    }
    setSelectedDebtors(newSelected);
  };

  const selectAll = () => {
    if (selectedDebtors.size === filteredDebtors.length) {
      setSelectedDebtors(new Set());
    } else {
      setSelectedDebtors(new Set(filteredDebtors.map(d => d.student_id)));
    }
  };

  const handleOpenPayment = (debtor: DebtorStudent) => {
    setCurrentDebtor(debtor);
    setPaymentData({
      paid_amount: debtor.total_amount, // Por defecto pago completo
      payment_method: 'efectivo',
      operation_number: '',
      document_type: 'ticket',
      notes: '',
    });
    setShowPaymentModal(true);
  };

  const handleRegisterPayment = async () => {
    if (!currentDebtor || !user) return;

    if (paymentData.paid_amount <= 0 || paymentData.paid_amount > currentDebtor.total_amount) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'El monto debe ser mayor a 0 y menor o igual al total',
      });
      return;
    }

    setSaving(true);
    try {
      // 1. Crear el registro de pago
      const { data: payment, error: paymentError } = await supabase
        .from('billing_payments')
        .insert({
          parent_id: currentDebtor.parent_id,
          student_id: currentDebtor.student_id,
          school_id: currentDebtor.school_id,
          billing_period_id: selectedPeriod,
          total_amount: currentDebtor.total_amount,
          paid_amount: paymentData.paid_amount,
          payment_method: paymentData.payment_method,
          operation_number: paymentData.operation_number || null,
          paid_at: new Date().toISOString(),
          document_type: paymentData.document_type,
          notes: paymentData.notes || null,
          transaction_ids: currentDebtor.transactions.map(t => t.id),
          created_by: user.id,
        })
        .select()
        .single();

      if (paymentError) throw paymentError;

      // 2. Marcar transacciones como facturadas
      const { error: updateError } = await supabase
        .from('transactions')
        .update({
          is_billed: true,
          billing_payment_id: payment.id,
        })
        .in('id', currentDebtor.transactions.map(t => t.id));

      if (updateError) throw updateError;

      toast({
        title: '✅ Pago registrado',
        description: `Se registró el pago de S/ ${paymentData.paid_amount.toFixed(2)}`,
      });

      setShowPaymentModal(false);
      fetchDebtors();
    } catch (error: any) {
      console.error('Error registering payment:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No se pudo registrar el pago',
      });
    } finally {
      setSaving(false);
    }
  };

  const copyMessage = (debtor: DebtorStudent) => {
    const period = periods.find(p => p.id === selectedPeriod);
    const message = `🔔 *COBRANZA LIMA CAFÉ 28*

Estimado(a) ${debtor.parent_name}

El alumno *${debtor.student_name}* tiene un consumo pendiente del período: ${period?.period_name}

💰 Monto Total: S/ ${debtor.total_amount.toFixed(2)}

📎 Adjuntamos el detalle completo.

Para pagar, contacte con administración.
Gracias.`;

    navigator.clipboard.writeText(message);
    toast({
      title: '📋 Mensaje copiado',
      description: 'El mensaje se copió al portapapeles',
    });
  };

  const generatePDF = (debtor: DebtorStudent) => {
    const period = periods.find(p => p.id === selectedPeriod);
    if (!period) return;

    generateBillingPDF({
      student_name: debtor.student_name,
      parent_name: debtor.parent_name,
      parent_phone: debtor.parent_phone,
      school_name: debtor.school_name,
      period_name: period.period_name,
      start_date: period.start_date,
      end_date: period.end_date,
      transactions: debtor.transactions.map(t => ({
        id: t.id,
        created_at: t.created_at,
        ticket_code: t.ticket_code,
        description: t.description || 'Consumo',
        amount: t.amount,
      })),
      total_amount: debtor.total_amount,
      pending_amount: debtor.total_amount,
    });

    toast({
      title: '✅ PDF generado',
      description: `Estado de cuenta de ${debtor.student_name}`,
    });
  };

  const generateWhatsAppExport = () => {
    const period = periods.find(p => p.id === selectedPeriod);
    const selectedDebtorsList = filteredDebtors.filter(d => selectedDebtors.has(d.student_id));

    if (selectedDebtorsList.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Selecciona al menos un deudor',
      });
      return;
    }

    // Generar intervalos aleatorios entre 15 y 300 segundos
    const messages = selectedDebtorsList.map((debtor, index) => {
      const delay = Math.floor(Math.random() * (300 - 15 + 1)) + 15; // 15-300 segundos

      return {
        index: index + 1,
        phone: debtor.parent_phone,
        parent_name: debtor.parent_name,
        student_name: debtor.student_name,
        amount: debtor.total_amount.toFixed(2),
        period: period?.period_name || '',
        message: `🔔 *COBRANZA LIMA CAFÉ 28*\n\nEstimado(a) ${debtor.parent_name}\n\nEl alumno *${debtor.student_name}* tiene un consumo pendiente del período: ${period?.period_name}\n\n💰 Monto Total: S/ ${debtor.total_amount.toFixed(2)}\n\n📎 Adjuntamos el detalle completo.\n\nPara pagar, contacte con administración.\nGracias.`,
        delay_seconds: delay,
        pdf_url: '', // Se generará después
      };
    });

    // Descargar como JSON
    const dataStr = JSON.stringify(messages, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cobranzas_${period?.period_name}_${format(new Date(), 'yyyyMMdd_HHmmss')}.json`;
    link.click();

    toast({
      title: '✅ Exportación generada',
      description: `${messages.length} mensajes con intervalos aleatorios (15-300 seg)`,
    });
  };

  const currentPeriod = periods.find(p => p.id === selectedPeriod);

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Sede */}
            {canViewAllSchools && (
              <div className="space-y-2">
                <Label>Sede</Label>
                <Select value={selectedSchool} onValueChange={setSelectedSchool}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las Sedes</SelectItem>
                    {schools.map((school) => (
                      <SelectItem key={school.id} value={school.id}>
                        {school.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Período */}
            <div className="space-y-2">
              <Label>Período de Cobranza *</Label>
              <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un período" />
                </SelectTrigger>
                <SelectContent>
                  {periods.map((period) => (
                    <SelectItem key={period.id} value={period.id}>
                      {period.period_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Buscador */}
            <div className="space-y-2">
              <Label>Buscar</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Estudiante, padre..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {!selectedPeriod ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Calendar className="h-16 w-16 mx-auto mb-4 text-gray-400" />
            <p className="text-gray-500">Selecciona un período de cobranza para comenzar</p>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-red-600" />
          <p className="ml-3 text-gray-600">Cargando deudores...</p>
        </div>
      ) : (
        <>
          {/* Acciones masivas */}
          {filteredDebtors.length > 0 && (
            <Card className="bg-gradient-to-r from-orange-50 to-red-50 border-orange-200">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <Checkbox
                      checked={selectedDebtors.size === filteredDebtors.length && filteredDebtors.length > 0}
                      onCheckedChange={selectAll}
                    />
                    <span className="font-semibold text-gray-900">
                      {selectedDebtors.size} de {filteredDebtors.length} seleccionados
                    </span>
                    <Badge variant="secondary">
                      Total: S/ {filteredDebtors
                        .filter(d => selectedDebtors.has(d.student_id))
                        .reduce((sum, d) => sum + d.total_amount, 0)
                        .toFixed(2)}
                    </Badge>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={selectedDebtors.size === 0}
                      onClick={generateWhatsAppExport}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Exportar WhatsApp
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={selectedDebtors.size === 0}
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      PDFs Masivos
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Lista de deudores */}
          {filteredDebtors.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <CheckCircle2 className="h-16 w-16 mx-auto mb-4 text-green-500" />
                <h3 className="text-lg font-semibold text-gray-700 mb-2">
                  ¡Sin deudas pendientes!
                </h3>
                <p className="text-gray-500">
                  No hay consumos sin facturar en el período seleccionado
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {filteredDebtors.map((debtor) => (
                <Card key={debtor.student_id} className="hover:shadow-lg transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      <Checkbox
                        checked={selectedDebtors.has(debtor.student_id)}
                        onCheckedChange={() => toggleSelection(debtor.student_id)}
                      />

                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <h3 className="font-semibold text-lg">{debtor.student_name}</h3>
                            <p className="text-sm text-gray-600">Padre: {debtor.parent_name}</p>
                            {canViewAllSchools && (
                              <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                                <Building2 className="h-3 w-3" />
                                {debtor.school_name}
                              </div>
                            )}
                          </div>
                          <div className="text-right">
                            <p className="text-2xl font-bold text-red-600">
                              S/ {debtor.total_amount.toFixed(2)}
                            </p>
                            <p className="text-xs text-gray-500">
                              {debtor.transaction_count} consumo(s)
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 mt-3">
                          <Button
                            size="sm"
                            variant="default"
                            className="bg-green-600 hover:bg-green-700"
                            onClick={() => handleOpenPayment(debtor)}
                          >
                            <DollarSign className="h-4 w-4 mr-1" />
                            Cobrar
                          </Button>

                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => copyMessage(debtor)}
                          >
                            <Copy className="h-4 w-4 mr-1" />
                            Copiar Mensaje
                          </Button>

                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => generatePDF(debtor)}
                          >
                            <FileText className="h-4 w-4 mr-1" />
                            PDF
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {/* Modal de Registro de Pago */}
      <Dialog open={showPaymentModal} onOpenChange={setShowPaymentModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Registrar Pago</DialogTitle>
            <DialogDescription>
              Estudiante: {currentDebtor?.student_name} | Total: S/ {currentDebtor?.total_amount.toFixed(2)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Monto a Pagar *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max={currentDebtor?.total_amount}
                  value={paymentData.paid_amount}
                  onChange={(e) => setPaymentData(prev => ({ ...prev, paid_amount: parseFloat(e.target.value) || 0 }))}
                />
                {currentDebtor && paymentData.paid_amount < currentDebtor.total_amount && (
                  <p className="text-xs text-orange-600">
                    Pago parcial - Restante: S/ {(currentDebtor.total_amount - paymentData.paid_amount).toFixed(2)}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Método de Pago *</Label>
                <Select
                  value={paymentData.payment_method}
                  onValueChange={(value) => setPaymentData(prev => ({ ...prev, payment_method: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="efectivo">💵 Efectivo</SelectItem>
                    <SelectItem value="transferencia">🏦 Transferencia</SelectItem>
                    <SelectItem value="yape">📱 Yape</SelectItem>
                    <SelectItem value="plin">📲 Plin</SelectItem>
                    <SelectItem value="tarjeta">💳 Tarjeta</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Número de Operación (Opcional)</Label>
              <Input
                placeholder="Ej: 123456789"
                value={paymentData.operation_number}
                onChange={(e) => setPaymentData(prev => ({ ...prev, operation_number: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>Tipo de Documento</Label>
              <Select
                value={paymentData.document_type}
                onValueChange={(value: any) => setPaymentData(prev => ({ ...prev, document_type: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ticket">🎫 Ticket</SelectItem>
                  <SelectItem value="boleta">📄 Boleta</SelectItem>
                  <SelectItem value="factura">📋 Factura</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Notas (Opcional)</Label>
              <Input
                placeholder="Observaciones adicionales..."
                value={paymentData.notes}
                onChange={(e) => setPaymentData(prev => ({ ...prev, notes: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPaymentModal(false)}>
              Cancelar
            </Button>
            <Button onClick={handleRegisterPayment} disabled={saving} className="bg-green-600 hover:bg-green-700">
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Registrando...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Registrar Pago
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
