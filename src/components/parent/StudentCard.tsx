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
  school?: { id: string; name: string } | null;
}

interface StudentCardProps {
  student: Student;
  totalDebt?: number; // 💰 Deuda calculada con delay
  onRecharge: () => void;
  onViewHistory: () => void;
  onLunchFast: () => void;
  onViewMenu: () => void;
  onOpenSettings: () => void;
  onPhotoClick: () => void;
  // onViewCalendar: () => void; // Comentado temporalmente
}

export function StudentCard({
  student,
  totalDebt = 0, // 💰 Default 0 si no se pasa
  onRecharge,
  onViewHistory,
  onLunchFast,
  onViewMenu,
  onOpenSettings,
  onPhotoClick,
  // onViewCalendar // Comentado temporalmente
}: StudentCardProps) {
  const isFreeAccount = student.free_account !== false;
  
  // ✅ Usar totalDebt pasado como prop (con filtro de delay) en vez de balance
  const hasDebt = isFreeAccount ? totalDebt > 0 : student.balance < 0;
  const displayAmount = isFreeAccount ? totalDebt : Math.abs(student.balance);
  const showPaymentButton = hasDebt || !isFreeAccount;
  const buttonText = hasDebt ? 'Pagar Deudas' : 'Recargar Saldo';

  return (
    <Card className="overflow-hidden hover:shadow-lg transition-all duration-300 border border-stone-200/50 bg-white group">
      {/* Header Minimalista con toque sutil de verde */}
      <div className={`h-1.5 relative transition-colors duration-500 ${
        hasDebt ? 'bg-rose-400' : 'bg-gradient-to-r from-emerald-500/70 via-[#8B7355] to-[#6B5744]'
      }`} />

      {/* Perfil */}
      <div className="px-6 pt-8 pb-4 relative">
        <div className="flex items-start gap-4">
          <div 
            className="w-20 h-20 rounded-2xl border border-stone-200/50 bg-gradient-to-br from-stone-50/50 to-emerald-50/20 overflow-hidden cursor-pointer hover:scale-105 transition-transform duration-300 shadow-sm flex-shrink-0"
            onClick={onPhotoClick}
          >
            {student.photo_url ? (
              <img 
                src={student.photo_url} 
                alt={student.full_name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-stone-100/50 to-emerald-50/30">
                <span className="text-2xl font-light text-stone-400">
                  {student.full_name.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </div>
          
          <div className="flex-1 pt-1">
            <h3 className="text-xl font-normal text-stone-800 leading-tight group-hover:text-emerald-700 transition-colors tracking-wide">
              {student.full_name}
            </h3>
            {/* 🏫 Nombre del colegio */}
            {student.school?.name && (
              <p className="text-xs font-semibold text-emerald-700 mt-1.5 tracking-wide">
                🏫 {student.school.name}
              </p>
            )}
            <p className="text-[10px] font-medium text-stone-400 uppercase tracking-[0.2em] mt-1">
              {student.grade} <span className="text-stone-300">·</span> {student.section}
            </p>
            
            <div className="flex gap-2 mt-3">
              {isFreeAccount ? (
                <Badge className="bg-emerald-50/80 text-emerald-700 hover:bg-emerald-100/80 border border-emerald-200/30 py-0.5 px-2.5 rounded-lg font-medium text-[9px] uppercase tracking-wider">
                  Cuenta Libre
                </Badge>
              ) : (
                <Badge className="bg-amber-50 text-amber-600 hover:bg-amber-100 border-0 py-0.5 px-2.5 rounded-lg font-medium text-[9px] uppercase tracking-wider">
                  Prepago
                </Badge>
              )}
              {hasDebt && (
                <Badge className="bg-rose-50 text-rose-600 border-0 py-0.5 px-2.5 rounded-lg font-medium text-[9px] uppercase tracking-wider animate-pulse">
                  Deuda
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Icono de cámara minimalista con toque verde */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPhotoClick();
          }}
          className="absolute top-20 left-20 w-8 h-8 bg-white rounded-xl shadow-sm border border-emerald-200/20 flex items-center justify-center hover:bg-emerald-50/30 transition-all active:scale-90"
        >
          <Camera className="h-4 w-4 text-stone-400 hover:text-emerald-600" />
        </button>
      </div>

      {/* Contenido */}
      <CardContent className="pb-6 px-6 pt-2">
        {/* Saldo/Deuda - Diseño Limpio Estilo Banco */}
        <div className={`rounded-2xl p-5 mb-6 border transition-all duration-300 ${
          hasDebt ? 'bg-rose-50/30 border-rose-200/50' : 'bg-gradient-to-br from-stone-50/30 to-emerald-50/20 border-emerald-200/20'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`text-[9px] font-medium uppercase tracking-[0.2em] ${
                  hasDebt ? 'text-rose-500' : 'text-stone-400'
                }`}>
                  {hasDebt ? 'Total Adeudado' : 'Saldo a Favor'}
                </span>
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="text-stone-300 hover:text-emerald-500 transition-colors">
                      <Info className="h-3 w-3" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 shadow-lg border border-stone-200/50 rounded-2xl p-4" side="top" align="start">
                    <div className="space-y-2">
                      <h4 className="font-medium text-sm text-stone-800">
                        {hasDebt ? '💳 Información de Deuda' : '✅ Información de Saldo'}
                      </h4>
                      <p className="text-xs text-stone-500 leading-relaxed">
                        {hasDebt 
                          ? `Consumos pendientes de pago realizados por ${student.full_name}.`
                          : `Monto disponible que ${student.full_name} puede usar en el kiosco.`
                        }
                      </p>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              <p className={`text-3xl font-light tracking-tight ${
                hasDebt ? 'text-rose-600' : 'text-emerald-600'
              }`}>
                S/ {displayAmount.toFixed(2)}
              </p>
            </div>
            <div className={`p-3 rounded-xl ${
              hasDebt ? 'bg-rose-100/50 text-rose-500' : 'bg-emerald-100/60 text-emerald-600'
            }`}>
              <Wallet className="h-6 w-6" />
            </div>
          </div>
        </div>

        {/* Botones - Diseño Limpio con toque verde */}
        <div className="space-y-3">
          <Button
            onClick={onLunchFast}
            className="w-full h-14 text-base font-medium bg-gradient-to-r from-emerald-600/90 via-[#8B7355] to-[#6B5744] hover:from-emerald-700/90 hover:via-[#6B5744] hover:to-[#5B4734] text-white shadow-md rounded-xl transition-all active:scale-95 tracking-wide"
          >
            <UtensilsCrossed className="h-5 w-5 mr-2" />
            LUNCH FAST!
          </Button>

          {/* 🔒 MÓDULO DE PAGOS/RECARGAS DESACTIVADO - Todo pago es presencial */}
          {hasDebt && (
            <div className="w-full rounded-xl border border-amber-200/50 bg-amber-50/50 p-3 text-center">
              <p className="text-xs font-medium text-amber-700 mb-1">💳 Los pagos se realizan presencialmente en caja</p>
              <p className="text-[10px] text-amber-500">Acérquese a la cafetería para cancelar su deuda</p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3">
            <Button
              onClick={onViewHistory}
              variant="ghost"
              className="h-11 rounded-xl text-stone-500 font-normal hover:bg-emerald-50/30 hover:text-emerald-700 transition-all text-xs tracking-wide"
            >
              <History className="h-4 w-4 mr-1.5" />
              Historial
            </Button>
          </div>

          {/* ⚙️ Configuración de Topes */}
          <button
            onClick={onOpenSettings}
            className="w-full pt-2 flex items-center justify-center gap-2 text-stone-400 hover:text-emerald-600 transition-colors cursor-pointer group/btn"
          >
            <Settings2 className="h-5 w-5 group-hover/btn:rotate-90 transition-transform duration-300" />
            <span className="text-xs font-medium">Configuración de Topes</span>
          </button>
        </div>
      </CardContent>
    </Card>


  );
}

