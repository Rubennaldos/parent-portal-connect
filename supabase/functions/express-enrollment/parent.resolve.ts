import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const ERR_EXPRESS_CONFLICT_DNI_AMBIGUOUS = "ERR_EXPRESS_CONFLICT_DNI_AMBIGUOUS";

type ParentRow = {
  user_id: string | null;
  school_id: string | null;
  dni: string | null;
};

export type ResolveParentByDniInput = {
  supabaseAdmin: SupabaseClient;
  dniNormalized: string;
  schoolId: string;
};

export type ResolveParentByDniResult =
  | {
      ok: true;
      status: "not_found";
    }
  | {
      ok: true;
      status: "resolved";
      parentUserId: string;
      source: "unique_dni" | "duplicate_resolved_by_school";
    }
  | {
      ok: false;
      errorCode: typeof ERR_EXPRESS_CONFLICT_DNI_AMBIGUOUS;
      message: string;
    };

export async function resolveParentByDni(
  input: ResolveParentByDniInput,
): Promise<ResolveParentByDniResult> {
  const { supabaseAdmin, dniNormalized, schoolId } = input;

  const { data, error } = await supabaseAdmin
    .from("parent_profiles")
    .select("user_id, school_id, dni")
    .eq("dni", dniNormalized)
    .not("user_id", "is", null);

  if (error) {
    throw new Error(`resolveParentByDni failed: ${error.message}`);
  }

  const rows = (data ?? []) as ParentRow[];

  if (rows.length === 0) {
    return { ok: true, status: "not_found" };
  }

  if (rows.length === 1) {
    return {
      ok: true,
      status: "resolved",
      parentUserId: rows[0].user_id as string,
      source: "unique_dni",
    };
  }

  const sameSchool = rows.filter((r) => r.school_id === schoolId);

  if (
    sameSchool.length !== 1 ||
    !sameSchool[0].user_id ||
    !sameSchool[0].school_id
  ) {
    return {
      ok: false,
      errorCode: ERR_EXPRESS_CONFLICT_DNI_AMBIGUOUS,
      message:
        "CONFLICT_DNI_DUPLICATE_AMBIGUOUS: Múltiples perfiles detectados con el mismo DNI en la sede. Use el panel avanzado.",
    };
  }

  return {
    ok: true,
    status: "resolved",
    parentUserId: sameSchool[0].user_id,
    source: "duplicate_resolved_by_school",
  };
}
