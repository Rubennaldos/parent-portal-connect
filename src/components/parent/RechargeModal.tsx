import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  CreditCard, 
  Smartphone, 
  Building2, 
  Settings2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronRight,
  Wallet
} from 'lucide-react';

interface RechargeModalProps {
  isOpen: boolean;
  onClose: () => void;
  studentName: string;
  studentId: string;
  currentBalance: number;
  accountType: string;
  onRecharge: (amount: number, method: string) => Promise<void>;
}

export function RechargeModal({
  isOpen,
  onClose,
  studentName,
  studentId,
  currentBalance,
  accountType,
  onRecharge
}: RechargeModalProps) {
  const [amount, setAmount] = useState('');
  const [selectedMethod, setSelectedMethod] = useState<'card' | 'yape' | 'plin' | 'bank'>('card');
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const quickAmounts = [10, 20, 50, 100];

  const handleRecharge = async () => {
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      return;
    }

    setLoading(true);
    try {
      await onRecharge(numAmount, selectedMethod);
      setAmount('');
      onClose();
    } catch (error) {
      console.error('Error en recarga:', error);
    } finally {
      setLoading(false);
    }
  };

  const paymentMethods = [
    {
      id: 'card',
      name: 'Tarjeta de Crédito/Débito',
      icon: CreditCard,
      color: 'blue',
      description: 'Visa, Mastercard, Amex',
      available: true,
      gateway: 'niubiz' // Procesador: Niubiz
    },
    {
      id: 'yape',
      name: 'Yape',
      icon: Smartphone,
      color: 'purple',
      description: 'Pago instantáneo',
      available: true,
      gateway: 'izipay' // Procesador: Izipay
    },
    {
      id: 'plin',
      name: 'Plin',
      icon: Smartphone,
      color: 'green',
      description: 'Pago instantáneo',
      available: true,
      gateway: 'izipay'
    },
    {
      id: 'bank',
      name: 'Transferencia Bancaria',
      icon: Building2,
      color: 'orange',
      description: 'Acredita en 24-48h',
      available: false,
      gateway: 'manual'
    }
  ];

  const selectedMethodData = paymentMethods.find(m => m.id === selectedMethod);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Recargar Saldo</DialogTitle>
          <DialogDescription>
            Para <strong>{studentName}</strong>
          </DialogDescription>
        </DialogHeader>

        {/* Tabs: Recarga y Configuración */}
        <Tabs defaultValue="recharge" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="recharge">
              <Wallet className="h-4 w-4 mr-2" />
              Recargar
            </TabsTrigger>
            <TabsTrigger value="settings">
              <Settings2 className="h-4 w-4 mr-2" />
              Configurar Topes
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: RECARGA */}
          <TabsContent value="recharge" className="space-y-6">
            {/* Info actual */}
            <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Saldo Actual</p>
                  <p className="text-2xl font-bold text-blue-600">
                    S/ {currentBalance.toFixed(2)}
                  </p>
                </div>
                {accountType === 'free' && (
                  <Badge className="bg-green-500 text-white">Cuenta Libre</Badge>
                )}
              </div>
            </div>

            {/* Selección de monto */}
            <div className="space-y-3">
              <Label>Monto a Recargar</Label>
              <Input
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="text-2xl h-16 text-center font-bold"
                min="1"
                step="0.01"
              />
              
              {/* Montos rápidos */}
              <div className="grid grid-cols-4 gap-2">
                {quickAmounts.map((quickAmount) => (
                  <Button
                    key={quickAmount}
                    variant="outline"
                    onClick={() => setAmount(quickAmount.toString())}
                    className="h-12"
                  >
                    S/ {quickAmount}
                  </Button>
                ))}
              </div>
            </div>

            {/* Selección de método de pago */}
            <div className="space-y-3">
              <Label>Método de Pago</Label>
              <div className="grid grid-cols-1 gap-3">
                {paymentMethods.map((method) => {
                  const Icon = method.icon;
                  const isSelected = selectedMethod === method.id;
                  const bgColor = {
                    blue: 'bg-blue-50 border-blue-500',
                    purple: 'bg-purple-50 border-purple-500',
                    green: 'bg-green-50 border-green-500',
                    orange: 'bg-orange-50 border-orange-500'
                  }[method.color];

                  return (
                    <button
                      key={method.id}
                      onClick={() => method.available && setSelectedMethod(method.id as any)}
                      disabled={!method.available}
                      className={`
                        w-full p-4 rounded-xl border-2 transition-all text-left
                        ${isSelected ? `${bgColor} shadow-lg` : 'border-gray-200 hover:border-gray-300'}
                        ${!method.available ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                      `}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-12 h-12 rounded-lg bg-white flex items-center justify-center`}>
                            <Icon className={`h-6 w-6 text-${method.color}-600`} />
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900">{method.name}</p>
                            <p className="text-xs text-gray-500">{method.description}</p>
                          </div>
                        </div>
                        {isSelected && (
                          <CheckCircle2 className="h-6 w-6 text-blue-600" />
                        )}
                        {!method.available && (
                          <Badge variant="secondary">Próximamente</Badge>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Resumen */}
            {amount && parseFloat(amount) > 0 && (
              <div className="bg-gradient-to-br from-blue-50 to-purple-50 border-2 border-blue-300 rounded-xl p-4">
                <h4 className="font-semibold text-gray-900 mb-3">Resumen de Recarga</h4>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Monto a recargar:</span>
                    <span className="font-semibold">S/ {parseFloat(amount).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Saldo actual:</span>
                    <span>S/ {currentBalance.toFixed(2)}</span>
                  </div>
                  <div className="border-t border-blue-200 pt-2 mt-2">
                    <div className="flex justify-between">
                      <span className="font-semibold text-gray-900">Nuevo saldo:</span>
                      <span className="font-bold text-blue-600 text-lg">
                        S/ {(currentBalance + parseFloat(amount)).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Botón de pago */}
            <Button
              onClick={handleRecharge}
              disabled={!amount || parseFloat(amount) <= 0 || loading}
              className="w-full h-14 text-lg font-semibold bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
            >
              {loading ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Procesando...
                </>
              ) : (
                <>
                  <CreditCard className="h-5 w-5 mr-2" />
                  Proceder al Pago
                </>
              )}
            </Button>

            {/* Info de seguridad */}
            <div className="flex items-start gap-2 text-xs text-gray-500 bg-gray-50 p-3 rounded-lg">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <p>
                Pago seguro procesado por {selectedMethodData?.gateway.toUpperCase()}. 
                Tus datos están protegidos con encriptación SSL.
              </p>
            </div>
          </TabsContent>

          {/* TAB 2: CONFIGURACIÓN (Discreto) */}
          <TabsContent value="settings" className="space-y-4">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-yellow-900">Configuración Opcional</p>
                  <p className="text-xs text-yellow-700 mt-1">
                    La Cuenta Libre permite que tu hijo consuma sin límites y pagues después. 
                    Aquí puedes configurar topes si lo prefieres.
                  </p>
                </div>
              </div>
            </div>

            {/* Opciones de configuración */}
            <div className="space-y-4">
              <div className="border rounded-lg p-4">
                <Label className="text-sm font-medium">Tipo de Cuenta</Label>
                <div className="mt-2 space-y-2">
                  <button className="w-full p-3 border-2 border-green-500 bg-green-50 rounded-lg text-left">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-green-900">Cuenta Libre (Recomendado)</p>
                        <p className="text-xs text-green-700">Consume y paga después</p>
                      </div>
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    </div>
                  </button>
                  <button className="w-full p-3 border rounded-lg text-left hover:border-gray-300">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-gray-700">Saldo Prepago</p>
                        <p className="text-xs text-gray-500">Solo gasta lo que tiene</p>
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              <div className="border rounded-lg p-4">
                <Label className="text-sm font-medium">Límite Diario (Opcional)</Label>
                <Input
                  type="number"
                  placeholder="15.00"
                  className="mt-2"
                  min="0"
                  step="0.50"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Dejar en 0 para sin límite
                </p>
              </div>

              <Button variant="outline" className="w-full">
                Guardar Configuración
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

