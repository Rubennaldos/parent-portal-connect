import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface UseStudentCartDebtResult {
  totalDebt: number;
  payableDebt: number;
  inReviewDebt: number;
  isLoading: boolean;
  error: string | null;
}

type ParentDebtRow = {
  student_id: string;
  summary_student_total: number | null;
  summary_student_payable: number | null;
  summary_student_in_review: number | null;
};

/**
 * Fuente de verdad del Hero: mismo RPC que usa PaymentsTab (`get_parent_debts_v2`).
 * Esto evita discrepancias entre Hero y carrito.
 */
export function useStudentCartDebt(
  parentId: string | null,
  studentId: string | null
): UseStudentCartDebtResult {
  const [totalDebt, setTotalDebt] = useState<number>(0);
  const [payableDebt, setPayableDebt] = useState<number>(0);
  const [inReviewDebt, setInReviewDebt] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(parentId && studentId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchDebt = async () => {
      if (!parentId || !studentId || !supabase) {
        if (isMounted) {
          setTotalDebt(0);
          setPayableDebt(0);
          setInReviewDebt(0);
          setError(null);
          setIsLoading(false);
        }
        return;
      }

      if (isMounted) {
        setIsLoading(true);
        setError(null);
      }

      const { data, error: rpcError } = await supabase.rpc('get_parent_debts_v2', {
        p_parent_id: parentId,
      });

      if (!isMounted) return;

      if (rpcError) {
        setTotalDebt(0);
        setPayableDebt(0);
        setInReviewDebt(0);
        setError(rpcError.message);
        setIsLoading(false);
        return;
      }

      const rows = (data ?? []) as ParentDebtRow[];
      const studentRow = rows.find((row) => row.student_id === studentId);

      setTotalDebt(Number(studentRow?.summary_student_total ?? 0));
      setPayableDebt(Number(studentRow?.summary_student_payable ?? 0));
      setInReviewDebt(Number(studentRow?.summary_student_in_review ?? 0));
      setIsLoading(false);
    };

    fetchDebt();

    return () => {
      isMounted = false;
    };
  }, [parentId, studentId]);

  return { totalDebt, payableDebt, inReviewDebt, isLoading, error };
}
