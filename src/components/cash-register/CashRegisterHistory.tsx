import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar, Download, Eye, Filter, X } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { CashRegisterClosure } from '@/types/cashRegister';

interface CashRegisterHistoryProps {
  schoolId: string;
  onClose: () => void;
}

export function CashRegisterHistory({ schoolId, onClose }: CashRegisterHistoryProps) {
  const [loading, setLoading] = useState(true);
  const [closures, setClosures] = useState<CashRegisterClosure[]>([]);
  const [filteredClosures, setFilteredClosures] = useState<CashRegisterClosure[]>([]);
  const [selectedClosure, setSelectedClosure] = useState<CashRegisterClosure | null>(null);
  
  // Filtros
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    loadClosures();
  }, [schoolId]);

  useEffect(() => {
    applyFilters();
  }, [closures, dateFrom, dateTo, statusFilter]);

  const loadClosures = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('cash_register_closures')
        .select('*')
        .eq('school_id', schoolId)
        .order('closure_date', { ascending: false })
        .limit(100);

      if (error) throw error;

      setClosures(data || []);
    } catch (error) {
      console.error('Error loading closures:', error);
      alert('Error al cargar el historial');
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...closures];

    // Filtrar por fecha desde
    if (dateFrom) {
      filtered = filtered.filter(c => c.closure_date >= dateFrom);
    }

    // Filtrar por fecha hasta
    if (dateTo) {
      filtered = filtered.filter(c => c.closure_date <= dateTo);
    }

    // Filtrar por estado
    if (statusFilter !== 'all') {
      filtered = filtered.filter(c => c.status === statusFilter);
    }

    setFilteredClosures(filtered);
  };

  const clearFilters = () => {
    setDateFrom('');
    setDateTo('');
    setStatusFilter('all');
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'open':
        return <Badge variant="default">Abierto</Badge>;
      case 'closed':
        return <Badge variant="secondary">Cerrado</Badge>;
      case 'auto_closed':
        return <Badge variant="outline">Auto-cerrado</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getDifferenceColor = (difference: number | null) => {
    if (!difference || Math.abs(difference) < 0.01) return 'text-green-600';
    return difference > 0 ? 'text-green-600' : 'text-red-600';
  };

  if (loading) {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[80vh]" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Historial de Cierres</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center p-8">
            Cargando historial...
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (selectedClosure) {
    return (
      <Dialog open onOpenChange={() => setSelectedClosure(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalle del Cierre</DialogTitle>
            <DialogDescription>
              {format(new Date(selectedClosure.closure_date), "EEEE d 'de' MMMM, yyyy", { locale: es })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Estado */}
            <div className="flex items-center justify-between">
              {getStatusBadge(selectedClosure.status)}
              <Button size="sm" variant="outline">
                <Download className="mr-2 h-4 w-4" />
                Exportar
              </Button>
            </div>

            {/* Resumen Financiero */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Resumen Financiero</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Caja Inicial</p>
                    <p className="font-semibold">S/ {selectedClosure.opening_balance.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Saldo Esperado</p>
                    <p className="font-semibold">S/ {selectedClosure.expected_balance.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Saldo Real</p>
                    <p className="font-semibold">
                      S/ {selectedClosure.actual_balance?.toFixed(2) || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Diferencia</p>
                    <p className={`font-semibold ${getDifferenceColor(selectedClosure.difference)}`}>
                      S/ {selectedClosure.difference?.toFixed(2) || 'N/A'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Ventas POS */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Punto de Venta</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Efectivo:</span>
                    <span>S/ {(selectedClosure.pos_cash + selectedClosure.pos_mixed_cash).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tarjeta:</span>
                    <span>S/ {(selectedClosure.pos_card + selectedClosure.pos_mixed_card).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Yape:</span>
                    <span>S/ {(selectedClosure.pos_yape + selectedClosure.pos_mixed_yape).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Yape QR:</span>
                    <span>S/ {selectedClosure.pos_yape_qr.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Crédito:</span>
                    <span>S/ {selectedClosure.pos_credit.toFixed(2)}</span>
                  </div>
                </div>
                <div className="flex justify-between pt-2 border-t font-semibold">
                  <span>Total POS:</span>
                  <span>
                    S/ {(selectedClosure.pos_cash + selectedClosure.pos_card + selectedClosure.pos_yape +
                         selectedClosure.pos_yape_qr + selectedClosure.pos_credit +
                         selectedClosure.pos_mixed_cash + selectedClosure.pos_mixed_card +
                         selectedClosure.pos_mixed_yape).toFixed(2)}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Almuerzos */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Almuerzos</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Efectivo:</span>
                    <span>S/ {selectedClosure.lunch_cash.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Crédito:</span>
                    <span>S/ {selectedClosure.lunch_credit.toFixed(2)}</span>
                  </div>
                </div>
                <div className="flex justify-between pt-2 border-t font-semibold">
                  <span>Total Almuerzos:</span>
                  <span>S/ {(selectedClosure.lunch_cash + selectedClosure.lunch_credit).toFixed(2)}</span>
                </div>
              </CardContent>
            </Card>

            {/* Movimientos */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Movimientos</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Ingresos</p>
                    <p className="font-semibold text-green-600">
                      S/ {selectedClosure.total_income.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Egresos</p>
                    <p className="font-semibold text-red-600">
                      S/ {selectedClosure.total_expenses.toFixed(2)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* División de Efectivo */}
            {(selectedClosure.petty_cash || selectedClosure.safe_cash) && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">División de Efectivo</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Caja Chica</p>
                      <p className="font-semibold">S/ {selectedClosure.petty_cash?.toFixed(2) || '0.00'}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Caja Fuerte/Extracción</p>
                      <p className="font-semibold">S/ {selectedClosure.safe_cash?.toFixed(2) || '0.00'}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Ajuste (si hay diferencia) */}
            {selectedClosure.adjustment_reason && (
              <Card className="border-yellow-500">
                <CardHeader>
                  <CardTitle className="text-base text-yellow-600">Ajuste de Caja</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{selectedClosure.adjustment_reason}</p>
                  {selectedClosure.adjustment_approved_at && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Aprobado el {format(new Date(selectedClosure.adjustment_approved_at), "dd/MM/yyyy HH:mm")}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Observaciones */}
            {selectedClosure.notes && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Observaciones</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{selectedClosure.notes}</p>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setSelectedClosure(null)}>
              Cerrar
            </Button>
            <Button>
              <Download className="mr-2 h-4 w-4" />
              Exportar Detalle
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Historial de Cierres de Caja</DialogTitle>
          <DialogDescription>
            Consulte los cierres anteriores con filtros por fecha y estado
          </DialogDescription>
        </DialogHeader>

        {/* Filtros */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="mr-2 h-4 w-4" />
              Filtros
            </Button>
            {(dateFrom || dateTo || statusFilter !== 'all') && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="mr-2 h-4 w-4" />
                Limpiar
              </Button>
            )}
            <div className="ml-auto text-sm text-muted-foreground">
              {filteredClosures.length} registro(s) encontrado(s)
            </div>
          </div>

          {showFilters && (
            <Card>
              <CardContent className="pt-6">
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="dateFrom">Desde</Label>
                    <Input
                      id="dateFrom"
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="dateTo">Hasta</Label>
                    <Input
                      id="dateTo"
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="status">Estado</Label>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        <SelectItem value="open">Abierto</SelectItem>
                        <SelectItem value="closed">Cerrado</SelectItem>
                        <SelectItem value="auto_closed">Auto-cerrado</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Lista de Cierres */}
        <div className="overflow-y-auto max-h-[50vh]">
          {filteredClosures.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No se encontraron cierres con los filtros aplicados
            </div>
          ) : (
            <div className="space-y-2">
              {filteredClosures.map((closure) => (
                <Card key={closure.id} className="hover:bg-muted/50 transition-colors cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 grid grid-cols-5 gap-4 items-center">
                        <div>
                          <p className="text-sm font-semibold">
                            {format(new Date(closure.closure_date), "dd/MM/yyyy")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(closure.closure_time), "HH:mm")}
                          </p>
                        </div>
                        <div>
                          {getStatusBadge(closure.status)}
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Esperado</p>
                          <p className="font-semibold">S/ {closure.expected_balance.toFixed(2)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Real</p>
                          <p className="font-semibold">
                            S/ {closure.actual_balance?.toFixed(2) || 'N/A'}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Diferencia</p>
                          <p className={`font-semibold ${getDifferenceColor(closure.difference)}`}>
                            S/ {closure.difference?.toFixed(2) || 'N/A'}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedClosure(closure)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
