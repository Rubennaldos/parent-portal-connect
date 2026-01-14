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
  Camera
} from 'lucide-react';

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
  onViewMenu: () => void;
  onOpenSettings: () => void;
  onPhotoClick: () => void;
}

export function StudentCard({
  student,
  onRecharge,
  onViewHistory,
  onViewMenu,
  onOpenSettings,
  onPhotoClick
}: StudentCardProps) {
  const isFreeAccount = student.free_account !== false; // Por defecto true

  return (
    <Card className="overflow-hidden hover:shadow-lg transition-all">
      {/* Header con gradiente */}
      <div className="h-24 bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 relative">
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
        <div className="absolute top-2 right-2">
          {isFreeAccount ? (
            <Badge className="bg-green-500 text-white border-0">
              Cuenta Libre
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-white/90">
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
            ? 'bg-green-50 border-2 border-green-200' 
            : 'bg-blue-50 border-2 border-blue-200'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                {isFreeAccount ? 'Consumo del Mes' : 'Saldo Disponible'}
              </p>
              <p className={`text-3xl font-bold ${
                isFreeAccount 
                  ? student.balance < 0 ? 'text-red-600' : 'text-green-600'
                  : student.balance > 0 ? 'text-blue-600' : 'text-gray-400'
              }`}>
                S/ {Math.abs(student.balance).toFixed(2)}
              </p>
              {isFreeAccount && student.balance < 0 && (
                <p className="text-xs text-red-600 mt-1">
                  Pendiente de pago
                </p>
              )}
            </div>
            <Wallet className={`h-10 w-10 ${
              isFreeAccount ? 'text-green-500' : 'text-blue-500'
            }`} />
          </div>

          {!isFreeAccount && student.daily_limit > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <p className="text-xs text-gray-600">
                Límite diario: <span className="font-semibold">S/ {student.daily_limit.toFixed(2)}</span>
              </p>
            </div>
          )}
        </div>

        {/* Botones principales */}
        <div className="space-y-2">
          {/* Botón PAGAR DEUDAS o RECARGAR - Solo si NO es cuenta libre */}
          {!isFreeAccount && (
            <Button
              onClick={onRecharge}
              className="w-full h-14 text-lg font-semibold bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
              size="lg"
            >
              <CreditCard className="h-5 w-5 mr-2" />
              Pagar Deudas
            </Button>
          )}

          {/* Botón MENÚ - Grande y llamativo */}
          <Button
            onClick={onViewMenu}
            className="w-full h-14 text-lg font-semibold bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600"
            size="lg"
          >
            <UtensilsCrossed className="h-5 w-5 mr-2" />
            Ver Menú Semanal
          </Button>

          {/* Botón Historial - Secundario pero visible */}
          <Button
            onClick={onViewHistory}
            variant="outline"
            className="w-full h-12 border-2"
            size="lg"
          >
            <History className="h-4 w-4 mr-2" />
            Ver Historial
          </Button>

          {/* Botón Configuración - Discreto */}
          <Button
            onClick={onOpenSettings}
            variant="ghost"
            className="w-full h-10 text-gray-500 hover:text-gray-700 hover:bg-gray-50"
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

