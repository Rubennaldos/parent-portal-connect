import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { 
  Search, 
  Calendar as CalendarIcon, 
  FileText, 
  ArrowUpDown,
  Filter,
  Eye,
  Download
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface Transaction {
  id: string;
  created_at: string;
  student_id: string | null;
  type: string;
  amount: number;
  description: string;
  balance_after: number;
  ticket_code: string;
  created_by: string;
  student?: {
    full_name: string;
    school?: {
      name: string;
    }
  };
  profiles?: {
    email: string;
  };
}

interface TransactionItem {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
}

export const SalesList = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [transactionItems, setTransactionItems] = useState<TransactionItem[]>([]);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    fetchTransactions();
  }, []);

  const fetchTransactions = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('transactions')
        .select(`
          *,
          student:students(full_name, school:schools(name)),
          profiles:profiles!transactions_created_by_fkey(email)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTransactions(data || []);
    } catch (error: any) {
      console.error('Error fetching transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchTransactionItems = async (transactionId: string) => {
    try {
      const { data, error } = await supabase
        .from('transaction_items')
        .select('*')
        .eq('transaction_id', transactionId);

      if (error) throw error;
      setTransactionItems(data || []);
    } catch (error: any) {
      console.error('Error fetching items:', error);
    }
  };

  const handleViewDetails = async (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    await fetchTransactionItems(transaction.id);
    setShowDetails(true);
  };

  const filteredTransactions = transactions.filter(t => 
    t.ticket_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.student?.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <Card className="border shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
            <div>
              <CardTitle className="text-xl flex items-center gap-2">
                <FileText className="h-5 w-5 text-blue-600" />
                Historial de Ventas
              </CardTitle>
              <CardDescription>
                Registro completo de todas las transacciones del sistema
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={fetchTransactions}>
                <ArrowUpDown className="h-4 w-4 mr-2" />
                Actualizar
              </Button>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                Exportar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por ticket, alumno o descripción..."
                className="pl-9"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="gap-2">
                <CalendarIcon className="h-4 w-4" />
                Hoy
              </Button>
              <Button variant="outline" className="gap-2">
                <Filter className="h-4 w-4" />
                Filtros
              </Button>
            </div>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Fecha/Hora</TableHead>
                  <TableHead>Ticket</TableHead>
                  <TableHead>Cliente/Alumno</TableHead>
                  <TableHead>Monto</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead>Cajero</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      Cargando transacciones...
                    </TableCell>
                  </TableRow>
                ) : filteredTransactions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No se encontraron transacciones
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredTransactions.map((t) => (
                    <TableRow key={t.id} className="hover:bg-muted/30">
                      <TableCell className="text-xs">
                        {format(new Date(t.created_at), "dd/MM/yyyy HH:mm", { locale: es })}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-bold">
                        {t.ticket_code || '---'}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">
                            {t.student?.full_name || 'CLIENTE GENÉRICO'}
                          </span>
                          <span className="text-[10px] text-muted-foreground uppercase">
                            {t.student?.school?.name || '---'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="font-bold">
                        <span className={t.amount < 0 ? "text-red-600" : "text-green-600"}>
                          S/ {Math.abs(t.amount).toFixed(2)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-[10px] uppercase">
                          {t.description.includes('Efectivo') ? 'Efectivo' : 
                           t.description.includes('Yape') ? 'Yape' : 
                           t.description.includes('Tarjeta') ? 'Tarjeta' : 'Saldo'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t.profiles?.email?.split('@')[0] || 'sistema'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button 
                          variant="ghost" 
                          size="icon"
                          onClick={() => handleViewDetails(t)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Modal de Detalles */}
      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600" />
              Detalle de Venta
            </DialogTitle>
          </DialogHeader>
          
          {selectedTransaction && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm bg-muted/50 p-4 rounded-lg">
                <div>
                  <p className="text-muted-foreground text-xs uppercase">Ticket</p>
                  <p className="font-bold font-mono">{selectedTransaction.ticket_code}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs uppercase">Fecha</p>
                  <p className="font-medium">
                    {format(new Date(selectedTransaction.created_at), "dd/MM/yyyy HH:mm", { locale: es })}
                  </p>
                </div>
                <div className="col-span-2">
                  <p className="text-muted-foreground text-xs uppercase">Cliente</p>
                  <p className="font-bold text-blue-700">
                    {selectedTransaction.student?.full_name || 'CLIENTE GENÉRICO'}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Productos</p>
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/30">
                      <TableRow className="h-8">
                        <TableHead className="text-[10px]">Producto</TableHead>
                        <TableHead className="text-[10px] text-center">Cant</TableHead>
                        <TableHead className="text-[10px] text-right">Subtotal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transactionItems.map((item) => (
                        <TableRow key={item.id} className="h-10">
                          <TableCell className="text-xs py-1">{item.product_name}</TableCell>
                          <TableCell className="text-xs text-center py-1">{item.quantity}</TableCell>
                          <TableCell className="text-xs text-right font-bold py-1">
                            S/ {item.subtotal.toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="bg-slate-900 text-white p-4 rounded-xl">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">TOTAL PAGADO</span>
                  <span className="text-2xl font-black">
                    S/ {Math.abs(selectedTransaction.amount).toFixed(2)}
                  </span>
                </div>
              </div>
              
              <div className="flex justify-center">
                <Button className="w-full gap-2" variant="outline" onClick={() => window.print()}>
                  <Download className="h-4 w-4" />
                  Descargar Comprobante
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

