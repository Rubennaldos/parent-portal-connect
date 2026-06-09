import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const ERR_EXPRESS_INVALID_HIERARCHY = "ERR_EXPRESS_INVALID_HIERARCHY";
export const ERR_EXPRESS_DATABASE_ROLLBACK = "ERR_EXPRESS_DATABASE_ROLLBACK";

export type AccountMode = "concession_only" | "kiosk_free";

export type EnrollRpcInput = {
  supabaseAdmin: SupabaseClient;
  schoolId: string;
  parentUserId: string;
  studentFullName: string;
  levelId: string;
  classroomId: string;
  actorUserId: string;
  accountMode: AccountMode;
};

export type EnrollRpcRow = {
  student_id: string;
  parent_user_id: string;
  school_id: string;
  level_id: string;
  classroom_id: string;
  grade: string;
  section: string;
  created_at: string;
};

export class ExpressRpcError extends Error {
  code: string;
  meta?: Record<string, unknown>;

  constructor(code: string, message: string, meta?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.meta = meta;
  }
}

function looksLikeHierarchyError(message: string): boolean {
  const m = message.toUpperCase();
  return (
    m.includes(ERR_EXPRESS_INVALID_HIERARCHY) ||
    m.includes("LEVEL_ID") ||
    m.includes("CLASSROOM_ID") ||
    m.includes("HIERARCHY")
  );
}

function pickSingleRow(data: unknown): unknown {
  if (Array.isArray(data)) return data[0] ?? null;
  return data ?? null;
}

function assertStringField(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ExpressRpcError(
      ERR_EXPRESS_DATABASE_ROLLBACK,
      `Respuesta RPC inválida: falta campo obligatorio "${field}".`,
      { field, value },
    );
  }
  return value;
}

function toEnrollRpcRow(row: unknown): EnrollRpcRow {
  if (!row || typeof row !== "object") {
    throw new ExpressRpcError(
      ERR_EXPRESS_DATABASE_ROLLBACK,
      "Respuesta RPC inválida: estructura vacía o no-objeto.",
    );
  }

  const r = row as Record<string, unknown>;

  return {
    student_id: assertStringField(r.student_id, "student_id"),
    parent_user_id: assertStringField(r.parent_user_id, "parent_user_id"),
    school_id: assertStringField(r.school_id, "school_id"),
    level_id: assertStringField(r.level_id, "level_id"),
    classroom_id: assertStringField(r.classroom_id, "classroom_id"),
    grade: assertStringField(r.grade, "grade"),
    section: assertStringField(r.section, "section"),
    created_at: assertStringField(r.created_at, "created_at"),
  };
}

export async function enrollStudentViaRpc(input: EnrollRpcInput): Promise<EnrollRpcRow> {
  const {
    supabaseAdmin,
    schoolId,
    parentUserId,
    studentFullName,
    levelId,
    classroomId,
    actorUserId,
    accountMode,
  } = input;

  const { data, error } = await supabaseAdmin.rpc("rpc_express_enroll_student_v1", {
    p_school_id: schoolId,
    p_parent_user_id: parentUserId,
    p_student_full_name: studentFullName,
    p_level_id: levelId,
    p_classroom_id: classroomId,
    p_actor_user_id: actorUserId,
    p_account_mode: accountMode,
  });

  if (error) {
    const message = error.message ?? "Unknown RPC error";

    if (looksLikeHierarchyError(message)) {
      throw new ExpressRpcError(
        ERR_EXPRESS_INVALID_HIERARCHY,
        "La jerarquía school/level/classroom no es válida para la matrícula express.",
        {
          db_message: error.message,
          db_code: error.code,
          db_hint: error.hint,
          db_details: error.details,
        },
      );
    }

    throw new ExpressRpcError(
      ERR_EXPRESS_DATABASE_ROLLBACK,
      "Fallo de base de datos en matrícula express. Operación revertida.",
      {
        db_message: error.message,
        db_code: error.code,
        db_hint: error.hint,
        db_details: error.details,
      },
    );
  }

  try {
    const row = pickSingleRow(data);
    return toEnrollRpcRow(row);
  } catch (e) {
    if (e instanceof ExpressRpcError) throw e;

    throw new ExpressRpcError(
      ERR_EXPRESS_DATABASE_ROLLBACK,
      "Fallo validando la respuesta del RPC de matrícula express.",
      { cause: e instanceof Error ? e.message : String(e) },
    );
  }
}
