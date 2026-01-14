import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Wallet, 
  CreditCard, 
  Smartphone, 
  History,
  Settings2,
  UtensilsCrossed,
  ChevronRight,
  Camera,
  Info
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface Student {
  id: string;
  full_name: string;
  photo_url: string | null;
  balance: number;
  daily_limit: number;
  grade: string;
  section: string;
  is_active: boolean;
  free_account?: boolean;
}

interface StudentCardProps {
  student: Student;
  onRecharge: () => void;
  onViewHistory: () => void;
  onLunchFast: () => void;
  onViewMenu: () => void;
  onOpenSettings: () => void;
  onPhotoClick: () => void;
}

export function StudentCard({
  student,
  onRecharge,
  onViewHistory,
  onLunchFast,
  onViewMenu,
  onOpenSettings,
  onPhotoClick
}: StudentCardProps) {
  const isFreeAccount = student.free_account !== false;
  
  // LÓGICA SIMPLIFICADA: Si debe (balance < 0) → Pagar Deudas, si es prepago → Recargar
  const hasDebt = student.balance < 0;
  const showPaymentButton = hasDebt || !isFreeAccount;
  const buttonText = hasDebt ? 'Pagar Deudas' : 'Recargar Saldo';

  return (
    <Card className="overflow-hidden hover:shadow-lg transition-all border-2">
      {/* Header con gradiente */}
      <div className={`h-24 relative ${
        hasDebt 
          ? 'bg-gradient-to-br from-red-500 via-orange-500 to-yellow-500' 
          : 'bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500'
      }`}>
        <div className="absolute -bottom-12 left-6">
          <div className="relative">
            <div 
              className="w-24 h-24 rounded-full border-4 border-white bg-gray-200 overflow-hidden cursor-pointer hover:border-blue-400 transition-all shadow-lg"
              onClick={onPhotoClick}
            >
              {student.photo_url ? (
                <img 
                  src={student.photo_url} 
                  alt={student.full_name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-100 to-purple-100">
                  <span className="text-3xl font-bold text-blue-600">
                    {student.full_name.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
            </div>
            {/* Icono de cámara */}
            <button
              onClick={onPhotoClick}
              className="absolute bottom-0 right-0 w-8 h-8 bg-white rounded-full border-2 border-blue-500 flex items-center justify-center hover:bg-blue-50 transition-all shadow-md"
              title="Subir foto"
            >
              <Camera className="h-4 w-4 text-blue-600" />
            </button>
          </div>
        </div>
        
        {/* Badge de cuenta */}
        <div className="absolute top-2 right-2 flex gap-2">
          {hasDebt && (
            <Badge variant="destructive" className="animate-pulse shadow-md">
              Deuda Pendiente
            </Badge>
          )}
          {isFreeAccount ? (
            <Badge className="bg-green-500 text-white border-0 shadow-sm">
              Cuenta Libre
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-white/90 shadow-sm">
              Saldo Prepago
            </Badge>
          )}
        </div>
      </div>

      {/* Contenido */}
      <CardContent className="pt-16 pb-4 px-6">
        {/* Nombre y grado */}
        <div className="mb-4">
          <h3 className="text-xl font-bold text-gray-900">
            {student.full_name}
          </h3>
          <p className="text-sm text-gray-500">
            {student.grade} - {student.section}
          </p>
        </div>

        {/* Saldo/Deuda */}
        <div className={`rounded-xl p-4 mb-4 ${
          isFreeAccount 
            ? student.balance < 0 ? 'bg-red-50 border-2 border-red-200' : 'bg-green-50 border-2 border-green-200' 
            : 'bg-blue-50 border-2 border-blue-200'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-xs font-bold text-gray-600 uppercase tracking-wide">
                  {hasDebt ? 'TOTAL ADEUDADO' : (isFreeAccount ? 'TOTAL A FAVOR' : 'SALDO DISPONIBLE')}
                </p>
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="hover:bg-white/50 rounded-full p-0.5 transition-all">
                      <Info className="h-4 w-4 text-gray-500 hover:text-gray-700" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80" side="top">
                    <div className="space-y-2">
                      <h4 className="font-bold text-sm">
                        {hasDebt ? '💳 Deuda Pendiente' : (isFreeAccount ? '✅ Saldo a Favor' : '💰 Saldo Prepago')}
                      </h4>
                      <p className="text-xs text-gray-600">
                        {hasDebt 
                          ? `Este monto representa consumos que ${student.full_name} realizó en el kiosco escolar y que aún no han sido pagados. Puedes cancelarlos haciendo clic en "Pagar Deudas".`
                          : isFreeAccount
                            ? `${student.full_name} tiene este saldo a favor. Se descontará automáticamente de sus próximos consumos en el kiosco.`
                            : `Este es el saldo disponible de ${student.full_name} para consumir en el kiosco. Cuando se agote, necesitará una recarga.`
                        }
                      </p>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              <p className={`text-3xl font-black ${
                isFreeAccount 
                  ? student.balance < 0 ? 'text-red-600' : 'text-green-600'
                  : student.balance > 0 ? 'text-blue-600' : 'text-gray-400'
              }`}>
                S/ {Math.abs(student.balance).toFixed(2)}
              </p>
            </div>
            <Wallet className={`h-10 w-10 ${
              isFreeAccount 
                ? student.balance < 0 ? 'text-red-500' : 'text-green-500' 
                : 'text-blue-500'
            }`} />
          </div>
        </div>

        {/* Botones principales */}
        <div className="space-y-3">
          {/* Botón Lunch Fast - MÁS GRANDE Y ARRIBA */}
          <Button
            onClick={onLunchFast}
            className="w-full h-16 text-xl font-black bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 hover:from-orange-600 hover:to-red-600 shadow-lg transform active:scale-95 transition-all"
            size="lg"
          >
            <UtensilsCrossed className="h-6 w-6 mr-2 animate-bounce" />
            LUNCH FAST!
          </Button>

          {/* Botón PAGAR DEUDAS o RECARGAR */}
          {showPaymentButton && (
            <Button
              onClick={onRecharge}
              className={`w-full h-14 text-lg font-bold shadow-md ${
                hasDebt 
                  ? 'bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 animate-pulse'
                  : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700'
              }`}
              size="lg"
            >
              <CreditCard className="h-5 w-5 mr-2" />
              {buttonText}
            </Button>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={onViewMenu}
              variant="outline"
              className="h-12 border-2 text-gray-600 font-semibold"
            >
              Ver Calendario
            </Button>
            <Button
              onClick={onViewHistory}
              variant="outline"
              className="h-12 border-2 text-gray-600 font-semibold"
            >
              <History className="h-4 w-4 mr-1" />
              Historial
            </Button>
          </div>

          <Button
            onClick={onOpenSettings}
            variant="ghost"
            className="w-full h-10 text-gray-400 hover:text-gray-600"
            size="sm"
          >
            <Settings2 className="h-3 w-3 mr-2" />
            <span className="text-xs">Configurar topes y opciones</span>
            <ChevronRight className="h-3 w-3 ml-auto" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

