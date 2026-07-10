import { supabase } from '@/lib/supabase';

export type SetStudentOperationalResult = {
  ok: boolean;
  idempotent?: boolean;
  student_id: string;
  full_name?: string;
  is_active: boolean;
  previous_is_active?: boolean;
  error?: string;
};

/**
 * Única vía frontend para activar/desactivar alumno operativo.
 * La autoridad es el RPC set_student_operational_status (DB).
 */
export async function setStudentOperationalStatus(
  studentId: string,
  isActive: boolean,
  reason?: string,
): Promise<SetStudentOperationalResult> {
  const { data, error } = await supabase.rpc('set_student_operational_status', {
    p_student_id: studentId,
    p_is_active: isActive,
    p_reason: reason ?? null,
  });

  if (error) {
    const msg = error.message || 'No se pudo cambiar el estado del alumno';
    return {
      ok: false,
      student_id: studentId,
      is_active: !isActive,
      error: msg,
    };
  }

  const row = (data ?? {}) as SetStudentOperationalResult;
  return {
    ok: row.ok !== false,
    idempotent: row.idempotent,
    student_id: row.student_id ?? studentId,
    full_name: row.full_name,
    is_active: row.is_active ?? isActive,
    previous_is_active: row.previous_is_active,
  };
}
