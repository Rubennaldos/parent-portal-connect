import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';

export interface CashRegisterGuardState {
  isLoading: boolean;
  schoolId: string | null;
  // Caja actualmente abierta HOY para esta sede
  openRegister: any | null;
  // ¿Hay una caja de un día anterior sin cerrar?
  hasUnclosedPrevious: boolean;
  previousUnclosed: any | null;
  // ¿Necesita declarar apertura? (no hay caja abierta hoy)
  needsDeclaration: boolean;
  // Funciones
  openCashRegister: (declaredAmount: number) => Promise<boolean>;
  refresh: () => Promise<void>;
}

const ROLES_REQUIRE_CASH = ['gestor_unidad', 'admin_escuela', 'admin'];

export function useCashRegisterGuard(): CashRegisterGuardState {
  const { user } = useAuth();
  const { role } = useRole();
  const [isLoading, setIsLoading] = useState(true);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [openRegister, setOpenRegister] = useState<any | null>(null);
  const [hasUnclosedPrevious, setHasUnclosedPrevious] = useState(false);
  const [previousUnclosed, setPreviousUnclosed] = useState<any | null>(null);

  const checkCashStatus = useCallback(async () => {
    if (!user?.id) return;

    try {
      setIsLoading(true);

      // 1. Obtener school_id del usuario
      const { data: profile } = await supabase
        .from('profiles')
        .select('school_id')
        .eq('id', user.id)
        .single();

      if (!profile?.school_id) {
        setIsLoading(false);
        return;
      }

      const sid = profile.school_id;
      setSchoolId(sid);

      // 2. Verificar si hay caja abierta HOY para esta sede
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const { data: openRegs } = await supabase
        .from('cash_registers')
        .select('*')
        .eq('school_id', sid)
        .eq('status', 'open')
        .order('opened_at', { ascending: false })
        .limit(1);

      const currentOpen = openRegs?.[0] || null;
      setOpenRegister(currentOpen);

      // 3. Si hay caja abierta pero es de un día anterior → es caja sin cerrar
      if (currentOpen) {
        const openedDate = new Date(currentOpen.opened_at);
        openedDate.setHours(0, 0, 0, 0);
        const isFromPreviousDay = openedDate < todayStart;

        if (isFromPreviousDay) {
          setHasUnclosedPrevious(true);
          setPreviousUnclosed(currentOpen);
          setOpenRegister(null); // No contar como abierta hoy
        } else {
          setHasUnclosedPrevious(false);
          setPreviousUnclosed(null);
        }
      } else {
        // 4. Sin caja abierta → verificar si hay alguna SIN CERRAR de días anteriores
        const { data: unclosed } = await supabase
          .from('cash_registers')
          .select('*')
          .eq('school_id', sid)
          .eq('status', 'open')
          .lt('opened_at', todayStart.toISOString())
          .order('opened_at', { ascending: false })
          .limit(1);

        if (unclosed && unclosed.length > 0) {
          setHasUnclosedPrevious(true);
          setPreviousUnclosed(unclosed[0]);
        } else {
          setHasUnclosedPrevious(false);
          setPreviousUnclosed(null);
        }
      }
    } catch (error) {
      console.error('Error verificando estado de caja:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    checkCashStatus();
  }, [checkCashStatus]);

  const openCashRegister = async (declaredAmount: number): Promise<boolean> => {
    if (!schoolId || !user?.id) return false;

    try {
      const { data, error } = await supabase
        .from('cash_registers')
        .insert({
          school_id: schoolId,
          opened_by: user.id,
          initial_amount: declaredAmount,
          status: 'open',
        })
        .select()
        .single();

      if (error) throw error;

      setOpenRegister(data);
      return true;
    } catch (error) {
      console.error('Error abriendo caja:', error);
      return false;
    }
  };

  const needsDeclaration =
    !isLoading &&
    !openRegister &&
    !hasUnclosedPrevious &&
    ROLES_REQUIRE_CASH.includes(role || '');

  return {
    isLoading,
    schoolId,
    openRegister,
    hasUnclosedPrevious,
    previousUnclosed,
    needsDeclaration,
    openCashRegister,
    refresh: checkCashStatus,
  };
}
