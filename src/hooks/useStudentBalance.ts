import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface UseStudentBalanceResult {
  balance: number | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * SSOT: devuelve exclusivamente students.balance del alumno seleccionado.
 * No calcula deudas ni combina montos en frontend.
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
