import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface UseStudentBalanceResult {
  balance: number | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Devuelve el balance del alumno desde students.balance (query directa, < 1ms).
 *
 * RENDIMIENTO: students.balance se actualiza por el trigger fn_sync_student_balance
 * y es la fuente más rápida para el hero visual. La cifra exacta de deuda
 * (incluyendo almuerzos huérfanos) se muestra en PaymentsTab vía get_parent_debts_v2.
 *
 * DECISIÓN ARQUITECTURAL: get_student_debt_total (llamaba view_student_debts) causaba
 * un segundo query costoso en cada carga del hero, duplicando la presión sobre
 * view_student_debts y provocando statement_timeout 57014.
 * students.balance es suficiente para el indicador visual del hero.
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
        .from('students')
        .select('balance')
        .eq('id', studentId)
        .maybeSingle();

      if (!isMounted) return;

      if (queryError) {
        setBalance(null);
        setError(queryError.message);
        setIsLoading(false);
        return;
      }

      setBalance(Number(data?.balance ?? 0));
      setIsLoading(false);
    };

    fetchBalance();

    return () => {
      isMounted = false;
    };
  }, [studentId]);

  return { balance, isLoading, error };
}
