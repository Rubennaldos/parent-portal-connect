import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface UseStudentBalanceResult {
  balance: number | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Devuelve la deuda total del alumno desde view_student_debts (vía RPC).
 *
 * FUENTE ÚNICA: get_student_debt_total usa view_student_debts, la misma fuente
 * que PaymentsTab / get_parent_debts_v2.  Esto elimina la discrepancia con
 * students.balance, que solo refleja lo que el trigger fn_sync_student_balance
 * haya sincronizado y no incluye almuerzos huérfanos ni kiosco pendiente.
 *
 * Regla 11.A — Cero Cálculos en el Cliente: el hook recibe el total de DB,
 * no lo calcula.
 */
export function useStudentBalance(studentId: string | null): UseStudentBalanceResult {
  const [balance, setBalance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(studentId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchBalance = async () => {
      if (!studentId || !supabase) {
        if (isMounted) {
          setBalance(null);
          setError(null);
          setIsLoading(false);
        }
        return;
      }

      if (isMounted) {
        setIsLoading(true);
        setError(null);
      }

      const { data, error: queryError } = await supabase
        .rpc('get_student_debt_total', { p_student_id: studentId });

      if (!isMounted) return;

      if (queryError) {
        setBalance(null);
        setError(queryError.message);
        setIsLoading(false);
        return;
      }

      setBalance(Number(data ?? 0));
      setIsLoading(false);
    };

    fetchBalance();

    return () => {
      isMounted = false;
    };
  }, [studentId]);

  return { balance, isLoading, error };
}
